#!/usr/bin/env python3
"""Verify a Star Office Quickstart bundle before an install or offline update.

The checker is intentionally dependency-free and never imports the application.
It validates the generated bundle manifest, every file hash, and the complete
SHA256SUMS file so an offline update cannot start from a partial or modified
archive.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import sys


BUNDLE_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
VERSION_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9._+\-]{0,63}$")
IMAGE_ARCHIVE_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9._+\-]{0,127}")


class BundleError(ValueError):
    pass


def digest(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def safe_relative(value: str) -> str:
    if not isinstance(value, str):
        raise BundleError("manifest path must be a string")
    parsed = PurePosixPath(value)
    if parsed.is_absolute() or not parsed.parts or ".." in parsed.parts:
        raise BundleError("manifest contains an unsafe path")
    normalized = parsed.as_posix()
    if normalized != value or "\\" in value:
        raise BundleError("manifest path must be canonical POSIX text")
    return normalized


def regular_file(root: Path, relative: str) -> Path:
    path = root / PurePosixPath(relative)
    if path.is_symlink() or not path.is_file():
        raise BundleError("bundle member is missing or is a symlink: " + relative)
    return path


def parse_checksums(root: Path):
    checksum_file = regular_file(root, "SHA256SUMS")
    rows = {}
    for line_number, raw in enumerate(checksum_file.read_text(encoding="utf-8").splitlines(), 1):
        if not raw.strip():
            continue
        expected, separator, relative = raw.partition("  ")
        if not separator or not re.fullmatch(r"[0-9a-f]{64}", expected):
            raise BundleError("invalid checksum line " + str(line_number))
        relative = safe_relative(relative)
        if relative in rows:
            raise BundleError("duplicate checksum entry: " + relative)
        rows[relative] = expected
    if not rows:
        raise BundleError("SHA256SUMS is empty")
    return rows


def all_files(root: Path):
    result = set()
    for path in root.rglob("*"):
        if path.is_symlink():
            raise BundleError("bundle contains a symlink or non-regular member: " + path.relative_to(root).as_posix())
        if path.is_dir():
            continue
        relative = path.relative_to(root).as_posix()
        if not path.is_file():
            raise BundleError("bundle contains a symlink or non-regular member: " + relative)
        result.add(relative)
    return result


def verify(root: Path):
    root = Path(root)
    if root.is_symlink():
        raise BundleError("bundle directory is a symlink")
    root = root.resolve()
    if not root.is_dir():
        raise BundleError("bundle directory is missing or is a symlink")
    manifest_path = regular_file(root, "bundle-manifest.json")
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise BundleError("invalid bundle-manifest.json") from exc
    if not isinstance(manifest, dict) or manifest.get("schema_version") != 1:
        raise BundleError("unsupported bundle manifest")
    bundle_id = manifest.get("bundle_id")
    if not isinstance(bundle_id, str) or not BUNDLE_RE.fullmatch(bundle_id):
        raise BundleError("invalid bundle ID")
    project_version = manifest.get("project_version")
    if not isinstance(project_version, str) or not VERSION_RE.fullmatch(project_version):
        raise BundleError("bundle project version is missing or unsafe")
    files = manifest.get("files")
    if not isinstance(files, list):
        raise BundleError("bundle manifest files must be a list")
    manifest_rows = {}
    for row in files:
        if not isinstance(row, dict) or set(row) != {"path", "sha256", "bytes"}:
            raise BundleError("invalid bundle manifest file row")
        relative = safe_relative(row["path"])
        if relative in {"bundle-manifest.json", "SHA256SUMS"} or relative in manifest_rows:
            raise BundleError("duplicate or reserved manifest path: " + relative)
        if not re.fullmatch(r"[0-9a-f]{64}", row["sha256"]) or type(row["bytes"]) is not int or row["bytes"] < 0:
            raise BundleError("invalid manifest digest or size: " + relative)
        manifest_rows[relative] = row

    actual = all_files(root)
    expected_runtime = set(manifest_rows)
    if actual != expected_runtime | {"bundle-manifest.json", "SHA256SUMS"}:
        extra = sorted(actual - (expected_runtime | {"bundle-manifest.json", "SHA256SUMS"}))
        missing = sorted((expected_runtime | {"bundle-manifest.json", "SHA256SUMS"}) - actual)
        raise BundleError("bundle file set mismatch; extra=%s missing=%s" % (extra, missing))

    checksums = parse_checksums(root)
    if set(checksums) != actual - {"SHA256SUMS"}:
        raise BundleError("SHA256SUMS file set mismatch")
    for relative, expected in checksums.items():
        if digest(regular_file(root, relative)) != expected:
            raise BundleError("checksum mismatch: " + relative)
    for relative, row in manifest_rows.items():
        path = regular_file(root, relative)
        if path.stat().st_size != row["bytes"] or digest(path) != row["sha256"]:
            raise BundleError("manifest digest mismatch: " + relative)

    image_name = manifest.get("offline_docker_image")
    if image_name is not None:
        if not isinstance(image_name, str) or not IMAGE_ARCHIVE_RE.fullmatch(image_name):
            raise BundleError("declared offline Docker image name is unsafe")
        image_name = safe_relative("images/" + image_name)
        if image_name not in actual:
            raise BundleError("declared offline Docker image is missing")
    wheelhouse = root / "wheelhouse"
    if wheelhouse.is_symlink():
        raise BundleError("wheelhouse must not be a symlink")
    has_wheels = wheelhouse.is_dir() and any(path.suffix == ".whl" for path in wheelhouse.iterdir() if path.is_file())
    if bool(manifest.get("offline_wheelhouse")) != has_wheels:
        raise BundleError("offline_wheelhouse flag does not match bundled wheels")
    return manifest


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("bundle", type=Path)
    parser.add_argument("--json", action="store_true", dest="as_json")
    args = parser.parse_args(argv)
    try:
        manifest = verify(args.bundle)
        if args.as_json:
            print(json.dumps(manifest, ensure_ascii=False, sort_keys=True))
        else:
            print("bundle verified: %s (version %s)" % (manifest["bundle_id"], manifest["project_version"]))
        return 0
    except (BundleError, OSError, UnicodeError, TypeError, ValueError) as exc:
        print("quickstart_bundle: FAILED (integrity or manifest validation): " + str(exc), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
