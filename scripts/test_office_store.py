#!/usr/bin/env python3
"""Isolated SQLite store tests. Writes only TemporaryDirectory fixture data."""
from __future__ import annotations

import copy
import json
import os
import multiprocessing
import sqlite3
import sys
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend.office_contract import ContractError, DEFAULT_DISPLAY, DEFAULT_BINDINGS, DEFAULT_APPEARANCE, DEFAULT_ROOM_CHARACTERS_CONFIG, validate_config
from backend.office_settings import office_data_dir, office_user_ids
from backend.office_store import OfficeStore, VersionConflict, MissingVersion, SessionConflict
from unittest.mock import patch


def writable(config):
    return {k: copy.deepcopy(config[k]) for k in ("bindings", "display", "collection")}


def process_claim(path, ready, results, now):
    store = OfficeStore(path, clock=lambda: now)
    ready.wait(10)
    results.put(store.claim_login_attempt("fixture-shared-peer"))


def process_rotate(path, ready, results, suffix, now):
    store = OfficeStore(path, clock=lambda: now)
    ready.wait(10)
    try:
        store.create_session("fixture-rotated-" + suffix, True, 60, replace_digest="fixture-old")
        results.put("rotated")
    except SessionConflict:
        results.put("revoked")


class StoreTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.now = 1791100800.0
        self.path = Path(self.temp.name) / "office-config.sqlite3"
        self.store = OfficeStore(self.path, clock=lambda: self.now, allowed_user_ids=("1",))

    def test_explicit_scope1_keeps_single_user_desk12_and_fixed_display(self):
        config = self.store.read_config()
        self.assertEqual(config["schema_version"], 1)
        self.assertEqual(config["version"], 1)
        self.assertEqual(config["bindings"], [b for b in DEFAULT_BINDINGS if b["user_id"] == "1"])
        self.assertEqual(config["display"], DEFAULT_DISPLAY)
        self.assertEqual(config["collection"], {"poll_interval_seconds": 5})
        self.assertEqual(self.path.stat().st_mode & 0o777, 0o600)

    def test_room_characters_default_and_versioned_visibility(self):
        config = self.store.read_config()
        self.assertEqual(config["room_characters"], DEFAULT_ROOM_CHARACTERS_CONFIG)
        candidate = {key: copy.deepcopy(config[key]) for key in ("bindings", "display", "collection", "appearance", "room_characters")}
        candidate["room_characters"]["rock"]["performers"]["guitarist-gray"] = False
        saved = self.store.save_config(1, candidate)
        self.assertFalse(saved["room_characters"]["rock"]["performers"]["guitarist-gray"])
        self.assertEqual(self.store.read_config()["version"], 2)
        invalid = copy.deepcopy(saved)
        invalid["room_characters"]["rock"]["performers"]["unknown"] = True
        with self.assertRaises(ContractError):
            self.store.save_config(2, invalid)
        self.assertEqual(self.store.read_config()["version"], 2)

    def test_character_appearance_defaults_and_legacy_readback(self):
        config = self.store.read_config()
        self.assertEqual(config["appearance"], DEFAULT_APPEARANCE)
        legacy = {key: copy.deepcopy(config[key]) for key in ("bindings", "display", "collection")}
        with sqlite3.connect(self.path) as db:
            db.execute("UPDATE config_versions SET payload=? WHERE version=1",
                       (json.dumps(legacy, ensure_ascii=False, separators=(",", ":")),))
        reopened = OfficeStore(self.path, clock=lambda: self.now, allowed_user_ids=("1",))
        self.assertEqual(reopened.read_config()["appearance"], DEFAULT_APPEARANCE)
        self.assertEqual(len(reopened.history()["audit"]), 1)

    def test_unsafe_persisted_appearance_reads_back_as_default_without_history_rewrite(self):
        config = self.store.read_config()
        for unsafe in (
            {"character_profile_id": "unready-cat-fixture", "allow_fallback": False},
            {"character_profile_id": "orange-cat-v1", "allow_fallback": True},
            {"character_profile_id": "unknown-profile", "allow_fallback": False},
        ):
            with self.subTest(unsafe=unsafe):
                legacy = {key: copy.deepcopy(config[key]) for key in ("bindings", "display", "collection")}
                legacy["appearance"] = unsafe
                with sqlite3.connect(self.path) as db:
                    db.execute("UPDATE config_versions SET payload=? WHERE version=1",
                               (json.dumps(legacy, ensure_ascii=False, separators=(",", ":")),))
                reopened = OfficeStore(self.path, clock=lambda: self.now, allowed_user_ids=("1",))
                self.assertEqual(reopened.read_config()["appearance"], DEFAULT_APPEARANCE)
                self.assertEqual(len(reopened.history()["audit"]), 1)

    def test_unready_profile_and_fallback_flag_cannot_be_saved(self):
        config = self.store.read_config()
        candidate = copy.deepcopy(config)
        candidate["appearance"] = {"character_profile_id": "unready-cat-fixture", "allow_fallback": False}
        with self.assertRaises(ContractError):
            self.store.save_config(1, candidate)
        fallback = copy.deepcopy(config)
        fallback["appearance"]["allow_fallback"] = True
        with self.assertRaises(ContractError):
            self.store.save_config(1, fallback)
        self.assertEqual(self.store.read_config()["version"], 1)

    def test_new_default_profile_seeds_four_users_in_layout_order(self):
        with patch.dict(os.environ):
            os.environ.pop("OFFICE_USER_IDS", None)
            store = OfficeStore(Path(self.temp.name) / "four-default.sqlite3", clock=lambda: self.now)
            self.assertEqual(office_user_ids(), ("1", "4", "7", "8"))
        config = store.read_config()
        self.assertEqual(config["bindings"], DEFAULT_BINDINGS)
        self.assertEqual({b["user_id"]: b["seat_id"] for b in config["bindings"]},
                         {"1": "desk-12", "4": "desk-09", "7": "desk-10", "8": "desk-11"})
        self.assertEqual(config["version"], 1)
        self.assertEqual(len(store.history()["audit"]), 1)

    def test_narrow_environment_scope_never_gets_expanded(self):
        for scope, mapping in (("1", {"1": "desk-12"}), ("4,8", {"4": "desk-09", "8": "desk-11"}),
                               ("8", {"8": "desk-11"}), ("42", {})):
            with self.subTest(scope=scope), patch.dict(os.environ, {"OFFICE_USER_IDS": scope}):
                store = OfficeStore(Path(self.temp.name) / (scope.replace(",", "-") + ".sqlite3"))
                self.assertEqual({b["user_id"]: b["seat_id"] for b in store.read_config()["bindings"]}, mapping)

    def test_existing_config_and_audit_are_not_migrated_when_scope_changes(self):
        initial = self.store.read_config()
        value = writable(initial)
        value["bindings"][0]["display_name"] = "既有人工别名"
        value["collection"]["poll_interval_seconds"] = 30
        saved = self.store.save_config(1, value)
        history = self.store.history()
        for profile in ("1,4,7,8", "4", "1"):
            with patch.dict(os.environ, {"OFFICE_USER_IDS": profile}):
                reopened = OfficeStore(self.path)
                self.assertEqual(reopened.read_config(), saved)
                self.assertEqual(reopened.history(), history)

    def test_explicit_scope_argument_overrides_environment_without_widening(self):
        with patch.dict(os.environ, {"OFFICE_USER_IDS": "1,4,7,8"}):
            store = OfficeStore(Path(self.temp.name) / "explicit-one.sqlite3", allowed_user_ids=("1",))
        self.assertEqual([b["user_id"] for b in store.read_config()["bindings"]], ["1"])

    def test_bad_explicit_scope_fails_before_creating_database(self):
        for index, scope in enumerate(("", "1,1", "01", "1, 4", "0", "1,", "admin", "9223372036854775808")):
            path = Path(self.temp.name) / f"invalid-{index}.sqlite3"
            with self.subTest(scope=scope), patch.dict(os.environ, {"OFFICE_USER_IDS": scope}):
                with self.assertRaises(ContractError):
                    OfficeStore(path)
            self.assertFalse(path.exists())
        for value in ((1,), (), ("1", "1"), "1,4"):
            with self.subTest(value=value), self.assertRaises(ContractError):
                OfficeStore(Path(self.temp.name) / "bad-parameter.sqlite3", allowed_user_ids=value)

    def test_save_is_conditional_and_returns_readback(self):
        value = writable(self.store.read_config())
        value["bindings"][0]["display_name"] = "  大整数测试  "
        saved = self.store.save_config(1, value)
        self.assertEqual(saved, self.store.read_config())
        self.assertEqual(saved["version"], 2)
        self.assertEqual(saved["bindings"][0]["display_name"], "大整数测试")
        with self.assertRaises(VersionConflict):
            self.store.save_config(1, value)
        self.assertEqual(self.store.read_config(), saved)

    def test_restart_keeps_config_and_history(self):
        saved = self.store.save_config(1, writable(self.store.read_config()))
        restarted = OfficeStore(self.path)
        self.assertEqual(restarted.read_config(), saved)
        self.assertEqual(len(restarted.history()["audit"]), 2)

    def test_restore_new_version_preserves_history(self):
        initial = self.store.read_config()
        value = writable(initial)
        value["bindings"] = []
        self.store.save_config(1, value)
        restored = self.store.restore_config(2, 1, allowed_new_user_ids={"1"})
        self.assertEqual(restored["version"], 3)
        self.assertEqual(writable(restored), writable(initial))
        h = self.store.history()
        self.assertEqual([r["version"] for r in h["versions"]], [3, 2, 1])
        self.assertEqual(h["audit"][0]["action"], "restore")
        self.assertEqual(h["audit"][0]["restored_from"], 1)

    def test_restore_scope_checked_even_old_bindings(self):
        self.store.save_config(1, writable(self.store.read_config()))
        with self.assertRaises(ContractError):
            self.store.restore_config(2, 1, allowed_new_user_ids=set())
        self.assertEqual(self.store.read_config()["version"], 2)
        self.assertEqual(len(self.store.history()["audit"]), 2)

    def test_unknown_restore_and_conflict_are_noops(self):
        with self.assertRaises(MissingVersion):
            self.store.restore_config(1, 100)
        with self.assertRaises(VersionConflict):
            self.store.restore_config(2, 1)
        self.assertEqual(len(self.store.history()["audit"]), 1)

    def test_cross_worker_writers_one_wins(self):
        value = writable(self.store.read_config())
        barrier = threading.Barrier(2)
        def worker(_):
            store = OfficeStore(self.path)
            barrier.wait()
            try:
                return store.save_config(1, value)["version"]
            except VersionConflict:
                return "conflict"
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(worker, range(2)))
        self.assertCountEqual(results, [2, "conflict"])
        self.assertEqual(len(self.store.history()["audit"]), 2)

    def test_new_user_scope_and_reassignment(self):
        value = writable(self.store.read_config())
        value["bindings"][0]["user_id"] = "42"
        with self.assertRaises(ContractError):
            self.store.save_config(1, value, allowed_new_user_ids={"1"})
        saved = self.store.save_config(1, value, allowed_new_user_ids={"42"})
        self.assertEqual(saved["bindings"][0]["user_id"], "42")

    def test_existing_binding_retained_during_outage(self):
        value = writable(self.store.read_config())
        value["display"]["show_labels"] = False
        self.store.save_config(1, value, allowed_new_user_ids=set())
        value["bindings"][0]["seat_id"] = "desk-01"
        with self.assertRaises(ContractError):
            self.store.save_config(2, value, allowed_new_user_ids=set())

    def test_ids_and_zero_not_coerced(self):
        for uid in (1, True, None, "01", "0", "-1", "9223372036854775808"):
            with self.subTest(uid=uid):
                value = writable(self.store.read_config())
                value["bindings"][0]["user_id"] = uid
                with self.assertRaises(ContractError):
                    self.store.save_config(1, value)
        value = writable(self.store.read_config())
        value["bindings"][0]["user_id"] = "9223372036854775807"
        self.assertEqual(self.store.save_config(1, value)["bindings"][0]["user_id"], "9223372036854775807")

    def test_duplicate_users_and_seats_rejected(self):
        base = writable(self.store.read_config())
        second = {"seat_id": "desk-01", "user_id": "1", "display_name": "测试", "enabled": True}
        for binding in (second, {**second, "seat_id": "desk-12", "user_id": "2"}):
            with self.subTest(binding=binding):
                with self.assertRaises(ContractError):
                    self.store.save_config(1, {**base, "bindings": base["bindings"] + [binding]})

    def test_alias_and_enabled_validation(self):
        for alias in ("", "  ", "x" * 41, "a\nb", None, 12):
            with self.subTest(alias=alias):
                value = writable(self.store.read_config())
                value["bindings"][0]["display_name"] = alias
                with self.assertRaises(ContractError):
                    self.store.save_config(1, value)
        value = writable(self.store.read_config())
        value["bindings"][0]["enabled"] = 1
        with self.assertRaises(ContractError):
            self.store.save_config(1, value)

    def test_trimmed_alias_limit_not_raw_padding(self):
        value = writable(self.store.read_config())
        value["bindings"][0]["display_name"] = "  " + "研" * 40 + "  "
        self.assertEqual(len(self.store.save_config(1, value)["bindings"][0]["display_name"]), 40)

    def test_collection_and_display_validation(self):
        for interval in (0, 1, 15, True, "5", None):
            with self.subTest(interval=interval):
                value = writable(self.store.read_config())
                value["collection"]["poll_interval_seconds"] = interval
                with self.assertRaises(ContractError):
                    self.store.save_config(1, value)
        for interval in (5, 10, 30):
            value = writable(self.store.read_config())
            value["collection"]["poll_interval_seconds"] = interval
            self.assertEqual(validate_config(value)["collection"]["poll_interval_seconds"], interval)
        for field, value in (("show_labels", "false"), ("reduced_motion", True), ("default_view", "walk"), ("default_view", [])):
            v = writable(self.store.read_config())
            v["display"][field] = value
            with self.assertRaises(ContractError):
                self.store.save_config(1, v)

    def test_version_validation(self):
        for version in (None, True, 0, -1, "1"):
            with self.subTest(version=version):
                with self.assertRaises(ContractError):
                    self.store.save_config(version, writable(self.store.read_config()))

    def test_unknown_config_fields_rejected(self):
        v = writable(self.store.read_config())
        with self.assertRaises(ContractError):
            self.store.save_config(1, {**v, "credential": "fixture-not-a-real-token"})

    def test_db_sessions_expire_and_rotate(self):
        self.store.create_session("fixture-a", False, 60)
        self.assertFalse(self.store.session("fixture-a")["authenticated"])
        self.store.create_session("fixture-b", True, 60, replace_digest="fixture-a")
        self.assertIsNone(self.store.session("fixture-a"))
        self.now += 60
        self.assertIsNone(self.store.session("fixture-b"))

    def test_authenticated_session_refresh_slides_expiry_without_resurrecting_logout(self):
        self.store.create_session("fixture-auth", True, 60)
        self.now += 30
        refreshed = self.store.refresh_session("fixture-auth", 60)
        self.assertEqual(refreshed["authenticated"], 1)
        self.assertEqual(refreshed["expires_at"], self.now + 60)
        self.now += 60
        self.assertIsNone(self.store.session("fixture-auth"))
        self.assertIsNone(self.store.refresh_session("fixture-auth", 60))

    def test_login_budget_persistent_and_cross_worker(self):
        for _ in range(5):
            self.assertTrue(self.store.claim_login_attempt("fixture-ip"))
        self.assertFalse(OfficeStore(self.path, clock=lambda: self.now).claim_login_attempt("fixture-ip"))
        self.now += 60
        self.assertTrue(self.store.claim_login_attempt("fixture-ip"))

    def test_global_login_budget(self):
        for n in range(3):
            self.assertTrue(self.store.claim_login_attempt(f"fixture-{n}", global_limit=3))
        self.assertFalse(self.store.claim_login_attempt("fixture-other", global_limit=3))

    def test_multiple_processes_share_atomic_login_budget(self):
        context = multiprocessing.get_context("spawn")
        ready, results = context.Event(), context.Queue()
        processes = [context.Process(target=process_claim, args=(self.path, ready, results, self.now)) for _ in range(6)]
        for process in processes:
            process.start()
        ready.set()
        for process in processes:
            process.join(15)
            self.assertEqual(process.exitcode, 0)
        claims = [results.get(timeout=3) for _ in processes]
        self.assertEqual(claims.count(True), 5)
        self.assertEqual(claims.count(False), 1)
        results.close()

    def test_multiple_processes_cannot_rotate_same_session_twice(self):
        self.store.create_session("fixture-old", False, 60)
        context = multiprocessing.get_context("spawn")
        ready, results = context.Event(), context.Queue()
        processes = [context.Process(target=process_rotate, args=(self.path, ready, results, str(i), self.now)) for i in range(2)]
        for process in processes:
            process.start()
        ready.set()
        for process in processes:
            process.join(15)
            self.assertEqual(process.exitcode, 0)
        self.assertCountEqual([results.get(timeout=3) for _ in processes], ["rotated", "revoked"])
        self.assertIsNone(self.store.session("fixture-old"))
        results.close()

    def test_revoked_or_expired_session_cannot_be_resurrected(self):
        self.store.create_session("fixture-old", False, 1)
        self.store.delete_session("fixture-old")
        with self.assertRaises(SessionConflict):
            self.store.create_session("fixture-new", True, 60, replace_digest="fixture-old")
        self.assertIsNone(self.store.session("fixture-new"))
        self.store.create_session("fixture-old", False, 1)
        self.now += 1
        with self.assertRaises(SessionConflict):
            self.store.create_session("fixture-new", True, 60, replace_digest="fixture-old")
        self.assertIsNone(self.store.session("fixture-new"))

    def test_data_dir_precedence(self):
        with patch.dict(os.environ, {"OFFICE_DATA_DIR": self.temp.name, "STAR_OFFICE_DATA_DIR": "/unused"}):
            self.assertEqual(office_data_dir(), Path(self.temp.name).resolve())
        with patch.dict(os.environ, {"STAR_OFFICE_DATA_DIR": self.temp.name}):
            os.environ.pop("OFFICE_DATA_DIR", None)
            self.assertEqual(office_data_dir(), Path(self.temp.name).resolve() / "office-prod")


if __name__ == "__main__":
    unittest.main(verbosity=2)
