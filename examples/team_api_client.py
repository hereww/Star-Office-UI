"""Stdlib-only client for company projects. No model calls or metrics collection."""
from __future__ import annotations

import json
import time
import urllib.error
import urllib.parse
import urllib.request


class TelemetryError(RuntimeError):
    def __init__(self, status, request_id=None):
        self.status, self.request_id = status, request_id
        super().__init__(f"telemetry request failed: HTTP {status}, request_id={request_id or 'unknown'}")


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class TeamAPIClient:
    def __init__(self, base_url, project_id, key, *, timeout=4, attempts=3):
        origin = urllib.parse.urlsplit(base_url)
        if (origin.scheme not in {"https","http"} or not origin.hostname or origin.username
                or origin.password or origin.query or origin.fragment or origin.path not in {"","/"}):
            raise ValueError("base_url must be an origin")
        self.url=base_url.rstrip("/")+"/api/v1/projects/"+urllib.parse.quote(project_id,safe="")+"/telemetry"
        if not 1<=attempts<=5 or not 0<timeout<=30: raise ValueError("invalid retry settings")
        self.key,self.timeout,self.attempts=key,timeout,attempts
        self.opener=urllib.request.build_opener(NoRedirect())

    def publish(self, observation):
        # Serialize once: all retries have the same event ID, timestamps and bytes.
        body=json.dumps(observation,ensure_ascii=False,allow_nan=False).encode()
        for attempt in range(self.attempts):
            req=urllib.request.Request(self.url,data=body,method="POST",headers={
                "Authorization":"Bearer "+self.key,"Content-Type":"application/json",
                "Idempotency-Key":observation["event_id"]})
            try:
                with self.opener.open(req,timeout=self.timeout) as response:
                    return json.loads(response.read(64*1024))
            except urllib.error.HTTPError as exc:
                status,request_id=exc.code,exc.headers.get("X-Request-ID")
                exc.close()
                if status not in {408,429,500,502,503,504} or attempt+1==self.attempts:
                    raise TelemetryError(status,request_id) from None
            except (urllib.error.URLError,TimeoutError,OSError):
                if attempt+1==self.attempts:
                    raise TelemetryError(0) from None
            time.sleep(min(2**attempt,4))
