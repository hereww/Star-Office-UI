"""Small SQLite state/event store used by the standalone API service.

The store deliberately contains only integration state. It never stores API
keys, bearer tokens, passwords, or upstream provider responses.
"""
from __future__ import annotations

import json
import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


class EventConflict(Exception):
    """The same event ID was reused with a different payload."""


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
                """
            )

    def ping(self) -> None:
        with self._connection() as db:
            db.execute("SELECT 1").fetchone()

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

    def list_agents(self, *, state: str | None = None, limit: int = 100) -> list[dict]:
        query = "SELECT * FROM agents"
        args: list[object] = []
        if state:
            query += " WHERE state = ?"
            args.append(state)
        query += " ORDER BY agent_id LIMIT ?"
        args.append(limit)
        with self._connection() as db:
            rows = db.execute(query, args).fetchall()
        return [self._agent_row(row) for row in rows]

    def latest_event_at(self) -> str | None:
        with self._connection() as db:
            row = db.execute("SELECT occurred_at FROM events ORDER BY sequence DESC LIMIT 1").fetchone()
        return row[0] if row else None

    def list_events(self, *, since: str | None = None, limit: int = 100) -> list[dict]:
        query = "SELECT sequence, event_id, event_type, occurred_at, received_at, source, payload_json FROM events"
        args: list[object] = []
        if since:
            query += " WHERE occurred_at >= ?"
            args.append(since)
        query += " ORDER BY sequence DESC LIMIT ?"
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
            existing = db.execute("SELECT 1 FROM events WHERE event_id = ?", (event["event_id"],)).fetchone()
            if existing:
                row = db.execute(
                    "SELECT event_type, occurred_at, source, payload_json FROM events WHERE event_id = ?",
                    (event["event_id"],),
                ).fetchone()
                expected_payload = json.dumps(event["data"], ensure_ascii=False, separators=(",", ":"))
                if (row["event_type"], row["occurred_at"], row["source"], row["payload_json"]) != (
                    event["type"], event["occurred_at"], event["source"], expected_payload
                ):
                    raise EventConflict(event["event_id"])
                row = db.execute("SELECT * FROM agents WHERE agent_id = ?", (agent["id"],)).fetchone()
                return False, self._agent_row(row) if row else agent
            db.execute(
                """INSERT INTO events
                   (event_id, event_type, occurred_at, received_at, source, payload_json)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (event["event_id"], event["type"], event["occurred_at"], received_at,
                 event["source"], json.dumps(event["data"], ensure_ascii=False, separators=(",", ":"))),
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
                 json.dumps(agent["metadata"], ensure_ascii=False, separators=(",", ":"))),
            )
            row = db.execute("SELECT * FROM agents WHERE agent_id = ?", (agent["id"],)).fetchone()
        return True, self._agent_row(row)
