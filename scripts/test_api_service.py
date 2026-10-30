#!/usr/bin/env python3
"""Contract tests for the standalone provider-neutral API."""
from __future__ import annotations

import os
import copy
import json
import sqlite3
import sys
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from api_service.app import create_app
from api_service.store import StateStore


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


class APIServiceTests(unittest.TestCase):
    def setUp(self):
        from unittest.mock import patch
        self.env = patch.dict(os.environ, {"API_AUTH_MODE":"none", "API_PROJECT_KEYS_FILE":""})
        self.env.start()
        self.addCleanup(self.env.stop)
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.store = StateStore(Path(self.temp.name) / "state.sqlite3")
        self.app = create_app(store=self.store, testing=True)
        self.client = self.app.test_client()

    def event(self, event_id="evt-1", state="writing"):
        return {
            "event_id": event_id,
            "type": "agent.state_changed",
            "occurred_at": now_iso(),
            "source": "unit-test",
            "agent": {"id": "agent-1", "name": "测试代理", "state": state,
                      "detail": "处理中", "area": "writing", "metadata": {"team": "dev"}},
            "metadata": {"request": "test"},
        }

    def test_health_and_readiness_are_public(self):
        health = self.client.get("/api/v1/health")
        self.assertEqual(health.status_code, 200)
        self.assertEqual(health.get_json()["status"], "ok")
        self.assertTrue(health.headers["X-Request-ID"])
        readiness = self.client.get("/api/v1/readiness")
        self.assertEqual(readiness.status_code, 200)
        self.assertTrue(readiness.get_json()["ready"])

    def test_event_is_idempotent_and_projects_agent(self):
        payload = self.event()
        first = self.client.post("/api/v1/events", json=payload)
        self.assertEqual(first.status_code, 201)
        self.assertTrue(first.get_json()["created"])
        replay = self.client.post("/api/v1/events", json=payload)
        self.assertEqual(replay.status_code, 200)
        self.assertFalse(replay.get_json()["created"])
        agents = self.client.get("/api/v1/agents").get_json()["agents"]
        self.assertEqual(len(agents), 1)
        self.assertEqual(agents[0]["state"], "writing")
        events = self.client.get("/api/v1/events").get_json()["events"]
        self.assertEqual(len(events), 1)

    def test_reusing_event_id_with_different_payload_is_conflict(self):
        self.assertEqual(self.client.post("/api/v1/events", json=self.event()).status_code, 201)
        changed = self.event(state="error")
        self.assertEqual(self.client.post("/api/v1/events", json=changed).status_code, 409)

    def test_older_event_does_not_rewind_latest_projection(self):
        newer = self.event("evt-new", state="writing")
        current = datetime.now(timezone.utc)
        newer["occurred_at"] = current.isoformat().replace("+00:00", "Z")
        older = self.event("evt-old", state="idle")
        older["occurred_at"] = (current.replace(microsecond=max(0, current.microsecond - 1_000))).isoformat().replace("+00:00", "Z")
        self.assertEqual(self.client.post("/api/v1/events", json=newer).status_code, 201)
        self.assertEqual(self.client.post("/api/v1/events", json=older).status_code, 201)
        self.assertEqual(self.client.get("/api/v1/agents/agent-1").get_json()["state"], "writing")

    def test_invalid_event_and_secret_metadata_are_rejected(self):
        invalid = self.event()
        invalid["agent"]["state"] = "unknown"
        self.assertEqual(self.client.post("/api/v1/events", json=invalid).status_code, 400)
        invalid = self.event("evt-secret")
        invalid["metadata"] = {"api_key": "should-not-enter"}
        self.assertEqual(self.client.post("/api/v1/events", json=invalid).status_code, 400)
        self.assertEqual(self.client.get("/api/v1/agents").get_json()["agents"], [])

    def test_oversized_request_is_rejected(self):
        response = self.client.post("/api/v1/events", data="{" + "x" * (256 * 1024) + "}",
                                    content_type="application/json")
        self.assertEqual(response.status_code, 413)
        self.assertEqual(response.get_json()["error"]["code"], "REQUEST_TOO_LARGE")

    def test_snapshot_is_provider_neutral(self):
        self.client.post("/api/v1/events", json=self.event())
        snapshot = self.client.get("/api/v1/snapshot").get_json()
        self.assertEqual(snapshot["source"]["provider"], "standalone")
        self.assertEqual(snapshot["agents"][0]["id"], "agent-1")
        self.assertNotIn("sub2api", str(snapshot).lower())

    def test_concurrent_retries_and_metadata_order_are_idempotent(self):
        body = self.event()
        body["metadata"] = {"a": 1, "b": 2}
        barrier = threading.Barrier(12)
        def publish(_):
            with self.app.test_client() as client:
                barrier.wait()
                return client.post("/api/v1/events", json=body).status_code
        with ThreadPoolExecutor(max_workers=12) as pool:
            statuses = list(pool.map(publish, range(12)))
        self.assertEqual(sorted(statuses), [200] * 11 + [201])
        body["metadata"] = {"b": 2, "a": 1}
        self.assertEqual(self.client.post("/api/v1/events", data=json.dumps(body),
                                        content_type="application/json").status_code, 200)

    def test_put_uses_path_id_and_requires_stable_retry_time(self):
        body = {"state": "writing", "occurred_at": now_iso()}
        headers = {"Idempotency-Key": "put-1"}
        first = self.client.put("/api/v1/agents/path-agent", json=body, headers=headers)
        self.assertEqual(first.status_code, 201)
        self.assertEqual(first.get_json()["agent"]["id"], "path-agent")
        self.assertEqual(self.client.put("/api/v1/agents/path-agent", json=body, headers=headers).status_code, 200)
        for bad in ({"state": "writing"}, {**body, "extra": True}, {**body, "id": "other"},
                    {**body, "event_id": "different"}):
            self.assertEqual(self.client.put("/api/v1/agents/path-agent", json=bad, headers=headers).status_code, 400)

    def test_fractional_second_projection_and_old_database_migration(self):
        whole = (datetime.now(timezone.utc) - timedelta(seconds=2)).replace(microsecond=0)
        body = self.event()
        body["occurred_at"] = whole.isoformat().replace("+00:00", "Z")
        self.assertEqual(self.client.post("/api/v1/events", json=body).status_code, 201)
        # Recreate a database written by the original implementation.
        with sqlite3.connect(self.store.path) as db:
            payload = json.loads(db.execute("SELECT payload_json FROM events").fetchone()[0])
            payload["agent"]["updated_at"] = body["occurred_at"]
            db.execute("UPDATE events SET occurred_at=?,received_at=?,payload_json=?",
                       (body["occurred_at"], body["occurred_at"], json.dumps(payload)))
            db.execute("UPDATE agents SET updated_at=?", (body["occurred_at"],))
            db.execute("DELETE FROM service_meta WHERE name='timestamps_v2'")
        with ThreadPoolExecutor(max_workers=4) as pool:
            list(pool.map(lambda _: StateStore(self.store.path), range(4)))
        self.assertEqual(self.client.post("/api/v1/events", json=body).status_code, 200)
        later = copy.deepcopy(body)
        later.update(event_id="fractional", occurred_at=(whole + timedelta(microseconds=1)).isoformat())
        later["agent"]["state"] = "executing"
        self.assertEqual(self.client.post("/api/v1/events", json=later).status_code, 201)
        self.assertEqual(self.client.get("/api/v1/agents/agent-1").get_json()["state"], "executing")

    def test_pagination_never_silently_truncates(self):
        for index in range(205):
            body = self.event(f"page-{index}")
            body["agent"]["id"] = f"agent-{index:03d}"
            self.assertEqual(self.client.post("/api/v1/events", json=body).status_code, 201)
        first = self.client.get("/api/v1/events?limit=200").get_json()
        second = self.client.get(f"/api/v1/events?limit=200&after_sequence={first['next_cursor']}").get_json()
        self.assertEqual(len(first["events"])+len(second["events"]), 205)
        self.assertEqual(len({row["sequence"] for row in first["events"]+second["events"]}), 205)
        self.assertIsNone(second["next_cursor"])
        page = self.client.get("/api/v1/agents?limit=200").get_json()
        rest = self.client.get(f"/api/v1/agents?limit=200&after_id={page['next_cursor']}").get_json()
        self.assertEqual(len(page["agents"])+len(rest["agents"]), 205)
        snapshot = self.client.get("/api/v1/snapshot").get_json()
        self.assertFalse(snapshot["complete"])
        self.assertEqual(snapshot["next_cursor"], page["next_cursor"])

    def test_new_events_do_not_refresh_other_agents_or_take_over_source(self):
        old = self.event("old")
        old["occurred_at"] = (datetime.now(timezone.utc)-timedelta(seconds=60)).isoformat()
        self.client.post("/api/v1/events", json=old)
        new = self.event("new")
        new["agent"]["id"] = "agent-2"
        self.client.post("/api/v1/events", json=new)
        rows = self.client.get("/api/v1/snapshot").get_json()["agents"]
        self.assertEqual([row["freshness"] for row in rows], ["stale", "fresh"])
        takeover = self.event("takeover")
        takeover["source"] = "another-company"
        self.assertEqual(self.client.post("/api/v1/events", json=takeover).status_code, 409)

    def test_nonfinite_json_and_cors_idempotency_header(self):
        for number in ("NaN", "Infinity", "-Infinity", "1e309"):
            raw = json.dumps(self.event()).replace('"test"', number)
            self.assertEqual(self.client.post("/api/v1/events", data=raw, content_type="application/json").status_code, 400)
        self.app.config["API_ALLOWED_ORIGINS"] = "https://company.example"
        response = self.client.options("/api/v1/events", headers={"Origin": "https://company.example",
                                      "Access-Control-Request-Headers": "Idempotency-Key"})
        self.assertIn("Idempotency-Key", response.headers["Access-Control-Allow-Headers"])


class AuthenticatedAPIServiceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.store = StateStore(Path(self.temp.name) / "state.sqlite3")
        self.old_mode = os.environ.get("API_AUTH_MODE")
        self.old_key = os.environ.get("API_SERVICE_KEY")
        os.environ["API_AUTH_MODE"] = "key"
        os.environ["API_SERVICE_KEY"] = "k" * 32
        self.app = create_app(store=self.store, testing=True)
        self.client = self.app.test_client()

    def tearDown(self):
        if self.old_mode is None:
            os.environ.pop("API_AUTH_MODE", None)
        else:
            os.environ["API_AUTH_MODE"] = self.old_mode
        if self.old_key is None:
            os.environ.pop("API_SERVICE_KEY", None)
        else:
            os.environ["API_SERVICE_KEY"] = self.old_key
        self.temp.cleanup()

    def test_health_public_but_business_routes_require_bearer(self):
        self.assertEqual(self.client.get("/api/v1/health").status_code, 200)
        self.assertEqual(self.client.get("/api/v1/agents").status_code, 401)
        response = self.client.get("/api/v1/agents", headers={"Authorization": "Bearer " + "k" * 32})
        self.assertEqual(response.status_code, 200)


if __name__ == "__main__":
    unittest.main()
