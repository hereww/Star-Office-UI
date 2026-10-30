"""Small SQLite state/event store used by the standalone API service.

The store deliberately contains only integration state. It never stores API
keys, bearer tokens, passwords, or upstream provider responses.
"""
from __future__ import annotations

import json
import hashlib
import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone, timedelta
from pathlib import Path


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="microseconds").replace("+00:00", "Z")


def canonical_json(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


class EventConflict(Exception):
    """The same event ID was reused with a different payload."""


class CapacityExceeded(Exception):
    pass


class StateStore:
    """SQLite-backed event log and latest agent projection."""

    def __init__(self, path: str | os.PathLike[str]):
        self.path = Path(path).expanduser()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        if not self.path.exists():
            self.path.touch(mode=0o600)
        else:
            self.path.chmod(self.path.stat().st_mode & 0o600)
        self._initialize()

    @contextmanager
    def _connection(self):
        connection = sqlite3.connect(self.path, timeout=5)
        connection.row_factory = sqlite3.Row
        try:
            yield connection
            connection.commit()
        finally:
            connection.close()

    def _initialize(self) -> None:
        with self._connection() as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.executescript(
                """
                CREATE TABLE IF NOT EXISTS agents (
                    agent_id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    state TEXT NOT NULL,
                    detail TEXT NOT NULL,
                    area TEXT NOT NULL,
                    source TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    metadata_json TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS events (
                    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
                    event_id TEXT NOT NULL UNIQUE,
                    event_type TEXT NOT NULL,
                    occurred_at TEXT NOT NULL,
                    received_at TEXT NOT NULL,
                    source TEXT NOT NULL,
                    payload_json TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS events_occurred_idx
                    ON events (occurred_at, sequence);
                CREATE TABLE IF NOT EXISTS service_meta (name TEXT PRIMARY KEY, value TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS health_probe (id INTEGER PRIMARY KEY, nonce INTEGER NOT NULL);
                INSERT OR IGNORE INTO health_probe VALUES(1,0);
                CREATE TABLE IF NOT EXISTS telemetry_subjects (
                    project TEXT NOT NULL, subject_id TEXT NOT NULL, observed_at TEXT NOT NULL,
                    payload TEXT NOT NULL, PRIMARY KEY(project,subject_id));
                CREATE TABLE IF NOT EXISTS telemetry_events (
                    project TEXT NOT NULL, event_id TEXT NOT NULL, digest TEXT NOT NULL,
                    received_at TEXT NOT NULL, applied INTEGER NOT NULL,
                    PRIMARY KEY(project,event_id));
                CREATE INDEX IF NOT EXISTS telemetry_received ON telemetry_events(received_at);
                """
            )
            # One-time normalization preserves existing IDs and avoids TEXT ordering
            # reversing whole-second and fractional-second observations.
            db.execute("BEGIN IMMEDIATE")
            if not db.execute("SELECT 1 FROM service_meta WHERE name='timestamps_v2'").fetchone():
                from backend.team_telemetry import timestamp
                for row in db.execute("SELECT sequence,occurred_at,received_at,payload_json FROM events").fetchall():
                    payload = json.loads(row["payload_json"])
                    payload["agent"]["updated_at"] = timestamp(payload["agent"]["updated_at"])
                    db.execute("UPDATE events SET occurred_at=?,received_at=?,payload_json=? WHERE sequence=?",
                               (timestamp(row["occurred_at"]), timestamp(row["received_at"]),
                                canonical_json(payload), row["sequence"]))
                for row in db.execute("SELECT agent_id,updated_at FROM agents").fetchall():
                    db.execute("UPDATE agents SET updated_at=? WHERE agent_id=?",
                               (timestamp(row["updated_at"]), row["agent_id"]))
                db.execute("INSERT INTO service_meta VALUES('timestamps_v2','1')")

    def ping(self) -> None:
        if not self.path.stat().st_mode & 0o222:
            raise sqlite3.OperationalError("storage is read only")
        with self._connection() as db:
            db.execute("BEGIN IMMEDIATE")
            db.execute("UPDATE health_probe SET nonce=nonce+1 WHERE id=1")
            db.rollback()

    @staticmethod
    def _agent_row(row: sqlite3.Row) -> dict:
        return {
            "id": row["agent_id"], "name": row["name"], "state": row["state"],
            "detail": row["detail"], "area": row["area"], "source": row["source"],
            "updated_at": row["updated_at"], "metadata": json.loads(row["metadata_json"]),
        }

    def get_agent(self, agent_id: str) -> dict | None:
        with self._connection() as db:
            row = db.execute("SELECT * FROM agents WHERE agent_id = ?", (agent_id,)).fetchone()
        return self._agent_row(row) if row else None

    def list_agents(self, *, state: str | None = None, limit: int = 100, after_id: str = "") -> list[dict]:
        query = "SELECT * FROM agents WHERE agent_id > ?"
        args: list[object] = [after_id]
        if state:
            query += " AND state = ?"
            args.append(state)
        query += " ORDER BY agent_id LIMIT ?"
        args.append(limit)
        with self._connection() as db:
            rows = db.execute(query, args).fetchall()
        return [self._agent_row(row) for row in rows]

    def latest_event_at(self) -> str | None:
        with self._connection() as db:
            row = db.execute("SELECT MAX(updated_at) FROM agents").fetchone()
        return row[0] if row else None

    def list_events(self, *, since: str | None = None, limit: int = 100, after_sequence: int = 0) -> list[dict]:
        query = "SELECT sequence, event_id, event_type, occurred_at, received_at, source, payload_json FROM events WHERE sequence > ?"
        args: list[object] = [after_sequence]
        if since:
            query += " AND occurred_at >= ?"
            args.append(since)
        query += " ORDER BY sequence ASC LIMIT ?"
        args.append(limit)
        with self._connection() as db:
            rows = db.execute(query, args).fetchall()
        return [{"sequence": row["sequence"], "event_id": row["event_id"], "type": row["event_type"],
                 "occurred_at": row["occurred_at"], "received_at": row["received_at"],
                 "source": row["source"], "data": json.loads(row["payload_json"])} for row in rows]

    def append_event(self, event: dict, agent: dict) -> tuple[bool, dict]:
        """Insert an event and update its latest agent projection atomically."""
        received_at = utc_now()
        with self._connection() as db:
            db.execute("BEGIN IMMEDIATE")
            existing = db.execute("SELECT 1 FROM events WHERE event_id = ?", (event["event_id"],)).fetchone()
            if existing:
                row = db.execute(
                    "SELECT event_type, occurred_at, source, payload_json FROM events WHERE event_id = ?",
                    (event["event_id"],),
                ).fetchone()
                expected_payload = canonical_json(event["data"])
                if (row["event_type"], row["occurred_at"], row["source"], row["payload_json"]) != (
                    event["type"], event["occurred_at"], event["source"], expected_payload
                ):
                    raise EventConflict(event["event_id"])
                row = db.execute("SELECT * FROM agents WHERE agent_id = ?", (agent["id"],)).fetchone()
                return False, self._agent_row(row) if row else agent
            previous = db.execute("SELECT source FROM agents WHERE agent_id=?", (agent["id"],)).fetchone()
            if previous and previous["source"] != agent["source"]:
                raise EventConflict("legacy agent ID belongs to another source")
            db.execute(
                """INSERT INTO events
                   (event_id, event_type, occurred_at, received_at, source, payload_json)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (event["event_id"], event["type"], event["occurred_at"], received_at,
                 event["source"], canonical_json(event["data"])),
            )
            db.execute(
                """INSERT INTO agents
                   (agent_id, name, state, detail, area, source, updated_at, metadata_json)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                   ON CONFLICT(agent_id) DO UPDATE SET
                     name=excluded.name, state=excluded.state, detail=excluded.detail,
                     area=excluded.area, source=excluded.source,
                     updated_at=excluded.updated_at, metadata_json=excluded.metadata_json
                   WHERE agents.updated_at <= excluded.updated_at""",
                (agent["id"], agent["name"], agent["state"], agent["detail"], agent["area"],
                 agent["source"], agent["updated_at"],
                 canonical_json(agent["metadata"])),
            )
            row = db.execute("SELECT * FROM agents WHERE agent_id = ?", (agent["id"],)).fetchone()
        return True, self._agent_row(row)

    def append_observation(self, project, body, *, retention_days=7):
        from backend.team_telemetry import MAX_SUBJECTS
        payload = canonical_json(body)
        digest = hashlib.sha256(payload.encode()).hexdigest()
        cutoff = (datetime.now(timezone.utc) - timedelta(days=retention_days)).isoformat(timespec="microseconds").replace("+00:00", "Z")
        with self._connection() as db:
            db.execute("BEGIN IMMEDIATE")
            db.execute("DELETE FROM telemetry_events WHERE received_at < ?", (cutoff,))
            duplicate = db.execute("SELECT digest,applied FROM telemetry_events WHERE project=? AND event_id=?",
                                   (project, body["event_id"])).fetchone()
            if duplicate:
                if duplicate["digest"] != digest:
                    raise EventConflict()
                return False, bool(duplicate["applied"])
            old = db.execute("SELECT observed_at,payload FROM telemetry_subjects WHERE project=? AND subject_id=?",
                             (project, body["subject_id"])).fetchone()
            if old and old["observed_at"] == body["observed_at"]:
                content = json.loads(old["payload"])
                content["event_id"] = body["event_id"]
                if canonical_json(content) != payload:
                    raise EventConflict()
            if not old and db.execute("SELECT count(*) FROM telemetry_subjects WHERE project=?", (project,)).fetchone()[0] >= MAX_SUBJECTS:
                raise CapacityExceeded()
            applied = old is None or body["observed_at"] > old["observed_at"]
            if applied:
                db.execute("INSERT INTO telemetry_subjects VALUES(?,?,?,?) ON CONFLICT(project,subject_id) "
                           "DO UPDATE SET observed_at=excluded.observed_at,payload=excluded.payload",
                           (project, body["subject_id"], body["observed_at"], payload))
            db.execute("INSERT INTO telemetry_events VALUES(?,?,?,?,?)",
                       (project, body["event_id"], digest, utc_now(), int(applied)))
            return True, applied

    def observations(self, project):
        with self._connection() as db:
            rows = db.execute("SELECT payload FROM telemetry_subjects WHERE project=? ORDER BY subject_id", (project,)).fetchall()
        return [json.loads(row["payload"]) for row in rows]
