"""Office-only SQLite config revisions, immutable history and security state.

One connection per operation; BEGIN IMMEDIATE serializes cross-process writers.
No plugin credentials, passwords or telemetry are stored in this database.
"""
from __future__ import annotations

import contextlib
import json
import os
import sqlite3
import time
from pathlib import Path

try:
    from .office_contract import DEFAULT_APPEARANCE, DEFAULT_BINDINGS, DEFAULT_DISPLAY, DEFAULT_ROOM_CHARACTERS_CONFIG, ContractError, canonical_id, safe_appearance, safe_room_characters, utc_iso, validate_config
    from .office_settings import office_user_ids
except ImportError:
    from office_contract import DEFAULT_APPEARANCE, DEFAULT_BINDINGS, DEFAULT_DISPLAY, DEFAULT_ROOM_CHARACTERS_CONFIG, ContractError, canonical_id, safe_appearance, safe_room_characters, utc_iso, validate_config
    from office_settings import office_user_ids


class VersionConflict(Exception):
    pass


class MissingVersion(Exception):
    pass


class SessionConflict(Exception):
    """The session being rotated was revoked/expired/rotated by another worker."""
    pass


class OfficeStore:
    def __init__(self, path, clock=time.time, *, allowed_user_ids=None):
        # Validate before touching the filesystem. This only seeds a NEW head;
        # existing configs/history are never altered when the profile changes.
        scope = office_user_ids() if allowed_user_ids is None else allowed_user_ids
        if not isinstance(scope, (list, tuple, set, frozenset)) or not 1 <= len(scope) <= 500:
            raise ContractError("invalid_user_scope")
        normalized_scope = tuple(canonical_id(uid) for uid in scope)
        if len(set(normalized_scope)) != len(normalized_scope):
            raise ContractError("invalid_user_scope")
        scope = set(normalized_scope)
        self.path = Path(path)
        self.clock = clock
        self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        # Create a private file without relaxing permissions on pre-existing files.
        try:
            fd = os.open(self.path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        except FileExistsError:
            pass
        else:
            os.close(fd)
        with self._db() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS config_versions (
                  version INTEGER PRIMARY KEY AUTOINCREMENT, payload TEXT NOT NULL,
                  created_at TEXT NOT NULL, actor TEXT NOT NULL,
                  action TEXT NOT NULL, restored_from INTEGER);
                CREATE TABLE IF NOT EXISTS config_head (
                  singleton INTEGER PRIMARY KEY CHECK(singleton=1), version INTEGER NOT NULL);
                CREATE TABLE IF NOT EXISTS audit (
                  id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL,
                  actor TEXT NOT NULL, action TEXT NOT NULL, version INTEGER NOT NULL,
                  restored_from INTEGER);
                CREATE TABLE IF NOT EXISTS admin_sessions (
                  digest TEXT PRIMARY KEY, authenticated INTEGER NOT NULL,
                  expires_at REAL NOT NULL);
                CREATE TABLE IF NOT EXISTS login_attempts (
                  id INTEGER PRIMARY KEY AUTOINCREMENT, peer TEXT NOT NULL, attempted_at REAL NOT NULL);
                CREATE INDEX IF NOT EXISTS login_time ON login_attempts(attempted_at);
                CREATE INDEX IF NOT EXISTS login_peer_time ON login_attempts(peer,attempted_at);
            """)
            db.execute("BEGIN IMMEDIATE")
            if not db.execute("SELECT version FROM config_head WHERE singleton=1").fetchone():
                value = validate_config({"bindings": [b for b in DEFAULT_BINDINGS if b["user_id"] in scope], "display": DEFAULT_DISPLAY,
                                         "collection": {"poll_interval_seconds": 5},
                                         "room_characters": DEFAULT_ROOM_CHARACTERS_CONFIG})
                v = self._insert(db, value, "system", "initialize", None)
                db.execute("INSERT INTO config_head VALUES(1,?)", (v,))
            db.commit()

    @contextlib.contextmanager
    def _db(self):
        db = sqlite3.connect(str(self.path), timeout=10, isolation_level=None)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA busy_timeout=10000")
        db.execute("PRAGMA foreign_keys=ON")
        # DELETE journal has predictable private file cleanup and needs no WAL sidecar permissions.
        try:
            yield db
        finally:
            db.close()

    def _insert(self, db, value, actor, action, restored_from):
        stamp = utc_iso(self.clock())
        cursor = db.execute("INSERT INTO config_versions(payload,created_at,actor,action,restored_from) VALUES(?,?,?,?,?)",
                            (json.dumps(value, ensure_ascii=False, separators=(",", ":")), stamp, actor, action, restored_from))
        version = cursor.lastrowid
        db.execute("INSERT INTO audit(created_at,actor,action,version,restored_from) VALUES(?,?,?,?,?)",
                   (stamp, actor, action, version, restored_from))
        return version

    @staticmethod
    def _read(db):
        row = db.execute("SELECT v.version,v.payload,v.created_at FROM config_head h JOIN config_versions v ON v.version=h.version WHERE h.singleton=1").fetchone()
        value = json.loads(row["payload"])
        # Backward-compatible read of pre-profile SQLite revisions. Do not rewrite
        # history just because the new UI has a default appearance field.
        if "appearance" not in value:
            value["appearance"] = dict(DEFAULT_APPEARANCE)
        else:
            # Older/manual SQLite revisions may contain a known but unassignable
            # profile. Read them fail-closed without rewriting immutable history.
            value["appearance"] = safe_appearance(value["appearance"])
        value["room_characters"] = safe_room_characters(value.get("room_characters", DEFAULT_ROOM_CHARACTERS_CONFIG))
        return {"schema_version": 1, "version": row["version"], "updated_at": row["created_at"], **value}

    @staticmethod
    def _expected(version):
        if type(version) is not int or version < 1:
            raise ContractError("invalid_version")

    def read_config(self):
        with self._db() as db:
            return self._read(db)

    def save_config(self, expected_version, value, actor="admin", allowed_new_user_ids=None):
        self._expected(expected_version)
        value = validate_config(value)
        with self._db() as db:
            db.execute("BEGIN IMMEDIATE")
            try:
                current = self._read(db)
                if current["version"] != expected_version:
                    raise VersionConflict()
                # Known bindings can survive an outage; new/reassigned users require current authorization.
                if allowed_new_user_ids is not None:
                    old = {(b["seat_id"], b["user_id"]) for b in current["bindings"]}
                    if any((b["seat_id"], b["user_id"]) not in old and b["user_id"] not in allowed_new_user_ids for b in value["bindings"]):
                        raise ContractError("user_not_authorized")
                version = self._insert(db, value, actor, "save", None)
                cursor = db.execute("UPDATE config_head SET version=? WHERE singleton=1 AND version=?", (version, expected_version))
                if cursor.rowcount != 1:
                    raise VersionConflict()
                result = self._read(db)  # readback inside the serialized transaction
                db.commit()
                return result
            except Exception:
                db.rollback()
                raise

    def restore_config(self, expected_version, target_version, actor="admin", allowed_new_user_ids=None):
        self._expected(expected_version)
        self._expected(target_version)
        with self._db() as db:
            db.execute("BEGIN IMMEDIATE")
            try:
                current = self._read(db)
                if current["version"] != expected_version:
                    raise VersionConflict()
                row = db.execute("SELECT payload FROM config_versions WHERE version=?", (target_version,)).fetchone()
                if row is None:
                    raise MissingVersion()
                value = validate_config(json.loads(row["payload"]))
                if allowed_new_user_ids is not None:
                    if any(b["user_id"] not in allowed_new_user_ids for b in value["bindings"]):
                        raise ContractError("user_not_authorized")
                version = self._insert(db, value, actor, "restore", target_version)
                db.execute("UPDATE config_head SET version=? WHERE singleton=1 AND version=?", (version, expected_version))
                result = self._read(db)
                db.commit()
                return result
            except Exception:
                db.rollback()
                raise

    def history(self, limit=100):
        with self._db() as db:
            versions = [dict(r) for r in db.execute("SELECT version,created_at,actor,action,restored_from FROM config_versions ORDER BY version DESC LIMIT ?", (limit,))]
            audit = [dict(r) for r in db.execute("SELECT * FROM audit ORDER BY id DESC LIMIT ?", (limit,))]
            return {"versions": versions, "audit": audit}

    def create_session(self, digest, authenticated, ttl, replace_digest=None):
        with self._db() as db:
            db.execute("BEGIN IMMEDIATE")
            try:
                # Check AFTER acquiring the write lock, not before password hashing
                # or a potentially long wait for another Gunicorn worker.
                now = self.clock()
                db.execute("DELETE FROM admin_sessions WHERE expires_at<=?", (now,))
                if replace_digest:
                    deleted = db.execute("DELETE FROM admin_sessions WHERE digest=? AND expires_at>?",
                                         (replace_digest, now))
                    if deleted.rowcount != 1:
                        raise SessionConflict()
                db.execute("INSERT INTO admin_sessions VALUES(?,?,?)", (digest, int(authenticated), now + ttl))
                db.commit()
            except Exception:
                db.rollback()
                raise

    def session(self, digest):
        with self._db() as db:
            row = db.execute("SELECT authenticated,expires_at FROM admin_sessions WHERE digest=? AND expires_at>?", (digest, self.clock())).fetchone()
            return dict(row) if row else None

    def refresh_session(self, digest, ttl):
        """Slide an authenticated session window without rotating its token.

        The update is conditional on the current, unexpired row so a concurrent
        logout or expiry cannot be undone by a stale browser heartbeat.
        """
        with self._db() as db:
            db.execute("BEGIN IMMEDIATE")
            try:
                now = self.clock()
                db.execute("DELETE FROM admin_sessions WHERE expires_at<=?", (now,))
                cursor = db.execute(
                    "UPDATE admin_sessions SET expires_at=? "
                    "WHERE digest=? AND authenticated=1 AND expires_at>?",
                    (now + ttl, digest, now),
                )
                if cursor.rowcount != 1:
                    db.commit()
                    return None
                row = db.execute(
                    "SELECT authenticated,expires_at FROM admin_sessions WHERE digest=?",
                    (digest,),
                ).fetchone()
                db.commit()
                return dict(row) if row else None
            except Exception:
                db.rollback()
                raise

    def delete_session(self, digest):
        with self._db() as db:
            db.execute("DELETE FROM admin_sessions WHERE digest=?", (digest,))

    def claim_login_attempt(self, peer, per_peer=5, global_limit=100, window=60):
        """Shared limiter across Gunicorn workers; count successes too, before hashing."""
        now = self.clock()
        with self._db() as db:
            db.execute("BEGIN IMMEDIATE")
            db.execute("DELETE FROM login_attempts WHERE attempted_at<=?", (now - window,))
            total = db.execute("SELECT COUNT(*) FROM login_attempts").fetchone()[0]
            count = db.execute("SELECT COUNT(*) FROM login_attempts WHERE peer=?", (peer,)).fetchone()[0]
            allowed = total < global_limit and count < per_peer
            if allowed:
                db.execute("INSERT INTO login_attempts(peer,attempted_at) VALUES(?,?)", (peer, now))
            db.commit()
            return allowed
