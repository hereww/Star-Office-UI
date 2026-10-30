#!/usr/bin/env python3
"""Offline release tests with temporary synthetic fixtures, no real app/server.

Compatible with the main-thread isolated Python3.12 venv. Standard library only;
no Docker daemon, Flask app import, Sub2API, SSH or credential provisioning.
"""
from __future__ import annotations

import base64
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import sqlite3
import types
import tarfile
import tempfile
import unittest
from unittest.mock import patch
import zipfile

ROOT = Path(__file__).resolve().parents[1]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


pack = load('office_packager_test', ROOT / 'scripts/package_office_release.py')
validator = load('office_validator_test', ROOT / 'deploy/office/validate_release.py')
guard_module = load('office_guard_test', ROOT / 'deploy/office/wsgi.py')
entrypoint = load('office_entrypoint_test', ROOT / 'deploy/office/entrypoint.py')
volumes = load('office_volumes_test', ROOT / 'deploy/office/volume_archive.py')
PNG = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWHsAAAAASUVORK5CYII=')


def write(root, rel, data):
    path = root / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data if isinstance(data, bytes) else data.encode())
    return path


def fixture(root):
    shutil.copytree(ROOT / 'deploy/office', root / 'deploy/office',
                    ignore=shutil.ignore_patterns('out', '__pycache__', '*.tar.gz', '*.sha256'))
    for name in ('app.py', 'office_api.py', 'office_collector.py', 'office_security.py', 'office_settings.py'):
        write(root, 'backend/' + name, '# isolated source fixture, never imported\nVALUE = 1\n')
    write(root, 'backend/test_sensitive.py', 'CREDENTIAL="fixture-not-shipped"\n')
    html = ('<!doctype html><html><script id="office-bootstrap" type="application/json">'
            '{{OFFICE_BOOT_JSON}}</script><script type="module">'
            'import {boot} from "{{OFFICE_RELEASE_PREFIX}}/office/bootstrap.mjs";boot();</script></html>')
    for name in ('employee.html', 'admin.html', 'index.html'):
        write(root, 'frontend/office/' + name, html)
    for name, data in {
        'bootstrap.mjs': "import './app.mjs'; const sheet='office.css';",
        'app.mjs': "import './map-loader.mjs';import './codec.mjs';const admin=import('./admin.mjs');",
        'admin.mjs': "export const preview = true;",
        'map-loader.mjs': "const game='../vendor/phaser-3.80.1.min.js';",
        'codec.mjs': "export const data = null;",
        'office.css': "body{background:#F7F6F2}@font-face{font-family:Office;src:url(media/chinese.woff2)}",
    }.items():
        write(root, 'frontend/office/' + name, data)
    write(root, 'frontend/office/media/chinese.woff2', b'font-fixture')
    write(root, 'frontend/vendor/phaser-3.80.1.min.js', '/* local phaser fixture */')
    write(root, 'frontend/company-office/connected-v4/runtime.mjs',
          "import '../reference-v3/runtime.mjs';export const manifests=['layout.json','assets.json'];")
    write(root, 'frontend/company-office/connected-v4/telemetry-adapter.mjs', "import './runtime.mjs';export const adapter=true;")
    write(root, 'frontend/company-office/reference-v3/runtime.mjs', "import './render-quality.mjs';")
    write(root, 'frontend/company-office/reference-v3/render-quality.mjs', 'export const quality=1;')
    write(root, 'frontend/company-office/connected-v4/assets.json', json.dumps({'referenceAssets': '../reference-v3/assets.json'}))
    write(root, 'frontend/company-office/connected-v4/layout.json', json.dumps({
        'background': '../reference-v3/background.png', 'benches': [
            {'manifest': 'media/vertical/manifest.json'}, {'manifest': 'media/horizontal/manifest.json'}]}))
    write(root, 'frontend/company-office/connected-v5/runtime.mjs',
          "import '../connected-v4/runtime.mjs';export const manifests=['layout.json','assets.json'];")
    write(root, 'frontend/company-office/connected-v5/telemetry-adapter.mjs',
          "import './runtime.mjs';import '../connected-v4/telemetry-adapter.mjs';")
    write(root, 'frontend/company-office/connected-v5/assets.json',
          json.dumps({'referenceAssets': '../reference-v3/assets.json'}))
    write(root, 'frontend/company-office/connected-v5/layout.json',
          json.dumps({'background': '../reference-v3/background.png', 'benches': [
              {'manifest': '../connected-v4/media/vertical/manifest.json'},
              {'manifest': '../connected-v4/media/horizontal/manifest.json'}]}))
    write(root, 'frontend/company-office/reference-v3/background.png', PNG)
    directions = {}
    for direction in ('up', 'down', 'left', 'right'):
        media = 'media/' + direction
        files = ['base.png', 'back.png', 'front.png'] + ['frames-' + state + '.png' for state in ('working', 'idle', 'syncing', 'error')]
        for name in files:
            write(root, 'frontend/company-office/reference-v3/' + media + '/' + name, PNG + direction.encode())
        directions[direction] = {'character': {'base': media + '/base.png', 'actions': {
            state: {'frames': media + '/frames-' + state + '.png'} for state in ('working', 'idle', 'syncing', 'error')}},
            'furniture': {'back': media + '/back.png', 'front': media + '/front.png'}}
    write(root, 'frontend/company-office/reference-v3/assets.json', json.dumps({'directions': directions, 'sourceTemplate': '/local/not-runtime.png'}))
    for bank in ('horizontal', 'vertical'):
        base = 'frontend/company-office/connected-v4/media/' + bank
        write(root, base + '/selected.png', PNG + bank.encode())
        write(root, base + '/manifest.json', json.dumps({'image': 'selected.png', 'runtimeImage': '/static/old-path/not-runtime.png', 'sourceRaw': 'raw-candidate.png'}))
        write(root, base + '/raw-candidate.png', b'not-selected')
        write(root, base + '/prompt.txt', 'not-shipped')
    for name in ('frontend/local/leaked.png', 'frontend/office/fixtures/private.json',
                 'frontend/company-office/connected-v4/screenshots/qa.png', 'frontend/office/private-fixture.json',
                 'frontend/office/qa.png', '.env', 'private/token.txt'):
        write(root, name, 'fixture-not-shipped')


class PackageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='office-release-tests-')
        self.root = Path(self.temp.name) / 'repo'
        self.output = Path(self.temp.name) / 'output'
        fixture(self.root)

    def tearDown(self):
        self.temp.cleanup()

    def package(self, release='office-fixture-v1', **kwargs):
        return pack.package(self.root, self.output, release, **kwargs)

    def test_complete_closure_selected_bytes_and_local_phaser(self):
        directory, archive = self.package()
        manifest = validator.verify(directory)
        self.assertEqual(manifest['release_prefix'], '/static/releases/office-fixture-v1')
        self.assertEqual(manifest['app_port'], 19011)
        self.assertFalse(manifest['remote_verified'])
        self.assertEqual(manifest['secret_exclusion']['private_material_findings'], 0)
        for record in manifest['source_files']:
            self.assertEqual((directory / record['path']).read_bytes(), (self.root / record['path']).read_bytes())
        for direction in ('up', 'down', 'left', 'right'):
            for state in ('working', 'idle', 'syncing', 'error'):
                selected = 'frontend/company-office/reference-v3/media/' + direction + '/frames-' + state + '.png'
                self.assertTrue((directory / selected).is_file())
        phaser = directory / 'public/static/releases/office-fixture-v1/vendor/phaser-3.80.1.min.js'
        self.assertTrue(phaser.is_file())
        self.assertTrue((directory / 'frontend/office/media/chinese.woff2').is_file())
        self.assertTrue(archive.is_file())
        self.assertEqual(Path(str(archive) + '.sha256').read_text().split()[0], pack.sha256(archive))

    def test_excludes_local_fixtures_candidates_secrets_and_qa(self):
        directory, _ = self.package()
        paths = {p.relative_to(directory).as_posix() for p in directory.rglob('*') if p.is_file()}
        self.assertFalse(any(any(part in {'local', 'fixtures', 'screenshots', 'private'} for part in Path(p).parts) for p in paths))
        self.assertFalse(any('raw-candidate' in p or 'prompt.txt' in p or 'test_sensitive' in p or 'private-fixture' in p or p.endswith('/qa.png') or p == '.env' for p in paths))

    def test_public_html_rendered_source_html_unchanged(self):
        directory, _ = self.package()
        source = directory / 'frontend/office/index.html'
        public = directory / 'public/static/releases/office-fixture-v1/office/index.html'
        self.assertIn('{{OFFICE_BOOT_JSON}}', source.read_text())
        self.assertNotIn('{{OFFICE_', public.read_text())
        self.assertIn('"release_prefix": "/static/releases/office-fixture-v1"', public.read_text())
        self.assertIn('https://192.168.100.221:19443/admin', public.read_text())

    def test_inline_private_key_or_secret_assignment_refuses_package(self):
        for material in ('const hidden="-----BEGIN PRIVATE KEY-----";', 'OFFICE_CREDENTIAL=do-not-ship-fixture'):
            write(self.root, 'frontend/office/codec.mjs', material)
            with self.subTest(kind=material.split('=')[0]), self.assertRaises(pack.ReleaseError):
                self.package()
            self.assertFalse((self.output / 'office-fixture-v1').exists())

    def test_archive_no_links_and_fixed_metadata(self):
        _, archive = self.package()
        with tarfile.open(archive) as tar:
            for item in tar.getmembers():
                self.assertTrue(item.isfile() or item.isdir())
                self.assertFalse(item.name.startswith('/') or '..' in Path(item.name).parts)
                self.assertEqual((item.uid, item.gid, item.mtime), (0, 0, 0))

    def test_reproducible_same_sources(self):
        _, archive1 = self.package()
        _, archive2 = pack.package(self.root, Path(self.temp.name) / 'output2', 'office-fixture-v1')
        self.assertEqual(archive1.read_bytes(), archive2.read_bytes())

    def test_immutable_output_refuses_overwrite(self):
        self.package()
        with self.assertRaises(pack.ReleaseError):
            self.package()

    def test_release_id_traversal_and_unsafe_port_rejected(self):
        for bad in ('../escape', '/absolute', '.', '..', 'a/b', 'with space', 'a' * 65):
            with self.subTest(release=bad), self.assertRaises(pack.ReleaseError):
                self.package(bad)
        with self.assertRaises(pack.ReleaseError):
            self.package(app_port=19001)

    def test_missing_runtime_media_fails_closed(self):
        (self.root / 'frontend/company-office/reference-v3/media/up/base.png').unlink()
        with self.assertRaises(pack.ReleaseError):
            self.package()
        self.assertFalse(self.output.exists())

    def test_missing_stylesheet_or_adapter_fails_closed(self):
        for rel in ('frontend/office/office.css', 'frontend/company-office/connected-v4/telemetry-adapter.mjs'):
            path = self.root / rel
            original = path.read_bytes()
            path.unlink()
            with self.subTest(path=rel), self.assertRaises(pack.ReleaseError):
                self.package()
            path.write_bytes(original)

    def test_symlink_dependency_rejected(self):
        path = self.root / 'frontend/vendor/phaser-3.80.1.min.js'
        path.unlink()
        path.symlink_to(self.root / 'private/token.txt')
        with self.assertRaises(pack.ReleaseError):
            self.package()

    def test_dependency_escape_rejected(self):
        write(self.root, 'frontend/office/map-loader.mjs', "import '../../../private/token.txt.mjs';")
        with self.assertRaises(pack.ReleaseError):
            self.package()

    def test_network_and_local_dependencies_rejected(self):
        for ref in ('https://cdn.invalid/lib.mjs', '/local/lib.mjs', '//cdn.invalid/lib.mjs'):
            write(self.root, 'frontend/office/map-loader.mjs', 'import ' + repr(ref) + ';')
            with self.subTest(ref=ref), self.assertRaises(pack.ReleaseError):
                self.package()

    def test_unreferenced_symlink_secret_not_followed(self):
        path = self.root / 'frontend/company-office/connected-v4/unselected-secret.png'
        path.symlink_to(self.root / 'private/token.txt')
        directory, _ = self.package()
        self.assertFalse((directory / path.relative_to(self.root)).exists())

    def test_integrity_detects_original_and_public_tamper(self):
        directory, _ = self.package()
        target = directory / 'public/static/releases/office-fixture-v1/vendor/phaser-3.80.1.min.js'
        target.write_bytes(b'tampered')
        with self.assertRaises(ValueError):
            validator.verify(directory)

    def test_integrity_detects_extra_private_file(self):
        directory, _ = self.package()
        write(directory, 'private/secret.txt', 'do-not-ship')
        with self.assertRaises(ValueError):
            validator.verify(directory)

    def test_missing_wheelhouse_explicit_build_gate(self):
        directory, _ = self.package()
        self.assertFalse(validator.verify(directory)['offline_wheelhouse'])
        self.assertTrue((directory / 'wheelhouse/OFFLINE_WHEELS_REQUIRED.txt').exists())

    def test_bad_or_platform_incompatible_wheel_rejected(self):
        wheelhouse = Path(self.temp.name) / 'wheels'
        wheelhouse.mkdir()
        for name, contents in [('Pillow-10.4.0-cp314-cp314-macosx_26_0_arm64.whl', b'macos'),
                               ('Flask-3.0.2-py3-none-any.whl', b'invalid zip')]:
            path = write(wheelhouse, name, contents)
            with self.subTest(name=name), self.assertRaises(pack.ReleaseError):
                self.package(wheelhouse=wheelhouse)
            path.unlink()

    def test_curated_wheel_checksum_not_install_claim(self):
        wheelhouse = Path(self.temp.name) / 'wheels'
        wheelhouse.mkdir()
        path = wheelhouse / 'Flask-3.0.2-py3-none-any.whl'
        with zipfile.ZipFile(path, 'w') as wheel:
            wheel.writestr('flask-3.0.2.dist-info/METADATA', 'Name: Flask\nVersion: 3.0.2\n')
        directory, _ = self.package(wheelhouse=wheelhouse)
        manifest = validator.verify(directory)
        self.assertTrue(manifest['offline_wheelhouse'])
        self.assertEqual((directory / 'wheelhouse' / path.name).read_bytes(), path.read_bytes())
        # Synthetic wheel verifies archive inclusion only, never a pip installation.


class PolicyTests(unittest.TestCase):
    def test_compose_same_image_loopback_nonroot_and_secret_separation(self):
        text = (ROOT / 'deploy/office/compose.yaml').read_text()
        web = text.split('  office-web:', 1)[1].split('  office-collector:', 1)[0]
        collector = text.split('  office-collector:', 1)[1].split('\nvolumes:', 1)[0]
        self.assertEqual(text.count('    <<: *office'), 2)
        self.assertIn('user: "10001:10001"', text)
        self.assertIn('restart: unless-stopped', text)
        self.assertIn('127.0.0.1:${OFFICE_APP_PORT:-19011}:19000', web)
        self.assertIn('OFFICE_ENABLED: "1"', web)
        self.assertIn('OFFICE_USER_IDS: ${OFFICE_USER_IDS:?Set explicit verified user scope}', web)
        self.assertIn('OFFICE_USER_IDS: ${OFFICE_USER_IDS:?Set explicit verified user scope}', collector)
        self.assertNotIn('office_consumer', web)
        self.assertNotIn('OFFICE_CREDENTIAL_FILE', web)
        self.assertIn('target: /run/secrets/office_consumer', collector)
        self.assertIn('source: ${OFFICE_CONSUMER_FILE:', collector)
        self.assertIn('target: /run/secrets/office_admin_hash', web)
        self.assertNotIn('\nsecrets:', text)
        self.assertIn('/app/backend/office_collector.py, --data-dir, /data/office, --health', collector)
        self.assertNotIn('FLASK_SECRET_KEY', collector)
        self.assertNotIn('ports:', collector)
        self.assertEqual(text.count('    healthcheck:'), 2)
        self.assertIn('office-data:/data/office', web)
        self.assertIn('office-data:/data/office', collector)

    def test_nginx_public_routes_static_mime_and_http_admin(self):
        text = (ROOT / 'deploy/office/nginx.conf.template').read_text()
        http, tls = text.split('server {', 2)[1:]
        self.assertIn('listen 192.168.100.221:19000;', http)
        self.assertIn('location = /api/office/snapshot', http)
        self.assertIn('location = /health', http)
        self.assertIn('location / { return 404; }', http)
        self.assertNotIn('location = /admin', http)
        self.assertNotIn('location = /set_state', http)
        self.assertIn('location ^~ /static/releases/@RELEASE_ID@/', http)
        self.assertIn('application/javascript js mjs;', text)
        self.assertEqual(text.count('allow all;'), 2)
        self.assertEqual(text.count('server_name _;'), 2)
        self.assertNotIn('if ($host !~*', text)
        self.assertIn('listen 192.168.100.221:19443;', tls)
        self.assertIn('proxy_set_header X-Forwarded-Proto http;', tls)
        self.assertIn('proxy_set_header X-Forwarded-Host $http_host;', tls)
        self.assertNotIn('ssl_protocols TLSv1.2 TLSv1.3;', tls)

    def test_offline_build_no_unpinned_latest_or_network_install(self):
        docker = (ROOT / 'deploy/office/Dockerfile').read_text()
        script = (ROOT / 'deploy/office/build_offline.sh').read_text()
        self.assertIn('pip install --no-index', docker)
        self.assertIn('--pull=false --network=none', script)
        self.assertNotIn(':latest', docker)
        self.assertNotIn('apt-get', docker)
        requirements = (ROOT / 'deploy/office/requirements.txt').read_text()
        self.assertIn('Flask==3.0.2', requirements)
        self.assertIn('Pillow==10.4.0', requirements)
        self.assertIn('gunicorn==23.0.0', requirements)

    def test_no_shared_service_restart_or_automatic_ca(self):
        for path in (ROOT / 'deploy/office').glob('*.sh'):
            text = path.read_text()
            self.assertNotIn('systemctl restart', text)
            self.assertNotIn('docker restart', text)
            self.assertNotIn('curl -k', text)
            self.assertNotIn('ssh ', text)
            self.assertNotIn('--add-port=', text)
            self.assertNotIn('openssl req', text)
        cert = (ROOT / 'deploy/office/server-certificate.cnf').read_text()
        self.assertIn('subjectAltName = IP:192.168.100.221', cert)
        self.assertIn('CA:FALSE', cert)

    def test_preflight_hard_stop_port_conflict_without_services(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            for port in (19443, 19011):
                script = write(root, 'bin/ss', '#!/bin/bash\nprintf "LISTEN 0 128 0.0.0.0:' + str(port) + ' 0.0.0.0:*\\n"\n')
                script.chmod(0o755)
                result = subprocess.run(['bash', str(ROOT / 'deploy/office/preflight.sh'), str(ROOT), '/not-used.env'],
                                        env={**os.environ, 'PATH': str(root / 'bin') + ':/usr/bin:/bin'},
                                        text=True, capture_output=True)
                self.assertEqual(result.returncode, 2)
                self.assertIn('port ' + str(port) + ' already listening', result.stderr)

    def test_preflight_existing_19001_not_reassigned(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            script = write(root, 'bin/ss', '#!/bin/bash\nprintf "LISTEN 0 128 0.0.0.0:19001 0.0.0.0:*\\n"\n')
            script.chmod(0o755)
            result = subprocess.run(['bash', str(ROOT / 'deploy/office/preflight.sh'), str(ROOT), '/not-used.env'],
                                    env={**os.environ, 'PATH': str(root / 'bin') + ':/usr/bin:/bin'},
                                    text=True, capture_output=True)
            self.assertEqual(result.returncode, 2)
            self.assertNotIn('port 19001', result.stderr)
            self.assertIn('unavailable', result.stderr)

    def test_env_example_placeholders_and_secret_output_refusal(self):
        with tempfile.TemporaryDirectory() as temp:
            env = write(Path(temp), 'office.env', 'FLASK_SECRET_KEY=synthetic-private-value\nOFFICE_APP_PORT=19011\n')
            env.chmod(0o600)
            with patch('sys.stderr', new=io.StringIO()), patch('sys.stdout', new=io.StringIO()) as output:
                self.assertEqual(validator.main(['value', str(env), 'FLASK_SECRET_KEY']), 2)
                self.assertNotIn('synthetic-private-value', output.getvalue())
            env.chmod(0o644)
            with self.assertRaises(ValueError):
                validator.read_env(env)
        example = (ROOT / 'deploy/office/env.example').read_text()
        self.assertIn('OFFICE_APP_PORT=19011', example)
        self.assertIn('OFFICE_CLIENT_MIGRATION_APPROVED=0', example)
        self.assertIn('OFFICE_FIREWALL_AUDITED=0', example)
        self.assertIn('OFFICE_BACKUP_VERIFIED=0', example)

    def test_all_shell_scripts_syntax(self):
        for path in (ROOT / 'deploy/office').glob('*.sh'):
            result = subprocess.run(['bash', '-n', str(path)], text=True, capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr)

    def test_unsafe_volume_archive_rejected_before_restore(self):
        with tempfile.TemporaryDirectory() as temp:
            for name, kind in (('../escape', 'file'), ('/escape', 'file'), ('safe', 'symlink'), ('safe', 'hardlink'), ('safe', 'device')):
                archive = Path(temp) / 'unsafe.tar.gz'
                with tarfile.open(archive, 'w:gz') as tar:
                    member = tarfile.TarInfo(name)
                    member.type = {'file': tarfile.REGTYPE, 'symlink': tarfile.SYMTYPE,
                                   'hardlink': tarfile.LNKTYPE, 'device': tarfile.CHRTYPE}[kind]
                    tar.addfile(member)
                with tarfile.open(archive) as tar, self.subTest(name=name, kind=kind), self.assertRaises(ValueError):
                    volumes.checked_members(tar)


class EnvironmentTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.env = {
            'OFFICE_IMAGE': 'local/office:fixture-v1', 'PYTHON_BASE': 'python:3.11-cached',
            'OFFICE_RELEASE_ID': 'fixture-v1', 'OFFICE_ADMIN_SECRET': 'a' * 64,
            'FLASK_SECRET_KEY': 'b' * 64, 'ASSET_DRAWER_PASS': 'c' * 32,
            'OFFICE_ADMIN_HASH_FILE': str(self.root / 'admin.hash'),
            'OFFICE_CONSUMER_FILE': str(self.root / 'consumer.token'),
            'OFFICE_SUB2API_BASE_URL': 'https://192.168.100.221:8080',
            'OFFICE_CREDENTIAL_EXPIRES_AT': '2026-11-03T00:00:00Z',
            'OFFICE_UPSTREAM_CA_FILE': str(self.root / 'upstream-ca.pem'),
            'OFFICE_SERVER_CA_FILE': str(self.root / 'office-ca.pem'),
            'OFFICE_USER_IDS': '1,4,7,8', 'OFFICE_INSTALLATION_ID': '1',
        }
        for name in ('upstream-ca.pem', 'office-ca.pem'):
            write(self.root, name, '-----BEGIN CERTIFICATE-----\nfixture-only\n-----END CERTIFICATE-----')
        self.path = self.root / 'office.env'

    def tearDown(self):
        self.temp.cleanup()

    def validate(self, gates=False):
        self.path.write_text(''.join(k + '=' + v + '\n' for k, v in self.env.items()))
        self.path.chmod(0o600)
        # File-owner checks are separately covered by production startup policy;
        # tests must not chown fixture files to a real system account.
        with patch.object(validator, 'restricted'):
            return validator.validate_env(self.path, gates=gates)

    def test_https_default_and_same_host_http_explicit_only(self):
        self.validate()
        self.env['OFFICE_SUB2API_BASE_URL'] = 'http://192.168.100.221:8080'
        with self.assertRaises(ValueError):
            self.validate()
        self.env['OFFICE_ALLOW_HTTP'] = '1'
        self.validate()
        for origin in ('http://8.8.8.8', 'http://other.internal', 'http://192.168.100.222',
                       'http://192.168.100.221.evil.invalid', 'http://user:password@192.168.100.221'):
            self.env['OFFICE_SUB2API_BASE_URL'] = origin
            with self.subTest(origin=origin), self.assertRaises(ValueError):
                self.validate()

    def test_standalone_accepts_company_subjects_without_sub2api_configuration(self):
        for key in ('OFFICE_CONSUMER_FILE', 'OFFICE_SUB2API_BASE_URL', 'OFFICE_CREDENTIAL_EXPIRES_AT',
                    'OFFICE_UPSTREAM_CA_FILE', 'OFFICE_USER_IDS', 'OFFICE_INSTALLATION_ID'):
            self.env.pop(key)
        mapping = self.root / 'subjects.json'
        rows = [{'office_user_id': '42', 'project_id': 'company', 'subject_id': 'developer-1'}]
        mapping.write_text(json.dumps(rows))
        self.env.update(OFFICE_TELEMETRY_PROVIDER='standalone', OFFICE_SUBJECTS_FILE=str(mapping),
                        OFFICE_API_BASE_URL='https://api.company.example',
                        OFFICE_API_KEYS_FILE=str(self.root / 'reader.json'))
        self.assertNotIn('OFFICE_USER_IDS', self.validate())
        self.env.update(OFFICE_API_BASE_URL='http://telemetry-api:19100', OFFICE_ALLOW_HTTP='1')
        self.validate()
        for bad in ('0', '01', '9223372036854775808', '1,4', 42):
            rows[0]['office_user_id'] = bad
            mapping.write_text(json.dumps(rows))
            with self.subTest(user=bad), self.assertRaises(ValueError):
                self.validate()

    def test_signing_secrets_must_be_independent_and_production_strong(self):
        self.env['OFFICE_ADMIN_SECRET'] = self.env['FLASK_SECRET_KEY']
        with self.assertRaises(ValueError):
            self.validate()
        self.env['OFFICE_ADMIN_SECRET'] = 'short'
        with self.assertRaises(ValueError):
            self.validate()
        self.env['OFFICE_ADMIN_SECRET'] = 'd' * 64
        self.env['ASSET_DRAWER_PASS'] = '1234'
        with self.assertRaises(ValueError):
            self.validate()

    def test_four_user_release_profile_is_accepted(self):
        self.assertEqual(self.validate()['OFFICE_USER_IDS'], '1,4,7,8')
        self.assertEqual(validator.validate_user_scope('1,4,7,8'), ('1', '4', '7', '8'))

    def test_explicit_single_user_subset_is_preserved(self):
        self.env['OFFICE_USER_IDS'] = '1'
        self.assertEqual(self.validate()['OFFICE_USER_IDS'], '1')
        self.assertEqual(validator.validate_user_scope('1'), ('1',))

    def test_all_nonempty_profile_subsets_are_accepted(self):
        from itertools import combinations
        for size in range(1, 5):
            for subset in combinations(('1', '4', '7', '8'), size):
                value = ','.join(subset)
                self.env['OFFICE_USER_IDS'] = value
                with self.subTest(scope=value):
                    self.assertEqual(self.validate()['OFFICE_USER_IDS'], value)
        # Canonical applies to the IDs, not a forced sorting/rewrite of CSV.
        self.env['OFFICE_USER_IDS'] = '8,4'
        self.assertEqual(self.validate()['OFFICE_USER_IDS'], '8,4')

    def test_user_outside_profile_is_rejected(self):
        for value in ('2', '1,2', '1,4,7,8,2', '1,9', '9999999999999999999999999'):
            self.env['OFFICE_USER_IDS'] = value
            with self.subTest(scope=value), self.assertRaises(ValueError):
                self.validate()

    def test_empty_profile_is_rejected(self):
        for value in ('', "''", ',', '1,', ',1', '1,,4'):
            self.env['OFFICE_USER_IDS'] = value
            with self.subTest(scope=value), self.assertRaises(ValueError):
                self.validate()
        with self.assertRaises(ValueError):
            validator.validate_user_scope('')

    def test_duplicate_profile_is_rejected(self):
        for value in ('1,1', '1,4,7,8,1', '4,7,4', '8,8'):
            self.env['OFFICE_USER_IDS'] = value
            with self.subTest(scope=value), self.assertRaises(ValueError):
                self.validate()

    def test_noncanonical_user_ids_are_rejected(self):
        for value in ('01', '1,04,7,8', '+1', '-1', '0', '1.0', '1e0',
                      '１', '١', '1;4', '1, 4', '"1, 4"', '" 1"', '"1 "'):
            self.env['OFFICE_USER_IDS'] = value
            with self.subTest(scope=value), self.assertRaises(ValueError):
                self.validate()

    def test_missing_scope_does_not_silently_default_or_widen(self):
        del self.env['OFFICE_USER_IDS']
        with self.assertRaises(ValueError):
            self.validate()

    def test_installation_one_gate_remains_unchanged(self):
        self.assertEqual(self.validate()['OFFICE_INSTALLATION_ID'], '1')
        for value in ('2', '01', '1,2', "''"):
            self.env['OFFICE_INSTALLATION_ID'] = value
            with self.subTest(installation=value), self.assertRaises(ValueError):
                self.validate()

    def test_example_uses_four_user_profile_and_keeps_evidence_gates_closed(self):
        text = (ROOT / 'deploy/office/env.example').read_text()
        self.assertIn('\nOFFICE_USER_IDS=1,4,7,8\n', text)
        self.assertIn('\nOFFICE_INSTALLATION_ID=1\n', text)
        for name in ('OFFICE_CLIENT_MIGRATION_APPROVED', 'OFFICE_FIREWALL_AUDITED',
                     'OFFICE_BACKUP_VERIFIED'):
            self.assertIn('\n' + name + '=0\n', text)

    def test_each_evidence_gate_is_still_required_for_four_user_profile(self):
        names = ('OFFICE_CLIENT_MIGRATION_APPROVED', 'OFFICE_FIREWALL_AUDITED',
                 'OFFICE_BACKUP_VERIFIED')
        for name in names:
            self.env[name] = '1'
        self.assertEqual(self.validate(gates=True)['OFFICE_USER_IDS'], '1,4,7,8')
        for name in names:
            self.env[name] = '0'
            with self.subTest(gate=name), self.assertRaises(ValueError):
                self.validate(gates=True)
            self.env[name] = '1'

    def test_scope_port_and_evidence_gate_rejected_by_default(self):
        with self.assertRaises(ValueError):
            self.validate(gates=True)
        for name in ('OFFICE_CLIENT_MIGRATION_APPROVED', 'OFFICE_FIREWALL_AUDITED', 'OFFICE_BACKUP_VERIFIED'):
            self.env[name] = '1'
        self.validate(gates=True)
        self.env['OFFICE_USER_IDS'] = '1,2'
        with self.assertRaises(ValueError):
            self.validate()
        self.env['OFFICE_USER_IDS'] = '1'
        self.env['OFFICE_APP_PORT'] = '19001'
        with self.assertRaises(ValueError):
            self.validate()

    def test_cannot_use_ca_private_key_as_trust_bundle(self):
        write(self.root, 'upstream-ca.pem', '-----BEGIN CERTIFICATE-----\n-----BEGIN PRIVATE KEY-----')
        with self.assertRaises(ValueError):
            self.validate()

    def test_admin_hash_dollars_loaded_literally_without_compose(self):
        value = 'scrypt:32768:8:1$SyntheticSalt00000000$' + '0' * 128
        secret = write(self.root, 'admin.hash', value)
        secret.chmod(0o400)
        self.assertEqual(entrypoint.secret_file(secret), value)
        secret.chmod(0o444)
        with self.assertRaises(SystemExit):
            entrypoint.secret_file(secret)

    def test_startup_requires_registered_routes_and_enabled_office(self):
        value = 'scrypt:32768:8:1$SyntheticSalt00000000$' + '0' * 128
        secret = write(self.root, 'admin.hash', value)
        secret.chmod(0o600)
        security = types.SimpleNamespace(is_production_mode=lambda: True,
                                         is_strong_secret=lambda x: len(x) >= 24,
                                         is_strong_drawer_pass=lambda x: len(x) >= 8)
        office_security = types.SimpleNamespace(strong_password_hash=lambda x: '$' in x)
        app = types.SimpleNamespace(app=types.SimpleNamespace(url_map=types.SimpleNamespace(iter_rules=lambda: [])))
        env = {**self.env, 'OFFICE_ENABLED': '1', 'OFFICE_ADMIN_PASSWORD_HASH_FILE': str(secret)}
        with patch.dict(os.environ, env), patch.dict(sys.modules, {'app': app, 'security_utils': security, 'office_security': office_security}):
            with self.assertRaises(SystemExit) as error:
                entrypoint.prepare_web()
            self.assertIn('route registration incomplete', str(error.exception))
            os.environ['OFFICE_ENABLED'] = '0'
            with self.assertRaises(SystemExit) as error:
                entrypoint.prepare_web()
            self.assertIn('OFFICE_ENABLED=1', str(error.exception))


class VolumeRoundtripTests(unittest.TestCase):
    def test_temporary_sqlite_and_atomic_snapshot_backup_restore(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = root / 'source'; target = root / 'target'
            source.mkdir(); target.mkdir()
            db = sqlite3.connect(source / 'office-config.sqlite3')
            db.execute('CREATE TABLE config_versions(version INTEGER, alias TEXT)')
            db.execute('INSERT INTO config_versions VALUES (1, "fixture-seat")')
            db.commit(); db.close()
            write(source, 'office-snapshot.json', json.dumps({'generated_at': '2026-10-04T00:00:00Z', 'fixture': True}))
            archive = root / 'office.tar.gz'
            volumes.backup(source, archive, approved_source=source)
            write(target, 'old-private.txt', 'previous-state')
            volumes.restore(archive, target, expected_mount=target)
            self.assertFalse((target / 'old-private.txt').exists())
            self.assertEqual((source / 'office-snapshot.json').read_bytes(), (target / 'office-snapshot.json').read_bytes())
            db = sqlite3.connect(target / 'office-config.sqlite3')
            self.assertEqual(db.execute('SELECT version,alias FROM config_versions').fetchall(), [(1, 'fixture-seat')])
            db.close()
            self.assertEqual(archive.stat().st_mode & 0o777, 0o600)

    def test_corrupt_sqlite_archive_never_deletes_previous_data(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); target = root / 'target'; target.mkdir()
            old = write(target, 'previous.json', 'preserved')
            archive = root / 'bad.tar.gz'
            with tarfile.open(archive, 'w:gz') as tar:
                data = b'not-a-database'
                member = tarfile.TarInfo('office-config.sqlite3'); member.size = len(data)
                tar.addfile(member, io.BytesIO(data))
            with self.assertRaises(sqlite3.DatabaseError):
                volumes.restore(archive, target, expected_mount=target)
            self.assertEqual(old.read_text(), 'preserved')
            self.assertEqual(list(target.iterdir()), [old])

    def test_unsafe_archive_never_deletes_previous_data(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); target = root / 'target'; target.mkdir()
            old = write(target, 'previous.json', 'preserved')
            archive = root / 'bad.tar.gz'
            with tarfile.open(archive, 'w:gz') as tar:
                tar.addfile(tarfile.TarInfo('../escape'))
            with self.assertRaises(ValueError):
                volumes.restore(archive, target, expected_mount=target)
            self.assertEqual(old.read_text(), 'preserved')



class GuardTests(unittest.TestCase):
    def setUp(self):
        self.calls = []
        self.authenticated = False
        self.token = 'synthetic-csrf-token'
        self.probe_failure = False

        def app(environ, start_response):
            path = environ['PATH_INFO']
            self.calls.append(path)
            if path == '/api/office/admin/config':
                status, data = ('200 OK', {}) if self.authenticated else ('401 Unauthorized', {})
                if self.probe_failure:
                    status, data = '404 Not Found', {}
            elif path == '/api/office/admin/session':
                status, data = '200 OK', {'authenticated': self.authenticated, 'csrf_token': self.token}
            else:
                status, data = '200 OK', {'path': path}
            start_response(status, [('Content-Type', 'application/json')])
            return [json.dumps(data).encode()]
        self.guard = guard_module.CompatibilityGuard(app)

    def request(self, path, method='GET', secure=True, origin=None, token=None):
        env = {'PATH_INFO': path, 'REQUEST_METHOD': method, 'wsgi.url_scheme': 'https' if secure else 'http',
               'wsgi.input': io.BytesIO(b'{}'), 'CONTENT_LENGTH': '2'}
        if origin is not None:
            env['HTTP_ORIGIN'] = origin
        if token is not None:
            env['HTTP_X_CSRF_TOKEN'] = token
        status = []
        result = self.guard(env, lambda s, h: status.append(s))
        return int(status[0].split()[0]), json.loads(b''.join(result))

    def test_legacy_anonymous_denied_http_and_https(self):
        for path in ('/set_state', '/status', '/assets/list', '/asset-editor/auth', '/legacy', '/static/old.png'):
            with self.subTest(path=path):
                self.assertEqual(self.request(path)[0], 401)
                self.assertEqual(self.request(path, secure=False)[0], 403)

    def test_public_and_new_api_forward_to_backend_guards(self):
        for path in ('/health', '/api/office/snapshot', '/api/office/admin/users'):
            self.assertEqual(self.request(path)[0], 200)
        self.assertEqual(self.calls, ['/health', '/api/office/snapshot', '/api/office/admin/users'])

    def test_authenticated_legacy_read(self):
        self.authenticated = True
        self.assertEqual(self.request('/status')[0], 200)
        self.assertEqual(self.calls, ['/api/office/admin/config', '/status'])

    def test_legacy_writes_require_origin_and_csrf(self):
        self.authenticated = True
        self.assertEqual(self.request('/set_state', 'POST')[0], 403)
        self.assertEqual(self.request('/set_state', 'POST', origin='https://evil.invalid', token=self.token)[0], 403)
        origin = 'https://192.168.100.221:19443'
        self.assertEqual(self.request('/set_state', 'POST', origin=origin, token='wrong')[0], 403)
        self.assertEqual(self.request('/set_state', 'POST', origin=origin, token=self.token)[0], 200)

    def test_cookie_scoped_compat_namespace_rewrites_legacy_path(self):
        self.authenticated = True
        path = '/api/office/admin/compat/set_state'
        self.assertEqual(self.request(path, 'POST', origin='https://192.168.100.221:19443', token=self.token)[0], 200)
        self.assertEqual(self.calls[-1], '/set_state')
        self.assertEqual(self.request('/api/office/admin/compat/api/office/admin/users')[0], 404)

    def test_backend_not_integrated_fails_closed(self):
        self.authenticated = True
        self.probe_failure = True
        self.assertEqual(self.request('/set_state', 'POST')[0], 401)
        self.assertNotIn('/set_state', self.calls)

    def test_local_never_served_even_authenticated(self):
        self.authenticated = True
        for path in ('/local', '/local/secret', '/api/office/admin/compat/local/secret'):
            self.assertEqual(self.request(path)[0], 404)


class ImageProvenanceTest(unittest.TestCase):
    def test_host_nginx_wrapper_and_exact_root_index_regressions(self):
        wrapper=(ROOT/'deploy/office/nginx-isolated.conf.template').read_text()
        self.assertIn('lua_package_path "/www/server/nginx/lib/lua/?.lua;;";',wrapper)
        rule=(ROOT/'deploy/office/nginx.conf.template').read_text()
        self.assertEqual(rule.count('try_files /static/releases/@RELEASE_ID@/office/index.html =404;'),2)
        self.assertNotIn('alias /opt/star-office-ui/releases/@RELEASE_ID@/public/static/releases/@RELEASE_ID@/office/index.html;',rule)

    def test_extensionless_admin_proxy_renders_dynamic_boot(self):
        rule = (ROOT / 'deploy/office/nginx.conf.template').read_text()
        admin = rule.split('    location = /admin {', 1)[1].split('    }', 1)[0]
        self.assertIn('proxy_pass http://127.0.0.1:@APP_PORT@/admin;', admin)
        self.assertIn('proxy_set_header X-Forwarded-Proto http;', admin)
        self.assertIn('limit_except GET { deny all; }', admin)
        self.assertIn('add_header X-Content-Type-Options nosniff always;', admin)

    def test_offline_build_streams_actual_release_context_and_verifies_image(self):
        code=(ROOT/'deploy/office/build_offline.sh').read_text()
        self.assertIn('tar -C "$release" -cf - . | docker build --no-cache --pull=false --network=none',code)
        self.assertIn('/app/deploy/office/verify_image.py',code)

    def test_equal_size_stale_image_bytes_are_rejected(self):
        module=load('image_provenance', ROOT / 'deploy/office/verify_image.py')
        with tempfile.TemporaryDirectory() as d:
            root=Path(d); (root/'frontend').mkdir(); (root/'frontend/copy.mjs').write_text('V4')
            manifest=root/'manifest.json'; manifest.write_text(json.dumps({'release_id':'test','source_files':[{'path':'frontend/copy.mjs','sha256':hashlib.sha256(b'V5').hexdigest(),'bytes':2}]}))
            with self.assertRaises(ValueError): module.verify(root,manifest)
            (root/'frontend/copy.mjs').write_text('V5')
            self.assertTrue(module.verify(root,manifest)['source_bytes_match'])


class V5ReferenceScannerTest(unittest.TestCase):
    def test_monitor_terminal_content_is_not_a_runtime_dependency(self):
        module = load('v5_reference_scanner', ROOT / 'scripts/package_office_release.py')
        values = list(module.quoted_references("const terminal='> node dist/index.js'; import './runtime.mjs';"))
        self.assertEqual(values, ['./runtime.mjs'])


if __name__ == '__main__':
    unittest.main(verbosity=2)
