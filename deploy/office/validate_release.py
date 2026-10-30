#!/usr/bin/env python3
"""Read-only release/env validator; Python 3.6+ host-compatible, no app import.

Only `value` outputs a NON-SECRET deployment identifier. Never dumps dotenv.
"""
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import shlex
import stat
import sys
from urllib.parse import urlsplit

RELEASE_RE = re.compile(r'[A-Za-z0-9][A-Za-z0-9._-]{0,63}\Z')
# Approved collection ceiling, not permission to authorize users or mint credentials.
RELEASE_USER_PROFILE = frozenset(('1', '4', '7', '8'))
SAFE_VALUES = {'OFFICE_IMAGE', 'PYTHON_BASE', 'OFFICE_APP_PORT', 'OFFICE_RELEASE_ID',
               'OFFICE_SERVER_CA_FILE', 'OFFICE_CLIENT_MIGRATION_APPROVED',
               'OFFICE_FIREWALL_AUDITED', 'OFFICE_BACKUP_VERIFIED'}


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def check(condition, message):
    if not condition:
        raise ValueError(message)


def check_path(root, relative):
    rel = PurePosixPath(relative)
    check(not rel.is_absolute() and '..' not in rel.parts and bool(rel.parts), 'unsafe manifest path')
    path = root.joinpath(*rel.parts)
    for current in (path,) + tuple(path.parents):
        if current == root.parent:
            break
        check(not current.is_symlink(), 'release symlinks forbidden')
    check(path.is_file(), 'missing release file')
    return path


def verify(root):
    root = Path(root).absolute()
    manifest = json.loads((root / 'release-manifest.json').read_text())
    rid = manifest['release_id']
    check(bool(RELEASE_RE.fullmatch(rid)), 'invalid release ID')
    check(manifest['release_prefix'] == '/static/releases/' + rid, 'invalid release prefix')
    check(manifest['app_port'] == 19011 and manifest['python_version'] == '3.11', 'unapproved runtime or app port')
    sums = {}
    for line in (root / 'SHA256SUMS').read_text().splitlines():
        expected, relative = line.split('  ', 1)
        check(relative not in sums and bool(re.fullmatch('[0-9a-f]{64}', expected)), 'invalid or duplicate checksum')
        path = check_path(root, relative)
        check(digest(path) == expected, 'release checksum mismatch')
        sums[relative] = expected
    actual = set(p.relative_to(root).as_posix() for p in root.rglob('*') if p.is_file()) - {'SHA256SUMS'}
    check(actual == set(sums), 'unexpected or omitted release files')
    rows = manifest['files']
    check(len({row['path'] for row in rows}) == len(rows), 'duplicate manifest entry')
    check({row['path'] for row in rows} == actual - {'release-manifest.json'}, 'manifest file list mismatch')
    for row in rows:
        path = check_path(root, row['path'])
        check(digest(path) == row['sha256'] and path.stat().st_size == row['bytes'], 'manifest mismatch')
    for row in manifest['source_files']:
        path = check_path(root, row['path'])
        check(digest(path) == row['sha256'] and path.stat().st_size == row['bytes'], 'original source bytes changed')
    # Both backend-relative frontend and nginx public tree must retain PNG bytes.
    for row in manifest['source_files']:
        if row['path'].startswith('frontend/') and not row['path'].endswith('.html'):
            public = check_path(root, 'public' + manifest['release_prefix'] + '/' + row['path'][len('frontend/'):])
            check(digest(public) == row['sha256'], 'public runtime source changed')
    return manifest


def read_env(path):
    path = Path(path)
    check(path.is_file() and not path.is_symlink(), 'dotenv must be a regular private file')
    check(stat.S_IMODE(path.stat().st_mode) == 0o600, 'dotenv must have mode 0600')
    result = {}
    for line in path.read_text().splitlines():
        if not line.strip() or line.lstrip().startswith('#'):
            continue
        key, sep, raw = line.partition('=')
        check(sep and bool(re.fullmatch('[A-Z][A-Z0-9_]*', key.strip())), 'invalid dotenv assignment')
        parts = shlex.split(raw, comments=True, posix=True)
        check(len(parts) == 1 and key.strip() not in result, 'invalid or duplicate dotenv value')
        result[key.strip()] = parts[0]
    return result


def restricted(path, owner=None):
    path = Path(path)
    check(path.is_absolute() and path.is_file() and not path.is_symlink(), 'restricted file missing')
    st = path.stat()
    check(stat.S_IMODE(st.st_mode) in (0o400, 0o600), 'secret file must have mode 0400/0600')
    if owner is not None:
        check(st.st_uid == owner, 'secret file must belong to UID10001 (restricted bind mounts retain host owner)')
    check(path.read_text().strip() and not path.read_text().strip().startswith('SET_'), 'empty or placeholder secret file')


def validate_user_scope(value):
    """Accept an explicit nonempty canonical subset; never normalize or widen it."""
    check(isinstance(value, str) and bool(value), 'explicit nonempty OFFICE_USER_IDS required')
    users = value.split(',')
    check(all(re.fullmatch(r'[1-9][0-9]*', user) for user in users),
          'OFFICE_USER_IDS must contain canonical decimal IDs without whitespace or padding')
    check(len(users) == len(set(users)), 'duplicate OFFICE_USER_IDS forbidden')
    check(set(users).issubset(RELEASE_USER_PROFILE),
          'release user profile is limited to 1,4,7,8; extra users forbidden')
    return tuple(users)


def validate_env(path, manifest=None, gates=False):
    env = read_env(path)
    required = {'OFFICE_IMAGE', 'PYTHON_BASE', 'OFFICE_RELEASE_ID', 'OFFICE_ADMIN_SECRET',
                'FLASK_SECRET_KEY', 'ASSET_DRAWER_PASS', 'OFFICE_ADMIN_HASH_FILE',
                'OFFICE_CONSUMER_FILE', 'OFFICE_SUB2API_BASE_URL', 'OFFICE_CREDENTIAL_EXPIRES_AT',
                'OFFICE_UPSTREAM_CA_FILE', 'OFFICE_SERVER_CA_FILE', 'OFFICE_USER_IDS'}
    standalone = env.get('OFFICE_TELEMETRY_PROVIDER', 'sub2api') == 'standalone'
    check(env.get('OFFICE_TELEMETRY_PROVIDER', 'sub2api') in ('sub2api','standalone'), 'invalid telemetry provider')
    if standalone:
        required -= {'OFFICE_CONSUMER_FILE','OFFICE_SUB2API_BASE_URL','OFFICE_CREDENTIAL_EXPIRES_AT','OFFICE_UPSTREAM_CA_FILE','OFFICE_USER_IDS'}
        required |= {'OFFICE_API_BASE_URL','OFFICE_API_KEYS_FILE','OFFICE_SUBJECTS_FILE'}
    check(required.issubset(env), 'required environment variables missing')
    check(all(v and 'SET_' not in v and 'CHANGE_' not in v for k, v in env.items() if k in required), 'placeholder environment values remain')
    check(env.get('OFFICE_APP_PORT', '19011') == '19011', '19011 required; 19001 already occupied')
    if manifest:
        check(env['OFFICE_RELEASE_ID'] == manifest['release_id'], 'dotenv release ID mismatch')
    check(bool(RELEASE_RE.fullmatch(env['OFFICE_RELEASE_ID'])), 'unsafe release ID')
    if standalone:
        try:
            raw = Path(env['OFFICE_SUBJECTS_FILE']).read_bytes()
            check(len(raw)<=256*1024,'mapping too large')
            mappings=json.loads(raw)
            check(isinstance(mappings,list) and 1<=len(mappings)<=500,'invalid mappings')
            ids, pairs=set(),set()
            for row in mappings:
                check(isinstance(row,dict) and set(row)=={'office_user_id','project_id','subject_id'},'invalid mapping')
                uid = row['office_user_id']
                check(isinstance(uid, str) and bool(re.fullmatch(r'[1-9][0-9]{0,18}', uid))
                      and int(uid) <= 9223372036854775807, 'invalid standalone Office user ID')
                pair=(row['project_id'],row['subject_id'])
                check(all(isinstance(v,str) and re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._:-]{0,127}',v) for v in pair),'invalid mapped identity')
                check(row['office_user_id'] not in ids and pair not in pairs,'duplicate mapping')
                ids.add(row['office_user_id']); pairs.add(pair)
        except (OSError, ValueError, TypeError):
            check(False,'invalid standalone subject mappings')
    else:
        validate_user_scope(env['OFFICE_USER_IDS'])
        check(env.get('OFFICE_INSTALLATION_ID', '1') == '1', 'installation 1 only')
    check(env.get('OFFICE_ALLOW_HTTP', '0') in ('0', '1'), 'HTTP opt-in must be explicit 0/1')
    for key in ('FLASK_SECRET_KEY', 'OFFICE_ADMIN_SECRET'):
        val = env[key]
        check(len(val) >= 24 and not any(marker in val.lower() for marker in ('change-me', 'dev', 'example', 'test', 'default')),
              'weak signing secret')
        check('$' not in val and '\n' not in val, 'use random hex signing secrets to avoid compose interpolation')
    check(env['OFFICE_ADMIN_SECRET'] != env['FLASK_SECRET_KEY'], 'independent signing secrets required')
    check(len(env['ASSET_DRAWER_PASS']) >= 8 and env['ASSET_DRAWER_PASS'] != '1234' and '$' not in env['ASSET_DRAWER_PASS'], 'weak/interpolated drawer password')
    check(all(':' in env[k] and not env[k].endswith(':latest') for k in ('OFFICE_IMAGE', 'PYTHON_BASE')),
          'explicit cached image references required; latest forbidden')
    source = urlsplit(env['OFFICE_API_BASE_URL'] if standalone else env['OFFICE_SUB2API_BASE_URL'])
    local_http = (env.get('OFFICE_ALLOW_HTTP') == '1' and source.scheme == 'http'
                  and source.hostname in ({'127.0.0.1','localhost','telemetry-api'} if standalone else {'192.168.100.221'}))
    check((source.scheme == 'https' or local_http) and source.netloc and source.path in ('', '/') and not source.query
          and not source.fragment and not source.username and not source.password,
          'upstream requires HTTPS or explicitly approved same-host IP HTTP, without credentials')
    for key in ('OFFICE_ADMIN_HASH_FILE', 'OFFICE_API_KEYS_FILE' if standalone else 'OFFICE_CONSUMER_FILE'):
        restricted(env[key], owner=10001)
    for key in (('OFFICE_SERVER_CA_FILE',) if standalone else ('OFFICE_UPSTREAM_CA_FILE', 'OFFICE_SERVER_CA_FILE')):
        path = Path(env[key])
        check(path.is_absolute() and path.is_file() and not path.is_symlink(), 'trusted CA bundle missing')
        text = path.read_text()
        check('BEGIN CERTIFICATE' in text and 'PRIVATE KEY' not in text, 'CA bundle must contain certificates only, never a CA private key')
    if gates:
        check(all(env.get(k) == '1' for k in ('OFFICE_CLIENT_MIGRATION_APPROVED', 'OFFICE_FIREWALL_AUDITED', 'OFFICE_BACKUP_VERIFIED')),
              'main-thread migration/firewall/backup evidence gates not approved')
    return env


def main(argv):
    try:
        if argv[0] == 'verify':
            verify(argv[1])
        elif argv[0] in ('env', 'gates'):
            validate_env(argv[2], verify(argv[1]), gates=argv[0] == 'gates')
        elif argv[0] == 'value':
            key = argv[2]
            check(key in SAFE_VALUES, 'refusing to print sensitive environment value')
            env = read_env(argv[1])
            check(key in env, 'deployment identifier missing')
            print(env[key])
        else:
            raise ValueError('unknown validation command')
        return 0
    except (ValueError, OSError, KeyError, IndexError, TypeError):
        print('office_validation: FAILED (configuration, integrity or evidence gate)', file=sys.stderr)
        return 2


if __name__ == '__main__':
    raise SystemExit(main(sys.argv[1:]))
