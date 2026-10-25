#!/usr/bin/env bash
set -euo pipefail
# Local/target offline build only, no SSH, pull, pip downloads, registry requests.
[[ $# == 2 ]] || { echo "usage: build_offline.sh RELEASE_DIR PRIVATE_ENV" >&2; exit 2; }
release=$(cd "$1" && pwd)
env_file=$2
here="$release/deploy/office"
py=${OFFICE_HOST_PYTHON:-python3}
"$py" "$here/validate_release.py" verify "$release"
"$py" "$here/validate_release.py" env "$release" "$env_file"
[[ -d "$release/wheelhouse" && ! -f "$release/wheelhouse/OFFLINE_WHEELS_REQUIRED.txt" ]] || { echo 'STOP: curated Linux CPython3.11 wheelhouse missing' >&2; exit 2; }
command -v docker >/dev/null || { echo 'STOP: docker unavailable; artifact delivery only' >&2; exit 2; }
image=$("$py" "$here/validate_release.py" value "$env_file" OFFICE_IMAGE)
base=$("$py" "$here/validate_release.py" value "$env_file" PYTHON_BASE)
docker image inspect "$base" >/dev/null 2>&1 || { echo 'STOP: specified Python base is not cached; no automatic pull' >&2; exit 2; }
if docker image inspect "$image" >/dev/null 2>&1; then
    echo 'STOP: immutable release image tag already exists; never replace it' >&2; exit 2
fi
# A streamed context avoids target BuildKit local-context reuse across immutable
# releases with normalized archive times/equal-size edits. The manifest in the
# image is still verified, so a stale/wrong payload always fails closed.
tar -C "$release" -cf - . | docker build --no-cache --pull=false --network=none \
    --build-arg "PYTHON_BASE=$base" --file deploy/office/Dockerfile --tag "$image" -
docker run --rm --network none --entrypoint python "$image" /app/deploy/office/verify_image.py
echo 'Offline image built. Docker/runtime/TLS acceptance is still required.'
