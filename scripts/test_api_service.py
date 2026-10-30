#!/usr/bin/env python3
"""Contract tests for the standalone provider-neutral API."""
from __future__ import annotations

import os
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from api_service.app import create_app
from api_service.store import StateStore


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


class APIServiceTests(unittest.TestCase):
    def setUp(self):
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
