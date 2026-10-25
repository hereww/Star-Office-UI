"""Workstation character selection: validation, versioned storage and public projection."""
from __future__ import annotations
import copy
import tempfile
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend.office_contract import ContractError, public_snapshot, validate_config
from backend.office_collector import empty_snapshot
from backend.office_store import OfficeStore, VersionConflict
from backend.office_characters import public_character_profile


class BindingCharacterTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.now = 1791820800.0
        self.store = OfficeStore(Path(self.temp.name) / 'config.sqlite3', clock=lambda: self.now, allowed_user_ids=('1', '4'))

    def config(self):
        stored = self.store.read_config()
        return {key: copy.deepcopy(stored[key]) for key in ('bindings', 'display', 'collection', 'appearance', 'room_characters')}

    def test_legacy_binding_remains_implicit_without_new_history(self):
        before = self.store.read_config()
        history = self.store.history()
        normalized = validate_config(self.config())
        self.assertEqual(normalized['bindings'], before['bindings'])
        self.assertTrue(all('character_profile_id' not in row for row in normalized['bindings']))
        self.assertEqual(self.store.read_config(), before)
        self.assertEqual(self.store.history(), history)

    def test_explicit_role_save_readback_conflict_and_legacy_restore(self):
        value = self.config()
        value['bindings'][0]['character_profile_id'] = 'orange-cat-v1'
        saved = self.store.save_config(1, value)
        self.assertEqual(saved['version'], 2)
        self.assertEqual(self.store.read_config(), saved)
        self.assertEqual(saved['bindings'][0]['character_profile_id'], 'orange-cat-v1')
        self.assertTrue(all('character_profile_id' not in row for row in saved['bindings'][1:]))
        with self.assertRaises(VersionConflict):
            self.store.save_config(1, value)
        self.assertEqual(self.store.read_config(), saved)
        restored = self.store.restore_config(2, 1)
        self.assertEqual(restored['version'], 3)
        self.assertTrue(all('character_profile_id' not in row for row in restored['bindings']))

    def test_all_ready_profiles_save_globally_and_per_binding(self):
        from backend.office_characters import public_character_profiles
        profiles = public_character_profiles()
        self.assertEqual(len(profiles), 8)
        for profile in profiles:
            with self.subTest(profile=profile['id']):
                self.assertTrue(profile['assignable'] and profile['production_ready'])
                before = self.store.read_config()
                value = self.config()
                value['appearance']['character_profile_id'] = profile['id']
                value['bindings'][0]['character_profile_id'] = profile['id']
                saved = self.store.save_config(before['version'], value)
                self.assertEqual(self.store.read_config(), saved)
                self.assertEqual(saved['appearance']['character_profile_id'], profile['id'])
                self.assertEqual(saved['bindings'][0]['character_profile_id'], profile['id'])
                snapshot = public_snapshot(saved, empty_snapshot(), self.now)
                self.assertEqual(snapshot['appearance']['character_profile_id'], profile['id'])
                self.assertTrue(all(s['character_profile_id'] == profile['id'] for s in snapshot['stations']))

    def test_candidates_unknown_ids_paths_and_nonstring_roles_cannot_save(self):
        before = self.store.read_config()
        for profile in ('unready-cat-fixture', 'missing-cat', '../../private/token', '', None, [], {}, 1, False):
            with self.subTest(profile=profile):
                value = self.config()
                value['bindings'][0]['character_profile_id'] = profile
                with self.assertRaisesRegex(ContractError, 'invalid_binding_character_profile'):
                    self.store.save_config(1, value)
                self.assertEqual(self.store.read_config(), before)
        self.assertEqual(len(self.store.history()['versions']), 1)

    def test_optional_role_does_not_allow_unknown_binding_fields(self):
        value = self.config()
        value['bindings'][0]['asset_path'] = '/private/secret'
        with self.assertRaisesRegex(ContractError, 'invalid_binding'):
            validate_config(value)
        del value['bindings'][0]['asset_path']
        del value['bindings'][0]['enabled']
        with self.assertRaisesRegex(ContractError, 'invalid_binding'):
            validate_config(value)

    def test_per_seat_projection_and_unsafe_role_fallback(self):
        value = self.store.read_config()
        first = value['bindings'][0]
        first['character_profile_id'] = 'fixture-blue-cat'
        # A second ready profile exists only in this isolated test. No asset or
        # production catalog changes are made to enable unreviewed characters.
        def profile_for(identifier):
            if identifier == 'fixture-blue-cat':
                return {'id': identifier, 'label': 'fixture blue', 'status': 'ready'}
            return public_character_profile(identifier)
        with patch('backend.office_contract.is_assignable_character_profile', side_effect=lambda v: isinstance(v, str) and v in ('orange-cat-v1', 'fixture-blue-cat')), patch('backend.office_contract.public_character_profile', side_effect=profile_for):
            snap = public_snapshot(value, empty_snapshot(), self.now)
        assigned = next(row for row in snap['stations'] if row['seat_id'] == first['seat_id'])
        self.assertEqual(assigned['character_profile_id'], 'fixture-blue-cat')
        self.assertEqual(assigned['character_label'], 'fixture blue')
        self.assertTrue(all(row['character_profile_id'] == 'orange-cat-v1' for row in snap['stations'] if row['seat_id'] != first['seat_id']))
        self.assertEqual(snap['appearance']['character_profile_id'], 'orange-cat-v1')
        first['character_profile_id'] = 'unready-cat-fixture'
        safe = public_snapshot(value, empty_snapshot(), self.now)
        self.assertTrue(all(row['character_profile_id'] == 'orange-cat-v1' for row in safe['stations']))
        first['enabled'] = False
        safe = public_snapshot(value, empty_snapshot(), self.now)
        self.assertFalse(next(row for row in safe['stations'] if row['seat_id'] == first['seat_id'])['bound'])


if __name__ == '__main__':
    unittest.main()
