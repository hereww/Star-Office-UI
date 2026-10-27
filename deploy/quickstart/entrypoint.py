#!/usr/bin/env python3
"""Minimal role launcher for the portable Docker image."""
from __future__ import annotations

import os
from pathlib import Path
import stat
import sys


def secret_file(path: str) -> str:
    target = Path(path)
    info = target.lstat()
    if target.is_symlink() or not stat.S_ISREG(info.st_mode) or stat.S_IMODE(info.st_mode) not in (0o400, 0o600):
        raise SystemExit("quickstart_entrypoint: restricted secret file required")
    value = target.read_text(encoding="ascii").strip()
    if not value or any(ord(char) < 32 for char in value):
        raise SystemExit("quickstart_entrypoint: empty or invalid secret file")
    return value


def main() -> int:
    args = sys.argv[1:]
    role = args[0] if args else "web"
    if role == "web":
        if os.environ.get("OFFICE_ENABLED", "0") == "1":
            path = os.environ.get("OFFICE_ADMIN_PASSWORD_HASH_FILE", "/run/secrets/office_admin_hash")
            os.environ["OFFICE_ADMIN_PASSWORD_HASH"] = secret_file(path)
        command = [sys.executable, "-m", "gunicorn", "--chdir", "/app/backend",
                   "--bind", "0.0.0.0:19000", "--workers", "2", "--threads", "4",
                   "--timeout", "60", "--access-logfile", "-", "--error-logfile", "-", "app:app"]
    elif role == "collector":
        command = [sys.executable, "/app/backend/office_collector.py", "--data-dir",
                   os.environ.get("OFFICE_DATA_DIR", "/data")]
    else:
        # Health checks and debugging commands are allowed to pass through the
        # image entrypoint without gaining access to any office secret.
        command = args
        if not command:
            raise SystemExit("quickstart_entrypoint: missing command")
    os.execv(command[0], command)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
