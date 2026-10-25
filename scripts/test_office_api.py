#!/usr/bin/env python3
"""Office API security + public/admin contracts in an isolated Flask fixture app."""
from __future__ import annotations

import copy
import json
import os
import sys
import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from flask import Flask
from werkzeug.security import generate_password_hash
from backend.office_api import register_office_api, legacy_request_guard
from backend.office_collector import atomic_snapshot, empty_snapshot
from backend.office_contract import BUSINESS_STATES, public_snapshot, utc_iso
from backend.office_security import ADMIN_TTL, COOKIE_NAME, OfficeSecurity, strong_password_hash
from backend.office_store import OfficeStore
from scripts.test_office_collector import NOW, success_fixture, user_fixture, four_user_fixture
from scripts.test_office_store import writable

# Explicit fixtures only; no real account, password, signing key or secret file.
FIXTURE_PASSWORD = "Fixture-Only-Password!2026"
FIXTURE_SECRET = "fixture-signing-entropy-" + "9c70ef132a5486b0" * 3
FIXTURE_HASH = generate_password_hash(FIXTURE_PASSWORD, method="scrypt:32768:8:1", salt_length=16)
BASE = "https://office.example.invalid"


class APITests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.now = NOW
        self.store = OfficeStore(self.root / "office-config.sqlite3", clock=lambda: self.now, allowed_user_ids=("1",))
        self.path = self.root / "office-snapshot.json"
        atomic_snapshot(self.path, success_fixture())
        self.app = Flask("office-fixture")
        self.app.config.update(TESTING=True, OFFICE_ENABLED=True, OFFICE_USER_IDS="1", OFFICE_ADMIN_USERNAME="admin", OFFICE_ADMIN_PASSWORD_HASH=FIXTURE_HASH,
                               OFFICE_ADMIN_SECRET=FIXTURE_SECRET)
        register_office_api(self.app, store=self.store, snapshot_path=self.path, clock=lambda: self.now)
        self.client = self.app.test_client()
        self.csrf = None

    def get(self, url, client=None):
        return (client or self.client).get(url, base_url=BASE)

    def write(self, method, path, body=None, headers=None):
        headers = headers or {"Origin": BASE, "X-CSRF-Token": self.csrf or ""}
        return self.client.open(path, method=method, json=body, base_url=BASE, headers=headers)

    def login(self):
        session = self.get("/api/office/admin/session").get_json()
        self.csrf = session["csrf_token"]
        response = self.write("POST", "/api/office/admin/session", {"username": "admin", "password": FIXTURE_PASSWORD})
        self.assertEqual(response.status_code, 200, response.get_json())
        self.csrf = response.get_json()["csrf_token"]
        return response

    def test_authenticated_session_get_renews_cookie_and_server_expiry(self):
        self.login()
        cookie = self.client.get_cookie(COOKIE_NAME, domain="office.example.invalid", path="/").value
        security = self.app.extensions["office_api"]["security"]
        token, record = security.lookup(cookie)
        self.assertTrue(record["authenticated"])
        original_expiry = record["expires_at"]
        self.now += ADMIN_TTL - 60
        response = self.get("/api/office/admin/session")
        self.assertEqual(response.status_code, 200, response.get_json())
        self.assertTrue(response.get_json()["authenticated"])
        self.assertIn(f"Max-Age={ADMIN_TTL}", response.headers.get("Set-Cookie", ""))
        refreshed_cookie = self.client.get_cookie(COOKIE_NAME, domain="office.example.invalid", path="/").value
        refreshed_token, refreshed = security.lookup(refreshed_cookie)
        self.assertEqual(refreshed_token, token)
        self.assertGreater(refreshed["expires_at"], original_expiry)
        self.assertEqual(refreshed["expires_at"], self.now + ADMIN_TTL)

    def test_logout_cannot_be_undone_by_session_heartbeat(self):
        self.login()
        logout = self.write("DELETE", "/api/office/admin/session")
        self.assertEqual(logout.status_code, 200)
        self.assertFalse(self.get("/api/office/admin/session").get_json()["authenticated"])

    def test_public_exact_shape_16_desks_and_no_sensitive_fields(self):
        response = self.get("/api/office/snapshot")
        snap = response.get_json()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(set(snap), {"schema_version", "config_version", "generated_at", "source", "summary", "display", "appearance", "room_characters", "stations"})
        self.assertEqual(len(snap["stations"]), 16)
        self.assertEqual([s["seat_id"] for s in snap["stations"]], [f"desk-{n:02d}" for n in range(1, 17)])
        self.assertEqual(snap["summary"], {"bound": 1, "busy": 1, "idle": 0, "unknown": 0})
        self.assertEqual(snap["source"]["rack_state"], "working")
        self.assertEqual(snap["appearance"], {"character_profile_id": "orange-cat-v1", "allow_fallback": False})
        main = snap["stations"][11]
        self.assertEqual(main["activity"], "busy")
        self.assertEqual(main["animation_state"], "writing")
        self.assertEqual(main["display_name"], "主工位")
        self.assertEqual(main["concurrency"], {"current": 2, "limit": 5})
        self.assertEqual(main["today_usage"]["quality"], "fresh")
        self.assertEqual(main["today_usage"]["timezone"], "Asia/Shanghai")
        self.assertEqual(main["today_usage"]["total"], user_fixture()["token_usage"]["total"])
        self.assertEqual(main["username"], "")
        self.assertEqual(main["identity_quality"], "fresh")
        self.assertEqual(main["identity_observed_at"], utc_iso(self.now))
        for private in ("user_id", "email", "api_keys", "token_usage", "installation_id", "credential_expires_at", "fixture1@example.invalid"):
            self.assertNotIn(private, response.get_data(as_text=True))
        for station in snap["stations"]:
            if not station["bound"]:
                self.assertEqual(station["activity"], "unbound")
                self.assertEqual(station["concurrency"], {"current": None, "limit": None})
                self.assertIsNone(station["animation_state"])
                self.assertIsNone(station["username"])
                self.assertEqual(station["identity_quality"], "unbound")

    def test_public_today_usage_is_daily_and_fails_closed_when_stale_or_untracked(self):
        client, store, path = self.four_profile()
        fresh = self.get("/api/office/snapshot", client).get_json()
        rows = {row["seat_id"]: row for row in fresh["stations"]}
        self.assertEqual(rows["desk-12"]["today_usage"]["quality"], "fresh")
        self.assertEqual(rows["desk-12"]["today_usage"]["total"], user_fixture("1")["token_usage"]["total"])
        # An upstream zero is data, not an unknown value.
        current = four_user_fixture(now=self.now)
        current["users"][1]["token_usage"]["total"] = "0"
        atomic_snapshot(path, current)
        zero = self.get("/api/office/snapshot", client).get_json()
        self.assertEqual({row["seat_id"]: row for row in zero["stations"]}["desk-09"]["today_usage"]["total"], "0")
        # A snapshot from the previous Beijing day must never be labelled today.
        old = four_user_fixture(now=self.now)
        old["window"]["start"] = "2026-10-03T00:00:00+08:00"
        atomic_snapshot(path, old)
        stale = self.get("/api/office/snapshot", client).get_json()
        for row in stale["stations"]:
            if row["bound"]:
                self.assertIsNone(row["today_usage"]["total"])
                self.assertEqual(row["today_usage"]["quality"], "stale")

    def test_today_usage_quality_is_independent_and_large_totals_are_exact(self):
        client, _, path = self.four_profile()
        raw = four_user_fixture(now=self.now)
        huge = "9" * 80
        raw["users"][0]["token_usage"]["total"] = huge
        raw["users"][1]["quality"]["token_usage"] = "untracked"
        raw["users"][1]["token_usage"]["total"] = None
        raw["users"][1]["observed_at"]["token_usage"] = None
        raw["users"][2]["quality"]["token_usage"] = "unavailable"
        raw["users"][2]["token_usage"]["total"] = None
        raw["users"][2]["observed_at"]["token_usage"] = None
        atomic_snapshot(path, raw)
        rows = {s["seat_id"]: s for s in self.get("/api/office/snapshot", client).get_json()["stations"]}
        self.assertEqual(rows["desk-12"]["today_usage"]["total"], huge)
        self.assertIsInstance(rows["desk-12"]["today_usage"]["total"], str)
        for seat in ("desk-09", "desk-10"):
            self.assertIsNone(rows[seat]["today_usage"]["total"])
            self.assertEqual(rows[seat]["today_usage"]["quality"], "unavailable")
        self.assertEqual(rows["desk-09"]["activity"], "idle")
        atomic_snapshot(path, empty_snapshot("upstream_unavailable", now=self.now))
        failed = self.get("/api/office/snapshot", client).get_json()
        self.assertEqual(failed["source"]["status"], "error")
        self.assertEqual(failed["source"]["rack_state"], "fault")
        self.assertTrue(all(s["today_usage"]["total"] is None for s in failed["stations"]))

    def test_today_usage_previous_beijing_day_expires_before_next_sample(self):
        client, _, path = self.four_profile()
        self.now = datetime.fromisoformat("2026-10-05T00:00:01+08:00").timestamp()
        old = four_user_fixture(now=self.now - 1)
        atomic_snapshot(path, old)
        stale = self.get("/api/office/snapshot", client).get_json()
        self.assertEqual(stale["source"]["status"], "ok")
        self.assertTrue(all(s["today_usage"]["quality"] == "stale" for s in stale["stations"] if s["bound"]))
        fresh = four_user_fixture(now=self.now)
        fresh["window"]["start"] = "2026-10-05T00:00:00+08:00"
        atomic_snapshot(path, fresh)
        recovered = self.get("/api/office/snapshot", client).get_json()
        self.assertEqual(recovered["stations"][11]["today_usage"]["date"], "2026-10-05")
        self.assertEqual(recovered["stations"][11]["today_usage"]["quality"], "fresh")

    def test_public_snapshot_fails_closed_for_unassignable_appearance(self):
        for unsafe in (
            {"character_profile_id": "unready-cat-fixture", "allow_fallback": False},
            {"character_profile_id": "orange-cat-v1", "allow_fallback": True},
            {"character_profile_id": "unknown-profile", "allow_fallback": False},
        ):
            with self.subTest(unsafe=unsafe):
                config = self.store.read_config()
                config["appearance"] = unsafe
                snapshot = public_snapshot(config, success_fixture(), self.now)
                self.assertEqual(snapshot["appearance"], {"character_profile_id": "orange-cat-v1", "allow_fallback": False})
                self.assertTrue(all(row["character_profile_id"] == "orange-cat-v1" for row in snapshot["stations"]))

    def test_missing_and_failed_source_unknown_not_idle(self):
        self.path.unlink()
        snap = self.get("/api/office/snapshot").get_json()
        self.assertEqual(snap["source"]["status"], "connecting")
        self.assertEqual(snap["stations"][11]["reason"], "not_collected")
        for code in ("unauthorized", "forbidden", "rate_limited", "upstream_unavailable", "timeout"):
            atomic_snapshot(self.path, empty_snapshot(code, now=self.now))
            snap = self.get("/api/office/snapshot").get_json()
            self.assertEqual(snap["source"]["status"], "error")
            self.assertEqual(snap["summary"]["unknown"], 1)
            self.assertIsNone(snap["stations"][11]["animation_state"])

    def four_profile(self):
        root = self.root / "four-api"
        store = OfficeStore(root / "office-config.sqlite3", clock=lambda: self.now,
                            allowed_user_ids=("1", "4", "7", "8"))
        path = root / "office-snapshot.json"
        atomic_snapshot(path, four_user_fixture(now=self.now))
        app = Flask("fixture-four-api")
        app.config.update(TESTING=True, OFFICE_ENABLED=True, OFFICE_USER_IDS="1,4,7,8",
                          OFFICE_ADMIN_USERNAME="admin", OFFICE_ADMIN_PASSWORD_HASH=FIXTURE_HASH,
                          OFFICE_ADMIN_SECRET=FIXTURE_SECRET)
        register_office_api(app, store=store, snapshot_path=path, clock=lambda: self.now)
        return app.test_client(), store, path

    def test_four_users_independent_concurrency_and_whitelisted_usernames(self):
        client, store, path = self.four_profile()
        response = self.get("/api/office/snapshot", client)
        wire = response.get_json()
        self.assertEqual(wire["summary"], {"bound": 4, "busy": 2, "idle": 1, "unknown": 1})
        by_seat = {s["seat_id"]: s for s in wire["stations"]}
        for seat, name, count, animation in (("desk-12", "真实甲", 3, "writing"),
                                              ("desk-09", "真实乙", 0, "idle"),
                                              ("desk-10", "真实丙", 5, "writing"),
                                              ("desk-11", "真实丁", None, None)):
            row = by_seat[seat]
            self.assertEqual(row["username"], name)
            self.assertEqual(row["identity_quality"], "fresh")
            self.assertEqual(row["identity_observed_at"], utc_iso(self.now))
            self.assertEqual(row["concurrency"]["current"], count)
            self.assertEqual(row["animation_state"], animation)
        private_keys = {"user_id", "email", "api_keys", "token_usage", "installation_id",
                        "authorized_user_ids", "allowed_user_ids", "credential_expires_at"}
        def assert_allowed(value):
            if isinstance(value, dict):
                self.assertFalse(private_keys.intersection(value))
                for v in value.values():
                    assert_allowed(v)
            elif isinstance(value, list):
                for v in value:
                    assert_allowed(v)
        assert_allowed(wire)
        for marker in ("fixture1@example.invalid", "fixture4@example.invalid", "fixture A"):
            self.assertNotIn(marker, response.get_data(as_text=True))
        # The fullscreen HUD receives only this exact daily aggregate; key IDs and
        # the private upstream token_usage object remain absent.
        self.assertEqual(wire["stations"][11]["today_usage"]["total"], user_fixture()["token_usage"]["total"])

    def test_username_change_does_not_change_alias_bindings_or_other_users(self):
        client, store, path = self.four_profile()
        old_config, old_history = store.read_config(), store.history()
        before = self.get("/api/office/snapshot", client).get_json()
        updated = four_user_fixture(now=self.now)
        updated["users"][1]["username"] = "用户四更新了名称"
        atomic_snapshot(path, updated)
        after = self.get("/api/office/snapshot", client).get_json()
        self.assertEqual(after["stations"][8]["username"], "用户四更新了名称")
        self.assertEqual(after["stations"][8]["display_name"], "工位 09")
        for index in (9, 10, 11):
            self.assertEqual(before["stations"][index], after["stations"][index])
        self.assertEqual(store.read_config(), old_config)
        self.assertEqual(store.history(), old_history)

    def test_fresh_empty_and_whitespace_usernames_are_not_filled_from_alias_or_email(self):
        client, store, path = self.four_profile()
        for name in ("", "   ", "真实名字"):
            raw = four_user_fixture(now=self.now)
            raw["users"][1]["username"] = name
            atomic_snapshot(path, raw)
            row = self.get("/api/office/snapshot", client).get_json()["stations"][8]
            self.assertEqual(row["username"], name)
            self.assertEqual(row["identity_quality"], "fresh")
            self.assertEqual(row["identity_observed_at"], utc_iso(self.now))
            self.assertEqual(row["display_name"], "工位 09")

    def test_identity_clock_is_independent_of_fresh_concurrency(self):
        client, store, path = self.four_profile()
        raw = four_user_fixture(now=self.now)
        raw["users"][1]["observed_at"]["identity"] = utc_iso(self.now - 15)
        atomic_snapshot(path, raw)
        wire = self.get("/api/office/snapshot", client).get_json()
        row = wire["stations"][8]
        self.assertIsNone(row["username"])
        self.assertEqual(row["identity_quality"], "stale")
        self.assertIsNone(row["identity_observed_at"])
        self.assertEqual(row["concurrency"]["current"], 0)
        self.assertEqual(row["activity"], "idle")
        self.assertEqual(wire["stations"][11]["username"], "真实甲")

    def test_identity_expiry_boundary_future_and_invalid_observation_no_fallback(self):
        config = self.store.read_config()
        for observed, quality in ((utc_iso(self.now - 15), "stale"), (utc_iso(self.now + 1), "stale"),
                                   (None, "unavailable"), ("missing-clock", "unavailable")):
            raw = success_fixture()
            raw["users"][0]["username"] = "不会继承这个旧名称"
            raw["users"][0]["observed_at"]["identity"] = observed
            row = public_snapshot(config, raw, self.now)["stations"][11]
            self.assertIsNone(row["username"])
            self.assertEqual(row["identity_quality"], quality)
            self.assertIsNone(row["identity_observed_at"])
        raw = success_fixture()
        raw["users"][0]["username"] = "刚好新鲜"
        raw["users"][0]["observed_at"]["identity"] = utc_iso(self.now - 14.999)
        self.assertEqual(public_snapshot(config, raw, self.now)["stations"][11]["username"], "刚好新鲜")

    def test_missing_old_identity_fields_never_copy_username_email_or_alias(self):
        config = self.store.read_config()
        variants = []
        for field in ("username", "quality", "observed_at"):
            raw = success_fixture()
            if field == "username":
                raw["users"][0].pop(field)
            else:
                raw["users"][0][field].pop("identity")
            variants.append(raw)
        for name in (None, 123, True):
            raw = success_fixture()
            raw["users"][0]["username"] = name
            variants.append(raw)
        for raw in variants:
            row = public_snapshot(config, raw, self.now)["stations"][11]
            self.assertIsNone(row["username"])
            self.assertEqual(row["identity_quality"], "unavailable")
            self.assertIsNone(row["identity_observed_at"])
            # Invalid on-disk plugin identity remains fail-closed at the API boundary.
            atomic_snapshot(self.path, raw)
            row = self.get("/api/office/snapshot").get_json()["stations"][11]
            self.assertIsNone(row["username"])
            self.assertIsNone(row["identity_observed_at"])

    def test_identity_and_source_failure_clears_all_four_names_immediately(self):
        client, store, path = self.four_profile()
        for code in ("unauthorized", "forbidden", "upstream_unavailable", "timeout"):
            raw = four_user_fixture(now=self.now)
            raw["connection"] = {"status": "unknown", "error_code": code, "http_status": 403}
            atomic_snapshot(path, raw)  # malicious stale list must not leak through
            response = self.get("/api/office/snapshot", client)
            wire = response.get_json()
            self.assertEqual(wire["summary"]["unknown"], 4)
            for row in wire["stations"]:
                self.assertIsNone(row["username"])
                self.assertIsNone(row["identity_observed_at"])
                self.assertEqual(row["identity_quality"], "unavailable" if row["bound"] else "unbound")
                self.assertIsNone(row["concurrency"]["current"])
            for marker in ("真实甲", "真实乙", "真实丙", "真实丁"):
                self.assertNotIn(marker, response.get_data(as_text=True))
        raw = four_user_fixture(now=self.now)
        raw["users"][1]["quality"]["identity"] = "unavailable"
        raw["users"][1]["observed_at"]["identity"] = None
        atomic_snapshot(path, raw)
        self.assertTrue(all(s["username"] is None for s in self.get("/api/office/snapshot", client).get_json()["stations"]))

    def test_source_staleness_expiry_restart_also_clears_username(self):
        for source_change in ("stale", "future", "expired", "restart"):
            raw = success_fixture()
            raw["users"][0]["username"] = "旧名不能续期"
            if source_change == "stale":
                raw["sampled_at"] = utc_iso(self.now - 15)
            elif source_change == "future":
                raw["sampled_at"] = utc_iso(self.now + 1)
            elif source_change == "expired":
                raw["source"]["credential_expires_at"] = utc_iso(self.now)
            else:
                raw["connection"] = {"status": "unknown", "error_code": "not_configured", "http_status": None}
            atomic_snapshot(self.path, raw)
            row = self.get("/api/office/snapshot").get_json()["stations"][11]
            self.assertIsNone(row["username"])
            self.assertIsNone(row["identity_observed_at"])
            self.assertEqual(row["identity_quality"], "stale" if source_change in ("stale", "future") else "unavailable")

    def test_control_characters_are_not_projected(self):
        for name in ("name\nmarkup", "name\x00suffix", "name\x7fsuffix", "name\x85suffix"):
            raw = success_fixture()
            raw["users"][0]["username"] = name
            self.assertIsNone(public_snapshot(self.store.read_config(), raw, self.now)["stations"][11]["username"])
            atomic_snapshot(self.path, raw)
            self.assertIsNone(self.get("/api/office/snapshot").get_json()["stations"][11]["username"])

    def test_fresh_name_not_conditioned_on_untracked_concurrency(self):
        raw = success_fixture()
        raw["users"] = [user_fixture(username="名字新鲜但工作数据未知", current=None, quality="untracked")]
        atomic_snapshot(self.path, raw)
        row = self.get("/api/office/snapshot").get_json()["stations"][11]
        self.assertEqual(row["username"], "名字新鲜但工作数据未知")
        self.assertEqual(row["identity_quality"], "fresh")
        self.assertIsNone(row["concurrency"]["current"])
        self.assertEqual(row["activity"], "unknown")

    def test_api_new_store_scope_defaults_and_explicit_one(self):
        for scope in (None, "1", "4,8"):
            with self.subTest(scope=scope), patch.dict(os.environ):
                if scope is None:
                    os.environ.pop("OFFICE_USER_IDS", None)
                else:
                    os.environ["OFFICE_USER_IDS"] = scope
                root = self.root / ("default" if scope is None else scope.replace(",", "-"))
                os.environ["OFFICE_DATA_DIR"] = str(root)
                app = Flask("fresh-profile-fixture")
                app.config["OFFICE_ENABLED"] = True
                register_office_api(app, clock=lambda: self.now)
                client = app.test_client()
                wire = self.get("/api/office/snapshot", client).get_json()
                expected = 4 if scope is None else len(scope.split(","))
                self.assertEqual(wire["summary"]["bound"], expected)
                config = app.extensions["office_api"]["store"].read_config()
                self.assertEqual({b["user_id"] for b in config["bindings"]}, set((scope or "1,4,7,8").split(",")))

    def test_scope_shrink_filters_cached_names_without_migrating_existing_store(self):
        client, store, path = self.four_profile()
        saved, history = store.read_config(), store.history()
        app = Flask("narrow-profile-fixture")
        app.config.update(TESTING=True, OFFICE_ENABLED=True, OFFICE_USER_IDS="1")
        register_office_api(app, store=store, snapshot_path=path, clock=lambda: self.now)
        response = self.get("/api/office/snapshot", app.test_client())
        wire = response.get_json()
        self.assertEqual(wire["summary"], {"bound": 4, "busy": 1, "idle": 0, "unknown": 3})
        self.assertEqual(wire["stations"][11]["username"], "真实甲")
        for index in (8, 9, 10):
            self.assertIsNone(wire["stations"][index]["username"])
            self.assertIsNone(wire["stations"][index]["concurrency"]["current"])
        self.assertEqual(store.read_config(), saved)
        self.assertEqual(store.history(), history)

    def test_config_export_does_not_include_live_names(self):
        client, store, path = self.four_profile()
        content = json.dumps(store.read_config(), ensure_ascii=False)
        self.assertNotIn("username", content)
        for name in ("真实甲", "真实乙", "真实丙", "真实丁"):
            self.assertNotIn(name, content)

    def test_identity_age_respects_previous_shorter_sample_period(self):
        raw = success_fixture()
        raw["users"][0]["username"] = "旧周期不能延长身份"
        raw["users"][0]["observed_at"]["identity"] = utc_iso(self.now - 20)
        config = self.store.read_config()
        config["collection"]["poll_interval_seconds"] = 30
        self.assertIsNone(public_snapshot(config, raw, self.now)["stations"][11]["username"])

    def test_admin_requires_new_session_not_legacy(self):
        self.app.secret_key = "fixture-legacy-secret"
        with self.client.session_transaction() as legacy:
            legacy["asset_editor_authed"] = True
        for path in ("/admin/users", "/admin/config", "/admin/diagnostics", "/admin/config/history"):
            response = self.get("/api/office" + path)
            self.assertEqual(response.status_code, 401)
            self.assertEqual(response.get_json()["error"]["code"], "UNAUTHENTICATED")

    def test_login_cookie_signed_secure_and_csrf_rotates(self):
        initial = self.get("/api/office/admin/session")
        old_csrf = initial.get_json()["csrf_token"]
        old_cookie = self.client.get_cookie(COOKIE_NAME, domain="office.example.invalid", path="/").value
        self.assertEqual(initial.get_json(), {"authenticated": False, "csrf_token": old_csrf, "username": None})
        response = self.login()
        cookie_header = response.headers["Set-Cookie"]
        for field in ("Secure", "HttpOnly", "SameSite=Lax", "Path=/"):
            self.assertIn(field, cookie_header)
        self.assertNotEqual(self.csrf, old_csrf)
        self.assertTrue(response.get_json()["authenticated"])
        other = self.app.test_client()
        other.set_cookie(COOKIE_NAME, old_cookie, domain="office.example.invalid", path="/")
        self.assertEqual(self.get("/api/office/admin/users", other).status_code, 401)
        self.assertEqual(self.get("/api/office/admin/session").get_json()["csrf_token"], self.csrf)

    def test_password_and_username_errors_do_not_authenticate(self):
        initial = self.get("/api/office/admin/session").get_json()
        self.csrf = initial["csrf_token"]
        for username, password in (("wrong", FIXTURE_PASSWORD), ("admin", "wrong"), ([], "wrong")):
            response = self.write("POST", "/api/office/admin/session", {"username": username, "password": password})
            self.assertEqual(response.status_code, 401)
            self.assertNotIn(password, response.get_data(as_text=True))
        self.assertEqual(self.get("/api/office/admin/users").status_code, 401)

    def test_missing_csrf_and_foreign_origin_rejected(self):
        self.login()
        config = writable(self.store.read_config())
        body = {"expected_version": 1, "config": config}
        for headers in ({"Origin": BASE}, {"Origin": "https://evil.example.invalid", "X-CSRF-Token": self.csrf},
                        {"X-CSRF-Token": self.csrf}, {"Origin": "null", "X-CSRF-Token": self.csrf},
                        {"Origin": BASE, "X-CSRF-Token": "bad"}):
            response = self.write("PUT", "/api/office/admin/config", body, headers=headers)
            self.assertEqual(response.status_code, 403)
        self.assertEqual(self.store.read_config()["version"], 1)

    def test_same_origin_referer_allowed(self):
        self.login()
        response = self.write("PUT", "/api/office/admin/config",
                              {"expected_version": 1, "config": writable(self.store.read_config())},
                              headers={"Referer": BASE + "/office/admin", "X-CSRF-Token": self.csrf})
        self.assertEqual(response.status_code, 200)

    def test_http_admin_denied_public_http_allowed(self):
        self.assertEqual(self.client.get("/api/office/admin/session", base_url="http://office.example.invalid").status_code, 400)
        self.assertEqual(self.client.get("/api/office/snapshot", base_url="http://office.example.invalid").status_code, 200)

    def test_login_rate_limit_shared_between_sessions_and_workers(self):
        self.csrf = self.get("/api/office/admin/session").get_json()["csrf_token"]
        for _ in range(5):
            self.assertEqual(self.write("POST", "/api/office/admin/session", {"username": "admin", "password": "wrong"}).status_code, 401)
        response = self.write("POST", "/api/office/admin/session", {"username": "admin", "password": FIXTURE_PASSWORD})
        self.assertEqual(response.status_code, 429)
        self.assertEqual(response.headers["Retry-After"], "60")
        other = self.app.test_client()
        csrf = self.get("/api/office/admin/session", other).get_json()["csrf_token"]
        response = other.post("/api/office/admin/session", base_url=BASE, json={"username": "admin", "password": FIXTURE_PASSWORD},
                              headers={"Origin": BASE, "X-CSRF-Token": csrf})
        self.assertEqual(response.status_code, 429)
        self.now += 60
        self.assertEqual(self.write("POST", "/api/office/admin/session", {"username": "admin", "password": FIXTURE_PASSWORD}).status_code, 200)

    def test_logout_invalidates_cookie_and_old_csrf(self):
        self.login()
        old_csrf = self.csrf
        old_cookie = self.client.get_cookie(COOKIE_NAME, domain="office.example.invalid", path="/").value
        response = self.write("DELETE", "/api/office/admin/session")
        self.assertFalse(response.get_json()["authenticated"])
        self.assertNotEqual(response.get_json()["csrf_token"], old_csrf)
        self.assertEqual(self.get("/api/office/admin/users").status_code, 401)
        other = self.app.test_client()
        other.set_cookie(COOKIE_NAME, old_cookie, domain="office.example.invalid", path="/")
        self.assertEqual(self.get("/api/office/admin/users", other).status_code, 401)

    def test_session_idle_without_heartbeat_still_expires(self):
        self.login()
        self.now += 43199
        self.assertEqual(self.get("/api/office/admin/users").status_code, 200)
        self.now += 1
        self.assertEqual(self.get("/api/office/admin/users").status_code, 401)

    def test_cookie_tampering_rejected(self):
        self.login()
        cookie = self.client.get_cookie(COOKIE_NAME, domain="office.example.invalid", path="/").value
        self.client.set_cookie(COOKIE_NAME, cookie + "x", domain="office.example.invalid", path="/")
        self.assertEqual(self.get("/api/office/admin/users").status_code, 401)

    def test_character_profile_catalog_is_public_safe_and_ready(self):
        response = self.get("/api/office/character-profiles")
        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertEqual(set(payload), {"schema_version", "template_id", "animation_mode", "manifest_contract_version", "selection_scope", "profiles"})
        self.assertEqual(payload["template_id"], "connected-v5-character-template-v1")
        self.assertEqual(payload["animation_mode"], "full-frame")
        self.assertEqual(payload["manifest_contract_version"], 2)
        self.assertEqual(payload["selection_scope"], "global_and_binding")
        self.assertEqual(len(payload["profiles"]), 8)
        orange = next(profile for profile in payload["profiles"] if profile["id"] == "orange-cat-v1")
        self.assertTrue(orange["production_ready"])
        self.assertTrue(orange["assignable"])
        for profile in payload["profiles"]:
            self.assertEqual(profile["template_id"], payload["template_id"])
            self.assertTrue(profile["production_ready"])
            self.assertTrue(profile["assignable"])
            self.assertEqual(profile["status"], "ready")
            self.assertEqual(profile["directions"], ["up", "down", "left", "right"])
            self.assertEqual(profile["animation_mode"], "full-frame")
            self.assertEqual(profile["manifest_contract_version"], 2)
        private_keys = {"prompt", "path", "source", "manifest", "secret"}
        for profile in payload["profiles"]:
            self.assertFalse(private_keys.intersection(profile))

    def test_admin_preserves_five_fields_string_and_empty_username(self):
        self.login()
        response = self.get("/api/office/admin/users")
        payload = response.get_json()
        self.assertEqual(set(payload), {"schema_version", "config_version", "source", "window", "users"})
        user = payload["users"][0]
        self.assertEqual(user["username"], "")
        self.assertEqual(user["token_usage"]["total"], user_fixture()["token_usage"]["total"])
        self.assertEqual(user["api_keys"][0]["id"], "9007199254740993")
        self.assertEqual(payload["source"]["installation_id"], 1)
        self.assertEqual(payload["source"]["allowed_user_ids"], ["1"])
        self.assertEqual(payload["window"]["timezone"], "Asia/Shanghai")
        self.assertNotIn("password", response.get_data(as_text=True))

    def test_401_403_failure_and_other_errors_remove_private_admin_users(self):
        self.login()
        for code in ("unauthorized", "forbidden", "upstream_unavailable", "rate_limited", "timeout"):
            with self.subTest(code=code):
                raw = success_fixture()
                raw["connection"] = {"status": "unknown", "error_code": code, "http_status": 403}
                # Even a corrupt writer retaining old users cannot expose them through API.
                atomic_snapshot(self.path, raw)
                response = self.get("/api/office/admin/users")
                self.assertEqual(response.get_json()["users"], [])
                self.assertIsNone(response.get_json()["window"])
                self.assertNotIn("fixture1@example.invalid", response.get_data(as_text=True))

    def test_stale_future_and_expired_snapshot_admin_users_hidden(self):
        self.login()
        for sampled_at, expiry in ((utc_iso(self.now - 15), None), (utc_iso(self.now + 1), None),
                                   (utc_iso(self.now), utc_iso(self.now))):
            snap = success_fixture()
            snap["sampled_at"] = sampled_at
            snap["source"]["credential_expires_at"] = expiry
            atomic_snapshot(self.path, snap)
            self.assertEqual(self.get("/api/office/admin/users").get_json()["users"], [])
            self.assertEqual(self.get("/api/office/snapshot").get_json()["stations"][11]["activity"], "unknown")

    def test_recovery_resumes_busy_not_error_business_state(self):
        atomic_snapshot(self.path, empty_snapshot("forbidden", now=self.now))
        self.assertEqual(self.get("/api/office/snapshot").get_json()["stations"][11]["activity"], "unknown")
        atomic_snapshot(self.path, success_fixture())
        self.assertEqual(self.get("/api/office/snapshot").get_json()["stations"][11]["animation_state"], "writing")
        self.assertEqual(BUSINESS_STATES, {"idle", "writing", "researching", "executing", "syncing", "error"})

    def test_config_get_save_readback_conflict_and_history(self):
        self.login()
        initial = self.get("/api/office/admin/config").get_json()
        self.assertEqual(set(initial), {"config", "history"})
        config = writable(initial["config"])
        config["bindings"][0]["display_name"] = "  独立别名  "
        response = self.write("PUT", "/api/office/admin/config", {"expected_version": 1, "config": config})
        self.assertEqual(response.status_code, 200)
        saved = response.get_json()["config"]
        self.assertEqual(saved["version"], 2)
        self.assertEqual(self.get("/api/office/admin/config").get_json()["config"], saved)
        self.assertEqual(saved, OfficeStore(self.store.path).read_config())
        self.assertEqual(self.get("/api/office/snapshot").get_json()["stations"][11]["display_name"], "独立别名")
        conflict = self.write("PUT", "/api/office/admin/config", {"expected_version": 1, "config": config})
        self.assertEqual(conflict.status_code, 409)
        self.assertEqual(conflict.get_json()["error"]["code"], "VERSION_CONFLICT")
        history = self.get("/api/office/admin/config/history").get_json()
        self.assertEqual(len(history["audit"]), 2)

    def test_character_profile_save_rejects_candidates_and_readback_is_explicit(self):
        self.login()
        config = writable(self.store.read_config())
        config["appearance"] = {"character_profile_id": "unready-cat-fixture", "allow_fallback": False}
        response = self.write("PUT", "/api/office/admin/config", {"expected_version": 1, "config": config})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.store.read_config()["version"], 1)
        config["appearance"] = {"character_profile_id": "orange-cat-v1", "allow_fallback": True}
        response = self.write("PUT", "/api/office/admin/config", {"expected_version": 1, "config": config})
        self.assertEqual(response.status_code, 400)
        config["appearance"]["allow_fallback"] = False
        response = self.write("PUT", "/api/office/admin/config", {"expected_version": 1, "config": config})
        self.assertEqual(response.status_code, 200, response.get_json())
        saved = response.get_json()["config"]
        self.assertEqual(saved["appearance"], {"character_profile_id": "orange-cat-v1", "allow_fallback": False})
        self.assertEqual(self.get("/api/office/snapshot").get_json()["appearance"], saved["appearance"])

    def test_binding_character_save_readback_and_reset_to_default(self):
        self.login()
        config = writable(self.store.read_config())
        config["bindings"][0]["character_profile_id"] = "orange-cat-v1"
        response = self.write("PUT", "/api/office/admin/config", {"expected_version": 1, "config": config})
        self.assertEqual(response.status_code, 200, response.get_json())
        saved = response.get_json()["config"]
        self.assertEqual(saved["bindings"][0]["character_profile_id"], "orange-cat-v1")
        self.assertEqual(self.get("/api/office/admin/config").get_json()["config"], saved)
        station = self.get("/api/office/snapshot").get_json()["stations"][11]
        self.assertEqual(station["character_profile_id"], "orange-cat-v1")
        del config["bindings"][0]["character_profile_id"]
        response = self.write("PUT", "/api/office/admin/config", {"expected_version": 2, "config": config})
        self.assertEqual(response.status_code, 200)
        self.assertNotIn("character_profile_id", response.get_json()["config"]["bindings"][0])
        self.assertEqual(self.get("/api/office/admin/config").get_json()["config"]["version"], 3)

    def test_binding_character_candidate_is_rejected_without_mutating_history(self):
        self.login()
        config = writable(self.store.read_config())
        config["bindings"][0]["character_profile_id"] = "unready-cat-fixture"
        response = self.write("PUT", "/api/office/admin/config", {"expected_version": 1, "config": config})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.store.read_config()["version"], 1)
        self.assertNotIn("character_profile_id", self.store.read_config()["bindings"][0])

    def test_config_duplicate_binding_validation(self):
        self.login()
        config = writable(self.store.read_config())
        config["bindings"].append({"seat_id": "desk-01", "user_id": "1", "display_name": "fixture", "enabled": True})
        response = self.write("PUT", "/api/office/admin/config", {"expected_version": 1, "config": config})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.store.read_config()["version"], 1)

    def test_config_user_authorization_not_browser_scope(self):
        self.login()
        config = writable(self.store.read_config())
        config["bindings"][0]["user_id"] = "2"
        response = self.write("PUT", "/api/office/admin/config", {"expected_version": 1, "config": config})
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.get_json()["error"]["code"], "USER_NOT_AUTHORIZED")

    def test_restore_new_version_and_revalidated_scope(self):
        self.login()
        value = writable(self.store.read_config())
        value["bindings"] = []
        self.assertEqual(self.write("PUT", "/api/office/admin/config", {"expected_version": 1, "config": value}).status_code, 200)
        response = self.write("POST", "/api/office/admin/config/restore", {"expected_version": 2, "target_version": 1})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["config"]["version"], 3)
        atomic_snapshot(self.path, empty_snapshot("forbidden", now=self.now))
        response = self.write("POST", "/api/office/admin/config/restore", {"expected_version": 3, "target_version": 1})
        self.assertEqual(response.status_code, 403)
        self.assertEqual(len(self.store.history()["audit"]), 3)

    def test_disable_binding_and_collection_update(self):
        self.login()
        value = writable(self.store.read_config())
        value["bindings"][0]["enabled"] = False
        value["collection"]["poll_interval_seconds"] = 30
        response = self.write("PUT", "/api/office/admin/config", {"expected_version": 1, "config": value})
        self.assertEqual(response.status_code, 200)
        snap = self.get("/api/office/snapshot").get_json()
        self.assertEqual(snap["summary"]["bound"], 0)
        self.assertEqual(snap["source"]["stale_after_seconds"], 90)
        self.assertEqual(snap["stations"][11]["activity"], "unbound")

    def test_no_browser_collection_or_upstream_access(self):
        with patch("backend.office_collector.http_get", side_effect=AssertionError("no upstream allowed")):
            clients = [self.app.test_client() for _ in range(8)]
            for client in clients:
                for _ in range(3):
                    self.assertEqual(self.get("/api/office/snapshot", client).status_code, 200)
        self.assertEqual(list(self.root.glob("*collector*")), [])

    def test_safe_headers_no_cache_or_cors(self):
        for url in ("/api/office/snapshot", "/api/office/admin/users", "/api/office/admin/session"):
            response = self.get(url)
            self.assertIn("no-store", response.headers["Cache-Control"])
            self.assertEqual(response.headers["X-Content-Type-Options"], "nosniff")
            self.assertNotIn("Access-Control-Allow-Origin", response.headers)
            self.assertEqual(response.headers["X-Office-Schema-Version"], "1")

    def test_oversized_malformed_and_source_configuration_rejected(self):
        self.login()
        response = self.client.put("/api/office/admin/config", data="x" * 65537, content_type="application/json", base_url=BASE,
                                   headers={"Origin": BASE, "X-CSRF-Token": self.csrf})
        self.assertEqual(response.status_code, 413)
        for value in (None, [], {"version": 1}, {"expected_version": 1, "config": {"credential": "fixture-secret"}}):
            response = self.write("PUT", "/api/office/admin/config", value)
            self.assertEqual(response.status_code, 400)
            self.assertNotIn("fixture-secret", response.get_data(as_text=True))

    def test_registration_idempotent_and_legacy_routes_not_changed(self):
        bp = register_office_api(self.app)
        self.assertIs(bp, self.app.extensions["office_api"]["blueprint"])
        self.assertEqual(self.client.get("/status").status_code, 404)
        self.assertEqual(self.client.get("/set_state").status_code, 404)

    def test_factory_defaults_env_data_directory_and_missing_security_fail_closed(self):
        separate = self.root / "separate-fixture"
        with patch.dict(os.environ, {"OFFICE_DATA_DIR": str(separate), "OFFICE_ADMIN_SECRET": "", "OFFICE_ADMIN_PASSWORD_HASH": ""}):
            app = Flask("disabled-fixture")
            app.config["OFFICE_ENABLED"] = True
            register_office_api(app)
            client = app.test_client()
            self.assertEqual(app.extensions["office_api"]["store"].path, separate.resolve() / "office-config.sqlite3")
            self.assertEqual(client.get("/api/office/admin/session", base_url=BASE).status_code, 503)
            self.assertEqual(client.get("/api/office/snapshot").status_code, 200)

    def test_legacy_guard_returns_response_and_protects_writes(self):
        with self.app.test_request_context("/legacy", base_url=BASE):
            denied = legacy_request_guard()
            self.assertEqual(denied.status_code, 401)
        self.login()
        cookie = self.client.get_cookie(COOKIE_NAME, domain="office.example.invalid", path="/").value
        with self.app.test_request_context("/legacy", base_url=BASE, headers={"Cookie": f"{COOKIE_NAME}={cookie}"}):
            self.assertIsNone(legacy_request_guard())
        with self.app.test_request_context("/legacy", method="POST", base_url=BASE, headers={"Cookie": f"{COOKIE_NAME}={cookie}"}):
            self.assertEqual(legacy_request_guard().status_code, 403)
        headers = {"Cookie": f"{COOKIE_NAME}={cookie}", "Origin": BASE, "X-CSRF-Token": self.csrf}
        for method in ("POST", "PUT", "DELETE"):
            with self.app.test_request_context("/legacy", method=method, base_url=BASE, headers=headers):
                self.assertIsNone(legacy_request_guard())
        with self.app.test_request_context("/legacy", base_url="http://office.example.invalid", headers=headers):
            self.assertEqual(legacy_request_guard().status_code, 400)

    def test_enabled_off_does_not_register_or_create_data(self):
        separate = self.root / "disabled-data"
        with patch.dict(os.environ, {"OFFICE_ENABLED": "0", "OFFICE_DATA_DIR": str(separate)}):
            app = Flask("off-fixture")
            self.assertIsNone(register_office_api(app))
            self.assertNotIn("office_api", app.extensions)
            self.assertFalse(separate.exists())
            self.assertEqual(app.test_client().get("/api/office/snapshot").status_code, 404)
            with app.test_request_context("/legacy", method="POST"):
                self.assertIsNone(legacy_request_guard())

    def test_revocation_during_password_hash_cannot_reauthenticate(self):
        self.csrf = self.get("/api/office/admin/session").get_json()["csrf_token"]
        security = self.app.extensions["office_api"]["security"]
        encoded = self.client.get_cookie(COOKIE_NAME, domain="office.example.invalid", path="/").value
        token, record = security.lookup(encoded)
        verify = security.verify_password
        def revoke_during_hash(username, password):
            self.store.delete_session(security.digest(token))
            return verify(username, password)
        with patch.object(security, "verify_password", side_effect=revoke_during_hash):
            response = self.write("POST", "/api/office/admin/session", {"username": "admin", "password": FIXTURE_PASSWORD})
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.get_json()["error"]["code"], "UNAUTHENTICATED")
        self.assertEqual(self.get("/api/office/admin/users").status_code, 401)

    def test_independent_web_worker_shares_session_and_logout_revocation(self):
        self.login()
        cookie = self.client.get_cookie(COOKIE_NAME, domain="office.example.invalid", path="/").value
        worker = Flask("fixture-second-worker")
        worker.config.update(TESTING=True, OFFICE_ENABLED=True, OFFICE_ADMIN_USERNAME="admin",
                             OFFICE_ADMIN_PASSWORD_HASH=FIXTURE_HASH, OFFICE_ADMIN_SECRET=FIXTURE_SECRET)
        register_office_api(worker, store=OfficeStore(self.store.path, clock=lambda: self.now),
                            snapshot_path=self.path, clock=lambda: self.now)
        client = worker.test_client()
        client.set_cookie(COOKIE_NAME, cookie, domain="office.example.invalid", path="/")
        self.assertEqual(client.get("/api/office/admin/users", base_url=BASE).status_code, 200)
        self.write("DELETE", "/api/office/admin/session")
        self.assertEqual(client.get("/api/office/admin/users", base_url=BASE).status_code, 401)

    def test_safe_unknown_endpoint(self):
        response = self.get("/api/office/nonexistent")
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.get_json()["error"]["code"], "NOT_FOUND")


class SecurityTests(unittest.TestCase):
    def test_strong_hashes_only(self):
        self.assertTrue(strong_password_hash(FIXTURE_HASH))
        self.assertTrue(strong_password_hash(generate_password_hash("fixture", method="pbkdf2:sha256:600000", salt_length=16)))
        for method in ("pbkdf2:sha256:1000", "scrypt:16384:8:1"):
            self.assertFalse(strong_password_hash(generate_password_hash("fixture", method=method, salt_length=16)))
        for value in ("1234", "sha256$fixture$hash", "pbkdf2:sha256:99999999999$salt$hash", None):
            self.assertFalse(strong_password_hash(value))

    def test_old_drawer_default_or_weak_secret_cannot_enable_admin(self):
        with tempfile.TemporaryDirectory() as directory:
            store = OfficeStore(Path(directory) / "fixture.sqlite3")
            for secret in ("", "star-office-dev-secret-change-me", "short", "example" * 10):
                self.assertFalse(OfficeSecurity(store, "admin", FIXTURE_HASH, secret).enabled)


if __name__ == "__main__":
    unittest.main(verbosity=2)
