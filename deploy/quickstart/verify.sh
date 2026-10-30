#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'EOF'
usage: verify.sh [--bundle DIR] [--url URL] [--version VERSION] [--sub2api] [--health-only]

Checks the bundle checksum file when present and verifies /health. It never
changes containers, processes, data, or configuration.

--health-only skips the bundle checksum pass and only reads /health; the
updater uses this after native runtime caches or user assets are restored.
EOF
}

BUNDLE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PYTHON_BIN="${PYTHON_BIN:-python3}"
URL="${STAR_OFFICE_URL:-http://127.0.0.1:19000}"
SUB2API=0
EXPECTED_VERSION=""
CHECK_BUNDLE=1

while (($#)); do
  case "$1" in
    --bundle)
      [[ $# -ge 2 ]] || { usage; exit 2; }
      BUNDLE_ROOT="$(cd "$2" && pwd)"
      shift 2
      ;;
    --url)
      [[ $# -ge 2 ]] || { usage; exit 2; }
      URL="$2"
      shift 2
      ;;
    --version)
      [[ $# -ge 2 ]] || { usage; exit 2; }
      EXPECTED_VERSION="$2"
      shift 2
      ;;
    --sub2api)
      SUB2API=1
      shift
      ;;
    --health-only)
      CHECK_BUNDLE=0
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

if ((CHECK_BUNDLE)); then
  if [[ -f "$BUNDLE_ROOT/bundle-manifest.json" && -f "$BUNDLE_ROOT/deploy/quickstart/verify_bundle.py" ]]; then
    "$PYTHON_BIN" "$BUNDLE_ROOT/deploy/quickstart/verify_bundle.py" "$BUNDLE_ROOT"
  fi

  if [[ -f "$BUNDLE_ROOT/SHA256SUMS" ]]; then
    if command -v sha256sum >/dev/null 2>&1; then
      (cd "$BUNDLE_ROOT" && sha256sum -c SHA256SUMS)
    elif command -v shasum >/dev/null 2>&1; then
      while read -r expected file; do
        actual="$(shasum -a 256 "$BUNDLE_ROOT/$file" | awk '{print $1}')"
        [[ "$actual" == "$expected" ]] || {
          echo "checksum mismatch: $file" >&2
          exit 2
        }
      done < <(sed 's/  / /' "$BUNDLE_ROOT/SHA256SUMS")
    else
      echo 'checksum tool missing (sha256sum or shasum)' >&2
      exit 2
    fi
  fi
fi

if command -v curl >/dev/null 2>&1; then
  health_json="$(curl --fail --silent --show-error --max-time 8 "$URL/health")"
else
  health_json="$("$PYTHON_BIN" - "$URL/health" <<'PY'
import sys
from urllib.request import urlopen
with urlopen(sys.argv[1], timeout=8) as response:
    print(response.read().decode())
PY
)"
fi
printf '%s\n' "$health_json"
if [[ -n "$EXPECTED_VERSION" ]]; then
  "$PYTHON_BIN" - "$health_json" "$EXPECTED_VERSION" <<'PY'
import json
import sys
value = json.loads(sys.argv[1])
expected = sys.argv[2]
actual = value.get("version")
if actual != expected:
    raise SystemExit("health version mismatch: expected %s, got %s" % (expected, actual))
print("health version readback:", actual)
PY
fi

if ((SUB2API)); then
  if command -v curl >/dev/null 2>&1; then
    snapshot="$(curl --fail --silent --show-error --max-time 8 "$URL/api/office/snapshot")"
  else
    snapshot="$("$PYTHON_BIN" - "$URL/api/office/snapshot" <<'PY'
import sys
from urllib.request import urlopen
with urlopen(sys.argv[1], timeout=8) as response:
    print(response.read().decode())
PY
)"
  fi
  "$PYTHON_BIN" -c 'import json,sys; value=json.loads(sys.argv[1]); connection=value.get("source",{}).get("status") or value.get("connection",{}).get("status"); print("office snapshot status:", connection); raise SystemExit(0 if connection == "ok" else 3)' "$snapshot"
fi

echo 'Star Office UI health check passed.'
