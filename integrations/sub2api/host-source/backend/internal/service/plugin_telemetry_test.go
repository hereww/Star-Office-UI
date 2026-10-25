package service

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	pluginv1 "github.com/Wei-Shaw/sub2api/pkg/pluginapi/v1"
	"github.com/Wei-Shaw/sub2api/pkg/usertelemetry"
	hcplugin "github.com/hashicorp/go-plugin"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/wrapperspb"
)

func telemetryTestManifest() PluginManifest {
	m := testPluginManifest(nil)
	m.Requires.TransportAPI = 0
	m.Requires.UserTelemetryAPI = 1
	m.Capabilities = []PluginCapability{{ID: PluginCapabilityUserTelemetryRead, Platform: "sub2api", AccountType: "user"}}
	return m
}
func TestPluginTelemetryManifestCapabilityAndAPIs(t *testing.T) {
	m := telemetryTestManifest()
	require.NoError(t, m.Validate())
	require.True(t, EvaluatePluginCompatibility(m, PluginHostInfo{Version: "0.1.179"}).Compatible)
	for _, mutate := range []func(*PluginManifest){
		func(m *PluginManifest) { m.Requires.UserTelemetryAPI = 2 },
		func(m *PluginManifest) { m.Requires.UserTelemetryAPI = 0 },
		func(m *PluginManifest) { m.Requires.TransportAPI = 99 },
		func(m *PluginManifest) { m.Capabilities[0].Platform = "openai" },
		func(m *PluginManifest) { m.Capabilities[0].AccountType = "oauth" },
		func(m *PluginManifest) { m.Capabilities[0].ID = "unknown.read.v1" },
		func(m *PluginManifest) {
			m.Capabilities = append(m.Capabilities, PluginCapability{ID: PluginCapabilityOpenAIOAuthOutbound, Platform: "openai", AccountType: "oauth"})
		},
	} {
		bad := telemetryTestManifest()
		mutate(&bad)
		require.Error(t, bad.Validate())
		require.False(t, EvaluatePluginCompatibility(bad, PluginHostInfo{Version: "0.1.179"}).Compatible)
	}
	transport := testPluginManifest(nil)
	require.NoError(t, transport.Validate())
	require.Equal(t, pluginv1.TransportPluginName, pluginRuntimeServiceName(transport))
	require.Equal(t, pluginv1.UserTelemetryPluginName, pluginRuntimeServiceName(m))
	require.True(t, pluginAccountScopeFromManifest(m).Empty())
}

type telemetryReaderFunc func(context.Context, json.RawMessage) (json.RawMessage, error)

func (f telemetryReaderFunc) ReadUserTelemetry(ctx context.Context, q json.RawMessage) (json.RawMessage, error) {
	return f(ctx, q)
}
func telemetryTestSnapshot(raw json.RawMessage) json.RawMessage {
	q, _ := usertelemetry.DecodeQuery(raw)
	users := []usertelemetry.User{}
	for _, id := range q.UserIDs {
		users = append(users, usertelemetry.User{UserID: id, Email: "reader@example.invalid", Username: "reader", APIKeys: []usertelemetry.APIKey{}})
	}
	out, _ := json.Marshal(usertelemetry.Snapshot{SchemaVersion: 1, Window: usertelemetry.Window{Start: q.Start, End: q.End, Timezone: q.Timezone}, Users: users})
	return out
}
func TestPluginTelemetryHostScopeAndSensitiveAPIs(t *testing.T) {
	called := 0
	host := &pluginHostServiceServer{telemetryOnly: true, telemetryScope: func(context.Context) ([]string, error) { return []string{"42"}, nil }, telemetryReader: telemetryReaderFunc(func(ctx context.Context, raw json.RawMessage) (json.RawMessage, error) {
		called++
		q, err := usertelemetry.DecodeQuery(raw)
		require.NoError(t, err)
		require.Equal(t, []string{"42"}, q.UserIDs)
		deadline, ok := ctx.Deadline()
		require.True(t, ok)
		require.LessOrEqual(t, time.Until(deadline), 5*time.Second)
		return telemetryTestSnapshot(raw), nil
	})}
	// KV is nil: read-only data access is independent of general-purpose storage.
	response, err := host.ReadUserTelemetry(context.Background(), wrapperspb.Bytes([]byte(`{}`)))
	require.NoError(t, err)
	require.NotEmpty(t, response.Value)
	require.Equal(t, 1, called)
	_, err = host.ReadUserTelemetry(context.Background(), wrapperspb.Bytes([]byte(`{"user_ids":["43"]}`)))
	require.Equal(t, codes.PermissionDenied, status.Code(err))
	require.Equal(t, 1, called)
	_, err = host.ReadUserTelemetry(context.Background(), wrapperspb.Bytes([]byte(`{"sql":"select secret"}`)))
	require.Equal(t, codes.InvalidArgument, status.Code(err))
	_, err = host.ListAccounts(context.Background(), &pluginv1.ListAccountsRequest{})
	require.Equal(t, codes.PermissionDenied, status.Code(err))
	_, err = host.ResolveOutboundIdentity(context.Background(), &pluginv1.ResolveOutboundIdentityRequest{AccountId: 1})
	require.Equal(t, codes.PermissionDenied, status.Code(err))
	host.telemetryReader = nil
	_, err = host.ReadUserTelemetry(context.Background(), wrapperspb.Bytes([]byte(`{}`)))
	require.Equal(t, codes.Unavailable, status.Code(err))
	_, err = (&pluginHostServiceServer{}).ReadUserTelemetry(context.Background(), wrapperspb.Bytes([]byte(`{}`)))
	require.Equal(t, codes.PermissionDenied, status.Code(err))
}
func TestPluginTelemetryConfigurationAndSnapshotWhitelist(t *testing.T) {
	for _, raw := range []string{`{}`, `{"allowed_user_ids":["01"]}`, `{"allowed_user_ids":["1","1"]}`, `{"allowed_user_ids":["1"],"token":"secret"}`, `{"allowed_user_ids":["1"],"page":501}`, `{"allowed_user_ids":["1"],"timezone":"unknown/invalid"}`, `{"allowed_user_ids":["1"]} {}`, `{"allowed_user_ids":["1"],"page":10,"page_size":10}`, `{"allowed_user_ids":["1"],"window":{"start":"x","end":"y"}}`, `{"allowed_user_ids":["1"],"page":10}`, `{"allowed_user_ids":["1"],"page_size":null}`, `{"allowed_user_ids":["1"],"allowed_user_ids":["2"]}`} {
		_, err := decodePluginTelemetryConfig([]byte(raw))
		require.Error(t, err, raw)
	}
	_, err := decodePluginTelemetryConfig([]byte(`{"allowed_user_ids":["1"],"page_size":100}`))
	require.NoError(t, err)
	q, _, _, err := (usertelemetry.Query{UserIDs: []string{"42"}}).Normalize(time.Now())
	require.NoError(t, err)
	raw, _ := json.Marshal(q)
	valid := telemetryTestSnapshot(raw)
	_, err = validatePluginTelemetrySnapshot(valid, q)
	require.NoError(t, err)
	var value map[string]any
	require.NoError(t, json.Unmarshal(valid, &value))
	value["password"] = "secret"
	bad, _ := json.Marshal(value)
	_, err = validatePluginTelemetrySnapshot(bad, q)
	require.Error(t, err)
	q.UserIDs = []string{"43"}
	_, err = validatePluginTelemetrySnapshot(valid, q)
	require.Error(t, err)
	_, err = validatePluginTelemetrySnapshot([]byte(strings.Repeat("x", pluginv1.UserTelemetryMaxResponseBytes+1)), q)
	require.Error(t, err)
}

// The test executable itself serves as two real go-plugin child processes.
// This validates Dispense, gRPC wire methods, broker dialing and kill/drain;
// no external binary, protoc, installation or production deployment is needed.
type nativeTelemetryTestServer struct {
	pluginv1.UnimplementedUserTelemetryPluginServer
	broker *hcplugin.GRPCBroker
	host   pluginv1.UserTelemetryHostServiceClient
}

func (s *nativeTelemetryTestServer) SetHostBroker(b *hcplugin.GRPCBroker) { s.broker = b }
func (s *nativeTelemetryTestServer) GetInfo(context.Context, *pluginv1.GetInfoRequest) (*pluginv1.GetInfoResponse, error) {
	return &pluginv1.GetInfoResponse{PluginId: "test.native", PluginVersion: "1.0.0", ProtocolVersion: 1, Capabilities: []string{pluginv1.UserTelemetryCapability}}, nil
}
func (s *nativeTelemetryTestServer) Health(context.Context, *pluginv1.HealthRequest) (*pluginv1.HealthResponse, error) {
	return &pluginv1.HealthResponse{Healthy: true}, nil
}
func (s *nativeTelemetryTestServer) ValidateConfig(_ context.Context, r *pluginv1.ValidateConfigRequest) (*pluginv1.ValidateConfigResponse, error) {
	raw := r.ConfigJson
	if os.Getenv("SUB2API_NATIVE_PLUGIN_TEST") == "widen" {
		raw = []byte(`{"allowed_user_ids":["43"]}`)
	}
	return &pluginv1.ValidateConfigResponse{Valid: true, NormalizedConfigJson: raw}, nil
}
func (s *nativeTelemetryTestServer) ApplyConfig(context.Context, *pluginv1.ApplyConfigRequest) (*pluginv1.ApplyConfigResponse, error) {
	return &pluginv1.ApplyConfigResponse{Applied: true}, nil
}
func (s *nativeTelemetryTestServer) InitHostServices(_ context.Context, r *pluginv1.InitHostServicesRequest) (*pluginv1.InitHostServicesResponse, error) {
	if os.Getenv("SUB2API_NATIVE_PLUGIN_TEST") == "decline" {
		return &pluginv1.InitHostServicesResponse{Ready: false}, nil
	}
	conn, err := s.broker.Dial(r.HostServiceId)
	if err != nil {
		return nil, err
	}
	s.host = pluginv1.NewUserTelemetryHostServiceClient(conn)
	return &pluginv1.InitHostServicesResponse{Ready: true}, nil
}
func (s *nativeTelemetryTestServer) QuerySnapshot(ctx context.Context, r *wrapperspb.BytesValue) (*wrapperspb.BytesValue, error) {
	if os.Getenv("SUB2API_NATIVE_PLUGIN_TEST") == "slow" {
		<-ctx.Done()
		return nil, ctx.Err()
	}
	if s.host == nil {
		return nil, status.Error(codes.FailedPrecondition, "uninitialized")
	}
	return s.host.ReadUserTelemetry(ctx, r)
}

type nativeTransportTestServer struct {
	pluginv1.UnimplementedTransportPluginServer
}

func (nativeTransportTestServer) GetInfo(context.Context, *pluginv1.GetInfoRequest) (*pluginv1.GetInfoResponse, error) {
	return &pluginv1.GetInfoResponse{PluginId: "test.native", PluginVersion: "1.0.0", ProtocolVersion: 1, TransportApiVersion: 1}, nil
}
func (nativeTransportTestServer) Health(context.Context, *pluginv1.HealthRequest) (*pluginv1.HealthResponse, error) {
	return &pluginv1.HealthResponse{Healthy: true}, nil
}
func TestPluginTelemetryNativeProcess(t *testing.T) {
	mode := os.Getenv("SUB2API_NATIVE_PLUGIN_TEST")
	if mode == "" {
		return
	}
	if mode == "transport" {
		pluginv1.Serve(nativeTransportTestServer{})
	} else {
		pluginv1.ServeUserTelemetry(&nativeTelemetryTestServer{})
	}
	os.Exit(0)
}
func nativeTelemetryTestInstallation(t *testing.T, mode string) *PluginInstallation {
	t.Helper()
	exe, err := os.Executable()
	require.NoError(t, err)
	root := t.TempDir()
	path := filepath.Join(root, "plugin.sh")
	script := []byte(fmt.Sprintf("#!/bin/sh\nexport SUB2API_NATIVE_PLUGIN_TEST='%s'\nexec '%s' -test.run='^TestPluginTelemetryNativeProcess$'\n", mode, strings.ReplaceAll(exe, "'", "'\\''")))
	require.NoError(t, os.WriteFile(path, script, 0700))
	sum := sha256.Sum256(script)
	m := telemetryTestManifest()
	if mode == "transport" {
		m = testPluginManifest(nil)
	}
	return &PluginInstallation{ID: 42, PluginKey: "test.native", Version: "1.0.0", BinaryPath: path, BinarySHA256: hex.EncodeToString(sum[:]), Manifest: m, State: PluginStateEnabled, ConfigEncrypted: `ENC:{"allowed_user_ids":["42"]}`, Bindings: []PluginBinding{{Capability: m.Capabilities[0].ID, Platform: m.Capabilities[0].Platform, AccountType: m.Capabilities[0].AccountType, Enabled: true, RolloutPercent: 100}}}
}
func nativeTelemetryTestHost() *pluginHostServiceServer {
	return &pluginHostServiceServer{telemetryOnly: true, telemetryScope: func(context.Context) ([]string, error) { return []string{"42"}, nil }, telemetryReader: telemetryReaderFunc(func(_ context.Context, raw json.RawMessage) (json.RawMessage, error) {
		return telemetryTestSnapshot(raw), nil
	})}
}
func TestPluginTelemetryNativeRuntimeDispatchAndRouteIsolation(t *testing.T) {
	transportI := nativeTelemetryTestInstallation(t, "transport")
	transport, err := startPluginRuntime(context.Background(), transportI, 5*time.Second, "", nil)
	require.NoError(t, err)
	defer transport.kill()
	telemetryI := nativeTelemetryTestInstallation(t, "telemetry")
	telemetry, err := startPluginRuntime(context.Background(), telemetryI, 5*time.Second, "", nativeTelemetryTestHost())
	require.NoError(t, err)
	defer telemetry.kill()
	require.NotNil(t, transport.api)
	require.Nil(t, transport.telemetry)
	require.Nil(t, telemetry.api)
	require.NotNil(t, telemetry.telemetry)
	require.True(t, telemetry.hostReady)
	require.NoError(t, telemetry.validateAndApplyConfig(context.Background(), []byte(`{"allowed_user_ids":["42"]}`)))
	q, _, _, err := (usertelemetry.Query{UserIDs: []string{"42"}}).Normalize(time.Now())
	require.NoError(t, err)
	raw, _ := json.Marshal(q)
	response, err := telemetry.telemetry.QuerySnapshot(context.Background(), wrapperspb.Bytes(raw))
	require.NoError(t, err)
	_, err = validatePluginTelemetrySnapshot(response.Value, q)
	require.NoError(t, err)
	manager := &PluginManager{runtimes: map[int64]*pluginRuntime{}}
	transportI.ID = 1
	manager.publishRuntimeLocked(transportI, transport)
	route := manager.route.Load()
	manager.publishRuntimeLocked(telemetryI, telemetry)
	require.Same(t, route, manager.route.Load())
	require.Len(t, manager.runtimes, 2)
	manager.removeRuntimeLocked(42)
	require.Same(t, route, manager.route.Load())
	manager.publishRuntimeLocked(telemetryI, telemetry)
	// Transport-only outage must not remove a telemetry runtime.
	manager.publishUnavailableRoute(1, 100, "transport outage")
	require.Same(t, telemetry, manager.runtimes[42])
}
func TestPluginTelemetryNativeRuntimeRequiresInitialization(t *testing.T) {
	i := nativeTelemetryTestInstallation(t, "telemetry")
	runtime, err := startPluginRuntime(context.Background(), i, 5*time.Second, "", nil)
	require.Error(t, err)
	require.Nil(t, runtime)
	i = nativeTelemetryTestInstallation(t, "decline")
	runtime, err = startPluginRuntime(context.Background(), i, 5*time.Second, "", nativeTelemetryTestHost())
	require.Error(t, err)
	require.Nil(t, runtime)
	i = nativeTelemetryTestInstallation(t, "widen")
	runtime, err = startPluginRuntime(context.Background(), i, 5*time.Second, "", nativeTelemetryTestHost())
	require.NoError(t, err)
	defer runtime.kill()
	err = runtime.validateAndApplyConfig(context.Background(), []byte(`{"allowed_user_ids":["42"]}`))
	require.ErrorContains(t, err, "不得修改")
}
func TestPluginTelemetryManagerPersistedScopeAndCancellation(t *testing.T) {
	i := nativeTelemetryTestInstallation(t, "slow")
	runtime, err := startPluginRuntime(context.Background(), i, 5*time.Second, "", nativeTelemetryTestHost())
	require.NoError(t, err)
	defer runtime.kill()
	repo := &pluginTokenRepository{installation: i}
	manager := &PluginManager{repo: repo, encryptor: pluginTokenEncryptor{}, runtimes: map[int64]*pluginRuntime{42: runtime}}
	allowed, err := manager.GetTelemetryAllowedUsers(context.Background(), 42)
	require.NoError(t, err)
	require.Equal(t, []string{"42"}, allowed)
	_, err = manager.UserTelemetry(context.Background(), 42, []byte(`{"user_ids":["43"]}`))
	require.Error(t, err)
	result := make(chan error, 1)
	go func() { _, err := manager.UserTelemetry(context.Background(), 42, []byte(`{}`)); result <- err }()
	deadline := time.Now().Add(time.Second)
	for runtime.inFlight.Load() == 0 && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	require.Equal(t, int64(1), runtime.inFlight.Load())
	started := time.Now()
	drained := make(chan struct{})
	go func() { runtime.drain(time.Second); close(drained) }()
	select {
	case err := <-result:
		require.Error(t, err)
		require.Less(t, time.Since(started), time.Second)
	case <-time.After(time.Second):
		t.Fatal("telemetry query did not cancel promptly")
	}
	// A race-instrumented child adds its own exit delay; do not confuse process
	// termination with whether the in-flight read is canceled immediately.
	select {
	case <-drained:
	case <-time.After(3 * time.Second):
		t.Fatal("runtime drain did not terminate child")
	}
	i.State = PluginStateDisabled
	_, err = manager.GetTelemetryAllowedUsers(context.Background(), 42)
	require.Error(t, err)
}

type telemetryLifecycleRepository struct {
	PluginRepository
	mu            sync.Mutex
	installations map[int64]*PluginInstallation
	listErr       error
}

func cloneTelemetryInstallation(i *PluginInstallation) *PluginInstallation {
	if i == nil {
		return nil
	}
	out := *i
	out.Bindings = append([]PluginBinding(nil), i.Bindings...)
	return &out
}
func (r *telemetryLifecycleRepository) GetByID(_ context.Context, id int64) (*PluginInstallation, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	i := r.installations[id]
	if i == nil {
		return nil, sql.ErrNoRows
	}
	return cloneTelemetryInstallation(i), nil
}
func (r *telemetryLifecycleRepository) List(context.Context) ([]*PluginInstallation, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.listErr != nil {
		return nil, r.listErr
	}
	out := []*PluginInstallation{}
	for _, i := range r.installations {
		out = append(out, cloneTelemetryInstallation(i))
	}
	return out, nil
}
func (r *telemetryLifecycleRepository) UpdateConfig(_ context.Context, id int64, encrypted, sha string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	i := r.installations[id]
	if i == nil || i.BinarySHA256 != sha {
		return ErrPluginStateChanged
	}
	i.ConfigEncrypted = encrypted
	return nil
}
func (r *telemetryLifecycleRepository) BeginEnable(_ context.Context, id int64, sha, expected string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	i := r.installations[id]
	if i == nil || i.State != expected || i.BinarySHA256 != sha {
		return ErrPluginStateChanged
	}
	i.State = PluginStateStarting
	i.UpdatedAt = time.Now()
	return nil
}
func (r *telemetryLifecycleRepository) UpdateState(_ context.Context, id int64, state, message string, _ *time.Time, sha, expected string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	i := r.installations[id]
	if i == nil || i.BinarySHA256 != sha || (expected != "" && i.State != expected) {
		return ErrPluginStateChanged
	}
	i.State = state
	i.LastError = message
	return nil
}
func (r *telemetryLifecycleRepository) UpdateBindingsAndState(_ context.Context, id int64, bindings []PluginBinding, state, message string, at *time.Time, expected, sha string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	i := r.installations[id]
	if i == nil || i.BinarySHA256 != sha || (expected != "" && i.State != expected) {
		return ErrPluginStateChanged
	}
	i.Bindings = append([]PluginBinding(nil), bindings...)
	i.State = state
	i.LastError = message
	i.EnabledAt = at
	return nil
}
func (r *telemetryLifecycleRepository) MarkRuntimeHealthy(_ context.Context, id int64, sha, encrypted string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	i := r.installations[id]
	if i == nil || i.BinarySHA256 != sha || i.ConfigEncrypted != encrypted {
		return ErrPluginStateChanged
	}
	i.State = PluginStateEnabled
	i.LastError = ""
	return nil
}
func (r *telemetryLifecycleRepository) Delete(_ context.Context, id int64, sha string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	i := r.installations[id]
	if i == nil || i.BinarySHA256 != sha {
		return ErrPluginStateChanged
	}
	delete(r.installations, id)
	return nil
}
func (r *telemetryLifecycleRepository) setState(id int64, state string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.installations[id].State = state
}
func nativeManagerTestInstallation(t *testing.T, root, mode string, id int64) *PluginInstallation {
	t.Helper()
	i := nativeTelemetryTestInstallation(t, mode)
	i.ID = id
	i.State = PluginStateDisabled
	i.ConfigEncrypted = ""
	path := filepath.Join(root, fmt.Sprint(id), "bin", "plugin")
	require.NoError(t, os.MkdirAll(filepath.Dir(path), 0700))
	raw, err := os.ReadFile(i.BinaryPath)
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(path, raw, 0700))
	i.InstallPath = filepath.Join(root, fmt.Sprint(id))
	i.BinaryPath = path
	for key := range i.Manifest.Runtimes {
		i.Manifest.Runtimes[key] = PluginRuntime{Path: "bin/plugin"}
	}
	i.Manifest.Files["bin/plugin"] = i.BinarySHA256
	for idx := range i.Bindings {
		i.Bindings[idx].Enabled = false
	}
	return i
}
func TestPluginTelemetryManagerFirstConfigEnableReconcileDisableUninstall(t *testing.T) {
	root, err := os.MkdirTemp("/tmp", "ut-lifecycle-")
	require.NoError(t, err)
	t.Cleanup(func() { _ = os.RemoveAll(root) })
	i := nativeManagerTestInstallation(t, root, "telemetry", 42)
	repo := &telemetryLifecycleRepository{installations: map[int64]*PluginInstallation{42: i}}
	manager := NewPluginManager(repo, pluginTokenEncryptor{}, testPluginConfig(root, true), PluginHostInfo{Version: "0.1.179"}, nil)
	reads := atomic.Int64{}
	manager.SetUserTelemetryReader(telemetryReaderFunc(func(_ context.Context, raw json.RawMessage) (json.RawMessage, error) {
		reads.Add(1)
		return telemetryTestSnapshot(raw), nil
	}))
	// SaveConfig boots a temporary runtime before the first configuration exists.
	saved, err := manager.SaveConfig(context.Background(), 42, []byte(`{"allowed_user_ids":["42"],"timezone":"UTC","page_size":10}`))
	require.NoError(t, err)
	require.NotEmpty(t, saved)
	require.Zero(t, reads.Load())
	_, err = manager.UserTelemetry(context.Background(), 42, []byte(`{}`))
	require.Error(t, err)
	installation, err := manager.Enable(context.Background(), 42, false, 100)
	require.NoError(t, err)
	require.True(t, installation.RuntimeHealthy)
	require.Nil(t, manager.route.Load()) // not a zero-percent transport route
	data, err := manager.UserTelemetry(context.Background(), 42, []byte(`{}`))
	require.NoError(t, err)
	require.NotEmpty(t, data)
	var snapshot usertelemetry.Snapshot
	require.NoError(t, json.Unmarshal(data, &snapshot))
	require.Equal(t, "UTC", snapshot.Window.Timezone)
	require.Equal(t, int64(1), reads.Load())
	// Live scope narrowing is observed by the already running broker server.
	host := manager.buildHostServices(installation).(*pluginHostServiceServer)
	_, err = manager.SaveConfig(context.Background(), 42, []byte(`{"allowed_user_ids":["43"]}`))
	require.NoError(t, err)
	_, err = host.ReadUserTelemetry(context.Background(), wrapperspb.Bytes([]byte(`{"user_ids":["42"]}`)))
	require.Equal(t, codes.PermissionDenied, status.Code(err))
	data, err = manager.UserTelemetry(context.Background(), 42, []byte(`{}`))
	require.NoError(t, err)
	require.Contains(t, string(data), `"user_id":"43"`)
	// A restart/reconcile restores telemetry without an OAuth binding.
	manager.Stop()
	require.NoError(t, manager.reconcileOnce(context.Background()))
	require.NotNil(t, manager.runtimes[42])
	require.Nil(t, manager.route.Load())
	data, err = manager.UserTelemetry(context.Background(), 42, []byte(`{}`))
	require.NoError(t, err)
	// Failed process is replaced on reconcile without creating an outbound route.
	manager.runtimes[42].kill()
	require.NoError(t, manager.reconcileOnce(context.Background()))
	require.NotNil(t, manager.runtimes[42])
	require.Nil(t, manager.route.Load())
	_, err = manager.Disable(context.Background(), 42)
	require.NoError(t, err)
	require.Empty(t, manager.runtimes)
	_, err = manager.UserTelemetry(context.Background(), 42, []byte(`{}`))
	require.Error(t, err)
	_, err = host.ReadUserTelemetry(context.Background(), wrapperspb.Bytes([]byte(`{}`)))
	require.Equal(t, codes.PermissionDenied, status.Code(err))
	require.NoError(t, manager.Delete(context.Background(), 42))
	require.NoDirExists(t, i.InstallPath)
}

func (nativeTransportTestServer) ValidateConfig(_ context.Context, req *pluginv1.ValidateConfigRequest) (*pluginv1.ValidateConfigResponse, error) {
	return &pluginv1.ValidateConfigResponse{Valid: true, NormalizedConfigJson: req.ConfigJson}, nil
}
func (nativeTransportTestServer) ApplyConfig(context.Context, *pluginv1.ApplyConfigRequest) (*pluginv1.ApplyConfigResponse, error) {
	return &pluginv1.ApplyConfigResponse{Applied: true}, nil
}
func TestPluginTelemetryReconcileTransportCoexistenceAndPendingStates(t *testing.T) {
	root, err := os.MkdirTemp("/tmp", "ut-coexist-")
	require.NoError(t, err)
	t.Cleanup(func() { _ = os.RemoveAll(root) })
	telemetryI := nativeManagerTestInstallation(t, root, "telemetry", 42)
	transportI := nativeManagerTestInstallation(t, root, "transport", 1)
	telemetryI.State = PluginStateEnabled
	telemetryI.ConfigEncrypted = `ENC:{"allowed_user_ids":["42"]}`
	telemetryI.Bindings[0].Enabled = true
	transportI.State = PluginStateEnabled
	transportI.ConfigEncrypted = `ENC:{}`
	transportI.Bindings[0].Enabled = true
	repo := &telemetryLifecycleRepository{installations: map[int64]*PluginInstallation{42: telemetryI, 1: transportI}}
	manager := NewPluginManager(repo, pluginTokenEncryptor{}, testPluginConfig(root, true), PluginHostInfo{Version: "0.1.179"}, nil)
	manager.SetUserTelemetryReader(telemetryReaderFunc(func(_ context.Context, raw json.RawMessage) (json.RawMessage, error) {
		return telemetryTestSnapshot(raw), nil
	}))
	defer manager.Stop()
	require.NoError(t, manager.reconcileOnce(context.Background()))
	require.Len(t, manager.runtimes, 2)
	route := manager.route.Load()
	require.NotNil(t, route)
	require.Equal(t, int64(1), route.pluginID)
	telemetryRuntime := manager.runtimes[42]
	// Changing transport rollout only replaces transport, not the independent reader.
	repo.mu.Lock()
	repo.installations[1].Bindings[0].RolloutPercent = 20
	repo.mu.Unlock()
	require.NoError(t, manager.reconcileOnce(context.Background()))
	require.Same(t, telemetryRuntime, manager.runtimes[42])
	require.Equal(t, 20, manager.route.Load().rolloutPercent)
	// Disabling transport leaves telemetry available and removes route completely.
	_, err = manager.Disable(context.Background(), 1)
	require.NoError(t, err)
	require.NoError(t, manager.reconcileOnce(context.Background()))
	require.Nil(t, manager.route.Load())
	require.Same(t, telemetryRuntime, manager.runtimes[42])
	_, err = manager.UserTelemetry(context.Background(), 42, []byte(`{}`))
	require.NoError(t, err)
	// Re-enable transport while telemetry is already running.
	_, err = manager.Enable(context.Background(), 1, false, 100)
	require.NoError(t, err)
	require.Same(t, telemetryRuntime, manager.runtimes[42])
	// Pending telemetry must have no local data channel, even with transport active.
	repo.setState(42, PluginStateStarting)
	require.NoError(t, manager.reconcileOnce(context.Background()))
	require.Nil(t, manager.runtimes[42])
	require.NotNil(t, manager.route.Load().runtime)
	_, err = manager.UserTelemetry(context.Background(), 42, []byte(`{}`))
	require.Error(t, err)
	repo.mu.Lock()
	repo.installations[42].UpdatedAt = time.Now().Add(-2 * time.Minute)
	repo.mu.Unlock()
	require.NoError(t, manager.reconcileOnce(context.Background()))
	i, err := repo.GetByID(context.Background(), 42)
	require.NoError(t, err)
	require.Equal(t, PluginStateDisabled, i.State)
	// Failed telemetry with a desired enabled binding recovers independently.
	repo.setState(42, PluginStateError)
	require.NoError(t, manager.reconcileOnce(context.Background()))
	require.NotNil(t, manager.runtimes[42])
	require.Equal(t, int64(1), manager.route.Load().pluginID)
	repo.mu.Lock()
	repo.listErr = fmt.Errorf("temporary database outage")
	repo.mu.Unlock()
	require.Error(t, manager.reconcileOnce(context.Background()))
	require.Nil(t, manager.runtimes[42])
	require.Nil(t, manager.route.Load().runtime)
	repo.mu.Lock()
	repo.listErr = nil
	repo.mu.Unlock()
	require.NoError(t, manager.reconcileOnce(context.Background()))
	require.Len(t, manager.runtimes, 2)
	require.Equal(t, int64(1), manager.route.Load().pluginID)
}
