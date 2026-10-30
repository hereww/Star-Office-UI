"""Dedicated team API collector. No Sub2API installation, token or network calls."""
from __future__ import annotations

import copy
import json
import os
import stat
from datetime import datetime
from functools import partial
from zoneinfo import ZoneInfo

try:
    from .office_collector import OfficeCollector, CollectorFailure, http_get, normalize_plugin_status
    from .office_contract import utc_iso
    from .team_telemetry import normalize_observation, qualities, identifier
except ImportError:
    from office_collector import OfficeCollector, CollectorFailure, http_get, normalize_plugin_status
    from office_contract import utc_iso
    from team_telemetry import normalize_observation, qualities, identifier

MAX_BYTES = 16 * 1024 * 1024


def read_keys(path):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, "rb") as handle:
        info = os.fstat(handle.fileno())
        if not stat.S_ISREG(info.st_mode) or stat.S_IMODE(info.st_mode) not in (0o400, 0o600):
            raise CollectorFailure("invalid_credential_file")
        raw = handle.read(128 * 1024 + 1)
    if len(raw)>128*1024:
        raise CollectorFailure("invalid_credential_file")
    rows = json.loads(raw)
    if not isinstance(rows, list) or not 1 <= len(rows) <= 100:
        raise CollectorFailure("invalid_credential_file")
    keys = {}
    for row in rows:
        if not isinstance(row, dict) or set(row) != {"project_id", "key"}:
            raise CollectorFailure("invalid_credential_file")
        project = identifier(row["project_id"])
        value = row["key"]
        if project in keys or not isinstance(value, str) or not 32<=len(value)<=256 or any(c.isspace() for c in value):
            raise CollectorFailure("invalid_credential_file")
        keys[project] = value
    return keys


class TeamCollector(OfficeCollector):
    def __init__(self, data_dir, base_url, keys_file, mappings, *, transport=None, **kwargs):
        self.mappings = copy.deepcopy(mappings)
        super().__init__(data_dir, base_url, keys_file,
                         user_ids=[row["office_user_id"] for row in mappings],
                         transport=transport or partial(http_get, max_bytes=MAX_BYTES), **kwargs)
        self.source["provider"] = "standalone"
        self.source["installation_id"] = None
        self.source["max_age_seconds"] = 15

    def _collect(self):
        credentials = read_keys(self.credential_file)
        by_project = {}
        for row in self.mappings:
            by_project.setdefault(row["project_id"], {})[row["subject_id"]] = row["office_user_id"]
        users, ttl, rack_states = [], 300, []
        deadline = self.monotonic() + 10
        now = self.clock()
        local = datetime.fromtimestamp(now, ZoneInfo("Asia/Shanghai"))
        window = {"start": local.replace(hour=0,minute=0,second=0,microsecond=0).isoformat(),
                  "end": local.isoformat(), "timezone": "Asia/Shanghai"}
        for project, wanted in by_project.items():
            if project not in credentials:
                raise CollectorFailure("invalid_credential_file")
            remaining = deadline-self.monotonic()
            if remaining <= 0: raise CollectorFailure("collection_timeout")
            code, raw = self.transport(self.base_url+"/api/v1/projects/"+project+"/snapshot",
                                      {"Authorization":"Bearer "+credentials[project], "Accept":"application/json"},
                                      min(4,remaining))
            if code != 200:
                raise CollectorFailure({401:"unauthorized",403:"forbidden",429:"rate_limited",503:"upstream_unavailable"}.get(code,"upstream_http_error"), code)
            if not isinstance(raw,bytes) or len(raw)>MAX_BYTES:
                raise CollectorFailure("invalid_response")
            try:
                page = json.loads(raw)
                age = page["stale_after_seconds"]
                if (type(page["schema_version"]) is not int or page["schema_version"] != 1
                        or page["project_id"] != project or page["complete"] is not True
                        or type(age) is not int or not 5<=age<=300
                        or not isinstance(page["subjects"],list) or len(page["subjects"])>500):
                    raise ValueError()
                ttl = min(ttl, age)
                seen = set()
                for entry in page["subjects"]:
                    observation = normalize_observation({k:v for k,v in entry.items() if k!="freshness"}, now=now)
                    sid = observation["subject_id"]
                    if sid in seen: raise ValueError()
                    seen.add(sid)
                    if sid not in wanted: continue
                    q = qualities(observation, now, min(age,self.interval_seconds*3))
                    user, rack = self._user(wanted[sid], observation, q)
                    users.append(user); rack_states.append(rack)
            except (ValueError,TypeError,KeyError,OverflowError):
                raise CollectorFailure("invalid_response") from None
            if self.monotonic() >= deadline: raise CollectorFailure("collection_timeout")
            if wanted.keys()-seen:
                rack_states.append("unknown")
        source = copy.deepcopy(self.source)
        source["max_age_seconds"] = ttl
        source["rack_state"] = ("fault" if "fault" in rack_states else "working" if "working" in rack_states
                                else "unknown" if "unknown" in rack_states or not rack_states
                                else "offline" if all(x=="offline" for x in rack_states) else "idle")
        self.source["max_age_seconds"] = ttl
        return {"schema_version":1,"sampled_at":utc_iso(now),"attempted_at":utc_iso(now),
                "last_success_at":utc_iso(now),"window":window,"users":users,
                "connection":{"status":"ok","error_code":None,"http_status":None},"source":source}

    @staticmethod
    def _user(uid, observation, q):
        identity, concurrency, usage, models = (observation[k] for k in ("identity","concurrency","today_usage","active_models"))
        good_identity = q["identity"]=="fresh"
        good_concurrency = q["concurrency"]=="fresh"
        good_usage = q["today_usage"]=="fresh"
        user = {"user_id":uid,"email":"","username":identity["name"] if good_identity else "", "api_keys":[],
                "token_usage":{"total":usage["total"] if good_usage else None},
                "concurrency":{"current":concurrency["current"] if good_concurrency else None,
                               "limit":concurrency["limit"] if good_concurrency else 0},
                "quality":{"identity":"fresh" if good_identity else "unavailable","api_keys":"untracked",
                           "token_usage":"fresh" if good_usage else "unavailable",
                           "concurrency":"fresh" if good_concurrency else "untracked" if q["concurrency"]=="untracked" else "unavailable"},
                "observed_at":{"identity":identity["observed_at"] if good_identity else None,"api_keys":None,
                               "token_usage":usage["observed_at"] if good_usage else None,
                               "concurrency":concurrency["observed_at"] if good_concurrency else None},
                "active_models":models if q["active_models"] in {"fresh","partial"} else {"models":[],"quality":q["active_models"],"observed_at":None}}
        user["active_models"] = copy.deepcopy(user["active_models"])
        for model in user["active_models"]["models"]:
            model["requests"] = int(model["requests"])
        if good_usage:
            user["usage_window"]={"start":usage["date"]+"T00:00:00+08:00",
                                  "end":usage["window_end"],"timezone":"Asia/Shanghai"}
        state = observation["service_state"]
        rack = ("unknown" if q["heartbeat"]!="fresh" else "offline" if state=="offline"
                else "fault" if state=="degraded" else "unknown" if state=="unknown" or not good_concurrency
                else "working" if concurrency["current"]>0 else "idle")
        return user, rack
