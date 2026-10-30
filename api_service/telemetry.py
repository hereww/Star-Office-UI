"""Project-scoped telemetry HTTP routes and credential checks."""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import stat
from datetime import datetime, timezone
from pathlib import Path

from flask import jsonify, request
from backend.team_telemetry import identifier, normalize_observation, qualities
from .store import EventConflict, CapacityExceeded, utc_now


def restricted_json(path):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, "rb") as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode) or stat.S_IMODE(info.st_mode) not in (0o400, 0o600):
            raise RuntimeError("project key file must be regular and mode 0400/0600")
        data = stream.read(128 * 1024 + 1)
    if len(data) > 128 * 1024:
        raise RuntimeError("project key file too large")
    return json.loads(data)


def load_project_keys():
    path = os.environ.get("API_PROJECT_KEYS_FILE", "")
    if not path:
        return []
    rows = restricted_json(path)
    if not isinstance(rows, list) or not 1 <= len(rows) <= 100:
        raise RuntimeError("invalid project key configuration")
    result, seen = [], set()
    for row in rows:
        if not isinstance(row, dict) or set(row) != {"project_id", "key", "permissions"}:
            raise RuntimeError("invalid project key configuration")
        project = identifier(row["project_id"])
        key = row["key"]
        permissions = row["permissions"]
        if (not isinstance(key, str) or not 32 <= len(key) <= 256 or any(c.isspace() for c in key)
                or not isinstance(permissions, list) or not permissions
                or any(p not in {"telemetry:write", "telemetry:read"} for p in permissions)):
            raise RuntimeError("invalid project key configuration")
        digest = hashlib.sha256(key.encode()).digest()
        if digest in seen:
            raise RuntimeError("each project credential must be unique")
        seen.add(digest)
        result.append((project, digest, frozenset(permissions)))
    return result


def register_telemetry(app, store, project_keys, error):
    stale_seconds = int(os.environ.get("API_TELEMETRY_STALE_SECONDS", "15"))
    retention_days = int(os.environ.get("API_TELEMETRY_RETENTION_DAYS", "7"))
    if not 5 <= stale_seconds <= 300 or not 1 <= retention_days <= 365:
        raise RuntimeError("invalid telemetry timing configuration")

    def authorize(project, permission):
        try:
            identifier(project)
        except ValueError:
            raise error("INVALID_REQUEST", "project_id 格式无效。", 400)
        if app.config["API_AUTH_MODE"] == "none":
            return
        auth = request.headers.get("Authorization", "")
        candidate = auth[7:].strip() if auth.lower().startswith("bearer ") else ""
        digest = hashlib.sha256(candidate.encode()).digest()
        matched = next((row for row in project_keys if hmac.compare_digest(row[1], digest)), None)
        if not candidate or matched is None:
            raise error("UNAUTHENTICATED", "缺少有效的项目凭据。", 401)
        if matched[0] != project or permission not in matched[2]:
            raise error("FORBIDDEN", "凭据不允许访问此项目或操作。", 403)

    @app.post("/api/v1/projects/<project>/telemetry")
    def publish(project):
        authorize(project, "telemetry:write")
        try:
            if not request.is_json:
                raise ValueError()
            body = normalize_observation(request.get_json(silent=True))
            header = request.headers.get("Idempotency-Key")
            if header is not None and header != body["event_id"]:
                raise ValueError()
        except (ValueError, TypeError, OverflowError):
            raise error("INVALID_REQUEST", "遥测字段、时间或数据类型无效。", 400)
        try:
            created, applied = store.append_observation(project, body, retention_days=retention_days)
        except EventConflict:
            raise error("CONFLICT", "事件 ID 或同一观测时间已用于不同数据。", 409)
        except CapacityExceeded:
            raise error("CAPACITY_EXCEEDED", "项目主体数量已达 500 上限。", 409)
        return jsonify({"accepted": True, "created": created, "applied": applied,
                        "project_id": project, "subject_id": body["subject_id"],
                        "event_id": body["event_id"], "observed_at": body["observed_at"]}), (201 if created else 200)

    @app.get("/api/v1/projects/<project>/snapshot")
    def read(project):
        authorize(project, "telemetry:read")
        now = datetime.now(timezone.utc).timestamp()
        rows = store.observations(project)
        return jsonify({"schema_version": 1, "project_id": project, "generated_at": utc_now(),
                        "stale_after_seconds": stale_seconds, "complete": True,
                        "subjects": [{**row, "freshness": qualities(row, now, stale_seconds)} for row in rows]})
