#!/usr/bin/env bash
set -euo pipefail
# This restores prior PRODUCTION-OFFICE state only. First-cutover legacy rollback
# must use its verified original image/config/mounts (documented in README).
[[ $# == 5 && "$5" == --confirm-office-stop ]] || {
  echo 'usage: rollback.sh CURRENT_RELEASE CURRENT_PRIVATE_ENV VERIFIED_BACKUP CURRENT_NGINX_CONF --confirm-office-stop' >&2; exit 2;
}
current=$(cd "$1" && pwd)
current_env=$2
backup=$(cd "$3" && pwd)
nginx_conf=$4
here="$current/deploy/office"
py=${OFFICE_HOST_PYTHON:-python3}
"$py" "$here/validate_release.py" verify "$current"
# Before any mutation, validate backup integrity, retained source release and image.
previous=$("$py" - "$backup" <<'PY'
import hashlib,json,sys
from pathlib import Path
b=Path(sys.argv[1]); m=json.loads((b/'backup-manifest.json').read_text())
expected={'office.env','nginx.conf','office-data.tar.gz','legacy-data.tar.gz'}
assert m['schema_version']==1 and set(m['checksums'])==expected
for name,h in m['checksums'].items():
 p=b/name; assert not p.is_symlink() and hashlib.sha256(p.read_bytes()).hexdigest()==h
r=Path(m['release_dir']); assert r.is_absolute() and not r.is_symlink()
assert hashlib.sha256((r/'release-manifest.json').read_bytes()).hexdigest()==m['release_manifest_sha256']
print(r)
PY
)
"$py" "$here/validate_release.py" verify "$previous"
"$py" "$here/validate_release.py" env "$previous" "$backup/office.env"
image=$("$py" "$here/validate_release.py" value "$backup/office.env" OFFICE_IMAGE)
expected_id=$("$py" -c 'import json,sys; print(json.load(open(sys.argv[1]))["image_id"])' "$backup/backup-manifest.json")
[[ $(docker image inspect --format '{{.Id}}' "$image") == "$expected_id" ]] || { echo 'STOP: previous image missing or tag changed; no pull' >&2; exit 2; }
[[ -f "$nginx_conf" && ! -L "$nginx_conf" ]] || { echo 'STOP: current nginx config is not a regular file' >&2; exit 2; }
for volume in star-office-production-office-data star-office-production-legacy-data; do docker volume inspect "$volume" >/dev/null; done
# Preserve current configuration and data FIRST; never destroy the only copy.
safety="$backup/pre-rollback-$(date +%Y%m%dT%H%M%S)"
"$here/backup.sh" "$current" "$current_env" "$safety" "$nginx_conf" --confirm-office-stop
for pair in 'star-office-production-office-data:office-data.tar.gz' 'star-office-production-legacy-data:legacy-data.tar.gz'; do
  volume=${pair%%:*}; file=${pair#*:}
  docker run --rm -i --network none --user 10001:10001 --read-only \
    --cap-drop ALL --security-opt no-new-privileges:true --tmpfs /tmp:rw,nosuid,nodev,noexec,size=128m \
    --entrypoint python --mount "type=volume,src=$volume,dst=/restore-data" "$image" \
    /app/deploy/office/volume_archive.py restore - /restore-data < "$backup/$file"
done
# Restore env atomically, preserving private permissions; secret files stay put.
install -m 600 "$backup/office.env" "${current_env}.rollback-new"
mv -f -- "${current_env}.rollback-new" "$current_env"
install -m 600 "$backup/nginx.conf" "${nginx_conf}.rollback-new"
mv -f -- "${nginx_conf}.rollback-new" "$nginx_conf"
nginx -t  # On failure STOP without reload; restricted safety backup remains.
docker compose --env-file "$current_env" -f "$previous/deploy/office/compose.yaml" up -d --no-build --pull never office-web office-collector
nginx -s reload  # Only syntax validation + graceful reload. Never restart shared services.
echo 'Prior office release/data restored. Check health, public privacy, TLS login, collector reset and client compatibility before declaring rollback verified.'
