package admin

import (
	"context"
	"encoding/json"
	"errors"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/service"
	pluginv1 "github.com/Wei-Shaw/sub2api/pkg/pluginapi/v1"
	"github.com/gin-gonic/gin"
	"golang.org/x/time/rate"
)

type telemetryCredentialStub struct {
	calls      int
	authErr    error
	credential *service.UserTelemetryCredential
	page       *service.UserTelemetryCredentialPage
	cursor     int64
	pageSize   int
}

func (s *telemetryCredentialStub) Create(context.Context, *service.UserTelemetryCredential) error {
	s.calls++
	return errors.New("not implemented")
}
func (s *telemetryCredentialStub) Authenticate(context.Context, int64, []byte) (*service.UserTelemetryCredential, error) {
	s.calls++
	return s.credential, s.authErr
}
func (s *telemetryCredentialStub) List(_ context.Context, _ int64, cursor int64, pageSize int) (*service.UserTelemetryCredentialPage, error) {
	s.calls++
	s.cursor = cursor
	s.pageSize = pageSize
	return s.page, nil
}
func (s *telemetryCredentialStub) Revoke(context.Context, int64, int64) error { s.calls++; return nil }
func telemetryTestRequest(h *PluginHandler, method, path, body, auth string, handler gin.HandlerFunc) *httptest.ResponseRecorder {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Handle(method, "/plugins/:id/user-telemetry", handler)
	w := httptest.NewRecorder()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set("Authorization", auth)
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)
	return w
}
func TestUserTelemetryRejectsOrdinaryCredentials(t *testing.T) {
	store := &telemetryCredentialStub{authErr: service.ErrTelemetryUnauthorized}
	h := &PluginHandler{telemetryCredentials: store}
	for _, auth := range []string{"", "Bearer admin-jwt", "Bearer sk-model-key", "Basic abc", "Bearer s2ut_short"} {
		w := telemetryTestRequest(h, "GET", "/plugins/1/user-telemetry", "", auth, h.ReadUserTelemetryExternal)
		if w.Code != 401 {
			t.Fatalf("ordinary credential accepted: code %d", w.Code)
		}
	}
	if store.calls != 0 {
		t.Fatal("ordinary credential caused an authentication query")
	}
}
func TestUserTelemetryRejectsURLCredential(t *testing.T) {
	store := &telemetryCredentialStub{authErr: service.ErrTelemetryUnauthorized}
	h := &PluginHandler{telemetryCredentials: store}
	for _, key := range []string{"token", "api_key"} {
		w := telemetryTestRequest(h, "GET", "/plugins/1/user-telemetry?"+key+"=secret", "", "Bearer s2ut_"+strings.Repeat("a", 43), h.ReadUserTelemetryExternal)
		if w.Code != 400 {
			t.Fatal("URL credential accepted")
		}
	}
	if store.calls != 0 {
		t.Fatal("URL credential caused a query")
	}
}
func TestUserTelemetryAuthenticationFailureIsNotEmptySuccess(t *testing.T) {
	for _, tc := range []struct {
		err  error
		code int
	}{{service.ErrTelemetryUnauthorized, 401}, {errors.New("database unavailable"), 503}} {
		store := &telemetryCredentialStub{authErr: tc.err}
		h := &PluginHandler{telemetryCredentials: store}
		w := telemetryTestRequest(h, "GET", "/plugins/1/user-telemetry", "", "Bearer s2ut_"+strings.Repeat("a", 43), h.ReadUserTelemetryExternal)
		if w.Code != tc.code || store.calls != 1 || w.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("auth failure: %d calls %d", w.Code, store.calls)
		}
	}
}

func TestUserTelemetryStatusUsesScopedCredentialAndAllowlistedHealth(t *testing.T) {
	store := &telemetryCredentialStub{credential: &service.UserTelemetryCredential{UserIDs: []string{"42"}}}
	h := &PluginHandler{
		telemetryCredentials: store,
		allowedUsersReader:   func(context.Context, int64) ([]string, error) { return []string{"42"}, nil },
		statusReader: func(context.Context, int64) (*pluginv1.HealthResponse, error) {
			return &pluginv1.HealthResponse{Healthy: true, StatusJson: `{"ready":true,"configured":true,"secret":"must-not-escape"}`}, nil
		},
	}
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/plugins/:id/user-telemetry/status", h.ReadUserTelemetryStatusExternal)
	w := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/plugins/1/user-telemetry/status", nil)
	req.Header.Set("Authorization", "Bearer s2ut_"+strings.Repeat("a", 43))
	r.ServeHTTP(w, req)
	if w.Code != 200 || w.Header().Get("Cache-Control") != "no-store" || store.calls != 1 {
		t.Fatalf("status read failed: %d calls=%d body=%s", w.Code, store.calls, w.Body.String())
	}
	var payload map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload["healthy"] != true || payload["ready"] != true || payload["configured"] != true || payload["plugin_id"] != float64(1) {
		t.Fatalf("unexpected status payload: %#v", payload)
	}
	if _, leaked := payload["secret"]; leaked || strings.Contains(w.Body.String(), "must-not-escape") {
		t.Fatal("plugin status JSON leaked arbitrary fields")
	}
}
func TestUserTelemetryCredentialRequiresExplicitScope(t *testing.T) {
	store := &telemetryCredentialStub{}
	h := &PluginHandler{telemetryCredentials: store}
	for _, body := range []string{`{"name":"consumer","expires_in_seconds":3600}`, `{"name":"consumer","user_ids":[],"expires_in_seconds":3600}`, `{"name":"consumer","user_ids":null,"expires_in_seconds":3600}`, `{"name":"consumer","user_ids":["42"]}`, `{"name":"consumer","user_ids":["42"],"expires_in_seconds":null}`, `{"name":"consumer","user_ids":["42"],"expires_in_seconds":-1}`, `{"name":"consumer","user_ids":["42"],"expires_in_seconds":59}`, `{"name":"consumer","user_ids":["42"],"expires_in_seconds":2678401}`, `{"name":"consumer","user_ids":["42"],"expires_in_seconds":3600} {}`} {
		w := telemetryTestRequest(h, "POST", "/plugins/1/user-telemetry", body, "", h.CreateTelemetryCredential)
		if w.Code != 400 {
			t.Fatalf("ambiguous credential scope accepted: %d", w.Code)
		}
	}
	if store.calls != 0 {
		t.Fatal("invalid issue request caused a write")
	}
}

func TestTelemetryCredentialExpiryRequiresExplicitFiniteOrPermanentValue(t *testing.T) {
	now := time.Date(2026, 10, 5, 12, 0, 0, 0, time.UTC)
	for _, tc := range []struct {
		name string
		raw  json.RawMessage
	}{
		{name: "omitted", raw: nil},
		{name: "null", raw: json.RawMessage("null")},
		{name: "negative", raw: json.RawMessage("-1")},
		{name: "too short", raw: json.RawMessage("59")},
		{name: "too long", raw: json.RawMessage("2678401")},
		{name: "string", raw: json.RawMessage(`"3600"`)},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, err := telemetryCredentialExpiry(tc.raw, now)
			if err == nil || got != nil {
				t.Fatalf("expected invalid expiry, got %v, %v", got, err)
			}
		})
	}

	permanent, err := telemetryCredentialExpiry(json.RawMessage("0"), now)
	if err != nil || permanent != nil {
		t.Fatalf("explicit zero must be permanent: %v, %v", permanent, err)
	}
	finite, err := telemetryCredentialExpiry(json.RawMessage("3600"), now)
	if err != nil || finite == nil || !finite.Equal(now.Add(time.Hour)) {
		t.Fatalf("finite expiry not preserved: %v, %v", finite, err)
	}
}
func TestUserTelemetryAuthenticationBudgetBoundsBeforeDatabase(t *testing.T) {
	g := newTelemetryAuthGuard()
	g.limiter = rate.NewLimiter(rate.Inf, 40)
	for range 16 {
		if !g.begin() {
			t.Fatal("budget rejected below limit")
		}
	}
	if g.begin() {
		t.Fatal("auth in-flight work not bounded")
	}
	if g.inFlight.Load() != 16 {
		t.Fatal("overload leaked a slot")
	}
	g.end()
	if !g.begin() {
		t.Fatal("slot release not reusable")
	}
	for range 16 {
		g.end()
	}
	if g.inFlight.Load() != 0 {
		t.Fatal("budget leaked slots")
	}
	g = newTelemetryAuthGuard()
	g.limiter = rate.NewLimiter(0, 2)
	for range 2 {
		if !g.begin() {
			t.Fatal("rate burst rejected")
		}
		g.end()
	}
	if g.begin() {
		t.Fatal("auth rate unbounded")
	}
}
func TestUserTelemetryCredentialListHasExplicitPage(t *testing.T) {
	cursor := "77"
	store := &telemetryCredentialStub{page: &service.UserTelemetryCredentialPage{Credentials: []service.UserTelemetryCredential{{ID: 78, UserIDs: []string{"42"}, TokenHash: []byte("not-visible"), ExpiresAt: nil}}, NextCursor: &cursor}}
	h := &PluginHandler{telemetryCredentials: store}
	w := telemetryTestRequest(h, "GET", "/plugins/1/user-telemetry?cursor=80&page_size=1", "", "", h.ListTelemetryCredentials)
	if w.Code != 200 || store.cursor != 80 || store.pageSize != 1 || !strings.Contains(w.Body.String(), `"next_cursor":"77"`) || !strings.Contains(w.Body.String(), `"expires_at":null`) || strings.Contains(w.Body.String(), "not-visible") {
		t.Fatalf("credential pagination failed: %d", w.Code)
	}
	for _, query := range []string{"cursor=01", "cursor=-1", "page_size=501", "page_size=0"} {
		w = telemetryTestRequest(h, "GET", "/plugins/1/user-telemetry?"+query, "", "", h.ListTelemetryCredentials)
		if w.Code != 400 {
			t.Fatalf("invalid credential page accepted: %s", query)
		}
	}
	if store.calls != 1 {
		t.Fatal("invalid page queried store")
	}
}

type telemetryRevokeFailureStore struct {
	telemetryCredentialStub
	err error
}

func (s *telemetryRevokeFailureStore) Revoke(context.Context, int64, int64) error { return s.err }
func TestUserTelemetryRevocationFailureIsExplicit(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, tc := range []struct {
		err    error
		status int
	}{{service.ErrTelemetryCredentialNotFound, 404}, {errors.New("database unavailable"), 503}} {
		h := &PluginHandler{telemetryCredentials: &telemetryRevokeFailureStore{err: tc.err}}
		r := gin.New()
		r.DELETE("/plugins/:id/credentials/:credential_id", h.RevokeTelemetryCredential)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequest("DELETE", "/plugins/1/credentials/7", nil))
		if w.Code != tc.status || w.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("revoke failure concealed: %d", w.Code)
		}
	}
}
