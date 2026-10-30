#!/usr/bin/env python3
"""Build a portable Star Office UI deployment bundle.

The bundle contains only runtime files plus the quickstart installer. It can be
installed with Docker Compose or native Python. Supplying a Linux CPython 3.11
wheelhouse makes the native and Docker offline paths self-contained for that
architecture; without it the bundle remains valid for online installs.

Example:
  python scripts/package_deploy_bundle.py \
    --output deploy/bundles --bundle-id star-office-ui-6.0.1 \
    --wheelhouse deploy/office/wheelhouse/linux-cp311-x86_64
"""
from __future__ import annotations

import argparse
import ast
import gzip
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import sys
import tarfile
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
BUNDLE_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
VERSION_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9._+\-]{0,63}$")
IMAGE_ARCHIVE_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9._+\-]{0,127}")
ROOT_FILES = (
    "VERSION", "LICENSE", "asset-defaults.json", "asset-positions.json",
    "runtime-config.sample.json", "state.sample.json", "join-keys.sample.json",
)
QUICKSTART_FILES = (
    "Dockerfile", "docker-compose.yml", "entrypoint.py", "configure_sub2api.py",
    "env.example", "install.sh", "update.sh", "uninstall.sh", "verify.sh", "verify_bundle.py",
    "requirements.txt", "README.md",
)
DOC_FILES = (
    "docs/SYSTEM_DEPLOYMENT.md",
    "docs/SUB2API_DEPLOYMENT.md",
    "docs/SUB2API_PLUGIN_DEPLOYMENT.md",
    "docs/DEPLOYMENT.md",
)
EXCLUDED_PARTS = {"__pycache__", ".git", ".local", "node_modules", "qa", "tests", "test"}


class BundleError(ValueError):
    pass


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def ensure_file(path: Path, root: Path) -> Path:
    if path.is_symlink() or not path.is_file():
        raise BundleError(f"required regular file missing: {path.relative_to(root)}")
    relative = path.relative_to(root)
    if any(part in EXCLUDED_PARTS or part.startswith(".") for part in relative.parts):
        raise BundleError(f"excluded runtime file: {relative}")
    return path


def iter_tree(root: Path, relative_root: str):
    source_root = root / relative_root
    if not source_root.is_dir() or source_root.is_symlink():
        raise BundleError(f"runtime directory missing: {relative_root}")
    for path in sorted(source_root.rglob("*")):
        if path.is_dir():
            continue
        rel = path.relative_to(root)
        if path.is_symlink() or any(part in EXCLUDED_PARTS or part.startswith(".") for part in rel.parts):
            continue
        yield ensure_file(path, root)


def validate_python(path: Path) -> None:
    try:
        ast.parse(path.read_text(encoding="utf-8"), filename=str(path), feature_version=(3, 10))
    except (SyntaxError, UnicodeDecodeError) as error:
        raise BundleError(f"invalid Python source: {path}: {error}") from error


def validate_wheel(path: Path) -> None:
    if path.is_symlink() or path.suffix != ".whl":
        raise BundleError(f"wheelhouse contains a non-wheel file: {path.name}")
    lowered = path.name.lower()
    if any(marker in lowered for marker in ("macosx", "win32", "win_amd64", "win_arm64")):
        raise BundleError(f"non-Linux wheel supplied: {path.name}")
    try:
        with zipfile.ZipFile(path) as wheel:
            names = wheel.namelist()
            if not any(name.endswith(".dist-info/METADATA") for name in names):
                raise BundleError(f"wheel metadata missing: {path.name}")
            for name in names:
                parsed = PurePosixPath(name)
                if parsed.is_absolute() or ".." in parsed.parts:
                    raise BundleError(f"unsafe wheel member: {path.name}:{name}")
    except zipfile.BadZipFile as error:
        raise BundleError(f"invalid wheel: {path.name}") from error


def copy_exact(source: Path, staging: Path, root: Path) -> Path:
    relative = source.relative_to(root)
    target = staging / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, target)
    mode = stat.S_IMODE(source.stat().st_mode)
    target.chmod(0o755 if mode & 0o111 else 0o644)
    if target.read_bytes() != source.read_bytes():
        raise BundleError(f"source changed while packaging: {relative}")
    return target


def records(root: Path, exclude: set[str] | None = None):
    exclude = exclude or set()
    rows = []
    for path in sorted(root.rglob("*")):
        if not path.is_file():
            continue
        relative = path.relative_to(root).as_posix()
        if relative in exclude:
            continue
        rows.append({"path": relative, "sha256": sha256(path), "bytes": path.stat().st_size})
    return rows


def package(root: Path, output: Path, bundle_id: str, wheelhouse: Path | None = None,
            image_archive: Path | None = None):
    root, output = root.resolve(), output.resolve()
    if not BUNDLE_RE.fullmatch(bundle_id):
        raise BundleError("invalid bundle ID")
    version_file = root / "VERSION"
    if not version_file.is_file() or version_file.is_symlink():
        raise BundleError("project VERSION file is missing")
    project_version = version_file.read_text(encoding="utf-8").strip()
    if not VERSION_RE.fullmatch(project_version):
        raise BundleError("unsafe project version")
    bundle_dir = output / bundle_id
    archive = output / f"{bundle_id}.tar.gz"
    checksum = Path(f"{archive}.sha256")
    if bundle_dir.exists() or archive.exists() or checksum.exists():
        raise BundleError("bundle already exists; use a new bundle ID")

    sources: list[Path] = []
    for name in ROOT_FILES:
        sources.append(ensure_file(root / name, root))
    sources.extend(iter_tree(root, "backend"))
    sources.extend(iter_tree(root, "frontend"))
    for name in QUICKSTART_FILES:
        sources.append(ensure_file(root / "deploy/quickstart" / name, root))
    for name in DOC_FILES:
        sources.append(ensure_file(root / name, root))
    for name in ("room-reference.webp", "room-reference.png"):
        path = root / "assets" / name
        if path.exists():
            sources.append(ensure_file(path, root))
    for path in sources:
        if path.suffix == ".py":
            validate_python(path)

    wheels: list[Path] = []
    if wheelhouse is not None:
        wheelhouse = wheelhouse.resolve()
        if not wheelhouse.is_dir():
            raise BundleError(f"wheelhouse directory missing: {wheelhouse}")
        wheels = sorted(wheelhouse.glob("*.whl"))
        if not wheels:
            raise BundleError("wheelhouse is empty")
        for wheel in wheels:
            validate_wheel(wheel)

    if image_archive is not None:
        image_archive = image_archive.resolve()
        if image_archive.is_symlink() or not image_archive.is_file():
            raise BundleError(f"Docker image archive missing: {image_archive}")
        if not IMAGE_ARCHIVE_RE.fullmatch(image_archive.name):
            raise BundleError(f"unsafe Docker image archive name: {image_archive.name}")

    output.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".star-office-bundle-", dir=output) as temp:
        staging = Path(temp) / bundle_id
        staging.mkdir()
        for source in sources:
            copy_exact(source, staging, root)

        wheel_dir = staging / "wheelhouse"
        wheel_dir.mkdir()
        if wheels:
            for wheel in wheels:
                target = wheel_dir / wheel.name
                shutil.copyfile(wheel, target)
                target.chmod(0o644)
        else:
            (wheel_dir / "ONLINE_ONLY.txt").write_text(
                "No wheelhouse was supplied. Online installation is available; offline dependency installation is unavailable.\n",
                encoding="utf-8",
            )

        if image_archive is not None:
            image_dir = staging / "images"
            image_dir.mkdir()
            copy = image_dir / image_archive.name
            shutil.copyfile(image_archive, copy)
            copy.chmod(0o644)

        manifest = {
            "schema_version": 1,
            "bundle_id": bundle_id,
            "project_version": project_version,
            "python": "3.11",
            "offline_wheelhouse": bool(wheels),
            "offline_docker_image": image_archive.name if image_archive else None,
            "runtime": "backend + frontend + quickstart deployer + deployment guides",
            "files": records(staging, {"bundle-manifest.json", "SHA256SUMS"}),
        }
        (staging / "bundle-manifest.json").write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        sums = records(staging, {"SHA256SUMS"})
        (staging / "SHA256SUMS").write_text(
            "".join(f"{row['sha256']}  {row['path']}\n" for row in sums), encoding="utf-8"
        )

        tar_path = Path(temp) / "bundle.tar.gz"
        with tar_path.open("wb") as raw, gzip.GzipFile(filename="", fileobj=raw, mode="wb", mtime=0) as gz:
            with tarfile.open(fileobj=gz, mode="w") as archive_writer:
                paths = [staging, *sorted(staging.rglob("*"))]
                for path in paths:
                    info = archive_writer.gettarinfo(str(path), arcname=path.relative_to(staging.parent).as_posix())
                    info.uid = info.gid = 0
                    info.uname = info.gname = ""
                    info.mtime = 0
                    info.mode = 0o755 if path.is_dir() or path.suffix == ".sh" else 0o644
                    if path.is_file():
                        with path.open("rb") as stream:
                            archive_writer.addfile(info, stream)
                    else:
                        archive_writer.addfile(info)

        shutil.move(str(staging), bundle_dir)
        shutil.move(str(tar_path), archive)

    checksum.write_text(f"{sha256(archive)}  {archive.name}\n", encoding="utf-8")
    return bundle_dir, archive, checksum


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--bundle-id", required=True)
    parser.add_argument("--wheelhouse", type=Path)
    parser.add_argument("--image-archive", type=Path)
    args = parser.parse_args(argv)
    wheelhouse = args.wheelhouse
    if wheelhouse is None:
        candidate = args.root / "deploy/office/wheelhouse/linux-cp311-x86_64"
        if candidate.is_dir():
            wheelhouse = candidate
    try:
        directory, archive, checksum = package(args.root, args.output, args.bundle_id, wheelhouse, args.image_archive)
        print(f"bundle={directory}")
        print(f"archive={archive}")
        print(f"checksum={checksum}")
        print(f"offline_wheelhouse={str(bool(wheelhouse)).lower()}")
        return 0
    except (BundleError, OSError, SyntaxError, UnicodeError, json.JSONDecodeError) as error:
        print(f"deploy_bundle: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
