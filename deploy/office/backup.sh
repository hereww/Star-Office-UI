#!/usr/bin/env bash
set -euo pipefail
# Backup an ALREADY DEPLOYED production-office release, not the unknown legacy host.
# Only stops the two named services in this exact compose project.
[[ $# == 5 && "$5" == --confirm-office-stop ]] || {
  echo 'usage: backup.sh CURRENT_RELEASE CURRENT_PRIVATE_ENV NEW_BACKUP_DIR CURRENT_NGINX_CONF --confirm-office-stop' >&2; exit 2;
}
release=$(cd "$1" && pwd)
env_file=$2
backup=$3
nginx_conf=$4
here="$release/deploy/office"
py=${OFFICE_HOST_PYTHON:-python3}
"$py" "$here/validate_release.py" verify "$release"
"$py" "$here/validate_release.py" env "$release" "$env_file"
[[ ! -e "$backup" && -f "$nginx_conf" && ! -L "$nginx_conf" ]] || { echo 'STOP: backup destination exists or nginx file unverified' >&2; exit 2; }
image=$("$py" "$here/validate_release.py" value "$env_file" OFFICE_IMAGE)
image_id=$(docker image inspect --format '{{.Id}}' "$image")
for volume in star-office-production-office-data star-office-production-legacy-data; do
  docker volume inspect "$volume" >/dev/null
  # A stopped write boundary is mandatory; never archive a live SQLite WAL copy.
done
umask 077
mkdir -m 700 -- "$backup"
backup=$(cd "$backup" && pwd)
cp -- "$env_file" "$backup/office.env"
cp -- "$nginx_conf" "$backup/nginx.conf"
chmod 600 "$backup/office.env" "$backup/nginx.conf"
docker compose --env-file "$env_file" -f "$here/compose.yaml" stop office-web office-collector
for volume in star-office-production-office-data star-office-production-legacy-data; do
  [[ -z $(docker ps -q --filter "volume=$volume") ]] || {
    echo 'STOP: another running container still uses office data; do not stop it automatically' >&2; exit 2;
  }
done
for pair in 'star-office-production-office-data:office-data.tar.gz' 'star-office-production-legacy-data:legacy-data.tar.gz'; do
  volume=${pair%%:*}; file=${pair#*:}
  docker run --rm --network none --user 10001:10001 --read-only \
    --cap-drop ALL --security-opt no-new-privileges:true --tmpfs /tmp:rw,nosuid,nodev,noexec,size=128m \
    --entrypoint python --mount "type=volume,src=$volume,dst=/backup-data,readonly" "$image" \
    /app/deploy/office/volume_archive.py backup /backup-data - > "$backup/$file"
done
"$py" - "$backup" "$release" "$image_id" <<'PY'
import hashlib, json, sys
from pathlib import Path
backup, release = Path(sys.argv[1]), Path(sys.argv[2])
files = ('office.env', 'nginx.conf', 'office-data.tar.gz', 'legacy-data.tar.gz')
hashfile = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
value = {'schema_version':1, 'release_dir':str(release), 'image_id':sys.argv[3],
         'release_manifest_sha256':hashfile(release/'release-manifest.json'),
         'checksums':{name:hashfile(backup/name) for name in files}}
(backup/'backup-manifest.json').write_text(json.dumps(value, indent=2)+'\n')
(backup/'backup-manifest.json').chmod(0o600)
PY
echo 'Restricted backup completed; only office services were stopped. Verify restore in temporary volumes before setting OFFICE_BACKUP_VERIFIED=1. Resume the same office release explicitly if not cutting over.'
