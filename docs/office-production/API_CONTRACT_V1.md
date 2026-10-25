# Office telemetry integration contract v1

Date: 2026-10-04. All identifiers and token totals remain decimal strings. New API is independent of legacy `/status`, `/agents`, `/set_state`. No Sub2API administrator/model credential reaches the office browser.

## Public snapshot — GET /api/office/snapshot

Direct JSON (no `data` envelope):
```json
{
  "schema_version": 1,
  "config_version": 1,
  "generated_at": "2026-10-04T08:00:00Z",
  "source": {
    "status": "connecting",
    "last_success_at": null,
    "last_attempt_at": null,
    "poll_interval_seconds": 5,
    "stale_after_seconds": 15,
    "error_code": null,
    "rack_state": "offline",
    "plugin_status": {"status": "unknown", "healthy": null, "ready": null, "configured": null}
  },
  "summary": {"bound": 1, "busy": 0, "idle": 0, "unknown": 1},
  "display": {"default_view": "overview", "show_bubbles": true, "show_labels": true, "details_collapsed": false, "reduced_motion": "system"},
  "stations": [
    {"seat_id": "desk-12", "display_name": "主工位", "bound": true, "activity": "unknown", "animation_state": null, "concurrency": {"current": null, "limit": null}, "quality": "unavailable", "observed_at": null, "data_age_seconds": null, "reason": "not_collected"}
  ]
}
```
The example lists one station for brevity; actual snapshots ALWAYS contain all 16 existing desk IDs in layout order. Source status: `connecting|ok|error|stale`. `rack_state` is a conservative cabinet projection: `working|idle|fault|offline|unknown`; a fresh successful sample with any observed concurrency is working, a fresh zero sample is idle, plugin/runtime or transport failure is fault/offline, and stale data is unknown. `plugin_status` is the optional bounded Health projection from `GET /api/v1/plugins/{id}/user-telemetry/status`; old hosts may report `unknown`. Activity: `busy|idle|unknown|unbound`; animation_state is `writing|idle|null`, NOT a seventh legacy business state. Unbound stations have bound=false, activity=unbound, null concurrency/observed_at; display_name is a safe seat label. Public source never includes endpoint, credential metadata, upstream IDs or a raw error body. Public payload MUST NOT contain `user_id`, email, API key metadata, token totals, raw request data or administrator fixtures. Following the 2026-10-04 user-approved change, `username` is the ONLY additional public identity field; see the four-user speech-bubble contract below. Display aliases remain explicit configuration and are never inferred from email.

Trust fresh concurrency only if the entire source read succeeded, `quality.concurrency=fresh`, current is a nonnegative integer and its observed_at is within 3*poll interval. A failed request or null/untracked value is immediately unknown, even with a previous successful snapshot. A restart resets collector trust until a successful read. Full source auth/scope failure invalidates sensitive cached users. Short requests between collection samples can be missed.

## Configuration — administrator only

GET `/api/office/admin/config` -> `{ "config": Config, "history": [{"version":1,"created_at":"...","action":"initialize","actor":"system"}] }`.

Config:
```json
{
  "schema_version": 1,
  "version": 1,
  "updated_at": null,
  "bindings": [{"seat_id": "desk-12", "user_id": "1", "display_name": "主工位", "enabled": true}],
  "display": {"default_view": "overview", "show_bubbles": true, "show_labels": true, "details_collapsed": false, "reduced_motion": "system"},
  "collection": {"poll_interval_seconds": 5}
}
```
Defaults: only user `1` allowed, only desk-12 bound. No auto-allocation of legacy agents. Source endpoint/install ID/credential come from server-only environment/secret files, never saved by config API. poll_interval_seconds accepts 5, 10 or 30. default_view: overview|west|east|workstation. reduced_motion: system|on|off. Bindings are unique by user_id and seat_id; canonical authorized user IDs and existing layout seat IDs only. Alias is trimmed non-empty text, max 40 chars. All writes are transactions with optimistic version check and audit; never overwrite historic versions.

PUT `/api/office/admin/config`, body `{ "expected_version":1, "config": {"bindings":[...],"display":{...},"collection":{...}} }` -> `{ "config": Config }` on success. Client MUST GET config again and compare saved version/config before declaring persistence success. HTTP 409 version conflict leaves original configuration intact.

POST `/api/office/admin/config/restore`, body `{ "expected_version":2, "target_version":1 }` -> `{ "config": Config }`; restored content becomes a NEW version. It cannot change source scopes or credentials and must revalidate restored bindings against current authorization.

## Administrator telemetry — GET /api/office/admin/users

Direct JSON `{ "schema_version":1, "config_version":1, "source":{...PublicSource,"installation_id":1,"allowed_user_ids":["1"],"credential_expires_at":null}, "window":null, "users":[] }`. Users when available preserve the validated plugin v1 five-field contract: user_id, email, username, api_keys(id/name/status only), token_usage(total string|null), concurrency(current/limit), quality, observed_at. Empty username remains empty. No model/QPS/cost/task-stage inference. Do not include raw credential/hash or upstream response headers. Admin UI labels window and recorded usage, timezone Asia/Shanghai.

## Session

GET `/api/office/admin/session` -> `{ "authenticated":false, "csrf_token":"session-specific-token", "username":null }`. GET creates a CSRF token if absent. POST JSON `{ "username":"admin", "password":"..." }` with X-CSRF-Token -> same shape authenticated=true, rotated CSRF token. DELETE with CSRF -> authenticated=false. Browser uses same-origin credentials. All PUT/POST/DELETE require CSRF + same-origin verification. Administrator endpoints other than session require authenticated session. Production cookie Secure/HttpOnly/SameSite=Lax, independent strong hash and signing secret, throttled login. Production admin is served only through HTTPS portal/loopback.

Errors: `{ "error": { "code":"VERSION_CONFLICT", "message":"...safe human text..." } }`. Never forward upstream bodies/exceptions/tokens. 401 unauthenticated, 403 scope/CSRF, 400 validation, 409 conflict, 429 login budget.

## Runtime adapter contract

Export `OfficeRuntimeAdapter` from connected-v4/telemetry-adapter.mjs. Construct with `new OfficeRuntimeAdapter(runtime, {mode:'live'|'preview'})`. Methods: `applyTelemetrySnapshot(snapshot)`, `applyDisplaySettings(display)`, `selectStation(seatId,{focus:false})`, `setView(view)`, `snapshot()`, `setDemoMode(boolean)`, `setStationState(seatId,state)`, `setStationDirection(seatId,direction)`, `update(time,delta)`, `destroy()`. Forward/create/preload via wrapped ConnectedOfficeRuntime. Constructor takes a loaded runtime; frontend owns Phaser Scene and calls runtime.preload(scene), runtime.create(scene) before constructing adapter.

Live adapter hides unbound actors but preserves original furniture/chair layer, shows neutral static pose for unknown, resets only changed station state clocks. Preview supports all 16 actors and four directions/six states, never writes backend and does not replace latest live data. Avoid using legacy document UI elements as mandatory dependencies. Changing view/selection or repeating same snapshot cannot reset animation. Existing 12fps clocks, source assets, manifests, positions and face-only pixel invariants stay unchanged.


## 2026-10-04 update — four users and live speech bubbles (supersedes single-user defaults)

- Dedicated collection profile: `OFFICE_USER_IDS=1,4,7,8`. Actual Sub2API authorization and credential scope must already permit these users; the office cannot enlarge plugin permission. A narrower explicit environment scope must remain supported, not silently widened.
- Initial mapping for a NEW configuration store, limited to its explicit collection scope: user `4` → `desk-09`, user `7` → `desk-10`, user `8` → `desk-11`, user `1` → `desk-12`. Existing stores are never auto-migrated or overwritten: use versioned admin config save + readback. User/seat uniqueness remains enforced.
- Public station allowlist adds `username: string|null`, `identity_quality: fresh|unavailable|stale|unbound`, `identity_observed_at: string|null`. Only a currently successful source read plus fresh identity field observation may project the real plugin username. Stale/failed/missing identity is null; unbound is null/unbound. Fresh `""` is preserved as an empty username, NOT converted to null or filled from email, user ID or alias. Control characters are never rendered as markup.
- Employee/runtime identity display: actual non-empty username; a fresh empty/whitespace-only username is labelled `用户名未设置`; unavailable identity is `用户名未知`. `display_name` remains the configured seat alias in the rest of the UI. Frontend and runtime independently discard stale usernames on read failure/source error or elapsed freshness.
- Live speech bubble is one compact line, exactly `username：X`, where X is the sampled current concurrency, including zero. It has no user ID, seat number, state sentence or unit suffix. A fresh empty username uses `未设置：X`; unavailable/stale identity uses `用户名未知：—`. Unknown/untracked/failed concurrency is `username：—`, NEVER a fabricated zero. Only the username portion may be elided for long names; keep the count lossless and show the full username in selected details. The stored technical activity and animation remain busy/writing, idle/idle, unknown/neutral. No fake completion, failure or research inference.
- Geometry/motion is implemented only in the formal runtime adapter, without changing accepted assets, media hashes or the legacy V4 compositor. Speech bubble has a small rounded body and a pointer, bounded quiet float and update feedback. Its horizontal center stays on its own head/workstation anchor; collision handling may use a nearby vertical row, never a global remote rail. Layout reserves motion extents and avoids heads, other labels and viewport edges. System/config reduced-motion disables float/update animation. Each actor retains its independent existing animation clock and each bubble has independent motion; polling, selection and camera changes do not restart unchanged clocks or move the camera.
- Live bubble names/counts are always sourced from the anonymous whitelist payload. Administrator preview remains isolated and marked `演示`; no preview write-back.

Wire example (single bound row, NOT a complete snapshot):
```json
{"seat_id":"desk-12","bound":true,"display_name":"主工位","username":"真实插件用户名","identity_quality":"fresh","identity_observed_at":"2026-10-04T12:00:00Z","activity":"busy","animation_state":"writing","concurrency":{"current":3,"limit":10},"quality":"fresh","observed_at":"2026-10-04T12:00:00Z","data_age_seconds":0,"reason":null}
```

Old schema_version 1 payloads lacking the optional identity fields remain readable as username unknown. No email/ID fallback. Config export still contains aliases and binding IDs only, not telemetry identity.
