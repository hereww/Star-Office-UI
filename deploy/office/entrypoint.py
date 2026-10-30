"""Production launcher. No network bootstrap, credential issuance or secret logs."""
import importlib
import os
from pathlib import Path
import re
import stat
import sys
from urllib.parse import urlsplit


def fail(message):
    raise SystemExit('office_startup: ' + message)


def secret_file(path):
    p = Path(path)
    st = p.stat()
    if p.is_symlink() or not stat.S_ISREG(st.st_mode) or stat.S_IMODE(st.st_mode) not in (0o400, 0o600):
        fail('secret file must be regular and mode 0400/0600')
    value = p.read_text().strip()
    if not value or value.startswith(('SET_', 'CHANGE_')):
        fail('secret file must contain provisioned material')
    return value


def prepare_web():
    if os.environ.get('OFFICE_ENABLED') != '1':
        fail('OFFICE_ENABLED=1 is required for production release')
    if os.environ.get('OFFICE_ADMIN_ALLOW_HTTP', '0') not in ('0', '1'):
        fail('OFFICE_ADMIN_ALLOW_HTTP must be 0 or 1')
    security = importlib.import_module('security_utils')
    if not security.is_production_mode():
        fail('production mode required')
    if not security.is_strong_secret(os.environ.get('FLASK_SECRET_KEY', '')):
        fail('FLASK_SECRET_KEY must be strong and >=24 characters')
    if (not security.is_strong_secret(os.environ.get('OFFICE_ADMIN_SECRET', ''))
            or os.environ.get('OFFICE_ADMIN_SECRET') == os.environ.get('FLASK_SECRET_KEY')):
        fail('independent strong OFFICE_ADMIN_SECRET required')
    if not security.is_strong_drawer_pass(os.environ.get('ASSET_DRAWER_PASS', '')):
        fail('strong ASSET_DRAWER_PASS required even with drawer disabled')
    os.environ['OFFICE_ADMIN_PASSWORD_HASH'] = secret_file(os.environ['OFFICE_ADMIN_PASSWORD_HASH_FILE'])
    from office_security import strong_password_hash
    if not strong_password_hash(os.environ['OFFICE_ADMIN_PASSWORD_HASH']):
        fail('supported strong OFFICE admin password hash required')
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,63}', os.environ.get('OFFICE_RELEASE_ID', '')):
        fail('valid immutable release ID required')
    # Keep this check about routes, not a guess about backend auth implementation.
    app = importlib.import_module('app').app
    required = {
        '/api/office/snapshot': {'GET'}, '/api/office/admin/users': {'GET'},
        '/api/office/admin/config': {'GET', 'PUT'},
        '/api/office/admin/session': {'GET', 'POST', 'DELETE'},
        '/api/office/admin/config/restore': {'POST'},
    }
    found = {}
    for rule in app.url_map.iter_rules():
        found.setdefault(rule.rule, set()).update(rule.methods)
    if any(not methods.issubset(found.get(path, set())) for path, methods in required.items()):
        fail('main-thread OFFICE route registration incomplete; refusing startup')


def main(argv=None):
    args = argv or sys.argv[1:]
    if sys.version_info[:2] != (3, 11):
        fail('Python 3.11 required')
    os.umask(0o077)
    role = args[0] if args else ''
    if role == 'office-web':
        prepare_web()
        command = [sys.executable, '-m', 'gunicorn', '--bind', '0.0.0.0:19000',
                   '--workers', '2', '--threads', '4', '--timeout', '30',
                   '--worker-tmp-dir', '/tmp', '--access-logfile', '/dev/null',
                   '--error-logfile', '-', 'deploy.office.wsgi:application']
    elif role == 'office-collector':
        standalone = os.environ.get('OFFICE_TELEMETRY_PROVIDER') == 'standalone'
        secret_file(os.environ['OFFICE_API_KEYS_FILE'] if standalone else os.environ['OFFICE_CREDENTIAL_FILE'])
        source = urlsplit(os.environ.get('OFFICE_API_BASE_URL' if standalone else 'OFFICE_SUB2API_BASE_URL', ''))
        local_http = (os.environ.get('OFFICE_ALLOW_HTTP') == '1' and source.scheme == 'http'
                      and source.hostname in ({'127.0.0.1','localhost','telemetry-api'} if standalone else {'192.168.100.221'}))
        if source.scheme != 'https' and not local_http:
            fail('HTTPS or explicitly approved same-host HTTP required')
        command = [sys.executable, '/app/backend/office_collector.py', '--data-dir',
                   os.environ.get('OFFICE_DATA_DIR', '/data/office')]
    else:
        fail('expected office-web or office-collector')
    os.execv(sys.executable, command)


if __name__ == '__main__':
    try:
        main()
    except (KeyError, OSError, ValueError):
        fail('missing configuration or restricted file; no details logged')
