#!/usr/bin/env python3
"""Guarded CODE-ONLY rollback; default --check does not change live services.
Never restores data volumes or old credentials. Mutation requires explicit flag.
Compatible with the verified server Python 3.6. Invoke using python3 -B.
"""
import sys
sys.dont_write_bytecode = True
import argparse, datetime, fcntl, hashlib, json, os, pathlib, shutil
import ssl, subprocess, tempfile, time, urllib.request
os.umask(0o077)
ROOT = pathlib.Path('/opt/star-office-ui')
OLD_ID = 'office-20261006-v5-production-06'
NEW_ID = 'office-v5-short-status-04'
OLD = ROOT / 'releases' / OLD_ID
NEW = ROOT / 'releases' / NEW_ID
BACKUP = pathlib.Path('/home/star-office-backups/20261007-before-short-status-04')
ENV = ROOT / 'private/office.env'
INGRESS = ROOT / 'ingress/nginx.conf'
LOCK = ROOT / 'private/office-deploy.lock'
NGINX = '/www/server/nginx/sbin/nginx'
OFFICE = ('star-office-production-office-web-1', 'star-office-production-office-collector-1')
sys.path.insert(0, str(OLD / 'deploy/office'))
import validate_release as validator


def run(args, capture=False):
    args = [str(a) for a in args]
    if capture:
        return subprocess.check_output(args, universal_newlines=True).strip()
    subprocess.check_call(args)


def sha(path):
    h = hashlib.sha256()
    with pathlib.Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(1048576), b''):
            h.update(block)
    return h.hexdigest()


def load(path):
    return json.loads(pathlib.Path(path).read_text())


def compose(release, *args):
    run(['docker', 'compose', '--env-file', ENV, '-f', release / 'deploy/office/compose.yaml'] + list(args))


def render_env(text, release_id, image_tag):
    lines = text.splitlines()
    for key, value in (('OFFICE_RELEASE_ID', release_id), ('OFFICE_IMAGE', image_tag)):
        indices = [i for i, line in enumerate(lines) if line.startswith(key + '=')]
        if len(indices) != 1:
            raise RuntimeError('expected exactly one ' + key)
        lines[indices[0]] = key + '=' + value
    return '\n'.join(lines) + '\n'


def atomic_copy(source, dest, mode):
    dest = pathlib.Path(dest)
    if dest.is_symlink():
        raise RuntimeError('refusing symlink destination')
    fd, name = tempfile.mkstemp(prefix=dest.name + '.code-rollback-', dir=str(dest.parent))
    try:
        with os.fdopen(fd, 'wb') as target, pathlib.Path(source).open('rb') as src:
            shutil.copyfileobj(src, target)
        os.chmod(name, mode)
        os.replace(name, str(dest))
    finally:
        if os.path.exists(name): os.unlink(name)


def containers():
    ids = run(['docker', 'ps', '-q'], capture=True).split()
    rows = json.loads(run(['docker', 'inspect'] + ids, capture=True))
    return {c['Name'].lstrip('/'): dict(
        id=c['Id'], image=c['Image'], started=c['State']['StartedAt'],
        restarts=c.get('RestartCount', 0), health=c['State'].get('Health', {}).get('Status'),
        mounts=sorted([(m['Type'], m['Source'], m['Destination'], m['RW']) for m in c.get('Mounts', [])])) for c in rows}


def config_summary():
    code = "import json,sqlite3,hashlib;d=sqlite3.connect('file:/data/office/office-config.sqlite3?mode=ro',uri=True);assert d.execute('PRAGMA quick_check').fetchone()[0]=='ok';r=d.execute('SELECT v.version,v.payload FROM config_head h JOIN config_versions v ON v.version=h.version WHERE h.singleton=1').fetchone();print(json.dumps(dict(version=r[0],payload_sha256=hashlib.sha256(r[1].encode()).hexdigest(),versions=d.execute('SELECT COUNT(*) FROM config_versions').fetchone()[0],audit=d.execute('SELECT COUNT(*) FROM audit').fetchone()[0],sqlite_integrity='ok')));d.close()"
    return json.loads(run(['docker', 'exec', OFFICE[0], 'python', '-c', code], capture=True))


def wait_healthy(image_id):
    for _ in range(50):
        rows = containers()
        if all(rows.get(n, {}).get('health') == 'healthy' and rows[n]['image'] == image_id for n in OFFICE):
            return rows
        time.sleep(2)
    raise RuntimeError('office health deadline exceeded')


def preserve(before, after):
    for name, row in before.items():
        if name not in after or row['mounts'] != after[name]['mounts']:
            raise RuntimeError('mount/service changed: ' + name)
        if name not in OFFICE and any(after[name][key] != row[key] for key in ('id', 'image', 'started', 'restarts')):
            raise RuntimeError('unrelated service changed: ' + name)


def fetch(url, ca=None):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), urllib.request.HTTPSHandler(context=ca))
    with opener.open(url, timeout=10) as response:
        return response.status, response.read()


def check():
    for p in (OLD, NEW, BACKUP, ENV, INGRESS, LOCK):
        if not p.exists() or p.is_symlink(): raise RuntimeError('missing or symlink path: ' + str(p))
    old_manifest = validator.verify(OLD)
    new_manifest = validator.verify(NEW)
    env = validator.validate_env(str(ENV), new_manifest, gates=True)
    old_env = validator.validate_env(str(BACKUP / 'office.env'), old_manifest, gates=True)
    meta = load(BACKUP / 'rollback-metadata.json')
    if env['OFFICE_RELEASE_ID'] != NEW_ID or meta['old_release'] != OLD_ID:
        raise RuntimeError('unexpected current/target release')
    image_id = run(['docker', 'image', 'inspect', '--format', '{{.Id}}', meta['image_tag']], capture=True)
    if image_id != meta['image_id'] or old_env['OFFICE_IMAGE'] != meta['image_tag']:
        raise RuntimeError('old image mismatch; no pull/rebuild allowed')
    proof = json.loads(run(['docker', 'run', '--rm', '--network', 'none', '--entrypoint', 'python', meta['image_tag'], '/app/deploy/office/verify_image.py'], capture=True))
    if proof.get('release_id') != OLD_ID or proof.get('verified_source_files') != 96 or not proof.get('source_bytes_match'):
        raise RuntimeError('old image source provenance mismatch')
    backup = load(BACKUP / 'backup-verification.json')
    if sha(BACKUP / 'office-image.tar.gz') != backup['image_archive_sha256']:
        raise RuntimeError('old image archive checksum mismatch')
    for row in backup['restore_drills']:
        label = 'office-data' if row['volume'] == 'star-office-production-office-data' else 'legacy-data'
        if sha(BACKUP / (label + '.tar.gz')) != row['archive_sha256'] or not row['restored_bytes_match']:
            raise RuntimeError('data backup mismatch')
    expected_old = 'f32f7e39edcd24e900bd648fcb663f530b609a146bcae621f60d74d6d674b84a'
    if sha(BACKUP / 'nginx.conf') != expected_old:
        raise RuntimeError('old ingress backup changed')
    expected_new = (NEW / 'deploy/office/nginx-isolated.conf.template').read_text().replace('@RELEASE_ID@', NEW_ID)
    if INGRESS.read_text() != expected_new:
        raise RuntimeError('current ingress has drifted; manual reconciliation required')
    run([NGINX, '-t', '-c', INGRESS])
    run([NGINX, '-t', '-c', BACKUP / 'nginx.conf'])
    before = containers()
    if any(n not in before for n in OFFICE): raise RuntimeError('office service missing')
    expected_current = 'sha256:c075c5bf786b194423971c72684c9a2e4663a283fcd5885a0f04d7dc92477563'
    if any(before[n]['image'] != expected_current for n in OFFICE): raise RuntimeError('current office image drift')
    return env, old_manifest, meta, proof, before


def execute():
    env, old_manifest, meta, proof, before = check()
    config_before = config_summary()
    firewall = run(['firewall-cmd', '--list-rich-rules'], capture=True)
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S-%fZ')
    safety = BACKUP / ('pre-code-rollback-' + stamp)
    safety.mkdir(mode=0o700)
    atomic_copy(ENV, safety / 'office.env', 0o600)
    atomic_copy(INGRESS, safety / 'nginx.conf', 0o600)
    candidate = safety / 'office-rollback.env'
    candidate.write_text(render_env(ENV.read_text(), OLD_ID, meta['image_tag']))
    candidate.chmod(0o600)
    candidate_env = validator.validate_env(str(candidate), old_manifest, gates=True)
    keys = ('OFFICE_RELEASE_ID', 'OFFICE_IMAGE')
    if {k:v for k,v in env.items() if k not in keys} != {k:v for k,v in candidate_env.items() if k not in keys}:
        raise RuntimeError('rollback would change credentials/scope/configuration')
    run(['docker', 'compose', '--env-file', candidate, '-f', OLD / 'deploy/office/compose.yaml', 'config', '--quiet'])
    mutated = False
    try:
        mutated = True
        compose(NEW, 'stop', 'office-web', 'office-collector')
        atomic_copy(candidate, ENV, 0o600)
        compose(OLD, 'up', '-d', '--no-build', '--pull', 'never', '--no-deps', 'office-web', 'office-collector')
        after = wait_healthy(meta['image_id'])
        if config_summary() != config_before: raise RuntimeError('persisted office configuration changed')
        preserve(before, after)
        if run(['firewall-cmd', '--list-rich-rules'], capture=True) != firewall: raise RuntimeError('firewall changed')
        atomic_copy(BACKUP / 'nginx.conf', INGRESS, 0o644)
        run([NGINX, '-t', '-c', INGRESS])
        run(['systemctl', 'reload', 'star-office-ingress.service'])
        status, html = fetch('http://192.168.100.221:19000/')
        if status != 200 or ('/static/releases/' + OLD_ID).encode() not in html: raise RuntimeError('old employee entrance failed')
        ctx = ssl.create_default_context(cafile=env['OFFICE_SERVER_CA_FILE'])
        if fetch('https://192.168.100.221:19443/admin', ctx)[0] != 200: raise RuntimeError('TLS admin entrance failed')
        result = dict(mode='code_only_rollback', completed_at=datetime.datetime.now(datetime.timezone.utc).isoformat(), target=OLD_ID, old_image_id=meta['image_id'], config_preserved=config_before, data_volumes_restored=False, credentials_preserved=True, unrelated_services_preserved=True, safety_backup=str(safety))
        (safety / 'result.json').write_text(json.dumps(result, indent=2) + '\n')
        print(json.dumps(result, indent=2))
    except Exception:
        if mutated:
            # Restore pre-command code/env/ingress, not any database or credential.
            atomic_copy(safety / 'office.env', ENV, 0o600)
            atomic_copy(safety / 'nginx.conf', INGRESS, 0o644)
            compose(NEW, 'up', '-d', '--no-build', '--pull', 'never', '--no-deps', 'office-web', 'office-collector')
            wait_healthy(before[OFFICE[0]]['image'])
            run([NGINX, '-t', '-c', INGRESS])
            run(['systemctl', 'reload', 'star-office-ingress.service'])
        raise


def main():
    p = argparse.ArgumentParser(description=__doc__)
    mode = p.add_mutually_exclusive_group()
    mode.add_argument('--check', action='store_true')
    mode.add_argument('--confirm-office-only-cutover', action='store_true')
    args = p.parse_args()
    # Existing lock only; --check creates no lock/config/backup files.
    with LOCK.open('rb') as handle:
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        if args.confirm_office_only_cutover:
            execute()
        else:
            env, manifest, meta, proof, before = check()
            after = containers()
            if before != after: raise RuntimeError('service state changed during check')
            print(json.dumps(dict(mode='check', current_release=NEW_ID, rollback_target=OLD_ID, old_image_id=meta['image_id'], old_image_provenance=proof, backup_sha_verified=True, old_and_current_nginx_syntax='ok', live_containers_unchanged=True, data_volumes_restored=False, credential_changes=False), indent=2))


if __name__ == '__main__':
    main()
