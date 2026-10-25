#!/usr/bin/env python3
"""Collector fixture transport tests; no real HTTP or production credentials."""
from __future__ import annotations

import copy
import json
import multiprocessing
import os
import io
import ssl
import time
import urllib.error
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from urllib.parse import parse_qs, urlsplit
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend.office_collector import (OfficeCollector, AlreadyRunning, CollectorFailure, collector_lock,
                                      read_snapshot, atomic_snapshot, empty_snapshot, collector_health,
                                      MAX_RESPONSE_BYTES, NoRedirect, read_credential, http_get)
from backend.office_contract import utc_iso, public_snapshot
from backend.office_store import OfficeStore

NOW = 1791100800.0
# Explicitly non-production fixture; this random-looking value is never sent to a network.
FIXTURE_TOKEN = "s2ut_" + "F" * 43


def user_fixture(uid="1", current=2, quality="fresh", now=NOW, username=""):
    observed = utc_iso(now)
    return {"user_id": uid, "email": f"fixture{uid}@example.invalid", "username": username,
            "api_keys": [{"id": "9007199254740993", "name": "fixture A", "status": "active"},
                         {"id": "9007199254740994", "name": "fixture B", "status": "disabled"}],
            "token_usage": {"total": "900719925474099312345678901234567890"},
            "concurrency": {"current": current, "limit": 5 if quality != "untracked" else 0},
            "quality": {"identity": "fresh", "api_keys": "fresh", "token_usage": "fresh", "concurrency": quality},
            "observed_at": {"identity": observed, "api_keys": observed, "token_usage": observed,
                            "concurrency": observed if quality == "fresh" else None}}


def success_fixture(now=NOW, current=2):
    snapshot = empty_snapshot(now=now)
    snapshot.update({"sampled_at": utc_iso(now), "last_success_at": utc_iso(now),
                     "window": {"start": "2026-10-04T00:00:00+08:00", "end": utc_iso(now), "timezone": "Asia/Shanghai"},
                     "users": [user_fixture(current=current, now=now)],
                     "connection": {"status": "ok", "error_code": None, "http_status": None}})
    return snapshot


def four_user_fixture(now=NOW):
    snapshot = success_fixture(now=now)
    snapshot["source"]["authorized_user_ids"] = ["1", "4", "7", "8"]
    snapshot["users"] = [
        user_fixture("1", current=3, now=now, username="真实甲"),
        user_fixture("4", current=0, now=now, username="真实乙"),
        user_fixture("7", current=5, now=now, username="真实丙"),
        user_fixture("8", current=None, quality="untracked", now=now, username="真实丁"),
    ]
    return snapshot


def child_lock(path, output):
    try:
        with collector_lock(path):
            output.put("acquired")
    except AlreadyRunning:
        output.put("blocked")


class CollectorTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.now = NOW
        self.credential = self.root / "fixture-credential"
        self.credential.write_text(FIXTURE_TOKEN)
        self.credential.chmod(0o600)
        self.calls = []
        self.users = [user_fixture()]
        self.status = 200
        self.plugin_status = {"schema_version": 1, "plugin_id": 1, "healthy": True, "ready": True, "configured": True}
        self.mutate = lambda page: page
        self.store = OfficeStore(self.root / "office-config.sqlite3", clock=lambda: self.now, allowed_user_ids=("1",))
        self.collector = OfficeCollector(self.root, "https://fixture.example.invalid", self.credential, user_ids=("1",),
                                         transport=self.transport, clock=lambda: self.now)

    def transport(self, url, headers, timeout):
        self.calls.append((url, headers, timeout))
        if url.split("?")[0].endswith("/user-telemetry/status"):
            return self.status, json.dumps(self.plugin_status).encode()
        query = parse_qs(urlsplit(url).query)
        page = {"schema_version": 1, "window": {k: query[k][0] for k in ("start", "end", "timezone")},
                "users": copy.deepcopy(self.users), "next_cursor": None}
        return self.status, json.dumps(self.mutate(page)).encode()

    def test_success_shape_and_string_precision(self):
        snap = self.collector.collect_once()
        self.assertEqual(snap, read_snapshot(self.collector.snapshot_path))
        self.assertEqual(snap["users"][0]["api_keys"][0]["id"], "9007199254740993")
        self.assertEqual(snap["users"][0]["token_usage"]["total"], self.users[0]["token_usage"]["total"])
        self.assertEqual(snap["users"][0]["username"], "")
        self.assertEqual(self.collector.snapshot_path.stat().st_mode & 0o777, 0o600)
        url, headers, timeout = self.calls[0]
        self.assertEqual(urlsplit(url).path, "/api/v1/plugins/1/user-telemetry")
        self.assertEqual(parse_qs(urlsplit(url).query)["user_ids"], ["1"])
        self.assertEqual(headers["Authorization"], "Bearer " + FIXTURE_TOKEN)
        self.assertNotIn(FIXTURE_TOKEN, url)
        self.assertLessEqual(timeout, 4)
        self.assertEqual(snap["source"]["plugin_status"]["status"], "healthy")
        self.assertEqual(snap["source"]["rack_state"], "working")

    def test_plugin_health_drives_cabinet_idle_and_offline_states(self):
        self.users = [user_fixture(current=0)]
        idle = self.collector.collect_once()
        self.assertEqual(idle["source"]["rack_state"], "idle")
        self.plugin_status = {"schema_version": 1, "plugin_id": 1, "healthy": False, "ready": False, "configured": False}
        stopped = self.collector.collect_once()
        self.assertEqual(stopped["source"]["plugin_status"]["status"], "unhealthy")
        self.assertEqual(stopped["source"]["rack_state"], "offline")
        public = public_snapshot(self.store.read_config(), stopped, self.now)
        self.assertEqual(public["source"]["rack_state"], "offline")

    def test_all_http_failures_immediately_invalidate_and_remove_private_data(self):
        for status, code in ((401, "unauthorized"), (403, "forbidden"), (429, "rate_limited"), (503, "upstream_unavailable"), (400, "upstream_http_error")):
            with self.subTest(status=status):
                self.status = 200
                self.collector.collect_once()
                self.status = status
                snap = self.collector.collect_once()
                self.assertEqual(snap["connection"]["error_code"], code)
                self.assertEqual(snap["users"], [])
                self.assertIsNone(snap["window"])
                text = self.collector.snapshot_path.read_text()
                for private in (self.users[0]["email"], "fixture A", self.users[0]["token_usage"]["total"], FIXTURE_TOKEN):
                    self.assertNotIn(private, text)
                public = public_snapshot(self.store.read_config(), snap, self.now)
                self.assertEqual(public["stations"][11]["activity"], "unknown")
                self.assertIsNone(public["stations"][11]["concurrency"]["current"])

    def test_timeout_and_transport_error_do_not_leak_exception(self):
        for exception, code in ((TimeoutError(FIXTURE_TOKEN), "timeout"), (OSError(FIXTURE_TOKEN), "transport_error")):
            self.collector.transport = lambda *args: (_ for _ in ()).throw(exception)
            snap = self.collector.collect_once()
            self.assertEqual(snap["connection"]["error_code"], code)
            self.assertNotIn(FIXTURE_TOKEN, self.collector.snapshot_path.read_text())

    def test_unknown_concurrency_stays_null(self):
        for quality in ("unavailable", "untracked"):
            self.users = [user_fixture(current=None, quality=quality)]
            snap = self.collector.collect_once()
            self.assertEqual(snap["connection"]["status"], "ok")
            station = public_snapshot(self.store.read_config(), snap, self.now)["stations"][11]
            self.assertEqual(station["activity"], "unknown")
            self.assertEqual(station["quality"], quality)
            self.assertIsNone(station["animation_state"])

    def test_token_unavailable_not_zero_and_zero_preserved(self):
        self.users[0]["quality"]["token_usage"] = "unavailable"
        self.users[0]["token_usage"]["total"] = None
        self.users[0]["observed_at"]["token_usage"] = None
        snap = self.collector.collect_once()
        self.assertIsNone(snap["users"][0]["token_usage"]["total"])
        self.users = [user_fixture()]
        self.users[0]["token_usage"]["total"] = "0"
        self.assertEqual(self.collector.collect_once()["users"][0]["token_usage"]["total"], "0")

    def test_large_decimal_token_string_is_not_arbitrarily_truncated(self):
        self.users[0]["token_usage"]["total"] = "9" * 512
        self.assertEqual(self.collector.collect_once()["users"][0]["token_usage"]["total"], "9" * 512)

    def test_invalid_numeric_ids_and_tokens_rejected(self):
        for field, value in (("user_id", 1), ("user_id", "01"), ("user_id", "2"), ("token_usage", {"total": 9007199254740993})):
            self.users = [user_fixture()]
            self.users[0][field] = value
            snap = self.collector.collect_once()
            self.assertEqual(snap["connection"]["error_code"], "invalid_response")
            self.assertEqual(snap["users"], [])

    def test_incomplete_identity_or_keys_fails_whole_sample(self):
        for field in ("identity", "api_keys"):
            self.users = [user_fixture()]
            self.users[0]["quality"][field] = "unavailable"
            self.users[0]["observed_at"][field] = None
            self.assertEqual(self.collector.collect_once()["connection"]["error_code"], "invalid_response")

    def test_private_extras_never_pass_through(self):
        self.users[0]["model_requests"] = "private raw requests"
        self.users[0]["api_keys"][0]["key"] = "raw model secret"
        self.users[0]["token_usage"]["cost"] = "private cost"
        snap = self.collector.collect_once()
        text = json.dumps(snap)
        for marker in ("private raw requests", "raw model secret", "private cost"):
            self.assertNotIn(marker, text)

    def test_observation_age_not_refreshed_by_poll_time(self):
        self.users[0]["observed_at"]["concurrency"] = utc_iso(self.now - 15)
        snap = self.collector.collect_once()
        station = public_snapshot(self.store.read_config(), snap, self.now)["stations"][11]
        self.assertEqual(station["activity"], "unknown")
        self.assertEqual(station["reason"], "stale")

    def test_future_observation_unknown(self):
        self.users[0]["observed_at"]["concurrency"] = utc_iso(self.now + 1)
        snap = self.collector.collect_once()
        self.assertEqual(public_snapshot(self.store.read_config(), snap, self.now)["stations"][11]["activity"], "unknown")

    def test_age_exact_boundary_and_health(self):
        snap = self.collector.collect_once()
        self.assertTrue(collector_health(self.root, self.now + 14.999))
        self.assertFalse(collector_health(self.root, self.now + 15))
        self.assertEqual(public_snapshot(self.store.read_config(), snap, self.now + 15)["source"]["status"], "stale")

    def test_restart_invalidates_before_request(self):
        self.collector.collect_once()
        def check_during_request(*args):
            snapshot = read_snapshot(self.collector.snapshot_path)
            self.assertEqual(snapshot["users"], [])
            self.assertIsNone(snapshot["sampled_at"])
            raise TimeoutError()
        self.collector.transport = check_during_request
        self.collector.collect_once()

    def test_pagination_fixed_window_crosses_midnight(self):
        self.now = 1791043199.0  # fixture timestamp, independent from wall clock
        calls = []
        def paged(url, headers, timeout):
            query = parse_qs(urlsplit(url).query)
            calls.append(query)
            self.now += 2
            uid = "1" if len(calls) == 1 else "2"
            page = {"schema_version": 1, "window": {k: query[k][0] for k in ("start", "end", "timezone")},
                    "users": [user_fixture(uid=uid, now=self.now)], "next_cursor": "1" if len(calls) == 1 else None}
            return 200, json.dumps(page).encode()
        collector = OfficeCollector(self.root, "https://fixture.example.invalid", self.credential,
                                    user_ids=("1", "2"), transport=paged, clock=lambda: self.now)
        snap = collector.collect_once()
        self.assertEqual(len(snap["users"]), 2)
        for key in ("start", "end", "timezone"):
            self.assertEqual(calls[0][key], calls[1][key])
        self.assertEqual(calls[1]["cursor"], ["1"])

    def test_pagination_auth_failure_discards_partial_users(self):
        count = 0
        def paged(url, headers, timeout):
            nonlocal count
            count += 1
            if count == 2:
                return 403, b'private upstream error including secret'
            query = parse_qs(urlsplit(url).query)
            return 200, json.dumps({"schema_version": 1, "window": {k: query[k][0] for k in ("start", "end", "timezone")},
                                    "users": [user_fixture()], "next_cursor": "1"}).encode()
        self.collector.transport = paged
        self.assertEqual(self.collector.collect_once()["users"], [])
        self.assertNotIn("private", self.collector.snapshot_path.read_text())

    def test_pagination_repeated_cursor_and_duplicate_user(self):
        self.mutate = lambda page: {**page, "next_cursor": "1"}
        self.assertEqual(self.collector.collect_once()["connection"]["error_code"], "pagination_error")
        self.mutate = lambda page: {**page, "users": [user_fixture(), user_fixture()]}
        self.assertEqual(self.collector.collect_once()["connection"]["error_code"], "invalid_response")

    def test_pagination_window_mismatch(self):
        self.mutate = lambda page: {**page, "window": {**page["window"], "end": utc_iso(self.now - 1)}}
        self.assertEqual(self.collector.collect_once()["connection"]["error_code"], "pagination_error")

    def test_response_limit_and_invalid_json(self):
        for data in (b"x" * (MAX_RESPONSE_BYTES + 1), b'{"secret":"bad-json"', b"null", b'[]'):
            self.collector.transport = lambda *args: (200, data)
            self.assertEqual(self.collector.collect_once()["connection"]["error_code"], "invalid_response")

    def test_credential_mode_symlink_and_format(self):
        self.credential.chmod(0o644)
        self.assertEqual(self.collector.collect_once()["connection"]["error_code"], "invalid_credential_file")
        self.credential.chmod(0o600)
        symlink = self.root / "fixture-link"
        symlink.symlink_to(self.credential)
        with self.assertRaises(CollectorFailure):
            read_credential(symlink)
        for value in ("admin-jwt", "sk-model-key", "s2ut_short", FIXTURE_TOKEN + "\nX-Secret: leak"):
            self.credential.write_text(value)
            with self.assertRaises(CollectorFailure):
                read_credential(self.credential)

    def test_credentials_expire_without_request(self):
        collector = OfficeCollector(self.root, "https://fixture.example.invalid", self.credential,
                                    credential_expires_at=utc_iso(self.now), transport=self.transport, clock=lambda: self.now)
        self.assertEqual(collector.collect_once()["connection"]["error_code"], "credential_expired")
        self.assertEqual(self.calls, [])

    def test_origins_redirect_and_tls_policy(self):
        for origin in ("http://fixture.example.invalid", "https://user:secret@fixture.example.invalid", "https://fixture.example.invalid?token=secret",
                       "https://fixture.example.invalid/other", "https://fixture.example.invalid#x", "https://fixture.example.invalid:bad", "", "https://fixture.example.invalid\n"):
            with self.subTest(origin=origin):
                with self.assertRaises(ValueError):
                    OfficeCollector(self.root, origin, self.credential)
        self.assertIsNone(NoRedirect().redirect_request(None, None, 302, "", {}, "https://other.invalid"))

    def test_cross_process_single_instance_lock(self):
        context = multiprocessing.get_context("spawn")
        output = context.Queue()
        with collector_lock(self.collector.lock_path):
            process = context.Process(target=child_lock, args=(self.collector.lock_path, output))
            process.start()
            process.join(10)
            self.assertEqual(process.exitcode, 0)
            self.assertEqual(output.get(timeout=3), "blocked")
            with self.assertRaises(AlreadyRunning):
                self.collector.collect_once()
        with collector_lock(self.collector.lock_path):
            pass
        output.close()

    def test_atomic_reader_never_sees_partial_write(self):
        first, second = success_fixture(), empty_snapshot("forbidden", now=self.now)
        atomic_snapshot(self.collector.snapshot_path, first)
        errors = []
        def writer():
            for _ in range(50):
                atomic_snapshot(self.collector.snapshot_path, second)
                atomic_snapshot(self.collector.snapshot_path, first)
        thread = threading.Thread(target=writer)
        thread.start()
        while thread.is_alive():
            snap = read_snapshot(self.collector.snapshot_path)
            if snap["connection"]["error_code"] == "invalid_response":
                errors.append(snap)
        thread.join()
        self.assertEqual(errors, [])
        self.assertEqual(list(self.root.glob(".office-snapshot-*")), [])

    def test_missing_corrupt_or_failed_snapshot_read_fails_closed(self):
        self.assertEqual(read_snapshot(self.collector.snapshot_path)["users"], [])
        for raw in ("bad json", '{"schema_version":1}', '[]', json.dumps({**success_fixture(), "connection": None})):
            self.collector.snapshot_path.write_text(raw)
            self.assertEqual(read_snapshot(self.collector.snapshot_path)["users"], [])
        snap = success_fixture()
        snap["connection"] = {"status": "unknown", "error_code": "forbidden", "http_status": 403}
        atomic_snapshot(self.collector.snapshot_path, snap)
        self.assertEqual(read_snapshot(self.collector.snapshot_path)["users"], [])

    def test_dynamic_interval_and_three_cycles(self):
        config = self.store.read_config()
        value = {k: config[k] for k in ("bindings", "display", "collection")}
        value["collection"] = {"poll_interval_seconds": 10}
        self.store.save_config(1, value)
        snap = self.collector.collect_once()
        self.assertEqual(snap["source"]["interval_seconds"], 10)
        self.assertEqual(public_snapshot(self.store.read_config(), snap, self.now + 29)["summary"]["busy"], 1)
        self.assertFalse(collector_health(self.root, self.now + 30))

    def test_run_default_cadence_without_browser_jobs(self):
        class FixtureStop:
            def __init__(self):
                self.waits = []
                self.stopped = False
            def is_set(self):
                return self.stopped
            def wait(self, seconds):
                self.waits.append(seconds)
                self.stopped = True
        event = FixtureStop()
        self.collector.monotonic = lambda: 0
        self.collector.run(event)
        self.assertEqual(event.waits, [1])
        self.assertEqual(len([call for call in self.calls if call[0].split("?")[0].endswith("/user-telemetry")]), 1)

    def test_configuration_read_failure_invalidates_previous_snapshot(self):
        self.collector.collect_once()
        self.collector._start()
        with patch.object(self.collector.store, "read_config", side_effect=__import__("sqlite3").OperationalError("fixture DB unavailable")):
            snap = self.collector._collect_and_write()
            self.assertEqual(snap["connection"]["error_code"], "configuration_unavailable")
            self.assertEqual(snap["users"], [])

    def test_collection_total_deadline_bounded(self):
        times = iter([0, 0, 11])
        self.collector.monotonic = lambda: next(times)
        snap = self.collector.collect_once()
        self.assertEqual(snap["connection"]["error_code"], "collection_timeout")

    def test_shanghai_window_near_midnight_is_correct(self):
        from datetime import datetime
        for when in ("2026-10-03T23:59:59+08:00", "2026-10-04T00:00:01+08:00"):
            self.now = datetime.fromisoformat(when).timestamp()
            self.users = [user_fixture(now=self.now)]
            snap = self.collector.collect_once()
            self.assertTrue(snap["window"]["start"].startswith(when[:10] + "T00:00:00"))
            self.assertEqual(snap["window"]["end"], when)

    def test_start_invalidates_before_sqlite_initialization(self):
        self.collector.collect_once()
        def initializing(*args, **kwargs):
            snapshot = read_snapshot(self.collector.snapshot_path)
            self.assertEqual(snapshot["users"], [])
            self.assertIsNone(snapshot["sampled_at"])
            raise __import__("sqlite3").OperationalError("fixture schema lock")
        with patch("backend.office_collector.OfficeStore", side_effect=initializing):
            with self.assertRaises(__import__("sqlite3").OperationalError):
                self.collector.collect_once()
        self.assertEqual(read_snapshot(self.collector.snapshot_path)["connection"]["error_code"], "configuration_unavailable")

    def test_poll_interval_reduction_wakes_without_old_30_second_delay(self):
        config = self.store.read_config()
        value = {k: config[k] for k in ("bindings", "display", "collection")}
        value["collection"] = {"poll_interval_seconds": 30}
        self.store.save_config(config["version"], value)
        elapsed, calls_at = [0.0], []
        self.collector.monotonic = lambda: elapsed[0]
        self.collector.clock = lambda: NOW + elapsed[0]
        original_transport = self.transport
        def transport(*args):
            self.now = NOW + elapsed[0]
            self.users = [user_fixture(now=self.now)]
            if not args[0].endswith("/user-telemetry/status"):
                calls_at.append(elapsed[0])
            return original_transport(*args)
        self.collector.transport = transport
        class Stop:
            def is_set(inner):
                return len(calls_at) >= 2
            def wait(inner, seconds):
                elapsed[0] += seconds
                if elapsed[0] == 2:
                    config = self.store.read_config()
                    content = {k: config[k] for k in ("bindings", "display", "collection")}
                    content["collection"] = {"poll_interval_seconds": 5}
                    self.store.save_config(config["version"], content)
        self.collector.run(Stop())
        self.assertEqual(calls_at, [0, 5])
        self.assertEqual(read_snapshot(self.collector.snapshot_path)["source"]["interval_seconds"], 5)

    def test_poll_interval_increase_reschedules_next_request(self):
        elapsed, calls_at = [0.0], []
        self.collector.monotonic = lambda: elapsed[0]
        self.collector.clock = lambda: NOW + elapsed[0]
        original_transport = self.transport
        def transport(*args):
            self.now = NOW + elapsed[0]
            self.users = [user_fixture(now=self.now)]
            if not args[0].endswith("/user-telemetry/status"):
                calls_at.append(elapsed[0])
            return original_transport(*args)
        self.collector.transport = transport
        class Stop:
            def is_set(inner):
                return len(calls_at) >= 2
            def wait(inner, seconds):
                elapsed[0] += seconds
                if elapsed[0] == 2:
                    config = self.store.read_config()
                    content = {k: config[k] for k in ("bindings", "display", "collection")}
                    content["collection"] = {"poll_interval_seconds": 30}
                    self.store.save_config(config["version"], content)
        self.collector.run(Stop())
        self.assertEqual(calls_at, [0, 30])

    def test_health_observes_shorter_config_period_and_does_not_create_db(self):
        config = self.store.read_config()
        value = {k: config[k] for k in ("bindings", "display", "collection")}
        value["collection"] = {"poll_interval_seconds": 30}
        self.store.save_config(config["version"], value)
        self.collector.collect_once()
        self.assertTrue(collector_health(self.root, NOW + 20))
        value["collection"] = {"poll_interval_seconds": 5}
        self.store.save_config(2, value)
        self.assertFalse(collector_health(self.root, NOW + 20))
        new_dir = self.root / "missing-volume"
        self.assertFalse(collector_health(new_dir, NOW))
        self.assertFalse(new_dir.exists())

    def test_credential_exact_modes_and_fifo_never_blocks(self):
        for mode in (0o700, 0o644, 0o640, 0o4600):
            self.credential.chmod(mode)
            with self.assertRaises(CollectorFailure):
                read_credential(self.credential)
        self.credential.chmod(0o400)
        self.assertEqual(read_credential(self.credential), FIXTURE_TOKEN)
        fifo = self.root / "fixture-fifo"
        os.mkfifo(fifo, 0o600)
        started = time.monotonic()
        with self.assertRaises(CollectorFailure):
            read_credential(fifo)
        self.assertLess(time.monotonic() - started, 1)

    def test_transport_tls_verifies_and_proxies_redirects_are_disabled(self):
        from unittest.mock import MagicMock
        opener = MagicMock()
        response = opener.open.return_value.__enter__.return_value
        response.status = 200
        response.read.return_value = b"{}"
        with patch("backend.office_collector.urllib.request.build_opener", return_value=opener) as build:
            self.assertEqual(http_get("https://fixture.example.invalid/telemetry", {"Authorization": "Bearer " + FIXTURE_TOKEN}, 4), (200, b"{}"))
            handlers = build.call_args.args
            self.assertEqual(handlers[0].proxies, {})
            self.assertIsInstance(handlers[1], NoRedirect)
            self.assertEqual(handlers[2]._context.verify_mode, ssl.CERT_REQUIRED)
            self.assertTrue(handlers[2]._context.check_hostname)
        for status in (301, 302, 307, 308):
            body = io.BytesIO(b"fixture-private-upstream-body")
            opener.open.side_effect = urllib.error.HTTPError("https://fixture.example.invalid", status, "redirect", {}, body)
            with patch("backend.office_collector.urllib.request.build_opener", return_value=opener):
                self.assertEqual(http_get("https://fixture.example.invalid/telemetry", {"Authorization": "Bearer " + FIXTURE_TOKEN}, 4), (status, b""))
            self.assertTrue(body.closed)

    def test_tls_verification_failure_immediately_clears_users(self):
        self.collector.collect_once()
        self.collector.transport = lambda *args: (_ for _ in ()).throw(urllib.error.URLError(ssl.SSLCertVerificationError("fixture invalid cert")))
        snap = self.collector.collect_once()
        self.assertEqual(snap["connection"]["status"], "unknown")
        self.assertEqual(snap["users"], [])

    def test_uid10001_metadata_owner_supported_without_group_permission(self):
        original = self.credential.stat()
        simulated = os.stat_result((original.st_mode, original.st_ino, original.st_dev, original.st_nlink,
                                    10001, 10001, original.st_size, original.st_atime, original.st_mtime, original.st_ctime))
        with patch("backend.office_collector.os.geteuid", return_value=10001), patch("backend.office_collector.os.fstat", return_value=simulated):
            self.assertEqual(read_credential(self.credential), FIXTURE_TOKEN)

    def test_readonly_rootfs_writes_remain_in_shared_volume(self):
        # Restricted source tree is never a target: all Python writes and SQLite
        # journals must be at or below the injected shared data volume.
        original_open, original_connect = os.open, __import__("sqlite3").connect
        targets = []
        def open_guard(path, flags, *args, **kwargs):
            if flags & (os.O_WRONLY | os.O_RDWR | os.O_CREAT):
                target = Path(path).resolve()
                self.assertTrue(target.is_relative_to(self.root.resolve()), target)
                targets.append(target)
            return original_open(path, flags, *args, **kwargs)
        def connect_guard(database, *args, **kwargs):
            target = Path(database).resolve()
            self.assertTrue(target.is_relative_to(self.root.resolve()), target)
            targets.append(target)
            return original_connect(database, *args, **kwargs)
        with patch("backend.office_collector.os.open", side_effect=open_guard), patch("backend.office_store.sqlite3.connect", side_effect=connect_guard):
            self.collector.collect_once()
            self.store.create_session("fixture-session", True, 60)
            self.store.claim_login_attempt("fixture-peer")
        with original_connect(self.store.path) as db:
            self.assertEqual(db.execute("PRAGMA journal_mode").fetchone()[0], "delete")
        self.assertTrue(targets)
        self.assertEqual(self.store.path.stat().st_mode & 0o777, 0o600)
        self.assertEqual(self.collector.snapshot_path.stat().st_mode & 0o777, 0o600)

    def test_four_user_collector_uses_explicit_scope_and_preserves_independent_fields(self):
        from unittest.mock import patch
        root = self.root / "four-profile"
        self.users = four_user_fixture()["users"]
        with patch.dict(os.environ, {"OFFICE_USER_IDS": "1,4,7,8"}):
            collector = OfficeCollector(root, "https://fixture.example.invalid", self.credential,
                                        user_ids=("1", "4", "7", "8"), transport=self.transport, clock=lambda: self.now)
            snap = collector.collect_once()
        telemetry_calls = [call for call in self.calls if call[0].split("?")[0].endswith("/user-telemetry")]
        self.assertEqual(parse_qs(urlsplit(telemetry_calls[-1][0]).query)["user_ids"], ["1,4,7,8"])
        store = OfficeStore(root / "office-config.sqlite3")
        public = public_snapshot(store.read_config(), snap, self.now)
        self.assertEqual(public["summary"], {"bound": 4, "busy": 2, "idle": 1, "unknown": 1})
        stations = {station["seat_id"]: station for station in public["stations"]}
        for seat, name, count in (("desk-12", "真实甲", 3), ("desk-09", "真实乙", 0),
                                  ("desk-10", "真实丙", 5), ("desk-11", "真实丁", None)):
            station = stations[seat]
            self.assertEqual(station["username"], name)
            self.assertEqual(station["identity_quality"], "fresh")
            self.assertEqual(station["concurrency"]["current"], count)
        self.assertIsNone(stations["desk-11"]["animation_state"])

    def test_four_user_snapshot_invalidated_by_any_auth_failure(self):
        root = self.root / "four-errors"
        self.users = four_user_fixture()["users"]
        with patch.dict(os.environ, {"OFFICE_USER_IDS": "1,4,7,8"}):
            collector = OfficeCollector(root, "https://fixture.example.invalid", self.credential,
                                        user_ids=("1", "4", "7", "8"), transport=self.transport, clock=lambda: self.now)
            config = OfficeStore(root / "office-config.sqlite3").read_config()
            for code in (401, 403, 503):
                self.status = 200
                collector.collect_once()
                self.status = code
                snap = collector.collect_once()
                self.assertEqual(snap["users"], [])
                public = public_snapshot(config, snap, self.now)
                self.assertEqual(public["summary"]["unknown"], 4)
                for station in public["stations"]:
                    self.assertIsNone(station["username"])
                    self.assertIsNone(station["concurrency"]["current"])
                    self.assertIsNone(station["identity_observed_at"])

    def test_constructor_default_profile_and_explicit_narrow_scope(self):
        for environment, argument, expected in ((None, None, ("1", "4", "7", "8")),
                                                  ("1", None, ("1",)),
                                                  ("1,4,7,8", ("1",), ("1",)),
                                                  (None, ("4", "8"), ("4", "8"))):
            with self.subTest(environment=environment, argument=argument), patch.dict(os.environ):
                if environment is None:
                    os.environ.pop("OFFICE_USER_IDS", None)
                else:
                    os.environ["OFFICE_USER_IDS"] = environment
                collector = OfficeCollector(self.root, "https://fixture.example.invalid", self.credential,
                                            user_ids=argument, transport=self.transport)
                self.assertEqual(collector.user_ids, expected)
                self.assertEqual(collector.source["authorized_user_ids"], list(expected))

    def test_cli_defaults_use_same_profile_without_sending_fixture_to_network(self):
        from backend.office_collector import main
        from unittest.mock import MagicMock
        for environment, expected in ((None, ("1", "4", "7", "8")), ("1", ("1",))):
            collector = MagicMock()
            collector.collect_once.return_value = {"connection": {"status": "ok"}}
            with self.subTest(environment=environment), patch.dict(os.environ):
                if environment is None:
                    os.environ.pop("OFFICE_USER_IDS", None)
                else:
                    os.environ["OFFICE_USER_IDS"] = environment
                with patch.object(sys, "argv", ["office_collector", "--once", "--data-dir", str(self.root)]), \
                        patch("backend.office_collector.OfficeCollector", return_value=collector) as constructor:
                    self.assertEqual(main(), 0)
                    self.assertEqual(constructor.call_args.kwargs["user_ids"], expected)

    def test_collector_store_initializes_to_explicit_scope_not_environment_default(self):
        for scope in (("1",), ("4", "8"), ("1", "4", "7", "8")):
            root = self.root / ("narrow-" + "-".join(scope))
            self.users = [user_fixture(uid=uid) for uid in scope]
            with patch.dict(os.environ, {"OFFICE_USER_IDS": "1,4,7,8"}):
                collector = OfficeCollector(root, "https://fixture.example.invalid", self.credential,
                                            user_ids=scope, transport=self.transport, clock=lambda: self.now)
                snap = collector.collect_once()
            config = collector.store.read_config()
            self.assertEqual({b["user_id"] for b in config["bindings"]}, set(scope))
            self.assertEqual(snap["source"]["authorized_user_ids"], list(scope))
            self.status = 403
            self.assertEqual(collector.collect_once()["source"]["authorized_user_ids"], list(scope))
            self.status = 200

    def test_collector_reopen_does_not_migrate_scope1_database_to_four(self):
        saved, history = self.store.read_config(), self.store.history()
        self.users = four_user_fixture()["users"]
        collector = OfficeCollector(self.root, "https://fixture.example.invalid", self.credential,
                                    user_ids=("1", "4", "7", "8"), transport=self.transport, clock=lambda: self.now)
        collector.collect_once()
        self.assertEqual(collector.store.read_config(), saved)
        self.assertEqual(collector.store.history(), history)

    def test_empty_snapshot_without_profile_never_invents_four_user_authorization(self):
        self.assertEqual(empty_snapshot()["source"]["authorized_user_ids"], ["1"])
        for scope in (("1",), ("4", "8")):
            source = {**empty_snapshot()["source"], "authorized_user_ids": list(scope)}
            self.assertEqual(empty_snapshot(source=source)["source"]["authorized_user_ids"], list(scope))

    def test_fixed_no_task_inference(self):
        self.users[0]["concurrency"]["current"] = 0
        self.users[0]["status"] = "disabled"
        self.users[0]["token_usage"]["total"] = "99999999999999999999999999"
        snap = self.collector.collect_once()
        self.assertEqual(public_snapshot(self.store.read_config(), snap, self.now)["stations"][11]["animation_state"], "idle")
        self.users[0]["concurrency"]["current"] = 3
        snap = self.collector.collect_once()
        self.assertEqual(public_snapshot(self.store.read_config(), snap, self.now)["stations"][11]["animation_state"], "writing")


if __name__ == "__main__":
    unittest.main(verbosity=2)
