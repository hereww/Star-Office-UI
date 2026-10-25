"""Isolated host routing/security regressions. Never accesses live services/data."""
from __future__ import annotations
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
from werkzeug.security import generate_password_hash

ROOT = Path(__file__).resolve().parents[1]
FIXTURE_PASSWORD = 'SyntheticIntegrationOnly!2026'
FIXTURE_HASH = generate_password_hash(FIXTURE_PASSWORD, method='scrypt:32768:8:1')
BASE = 'https://office.integration.invalid:19443'


class HostIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.addClassCleanup(cls.temp.cleanup)
        cls.data = Path(cls.temp.name)
        cls.env = patch.dict(os.environ, {
            'OFFICE_ENABLED': '1', 'OFFICE_USER_IDS': '1,4,7,8', 'OFFICE_RELEASE_ID': 'routing-test-v1',
            'STAR_OFFICE_ENV': 'production', 'STAR_OFFICE_DATA_DIR': str(cls.data / 'legacy'),
            'OFFICE_DATA_DIR': str(cls.data / 'office'), 'OFFICE_ADMIN_USERNAME': 'admin',
            'OFFICE_ADMIN_PASSWORD_HASH': FIXTURE_HASH,
            'OFFICE_ADMIN_SECRET': 'SyntheticSession-' + 'a017b49c823d04fe' * 4,
            'FLASK_SECRET_KEY': 'SyntheticFlask-' + 'b134f0579c024dea' * 4,
            'ASSET_DRAWER_PASS': 'SyntheticLegacyOnly!2026',
            'OFFICE_PREVIEW_FIXTURE': '1',
        })
        cls.env.start(); cls.addClassCleanup(cls.env.stop)
        sys.path.insert(0, str(ROOT / 'backend'))
        cls.addClassCleanup(lambda: sys.path.remove(str(ROOT / 'backend')))
        spec = importlib.util.spec_from_file_location('office_host_integration', ROOT / 'backend/app.py')
        cls.module = importlib.util.module_from_spec(spec); spec.loader.exec_module(cls.module)
        cls.app = cls.module.app; cls.app.config['TESTING'] = True

    def setUp(self):
        self.client = self.app.test_client()

    def login(self):
        bootstrap = self.client.get('/api/office/admin/session', base_url=BASE).get_json()
        response = self.client.post('/api/office/admin/session', base_url=BASE,
            json={'username': 'admin', 'password': FIXTURE_PASSWORD},
            headers={'Origin': BASE, 'X-CSRF-Token': bootstrap['csrf_token']})
        self.assertEqual(response.status_code, 200, response.get_json())
        return response.get_json()['csrf_token']

    def test_employee_page_is_new_and_no_production_fixture_badge(self):
        response = self.client.get('/', base_url='http://office.integration.invalid:19000')
        self.assertEqual(response.status_code, 200)
        html = response.get_data(as_text=True)
        self.assertIn('\"release_prefix\": \"/static/releases/routing-test-v1\"', html)
        self.assertIn("await import(new URL('bootstrap.mjs', base))", html)
        self.assertIn('"mode": "employee"', html)
        self.assertIn('"preview_fixture": false', html)
        self.assertNotIn('{{OFFICE_', html)
        self.assertIn('no-store', response.headers['Cache-Control'])

    def test_admin_html_requires_tls_but_not_prior_login(self):
        self.assertEqual(self.client.get('/admin', base_url='http://office.integration.invalid:19000').status_code, 403)
        self.assertEqual(self.client.get('/admin', base_url=BASE).status_code, 200)
        self.assertEqual(self.client.get('/api/office/admin/users', base_url=BASE).status_code, 401)

    def test_public_snapshot_is_sanitized_and_unavailable_is_unknown(self):
        response = self.client.get('/api/office/snapshot', base_url='http://office.integration.invalid:19000')
        self.assertEqual(response.status_code, 200)
        value = response.get_json(); self.assertEqual(len(value['stations']), 16)
        self.assertEqual(value['summary']['bound'], 4)
        self.assertEqual(value['summary']['unknown'], 4)
        for station in value['stations']:
            self.assertFalse({'user_id', 'email', 'api_keys', 'token_usage'} & station.keys())
            self.assertIsNone(station['username'])
            self.assertEqual(station['identity_quality'], 'unavailable' if station['bound'] else 'unbound')
            self.assertIsNone(station['identity_observed_at'])
        self.assertIn('no-store', response.headers['Cache-Control'])

    def test_static_versions_are_same_origin_resources_and_private_paths_fail_closed(self):
        for path in ['office/bootstrap.mjs', 'office/character-concepts.html', 'office/media/character-breed-candidates/ragdoll-v1.png', 'company-office/connected-v4/telemetry-adapter.mjs', 'vendor/phaser-3.80.1.min.js']:
            response = self.client.get('/static/releases/routing-test-v1/' + path, base_url=BASE)
            self.assertEqual(response.status_code, 200, path)
            response.close()
        for path in ['office/.local/tests/fixtures.mjs', '../state.json', 'office/admin.html', 'office/tests/fixtures.mjs', 'company-office/../../state.json']:
            self.assertEqual(self.client.get('/static/releases/routing-test-v1/' + path, base_url=BASE).status_code, 404, path)
        self.assertNotEqual(self.client.get('/static/releases/unknown/office/bootstrap.mjs', base_url=BASE).status_code, 200)

    def test_employee_origin_blocks_all_legacy_reads_and_writes(self):
        for path, method in [('/status', 'GET'), ('/agents', 'GET'), ('/legacy', 'GET'),
                            ('/yesterday-memo', 'GET'), ('/static/index.html', 'GET'), ('/set_state', 'POST')]:
            response = self.client.open(path, method=method, base_url='http://office.integration.invalid:19000')
            self.assertGreaterEqual(response.status_code, 400, path)

    def test_tls_legacy_reads_require_office_session(self):
        self.assertEqual(self.client.get('/legacy', base_url=BASE).status_code, 401)
        self.login()
        self.assertEqual(self.client.get('/legacy', base_url=BASE).status_code, 200)
        self.assertEqual(self.client.get('/status', base_url=BASE).status_code, 200)
        self.assertEqual(self.client.post('/set_state', base_url=BASE, json={'state': 'idle'}).status_code, 403)

    def test_minimal_release_without_legacy_html_fails_safely_not_500(self):
        self.login()
        with patch.object(self.module, 'FRONTEND_INDEX_FILE', str(self.data / 'not-packaged.html')), patch.object(self.module, '_INDEX_HTML_CACHE', None):
            response = self.client.get('/legacy', base_url=BASE)
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.get_json()['error']['code'], 'LEGACY_UI_NOT_PACKAGED')
        self.assertNotIn(str(self.data), response.get_data(as_text=True))

    def test_login_cookie_is_hardened_and_writes_reject_other_origin(self):
        bootstrap = self.client.get('/api/office/admin/session', base_url=BASE)
        cookie = bootstrap.headers['Set-Cookie']
        for attr in ['Secure', 'HttpOnly', 'SameSite=Lax']:
            self.assertIn(attr, cookie)
        csrf = self.login()
        response = self.client.post('/api/office/admin/config/restore', base_url=BASE,
            headers={'Origin': 'https://wrong.invalid', 'X-CSRF-Token': csrf},
            json={'expected_version': 1, 'target_version': 1})
        self.assertEqual(response.status_code, 403)

    def test_forwarded_tls_only_applies_to_the_reviewed_proxy_hop(self):
        response = self.client.get('/admin', base_url='http://localhost:19011',
            headers={'X-Forwarded-Proto': 'https', 'X-Forwarded-Host': 'office.integration.invalid:19443'})
        self.assertEqual(response.status_code, 200)
        # Deployment MUST keep 19011 private; only the Nginx hop may supply these headers.

    def test_boot_json_cannot_break_out_of_script(self):
        with patch.dict(os.environ, {'OFFICE_ADMIN_URL': '</script><script>alert(1)</script>'}):
            html = self.client.get('/', base_url=BASE).get_data(as_text=True)
        self.assertNotIn('</script><script>alert(1)', html)
        self.assertIn('\\u003c/script\\u003e', html)


if __name__ == '__main__':
    unittest.main()
