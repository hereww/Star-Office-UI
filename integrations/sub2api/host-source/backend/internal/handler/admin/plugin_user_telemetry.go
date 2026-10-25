package admin

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync/atomic"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/pkg/response"
	"github.com/Wei-Shaw/sub2api/internal/service"
	pluginv1 "github.com/Wei-Shaw/sub2api/pkg/pluginapi/v1"
	"github.com/Wei-Shaw/sub2api/pkg/usertelemetry"
	"github.com/gin-gonic/gin"
	"golang.org/x/time/rate"
)

// ReadUserTelemetry is admin-only; ReadUserTelemetryExternal accepts no admin or model credentials.
func (h *PluginHandler) ReadUserTelemetry(c *gin.Context) {
	id, ok := telemetryPluginID(c)
	if !ok {
		return
	}
	allowed, err := h.manager.GetTelemetryAllowedUsers(c.Request.Context(), id)
	if err != nil {
		response.Error(c, 503, "telemetry plugin unavailable")
		return
	}
	h.readTelemetry(c, id, allowed)
}
func (h *PluginHandler) ReadUserTelemetryExternal(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	c.Header("Vary", "Authorization")
	id, ok := telemetryPluginID(c)
	if !ok {
		return
	}
	scope, ok := h.authenticateTelemetryExternal(c, id)
	if !ok {
		return
	}
	h.readTelemetry(c, id, scope)
}

// ReadUserTelemetryStatusExternal exposes the plugin's passive Health summary
// to an office collector using the same scoped s2ut credential as telemetry.
// It never applies configuration, reads upstream data, or accepts admin/model
// credentials. The response intentionally allowlists only lifecycle booleans;
// arbitrary plugin messages/status JSON must not become an unauthenticated
// data exfiltration channel.
func (h *PluginHandler) ReadUserTelemetryStatusExternal(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	c.Header("Vary", "Authorization")
	id, ok := telemetryPluginID(c)
	if !ok {
		return
	}
	if _, ok = h.authenticateTelemetryExternal(c, id); !ok {
		return
	}
	if telemetryStatusInFlight.Add(1) > 8 {
		telemetryStatusInFlight.Add(-1)
		response.Error(c, 429, "too many telemetry status queries")
		return
	}
	defer telemetryStatusInFlight.Add(-1)
	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()
	var health *pluginv1.HealthResponse
	var err error
	if h.statusReader != nil {
		health, err = h.statusReader(ctx, id)
	} else if h.manager != nil {
		health, err = h.manager.Status(ctx, id)
	} else {
		err = errors.New("plugin status manager unavailable")
	}
	if err != nil || health == nil {
		response.Error(c, 503, "telemetry plugin status unavailable")
		return
	}
	ready, configured := false, false
	if raw := strings.TrimSpace(health.GetStatusJson()); raw != "" && len(raw) <= 4096 {
		var summary map[string]any
		decoder := json.NewDecoder(strings.NewReader(raw))
		if decoder.Decode(&summary) == nil && summary != nil {
			if value, valid := summary["ready"].(bool); valid {
				ready = value
			}
			if value, valid := summary["configured"].(bool); valid {
				configured = value
			}
		}
	}
	c.JSON(http.StatusOK, gin.H{"schema_version": 1, "plugin_id": id, "healthy": health.GetHealthy(),
		"ready": ready, "configured": configured})
}

// authenticateTelemetryExternal validates the dedicated scoped credential and
// clamps it to the installation's current allowlist. It deliberately emits
// only fixed public errors. The returned scope is only used to prove that the
// credential still has an approved user for status reads.
func (h *PluginHandler) authenticateTelemetryExternal(c *gin.Context, id int64) ([]string, bool) {
	if c.Query("token") != "" || c.Query("api_key") != "" {
		response.Error(c, 400, "credentials must use Authorization header")
		return nil, false
	}
	auth := strings.Fields(c.GetHeader("Authorization"))
	if len(auth) != 2 || !strings.EqualFold(auth[0], "Bearer") || !strings.HasPrefix(auth[1], "s2ut_") || len(auth[1]) != 48 || h.telemetryCredentials == nil {
		response.Error(c, 401, "invalid telemetry credential")
		return nil, false
	}
	// Bound unauthenticated database work as well as successful exports. This
	// per-host budget is deliberately independent of admin/model credentials.
	if !telemetryAuthenticationBudget.begin() {
		response.Error(c, 429, "too many telemetry authentication requests")
		return nil, false
	}
	defer telemetryAuthenticationBudget.end()
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()
	cred, err := h.telemetryCredentials.Authenticate(ctx, id, service.UserTelemetrySecretHash(auth[1]))
	if err != nil {
		if errors.Is(err, service.ErrTelemetryUnauthorized) {
			response.Error(c, 401, "invalid telemetry credential")
		} else {
			response.Error(c, 503, "telemetry authentication unavailable")
		}
		return nil, false
	}
	// Clamp old issued scopes to the installation's current approval. Revoking a user takes effect immediately.
	var allowed []string
	if h.allowedUsersReader != nil {
		allowed, err = h.allowedUsersReader(ctx, id)
	} else if h.manager != nil {
		allowed, err = h.manager.GetTelemetryAllowedUsers(ctx, id)
	} else {
		err = errors.New("telemetry plugin manager unavailable")
	}
	if err != nil {
		response.Error(c, 503, "telemetry plugin unavailable")
		return nil, false
	}
	current := map[string]bool{}
	for _, s := range allowed {
		current[s] = true
	}
	scope := make([]string, 0)
	for _, s := range cred.UserIDs {
		if current[s] {
			scope = append(scope, s)
		}
	}
	if len(scope) == 0 {
		response.Error(c, 403, "credential scope no longer approved")
		return nil, false
	}
	return scope, true
}

type telemetryAuthGuard struct {
	inFlight atomic.Int32
	limiter  *rate.Limiter
}

func newTelemetryAuthGuard() *telemetryAuthGuard {
	return &telemetryAuthGuard{limiter: rate.NewLimiter(20, 40)}
}
func (g *telemetryAuthGuard) begin() bool {
	if !g.limiter.Allow() {
		return false
	}
	if g.inFlight.Add(1) > 16 {
		g.inFlight.Add(-1)
		return false
	}
	return true
}
func (g *telemetryAuthGuard) end() { g.inFlight.Add(-1) }

var telemetryAuthenticationBudget = newTelemetryAuthGuard()

// Keep passive Health calls bounded independently of telemetry exports.
var telemetryStatusInFlight atomic.Int32

// Limit concurrent export queries per host. DB timeouts bound abandoned/slow calls.
var telemetryExportInFlight atomic.Int32

func (h *PluginHandler) readTelemetry(c *gin.Context, id int64, scope []string) {
	c.Header("Cache-Control", "no-store")
	c.Header("Vary", "Authorization")
	if telemetryExportInFlight.Add(1) > 8 {
		telemetryExportInFlight.Add(-1)
		response.Error(c, 429, "too many telemetry queries")
		return
	}
	defer telemetryExportInFlight.Add(-1)
	q := usertelemetry.Query{Start: c.Query("start"), End: c.Query("end"), Timezone: c.Query("timezone"), Cursor: c.Query("cursor")}
	if s := c.Query("user_ids"); s != "" {
		q.UserIDs = strings.Split(s, ",")
	}
	if s := c.Query("page_size"); s != "" {
		v, e := strconv.Atoi(s)
		if e != nil || v < 1 || v > usertelemetry.MaxPageSize {
			response.Error(c, 400, "invalid page_size")
			return
		}
		q.PageSize = v
	}
	q, err := q.Restrict(scope)
	if err != nil {
		response.Error(c, 403, "user outside authorized scope")
		return
	}
	// Validate HTTP input without replacing omitted defaults. The manager freezes
	// the window using the persisted timezone/page_size before crossing RPC.
	_, _, _, err = q.Normalize(time.Now())
	if err != nil {
		response.Error(c, 400, err.Error())
		return
	}
	raw, err := json.Marshal(q)
	if err != nil {
		response.Error(c, 400, "invalid query")
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()
	result, err := h.manager.UserTelemetry(ctx, id, raw)
	if err != nil {
		response.Error(c, 503, "telemetry query unavailable")
		return
	}
	// Return direct versioned JSON, unlike the admin-management envelope.
	c.Data(http.StatusOK, "application/json; charset=utf-8", result)
}
func (h *PluginHandler) CreateTelemetryCredential(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	id, ok := telemetryPluginID(c)
	if !ok {
		return
	}
	var req struct {
		Name             string          `json:"name"`
		UserIDs          []string        `json:"user_ids"`
		ExpiresInSeconds json.RawMessage `json:"expires_in_seconds"`
	}
	dec := json.NewDecoder(http.MaxBytesReader(c.Writer, c.Request.Body, 16384))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&req); err != nil || strings.TrimSpace(req.Name) == "" || len(req.Name) > 100 || len(req.UserIDs) == 0 || len(req.UserIDs) > usertelemetry.MaxPageSize {
		response.Error(c, 400, "name, approved user_ids and expires_in_seconds are required")
		return
	}
	if err := dec.Decode(new(any)); err != io.EOF {
		response.Error(c, 400, "exactly one credential JSON object required")
		return
	}
	expiresAt, err := telemetryCredentialExpiry(req.ExpiresInSeconds, time.Now())
	if err != nil {
		response.Error(c, 400, err.Error())
		return
	}
	if h.telemetryCredentials == nil {
		response.Error(c, 503, "credential store unavailable")
		return
	}
	scope, err := h.manager.GetTelemetryAllowedUsers(c.Request.Context(), id)
	if err != nil {
		response.Error(c, 503, "telemetry plugin unavailable")
		return
	}
	q, err := (usertelemetry.Query{UserIDs: req.UserIDs}).Restrict(scope)
	if err != nil {
		response.Error(c, 403, "user outside approved scope")
		return
	}
	if _, _, _, err = q.Normalize(time.Now()); err != nil {
		response.Error(c, 400, "invalid scope")
		return
	}
	token, hash, err := service.NewUserTelemetrySecret()
	if err != nil {
		response.Error(c, 500, "credential generation failed")
		return
	}
	credential := &service.UserTelemetryCredential{PluginID: id, Name: req.Name, UserIDs: q.UserIDs, TokenHash: hash, ExpiresAt: expiresAt}
	if err = h.telemetryCredentials.Create(c.Request.Context(), credential); err != nil {
		response.Error(c, 503, "credential store unavailable")
		return
	}
	// The raw token is disclosed once to the authenticated issuing administrator; never logged or persisted.
	response.Created(c, gin.H{"credential": credential, "token": token})
}

const maxTelemetryCredentialLifetime = 31 * 86400

// telemetryCredentialExpiry requires an explicit expires_in_seconds field.
// Zero is the backwards-compatible, explicit permanent value; omission and
// JSON null are rejected instead of silently becoming permanent credentials.
func telemetryCredentialExpiry(raw json.RawMessage, now time.Time) (*time.Time, error) {
	if len(raw) == 0 || strings.TrimSpace(string(raw)) == "null" {
		return nil, errors.New("expires_in_seconds must be explicitly set to 0 (permanent) or 60..2678400 seconds")
	}
	var seconds int64
	if err := json.Unmarshal(raw, &seconds); err != nil {
		return nil, errors.New("expires_in_seconds must be an integer")
	}
	if seconds < 0 || (seconds > 0 && seconds < 60) || seconds > maxTelemetryCredentialLifetime {
		return nil, errors.New("expires_in_seconds must be 0 (permanent) or 60..2678400 seconds")
	}
	if seconds == 0 {
		return nil, nil
	}
	expiresAt := now.Add(time.Duration(seconds) * time.Second)
	return &expiresAt, nil
}

func (h *PluginHandler) ListTelemetryCredentials(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	id, ok := telemetryPluginID(c)
	if !ok {
		return
	}
	if h.telemetryCredentials == nil {
		response.Error(c, 503, "credential store unavailable")
		return
	}
	var cursor int64
	if value := c.Query("cursor"); value != "" {
		var err error
		cursor, err = usertelemetry.ParseID(value)
		if err != nil {
			response.Error(c, 400, "invalid credential cursor")
			return
		}
	}
	pageSize := 100
	if value := c.Query("page_size"); value != "" {
		var err error
		pageSize, err = strconv.Atoi(value)
		if err != nil || pageSize < 1 || pageSize > 500 {
			response.Error(c, 400, "credential page_size must be 1..500")
			return
		}
	}
	list, err := h.telemetryCredentials.List(c.Request.Context(), id, cursor, pageSize)
	if err != nil {
		response.Error(c, 503, "credential store unavailable")
		return
	}
	response.Success(c, list)
}
func (h *PluginHandler) RevokeTelemetryCredential(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	id, ok := telemetryPluginID(c)
	if !ok {
		return
	}
	credID, err := strconv.ParseInt(c.Param("credential_id"), 10, 64)
	if err != nil || credID <= 0 {
		response.Error(c, 400, "invalid credential id")
		return
	}
	if h.telemetryCredentials == nil {
		response.Error(c, 503, "credential store unavailable")
		return
	}
	if err = h.telemetryCredentials.Revoke(c.Request.Context(), id, credID); err != nil {
		if errors.Is(err, service.ErrTelemetryCredentialNotFound) {
			response.Error(c, 404, "credential not found")
		} else {
			response.Error(c, 503, "credential store unavailable")
		}
		return
	}
	response.Success(c, gin.H{"revoked": true})
}
func telemetryPluginID(c *gin.Context) (int64, bool) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id <= 0 {
		response.Error(c, 400, "invalid plugin id")
		return 0, false
	}
	return id, true
}
