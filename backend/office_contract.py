"""Shared office v1 contracts. No model tasks or legacy business-state inference.

Public snapshot is built by an allowlist, never by deleting private user fields.
All IDs and recorded token totals are canonical decimal strings (or null).
"""
from __future__ import annotations

import copy
import re
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

try:
    from .office_characters import (
        DEFAULT_CHARACTER_PROFILE_ID,
        character_profile,
        is_assignable_character_profile,
        is_known_character_profile,
        public_character_profile,
        DEFAULT_ROOM_CHARACTERS,
        normalize_room_characters,
        safe_room_characters,
    )
except ImportError:
    from office_characters import (
        DEFAULT_CHARACTER_PROFILE_ID,
        character_profile,
        is_assignable_character_profile,
        is_known_character_profile,
        public_character_profile,
        DEFAULT_ROOM_CHARACTERS,
        normalize_room_characters,
        safe_room_characters,
    )

SCHEMA_VERSION = 1
DESK_IDS = tuple(f"desk-{n:02d}" for n in range(1, 17))
BUSINESS_STATES = frozenset({"idle", "writing", "researching", "executing", "syncing", "error"})
DEFAULT_DISPLAY = {"default_view": "overview", "show_bubbles": True,
                   "show_labels": True, "details_collapsed": False, "reduced_motion": "system"}
DEFAULT_USER_IDS = ("1", "4", "7", "8")
DEFAULT_APPEARANCE = {"character_profile_id": DEFAULT_CHARACTER_PROFILE_ID, "allow_fallback": False}
DEFAULT_ROOM_CHARACTERS_CONFIG = safe_room_characters(DEFAULT_ROOM_CHARACTERS)


def safe_appearance(value):
    """Return a runtime-safe appearance without trusting persisted legacy data."""
    if not isinstance(value, dict) or set(value) != set(DEFAULT_APPEARANCE):
        return dict(DEFAULT_APPEARANCE)
    profile_id = value.get("character_profile_id")
    if not is_assignable_character_profile(profile_id) or value.get("allow_fallback") is not False:
        return dict(DEFAULT_APPEARANCE)
    return {"character_profile_id": profile_id, "allow_fallback": False}
DEFAULT_BINDINGS = [
    {"seat_id": "desk-09", "enabled": True, "user_id": "4", "display_name": "工位 09"},
    {"seat_id": "desk-10", "enabled": True, "user_id": "7", "display_name": "工位 10"},
    {"seat_id": "desk-11", "enabled": True, "user_id": "8", "display_name": "工位 11"},
    {"seat_id": "desk-12", "enabled": True, "user_id": "1", "display_name": "主工位"},
]
QUALITY_VALUES = frozenset({"fresh", "unavailable", "untracked"})
RACK_STATES = frozenset({"working", "idle", "fault", "offline", "unknown"})
INT64_MAX = 2**63 - 1


class ContractError(ValueError):
    """Only a fixed error code may cross an HTTP/log boundary."""


def utc_iso(now: float) -> str:
    return datetime.fromtimestamp(now, timezone.utc).isoformat().replace("+00:00", "Z")


def timestamp(value):
    if not isinstance(value, str) or len(value) > 64:
        return None
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return dt.timestamp() if dt.tzinfo is not None else None
    except (ValueError, OverflowError):
        return None


def canonical_id(value) -> str:
    if not isinstance(value, str) or not re.fullmatch(r"[1-9][0-9]{0,18}", value) or int(value) > INT64_MAX:
        raise ContractError("invalid_id")
    return value


def _text(value, maximum=256):
    if not isinstance(value, str) or len(value) > maximum or any(ord(c) < 32 for c in value):
        raise ContractError("invalid_text")
    return value


def validate_config(value):
    allowed_keys = {"bindings", "display", "collection", "appearance", "room_characters"}
    if not isinstance(value, dict) or not set(value).issubset(allowed_keys) or not {"bindings", "display", "collection"}.issubset(value):
        raise ContractError("invalid_config")
    bindings = value["bindings"]
    if not isinstance(bindings, list) or len(bindings) > len(DESK_IDS):
        raise ContractError("invalid_bindings")
    desks, normalized = set(), []
    for binding in bindings:
        required_binding_keys = {"seat_id", "user_id", "display_name", "enabled"}
        if (not isinstance(binding, dict) or not required_binding_keys.issubset(binding)
                or set(binding) - required_binding_keys - {"character_profile_id"}):
            raise ContractError("invalid_binding")
        desk = binding["seat_id"]
        if not isinstance(desk, str) or desk not in DESK_IDS or desk in desks:
            raise ContractError("duplicate_or_invalid_desk")
        user = canonical_id(binding["user_id"])
        name = _text(binding["display_name"], 1024).strip()
        if not name:
            raise ContractError("empty_display_name")
        if len(name) > 40:
            raise ContractError("invalid_display_name")
        desks.add(desk)
        if type(binding["enabled"]) is not bool:
            raise ContractError("invalid_enabled")
        normalized_binding = {"seat_id": desk, "user_id": user, "display_name": name, "enabled": binding["enabled"]}
        if "character_profile_id" in binding:
            profile_id = binding["character_profile_id"]
            if not is_assignable_character_profile(profile_id):
                raise ContractError("invalid_binding_character_profile")
            normalized_binding["character_profile_id"] = profile_id
        normalized.append(normalized_binding)
    display = value["display"]
    if not isinstance(display, dict) or set(display) != set(DEFAULT_DISPLAY):
        raise ContractError("invalid_display")
    if not isinstance(display["default_view"], str) or display["default_view"] not in {"overview", "west", "east", "workstation"}:
        raise ContractError("invalid_view")
    if any(type(display[k]) is not bool for k in display if k not in {"default_view", "reduced_motion"}):
        raise ContractError("invalid_display_boolean")
    if display["reduced_motion"] not in ("system", "on", "off"):
        raise ContractError("invalid_reduced_motion")
    collection = value["collection"]
    if (not isinstance(collection, dict) or set(collection) != {"poll_interval_seconds"}
            or type(collection["poll_interval_seconds"]) is not int or collection["poll_interval_seconds"] not in (5, 10, 30)):
        raise ContractError("invalid_collection")
    appearance = value.get("appearance", DEFAULT_APPEARANCE)
    if not isinstance(appearance, dict) or set(appearance) != set(DEFAULT_APPEARANCE):
        raise ContractError("invalid_appearance")
    profile_id = appearance.get("character_profile_id")
    if not is_known_character_profile(profile_id) or not is_assignable_character_profile(profile_id):
        raise ContractError("invalid_character_profile")
    if type(appearance.get("allow_fallback")) is not bool or appearance["allow_fallback"] is not False:
        # Fallback is intentionally reserved until runtime preload/rollback is implemented.
        raise ContractError("invalid_appearance")
    normalized_appearance = {"character_profile_id": profile_id, "allow_fallback": False}
    raw_room_characters = value.get("room_characters", DEFAULT_ROOM_CHARACTERS_CONFIG)
    room_characters = normalize_room_characters(raw_room_characters)
    if room_characters is None:
        raise ContractError("invalid_room_characters")
    return {"bindings": sorted(normalized, key=lambda b: b["seat_id"]),
            "display": copy.deepcopy(display), "collection": dict(collection),
            "appearance": normalized_appearance, "room_characters": room_characters}


def validate_window(value):
    if not isinstance(value, dict) or set(value) != {"start", "end", "timezone"}:
        raise ContractError("invalid_window")
    start, end = timestamp(value["start"]), timestamp(value["end"])
    if start is None or end is None or not 0 <= end - start <= 31 * 86400:
        raise ContractError("invalid_window")
    # The collector explicitly pins Asia/Shanghai for every page.
    if value["timezone"] != "Asia/Shanghai":
        raise ContractError("invalid_timezone")
    return dict(value)



def normalize_active_models(value):
    """Optional live-model extension; a bad extension cannot poison other metrics."""
    empty = {"models": [], "quality": "unavailable", "observed_at": None}
    if not isinstance(value, dict) or value.get("quality") not in {"fresh", "partial"}:
        return empty
    if timestamp(value.get("observed_at")) is None:
        return empty
    entries = value.get("models")
    if not isinstance(entries, list) or len(entries) > 10000:
        return empty
    models = []
    for entry in entries:
        if not isinstance(entry, dict):
            return empty
        requested, upstream, requests = entry.get("requested_model"), entry.get("upstream_model"), entry.get("requests")
        def valid_name(name):
            return (isinstance(name, str) and 0 < len(name) <= 200 and name.strip() == name
                    and not any(ord(c) < 32 or 127 <= ord(c) <= 159 or c in "\u202a\u202b\u202c\u202d\u202e\u2066\u2067\u2068\u2069" for c in name))
        if (not valid_name(requested) or (upstream is not None and not valid_name(upstream))
                or type(requests) is not int or not 1 <= requests <= INT64_MAX):
            return empty
        models.append({"requested_model": requested, "upstream_model": upstream, "requests": requests})
    return {"models": models, "quality": value["quality"], "observed_at": value["observed_at"]}


def public_active_models(user, now, stale_seconds, *, bound=False, source_status="error"):
    empty = {"models": [], "quality": "unavailable" if bound else "unbound", "observed_at": None}
    if not bound:
        return empty
    if source_status != "ok":
        return {**empty, "quality": "stale" if source_status == "stale" else "unavailable"}
    normalized = normalize_active_models(user.get("active_models") if isinstance(user, dict) else None)
    if normalized["quality"] == "unavailable":
        return empty
    observed = timestamp(normalized["observed_at"])
    if not 0 <= now - observed < stale_seconds:
        return {**empty, "quality": "stale"}
    return {"models": [{"requested_model": row["requested_model"], "upstream_model": row["upstream_model"],
                        "requests": str(row["requests"])} for row in normalized["models"]],
            "quality": normalized["quality"], "observed_at": normalized["observed_at"]}


def validate_telemetry_page(page, allowed_user_ids):
    """Normalize an upstream response by whitelist; reject partial identity/key lists.

    Do not stringify numeric IDs/totals: precision may already have been lost upstream.
    Unknown token/concurrency observations must be null, not invented timestamps.
    """
    if not isinstance(page, dict) or type(page.get("schema_version")) is not int or page["schema_version"] != 1:
        raise ContractError("invalid_schema")
    window = validate_window(page.get("window"))
    if not isinstance(page.get("users"), list) or len(page["users"]) > 500:
        raise ContractError("invalid_users")
    users, seen = [], set()
    for raw in page["users"]:
        if not isinstance(raw, dict):
            raise ContractError("invalid_user")
        uid = canonical_id(raw.get("user_id"))
        if uid not in allowed_user_ids or uid in seen:
            raise ContractError("unexpected_user_scope")
        seen.add(uid)
        quality, observed = raw.get("quality"), raw.get("observed_at")
        fields = ("identity", "api_keys", "token_usage", "concurrency")
        if not isinstance(quality, dict) or not isinstance(observed, dict):
            raise ContractError("invalid_quality")
        if any(quality.get(f) not in QUALITY_VALUES for f in fields):
            raise ContractError("invalid_quality")
        if quality["identity"] != "fresh" or quality["api_keys"] != "fresh":
            raise ContractError("incomplete_identity")
        for field in fields:
            if quality[field] == "fresh":
                if timestamp(observed.get(field)) is None:
                    raise ContractError("invalid_observation")
            elif observed.get(field) is not None:
                raise ContractError("invalid_unknown_observation")
        keys = raw.get("api_keys")
        if not isinstance(keys, list) or len(keys) > 10000:
            raise ContractError("invalid_api_keys")
        normalized_keys, key_ids = [], set()
        for key in keys:
            if not isinstance(key, dict):
                raise ContractError("invalid_key")
            kid = canonical_id(key.get("id"))
            if kid in key_ids:
                raise ContractError("duplicate_key")
            key_ids.add(kid)
            normalized_keys.append({"id": kid, "name": _text(key.get("name"), 1024),
                                    "status": _text(key.get("status"), 64)})
        usage, concurrency = raw.get("token_usage"), raw.get("concurrency")
        if not isinstance(usage, dict) or not isinstance(concurrency, dict):
            raise ContractError("invalid_metrics")
        total = usage.get("total")
        if quality["token_usage"] == "fresh":
            if not isinstance(total, str) or not re.fullmatch(r"0|[1-9][0-9]*", total):
                raise ContractError("invalid_token_total")
        elif total is not None:
            raise ContractError("invalid_unknown_total")
        current, limit = concurrency.get("current"), concurrency.get("limit")
        if type(limit) is not int or not -INT64_MAX <= limit <= INT64_MAX:
            raise ContractError("invalid_concurrency_limit")
        if quality["concurrency"] == "fresh":
            if type(current) is not int or not 0 <= current <= INT64_MAX or limit <= 0:
                raise ContractError("invalid_concurrency")
        elif current is not None:
            raise ContractError("invalid_unknown_concurrency")
        users.append({"user_id": uid, "email": _text(raw.get("email"), 320),
                      "username": _text(raw.get("username"), 256), "api_keys": normalized_keys,
                      "token_usage": {"total": total}, "concurrency": {"current": current, "limit": limit},
                      "active_models": normalize_active_models(raw.get("active_models")),
                      "quality": {f: quality[f] for f in fields},
                      "observed_at": {f: observed.get(f) for f in fields}})
    cursor = page.get("next_cursor")
    if cursor is not None:
        canonical_id(cursor)
    return {"schema_version": 1, "window": window, "users": users, "next_cursor": cursor}


def snapshot_is_fresh(snapshot, now, stale_seconds=15):
    if not isinstance(snapshot, dict) or snapshot.get("connection", {}).get("status") != "ok":
        return False
    sampled = timestamp(snapshot.get("sampled_at"))
    return sampled is not None and 0 <= now - sampled < stale_seconds


def source_projection(config, snapshot, now):
    interval = config["collection"]["poll_interval_seconds"]
    stale_seconds = interval * 3
    # The previous producer's interval is an additional cap after config changes.
    observed_interval = snapshot.get("source", {}).get("interval_seconds", interval)
    stale_seconds = min(stale_seconds, observed_interval * 3)
    fresh = snapshot_is_fresh(snapshot, now, stale_seconds)
    raw_status = snapshot.get("connection", {}).get("status")
    code = snapshot.get("connection", {}).get("error_code")
    expiry = timestamp(snapshot.get("source", {}).get("credential_expires_at"))
    if expiry is not None and now >= expiry:
        fresh, code = False, "credential_expired"
        status = "error"
    else:
        status = "ok" if fresh else "stale" if raw_status == "ok" else "connecting" if code == "not_configured" else "error"
    raw_plugin = snapshot.get("source", {}).get("plugin_status")
    plugin = {"status": "unknown", "healthy": None, "ready": None, "configured": None}
    if isinstance(raw_plugin, dict):
        if raw_plugin.get("status") in {"healthy", "unhealthy", "unknown"}:
            plugin["status"] = raw_plugin["status"]
        for key in ("healthy", "ready", "configured"):
            if type(raw_plugin.get(key)) is bool:
                plugin[key] = raw_plugin[key]
    rack_state = snapshot.get("source", {}).get("rack_state")
    if rack_state not in RACK_STATES:
        if status == "stale":
            rack_state = "unknown"
        elif plugin["status"] == "unhealthy":
            rack_state = "offline" if plugin["ready"] is False and plugin["configured"] is False else "fault"
        elif status in {"connecting", "error"}:
            rack_state = (
                "offline" if code in {"not_configured", "credential_expired", "unauthorized", "forbidden", "upstream_unavailable", "configuration_unavailable"}
                else "fault" if status == "error" else "unknown"
            )
        else:
            busy = any(isinstance(user, dict) and user.get("quality", {}).get("concurrency") == "fresh"
                       and isinstance(user.get("concurrency", {}).get("current"), int)
                       and user["concurrency"]["current"] > 0 for user in (snapshot.get("users", []) if fresh else []))
            rack_state = "working" if busy else "idle"
    return {"status": status, "last_success_at": snapshot.get("last_success_at"),
            "last_attempt_at": snapshot.get("attempted_at"), "poll_interval_seconds": interval,
            "stale_after_seconds": interval * 3, "error_code": None if status == "connecting" else code,
            "rack_state": rack_state, "plugin_status": plugin}, fresh


def public_today_usage(user, window, now, stale_seconds, *, bound=True):
    """Only the approved per-user daily aggregate, never keys or usage records.

    A fresh collector can still hold yesterday's window after a midnight page
    fetch. Recheck the window and the independent token clock on every read.
    """
    zone = ZoneInfo("Asia/Shanghai")
    today = datetime.fromtimestamp(now, zone)
    result = {"total": None, "date": today.date().isoformat(), "timezone": "Asia/Shanghai",
              "quality": "unavailable" if bound else "unbound", "observed_at": None,
              "window_end": None}
    if not bound or not user or not isinstance(window, dict):
        return result
    start, end = timestamp(window.get("start")), timestamp(window.get("end"))
    midnight = today.replace(hour=0, minute=0, second=0, microsecond=0).timestamp()
    if (window.get("timezone") != "Asia/Shanghai" or start != midnight
            or end is None or not midnight <= end <= now or now - end >= stale_seconds):
        result["quality"] = "stale"
        return result
    quality = user.get("quality", {}).get("token_usage")
    observed_at = user.get("observed_at", {}).get("token_usage")
    observed = timestamp(observed_at)
    total = user.get("token_usage", {}).get("total")
    observation_fresh = observed is not None and 0 <= now - observed < stale_seconds
    if quality == "fresh" and not observation_fresh:
        result["quality"] = "stale"
    elif (quality == "fresh" and observation_fresh and isinstance(total, str)
          and re.fullmatch(r"0|[1-9][0-9]*", total)):
        result.update(total=total, quality="fresh", observed_at=observed_at, window_end=window["end"])
    return result


def public_snapshot(config, snapshot, now):
    """The sole anonymous projection. Never pass through arbitrary upstream fields."""
    source, fresh = source_projection(config, snapshot, now)
    stale_seconds = min(source["stale_after_seconds"], snapshot.get("source", {}).get("interval_seconds", 5) * 3)
    users = {u["user_id"]: u for u in snapshot.get("users", [])} if fresh else {}
    bindings = {b["seat_id"]: b for b in config["bindings"] if b["enabled"]}
    appearance = safe_appearance(config.get("appearance", DEFAULT_APPEARANCE))
    room_characters = safe_room_characters(config.get("room_characters", DEFAULT_ROOM_CHARACTERS_CONFIG))
    selected_profile_id = appearance["character_profile_id"]
    if not is_known_character_profile(selected_profile_id):
        selected_profile_id = DEFAULT_CHARACTER_PROFILE_ID
    selected_profile = public_character_profile(selected_profile_id)
    stations, counts = [], {"bound": len(bindings), "busy": 0, "idle": 0, "unknown": 0}
    for seat_id in DESK_IDS:
        binding = bindings.get(seat_id)
        # A missing override follows the global default, including old revisions.
        # Recheck the server allowlist before publishing persisted visual metadata.
        profile_id = binding.get("character_profile_id") if binding else None
        station_profile = public_character_profile(profile_id) if is_assignable_character_profile(profile_id) else selected_profile
        activity, state, current, limit, observed_at = "unbound", None, None, None, None
        quality, age, reason = "unavailable", None, "unbound"
        username, identity_quality, identity_observed_at = None, "unbound", None
        user = None
        if binding:
            activity, reason = "unknown", "not_collected"
            identity_quality = "stale" if source["status"] == "stale" else "unavailable"
            user = users.get(binding["user_id"])
            if user:
                # Username is the sole approved public identity. It is independent
                # of the alias and concurrency, and must have its own fresh clock.
                name = user.get("username")
                identity_observation = user.get("observed_at", {}).get("identity")
                identity_time = timestamp(identity_observation)
                name_is_safe = (isinstance(name, str) and len(name) <= 256
                                and not any(ord(c) < 32 or 127 <= ord(c) <= 159 for c in name))
                if user.get("quality", {}).get("identity") == "fresh" and name_is_safe:
                    if identity_time is not None and 0 <= now - identity_time < stale_seconds:
                        username, identity_quality, identity_observed_at = name, "fresh", identity_observation
                    elif identity_time is not None:
                        identity_quality = "stale"
                quality = user["quality"]["concurrency"]
                observed = timestamp(user["observed_at"]["concurrency"])
                age = max(0, now - observed) if observed is not None else None
                observation_fresh = observed is not None and 0 <= now - observed < stale_seconds
                if quality == "fresh" and observation_fresh:
                    current, limit = user["concurrency"]["current"], user["concurrency"]["limit"]
                    activity = "busy" if current > 0 else "idle"
                    state = "writing" if current > 0 else "idle"
                    observed_at, reason = user["observed_at"]["concurrency"], None
                else:
                    reason = "untracked" if quality == "untracked" else "stale" if quality == "fresh" else "unavailable"
                    quality = "stale" if quality == "fresh" else quality
            elif source["status"] == "stale":
                quality, reason = "stale", "stale"
            elif source["status"] == "error":
                reason = "source_error"
            counts[activity] += 1
        stations.append({"seat_id": seat_id, "bound": bool(binding),
                         "display_name": binding["display_name"] if binding else f"工位 {seat_id[-2:]}",
                         "username": username, "identity_quality": identity_quality,
                         "identity_observed_at": identity_observed_at, "activity": activity, "animation_state": state,
                         "concurrency": {"current": current, "limit": limit}, "quality": quality,
                         "observed_at": observed_at, "data_age_seconds": age, "reason": reason,
                         "character_profile_id": station_profile["id"],
                         "character_label": station_profile["label"],
                         "character_status": station_profile["status"],
                         "today_usage": public_today_usage(user, snapshot.get("window"), now, stale_seconds, bound=bool(binding)),
                         "active_models": public_active_models(user, now, stale_seconds, bound=bool(binding), source_status=source["status"])})
    return {"schema_version": 1, "config_version": config["version"], "generated_at": utc_iso(now),
            "source": source, "display": copy.deepcopy(config["display"]),
            "appearance": {"character_profile_id": selected_profile["id"],
                           "allow_fallback": False},
            "room_characters": room_characters,
            "summary": counts, "stations": stations}
