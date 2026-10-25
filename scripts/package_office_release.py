#!/usr/bin/env python3
"""Offline allowlist packager. Never changes sources or transcodes selected art.

python scripts/package_office_release.py --release-id office-20261004-v1 \
  --output deploy/office/out --wheelhouse /path/to/linux-cp311-wheelhouse
No network, remote host, credential files or application imports are used.
"""
from __future__ import annotations

import argparse
import ast
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import shutil
import sys
import tarfile
import tempfile
from urllib.parse import urlsplit
import zipfile

ROOT = Path(__file__).resolve().parents[1]
RELEASE_RE = re.compile(r'[A-Za-z0-9][A-Za-z0-9._-]{0,63}\Z')
EXTENSIONS = {'.html', '.css', '.mjs', '.js', '.json', '.png', '.webp', '.svg', '.woff', '.woff2', '.ttf'}
RUNTIME_KEYS = {'background', 'base', 'back', 'front', 'frames', 'asset', 'manifest', 'referenceAssets', 'image', 'characterTemplate', 'templateManifest'}
EXCLUDED_PARTS = {'local', 'tests', 'test', 'fixtures', 'fixture', 'qa', 'screenshots', '__pycache__', '.git', 'node_modules'}
DEPLOY_FILES = (
    'Dockerfile', 'requirements.txt', 'compose.yaml', 'env.example',
    'nginx.conf.template', 'server-certificate.cnf', 'entrypoint.py', 'wsgi.py',
    'healthcheck.py', 'volume_archive.py', 'validate_release.py', 'preflight.sh', 'build_offline.sh',
    'backup.sh', 'rollback.sh', 'README.md', 'nginx-isolated.conf.template', 'star-office-ingress.service', 'verify_image.py',
)


class ReleaseError(ValueError):
    pass


def sha256(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def safe_file(root, path):
    path = Path(path)
    try:
        relative = path.relative_to(root)
    except ValueError:
        raise ReleaseError('dependency outside permitted tree') from None
    if any(part.lower() in EXCLUDED_PARTS or part.startswith('.') for part in relative.parts):
        raise ReleaseError('excluded dependency: ' + relative.as_posix())
    for parent in (path, *path.parents):
        if parent == root.parent:
            break
        if parent.is_symlink():
            raise ReleaseError('symlink dependency: ' + relative.as_posix())
    if not path.is_file():
        raise ReleaseError('required file missing: ' + relative.as_posix())
    return path


def quoted_references(text):
    # Known static resource literals including ESM imports, fetch and new URL.
    # Metadata in JSON uses a separate semantic allowlist below.
    for value in re.findall(r'''["']([^"'\n]+)["']''', text):
        # V5 monitor terminal text is UI content, not a fetched file.
        if value.startswith(('> ', '$ ', '# ')):
            continue
        parsed = urlsplit(value)
        if Path(parsed.path).suffix.lower() in EXTENSIONS:
            yield value
    for value in re.findall(r'url\(\s*([^\s)]+)\s*\)', text):
        yield value.strip('\'"')


def json_references(value):
    if isinstance(value, dict):
        for key, child in value.items():
            if key in RUNTIME_KEYS and isinstance(child, str) and Path(urlsplit(child).path).suffix.lower() in EXTENSIONS:
                yield child
            elif isinstance(child, (dict, list)):
                yield from json_references(child)
    elif isinstance(value, list):
        for child in value:
            yield from json_references(child)


def dependency_path(frontend, parent, ref):
    if ref.startswith('{{OFFICE_RELEASE_PREFIX}}/'):
        return frontend / ref[len('{{OFFICE_RELEASE_PREFIX}}/'): ]
    parsed = urlsplit(ref)
    if parsed.scheme == 'data':
        return None
    if parsed.scheme or parsed.netloc:
        raise ReleaseError('external runtime resource is forbidden')
    if parsed.path.startswith('/local'):
        raise ReleaseError('/local dependency forbidden')
    if parsed.path.startswith('/static/'):
        # Some V4 audit metadata contains old absolute static names, not a fetch.
        relative = parsed.path[len('/static/'):]
        return Path(frontend / relative)
    if parsed.path.startswith('/'):
        raise ReleaseError('non-versioned absolute runtime dependency')
    return Path(__import__('os').path.abspath(parent.parent / parsed.path))


def collect_frontend(root):
    frontend = root / 'frontend'
    office = frontend / 'office'
    # Main-thread Flask root uses office/index.html, not a legacy root template.
    mandatory = [office / name for name in ('index.html', 'admin.html', 'bootstrap.mjs', 'app.mjs', 'office.css')]
    mandatory += [frontend / 'vendor/phaser-3.80.1.min.js',
                  frontend / 'company-office/connected-v4/runtime.mjs',
                  frontend / 'company-office/connected-v4/telemetry-adapter.mjs',
                  frontend / 'company-office/connected-v4/layout.json',
                  frontend / 'company-office/connected-v4/assets.json']
    mandatory += [frontend / 'company-office/connected-v5' / name
                  for name in ('runtime.mjs', 'telemetry-adapter.mjs', 'layout.json', 'assets.json')]
    # Seed entrypoints only, not every nearby JSON/image/module: unused fixtures
    # or screenshots at the office root must never become public by proximity.
    queue = list(mandatory)
    selected = set()
    while queue:
        path = safe_file(frontend, queue.pop())
        if path in selected:
            continue
        selected.add(path)
        if path.suffix == '.json':
            refs = json_references(json.loads(path.read_text()))
        elif path.suffix in ('.mjs', '.css', '.html'):
            refs = quoted_references(path.read_text())
        else:
            continue
        for ref in refs:
            candidate = dependency_path(frontend, path, ref)
            if candidate is not None:
                queue.append(candidate)
    return sorted(selected)


def render_entry(data, release_prefix, mode):
    config = json.dumps({'release_prefix': release_prefix, 'mode': mode,
                         'snapshot_url': '/api/office/snapshot', 'poll_interval_ms': 2000,
                         'admin_url': 'https://192.168.100.221:19443/admin',
                         'employee_url': 'http://192.168.100.221:19000/'}, ensure_ascii=False)
    config = config.replace('<', '\\u003c')
    data = data.replace('{{OFFICE_RELEASE_PREFIX}}', release_prefix)
    if '{{OFFICE_BOOT_JSON}}' in data:
        return data.replace('{{OFFICE_BOOT_JSON}}', config)
    # Support the original pre-integration static template as well.
    data, count = re.subn(r'(<script\b[^>]*id="office-bootstrap"[^>]*>).*?(</script>)',
                         lambda m: m[1] + config + m[2], data, flags=re.S)
    if count != 1:
        raise ReleaseError('entry must have exactly one office-bootstrap block')
    return data.replace("from './bootstrap.mjs'", f"from '{release_prefix}/office/bootstrap.mjs'")


def collect_wheels(wheelhouse):
    if wheelhouse is None:
        return []
    wheelhouse = Path(wheelhouse).absolute()
    result = []
    for path in sorted(wheelhouse.glob('*.whl')):
        safe_file(wheelhouse, path)
        name = path.name
        # cp314/macOS caches are not valid Linux Python 3.11 artifacts.
        if re.search(r'(macosx|win32|win_amd64|cp3(?!11)[0-9]+-cp)', name):
            raise ReleaseError('incompatible wheel in curated CPython 3.11 Linux wheelhouse')
        try:
            with zipfile.ZipFile(path) as wheel:
                if not any(n.endswith('.dist-info/METADATA') for n in wheel.namelist()):
                    raise ReleaseError('wheel metadata missing')
                if any(PurePosixPath(n).is_absolute() or '..' in PurePosixPath(n).parts for n in wheel.namelist()):
                    raise ReleaseError('unsafe wheel entry')
        except zipfile.BadZipFile:
            raise ReleaseError('invalid wheel archive') from None
        result.append(path)
    if not result:
        raise ReleaseError('provided wheelhouse is empty; offline build would fail')
    return result


def records(root):
    return [{'path': p.relative_to(root).as_posix(), 'sha256': sha256(p), 'bytes': p.stat().st_size}
            for p in sorted(root.rglob('*')) if p.is_file()]


def secret_exclusion_audit(staging):
    """Audit artifacts, not private inputs. No actual secret values are logged."""
    forbidden_names = {'.env', 'state.json', 'join-keys.json', 'agents-state.json',
                       'runtime-config.json', 'office-snapshot.json', 'office-config.sqlite3'}
    checked = 0
    for path in staging.rglob('*'):
        if not path.is_file():
            continue
        relative = path.relative_to(staging)
        if (path.name in forbidden_names or path.suffix in ('.key', '.pem', '.sqlite', '.sqlite3', '.db', '.token')
                or any(part.lower() in EXCLUDED_PARTS or part == '.local' for part in relative.parts)):
            raise ReleaseError('excluded private/runtime/fixture artifact present')
        if path.suffix in ('.py', '.mjs', '.js', '.css', '.html', '.json', '.md', '.example', '.cnf', '.txt'):
            text = path.read_text()
            if re.search(r'-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----', text):
                raise ReleaseError('private key material present; values withheld')
            # dotenv assignments of secret VALUES must only exist as placeholders.
            for key, value in re.findall(r'(?m)^(OFFICE_ADMIN_SECRET|FLASK_SECRET_KEY|ASSET_DRAWER_PASS|OFFICE_ADMIN_PASSWORD_HASH|OFFICE_CREDENTIAL)=(.+)$', text):
                if not value.startswith('SET_'):
                    raise ReleaseError('non-placeholder secret assignment present; values withheld')
        checked += 1
    return {'checked_payload_files': checked, 'private_material_findings': 0,
            'verified_exclusions': ['private-env', 'consumer-token-file', 'admin-hash-file',
                                    'private-key-files', 'runtime-databases-and-snapshot',
                                    'local-fixtures-and-qa', 'unselected-art-candidates']}


def package(root, output, release_id, wheelhouse=None, app_port=19011):
    root, output = Path(root).absolute(), Path(output).absolute()
    if not RELEASE_RE.fullmatch(release_id) or release_id in ('.', '..'):
        raise ReleaseError('invalid release ID')
    if app_port != 19011:
        raise ReleaseError('approved app port is 19011; do not occupy existing 19001')
    selected = collect_frontend(root)
    wheels = collect_wheels(wheelhouse)
    backend = sorted(p for p in (root / 'backend').glob('*.py')
                     if not p.name.startswith('test_') and 'fixture' not in p.stem.lower())
    for name in ('app.py', 'office_api.py', 'office_collector.py', 'office_security.py', 'office_settings.py'):
        safe_file(root, root / 'backend' / name)
    for path in backend:
        safe_file(root, path)
        ast.parse(path.read_text(), filename=path.name, feature_version=(3, 11))
    for name in DEPLOY_FILES:
        safe_file(root, root / 'deploy/office' / name)
    release_dir = output / release_id
    archive = output / (release_id + '.tar.gz')
    if release_dir.exists() or archive.exists() or Path(str(archive) + '.sha256').exists():
        raise ReleaseError('release already exists; never overwrite immutable artifacts')
    output.mkdir(parents=True, exist_ok=True)
    prefix = '/static/releases/' + release_id
    with tempfile.TemporaryDirectory(prefix='.office-package-', dir=output) as temp:
        staging = Path(temp) / release_id
        staging.mkdir()
        origins = []
        for source in selected + backend + [root / 'deploy/office' / name for name in DEPLOY_FILES]:
            rel = source.relative_to(root)
            target = staging / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)  # exact bytes, not an image decode/encode
            target.chmod(0o755 if target.suffix == '.sh' else 0o644)
            if sha256(source) != sha256(target):
                raise ReleaseError('source changed during copy; wait for integration to finish and retry with a new release ID')
            origins.append({'path': rel.as_posix(), 'sha256': sha256(target), 'bytes': target.stat().st_size})
            if rel.parts[0] == 'frontend':
                public = staging / 'public' / prefix.lstrip('/') / Path(*rel.parts[1:])
                public.parent.mkdir(parents=True, exist_ok=True)
                if source.suffix == '.html' and source.parent.name == 'office' and source.name in {'index.html', 'admin.html'}:
                    mode = 'admin' if source.name == 'admin.html' else 'employee'
                    public.write_text(render_entry(source.read_text(), prefix, mode))
                else:
                    shutil.copyfile(source, public)
        wheel_dir = staging / 'wheelhouse'
        wheel_dir.mkdir()
        for wheel in wheels:
            shutil.copyfile(wheel, wheel_dir / wheel.name)
        if not wheels:
            (wheel_dir / 'OFFLINE_WHEELS_REQUIRED.txt').write_text('No compatible wheelhouse supplied. Build gate remains CLOSED.\n')
        # Re-resolve the staged graph; concurrent frontend edits must not turn
        # a formally complete archive into a runtime with missing imports.
        staged_paths = {p.relative_to(staging / 'frontend') for p in collect_frontend(staging)}
        if staged_paths != {p.relative_to(root / 'frontend') for p in selected}:
            raise ReleaseError('runtime dependency closure changed during packaging')
        for module in (staging / 'deploy/office').glob('*.py'):
            ast.parse(module.read_text(), filename=module.name, feature_version=(3, 11))
        template = (staging / 'deploy/office/nginx.conf.template').read_text()
        (staging / 'deploy/office/nginx.conf').write_text(template.replace('@RELEASE_ID@', release_id).replace('@APP_PORT@', str(app_port)))
        manifest = {'schema_version': 1, 'release_id': release_id, 'release_prefix': prefix,
                    'app_port': app_port, 'python_version': '3.11', 'phaser_version': '3.80.1',
                    'source_files': origins, 'files': records(staging),
                    'secret_exclusion': secret_exclusion_audit(staging),
                    'offline_wheelhouse': bool(wheels), 'remote_verified': False}
        (staging / 'release-manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
        (staging / 'SHA256SUMS').write_text(''.join(f'{r["sha256"]}  {r["path"]}\n' for r in records(staging)))
        # Deterministic permissions/ownership/times. PNG bytes are unchanged.
        tar_path = Path(temp) / 'archive.tar.gz'
        import gzip
        with tar_path.open('wb') as raw, gzip.GzipFile(filename='', fileobj=raw, mode='wb', mtime=0) as gz, tarfile.open(fileobj=gz, mode='w') as tar:
            for path in [staging, *sorted(staging.rglob('*'))]:
                info = tar.gettarinfo(str(path), arcname=path.relative_to(staging.parent).as_posix())
                info.uid = info.gid = 0
                info.uname = info.gname = ''
                info.mtime = 0
                info.mode = 0o755 if path.is_dir() or path.suffix == '.sh' else 0o644
                if path.is_file():
                    with path.open('rb') as content:
                        tar.addfile(info, content)
                else:
                    tar.addfile(info)
        shutil.move(str(staging), release_dir)
        shutil.move(str(tar_path), archive)
    Path(str(archive) + '.sha256').write_text(sha256(archive) + '  ' + archive.name + '\n')
    return release_dir, archive


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=ROOT)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--release-id', required=True)
    parser.add_argument('--wheelhouse', type=Path)
    parser.add_argument('--app-port', type=int, default=19011)
    args = parser.parse_args(argv)
    try:
        directory, archive = package(args.root, args.output, args.release_id, args.wheelhouse, args.app_port)
        print('release=' + str(directory))
        print('archive=' + str(archive))
        print('offline_image_build=' + ('pending_target_verification' if args.wheelhouse else 'blocked_missing_wheelhouse'))
        return 0
    except (ReleaseError, OSError, SyntaxError, json.JSONDecodeError) as error:
        print('office_package: ' + str(error), file=sys.stderr)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
