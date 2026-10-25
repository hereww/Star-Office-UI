package telemetry

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	public "github.com/Wei-Shaw/sub2api/pkg/usertelemetry"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type sourceFunc func(context.Context, public.Query) ([]byte, error)

func (f sourceFunc) Read(ctx context.Context, q public.Query) ([]byte, error) { return f(ctx, q) }
func snapshot(q public.Query) []byte {
	s := public.Snapshot{SchemaVersion: 1, Window: public.Window{Start: q.Start, End: q.End, Timezone: q.Timezone}, Users: []public.User{{UserID: q.UserIDs[0], Email: "fake@example.test", Username: "", APIKeys: []public.APIKey{{ID: "9223372036854775807", Name: "fake metadata", Status: "active"}}}}}
	b, _ := json.Marshal(s)
	return b
}
func runtime(t *testing.T, src Source) *Runtime {
	t.Helper()
	r := New()
	if err := r.Apply(context.Background(), []byte(`{"allowed_user_ids":["42","43"],"page_size":2}`)); err != nil {
		t.Fatal(err)
	}
	r.SetServerReady(true)
	r.SetHost(src)
	return r
}
func TestConfigStrictAndDefaults(t *testing.T) {
	c, b, err := ParseConfig([]byte(`{}`))
	if err != nil || c.Timezone != "Asia/Shanghai" || len(c.AllowedUserIDs) != 0 || c.PageSize != 100 {
		t.Fatalf("defaults: %s %v", b, err)
	}
	invalid := []string{`null`, `[]`, ``, `{} {}`, `{"allowed_user_ids":null}`, `{"allowed_user_ids":[42]}`, `{"allowed_user_ids":["01"]}`, `{"allowed_user_ids":["+1"]}`, `{"allowed_user_ids":["0"]}`, `{"allowed_user_ids":["-1"]}`, `{"allowed_user_ids":["9223372036854775808"]}`, `{"allowed_user_ids":["1","1"]}`, `{"timezone":"Not/AZone"}`, `{"page_size":0}`, `{"page_size":-1}`, `{"page_size":501}`, `{"page_size":1.5}`, `{"timezone":null}`, `{"timezone":"UTC","timezone":"Asia/Shanghai"}`, `{"admin_token":"SECRET"}`, `{"api_key":"SECRET"}`, `{"oauth_identity":{}}`, `{"database_url":"SECRET"}`, `{"nested":{"token":"SECRET"}}`}
	for _, raw := range invalid {
		t.Run(raw, func(t *testing.T) {
			_, _, err := ParseConfig([]byte(raw))
			if err == nil {
				t.Fatal("invalid config accepted")
			}
			if strings.Contains(err.Error(), "SECRET") {
				t.Fatal("error leaks input")
			}
		})
	}
	ids := make([]string, 501)
	for i := range ids {
		ids[i] = fmt.Sprint(i + 1)
	}
	b, _ = json.Marshal(Config{AllowedUserIDs: ids, PageSize: 100})
	if _, _, err := ParseConfig(b); err == nil {
		t.Fatal("501 IDs accepted")
	}
	ids = ids[:500]
	b, _ = json.Marshal(Config{AllowedUserIDs: ids, PageSize: 100})
	if _, _, err := ParseConfig(b); err != nil {
		t.Fatal(err)
	}
}
func TestScopeAndNormalization(t *testing.T) {
	c, _, _ := ParseConfig([]byte(`{"allowed_user_ids":["42","43"],"timezone":"UTC","page_size":2}`))
	now := time.Date(2026, 10, 4, 12, 0, 0, 0, time.UTC)
	q, err := PrepareQuery([]byte(`{}`), c, now)
	if err != nil || len(q.UserIDs) != 2 || q.Timezone != "UTC" || q.Start != "2026-10-04T00:00:00Z" || q.End != "2026-10-04T12:00:00Z" || q.PageSize != 2 {
		t.Fatalf("query: %+v %v", q, err)
	}
	invalid := []string{`{"user_ids":["44"]}`, `{"user_ids":["42","42"]}`, `{"user_ids":["042"]}`, `{"user_ids":[42]}`, `{"cursor":"00"}`, `{"page_size":501}`, `{"start":"2026-10-04T00:00:00Z"}`, `{"start":"2026-01-01T00:00:00Z","end":"2026-10-04T01:00:00Z"}`, `{"start":"2026-10-04T12:00:00Z","end":"2026-10-05T00:00:00Z"}`, `{"timezone":"bad"}`, `{"token":"SECRET"}`, `{"user_ids":null}`, `{} []`, `{"cursor":"1","cursor":"2"}`}
	for _, raw := range invalid {
		t.Run(raw, func(t *testing.T) {
			if _, err := PrepareQuery([]byte(raw), c, now); err == nil {
				t.Fatal("invalid query accepted")
			}
		})
	}
	c.AllowedUserIDs = nil
	if _, err := PrepareQuery([]byte(`{}`), c, now); err == nil {
		t.Fatal("empty scope accepted")
	}
}
func TestReadinessAndAtomicApply(t *testing.T) {
	r := New()
	ctx := context.Background()
	for _, stage := range []func(){func() {}, func() { r.SetServerReady(true) }, func() {
		r.SetHost(sourceFunc(func(_ context.Context, q public.Query) ([]byte, error) { return snapshot(q), nil }))
	}} {
		stage()
		if r.Summary().Ready {
			t.Fatal("empty scope ready")
		}
		if _, err := r.Query(ctx, []byte(`{}`)); status.Code(err) != codes.FailedPrecondition {
			t.Fatalf("not ready: %v", err)
		}
	}
	if err := r.Apply(ctx, []byte(`{"allowed_user_ids":["42"]}`)); err != nil {
		t.Fatal(err)
	}
	if !r.Summary().Ready {
		t.Fatal("configured initialized server not ready")
	}
	if err := r.Apply(ctx, []byte(`{"allowed_user_ids":["43"],"api_key":"SECRET"}`)); err == nil {
		t.Fatal("unknown field accepted")
	}
	if _, err := r.Query(ctx, []byte(`{"user_ids":["42"]}`)); err != nil {
		t.Fatal("previous config not retained", err)
	}
	if _, err := r.Query(ctx, []byte(`{"user_ids":["43"]}`)); status.Code(err) != codes.InvalidArgument {
		t.Fatal("failed Apply mutated scope", err)
	}
	canceled, cancel := context.WithCancel(ctx)
	cancel()
	if err := r.Apply(canceled, []byte(`{}`)); status.Code(err) != codes.Canceled {
		t.Fatal(err)
	}
	if err := r.Apply(ctx, []byte(`{}`)); err != nil || r.Summary().Ready || r.Summary().Configured {
		t.Fatal("scope revocation failed", err)
	}
}
func TestPayloadFilter(t *testing.T) {
	c, _, _ := ParseConfig([]byte(`{"allowed_user_ids":["42"]}`))
	q, _ := PrepareQuery([]byte(`{}`), c, time.Now())
	var obj map[string]any
	_ = json.Unmarshal(snapshot(q), &obj)
	obj["admin_token"] = "SECRET_TOP"
	user := obj["users"].([]any)[0].(map[string]any)
	user["password"] = "SECRET_USER"
	key := user["api_keys"].([]any)[0].(map[string]any)
	key["key"] = "SECRET_KEY"
	user["token_usage"].(map[string]any)["oauth_token"] = "SECRET_NESTED"
	raw, _ := json.Marshal(obj)
	out, err := FilterSnapshot(raw, q)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(out), "SECRET") || strings.Contains(string(out), "password") {
		t.Fatal("secret fields escaped DTO")
	}
	if !strings.Contains(string(out), `"total":null`) || !strings.Contains(string(out), `"current":null`) || !strings.Contains(string(out), `"username":""`) {
		t.Fatal("unknown data or empty username altered")
	}
	bad := []struct {
		name   string
		change func(map[string]any)
		code   codes.Code
	}{
		{"schema", func(o map[string]any) { o["schema_version"] = 2 }, codes.DataLoss},
		{"window", func(o map[string]any) { o["window"].(map[string]any)["timezone"] = "UTC" }, codes.DataLoss},
		{"scope", func(o map[string]any) { o["users"].([]any)[0].(map[string]any)["user_id"] = "43" }, codes.PermissionDenied},
		{"duplicate", func(o map[string]any) { u := o["users"].([]any); o["users"] = append(u, u[0]) }, codes.PermissionDenied},
		{"cursor", func(o map[string]any) { o["next_cursor"] = "43" }, codes.DataLoss},
		{"key", func(o map[string]any) {
			o["users"].([]any)[0].(map[string]any)["api_keys"].([]any)[0].(map[string]any)["id"] = "01"
		}, codes.DataLoss},
	}
	for _, tc := range bad {
		t.Run(tc.name, func(t *testing.T) {
			var o map[string]any
			_ = json.Unmarshal(snapshot(q), &o)
			tc.change(o)
			b, _ := json.Marshal(o)
			if _, err := FilterSnapshot(b, q); status.Code(err) != tc.code {
				t.Fatalf("expected %v got %v", tc.code, err)
			}
		})
	}
	for _, raw := range []string{`null`, `[]`, `{}`, `{} {}`, `{"schema_version":1`, strings.Repeat("x", MaxResponseBytes+1)} {
		if _, err := FilterSnapshot([]byte(raw), q); err == nil {
			t.Fatal("invalid payload accepted")
		}
	}
	// Escaping control characters expands JSON on re-encoding; enforce the bound
	// on the public DTO too, even when the original payload is under the limit.
	var o map[string]any
	_ = json.Unmarshal(snapshot(q), &o)
	o["users"].([]any)[0].(map[string]any)["email"] = strings.Repeat("<", MaxResponseBytes/2)
	raw, _ = json.Marshal(o)
	raw = []byte(strings.ReplaceAll(string(raw), `\u003c`, "<"))
	if len(raw) > MaxResponseBytes {
		t.Fatal("fixture too large")
	}
	if _, err := FilterSnapshot(raw, q); status.Code(err) != codes.ResourceExhausted {
		t.Fatal("output bound not enforced", err)
	}
}
func TestCancellationDeadlineAndSanitizedErrors(t *testing.T) {
	entered := make(chan context.Context, 1)
	r := runtime(t, sourceFunc(func(ctx context.Context, _ public.Query) ([]byte, error) {
		entered <- ctx
		<-ctx.Done()
		return nil, ctx.Err()
	}))
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { _, err := r.Query(ctx, []byte(`{}`)); done <- err }()
	received := <-entered
	deadline, ok := received.Deadline()
	if !ok || time.Until(deadline) > RequestTimeout || time.Until(deadline) < 4*time.Second {
		t.Fatal("missing 5 second bound")
	}
	cancel()
	if err := <-done; status.Code(err) != codes.Canceled {
		t.Fatal(err)
	}
	ctx, cancel = context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	if _, err := r.Query(ctx, []byte(`{}`)); status.Code(err) != codes.DeadlineExceeded {
		t.Fatal(err)
	}
	r.SetHost(sourceFunc(func(context.Context, public.Query) ([]byte, error) {
		return nil, status.Error(codes.PermissionDenied, "SECRET fake@example.test")
	}))
	if _, err := r.Query(context.Background(), []byte(`{}`)); status.Code(err) != codes.PermissionDenied || strings.Contains(err.Error(), "SECRET") {
		t.Fatal("host error leaked", err)
	}
}
func TestScopeChangeCancelsInflightEvenIfSourceIgnoresCancel(t *testing.T) {
	started, release := make(chan struct{}), make(chan struct{})
	r := runtime(t, sourceFunc(func(ctx context.Context, q public.Query) ([]byte, error) {
		close(started)
		<-release
		return snapshot(q), nil
	}))
	done := make(chan error, 1)
	go func() { _, err := r.Query(context.Background(), []byte(`{"user_ids":["42"]}`)); done <- err }()
	<-started
	if err := r.Apply(context.Background(), []byte(`{"allowed_user_ids":["43"]}`)); err != nil {
		t.Fatal(err)
	}
	close(release)
	if err := <-done; status.Code(err) != codes.FailedPrecondition {
		t.Fatal("stale scope escaped", err)
	}
}
func TestConcurrentQueryApplyAndInitialization(t *testing.T) {
	src := sourceFunc(func(_ context.Context, q public.Query) ([]byte, error) { return snapshot(q), nil })
	r := runtime(t, src)
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < 100; j++ {
				_, err := r.Query(context.Background(), []byte(`{"user_ids":["42"]}`))
				if err != nil && status.Code(err) != codes.Canceled && status.Code(err) != codes.FailedPrecondition {
					t.Error(err)
				}
				s := r.Summary()
				if !s.Configured {
					t.Error("scope unexpectedly lost")
				}
			}
		}()
	}
	wg.Add(1)
	go func() {
		defer wg.Done()
		for j := 0; j < 100; j++ {
			_ = r.Apply(context.Background(), []byte(`{"allowed_user_ids":["42","43"]}`))
			r.SetHost(nil)
			r.SetHost(src)
		}
	}()
	wg.Wait()
}
