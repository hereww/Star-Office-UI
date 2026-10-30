"""Standalone, provider-neutral HTTP API for team integrations.

Run with ``python -m api_service.app``. The service has no Sub2API dependency;
clients push normalized agent events and read the resulting projection.
"""
from __future__ import annotations

import hashlib
import hmac
import math
import json
import os
import re
import secrets
import stat
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from flask import Flask, g, jsonify, request

from .store import EventConflict, StateStore, utc_now
from .telemetry import load_project_keys, register_telemetry

API_VERSION = "1"
SCHEMA_VERSION = 1
VALID_STATES = frozenset({"idle", "writing", "researching", "executing", "syncing", "error", "offline"})
VALID_EVENT_TYPES = frozenset({"agent.state_changed"})
ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
STATE_DETAIL_LIMIT = 256
MAX_METADATA_KEYS = 16
MAX_BODY_BYTES = 256 * 1024
MAX_CLOCK_SKEW_SECONDS = 300


def _parse_timestamp(value: Any) -> str:
    if not isinstance(value, str) or len(value) > 64:
        raise ValueError("invalid timestamp")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError("invalid timestamp") from exc
    if parsed.tzinfo is None:
        raise ValueError("timestamp must include timezone")
    return parsed.astimezone(timezone.utc).isoformat(timespec="microseconds").replace("+00:00", "Z")


def _text(value: Any, *, field: str, maximum: int, required: bool = True) -> str:
    if not isinstance(value, str) or len(value) > maximum or any(ord(char) < 32 for char in value):
        raise ValueError(f"invalid {field}")
    value = value.strip()
    if required and not value:
        raise ValueError(f"invalid {field}")
    return value


def _metadata(value: Any) -> dict[str, Any]:
    if value is None:
        return {}
    if not isinstance(value, dict) or len(value) > MAX_METADATA_KEYS:
        raise ValueError("invalid metadata")
    result: dict[str, Any] = {}
    for key, item in value.items():
        key = _text(key, field="metadata key", maximum=64)
        if re.search(r"(?:token|secret|password|credential|authorization|api[_-]?key|cookie|email|user[_-]?id)", key, re.I):
            raise ValueError("sensitive metadata key")
        if not isinstance(item, (str, int, float, bool)) and item is not None:
            raise ValueError("metadata values must be scalar")
        if isinstance(item, float) and not math.isfinite(item):
            raise ValueError("metadata must be finite")
        if isinstance(item, str):
            item = _text(item, field="metadata value", maximum=256, required=False)
        result[key] = item
    return result


def _validate_event(body: Any) -> tuple[dict, dict]:
    if not isinstance(body, dict) or set(body) - {"event_id", "type", "occurred_at", "source", "agent", "metadata"}:
        raise ValueError("invalid event")
    event_id = _text(body.get("event_id"), field="event_id", maximum=128)
    if not ID_PATTERN.fullmatch(event_id):
        raise ValueError("invalid event_id")
    event_type = _text(body.get("type"), field="type", maximum=64)
    if event_type not in VALID_EVENT_TYPES:
        raise ValueError("unsupported event type")
    occurred_at = _parse_timestamp(body.get("occurred_at"))
    occurred_dt = datetime.fromisoformat(occurred_at.replace("Z", "+00:00"))
    if occurred_dt.timestamp() > datetime.now(timezone.utc).timestamp() + MAX_CLOCK_SKEW_SECONDS:
        raise ValueError("occurred_at is too far in the future")
    source = _text(body.get("source", "unknown"), field="source", maximum=64)
    agent = body.get("agent")
    if not isinstance(agent, dict) or set(agent) - {"id", "name", "state", "detail", "area", "metadata"}:
        raise ValueError("invalid agent")
    agent_id = _text(agent.get("id"), field="agent id", maximum=128)
    if not ID_PATTERN.fullmatch(agent_id):
        raise ValueError("invalid agent id")
    name = _text(agent.get("name", agent_id), field="agent name", maximum=120)
    state = _text(agent.get("state"), field="agent state", maximum=32)
    if state not in VALID_STATES:
        raise ValueError("invalid agent state")
    detail = _text(agent.get("detail", ""), field="agent detail", maximum=STATE_DETAIL_LIMIT, required=False)
    area = _text(agent.get("area", ""), field="agent area", maximum=64, required=False)
    metadata = _metadata(agent.get("metadata"))
    event_metadata = _metadata(body.get("metadata"))
    normalized_agent = {"id": agent_id, "name": name, "state": state, "detail": detail,
                       "area": area, "source": source, "updated_at": occurred_at, "metadata": metadata}
    normalized_event = {"event_id": event_id, "type": event_type, "occurred_at": occurred_at,
                        "source": source, "data": {"agent": normalized_agent, "metadata": event_metadata}}
    return normalized_event, normalized_agent


def _load_api_key() -> str:
    configured = os.environ.get("API_SERVICE_KEY", "").strip()
    path = os.environ.get("API_KEY_FILE", "").strip()
    if configured and path:
        raise RuntimeError("configure API_SERVICE_KEY or API_KEY_FILE, not both")
    if path:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        with os.fdopen(fd, "r", encoding="utf-8") as stream:
            info = os.fstat(stream.fileno())
            if not stat.S_ISREG(info.st_mode) or stat.S_IMODE(info.st_mode) not in (0o400, 0o600):
                raise RuntimeError("API key file must be regular and mode 0400/0600")
            secret = stream.read(257).strip()
        if len(secret) > 256:
            raise RuntimeError("API key file too large")
    else:
        secret = configured
    if secret and len(secret) < 24:
        raise RuntimeError("API service key must be at least 24 characters")
    return secret


def _constant_key_match(candidate: str, expected: str) -> bool:
    return bool(candidate) and hmac.compare_digest(
        hashlib.sha256(candidate.encode()).digest(), hashlib.sha256(expected.encode()).digest()
    )


class APIError(Exception):
    def __init__(self, code: str, message: str, status: int):
        super().__init__(code)
        self.code, self.message, self.status = code, message, status


def create_app(*, store: StateStore | None = None, testing: bool = False) -> Flask:
    app = Flask(__name__)
    app.config["MAX_CONTENT_LENGTH"] = MAX_BODY_BYTES
    app.config.update(
        API_AUTH_MODE=os.environ.get("API_AUTH_MODE", "key").strip().lower(),
        API_ALLOWED_ORIGINS=os.environ.get("API_ALLOWED_ORIGINS", "").strip(),
        API_SNAPSHOT_STALE_SECONDS=int(os.environ.get("API_SNAPSHOT_STALE_SECONDS", "30")),
    )
    if app.config["API_AUTH_MODE"] not in {"none", "key"}:
        raise RuntimeError("API_AUTH_MODE must be none or key")
    if app.config["API_SNAPSHOT_STALE_SECONDS"] < 1:
        raise RuntimeError("API_SNAPSHOT_STALE_SECONDS must be positive")
    project_keys = load_project_keys()
    if app.config["API_AUTH_MODE"] == "key":
        app.config["API_SERVICE_KEY"] = _load_api_key()
        if not app.config["API_SERVICE_KEY"] and not project_keys:
            raise RuntimeError("key mode requires project credentials or a legacy service key")
    else:
        app.config["API_SERVICE_KEY"] = ""
    if testing:
        app.config["TESTING"] = True
    service_store = store or StateStore(os.environ.get("API_DATA_FILE", ".local/api-service/state.sqlite3"))

    @app.before_request
    def request_context() -> None:
        request_id = request.headers.get("X-Request-ID", "").strip()
        g.request_id = request_id if ID_PATTERN.fullmatch(request_id) else secrets.token_hex(12)
        if request.content_length is not None and request.content_length > MAX_BODY_BYTES:
            raise APIError("REQUEST_TOO_LARGE", "请求内容超出限制。", 413)

    @app.after_request
    def response_headers(response):
        response.headers["X-Request-ID"] = g.get("request_id", "")
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Cache-Control"] = "no-store"
        origin = request.headers.get("Origin")
        allowed = [value.strip() for value in app.config["API_ALLOWED_ORIGINS"].split(",") if value.strip()]
        if origin and origin in allowed:
            response.headers["Access-Control-Allow-Origin"] = origin
            response.headers["Access-Control-Allow-Headers"] = "Authorization, Content-Type, X-API-Key, X-Request-ID, Idempotency-Key"
            response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, OPTIONS"
            response.headers["Vary"] = "Origin"
        return response

    def require_auth() -> None:
        if app.config["API_AUTH_MODE"] == "none":
            return
        value = request.headers.get("Authorization", "")
        candidate = value[7:].strip() if value.lower().startswith("bearer ") else request.headers.get("X-API-Key", "").strip()
        if not _constant_key_match(candidate, app.config["API_SERVICE_KEY"]):
            raise APIError("UNAUTHENTICATED", "缺少有效的 API 凭据。", 401)

    def json_body() -> dict:
        if not request.is_json:
            raise APIError("INVALID_REQUEST", "请求必须使用 application/json。", 400)
        body = request.get_json(silent=True)
        if not isinstance(body, dict):
            raise APIError("INVALID_REQUEST", "请求 JSON 必须是对象。", 400)
        return body

    @app.route("/api/v1/<path:unused>", methods=["OPTIONS"])
    @app.route("/api/v1/health", methods=["OPTIONS"])
    def options(unused=None):
        return ("", 204)

    @app.get("/api/v1/health")
    def health():
        return jsonify({"status": "ok", "service": "star-office-api", "api_version": API_VERSION,
                        "schema_version": SCHEMA_VERSION, "generated_at": utc_now()})

    @app.get("/api/v1/openapi.json")
    def openapi():
        return jsonify(json.loads(Path(__file__).with_name("openapi.json").read_text(encoding="utf-8")))

    @app.get("/api/v1/readiness")
    def readiness():
        try:
            service_store.ping()
            storage = "ok"
        except Exception:
            storage = "error"
        auth = "ok" if app.config["API_AUTH_MODE"] == "none" or app.config["API_SERVICE_KEY"] or project_keys else "error"
        ready = storage == "ok" and auth == "ok"
        return jsonify({"ready": ready, "checks": {"storage": storage, "authentication": auth},
                        "generated_at": utc_now()}), (200 if ready else 503)

    @app.get("/api/v1/config")
    def config():
        require_auth()
        return jsonify({"api_version": API_VERSION, "schema_version": SCHEMA_VERSION,
                        "auth_mode": app.config["API_AUTH_MODE"], "provider": "standalone",
                        "snapshot_stale_seconds": app.config["API_SNAPSHOT_STALE_SECONDS"],
                        "capabilities": ["agents.read", "events.write", "events.read", "snapshot.read", "projects.telemetry.write", "projects.snapshot.read"]})

    @app.get("/api/v1/agents")
    def agents():
        require_auth()
        state = request.args.get("state")
        if state and state not in VALID_STATES:
            raise APIError("INVALID_REQUEST", "state 参数无效。", 400)
        try:
            limit = int(request.args.get("limit", "100"))
        except ValueError as exc:
            raise APIError("INVALID_REQUEST", "limit 参数无效。", 400) from exc
        if not 1 <= limit <= 200:
            raise APIError("INVALID_REQUEST", "limit 必须在 1 到 200 之间。", 400)
        rows = service_store.list_agents(state=state, limit=limit+1, after_id=request.args.get("after_id", ""))
        return jsonify({"schema_version": SCHEMA_VERSION, "agents": rows[:limit],
                        "next_cursor": rows[limit-1]["id"] if len(rows)>limit else None})

    @app.get("/api/v1/agents/<agent_id>")
    def agent(agent_id):
        require_auth()
        if not ID_PATTERN.fullmatch(agent_id):
            raise APIError("INVALID_REQUEST", "agent_id 格式无效。", 400)
        result = service_store.get_agent(agent_id)
        if result is None:
            raise APIError("NOT_FOUND", "代理不存在。", 404)
        return jsonify(result)

    @app.get("/api/v1/events")
    def events():
        require_auth()
        since = request.args.get("since")
        if since:
            try:
                since = _parse_timestamp(since)
            except ValueError as exc:
                raise APIError("INVALID_REQUEST", "since 参数无效。", 400) from exc
        try:
            limit = int(request.args.get("limit", "100"))
        except ValueError as exc:
            raise APIError("INVALID_REQUEST", "limit 参数无效。", 400) from exc
        if not 1 <= limit <= 200:
            raise APIError("INVALID_REQUEST", "limit 必须在 1 到 200 之间。", 400)
        try:
            after = int(request.args.get("after_sequence", "0"))
            if after < 0: raise ValueError()
        except ValueError:
            raise APIError("INVALID_REQUEST", "after_sequence 参数无效。", 400)
        rows = service_store.list_events(since=since, limit=limit+1, after_sequence=after)
        return jsonify({"schema_version": SCHEMA_VERSION, "events": rows[:limit],
                        "next_cursor": rows[limit-1]["sequence"] if len(rows)>limit else None})

    @app.post("/api/v1/events")
    def create_event():
        require_auth()
        try:
            event, agent = _validate_event(json_body())
        except ValueError as exc:
            raise APIError("INVALID_REQUEST", "事件格式无效。", 400) from exc
        try:
            created, projection = service_store.append_event(event, agent)
        except EventConflict as exc:
            raise APIError("CONFLICT", "event_id 已用于另一条事件。", 409) from exc
        return jsonify({"accepted": True, "created": created, "event_id": event["event_id"],
                        "agent": projection}), (201 if created else 200)

    @app.put("/api/v1/agents/<agent_id>")
    def replace_agent(agent_id):
        require_auth()
        body = json_body()
        if (set(body) - {"id", "name", "state", "detail", "area", "metadata", "event_id", "occurred_at", "source", "event_metadata"}
                or "occurred_at" not in body):
            raise APIError("INVALID_REQUEST", "需明确 occurred_at，且不能包含未知字段。", 400)
        if body.get("id", agent_id) != agent_id:
            raise APIError("INVALID_REQUEST", "路径 agent_id 与 body.id 不一致。", 400)
        body["id"] = agent_id
        if body.get("event_id") and request.headers.get("Idempotency-Key") not in (None, body["event_id"]):
            raise APIError("INVALID_REQUEST", "幂等键与 event_id 不一致。", 400)
        event_body = {"event_id": body.get("event_id") or request.headers.get("Idempotency-Key"),
                      "type": "agent.state_changed", "occurred_at": body.get("occurred_at", utc_now()),
                      "source": body.get("source", "api-client"), "agent": {key: body[key] for key in
                      ("id", "name", "state", "detail", "area", "metadata") if key in body},
                      "metadata": body.get("event_metadata", {})}
        if not event_body["event_id"]:
            raise APIError("INVALID_REQUEST", "写入代理状态需要 event_id 或 Idempotency-Key。", 400)
        try:
            event, agent_data = _validate_event(event_body)
        except ValueError as exc:
            raise APIError("INVALID_REQUEST", "代理状态格式无效。", 400) from exc
        try:
            created, projection = service_store.append_event(event, agent_data)
        except EventConflict as exc:
            raise APIError("CONFLICT", "event_id 已用于另一条事件。", 409) from exc
        return jsonify({"accepted": True, "created": created, "event_id": event["event_id"],
                        "agent": projection}), (201 if created else 200)

    @app.get("/api/v1/snapshot")
    def snapshot():
        require_auth()
        latest = service_store.latest_event_at()
        rows = service_store.list_agents(limit=201, after_id=request.args.get("after_id", ""))
        agents_data = rows[:200]
        for row in agents_data:
            age = (datetime.now(timezone.utc) - datetime.fromisoformat(row["updated_at"].replace("Z", "+00:00"))).total_seconds()
            row["freshness"] = "fresh" if 0 <= age <= app.config["API_SNAPSHOT_STALE_SECONDS"] else "stale"
        freshness = "empty"
        if latest:
            try:
                age = (datetime.now(timezone.utc) - datetime.fromisoformat(latest.replace("Z", "+00:00"))).total_seconds()
                freshness = "fresh" if 0 <= age <= app.config["API_SNAPSHOT_STALE_SECONDS"] else "stale"
            except ValueError:
                freshness = "unknown"
        return jsonify({"schema_version": SCHEMA_VERSION, "generated_at": utc_now(),
                        "source": {"provider": "standalone", "status": "ok", "freshness": freshness,
                                   "last_event_at": latest}, "agents": agents_data,
                        "complete": len(rows) <= 200,
                        "next_cursor": agents_data[-1]["id"] if len(rows)>200 else None})

    @app.errorhandler(APIError)
    def api_error(error):
        return jsonify({"error": {"code": error.code, "message": error.message,
                                   "request_id": g.get("request_id")}}), error.status

    @app.errorhandler(404)
    def not_found(_error):
        return jsonify({"error": {"code": "NOT_FOUND", "message": "接口不存在。",
                                   "request_id": g.get("request_id")}}), 404

    @app.errorhandler(405)
    def method_not_allowed(_error):
        return jsonify({"error": {"code": "METHOD_NOT_ALLOWED", "message": "请求方法不受支持。",
                                   "request_id": g.get("request_id")}}), 405

    @app.errorhandler(413)
    def request_too_large(_error):
        return jsonify({"error": {"code": "REQUEST_TOO_LARGE", "message": "请求内容超出限制。",
                                   "request_id": g.get("request_id")}}), 413

    @app.errorhandler(Exception)
    def unexpected(error):
        app.logger.error("api_service_internal_error type=%s request_id=%s", type(error).__name__, g.get("request_id", ""))
        return jsonify({"error": {"code": "INTERNAL_ERROR", "message": "服务内部错误。",
                                   "request_id": g.get("request_id")}}), 500

    register_telemetry(app, service_store, project_keys, APIError)
    return app


if __name__ == "__main__":
    create_app().run(host=os.environ.get("API_BIND", "127.0.0.1"),
            port=int(os.environ.get("API_PORT", "19100")), debug=False)
