"""Live model projection tests; no production requests or credentials."""
import copy
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend.office_contract import normalize_active_models, public_snapshot, utc_iso, validate_telemetry_page
from backend.office_collector import atomic_snapshot, read_snapshot
from backend.office_store import OfficeStore
from scripts.test_office_collector import NOW, four_user_fixture


def active(models=None, now=NOW, quality='partial'):
    return {'models': models if models is not None else [
        {'requested_model': 'gpt-6.1-sol', 'upstream_model': 'gpt-6.1-sol', 'requests': 2},
        {'requested_model': 'friendly-model', 'upstream_model': 'actual-upstream', 'requests': 1},
    ], 'quality': quality, 'observed_at': utc_iso(now)}


class ActiveModelsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.config = OfficeStore(self.root / 'config.sqlite3', clock=lambda: NOW).read_config()
        self.snapshot = four_user_fixture()
        self.snapshot['users'][0]['active_models'] = active()

    def project(self, now=NOW):
        return public_snapshot(self.config, self.snapshot, now)['stations'][11]['active_models']

    def test_collector_disk_read_roundtrip_preserves_only_model_allowlist(self):
        raw = self.snapshot['users'][0]['active_models']
        raw['private'] = 'secret-sentinel'
        raw['models'][0]['prompt'] = 'secret-sentinel'
        path = self.root / 'snapshot.json'
        page = validate_telemetry_page({**self.snapshot, 'next_cursor': None}, {'1', '4', '7', '8'})
        self.snapshot['users'] = page['users']
        atomic_snapshot(path, self.snapshot)
        stored = read_snapshot(path)
        self.assertEqual(stored['users'][0]['active_models'], active())
        self.assertNotIn('secret-sentinel', str(stored))

    def test_public_projection_keeps_multiple_requests_and_lossless_counts(self):
        self.snapshot['users'][0]['active_models']['models'][0]['requests'] = 9223372036854775807
        result = self.project()
        self.assertEqual(result['quality'], 'partial')
        self.assertEqual(result['models'][0]['requests'], '9223372036854775807')
        self.assertEqual(result['models'][1]['upstream_model'], 'actual-upstream')

    def test_model_clock_expires_while_other_metrics_stay_fresh(self):
        self.snapshot['users'][0]['active_models'] = active(now=NOW - 15)
        result = self.project()
        self.assertEqual(result['models'], [])
        self.assertEqual(result['quality'], 'stale')
        wire = public_snapshot(self.config, self.snapshot, NOW)
        self.assertEqual(wire['source']['status'], 'ok')
        self.assertEqual(wire['stations'][11]['activity'], 'busy')

    def test_source_failure_or_expiry_clears_previous_models(self):
        self.snapshot['connection']['status'] = 'unknown'
        self.assertEqual(self.project()['quality'], 'unavailable')
        self.assertEqual(self.project()['models'], [])
        self.snapshot['connection']['status'] = 'ok'
        self.assertEqual(self.project(now=NOW + 15)['quality'], 'stale')
        self.assertEqual(self.project(now=NOW + 15)['models'], [])

    def test_unbound_user_is_hidden_even_with_injected_models(self):
        wire = public_snapshot(self.config, self.snapshot, NOW)
        self.assertEqual(wire['stations'][0]['active_models'], {'models': [], 'quality': 'unbound', 'observed_at': None})

    def test_empty_live_list_preserves_partial_coverage(self):
        self.snapshot['users'][0]['active_models'] = active(models=[])
        self.assertEqual(self.project(), {'models': [], 'quality': 'partial', 'observed_at': utc_iso(NOW)})

    def test_legacy_missing_field_stays_unknown(self):
        self.snapshot['users'][0].pop('active_models')
        self.assertEqual(self.project()['quality'], 'unavailable')
        self.assertEqual(self.project()['models'], [])

    def test_future_observation_is_not_current(self):
        self.snapshot['users'][0]['active_models'] = active(now=NOW + 1)
        self.assertEqual(self.project()['quality'], 'stale')

    def test_optional_malformed_extension_does_not_break_collection(self):
        cases = [None, {}, {'quality': 'partial', 'models': []}, active(quality='unknown'), active(models={})]
        for value in [True, 0, -1, 1.5, '2', 9223372036854775808]:
            entry = active(); entry['models'][0]['requests'] = value; cases.append(entry)
        for name in ['', ' padded', 'a' * 201, 'bad\nname', 'bad\x7fname', 'bad\u202ename']:
            entry = active(); entry['models'][0]['requested_model'] = name; cases.append(entry)
        for entry in cases:
            with self.subTest(entry=entry):
                self.assertEqual(normalize_active_models(entry)['quality'], 'unavailable')
                raw = copy.deepcopy(self.snapshot); raw['users'][0]['active_models'] = entry
                page = validate_telemetry_page({**raw, 'next_cursor': None}, {'1', '4', '7', '8'})
                self.assertEqual(len(page['users']), 4)
                self.assertEqual(page['users'][0]['concurrency']['current'], 3)

    def test_unresolved_upstream_keeps_requested_model(self):
        self.snapshot['users'][0]['active_models'] = active(models=[{'requested_model': 'gpt-6.1-sol', 'upstream_model': None, 'requests': 1}])
        self.assertIsNone(self.project()['models'][0]['upstream_model'])


if __name__ == '__main__':
    unittest.main()
