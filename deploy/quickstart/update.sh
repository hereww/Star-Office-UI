#!/usr/bin/env bash
set -euo pipefail

# Apply a previously verified Quickstart bundle to an existing installation.
# The target host remains offline: all validation, dependency installation and
# Docker image loading use files from this bundle or already cached resources.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT_DIR="$ROOT/deploy/quickstart"
PYTHON_BIN="${PYTHON_BIN:-python3}"
ENGINE="auto"
INSTALL_DIR="${STAR_OFFICE_INSTALL_DIR:-${HOME:-/tmp}/.star-office-ui}"
IMAGE_ARCHIVE="${STAR_OFFICE_IMAGE_ARCHIVE:-}"
IMAGE_OVERRIDE=""
ALLOW_DOWNGRADE=0
OFFLINE=0

usage() {
  cat <<'EOF'
Star Office UI offline bundle updater

usage:
  deploy/quickstart/update.sh [options]

options:
  --offline             Required explicit offline update mode.
  --docker              Update an existing Docker Compose installation.
  --native              Update an existing native Python installation.
  --install-dir DIR     Existing private installation directory.
  --image TAG           Target Docker image tag (normally derived from bundle ID).
  --image-archive FILE  Load a local docker save archive before starting.
  --allow-downgrade     Permit a lower semantic project version.
  -h, --help            Show this help.

The updater verifies bundle-manifest.json and SHA256SUMS, backs up the private
environment and install state, preserves data/volumes/credentials, restarts the
selected Quickstart service, and reads /health back with the target version.
EOF
}

fail() { echo "star-office-update: $*" >&2; exit 2; }

compose_available() {
  command -v docker >/dev/null 2>&1 || return 1
  docker compose version >/dev/null 2>&1 || command -v docker-compose >/dev/null 2>&1
}

env_value() {
  local key="$1"
  "$PYTHON_BIN" - "$INSTALL_DIR/.env" "$key" <<'PY'
import shlex
import sys
from pathlib import Path

path = Path(sys.argv[1])
key = sys.argv[2]
for raw in path.read_text(encoding="utf-8").splitlines():
    line = raw.strip()
    if not line or line.startswith("#"):
        continue
    if line.startswith("export "):
        line = line[7:].lstrip()
    name, sep, value = line.partition("=")
    if sep and name.strip() == key:
        try:
            parsed = shlex.split(value, comments=True, posix=True)
        except ValueError:
            parsed = []
        if len(parsed) == 1:
            print(parsed[0])
        else:
            print(value.strip().strip("'\""))
        break
PY
}

write_update_metadata() {
  local path="$1" target_bundle="$2" target_version="$3" previous_bundle="$4"
  local previous_version="$5" engine="$6" source_root="$7"
  "$PYTHON_BIN" - "$path" "$target_bundle" "$target_version" "$previous_bundle" \
    "$previous_version" "$engine" "$source_root" <<'PY'
import json
import os
import sys
import tempfile
from pathlib import Path

path = Path(sys.argv[1])
value = {
    "schema_version": 1,
    "target_bundle_id": sys.argv[2],
    "target_project_version": sys.argv[3],
    "previous_bundle_id": sys.argv[4],
    "previous_project_version": sys.argv[5],
    "engine": sys.argv[6],
    "source_root": sys.argv[7],
}
fd, temporary = tempfile.mkstemp(prefix=".update.", dir=str(path.parent), text=True)
try:
    os.fchmod(fd, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8", newline="") as handle:
        json.dump(value, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary, path)
    path.chmod(0o600)
finally:
    try:
        os.unlink(temporary)
    except FileNotFoundError:
        pass
PY
}

restore_previous_state() {
  cp -p -- "$BACKUP_DIR/env" "$ENV_FILE"
  if [[ -f "$BACKUP_DIR/install-state.json" ]]; then
    cp -p -- "$BACKUP_DIR/install-state.json" "$STATE_FILE"
  else
    rm -f -- "$STATE_FILE"
  fi
}

restart_previous_service() {
  if [[ -n "$CURRENT_SOURCE_ROOT" && -x "$CURRENT_SOURCE_ROOT/deploy/quickstart/install.sh" && "$CURRENT_SOURCE_ROOT" != "$ROOT" ]]; then
    echo 'star-office-update: attempting service restart from the previous bundle.' >&2
    "$CURRENT_SOURCE_ROOT/deploy/quickstart/install.sh" --offline "--$ENGINE" --install-dir "$INSTALL_DIR" || true
  fi
}

rewrite_env() {
  local image="$1" engine="$2" bundle_id="$3" project_version="$4" source_root="$5"
  "$PYTHON_BIN" - "$INSTALL_DIR/.env" "$image" "$engine" "$bundle_id" "$project_version" "$source_root" <<'PY'
import os
import re
import shlex
import sys
import tempfile
from pathlib import Path

path = Path(sys.argv[1])
values = {
    "STAR_OFFICE_IMAGE": sys.argv[2],
    "STAR_OFFICE_ENGINE": sys.argv[3],
    "STAR_OFFICE_BUNDLE_ID": sys.argv[4],
    "STAR_OFFICE_VERSION": sys.argv[5],
    "STAR_OFFICE_SOURCE_ROOT": sys.argv[6],
    "OFFLINE_BUILD": "1",
}
existing = path.read_text(encoding="utf-8").splitlines()
output = []
seen = set()
for raw in existing:
    line = raw
    candidate = line.strip()
    if candidate.startswith("export "):
        candidate = candidate[7:].lstrip()
    name = candidate.split("=", 1)[0].strip() if "=" in candidate and not candidate.startswith("#") else ""
    if name in values and re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", name):
        output.append(name + "=" + shlex.quote(values[name]))
        seen.add(name)
    else:
        output.append(line)
if output and output[-1] != "":
    output.append("")
for name, value in values.items():
    if name not in seen:
        output.append(name + "=" + shlex.quote(value))
content = "\n".join(output).rstrip("\n") + "\n"
fd, temporary = tempfile.mkstemp(prefix=".env.update.", dir=str(path.parent), text=True)
try:
    os.fchmod(fd, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8", newline="") as handle:
        handle.write(content)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary, path)
    path.chmod(0o600)
finally:
    try:
        os.unlink(temporary)
    except FileNotFoundError:
        pass
PY
}

copy_mutable_assets() {
  local source_root="$1" destination="$2"
  "$PYTHON_BIN" - "$source_root" "$destination" <<'PY'
import os
import shutil
import sys
from pathlib import Path

source = Path(sys.argv[1])
destination = Path(sys.argv[2])
if not source.is_dir():
    raise SystemExit(0)
paths = []
for relative in (Path("assets/bg-history"), Path("assets/home-favorites")):
    directory = source / relative
    if directory.is_dir() and not directory.is_symlink():
        paths.extend(path for path in directory.rglob("*") if path.is_file() and not path.is_symlink())
frontend = source / "frontend"
if frontend.is_dir() and not frontend.is_symlink():
    for path in frontend.rglob("*"):
        if not path.is_file() or path.is_symlink():
            continue
        if path.name == "office_bg_small.webp" or path.suffix in {".bak", ".default"}:
            paths.append(path)
for path in paths:
    relative = path.relative_to(source)
    target = destination / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(path, target)
    target.chmod(0o644)
PY
}

restore_mutable_assets() {
  local source_root="$1" destination_root="$2"
  [[ -d "$source_root" ]] || return 0
  "$PYTHON_BIN" - "$source_root" "$destination_root" <<'PY'
import shutil
import sys
from pathlib import Path

source = Path(sys.argv[1])
destination = Path(sys.argv[2])
if not source.is_dir():
    raise SystemExit(0)
for path in source.rglob("*"):
    if not path.is_file() or path.is_symlink():
        continue
    relative = path.relative_to(source)
    target = destination / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(path, target)
    target.chmod(0o644)
PY
}

while (($#)); do
  case "$1" in
    --offline) OFFLINE=1; shift ;;
    --docker) ENGINE="docker"; shift ;;
    --native) ENGINE="native"; shift ;;
    --install-dir)
      [[ $# -ge 2 ]] || fail '--install-dir requires a value'
      INSTALL_DIR="$2"; shift 2 ;;
    --image)
      [[ $# -ge 2 ]] || fail '--image requires a value'
      IMAGE_OVERRIDE="$2"; shift 2 ;;
    --image-archive)
      [[ $# -ge 2 ]] || fail '--image-archive requires a value'
      IMAGE_ARCHIVE="$2"; shift 2 ;;
    --allow-downgrade) ALLOW_DOWNGRADE=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) fail "unknown option: $1" ;;
  esac
done

(( OFFLINE )) || fail 'offline update mode must be explicit; pass --offline'
if [[ -n "$IMAGE_OVERRIDE" && ! "$IMAGE_OVERRIDE" =~ ^[A-Za-z0-9._:@/-]+$ ]]; then
  fail 'target Docker image contains unsafe characters'
fi

[[ -x "$SCRIPT_DIR/verify_bundle.py" ]] || fail 'bundle verifier missing'
[[ -x "$SCRIPT_DIR/install.sh" ]] || fail 'bundle installer missing'
command -v "$PYTHON_BIN" >/dev/null 2>&1 || fail "Python unavailable: $PYTHON_BIN"
[[ -d "$INSTALL_DIR" ]] || fail "existing installation directory missing: $INSTALL_DIR"
ENV_FILE="$INSTALL_DIR/.env"
[[ -f "$ENV_FILE" && ! -L "$ENV_FILE" ]] || fail "private environment is missing: $ENV_FILE"
mode="$(stat -c '%a' "$ENV_FILE" 2>/dev/null || stat -f '%Lp' "$ENV_FILE" 2>/dev/null || true)"
[[ "$mode" == "600" || "$mode" == "400" ]] || fail "private environment must be mode 0600/0400"

manifest_json="$("$PYTHON_BIN" "$SCRIPT_DIR/verify_bundle.py" "$ROOT" --json)" || exit $?
bundle_info="$("$PYTHON_BIN" - "$manifest_json" <<'PY'
import json
import sys
value = json.loads(sys.argv[1])
print(value["bundle_id"])
print(value["project_version"])
print("1" if value.get("offline_wheelhouse") else "0")
print(value.get("offline_docker_image") or "")
PY
 )"
BUNDLE_ID="$(printf '%s\n' "$bundle_info" | sed -n '1p')"
PROJECT_VERSION="$(printf '%s\n' "$bundle_info" | sed -n '2p')"
HAS_WHEELHOUSE="$(printf '%s\n' "$bundle_info" | sed -n '3p')"
DECLARED_IMAGE="$(printf '%s\n' "$bundle_info" | sed -n '4p')"
[[ -n "$BUNDLE_ID" && -n "$PROJECT_VERSION" ]] || fail 'bundle metadata is incomplete'

STATE_FILE="$INSTALL_DIR/install-state.json"
CURRENT_BUNDLE=""
CURRENT_VERSION=""
CURRENT_ENGINE=""
CURRENT_SOURCE_ROOT=""
if [[ -f "$STATE_FILE" && ! -L "$STATE_FILE" ]]; then
  if ! state_info="$("$PYTHON_BIN" - "$STATE_FILE" <<'PY'
import json
import sys
from pathlib import Path
value = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
if not isinstance(value, dict):
    raise ValueError("install state must be a JSON object")
state = value
for key in ("bundle_id", "project_version", "engine", "source_root"):
    field = state.get(key, "")
    print(field if isinstance(field, str) else "")
PY
  )"; then
    fail "install state is invalid: $STATE_FILE"
  fi
  CURRENT_BUNDLE="$(printf '%s\n' "$state_info" | sed -n '1p')"
  CURRENT_VERSION="$(printf '%s\n' "$state_info" | sed -n '2p')"
  CURRENT_ENGINE="$(printf '%s\n' "$state_info" | sed -n '3p')"
  CURRENT_SOURCE_ROOT="$(printf '%s\n' "$state_info" | sed -n '4p')"
fi
if [[ -z "$CURRENT_BUNDLE" ]]; then CURRENT_BUNDLE="$(env_value STAR_OFFICE_BUNDLE_ID || true)"; fi
if [[ -z "$CURRENT_VERSION" ]]; then CURRENT_VERSION="$(env_value STAR_OFFICE_VERSION || true)"; fi
if [[ -z "$CURRENT_SOURCE_ROOT" ]]; then CURRENT_SOURCE_ROOT="$(env_value STAR_OFFICE_SOURCE_ROOT || true)"; fi
if [[ -z "$CURRENT_VERSION" && -n "$CURRENT_SOURCE_ROOT" && -f "$CURRENT_SOURCE_ROOT/VERSION" && ! -L "$CURRENT_SOURCE_ROOT/VERSION" ]]; then
  CURRENT_VERSION="$(tr -d '\r\n' < "$CURRENT_SOURCE_ROOT/VERSION")"
fi
if [[ -z "$CURRENT_ENGINE" ]]; then
  CURRENT_ENGINE="$(env_value STAR_OFFICE_ENGINE || true)"
fi
if [[ "$ENGINE" == auto && "$CURRENT_ENGINE" == docker ]]; then ENGINE="docker"; fi
if [[ "$ENGINE" == auto && "$CURRENT_ENGINE" == native ]]; then ENGINE="native"; fi
if [[ "$ENGINE" == auto ]]; then
  if [[ -f "$INSTALL_DIR/star-office.pid" || -f "$INSTALL_DIR/office-collector.pid" ]]; then
    ENGINE="native"
  elif compose_available; then
    ENGINE="docker"
  else
    ENGINE="native"
  fi
fi
[[ "$ENGINE" == docker || "$ENGINE" == native ]] || fail 'unable to determine existing installation engine; pass --docker or --native'

if [[ "$CURRENT_BUNDLE" == "$BUNDLE_ID" && "$CURRENT_VERSION" == "$PROJECT_VERSION" ]]; then
  echo "Star Office UI is already at $PROJECT_VERSION ($BUNDLE_ID); bundle verification passed."
  exit 0
fi

if (( ! ALLOW_DOWNGRADE )) && [[ "$CURRENT_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ && "$PROJECT_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  if ! "$PYTHON_BIN" - "$CURRENT_VERSION" "$PROJECT_VERSION" <<'PY'
import sys
def key(value):
    return tuple(int(part) for part in value.split("."))
raise SystemExit(0 if key(sys.argv[2]) >= key(sys.argv[1]) else 1)
PY
  then
    fail "target version $PROJECT_VERSION is lower than installed version $CURRENT_VERSION; use --allow-downgrade to override"
  fi
fi

if [[ "$ENGINE" == native && "$HAS_WHEELHOUSE" != 1 ]]; then
  fail 'offline native update requires a bundled Linux wheelhouse'
fi
if [[ "$ENGINE" == docker && "$HAS_WHEELHOUSE" != 1 && -z "$IMAGE_ARCHIVE" && -z "$DECLARED_IMAGE" ]]; then
  fail 'offline Docker update requires a wheelhouse or an image archive'
fi

if [[ -z "$IMAGE_ARCHIVE" && -n "$DECLARED_IMAGE" ]]; then
  IMAGE_ARCHIVE="$ROOT/images/$DECLARED_IMAGE"
fi
if [[ -n "$IMAGE_ARCHIVE" ]]; then
  [[ -f "$IMAGE_ARCHIVE" && ! -L "$IMAGE_ARCHIVE" ]] || fail "image archive missing: $IMAGE_ARCHIVE"
fi

OLD_IMAGE="$(env_value STAR_OFFICE_IMAGE || true)"
if [[ "$ENGINE" != docker ]]; then
  TARGET_IMAGE="${IMAGE_OVERRIDE:-star-office-ui:$BUNDLE_ID}"
elif [[ -n "$IMAGE_OVERRIDE" ]]; then
  TARGET_IMAGE="$IMAGE_OVERRIDE"
elif [[ -z "$OLD_IMAGE" || "$OLD_IMAGE" == "star-office-ui:bundle" || "$OLD_IMAGE" == star-office-ui:* ]]; then
  TARGET_IMAGE="star-office-ui:$BUNDLE_ID"
else
  fail "existing Docker image '$OLD_IMAGE' is not a Quickstart bundle tag; pass --image with the target tag"
fi

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p -- "$INSTALL_DIR/update-backups"
chmod 700 "$INSTALL_DIR/update-backups"
umask 077
BACKUP_DIR="$(mktemp -d "$INSTALL_DIR/update-backups/${STAMP}-${BUNDLE_ID}.XXXXXX")"
chmod 700 "$BACKUP_DIR"
cp -p -- "$ENV_FILE" "$BACKUP_DIR/env"
if [[ -f "$STATE_FILE" && ! -L "$STATE_FILE" ]]; then cp -p -- "$STATE_FILE" "$BACKUP_DIR/install-state.json"; fi
if [[ "$ENGINE" == native && -n "$CURRENT_SOURCE_ROOT" && -d "$CURRENT_SOURCE_ROOT" ]]; then
  copy_mutable_assets "$CURRENT_SOURCE_ROOT" "$BACKUP_DIR/mutable-assets"
fi
write_update_metadata "$BACKUP_DIR/update.json" "$BUNDLE_ID" "$PROJECT_VERSION" \
  "$CURRENT_BUNDLE" "$CURRENT_VERSION" "$ENGINE" "$CURRENT_SOURCE_ROOT"

rewrite_env "$TARGET_IMAGE" "$ENGINE" "$BUNDLE_ID" "$PROJECT_VERSION" "$ROOT"

INSTALL_ARGS=(--offline --install-dir "$INSTALL_DIR" "--$ENGINE" --image "$TARGET_IMAGE")
if [[ -n "$IMAGE_ARCHIVE" ]]; then INSTALL_ARGS+=(--image-archive "$IMAGE_ARCHIVE"); fi
if ! "$SCRIPT_DIR/install.sh" "${INSTALL_ARGS[@]}"; then
  restore_previous_state
  echo "star-office-update: update failed; previous environment restored from $BACKUP_DIR" >&2
  restart_previous_service
  exit 1
fi

if [[ "$ENGINE" == native && -d "$BACKUP_DIR/mutable-assets" ]]; then
  restore_mutable_assets "$BACKUP_DIR/mutable-assets" "$ROOT"
fi

PORT="$(env_value STAR_OFFICE_PORT || true)"
PORT="${PORT:-19000}"
HEALTH_HOST="$(env_value STAR_OFFICE_BIND || true)"
case "$HEALTH_HOST" in
  ""|0.0.0.0|::|"[::]") HEALTH_HOST="127.0.0.1" ;;
esac
if [[ "$HEALTH_HOST" == *:* && "$HEALTH_HOST" != \[*\] ]]; then
  URL="http://[$HEALTH_HOST]:$PORT"
else
  URL="http://$HEALTH_HOST:$PORT"
fi
if [[ "$(env_value OFFICE_ENABLED || true)" == "1" ]]; then
  VERIFY_ARGS=(--bundle "$ROOT" --url "$URL" --version "$PROJECT_VERSION" --sub2api)
else
  VERIFY_ARGS=(--bundle "$ROOT" --url "$URL" --version "$PROJECT_VERSION")
fi
if ! "$SCRIPT_DIR/verify.sh" --health-only "${VERIFY_ARGS[@]}"; then
  restore_previous_state
  echo "star-office-update: health/version readback failed; previous environment restored from $BACKUP_DIR" >&2
  restart_previous_service
  exit 1
fi

echo "Star Office UI offline update completed: $CURRENT_VERSION -> $PROJECT_VERSION ($BUNDLE_ID)."
echo "Update backup: $BACKUP_DIR"
