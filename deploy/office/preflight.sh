#!/usr/bin/env bash
set -euo pipefail
# READ ONLY on the executing host. Never contacts the target or Sub2API.
[[ $# == 2 ]] || { echo 'usage: preflight.sh RELEASE_DIR PRIVATE_ENV' >&2; exit 2; }
release=$(cd "$1" && pwd)
env_file=$2
here="$release/deploy/office"
py=${OFFICE_HOST_PYTHON:-python3}
stop() { echo "STOP: $*" >&2; exit 2; }
command -v ss >/dev/null || stop 'ss unavailable; cannot verify port ownership'
listeners=$(ss -H -ltn) || stop 'cannot inspect listening ports'
for port in 19443 19011; do
    if printf '%s\n' "$listeners" | awk -v port="$port" '{n=split($4,a,":"); if(a[n]==port) busy=1} END {exit busy?0:1}'; then
        stop "port $port already listening; do not occupy, replace, stop its owner or choose another port"
    fi
done
for program in docker nginx openssl sha256sum "$py"; do command -v "$program" >/dev/null || stop "$program unavailable"; done
"$py" "$here/validate_release.py" verify "$release"
"$py" "$here/validate_release.py" gates "$release" "$env_file"
[[ ! -f "$release/wheelhouse/OFFLINE_WHEELS_REQUIRED.txt" ]] || stop 'wheelhouse missing'
image=$("$py" "$here/validate_release.py" value "$env_file" OFFICE_IMAGE)
docker image inspect "$image" >/dev/null 2>&1 || stop 'office image not built locally'
# Quiet only: compose config without --quiet can disclose signing secrets.
docker compose --env-file "$env_file" -f "$here/compose.yaml" config --quiet
# Port19001 belongs to an existing service and is intentionally never probed/changed.
cert_dir=/opt/star-office-ui/private
[[ -f "$cert_dir/office-server-chain.pem" && -f "$cert_dir/office-server.key" ]] || stop 'existing issued server certificate/key missing'
ca=$("$py" "$here/validate_release.py" value "$env_file" OFFICE_SERVER_CA_FILE)
openssl x509 -in "$cert_dir/office-server-chain.pem" -noout -checkip 192.168.100.221 >/dev/null || stop 'certificate IP SAN invalid'
openssl x509 -in "$cert_dir/office-server-chain.pem" -noout -checkend 86400 >/dev/null || stop 'certificate expiry too close'
openssl verify -CAfile "$ca" -untrusted "$cert_dir/office-server-chain.pem" "$cert_dir/office-server-chain.pem" >/dev/null || stop 'certificate chain verification failed'
certpub=$(openssl x509 -in "$cert_dir/office-server-chain.pem" -pubkey -noout | openssl pkey -pubin -outform DER | sha256sum | cut -d' ' -f1)
keypub=$(openssl pkey -passin pass: -in "$cert_dir/office-server.key" -pubout -outform DER | sha256sum | cut -d' ' -f1)
[[ "$certpub" == "$keypub" ]] || stop 'server key does not match certificate'
# A standalone syntax check does NOT alter or reload the installed nginx config.
docker run --rm --network none --entrypoint python "$image" -c 'import sys; assert sys.version_info[:2]==(3,11)'
nginx -t
# Test the candidate in its OWN temporary http context; do not replace a vhost.
temp=$(mktemp -d)
trap 'rm -rf -- "$temp"' EXIT
printf 'pid %s/nginx.pid; error_log %s/error.log; events {} http { include %s/nginx.conf; }\n' "$temp" "$temp" "$here" > "$temp/candidate.conf"
nginx -t -c "$temp/candidate.conf" -p "$temp/"
echo 'Preflight passed for FIRST installation only. Both existing/candidate nginx syntax checked. Client/TLS device acceptance remains a separate gate.'
