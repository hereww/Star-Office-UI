#!/usr/bin/env bash
set -euo pipefail

# One-click installer for the portable Star Office UI bundle.
# It supports Docker Compose and native Python, with explicit online/offline
# dependency modes. Secrets and mutable data live outside the release tree.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT_DIR="$ROOT/deploy/quickstart"
MODE="auto"
ENGINE="auto"
INSTALL_DIR="${STAR_OFFICE_INSTALL_DIR:-${HOME:-/tmp}/.star-office-ui}"
PORT="${STAR_OFFICE_PORT:-19000}"
BIND="${STAR_OFFICE_BIND:-0.0.0.0}"
IMAGE="${STAR_OFFICE_IMAGE:-star-office-ui:bundle}"
PYTHON_BASE="${PYTHON_BASE:-python:3.11-slim}"
IMAGE_ARCHIVE="${STAR_OFFICE_IMAGE_ARCHIVE:-}"
WITH_SUB2API=0
ALLOW_HTTP_SUB2API=0
ALLOW_HTTP_ADMIN=0
CONFIGURE_ARGS=()

usage() {
  cat <<'EOF'
Star Office UI portable installer

usage:
  deploy/quickstart/install.sh [options]

options:
  --online             Resolve dependencies from the configured package index.
  --offline            Never download; use bundled wheels or a loaded image.
  --docker             Require Docker Compose.
  --native             Require a local Python 3 installation.
  --install-dir DIR   Private env, log, PID and native venv directory.
  --port PORT         Published/listening port (default: 19000).
  --bind ADDRESS      Docker bind address or native listen address.
  --image TAG         Docker image tag (default: star-office-ui:bundle).
  --image-archive FILE
                       Offline Docker image archive created by docker save.
  --with-sub2api       Enable the integrated office collector and ask for the
                       Sub2API URL, installation ID, user scope, s2ut token,
                       CA bundle and office admin password.
  --allow-http-sub2api Allow an explicitly supplied http:// Sub2API origin.
  --allow-http-admin   Allow the Quickstart admin page over HTTP (LAN only).
  --sub2api-base-url URL
                       Pre-fill the Sub2API origin for --with-sub2api.
  --installation-id ID Pre-fill the numeric plugin installation ID.
  --user-ids IDS       Pre-fill a comma-separated user scope.
  --credential-expires-at ISO
                       Pre-fill the scoped credential expiry time.
  --token-file FILE    Read the hidden s2ut_ credential from a 0400/0600 file.
  --ca-file FILE       Use a PEM CA bundle for the Sub2API connection.
  --admin-password-file FILE
                       Read the office admin password from a 0400/0600 file.
  --admin-username NAME
                       Set the office admin username (default: admin).
  --non-interactive    Fail if required connection fields are missing.
  -h, --help          Show this help.

Examples:
  ./deploy/quickstart/install.sh --online --docker
  ./deploy/quickstart/install.sh --offline --docker
  ./deploy/quickstart/install.sh --offline --docker --with-sub2api
  ./deploy/quickstart/install.sh --offline --native --install-dir /opt/star-office-ui
EOF
}

fail() { echo "star-office-install: $*" >&2; exit 2; }

generate_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
  elif command -v python3 >/dev/null 2>&1; then
    python3 - <<'PY'
import secrets
print(secrets.token_hex(32))
PY
  else
    od -An -N32 -tx1 /dev/urandom | tr -d ' \n'
  fi
}

compose_available() {
  command -v docker >/dev/null 2>&1 || return 1
  docker compose version >/dev/null 2>&1 || command -v docker-compose >/dev/null 2>&1
}

compose() {
  if docker compose version >/dev/null 2>&1; then
    docker compose "$@"
  else
    docker-compose "$@"
  fi
}

stop_pid_file() {
  local pid_file="$1"
  if [[ -f "$pid_file" ]]; then
    local pid
    pid="$(cat "$pid_file" 2>/dev/null || true)"
    if [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" || true
      for _ in {1..20}; do
        kill -0 "$pid" 2>/dev/null || break
        sleep 0.25
      done
    fi
    rm -f -- "$pid_file"
  fi
}

seed_docker_file() {
  local volume="$1" source_file="$2" target_file="$3" mode="$4"
  [[ -f "$source_file" && ! -L "$source_file" ]] || fail "private file missing: $source_file"
  docker volume create "$volume" >/dev/null
  docker run --rm --user 0:0 --entrypoint /bin/sh \
    --mount "type=volume,src=$volume,dst=/target" \
    --mount "type=bind,src=$source_file,dst=/source,readonly" \
    "$IMAGE" -c "rm -f /target/$target_file && cp /source /target/$target_file && chown 10001:10001 /target/$target_file && chmod $mode /target/$target_file"
}

while (($#)); do
  case "$1" in
    --online) MODE="online"; shift ;;
    --offline) MODE="offline"; shift ;;
    --docker) ENGINE="docker"; shift ;;
    --native) ENGINE="native"; shift ;;
    --install-dir)
      [[ $# -ge 2 ]] || fail '--install-dir requires a value'
      INSTALL_DIR="$2"
      shift 2
      ;;
    --port)
      [[ $# -ge 2 ]] || fail '--port requires a value'
      PORT="$2"
      shift 2
      ;;
    --bind)
      [[ $# -ge 2 ]] || fail '--bind requires a value'
      BIND="$2"
      shift 2
      ;;
    --image)
      [[ $# -ge 2 ]] || fail '--image requires a value'
      IMAGE="$2"
      shift 2
      ;;
    --image-archive)
      [[ $# -ge 2 ]] || fail '--image-archive requires a value'
      IMAGE_ARCHIVE="$2"
      shift 2
      ;;
    --with-sub2api) WITH_SUB2API=1; shift ;;
    --allow-http-sub2api) ALLOW_HTTP_SUB2API=1; shift ;;
    --allow-http-admin) ALLOW_HTTP_ADMIN=1; shift ;;
    --sub2api-base-url)
      [[ $# -ge 2 ]] || fail '--sub2api-base-url requires a value'
      WITH_SUB2API=1; CONFIGURE_ARGS+=(--sub2api-base-url "$2"); shift 2 ;;
    --installation-id)
      [[ $# -ge 2 ]] || fail '--installation-id requires a value'
      WITH_SUB2API=1; CONFIGURE_ARGS+=(--installation-id "$2"); shift 2 ;;
    --user-ids)
      [[ $# -ge 2 ]] || fail '--user-ids requires a value'
      WITH_SUB2API=1; CONFIGURE_ARGS+=(--user-ids "$2"); shift 2 ;;
    --credential-expires-at)
      [[ $# -ge 2 ]] || fail '--credential-expires-at requires a value'
      WITH_SUB2API=1; CONFIGURE_ARGS+=(--credential-expires-at "$2"); shift 2 ;;
    --token-file)
      [[ $# -ge 2 ]] || fail '--token-file requires a value'
      WITH_SUB2API=1; CONFIGURE_ARGS+=(--token-file "$2"); shift 2 ;;
    --ca-file)
      [[ $# -ge 2 ]] || fail '--ca-file requires a value'
      WITH_SUB2API=1; CONFIGURE_ARGS+=(--ca-file "$2"); shift 2 ;;
    --admin-password-file)
      [[ $# -ge 2 ]] || fail '--admin-password-file requires a value'
      WITH_SUB2API=1; CONFIGURE_ARGS+=(--admin-password-file "$2"); shift 2 ;;
    --admin-username)
      [[ $# -ge 2 ]] || fail '--admin-username requires a value'
      WITH_SUB2API=1; CONFIGURE_ARGS+=(--admin-username "$2"); shift 2 ;;
    --non-interactive)
      WITH_SUB2API=1; CONFIGURE_ARGS+=(--non-interactive); shift ;;
    -h|--help) usage; exit 0 ;;
    *) fail "unknown option: $1" ;;
  esac
done

[[ "$PORT" =~ ^[0-9]+$ ]] && ((PORT >= 1 && PORT <= 65535)) || fail "invalid port: $PORT"
[[ "$BIND" != *$'\n'* && "$BIND" != *$'\r'* ]] || fail 'invalid bind address'

if [[ "$ENGINE" == auto ]]; then
  if compose_available; then ENGINE="docker"; else ENGINE="native"; fi
fi
if [[ "$MODE" == auto ]]; then MODE="online"; fi
if [[ "$ENGINE" == docker ]] && ! compose_available; then
  fail 'Docker Compose is unavailable; install Docker or use --native'
fi

if ((WITH_SUB2API)) && ! command -v python3 >/dev/null 2>&1; then
  fail '--with-sub2api requires a local python3 for hidden credential/password prompts'
fi

mkdir -p -- "$INSTALL_DIR"
chmod 700 "$INSTALL_DIR"
ENV_FILE="$INSTALL_DIR/.env"
umask 077
if [[ ! -e "$ENV_FILE" ]]; then
  cat > "$ENV_FILE" <<EOF
STAR_OFFICE_IMAGE=$IMAGE
STAR_OFFICE_PORT=$PORT
STAR_OFFICE_BIND=$BIND
STAR_OFFICE_VOLUME=star-office-ui-data
STAR_OFFICE_ASSETS_VOLUME=star-office-ui-assets
STAR_OFFICE_ADMIN_VOLUME=star-office-ui-admin-secret
STAR_OFFICE_CONSUMER_VOLUME=star-office-ui-consumer-secret
STAR_OFFICE_TRUST_VOLUME=star-office-ui-upstream-trust
STAR_OFFICE_ENV=production
OFFICE_ENABLED=0
OFFICE_RELEASE_ID=quickstart
OFFICE_USER_IDS=1,4,7,8
OFFICE_ADMIN_ALLOW_HTTP=0
PYTHON_BASE=$PYTHON_BASE
OFFLINE_BUILD=$([[ "$MODE" == offline ]] && printf 1 || printf 0)
FLASK_SECRET_KEY=$(generate_secret)
ASSET_DRAWER_PASS=$(generate_secret)
EOF
  chmod 600 "$ENV_FILE"
else
  [[ -f "$ENV_FILE" && ! -L "$ENV_FILE" ]] || fail "private env is not a regular file: $ENV_FILE"
  chmod 600 "$ENV_FILE"
fi

# The optional configuration wizard is deliberately outside the release tree's
# mutable data. It writes the token/hash/CA to 0600/0644 private files and only
# puts paths and non-secret metadata in .env.
if ((WITH_SUB2API)); then
  CONFIGURE_ARGS=(--install-dir "$INSTALL_DIR" "${CONFIGURE_ARGS[@]}")
  ((ALLOW_HTTP_SUB2API)) && CONFIGURE_ARGS+=(--allow-http-sub2api)
  ((ALLOW_HTTP_ADMIN)) && CONFIGURE_ARGS+=(--allow-http-admin)
  python3 "$SCRIPT_DIR/configure_sub2api.py" "${CONFIGURE_ARGS[@]}"
fi

# Read the private env without printing it. Generated values are deliberately
# simple shell assignments so Docker Compose and native mode share one source.
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a
IMAGE="${STAR_OFFICE_IMAGE:-$IMAGE}"
PORT="${STAR_OFFICE_PORT:-$PORT}"
BIND="${STAR_OFFICE_BIND:-$BIND}"
PYTHON_BASE="${PYTHON_BASE:-$PYTHON_BASE}"
STAR_OFFICE_VOLUME="${STAR_OFFICE_VOLUME:-star-office-ui-data}"
STAR_OFFICE_ASSETS_VOLUME="${STAR_OFFICE_ASSETS_VOLUME:-star-office-ui-assets}"
STAR_OFFICE_ADMIN_VOLUME="${STAR_OFFICE_ADMIN_VOLUME:-star-office-ui-admin-secret}"
STAR_OFFICE_CONSUMER_VOLUME="${STAR_OFFICE_CONSUMER_VOLUME:-star-office-ui-consumer-secret}"
STAR_OFFICE_TRUST_VOLUME="${STAR_OFFICE_TRUST_VOLUME:-star-office-ui-upstream-trust}"
: "${FLASK_SECRET_KEY:?private env is missing FLASK_SECRET_KEY}"
: "${ASSET_DRAWER_PASS:?private env is missing ASSET_DRAWER_PASS}"
INTEGRATED="${OFFICE_ENABLED:-0}"
[[ "$INTEGRATED" == "0" || "$INTEGRATED" == "1" ]] || fail 'OFFICE_ENABLED must be 0 or 1'
if [[ "$INTEGRATED" == "1" ]]; then
  [[ -n "${OFFICE_SUB2API_BASE_URL:-}" ]] || fail 'integrated mode is missing OFFICE_SUB2API_BASE_URL; rerun with --with-sub2api'
  [[ -n "${OFFICE_CONSUMER_FILE:-}" && -f "$OFFICE_CONSUMER_FILE" && ! -L "$OFFICE_CONSUMER_FILE" ]] \
    || fail 'integrated mode is missing the private Sub2API credential file'
  [[ -n "${OFFICE_UPSTREAM_CA_FILE:-}" && -f "$OFFICE_UPSTREAM_CA_FILE" && ! -L "$OFFICE_UPSTREAM_CA_FILE" ]] \
    || fail 'integrated mode is missing the private upstream CA bundle'
  [[ -n "${OFFICE_ADMIN_PASSWORD_HASH_FILE:-}" && -f "$OFFICE_ADMIN_PASSWORD_HASH_FILE" && ! -L "$OFFICE_ADMIN_PASSWORD_HASH_FILE" ]] \
    || fail 'integrated mode is missing the private office admin password hash'
  ADMIN_SECRET="${OFFICE_ADMIN_SECRET:-}"
  [[ "$ADMIN_SECRET" != *$'\n'* && ${#ADMIN_SECRET} -ge 24 ]] \
    || fail 'integrated mode requires a strong independent OFFICE_ADMIN_SECRET'
fi
if [[ "$MODE" == offline ]]; then
  export OFFLINE_BUILD=1
else
  export OFFLINE_BUILD=0
fi

if [[ "$ENGINE" == docker ]]; then
  command -v docker >/dev/null 2>&1 || fail 'docker command unavailable'
  if [[ "$MODE" == offline ]]; then
    if [[ -n "$IMAGE_ARCHIVE" ]]; then
      [[ -f "$IMAGE_ARCHIVE" && ! -L "$IMAGE_ARCHIVE" ]] || fail "image archive missing: $IMAGE_ARCHIVE"
      docker load --input "$IMAGE_ARCHIVE" >/dev/null
    fi
    if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
      [[ -d "$ROOT/wheelhouse" ]] || fail 'offline bundle has no wheelhouse directory and no loaded image'
      docker image inspect "$PYTHON_BASE" >/dev/null 2>&1 || fail "offline base image is not cached: $PYTHON_BASE"
      find "$ROOT/wheelhouse" -maxdepth 1 -type f -name '*.whl' -print -quit | grep -q . \
        || fail 'offline wheelhouse contains no wheels'
      compose --project-directory "$ROOT" --env-file "$ENV_FILE" \
        -f "$SCRIPT_DIR/docker-compose.yml" build --no-cache --pull=false
    fi
  else
    compose --project-directory "$ROOT" --env-file "$ENV_FILE" \
      -f "$SCRIPT_DIR/docker-compose.yml" build --no-cache --pull
  fi
  if [[ "$INTEGRATED" == "1" ]]; then
    seed_docker_file "${STAR_OFFICE_ADMIN_VOLUME}" "$OFFICE_ADMIN_PASSWORD_HASH_FILE" office_admin_hash 600
    seed_docker_file "${STAR_OFFICE_CONSUMER_VOLUME}" "$OFFICE_CONSUMER_FILE" office_consumer 600
    seed_docker_file "${STAR_OFFICE_TRUST_VOLUME}" "$OFFICE_UPSTREAM_CA_FILE" upstream-ca.pem 644
    compose --project-directory "$ROOT" --env-file "$ENV_FILE" --profile sub2api \
      -f "$SCRIPT_DIR/docker-compose.yml" up -d --no-build --remove-orphans
  else
    compose --project-directory "$ROOT" --env-file "$ENV_FILE" \
      -f "$SCRIPT_DIR/docker-compose.yml" up -d --no-build --remove-orphans
  fi
  echo "Star Office UI is running at http://$BIND:$PORT/"
  if [[ "$INTEGRATED" == "1" ]]; then
    echo "Sub2API collector is enabled; office snapshot is collected server-side."
  fi
  echo "Private deployment state: $INSTALL_DIR"
  exit 0
fi

command -v python3 >/dev/null 2>&1 || fail 'python3 is unavailable; use --docker or install Python 3'
PYTHON_BIN="$(command -v python3)"
if [[ "$MODE" == offline ]]; then
  [[ -d "$ROOT/wheelhouse" ]] || fail 'offline native install has no wheelhouse directory'
  "$PYTHON_BIN" -c 'import sys; raise SystemExit(0 if sys.version_info[:2] == (3, 11) else 1)' \
    || fail 'offline native install requires Python 3.11 for the bundled Linux wheels'
fi
VENV="$INSTALL_DIR/.venv"
if [[ ! -x "$VENV/bin/python" ]]; then
  "$PYTHON_BIN" -m venv "$VENV" || fail 'unable to create Python virtual environment'
fi
if [[ "$MODE" == offline ]]; then
  "$VENV/bin/python" -m pip install --no-index --find-links "$ROOT/wheelhouse" \
    -r "$SCRIPT_DIR/requirements.txt"
else
  "$VENV/bin/python" -m pip install --no-cache-dir -r "$SCRIPT_DIR/requirements.txt"
fi

mkdir -p -- "$INSTALL_DIR/data"
PID_FILE="$INSTALL_DIR/star-office.pid"
LOG_FILE="$INSTALL_DIR/star-office.log"
COLLECTOR_PID_FILE="$INSTALL_DIR/office-collector.pid"
COLLECTOR_LOG_FILE="$INSTALL_DIR/office-collector.log"
stop_pid_file "$PID_FILE"
stop_pid_file "$COLLECTOR_PID_FILE"

OFFICE_ADMIN_PASSWORD_HASH=""
if [[ "$INTEGRATED" == "1" ]]; then
  OFFICE_ADMIN_PASSWORD_HASH="$(cat "$OFFICE_ADMIN_PASSWORD_HASH_FILE")"
fi

nohup env STAR_OFFICE_DATA_DIR="$INSTALL_DIR/data" \
  STAR_OFFICE_ENV="${STAR_OFFICE_ENV:-production}" \
  OFFICE_ENABLED="${OFFICE_ENABLED:-0}" \
  OFFICE_DATA_DIR="$INSTALL_DIR/data" \
  OFFICE_USER_IDS="${OFFICE_USER_IDS:-1,4,7,8}" \
  OFFICE_RELEASE_ID="${OFFICE_RELEASE_ID:-quickstart}" \
  OFFICE_ADMIN_USERNAME="${OFFICE_ADMIN_USERNAME:-admin}" \
  OFFICE_ADMIN_SECRET="${OFFICE_ADMIN_SECRET:-}" \
  OFFICE_ADMIN_PASSWORD_HASH="$OFFICE_ADMIN_PASSWORD_HASH" \
  OFFICE_ADMIN_ALLOW_HTTP="${OFFICE_ADMIN_ALLOW_HTTP:-0}" \
  FLASK_SECRET_KEY="$FLASK_SECRET_KEY" \
  ASSET_DRAWER_PASS="$ASSET_DRAWER_PASS" \
  "$VENV/bin/gunicorn" --chdir "$ROOT/backend" --bind "$BIND:$PORT" \
  --workers 2 --threads 4 --timeout 60 --access-logfile - --error-logfile - app:app \
  >"$LOG_FILE" 2>&1 &
echo $! > "$PID_FILE"
chmod 600 "$PID_FILE" "$LOG_FILE"
sleep 2
pid="$(cat "$PID_FILE")"
kill -0 "$pid" 2>/dev/null || { tail -n 40 "$LOG_FILE" >&2; fail 'native service exited during startup'; }
if [[ "$INTEGRATED" == "1" ]]; then
  nohup env STAR_OFFICE_ENV="${STAR_OFFICE_ENV:-production}" \
    OFFICE_DATA_DIR="$INSTALL_DIR/data" \
    OFFICE_SUB2API_BASE_URL="$OFFICE_SUB2API_BASE_URL" \
    OFFICE_ALLOW_HTTP="${OFFICE_ALLOW_HTTP:-0}" \
    OFFICE_CREDENTIAL_FILE="$OFFICE_CONSUMER_FILE" \
    OFFICE_INSTALLATION_ID="$OFFICE_INSTALLATION_ID" \
    OFFICE_USER_IDS="$OFFICE_USER_IDS" \
    OFFICE_CREDENTIAL_EXPIRES_AT="$OFFICE_CREDENTIAL_EXPIRES_AT" \
    SSL_CERT_FILE="$OFFICE_UPSTREAM_CA_FILE" \
    "$VENV/bin/python" "$ROOT/backend/office_collector.py" --data-dir "$INSTALL_DIR/data" \
    >"$COLLECTOR_LOG_FILE" 2>&1 &
  echo $! > "$COLLECTOR_PID_FILE"
  chmod 600 "$COLLECTOR_PID_FILE" "$COLLECTOR_LOG_FILE"
  sleep 1
  collector_pid="$(cat "$COLLECTOR_PID_FILE")"
  kill -0 "$collector_pid" 2>/dev/null || { tail -n 40 "$COLLECTOR_LOG_FILE" >&2; fail 'native collector exited during startup'; }
fi
echo "Star Office UI is running at http://$BIND:$PORT/"
if [[ "$INTEGRATED" == "1" ]]; then
  echo "Sub2API collector is enabled; office snapshot is collected server-side."
fi
echo "Private deployment state: $INSTALL_DIR"
