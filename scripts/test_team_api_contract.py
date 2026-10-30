"""Validate the handoff artifacts against actual API responses (development deps)."""
import json
import re
import stat
import subprocess
import sys
import unittest
from datetime import datetime
from pathlib import Path

import yaml
from jsonschema import Draft202012Validator, FormatChecker

from backend.team_telemetry import normalize_observation
from scripts.test_team_telemetry import TeamTelemetryTests, observation

ROOT = Path(__file__).resolve().parents[1]


class HandoffContractTests(TeamTelemetryTests):
    def test_openapi_matches_request_examples_and_actual_responses(self):
        spec = self.client.get('/api/v1/openapi.json').get_json()
        self.assertEqual(spec, json.loads((ROOT / 'api_service/openapi.json').read_text()))
        def validate(value, schema):
            schema = {**schema, 'components': spec['components']}
            Draft202012Validator.check_schema(schema)
            Draft202012Validator(schema, format_checker=FormatChecker()).validate(value)
        post = spec['paths']['/api/v1/projects/{project_id}/telemetry']['post']
        payload = observation()
        validate(payload, spec['components']['schemas']['Observation'])
        for response in (self.post(payload), self.post(payload)):
            self.assertIn(response.status_code, (200, 201))
            validate(response.get_json(), post['responses'][str(response.status_code)]['content']['application/json']['schema'])
        snapshot = self.snapshot().get_json()
        validate(snapshot, spec['paths']['/api/v1/projects/{project_id}/snapshot']['get']['responses']['200']['content']['application/json']['schema'])
        for response in (self.post({}, key=''), self.post({}, project='other'), self.post({}),
                         self.post({**payload, 'service_state': 'degraded'})):
            validate(response.get_json(), post['responses'][str(response.status_code)]['content']['application/json']['schema'])
        blocks = re.findall(r'```json\n(.*?)\n```', (ROOT / 'docs/API_DEVELOPMENT.md').read_text(), re.S)
        full, unknown, success = map(json.loads, blocks)
        validate(full, spec['components']['schemas']['Observation'])
        now = datetime.fromisoformat(full['observed_at'].replace('Z', '+00:00')).timestamp()
        normalize_observation(full, now=now)
        validate({**full, **unknown}, spec['components']['schemas']['Observation'])
        normalize_observation({**full, **unknown}, now=now)
        validate(success, post['responses']['201']['content']['application/json']['schema'])

    def test_bootstrap_has_separate_permissions_and_never_overwrites(self):
        target = self.root / 'bootstrap'
        command = [sys.executable, str(ROOT / 'api-service/bootstrap.py'), '--output', str(target)]
        result = subprocess.run(command, capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)
        before = {p.name: p.read_bytes() for p in target.iterdir()}
        for path in target.iterdir():
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
        keys = json.loads(before['api-project-keys.json'])
        self.assertEqual([r['permissions'] for r in keys], [['telemetry:write'], ['telemetry:read']])
        self.assertNotEqual(keys[0]['key'], keys[1]['key'])
        self.assertNotIn(keys[0]['key'], result.stdout + result.stderr)
        self.assertNotIn(keys[1]['key'], result.stdout + result.stderr)
        self.assertEqual(json.loads(before['producer.json'])['key'], keys[0]['key'])
        repeated = subprocess.run(command, capture_output=True, text=True, timeout=10)
        self.assertNotEqual(repeated.returncode, 0)
        self.assertEqual(before, {p.name: p.read_bytes() for p in target.iterdir()})

    def test_compose_and_document_links_form_a_standalone_handoff(self):
        compose = yaml.safe_load((ROOT / 'api-service/compose.yaml').read_text())
        services = compose['services']
        self.assertEqual(set(services), {'telemetry-api', 'office-web', 'office-collector'})
        self.assertEqual(services['telemetry-api']['environment']['API_AUTH_MODE'], 'key')
        for name in ('office-web', 'office-collector'):
            env = services[name]['environment']
            self.assertEqual(env['OFFICE_TELEMETRY_PROVIDER'], 'standalone')
            self.assertIn('OFFICE_SUBJECTS_FILE', env)
            self.assertFalse(any('SUB2API' in key or key == 'OFFICE_CREDENTIAL_FILE' for key in env))
        for name in ('API_DEVELOPMENT.md', 'TEAM_API_OPERATIONS.md'):
            path = ROOT / 'docs' / name
            for link in re.findall(r'\]\(([^)#]+)(?:#[^)]*)?\)', path.read_text()):
                if '://' not in link:
                    self.assertTrue((path.parent / link).is_file(), link)


def load_tests(loader, tests, pattern):
    return unittest.TestSuite(HandoffContractTests(name) for name in HandoffContractTests.__dict__ if name.startswith('test_'))
