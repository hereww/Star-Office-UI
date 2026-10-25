"""Standalone, single-instance, read-only Sub2API collector (no web-worker timer).

Run: python -m backend.office_collector --data-dir /private/office-data
Settings are server-owned environment variables:
  OFFICE_SUB2API_BASE_URL (HTTPS origin), OFFICE_CREDENTIAL_FILE (0400/0600),
  OFFICE_INSTALLATION_ID (default 1), OFFICE_USER_IDS (default 1,4,7,8),
  OFFICE_CREDENTIAL_EXPIRES_AT (optional metadata; never decoded from token).
Only private development fixtures may explicitly allow HTTP via
OFFICE_ALLOW_HTTP=1. TLS verification is never disabled. Never prints upstream
bodies, exception details, credentials, URLs or private user data.
"""
from __future__ import annotations

import argparse
import copy
import contextlib
import fcntl
import json
import os
import re
import stat
import sqlite3
import ssl
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

try:
    from .office_contract import ContractError, canonical_id, timestamp, utc_iso, validate_telemetry_page, snapshot_is_fresh
    from .office_settings import office_data_dir, office_user_ids
    from .office_store import OfficeStore
except ImportError:
    from office_contract import ContractError, canonical_id, timestamp, utc_iso, validate_telemetry_page, snapshot_is_fresh
    from office_settings import office_data_dir, office_user_ids
    from office_store import OfficeStore

INTERVAL_SECONDS = 5
STALE_SECONDS = 15
MAX_RESPONSE_BYTES = 2 * 1024 * 1024
MAX_SNAPSHOT_BYTES = 16 * 1024 * 1024
ERROR_CODES = frozenset({"not_configured", "unauthorized", "forbidden", "rate_limited", "upstream_unavailable",
                         "upstream_http_error", "timeout", "transport_error", "invalid_response",
                         "invalid_credential_file", "credential_expired", "pagination_error", "collection_timeout", "configuration_unavailable"})
PLUGIN_STATUS_ERRORS = frozenset({"unsupported", "unauthorized", "forbidden", "upstream_http_error", "timeout",
                                  "transport_error", "invalid_response"})
RACK_STATES = frozenset({"working", "idle", "fault", "offline", "unknown"})


class CollectorFailure(Exception):
    def __init__(self, code, http_status=None):
        self.code, self.http_status = code, http_status
        super().__init__(code)


class AlreadyRunning(Exception):
    pass


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def http_get(url, headers, timeout):
    # Ignore environment proxies and disallow redirects so the secret stays at one origin.
    tls_context = ssl.create_default_context()
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect(),
                                        urllib.request.HTTPSHandler(context=tls_context))
    req = urllib.request.Request(url, headers=headers, method="GET")
    try:
        with opener.open(req, timeout=timeout) as response:
            return response.status, response.read(MAX_RESPONSE_BYTES + 1)
    except urllib.error.HTTPError as exc:
        code = exc.code
        exc.close()  # No sensitive error body is ever read or logged.
        return code, b""


def read_credential(path):
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        with os.fdopen(fd, "rb") as handle:
            info = os.fstat(handle.fileno())
            if not stat.S_ISREG(info.st_mode) or stat.S_IMODE(info.st_mode) not in (0o400, 0o600) or info.st_uid not in {0, os.geteuid()}:
                raise ValueError()
            raw = handle.read(256)
        token = raw.decode("ascii").strip()
        if not re.fullmatch(r"s2ut_[A-Za-z0-9_-]{43}", token):
            raise ValueError()
        return token
    except (OSError, UnicodeError, ValueError):
        raise CollectorFailure("invalid_credential_file") from None


def atomic_snapshot(path, snapshot):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    data = json.dumps(snapshot, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")
    if len(data) > MAX_SNAPSHOT_BYTES:
        raise CollectorFailure("invalid_response")
    fd, temporary = tempfile.mkstemp(prefix=".office-snapshot-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as handle:
            os.fchmod(handle.fileno(), 0o600)
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
        directory = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def empty_snapshot(code="not_configured", now=None, last_success_at=None, source=None, http_status=None):
    source = copy.deepcopy(source) if source else {"installation_id": "1", "authorized_user_ids": ["1"],
                                                   "interval_seconds": INTERVAL_SECONDS,
                                                   "stale_after_seconds": STALE_SECONDS,
                                                   "credential_expires_at": None}
    source.setdefault("plugin_status", {"status": "unknown", "healthy": None, "ready": None,
                                         "configured": None, "error_code": code if code != "not_configured" else "unsupported",
                                         "observed_at": None})
    source.setdefault("rack_state", rack_state_for("unknown", code, source.get("plugin_status"), []))
    return {"schema_version": 1, "sampled_at": None, "attempted_at": utc_iso(now) if now is not None else None,
            "last_success_at": last_success_at, "window": None, "users": [],
            "connection": {"status": "unknown", "error_code": code, "http_status": http_status},
            "source": source}


def normalize_plugin_status(value):
    """Validate the optional external plugin Health projection.

    The status endpoint is deliberately best-effort: old hosts may return 404
    and malformed/untrusted fields collapse to an opaque unknown state. Only
    fixed booleans and error codes are persisted; arbitrary plugin JSON never
    reaches the office snapshot.
    """
    empty = {"status": "unknown", "healthy": None, "ready": None, "configured": None,
             "error_code": "unsupported", "observed_at": None}
    if not isinstance(value, dict):
        return empty
    status = value.get("status")
    if status not in {"healthy", "unhealthy", "unknown"}:
        status = "unknown"
    result = {"status": status,
              "healthy": value.get("healthy") if type(value.get("healthy")) is bool else None,
              "ready": value.get("ready") if type(value.get("ready")) is bool else None,
              "configured": value.get("configured") if type(value.get("configured")) is bool else None,
              "error_code": value.get("error_code") if value.get("error_code") in PLUGIN_STATUS_ERRORS else None,
              "observed_at": value.get("observed_at") if timestamp(value.get("observed_at")) is not None else None}
    if result["status"] == "unknown" and result["error_code"] is None:
        result["error_code"] = "unsupported"
    return result


def rack_state_for(connection_status, error_code, plugin_status, users):
    """Map trusted source/plugin facts to a conservative cabinet state."""
    plugin = normalize_plugin_status(plugin_status)
    if connection_status == "stale":
        return "unknown"
    if plugin["status"] == "unhealthy":
        # An unready/unconfigured plugin is a stopped cabinet; an otherwise
        # configured but unhealthy process is an explicit fault.
        return "offline" if plugin["ready"] is False and plugin["configured"] is False else "fault"
    if connection_status in {"unknown", "error"}:
        if error_code in {"not_configured", "credential_expired", "unauthorized", "forbidden", "upstream_unavailable", "configuration_unavailable"}:
            return "offline"
        return "fault" if connection_status == "error" else "unknown"
    if connection_status == "ok":
        busy = any(isinstance(user, dict) and user.get("quality", {}).get("concurrency") == "fresh"
                   and isinstance(user.get("concurrency", {}).get("current"), int)
                   and user["concurrency"]["current"] > 0 for user in (users or []))
        return "working" if busy else "idle"
    return "unknown"


def read_snapshot(path):
    """Fail closed on missing/corrupt files and normalize all persisted private fields."""
    try:
        with open(path, "rb") as handle:
            data = handle.read(MAX_SNAPSHOT_BYTES + 1)
        if len(data) > MAX_SNAPSHOT_BYTES:
            raise ValueError()
        raw = json.loads(data)
        if not isinstance(raw, dict) or type(raw.get("schema_version")) is not int or raw.get("schema_version") != 1:
            raise ValueError()
        source = raw["source"]
        if not isinstance(source, dict):
            raise ValueError()
        installation_id = canonical_id(source["installation_id"])
        allowed = source["authorized_user_ids"]
        if not isinstance(allowed, list) or not 1 <= len(allowed) <= 500 or len(set(allowed)) != len(allowed):
            raise ValueError()
        allowed = [canonical_id(uid) for uid in allowed]
        expiry = source.get("credential_expires_at")
        if expiry is not None and timestamp(expiry) is None:
            raise ValueError()
        if type(source.get("interval_seconds")) is not int or source["interval_seconds"] not in (5, 10, 30):
            raise ValueError()
        safe_source = {"installation_id": installation_id, "authorized_user_ids": allowed,
                       "interval_seconds": source["interval_seconds"], "stale_after_seconds": source["interval_seconds"] * 3,
                       "credential_expires_at": expiry,
                       "plugin_status": normalize_plugin_status(source.get("plugin_status")),
                       "rack_state": source.get("rack_state") if source.get("rack_state") in RACK_STATES else None}
        connection = raw["connection"]
        if not isinstance(connection, dict):
            raise ValueError()
        if connection.get("status") != "ok":
            code = connection.get("error_code")
            if code not in ERROR_CODES:
                code = "invalid_response"
            http_status = connection.get("http_status")
            if type(http_status) is not int or not 100 <= http_status <= 599:
                http_status = None
            result = empty_snapshot(code, source=safe_source, http_status=http_status)
        else:
            page = validate_telemetry_page({"schema_version": 1, "window": raw["window"], "users": raw["users"],
                                            "next_cursor": None}, set(allowed))
            if timestamp(raw.get("sampled_at")) is None:
                raise ValueError()
            result = {"schema_version": 1, "sampled_at": raw["sampled_at"], "window": page["window"],
                      "users": page["users"], "connection": {"status": "ok", "error_code": None, "http_status": None},
                      "source": safe_source}
        result["source"]["rack_state"] = rack_state_for(result["connection"]["status"],
                                                          result["connection"].get("error_code"),
                                                          result["source"].get("plugin_status"), result.get("users", []))
        for key in ("attempted_at", "last_success_at"):
            result[key] = raw.get(key) if timestamp(raw.get(key)) is not None else None
        return result
    except FileNotFoundError:
        return empty_snapshot()
    except (OSError, ValueError, TypeError, KeyError, OverflowError):
        return empty_snapshot("invalid_response")


@contextlib.contextmanager
def collector_lock(path):
    """Cross-process advisory lock, held for the entire collector lifetime.

    Never unlink the lock file (unlink/recreate permits two simultaneously locked inodes).
    """
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd = os.open(path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise AlreadyRunning("collector_already_running") from None
        yield
    finally:
        os.close(fd)


class OfficeCollector:
    def __init__(self, data_dir, base_url, credential_file, installation_id="1", user_ids=None,
                 credential_expires_at=None, allow_http=False, transport=http_get,
                 clock=time.time, monotonic=time.monotonic):
        self.data_dir = Path(data_dir)
        self.snapshot_path = self.data_dir / "office-snapshot.json"
        self.lock_path = self.data_dir / "office-collector.lock"
        try:
            parsed = urllib.parse.urlsplit(base_url)
            port = parsed.port
        except (ValueError, TypeError):
            raise ValueError("invalid_upstream_origin") from None
        if (parsed.scheme not in ({"https", "http"} if allow_http else {"https"}) or not parsed.hostname
                or parsed.username is not None or parsed.password is not None or parsed.query or parsed.fragment
                or parsed.path not in {"", "/"} or any(c.isspace() for c in base_url)):
            raise ValueError("invalid_upstream_origin")
        del port  # forces validation; fixed origin is never provided by browser inputs
        self.base_url = base_url.rstrip("/")
        self.credential_file = str(credential_file)
        self.installation_id = canonical_id(installation_id)
        user_ids = office_user_ids() if user_ids is None else user_ids
        if not isinstance(user_ids, (tuple, list, set, frozenset)) or not 1 <= len(user_ids) <= 500 or len(set(user_ids)) != len(user_ids):
            raise ValueError("invalid_user_scope")
        self.user_ids = tuple(sorted((canonical_id(uid) for uid in user_ids), key=int))
        if credential_expires_at is not None and timestamp(credential_expires_at) is None:
            raise ValueError("invalid_credential_expiry")
        self.credential_expires_at = credential_expires_at
        self.transport, self.clock, self.monotonic = transport, clock, monotonic
        # None means capability discovery has not happened; False permanently
        # suppresses repeat probes after an older host's 404 response.
        self.plugin_status_supported = None
        self.interval_seconds = INTERVAL_SECONDS
        self.source = {"installation_id": self.installation_id, "authorized_user_ids": list(self.user_ids),
                       "interval_seconds": INTERVAL_SECONDS, "stale_after_seconds": STALE_SECONDS,
                       "credential_expires_at": credential_expires_at,
                       "plugin_status": normalize_plugin_status(None), "rack_state": "offline"}

    def _probe_plugin_status(self, token, timeout):
        """Best-effort passive status read; old telemetry hosts may return 404."""
        unknown = normalize_plugin_status(None)
        if self.plugin_status_supported is False:
            return unknown
        if timeout <= 0:
            unknown["error_code"] = "timeout"
            return unknown
        url = f"{self.base_url}/api/v1/plugins/{self.installation_id}/user-telemetry/status"
        try:
            code, data = self.transport(url, {"Authorization": f"Bearer {token}", "Accept": "application/json"}, min(4, timeout))
        except (TimeoutError, urllib.error.URLError):
            unknown["error_code"] = "timeout"
            return unknown
        except (OSError, ValueError, TypeError, KeyError):
            unknown["error_code"] = "transport_error"
            return unknown
        if code in (404, 405):
            self.plugin_status_supported = False
            return unknown
        if code != 200:
            unknown["error_code"] = {401: "unauthorized", 403: "forbidden", 404: "unsupported"}.get(code, "upstream_http_error")
            return unknown
        if not isinstance(data, bytes) or len(data) > 64 * 1024:
            unknown["error_code"] = "invalid_response"
            return unknown
        try:
            raw = json.loads(data)
            if not isinstance(raw, dict) or type(raw.get("schema_version")) is not int or raw["schema_version"] != 1:
                raise ValueError()
            if raw.get("plugin_id") not in (self.installation_id, int(self.installation_id)):
                raise ValueError()
            if type(raw.get("healthy")) is not bool or type(raw.get("ready")) is not bool or type(raw.get("configured")) is not bool:
                raise ValueError()
        except (ValueError, TypeError, KeyError, json.JSONDecodeError):
            unknown["error_code"] = "invalid_response"
            return unknown
        self.plugin_status_supported = True
        return {"status": "healthy" if raw["healthy"] else "unhealthy", "healthy": raw["healthy"],
                "ready": raw["ready"], "configured": raw["configured"], "error_code": None,
                "observed_at": utc_iso(self.clock())}

    def _collect(self):
        if self.credential_expires_at and self.clock() >= timestamp(self.credential_expires_at):
            raise CollectorFailure("credential_expired")
        token = read_credential(self.credential_file)
        # Explicit fixed window across EVERY page, even across Beijing midnight.
        from datetime import datetime
        from zoneinfo import ZoneInfo
        now = datetime.fromtimestamp(self.clock(), ZoneInfo("Asia/Shanghai"))
        window = {"start": now.replace(hour=0, minute=0, second=0, microsecond=0).isoformat(),
                  "end": now.isoformat(), "timezone": "Asia/Shanghai"}
        params = {**window, "user_ids": ",".join(self.user_ids), "page_size": "100"}
        cursor, seen_cursors, users, deadline = None, set(), [], self.monotonic() + 10
        last_uid = 0
        for _ in range(500):
            remaining = deadline - self.monotonic()
            if remaining <= 0:
                raise CollectorFailure("collection_timeout")
            query = {**params}
            if cursor:
                query["cursor"] = cursor
            url = f"{self.base_url}/api/v1/plugins/{self.installation_id}/user-telemetry?{urllib.parse.urlencode(query)}"
            code, data = self.transport(url, {"Authorization": f"Bearer {token}", "Accept": "application/json"}, min(4, remaining))
            if code != 200:
                error = {401: "unauthorized", 403: "forbidden", 429: "rate_limited", 503: "upstream_unavailable"}.get(code, "upstream_http_error")
                raise CollectorFailure(error, code)
            if not isinstance(data, bytes) or len(data) > MAX_RESPONSE_BYTES:
                raise CollectorFailure("invalid_response")
            try:
                page = validate_telemetry_page(json.loads(data), set(self.user_ids))
            except (ValueError, TypeError, KeyError):
                raise CollectorFailure("invalid_response") from None
            if page["window"] != window:
                # Compare instants: a valid server may serialize +08:00 as UTC.
                if (page["window"]["timezone"] != window["timezone"] or
                        any(timestamp(page["window"][k]) != timestamp(window[k]) for k in ("start", "end"))):
                    raise CollectorFailure("pagination_error")
            for user in page["users"]:
                if int(user["user_id"]) <= last_uid:
                    raise CollectorFailure("pagination_error")
                last_uid = int(user["user_id"])
                users.append(user)
            cursor = page["next_cursor"]
            if cursor is None:
                if self.monotonic() >= deadline:
                    raise CollectorFailure("collection_timeout")
                plugin_status = self._probe_plugin_status(token, deadline - self.monotonic())
                source = copy.deepcopy(self.source)
                source["plugin_status"] = plugin_status
                source["rack_state"] = rack_state_for("ok", None, plugin_status, users)
                # The successful output itself is also bounded before writing to disk.
                return {"schema_version": 1, "sampled_at": utc_iso(self.clock()), "attempted_at": utc_iso(self.clock()),
                        "last_success_at": utc_iso(self.clock()), "window": window, "users": users,
                        "connection": {"status": "ok", "error_code": None, "http_status": None}, "source": source}
            if cursor in seen_cursors or not page["users"] or int(cursor) != last_uid:
                raise CollectorFailure("pagination_error")
            seen_cursors.add(cursor)
        raise CollectorFailure("pagination_error")

    def _start(self):
        # Invalidate first, before a schema lock or SQLite initialization can block.
        previous_success = read_snapshot(self.snapshot_path).get("last_success_at")
        atomic_snapshot(self.snapshot_path, empty_snapshot(now=self.clock(), last_success_at=previous_success,
                                                         source=self.source))
        try:
            self.store = OfficeStore(self.data_dir / "office-config.sqlite3", clock=self.clock, allowed_user_ids=self.user_ids)
            self._refresh_interval()
        except (sqlite3.Error, OSError):
            atomic_snapshot(self.snapshot_path, empty_snapshot("configuration_unavailable", now=self.clock(),
                                                             last_success_at=previous_success, source=self.source))
            raise

    def _refresh_interval(self):
        self.interval_seconds = self.store.read_config()["collection"]["poll_interval_seconds"]
        self.source["interval_seconds"] = self.interval_seconds
        self.source["stale_after_seconds"] = self.interval_seconds * 3

    def _collect_and_write(self):
        # Read only non-sensitive last-success metadata. Failures never retain a previous users list.
        previous_success = read_snapshot(self.snapshot_path).get("last_success_at")
        try:
            self._refresh_interval()
            snapshot = self._collect()
            atomic_snapshot(self.snapshot_path, snapshot)
            return snapshot
        except CollectorFailure as exc:
            error, status = exc.code, exc.http_status
        except sqlite3.Error:
            error, status = "configuration_unavailable", None
        except TimeoutError:
            error, status = "timeout", None
        except urllib.error.URLError as exc:
            error, status = ("timeout" if isinstance(exc.reason, TimeoutError) else "transport_error"), None
        except (OSError, ValueError, TypeError, KeyError):
            error, status = "transport_error", None
        source = copy.deepcopy(self.source)
        source["plugin_status"] = normalize_plugin_status(None)
        source["plugin_status"]["error_code"] = "unsupported" if error == "not_configured" else error if error in PLUGIN_STATUS_ERRORS else None
        source["rack_state"] = rack_state_for("error", error, source["plugin_status"], [])
        snapshot = empty_snapshot(error, now=self.clock(), last_success_at=previous_success,
                                  source=source, http_status=status)
        # If the file system is unwritable this raises; the daemon exits rather than silently retaining state.
        atomic_snapshot(self.snapshot_path, snapshot)
        return snapshot

    def collect_once(self):
        with collector_lock(self.lock_path):
            self._start()
            return self._collect_and_write()

    def _wait_for_next_collection(self, stop_event, cycle_start, cycle_end):
        # Watch config at most once/sec while waiting; never send an upstream
        # request just because a browser refreshed or a config version changed.
        while not stop_event.is_set():
            try:
                self._refresh_interval()
            except (sqlite3.Error, OSError, KeyError, TypeError, ValueError):
                previous_success = read_snapshot(self.snapshot_path).get("last_success_at")
                atomic_snapshot(self.snapshot_path, empty_snapshot("configuration_unavailable", now=self.clock(),
                                                                 last_success_at=previous_success, source=self.source))
                stop_event.wait(1)
                continue
            due = cycle_start + self.interval_seconds
            if due <= cycle_end:
                # A slow previous request must not produce a catch-up burst.
                due = cycle_end + self.interval_seconds
            remaining = due - self.monotonic()
            if remaining <= 0:
                return
            stop_event.wait(min(1, remaining))

    def run(self, stop_event=None):
        stop_event = stop_event or threading.Event()
        with collector_lock(self.lock_path):
            self._start()
            while not stop_event.is_set():
                started = self.monotonic()
                self._collect_and_write()
                self._wait_for_next_collection(stop_event, started, self.monotonic())


def collector_health(data_dir, now=None):
    data_dir = Path(data_dir)
    snapshot = read_snapshot(data_dir / "office-snapshot.json")
    now = time.time() if now is None else now
    # Health probes must NOT initialize/create a DB or mutate a read-only rootfs.
    # Re-read persisted configuration so a 30->5 change immediately uses 15s age.
    try:
        path = data_dir / "office-config.sqlite3"
        with contextlib.closing(sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True, timeout=2)) as db:
            row = db.execute("SELECT v.payload FROM config_head h JOIN config_versions v ON v.version=h.version WHERE h.singleton=1").fetchone()
            config = json.loads(row[0])
            interval = config["collection"]["poll_interval_seconds"]
            if type(interval) is not int or interval not in (5, 10, 30):
                return False
    except (sqlite3.Error, OSError, ValueError, TypeError, KeyError):
        return False
    expiry = timestamp(snapshot.get("source", {}).get("credential_expires_at"))
    threshold = min(interval * 3, snapshot.get("source", {}).get("stale_after_seconds", STALE_SECONDS))
    return ((expiry is None or now < expiry) and snapshot_is_fresh(snapshot, now, threshold))


def main():
    parser = argparse.ArgumentParser(description="Office single-instance read-only collector")
    parser.add_argument("--data-dir", default=str(office_data_dir()))
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--health", action="store_true")
    args = parser.parse_args()
    if args.health:
        return 0 if collector_health(args.data_dir) else 1
    try:
        collector = OfficeCollector(args.data_dir, os.environ.get("OFFICE_SUB2API_BASE_URL", ""),
                                    os.environ.get("OFFICE_CREDENTIAL_FILE", ""),
                                    installation_id=os.environ.get("OFFICE_INSTALLATION_ID", "1"),
                                    user_ids=office_user_ids(),
                                    credential_expires_at=os.environ.get("OFFICE_CREDENTIAL_EXPIRES_AT") or None,
                                    allow_http=os.environ.get("OFFICE_ALLOW_HTTP") == "1")
        if args.once:
            return 0 if collector.collect_once()["connection"]["status"] == "ok" else 1
        collector.run()
        return 0
    except AlreadyRunning:
        print("collector_already_running")
        return 2
    except (ValueError, OSError, sqlite3.Error):
        print("collector_configuration_or_storage_error")
        return 2
    except KeyboardInterrupt:
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
