"""Stopped-office-volume backup/restore helper. No external services/network.

Restore is restricted to /restore-data and rejects every link, device and path
escape BEFORE deleting any data. Caller first takes a pre-rollback safety copy.
"""
import json
from pathlib import Path, PurePosixPath
import shutil
import sqlite3
import sys
import tempfile
import tarfile


def validate_sqlite(path):
    db = sqlite3.connect(path.as_uri() + '?mode=ro', uri=True)
    try:
        if db.execute('PRAGMA quick_check').fetchone()[0] != 'ok':
            raise ValueError('SQLite integrity failed')
    finally:
        db.close()


def backup(source, destination, approved_source=None):
    source, destination = Path(source).resolve(), Path(destination)
    allowed = (Path('/backup-data'), Path('/restore-data')) if approved_source is None else (Path(approved_source).resolve(),)
    if source not in allowed or destination.exists():
        raise ValueError('unapproved backup path or destination exists')
    paths = sorted(source.rglob('*'))
    for p in paths:
        if p.is_symlink() or not (p.is_file() or p.is_dir()):
            raise ValueError('unsupported volume member')
        if p.is_file() and p.suffix in ('.sqlite3', '.sqlite', '.db'):
            validate_sqlite(p)
        if p.name == 'office-snapshot.json':
            json.loads(p.read_text())
    stream_output = str(destination) == '-'
    with tarfile.open(name=None if stream_output else str(destination),
                      fileobj=sys.stdout.buffer if stream_output else None,
                      mode='w|gz' if stream_output else 'w:gz', dereference=True) as archive:
        for p in paths:
            info = archive.gettarinfo(str(p), arcname=p.relative_to(source).as_posix())
            info.uid = info.gid = 10001
            info.uname = info.gname = ''
            info.mode = 0o700 if p.is_dir() else 0o600
            if p.is_file():
                with p.open('rb') as stream:
                    archive.addfile(info, stream)
            else:
                archive.addfile(info)
    if not stream_output:
        destination.chmod(0o600)


def checked_members(archive):
    members = archive.getmembers()
    names = set()
    for member in members:
        path = PurePosixPath(member.name)
        if (not path.parts or path.is_absolute() or '..' in path.parts or member.name in names
                or not (member.isfile() or member.isdir())):
            raise ValueError('unsafe volume archive')
        names.add(member.name)
    return members


def restore(source, destination, expected_mount=None):
    destination = Path(destination)
    mount = Path('/restore-data') if expected_mount is None else Path(expected_mount)
    if destination != mount or destination.is_symlink() or not destination.is_dir():
        raise ValueError('restore only permitted inside fixed volume mount')
    # Operational restore streams the root-private backup via stdin. The app
    # UID never receives access to the host backup directory itself.
    with tempfile.TemporaryFile() as incoming:
        if str(source) == '-':
            shutil.copyfileobj(sys.stdin.buffer, incoming)
            incoming.seek(0)
            archive_input = incoming
        else:
            archive_input = None
        with tarfile.open(name=None if archive_input else str(source), fileobj=archive_input, mode='r:gz') as archive:
            return _restore_checked(archive, destination)


def _restore_checked(archive, destination):
    members = checked_members(archive)
    files = {PurePosixPath(m.name) for m in members if m.isfile()}
    if any(any(parent in files for parent in PurePosixPath(m.name).parents) for m in members):
        raise ValueError('archive parent is a file')
    # Validate the COMPLETE payload in a staging directory on the same
    # volume before deleting anything. No extractall and no link handling.
    with tempfile.TemporaryDirectory(prefix='.office-restore-', dir=destination) as temp:
        staging = Path(temp)
        for member in members:
            path = staging.joinpath(*PurePosixPath(member.name).parts)
            path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            if member.isdir():
                path.mkdir(exist_ok=True, mode=0o700)
            else:
                with archive.extractfile(member) as stream, path.open('xb') as target:
                    shutil.copyfileobj(stream, target)
                path.chmod(0o600)
        for p in staging.rglob('*'):
            if p.is_file() and p.suffix in ('.sqlite3', '.sqlite', '.db'):
                validate_sqlite(p)
            if p.name == 'office-snapshot.json':
                json.loads(p.read_text())
        existing = [p for p in destination.iterdir() if p != staging]
        if any(not (p.is_symlink() or p.is_file() or p.is_dir()) for p in existing):
            raise ValueError('unsupported existing data')
        for path in existing:
            if path.is_symlink() or path.is_file():
                path.unlink()
            else:
                shutil.rmtree(str(path))
        for path in staging.iterdir():
            path.rename(destination / path.name)


if __name__ == '__main__':
    try:
        if sys.argv[1] == 'backup':
            backup(sys.argv[2], sys.argv[3])
        elif sys.argv[1] == 'restore':
            restore(sys.argv[2], sys.argv[3])
        else:
            raise ValueError('invalid archive operation')
    except Exception:
        print('office_volume_archive: FAILED; inspect restricted backup locally', file=sys.stderr)
        raise SystemExit(2)
