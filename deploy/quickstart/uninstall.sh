#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
INSTALL_DIR="${STAR_OFFICE_INSTALL_DIR:-${HOME:-/tmp}/.star-office-ui}"
ENV_FILE="$INSTALL_DIR/.env"
PURGE=0

usage() {
  cat >&2 <<'EOF'
usage: uninstall.sh [--install-dir DIR] [--purge]

Stops the Docker/native service. --purge also deletes the named Docker volume
or native data directory and is intentionally explicit.
EOF
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

while (($#)); do
  case "$1" in
    --install-dir)
      [[ $# -ge 2 ]] || { usage; exit 2; }
      INSTALL_DIR="$2"
      shift 2
      ;;
    --purge)
      PURGE=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "unknown option: $1" >&2
      usage
      exit 2
      ;;
  esac
done

if command -v docker >/dev/null 2>&1 && { docker compose version >/dev/null 2>&1 || command -v docker-compose >/dev/null 2>&1; }; then
  if [[ -f "$ENV_FILE" ]]; then
    if docker compose version >/dev/null 2>&1; then
      docker compose --project-directory "$ROOT" --env-file "$ENV_FILE" \
        -f "$ROOT/deploy/quickstart/docker-compose.yml" down --remove-orphans
    else
      docker-compose --project-directory "$ROOT" --env-file "$ENV_FILE" \
        -f "$ROOT/deploy/quickstart/docker-compose.yml" down --remove-orphans
    fi
    if ((PURGE)); then
      volume="$(sed -n 's/^STAR_OFFICE_VOLUME=//p' "$ENV_FILE" | tail -n 1)"
      if [[ -n "$volume" ]]; then
        docker volume rm "$volume" >/dev/null 2>&1 || true
      fi
      assets_volume="$(sed -n 's/^STAR_OFFICE_ASSETS_VOLUME=//p' "$ENV_FILE" | tail -n 1)"
      if [[ -n "$assets_volume" ]]; then
        docker volume rm "$assets_volume" >/dev/null 2>&1 || true
      fi
      for key in STAR_OFFICE_ADMIN_VOLUME STAR_OFFICE_CONSUMER_VOLUME STAR_OFFICE_TRUST_VOLUME; do
        volume="$(sed -n "s/^${key}=//p" "$ENV_FILE" | tail -n 1 | sed "s/^['\"]//; s/['\"]$//")"
        if [[ -n "$volume" ]]; then
          docker volume rm "$volume" >/dev/null 2>&1 || true
        fi
      done
    fi
  fi
fi

stop_pid_file "$INSTALL_DIR/star-office.pid"
stop_pid_file "$INSTALL_DIR/office-collector.pid"

if ((PURGE)); then
  rm -rf -- "$INSTALL_DIR/data" "$INSTALL_DIR/.venv"
fi

echo 'Star Office UI service stopped.'
