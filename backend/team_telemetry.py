"""Provider-neutral observation contract. Stdlib only; no Sub2API dependency."""
from __future__ import annotations

import copy
import json
import os
import re
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
MAX_SUBJECTS = 500
MAX_SAFE_INTEGER = 2**53 - 1
GROUPS = ("identity", "concurrency", "today_usage", "active_models")
STATES = {"ready", "degraded", "offline", "unknown"}


def identifier(value):
    if not isinstance(value, str) or not ID.fullmatch(value):
        raise ValueError("invalid identifier")
    return value


def text(value, maximum=200, empty=False):
    if (not isinstance(value, str) or len(value) > maximum or (not empty and not value.strip())
            or any(ord(c) < 32 or 127 <= ord(c) <= 159 or 0x202A <= ord(c) <= 0x202E
                   or 0x2066 <= ord(c) <= 0x2069 for c in value)):
        raise ValueError("invalid text")
    return value


def timestamp(value):
    if not isinstance(value, str) or len(value) > 64:
        raise ValueError("invalid timestamp")
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("timezone required")
    return parsed.astimezone(timezone.utc).isoformat(timespec="microseconds").replace("+00:00", "Z")


def seconds(value):
    return datetime.fromisoformat(timestamp(value).replace("Z", "+00:00")).timestamp()


def keys(value, required):
    if not isinstance(value, dict) or set(value) != set(required):
        raise ValueError("invalid fields")


def decimal(value, maximum=80, positive=False):
    if not isinstance(value, str) or len(value) > maximum or not re.fullmatch(r"0|[1-9][0-9]*", value):
        raise ValueError("decimal string required")
    if positive and (value == "0" or int(value) > 2**63 - 1):
        raise ValueError("invalid request count")
    return value


def normalize_observation(body, now=None):
    """Full subject observation. Omitted groups cannot accidentally retain old values."""
    now = datetime.now(timezone.utc).timestamp() if now is None else now
    keys(body, ("schema_version", "event_id", "subject_id", "observed_at", "service_state", *GROUPS))
    if type(body["schema_version"]) is not int or body["schema_version"] != 1:
        raise ValueError("invalid schema")
    result = copy.deepcopy(body)
    for field in ("event_id", "subject_id"):
        result[field] = identifier(body[field])
    result["observed_at"] = timestamp(body["observed_at"])
    observed = seconds(result["observed_at"])
    if observed > now + 5:
        raise ValueError("future observation")
    if body["service_state"] not in STATES:
        raise ValueError("invalid service state")
    fields = {"identity": ("name",), "concurrency": ("current", "limit"),
              "today_usage": ("total", "date", "timezone", "window_end"), "active_models": ("models",)}
    for group in GROUPS:
        value = result[group]
        keys(value, ("quality", "observed_at", *fields[group]))
        allowed = {"fresh", "unavailable", "untracked"} | ({"partial"} if group == "active_models" else set())
        if value["quality"] not in allowed:
            raise ValueError("invalid quality")
        usable = value["quality"] in {"fresh", "partial"}
        if usable:
            value["observed_at"] = timestamp(value["observed_at"])
            if seconds(value["observed_at"]) > observed:
                raise ValueError("metric newer than observation")
        elif value["observed_at"] is not None:
            raise ValueError("unknown metric timestamp must be null")
        if not usable:
            for field in fields[group]:
                expected = [] if field == "models" else None
                if value[field] != expected:
                    raise ValueError("unknown metric value must be null or empty")
            continue
        if group == "identity":
            value["name"] = text(value["name"], 120, empty=True)
        elif group == "concurrency":
            if (type(value["current"]) is not int or not 0 <= value["current"] <= MAX_SAFE_INTEGER
                    or type(value["limit"]) is not int or not 1 <= value["limit"] <= MAX_SAFE_INTEGER):
                raise ValueError("invalid concurrency")
        elif group == "today_usage":
            decimal(value["total"])
            date = datetime.strptime(value["date"], "%Y-%m-%d").date().isoformat()
            if date != value["date"] or value["timezone"] != "Asia/Shanghai":
                raise ValueError("invalid usage window")
            value["window_end"] = timestamp(value["window_end"])
            end = seconds(value["window_end"])
            if (datetime.fromtimestamp(end, ZoneInfo("Asia/Shanghai")).date().isoformat() != date
                    or end > seconds(value["observed_at"])):
                raise ValueError("invalid usage window end")
        else:
            if not isinstance(value["models"], list) or len(value["models"]) > 32:
                raise ValueError("invalid model list")
            seen = set()
            for model in value["models"]:
                keys(model, ("requested_model", "upstream_model", "requests"))
                text(model["requested_model"])
                if model["requested_model"].strip() != model["requested_model"]:
                    raise ValueError("invalid model name")
                if model["upstream_model"] is not None:
                    text(model["upstream_model"])
                    if model["upstream_model"].strip() != model["upstream_model"]:
                        raise ValueError("invalid model name")
                decimal(model["requests"], 19, positive=True)
                pair = (model["requested_model"], model["upstream_model"])
                if pair in seen:
                    raise ValueError("duplicate model")
                seen.add(pair)
    if len(json.dumps(result, ensure_ascii=False).encode()) > 16 * 1024:
        raise ValueError("observation exceeds 16 KiB")
    return result


def qualities(observation, now, stale_seconds):
    """Service heartbeat never refreshes the individual metric clocks."""
    result = {}
    alive = 0 <= now - seconds(observation["observed_at"]) < stale_seconds
    for group in GROUPS:
        value = observation[group]
        quality = value["quality"]
        if not alive:
            quality = "stale"
        elif quality in {"fresh", "partial"} and not 0 <= now - seconds(value["observed_at"]) < stale_seconds:
            quality = "stale"
        if group == "today_usage" and quality == "fresh":
            today = datetime.fromtimestamp(now, ZoneInfo("Asia/Shanghai")).date().isoformat()
            if value["date"] != today or not 0 <= now - seconds(value["window_end"]) < stale_seconds:
                quality = "stale"
        if observation["service_state"] == "offline" and group != "identity":
            quality = "unavailable"
        result[group] = quality
    result["heartbeat"] = "fresh" if alive else "stale"
    return result


def load_subject_mappings(path=None):
    from pathlib import Path
    path = path or os.environ.get("OFFICE_SUBJECTS_FILE", "")
    if not path:
        raise ValueError("OFFICE_SUBJECTS_FILE is required")
    raw = Path(path).read_bytes()
    if len(raw) > 256 * 1024:
        raise ValueError("mapping too large")
    rows = json.loads(raw)
    if not isinstance(rows, list) or not 1 <= len(rows) <= MAX_SUBJECTS:
        raise ValueError("invalid mappings")
    ids, subjects = set(), set()
    for row in rows:
        keys(row, ("office_user_id", "project_id", "subject_id"))
        uid = row["office_user_id"]
        if not isinstance(uid, str) or not re.fullmatch(r"[1-9][0-9]{0,18}", uid) or int(uid)>2**63-1:
            raise ValueError("invalid Office ID")
        pair = (identifier(row["project_id"]), identifier(row["subject_id"]))
        if uid in ids or pair in subjects:
            raise ValueError("duplicate mapping")
        ids.add(uid); subjects.add(pair)
    return rows
