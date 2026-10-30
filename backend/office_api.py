"""Office production API Blueprint, exclusively /api/office.

Integration (after Flask app exists):
    from office_api import register_office_api
    register_office_api(app)

The factory never imports backend/app.py, starts a collector, serves frontend
files, creates secrets or overrides the legacy Flask session settings. All
private endpoints require the independently signed server-side office session.
Tests may inject a temp OfficeStore/snapshot_path/clock without upstream access.
"""
from __future__ import annotations

import os
import time
from pathlib import Path
import sqlite3

from flask import Blueprint, current_app, jsonify, request

try:
    from .office_characters import CHARACTER_TEMPLATE_ID, CHARACTER_ANIMATION_MODE, CHARACTER_MANIFEST_CONTRACT_VERSION, public_character_profiles, public_room_character_catalog
    from .office_collector import read_snapshot
    from .office_contract import ContractError, public_snapshot, source_projection
    from .office_security import ADMIN_TTL, COOKIE_NAME, OfficeSecurity, admin_http_allowed
    from .office_settings import office_data_dir, office_enabled, office_user_ids
    from .office_store import MissingVersion, OfficeStore, SessionConflict, VersionConflict
except ImportError:
    from office_characters import CHARACTER_TEMPLATE_ID, CHARACTER_ANIMATION_MODE, CHARACTER_MANIFEST_CONTRACT_VERSION, public_character_profiles, public_room_character_catalog
    from office_collector import read_snapshot
    from office_contract import ContractError, public_snapshot, source_projection
    from office_security import ADMIN_TTL, COOKIE_NAME, OfficeSecurity, admin_http_allowed
    from office_settings import office_data_dir, office_enabled, office_user_ids
    from office_store import MissingVersion, OfficeStore, SessionConflict, VersionConflict

SAFE_MESSAGES = {
    "UNAUTHENTICATED": "请先登录管理员账户。", "CSRF_FAILED": "请求来源或安全令牌无效，请刷新后重试。",
    "VALIDATION_ERROR": "配置或请求格式无效。", "VERSION_CONFLICT": "配置已被更新，请重新读取后再保存。",
    "USER_NOT_AUTHORIZED": "该用户不在当前有效授权范围内。", "VERSION_NOT_FOUND": "配置版本不存在。",
    "LOGIN_FAILED": "用户名或密码错误。", "RATE_LIMITED": "登录尝试过多，请稍后重试。",
    "ADMIN_NOT_CONFIGURED": "管理员安全配置未就绪。", "HTTPS_REQUIRED": "管理员入口要求 HTTPS。",
    "METHOD_NOT_ALLOWED": "请求方法不受支持。", "NOT_FOUND": "接口不存在。",
    "STORAGE_UNAVAILABLE": "配置存储暂不可用。", "REQUEST_TOO_LARGE": "请求内容超出限制。",
}


def _safe_error(code, status):
    response = jsonify({"error": {"code": code, "message": SAFE_MESSAGES[code]}})
    response.status_code = status
    response.headers["Cache-Control"] = "no-store, max-age=0"
    response.headers["X-Content-Type-Options"] = "nosniff"
    if status == 429:
        response.headers["Retry-After"] = "60"
    return response


def legacy_request_guard():
    """None | Flask Response for host app's protected legacy routes.

    The host chooses its public GET allowlist and calls this guard for everything
    else, but NEVER for the public office snapshot or office login/session routes.
    OFF: no changes to legacy behavior. ON: secure independent admin session for
    reads, plus CSRF/same-origin for mutations. It cannot grant a legacy drawer
    login or silently accept the old Flask session flag.
    """
    if not office_enabled(current_app):
        return None
    ext = current_app.extensions.get("office_api")
    if not ext or not ext["security"].enabled:
        return _safe_error("ADMIN_NOT_CONFIGURED", 503)
    if not request.is_secure and not admin_http_allowed():
        return _safe_error("HTTPS_REQUIRED", 400)
    security = ext["security"]
    try:
        token, record = security.lookup(request.cookies.get(COOKIE_NAME))
    except sqlite3.Error:
        return _safe_error("STORAGE_UNAVAILABLE", 503)
    if not record or not record["authenticated"]:
        return _safe_error("UNAUTHENTICATED", 401)
    if request.method in {"POST", "PUT", "DELETE", "PATCH"}:
        if (not security.csrf_valid(token, request.headers.get("X-CSRF-Token"))
                or not security.same_origin(request)):
            return _safe_error("CSRF_FAILED", 403)
    return None


def register_office_api(app, *, store=None, snapshot_path=None, clock=time.time):
    """Register once. Env configuration, file paths and collector are server-owned.

    OFFICE_DATA_DIR > STAR_OFFICE_DATA_DIR/office-prod > repo/office-prod.
    Set OFFICE_ADMIN_USERNAME (default admin), OFFICE_ADMIN_PASSWORD_HASH and
    OFFICE_ADMIN_SECRET separately from the old drawer password/Flask secret.
    Reverse proxy must preserve HTTPS scheme via a separately reviewed ProxyFix.
    Never trust X-Forwarded-* here, nor accept credential or source URL via API.
    """
    if not office_enabled(app):
        return None
    if "office_api" in app.extensions:
        return app.extensions["office_api"]["blueprint"]
    data_dir = office_data_dir()
    configured_scope = office_user_ids(app)
    store = store or OfficeStore(data_dir / "office-config.sqlite3", clock=clock, allowed_user_ids=configured_scope)
    snapshot_path = Path(snapshot_path) if snapshot_path is not None else data_dir / "office-snapshot.json"
    settings = lambda name, default=None: app.config.get(name, os.environ.get(name, default))
    security = OfficeSecurity(store, settings("OFFICE_ADMIN_USERNAME", "admin"),
                              settings("OFFICE_ADMIN_PASSWORD_HASH", ""), settings("OFFICE_ADMIN_SECRET", ""))
    bp = Blueprint("office_api", __name__, url_prefix="/api/office")

    def error(code, status):
        return _safe_error(code, status)

    def telemetry():
        config = store.read_config()
        snap = read_snapshot(snapshot_path)
        # Server profile shrinking must also suppress a still-fresh pre-restart
        # cached user's identity. Persisted aliases/bindings are not migrated.
        scope = set(configured_scope)
        snap["users"] = [u for u in snap["users"] if u["user_id"] in scope]
        snap["source"]["authorized_user_ids"] = [uid for uid in snap["source"]["authorized_user_ids"] if uid in scope]
        if snap["connection"]["error_code"] == "not_configured":
            snap["source"]["authorized_user_ids"] = list(configured_scope)
        source, fresh = source_projection(config, snap, clock())
        return config, snap, source, fresh

    def authorized_users():
        _, snap, _, fresh = telemetry()
        return {u["user_id"] for u in snap["users"]} if fresh else set()

    @bp.before_request
    def guard():
        if request.content_length is not None and request.content_length > 65536:
            return error("REQUEST_TOO_LARGE", 413)
        if request.path.startswith("/api/office/admin"):
            if not request.is_secure and not admin_http_allowed():
                return error("HTTPS_REQUIRED", 400)
            if not security.enabled:
                return error("ADMIN_NOT_CONFIGURED", 503)
            token, record = security.lookup(request.cookies.get(COOKIE_NAME))
            if request.path != "/api/office/admin/session" and (not record or not record["authenticated"]):
                return error("UNAUTHENTICATED", 401)
            if request.method in {"POST", "PUT", "DELETE", "PATCH"}:
                if (not record or not security.csrf_valid(token, request.headers.get("X-CSRF-Token"))
                        or not security.same_origin(request)):
                    return error("CSRF_FAILED", 403)

    @bp.after_request
    def headers(response):
        response.headers["Cache-Control"] = "no-store, max-age=0"
        response.headers["Pragma"] = "no-cache"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.vary.add("Cookie")
        response.headers["X-Office-Schema-Version"] = "1"
        # No CORS is enabled. Clear accidental upstream/legacy headers on this namespace.
        for header in ("Access-Control-Allow-Origin", "Access-Control-Allow-Credentials"):
            response.headers.pop(header, None)
        return response

    def json_body():
        if not request.is_json:
            raise ContractError("invalid_json")
        value = request.get_json(silent=True)
        if not isinstance(value, dict):
            raise ContractError("invalid_json")
        return value

    @bp.get("/snapshot")
    def snapshot():
        config, snap, _, _ = telemetry()
        return jsonify(public_snapshot(config, snap, clock()))

    @bp.get("/character-profiles")
    def character_profiles():
        # Safe catalog metadata only. Assignment is still validated by the
        # authenticated config endpoint; this endpoint never accepts writes.
        return jsonify({"schema_version": 2, "template_id": CHARACTER_TEMPLATE_ID, "animation_mode": CHARACTER_ANIMATION_MODE,
                        "manifest_contract_version": CHARACTER_MANIFEST_CONTRACT_VERSION,
                        "selection_scope": "global_and_binding", "profiles": public_character_profiles()})

    @bp.get("/room-character-catalog")
    def room_character_catalog():
        # Read-only server-owned metadata for the admin control surface. Asset
        # paths remain fixed by the V5 release; the browser cannot register new ones.
        return jsonify(public_room_character_catalog())

    @bp.route("/admin/session", methods=["GET", "POST", "DELETE"])
    def session_endpoint():
        token, record = security.lookup(request.cookies.get(COOKIE_NAME))
        if request.method == "GET":
            if record and record["authenticated"]:
                # Active admin pages call this endpoint periodically. Extend the
                # fixed idle window in the shared store without rotating the
                # token, so CSRF state and concurrent requests remain stable.
                record = store.refresh_session(security.digest(token), ADMIN_TTL)
                if record is None:
                    token = security.new_session()
            elif record is None:
                token = security.new_session()
            authenticated = bool(record and record["authenticated"])
        elif request.method == "POST":
            # remote_addr is trusted only through reviewed deployment proxy configuration.
            if not store.claim_login_attempt(request.remote_addr or "unknown"):
                return error("RATE_LIMITED", 429)
            value = json_body()
            if set(value) != {"username", "password"}:
                raise ContractError("invalid_login")
            if not security.verify_password(value["username"], value["password"]):
                return error("LOGIN_FAILED", 401)
            token = security.new_session(True, old_token=token)
            authenticated = True
        else:
            token = security.new_session(False, old_token=token)
            authenticated = False
        response = jsonify({"authenticated": authenticated, "csrf_token": security.csrf(token),
                            "username": security.username if authenticated else None})
        return security.set_cookie(response, token, authenticated)

    @bp.get("/admin/users")
    def users():
        config, snap, source, fresh = telemetry()
        private_source = {**source, "installation_id": int(snap["source"]["installation_id"]),
                          "allowed_user_ids": snap["source"]["authorized_user_ids"],
                          "credential_expires_at": snap["source"]["credential_expires_at"]}
        # Expired/failed/restarted snapshots never expose old identity/key/token data.
        return jsonify({"schema_version": 1, "config_version": config["version"], "source": private_source,
                        "window": snap["window"] if fresh else None, "users": snap["users"] if fresh else []})

    @bp.route("/admin/config", methods=["GET", "PUT"])
    def config_endpoint():
        if request.method == "GET":
            return jsonify({"config": store.read_config(), "history": store.history()["versions"]})
        value = json_body()
        if set(value) != {"expected_version", "config"}:
            raise ContractError("invalid_save")
        saved = store.save_config(value["expected_version"], value["config"], allowed_new_user_ids=authorized_users())
        return jsonify({"config": saved})

    @bp.post("/admin/config/restore")
    def restore():
        value = json_body()
        if set(value) != {"expected_version", "target_version"}:
            raise ContractError("invalid_restore")
        saved = store.restore_config(value["expected_version"], value["target_version"], allowed_new_user_ids=authorized_users())
        return jsonify({"config": saved})

    @bp.get("/admin/config/history")
    def history():
        return jsonify(store.history())

    @bp.get("/admin/diagnostics")
    def diagnostics():
        _, snap, source, _ = telemetry()
        return jsonify({"source": {**source, "installation_id": int(snap["source"]["installation_id"]),
                                    "allowed_user_ids": snap["source"]["authorized_user_ids"],
                                    "credential_expires_at": snap["source"]["credential_expires_at"]}})

    @bp.errorhandler(ContractError)
    def invalid(exc):
        return error("USER_NOT_AUTHORIZED", 403) if str(exc) == "user_not_authorized" else error("VALIDATION_ERROR", 400)

    @bp.errorhandler(VersionConflict)
    def conflict(_):
        return error("VERSION_CONFLICT", 409)

    @bp.errorhandler(SessionConflict)
    def session_conflict(_):
        return error("UNAUTHENTICATED", 401)

    @bp.errorhandler(MissingVersion)
    def missing(_):
        return error("VERSION_NOT_FOUND", 404)

    # SQLite errors must not expose local file paths, SQL or unhandled exception text.
    @bp.errorhandler(sqlite3.Error)
    def storage_failure(_):
        return error("STORAGE_UNAVAILABLE", 503)

    from werkzeug.exceptions import RequestEntityTooLarge
    @bp.errorhandler(RequestEntityTooLarge)
    def request_too_large(_):
        return error("REQUEST_TOO_LARGE", 413)

    @bp.route("/<path:unknown>", methods=["GET", "POST", "PUT", "DELETE", "PATCH"])
    def unknown_endpoint(unknown):
        return error("NOT_FOUND", 404)

    app.register_blueprint(bp)
    app.extensions["office_api"] = {"blueprint": bp, "store": store, "snapshot_path": snapshot_path,
                                     "security": security}
    return bp
