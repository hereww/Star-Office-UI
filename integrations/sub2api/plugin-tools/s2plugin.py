#!/usr/bin/env python3
"""Build and verify the frozen user-telemetry package, not its host/runtime contract."""

import argparse
import base64
import binascii
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import tempfile
import zipfile
import zlib

PLUGIN_ID = "com.lvdong.user-telemetry"
VERSION = "0.1.0"
SUPPORTED_VERSIONS = frozenset((VERSION, "0.1.1", "0.2.0"))
CAPABILITY = {"id": "sub2api.user_telemetry.read.v1", "platform": "sub2api", "account_type": "user"}
DEFAULT_SUB2API = ">=0.2.13 <0.3.0"
MAX_FILES = 512
MAX_UPLOAD = 128 * 1024 * 1024
MAX_UNCOMPRESSED = 256 * 1024 * 1024
MANIFEST_LIMIT = 2 * 1024 * 1024
SIGNATURE_LIMIT = 64 * 1024
ED25519_SPKI_PREFIX = bytes.fromhex("302a300506032b6570032100")
PLATFORM_RE = re.compile(r"[a-z0-9]+-[a-z0-9]+\Z")
HASH_RE = re.compile(r"[a-f0-9]{64}\Z")
SEMVER = r"v?(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?"
RESERVED_KEY_ID = "sub2api-openai-transport-v1"
PRIVATE_PEM_RE = re.compile(br"-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----")


class PackageError(ValueError):
    """A safe user-facing package/crypto validation error."""


def json_bytes(value):
    # Exactly these bytes (including the LF) are signed and placed in the ZIP.
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")


def safe_path(name):
    if (not isinstance(name, str) or not name or name.strip() != name
            or "\\" in name or ":" in name or any(ord(c) < 32 or ord(c) == 127 for c in name)
            or any(part in ("", ".", "..") or part.strip() != part for part in name.split("/"))):
        raise PackageError("unsafe archive path")
    return name


def platform_name(value):
    if not isinstance(value, str) or not PLATFORM_RE.fullmatch(value):
        raise PackageError("platform must be GOOS-GOARCH, e.g. linux-amd64")
    return value


def key_id(value):
    if (not isinstance(value, str) or not value or value.strip() != value
            or any(ord(c) < 32 or ord(c) == 127 for c in value) or len(value) > 160):
        raise PackageError("invalid publisher key-id")
    if value == RESERVED_KEY_ID:
        raise PackageError("the built-in transport key-id cannot sign this plugin")
    return value


def sub2api_range(value):
    # Conservative supported subset of the host's semver range language.
    if not isinstance(value, str) or not value.strip():
        raise PackageError("requires.sub2api must be a nonempty semver range")
    terms = value.replace(",", " ").split()
    for term in terms:
        match = re.fullmatch(r"(?:>=|<=|>|<|=)?(" + SEMVER + r")", term)
        if not match:
            raise PackageError("invalid sub2api range; use comparator+full-semver terms, e.g. >=0.2.13 <0.3.0")
        # x/mod/semver rejects leading zeros in numeric prerelease identifiers.
        version = match.group(1).split("+", 1)[0]
        if "-" in version:
            for identifier in version.split("-", 1)[1].split("."):
                if identifier.isdigit() and len(identifier) > 1 and identifier.startswith("0"):
                    raise PackageError("invalid semver numeric prerelease identifier")
    return value.strip()


def check_source(path, directory=False):
    path = Path(os.path.abspath(os.path.expanduser(str(path))))
    # Do not resolve away symlinks before inspecting them, including parent links.
    for candidate in (path, *path.parents):
        if candidate.is_symlink():
            raise PackageError("source paths must not contain symlinks")
    try:
        mode = path.stat().st_mode
    except OSError as exc:
        raise PackageError("input file/directory is missing or unreadable") from exc
    if not (stat.S_ISDIR(mode) if directory else stat.S_ISREG(mode)):
        raise PackageError("input must be a regular " + ("directory" if directory else "file"))
    return path


def source_bytes(path, limit=MAX_UNCOMPRESSED):
    path = check_source(path)
    # O_NOFOLLOW closes a last-component symlink swap between checking and reading.
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0))
    with os.fdopen(fd, "rb") as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_size > limit:
            raise PackageError("source is not a regular file or exceeds size limit")
        data = stream.read(limit + 1)
    if len(data) > limit:
        raise PackageError("source exceeds size limit")
    return data


def openssl_run(openssl, arguments):
    try:
        result = subprocess.run([str(openssl), *map(str, arguments)], stdin=subprocess.DEVNULL,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30, check=False)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise PackageError("OpenSSL unavailable or timed out; select an Ed25519-capable OpenSSL with --openssl") from exc
    if result.returncode:
        # Do not echo OpenSSL stderr: it can expose source paths or key details.
        raise PackageError("OpenSSL operation failed (invalid key/signature or no Ed25519 support)")
    return result.stdout


def public_der(key_path, openssl="openssl", private=False):
    key_path = check_source(key_path)
    args = ["pkey"]
    if not private:
        args.append("-pubin")
    args += ["-in", key_path, "-pubout", "-outform", "DER"]
    der = openssl_run(openssl, args)
    if len(der) != 44 or not der.startswith(ED25519_SPKI_PREFIX):
        raise PackageError("key must be Ed25519 (PEM private key or PEM public key as appropriate)")
    return der


def decode_base64(value, length, label):
    try:
        raw = base64.b64decode(value, validate=True)
    except (ValueError, TypeError, binascii.Error) as exc:
        raise PackageError("invalid Base64 " + label) from exc
    if len(raw) != length:
        raise PackageError("invalid " + label + " length")
    return raw


def sign_manifest(raw, private_key, openssl="openssl"):
    der = public_der(private_key, openssl, private=True)
    with tempfile.TemporaryDirectory(prefix="s2plugin-sign-") as tmp:
        manifest_path, signature_path = Path(tmp) / "manifest.json", Path(tmp) / "signature.bin"
        manifest_path.write_bytes(raw)
        openssl_run(openssl, ["pkeyutl", "-sign", "-rawin", "-inkey", private_key,
                              "-in", manifest_path, "-out", signature_path])
        signature = signature_path.read_bytes()
    if len(signature) != 64:
        raise PackageError("Ed25519 signature must contain 64 bytes")
    verify_signature(raw, signature, der, openssl)
    return signature, der


def verify_signature(raw, signature, der, openssl="openssl"):
    with tempfile.TemporaryDirectory(prefix="s2plugin-verify-") as tmp:
        pub, data, sig = (Path(tmp) / name for name in ("public.der", "manifest.json", "signature.bin"))
        pub.write_bytes(der)
        data.write_bytes(raw)
        sig.write_bytes(signature)
        openssl_run(openssl, ["pkeyutl", "-verify", "-rawin", "-pubin", "-keyform", "DER",
                              "-inkey", pub, "-in", data, "-sigfile", sig])


def validate_manifest(manifest, platform=None):
    expected = {"schema_version", "id", "name", "version", "requires", "capabilities", "runtimes", "ui", "files"}
    if not isinstance(manifest, dict) or set(manifest) != expected:
        raise PackageError("unexpected manifest fields")
    if (type(manifest["schema_version"]) is not int or manifest["schema_version"] != 1
            or manifest["id"] != PLUGIN_ID or not isinstance(manifest["version"], str) or manifest["version"] not in SUPPORTED_VERSIONS):
        raise PackageError("unexpected telemetry package identity/version")
    if not isinstance(manifest["name"], str) or not manifest["name"].strip() or len(manifest["name"].encode()) > 160:
        raise PackageError("invalid plugin name")
    requires = manifest["requires"]
    expected_requires = {"sub2api", "plugin_protocol", "user_telemetry_api", "ui_bridge"}
    if manifest["version"] == "0.2.0":
        expected_requires.add("tested_sub2api_versions")
    if not isinstance(requires, dict) or set(requires) != expected_requires:
        raise PackageError("telemetry requires must not include transport_api or omit user_telemetry_api")
    sub2api_range(requires["sub2api"])
    if manifest["version"] == "0.2.0" and requires.get("tested_sub2api_versions") != ["0.2.14"]:
        raise PackageError("daily/model release requires explicit tested host version")
    for field in ("plugin_protocol", "user_telemetry_api", "ui_bridge"):
        if type(requires[field]) is not int or requires[field] != 1:
            raise PackageError("unsupported telemetry protocol requirement: " + field)
    if manifest["capabilities"] != [CAPABILITY]:
        raise PackageError("only the frozen user-telemetry read capability is allowed")
    runtimes, files = manifest["runtimes"], manifest["files"]
    if not isinstance(runtimes, dict) or not runtimes:
        raise PackageError("at least one runtime platform is required")
    if not isinstance(files, dict) or not files:
        raise PackageError("manifest must declare file hashes")
    for path, digest in files.items():
        safe_path(path)
        if not isinstance(digest, str) or not HASH_RE.fullmatch(digest):
            raise PackageError("file hashes must be lowercase SHA-256 hex")
    allowed_paths = set()
    for target, runtime in runtimes.items():
        platform_name(target)
        if not isinstance(runtime, dict) or set(runtime) != {"path"}:
            raise PackageError("invalid runtime entry")
        binary = "user-telemetry.exe" if target.startswith("windows-") else "user-telemetry"
        path = "runtimes/" + target + "/" + binary
        if runtime["path"] != path or path not in files:
            raise PackageError("runtime path is missing or undeclared")
        allowed_paths.add(path)
    if platform is not None and platform_name(platform) not in runtimes:
        raise PackageError("package does not support target platform " + platform)
    if manifest["ui"] != {"entrypoint": "ui/index.html"} or "ui/index.html" not in files:
        raise PackageError("UI entrypoint ui/index.html is required and must be hashed")
    for path in files:
        if path not in allowed_paths and not path.startswith("ui/"):
            raise PackageError("unexpected payload file outside declared runtimes/UI")


def reject_secrets(data, private_raw=None):
    if PRIVATE_PEM_RE.search(data) or (private_raw and private_raw in data):
        raise PackageError("private signing key material must not enter the package")


def build_package(runtimes, ui_dir, private_key, publisher_key_id, output,
                  sub2api=DEFAULT_SUB2API, require_platforms=(), openssl="openssl", *, version=VERSION):
    if not isinstance(version, str) or version not in SUPPORTED_VERSIONS:
        raise PackageError("unsupported telemetry release version")
    key_id(publisher_key_id)
    sub2api = sub2api_range(sub2api)
    private_key = check_source(private_key)
    private_raw = source_bytes(private_key, MANIFEST_LIMIT)
    ui_dir = check_source(ui_dir, directory=True)
    if private_key.is_relative_to(ui_dir):
        raise PackageError("signing private key must be outside the UI tree")
    output = Path(os.path.abspath(os.path.expanduser(str(output))))
    if output.suffix != ".s2plugin":
        raise PackageError("output must have the .s2plugin extension")
    if output.is_relative_to(ui_dir) or output == private_key or output.is_symlink():
        raise PackageError("output must not overwrite inputs or reside inside the UI tree")
    check_source(output.parent, directory=True)
    if not runtimes:
        raise PackageError("at least one runtime platform is required")
    payload, runtime_entries = {}, {}
    payload_size = 0
    if len(runtimes) + 2 > MAX_FILES:
        raise PackageError("package exceeds 512 ZIP entries")
    for target, source in runtimes.items():
        platform_name(target)
        source = check_source(source)
        if source == private_key or os.path.samefile(source, private_key):
            raise PackageError("runtime input must not be the signing private key")
        if source == output:
            raise PackageError("output must not overwrite a runtime input")
        binary = "user-telemetry.exe" if target.startswith("windows-") else "user-telemetry"
        path = "runtimes/" + target + "/" + binary
        data = source_bytes(source, MAX_UNCOMPRESSED - payload_size)
        payload_size += len(data)
        if not data:
            raise PackageError("runtime binary must not be empty")
        reject_secrets(data, private_raw)
        payload[path] = data
        runtime_entries[target] = {"path": path}
    for target in require_platforms:
        if platform_name(target) not in runtime_entries:
            raise PackageError("package does not support target platform " + target)
    for directory, dirs, names in os.walk(ui_dir, followlinks=False):
        for entry in sorted(dirs + names):
            path = Path(directory) / entry
            if path.is_symlink():
                raise PackageError("UI tree must not contain symlinks")
            if entry.startswith("."):
                raise PackageError("UI tree must not contain hidden files/directories; use a clean UI build directory")
        for entry in sorted(names):
            source = Path(directory) / entry
            if os.path.samefile(source, private_key):
                raise PackageError("UI input must not be the signing private key (including hardlinks)")
            path = safe_path("ui/" + source.relative_to(ui_dir).as_posix())
            data = source_bytes(source, MAX_UNCOMPRESSED - payload_size)
            payload_size += len(data)
            reject_secrets(data, private_raw)
            payload[path] = data
            if len(payload) + 2 > MAX_FILES:
                raise PackageError("package exceeds 512 ZIP entries")
    manifest = {"schema_version": 1, "id": PLUGIN_ID, "name": "Lvdong User Telemetry",
                "version": version, "requires": {"sub2api": sub2api, "plugin_protocol": 1,
                "user_telemetry_api": 1, "ui_bridge": 1}, "capabilities": [dict(CAPABILITY)],
                "runtimes": runtime_entries, "ui": {"entrypoint": "ui/index.html"},
                "files": {path: hashlib.sha256(data).hexdigest() for path, data in sorted(payload.items())}}
    if version == "0.2.0":
        manifest["requires"]["tested_sub2api_versions"] = ["0.2.14"]
    validate_manifest(manifest)
    raw = json_bytes(manifest)
    if len(raw) > MANIFEST_LIMIT or sum(map(len, payload.values())) + len(raw) + SIGNATURE_LIMIT > MAX_UNCOMPRESSED:
        raise PackageError("package exceeds manifest/uncompressed size limit")
    signature, der = sign_manifest(raw, private_key, openssl)
    payload["manifest.json"] = raw
    payload["signature.json"] = json_bytes({"algorithm": "ed25519", "key_id": publisher_key_id,
                                          "signature": base64.b64encode(signature).decode("ascii")})
    if len(payload) > MAX_FILES:
        raise PackageError("package exceeds 512 ZIP entries")
    # Same-directory temporary file + fsync + replace: failures leave prior output intact.
    fd, temp_name = tempfile.mkstemp(prefix=".s2plugin-", suffix=".tmp", dir=output.parent)
    try:
        with os.fdopen(fd, "w+b") as stream:
            with zipfile.ZipFile(stream, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
                for path, data in sorted(payload.items()):
                    info = zipfile.ZipInfo(path, date_time=(1980, 1, 1, 0, 0, 0))
                    info.create_system = 3
                    mode = 0o700 if path in {r["path"] for r in runtime_entries.values()} else 0o600
                    info.external_attr = (stat.S_IFREG | mode) << 16
                    info.compress_type = zipfile.ZIP_DEFLATED
                    archive.writestr(info, data, compresslevel=9)
            stream.flush()
            os.fsync(stream.fileno())
        if os.path.getsize(temp_name) > MAX_UPLOAD:
            raise PackageError("package exceeds upload size limit")
        verify_package(temp_name, publisher_key_id, public_key_base64=base64.b64encode(der[-32:]).decode(), openssl=openssl)
        os.replace(temp_name, output)
    finally:
        if os.path.exists(temp_name):
            os.unlink(temp_name)
    return manifest


def parse_json(raw, label):
    def unique_pairs(pairs):
        result = {}
        for name, value in pairs:
            if name in result:
                raise PackageError("duplicate JSON field in " + label)
            result[name] = value
        return result
    try:
        return json.loads(raw.decode("utf-8"), object_pairs_hook=unique_pairs,
                          parse_constant=lambda _: (_ for _ in ()).throw(PackageError("non-finite JSON")))
    except (ValueError, UnicodeError) as exc:
        raise PackageError("invalid " + label + " JSON: " + str(exc)) from exc


def verify_package(package, publisher_key_id, *, public_key=None, public_key_base64=None,
                   platform=None, openssl="openssl"):
    key_id(publisher_key_id)
    if (public_key is None) == (public_key_base64 is None):
        raise PackageError("supply exactly one trusted public key (PEM or raw 32-byte Base64)")
    der = (public_der(public_key, openssl) if public_key is not None else
           ED25519_SPKI_PREFIX + decode_base64(public_key_base64, 32, "public key"))
    package = check_source(package)
    if package.stat().st_size > MAX_UPLOAD:
        raise PackageError("package exceeds upload size limit")
    try:
        with zipfile.ZipFile(package, "r") as archive:
            entries = archive.infolist()
            if not entries or len(entries) > MAX_FILES:
                raise PackageError("invalid ZIP entry count")
            index, total = {}, 0
            for info in entries:
                path = safe_path(info.filename)
                mode = info.external_attr >> 16
                if info.is_dir() or stat.S_IFMT(mode) not in (0, stat.S_IFREG):
                    raise PackageError("ZIP entries must be regular files, not symlinks/directories")
                if path in index:
                    raise PackageError("duplicate ZIP path")
                if info.extra or info.comment or info.flag_bits & 1:
                    raise PackageError("extra ZIP metadata/encryption is not allowed")
                if info.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED):
                    raise PackageError("unsupported ZIP compression")
                total += info.file_size
                if total > MAX_UNCOMPRESSED:
                    raise PackageError("package exceeds uncompressed size limit")
                index[path] = info
            if archive.comment:
                raise PackageError("extra ZIP comment is not allowed")
            for name, limit in (("manifest.json", MANIFEST_LIMIT), ("signature.json", SIGNATURE_LIMIT)):
                if name not in index or index[name].file_size > limit:
                    raise PackageError("package missing/oversized " + name)
            raw = archive.read("manifest.json")
            manifest = parse_json(raw, "manifest")
            validate_manifest(manifest, platform)
            if set(index) != set(manifest["files"]) | {"manifest.json", "signature.json"}:
                raise PackageError("ZIP contents differ from declared files (missing/undeclared file)")
            sig = parse_json(archive.read("signature.json"), "signature")
            if (not isinstance(sig, dict) or set(sig) != {"algorithm", "key_id", "signature"}
                    or sig["algorithm"] != "ed25519" or sig["key_id"] != publisher_key_id):
                raise PackageError("signature algorithm/key-id does not match trusted publisher")
            verify_signature(raw, decode_base64(sig["signature"], 64, "signature"), der, openssl)
            for path, digest in manifest["files"].items():
                hasher = hashlib.sha256()
                consumed, overlap = 0, b""
                with archive.open(index[path]) as stream:
                    while chunk := stream.read(1024 * 1024):
                        consumed += len(chunk)
                        if consumed > index[path].file_size:
                            raise PackageError("file exceeds declared ZIP size")
                        reject_secrets(overlap + chunk)
                        overlap = chunk[-128:]
                        hasher.update(chunk)
                if consumed != index[path].file_size or hasher.hexdigest() != digest:
                    raise PackageError("SHA-256 mismatch for " + path)
    except (zipfile.BadZipFile, zlib.error, RuntimeError, NotImplementedError, EOFError) as exc:
        raise PackageError("invalid or corrupt ZIP package") from exc
    return manifest


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    pack = commands.add_parser("pack", help="package already-built binaries and a clean UI tree")
    pack.add_argument("--runtime", action="append", required=True, metavar="GOOS-GOARCH:PATH")
    pack.add_argument("--ui-dir", required=True)
    pack.add_argument("--signing-key", required=True, help="external Ed25519 PKCS#8 PEM; never copied into ZIP")
    pack.add_argument("--key-id", required=True)
    pack.add_argument("--output", required=True)
    pack.add_argument("--version", choices=sorted(SUPPORTED_VERSIONS), default=VERSION)
    pack.add_argument("--sub2api-range", default=DEFAULT_SUB2API)
    pack.add_argument("--require-platform", action="append", default=[])
    verify = commands.add_parser("verify", help="verify bytes/hashes against an externally trusted key, without extraction")
    verify.add_argument("package")
    verify.add_argument("--key-id", required=True)
    trust = verify.add_mutually_exclusive_group(required=True)
    trust.add_argument("--public-key", help="Ed25519 public PEM (not private PEM)")
    trust.add_argument("--public-key-base64", help="raw 32-byte public key, matching plugins.trusted_publishers")
    verify.add_argument("--platform", required=True, help="actual installation target GOOS-GOARCH")
    export = commands.add_parser("public-key", help="print ONLY raw public key Base64 for host trust configuration")
    export.add_argument("--signing-key", required=True)
    for command in (pack, verify, export):
        command.add_argument("--openssl", default="openssl", help="path/name of an Ed25519-capable OpenSSL executable")
    args = parser.parse_args(argv)
    try:
        if args.command == "public-key":
            print(base64.b64encode(public_der(args.signing_key, args.openssl, private=True)[-32:]).decode())
            return 0
        if args.command == "pack":
            runtimes = {}
            for mapping in args.runtime:
                target, separator, source = mapping.partition(":")
                if not separator or not source or target in runtimes:
                    raise PackageError("runtime mapping must be unique GOOS-GOARCH:PATH")
                runtimes[target] = source
            manifest = build_package(runtimes, args.ui_dir, args.signing_key, args.key_id, args.output,
                                     args.sub2api_range, args.require_platform, args.openssl, version=args.version)
        else:
            manifest = verify_package(args.package, args.key_id, public_key=args.public_key,
                                      public_key_base64=args.public_key_base64, platform=args.platform, openssl=args.openssl)
        print(json.dumps({"result": "package_verified", "id": manifest["id"], "version": manifest["version"],
                          "platforms": sorted(manifest["runtimes"]), "requires": manifest["requires"],
                          "host_installability": "requires telemetry-capable host; semver alone is insufficient"},
                         ensure_ascii=False))
        return 0
    except (PackageError, OSError) as exc:
        print("error: " + str(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
