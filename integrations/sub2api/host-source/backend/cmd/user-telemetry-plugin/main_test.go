package main

import (
	"context"
	"encoding/json"
	"io"
	"os"
	"os/exec"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	business "github.com/Wei-Shaw/sub2api/cmd/user-telemetry-plugin/internal/telemetry"
	pluginv1 "github.com/Wei-Shaw/sub2api/pkg/pluginapi/v1"
	public "github.com/Wei-Shaw/sub2api/pkg/usertelemetry"
	"github.com/hashicorp/go-hclog"
	hcplugin "github.com/hashicorp/go-plugin"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/wrapperspb"
)

// The subprocess is the real SDK server with the same executable entrypoint.
// It does not bypass the SDK magic-cookie check.
func TestPluginProcess(t *testing.T) {
	if os.Getenv("TELEMETRY_TEST_HELPER") != "1" {
		return
	}
	main()
	os.Exit(0)
}

type fakeHost struct {
	calls     atomic.Int64
	probeCode codes.Code
	readCode  codes.Code
}

func (h *fakeHost) ReadUserTelemetry(ctx context.Context, req *wrapperspb.BytesValue) (*wrapperspb.BytesValue, error) {
	h.calls.Add(1)
	if len(req.GetValue()) == 0 {
		return nil, status.Error(h.probeCode, "FAKE_PROBE_SECRET")
	}
	if h.readCode != codes.OK {
		return nil, status.Error(h.readCode, "FAKE_HOST_SECRET")
	}
	q, err := public.DecodeQuery(req.GetValue())
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "fake query invalid")
	}
	if deadline, ok := ctx.Deadline(); !ok || time.Until(deadline) > business.RequestTimeout {
		return nil, status.Error(codes.Internal, "fake source missing deadline")
	}
	s := public.Snapshot{SchemaVersion: 1, Window: public.Window{Start: q.Start, End: q.End, Timezone: q.Timezone}, Users: []public.User{{UserID: q.UserIDs[0], Email: "fake@example.test", APIKeys: []public.APIKey{{ID: "101", Name: "fake metadata", Status: "active"}}}}}
	raw, _ := json.Marshal(s)
	var obj map[string]any
	_ = json.Unmarshal(raw, &obj)
	obj["admin_token"] = "FAKE_SECRET"
	obj["users"].([]any)[0].(map[string]any)["password"] = "FAKE_SECRET"
	raw, _ = json.Marshal(obj)
	return wrapperspb.Bytes(raw), nil
}
func subprocess(t *testing.T) *pluginv1.UserTelemetryClient {
	t.Helper()
	cmd := exec.Command(os.Args[0], "-test.run=^TestPluginProcess$")
	cmd.Env = append(os.Environ(), "TELEMETRY_TEST_HELPER=1")
	client := hcplugin.NewClient(&hcplugin.ClientConfig{HandshakeConfig: pluginv1.HandshakeConfig, Plugins: pluginv1.ClientPluginMap(), Cmd: cmd, AllowedProtocols: []hcplugin.Protocol{hcplugin.ProtocolGRPC}, Logger: hclog.NewNullLogger(), SyncStdout: io.Discard, SyncStderr: io.Discard, StartTimeout: 5 * time.Second})
	t.Cleanup(client.Kill)
	rpc, err := client.Client()
	if err != nil {
		t.Fatal(err)
	}
	impl, err := rpc.Dispense(pluginv1.UserTelemetryPluginName)
	if err != nil {
		t.Fatal(err)
	}
	result, ok := impl.(*pluginv1.UserTelemetryClient)
	if !ok {
		t.Fatal("wrong independent protocol")
	}
	transport, err := rpc.Dispense(pluginv1.TransportPluginName)
	if err == nil {
		transportAPI, ok := transport.(*pluginv1.TransportClient)
		if !ok {
			t.Fatal("unexpected transport client type")
		}
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		if _, err := transportAPI.GetInfo(ctx, &pluginv1.GetInfoRequest{}); status.Code(err) != codes.Unimplemented {
			t.Fatal("transport service must not be registered", err)
		}
	}
	return result
}
func offerHost(t *testing.T, api *pluginv1.UserTelemetryClient, host *fakeHost) *pluginv1.InitHostServicesRequest {
	t.Helper()
	id := api.Broker.NextId()
	go api.Broker.AcceptAndServe(id, func(opts []grpc.ServerOption) *grpc.Server {
		s := grpc.NewServer(opts...)
		pluginv1.RegisterUserTelemetryHostServiceServer(s, host)
		return s
	})
	return &pluginv1.InitHostServicesRequest{HostServiceId: id, HostServiceApiVersion: pluginv1.HostServiceAPIVersion}
}
func TestReleaseVersionMatchesPackagedUI(t *testing.T) {
	if pluginVersion != "0.1.1" {
		t.Fatalf("unexpected plugin release version: %s", pluginVersion)
	}
	ui, err := os.ReadFile("ui/index.html")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(ui), "READ-ONLY TELEMETRY / "+pluginVersion) {
		t.Fatal("plugin runtime version and UI release label must match")
	}
}

func TestSDKBrokerLifecycleAndDTO(t *testing.T) {
	api := subprocess(t)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	info, err := api.GetInfo(ctx, &pluginv1.GetInfoRequest{})
	if err != nil {
		t.Fatal(err)
	}
	if info.PluginId != pluginID || info.PluginVersion != pluginVersion || info.ProtocolVersion != pluginv1.ProtocolVersion || info.TransportApiVersion != 0 || len(info.Capabilities) != 1 || info.Capabilities[0] != public.Capability {
		t.Fatalf("wrong independent identity: %+v", info)
	}
	health, err := api.Health(ctx, &pluginv1.HealthRequest{})
	if err != nil || !health.GetHealthy() || health.StatusJson != `{"ready":false,"configured":false}` {
		t.Fatalf("server readiness: %+v %v", health, err)
	}
	raw := []byte(`{"allowed_user_ids":["42"],"timezone":"UTC","page_size":1}`)
	validated, err := api.ValidateConfig(ctx, &pluginv1.ValidateConfigRequest{ConfigJson: raw})
	if err != nil || !validated.GetValid() {
		t.Fatalf("validation: %v %v", validated, err)
	}
	if _, err := api.ApplyConfig(ctx, &pluginv1.ApplyConfigRequest{ConfigJson: validated.NormalizedConfigJson}); err != nil {
		t.Fatal(err)
	}
	if _, err := api.QuerySnapshot(ctx, wrapperspb.Bytes([]byte(`{}`))); status.Code(err) != codes.FailedPrecondition {
		t.Fatal("query ready before initialization", err)
	}
	host := &fakeHost{probeCode: codes.InvalidArgument}
	req := offerHost(t, api, host)
	init, err := api.InitHostServices(ctx, req)
	if err != nil || !init.GetReady() {
		t.Fatalf("host initialization: %v %v", init, err)
	}
	if host.calls.Load() != 1 {
		t.Fatal("host capability not actually checked")
	}
	health, err = api.Health(ctx, &pluginv1.HealthRequest{})
	if err != nil || health.StatusJson != `{"ready":true,"configured":true}` {
		t.Fatal(health, err)
	}
	if host.calls.Load() != 1 {
		t.Fatal("Health performed a host read")
	}
	result, err := api.QuerySnapshot(ctx, wrapperspb.Bytes([]byte(`{}`)))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(result.Value), "FAKE_SECRET") || strings.Contains(string(result.Value), "password") {
		t.Fatal("host payload passed through")
	}
	if _, err := api.QuerySnapshot(ctx, wrapperspb.Bytes([]byte(`{"user_ids":["43"]}`))); status.Code(err) != codes.InvalidArgument {
		t.Fatal("scope escape", err)
	}
	tested, err := api.TestConfig(ctx, &pluginv1.TestConfigRequest{ConfigJson: raw})
	if err != nil || !tested.GetSuccess() || strings.Contains(tested.StatusJson, "email") {
		t.Fatal(tested, err)
	}
	// Reinitialization with an old host version invalidates the previous source.
	req.HostServiceApiVersion = 0
	if _, err := api.InitHostServices(ctx, req); status.Code(err) != codes.FailedPrecondition {
		t.Fatal("old host accepted", err)
	}
	if _, err := api.QuerySnapshot(ctx, wrapperspb.Bytes([]byte(`{}`))); status.Code(err) != codes.FailedPrecondition {
		t.Fatal("stale initialized source survived", err)
	}
}
func TestSDKCapabilityFailsClosed(t *testing.T) {
	api := subprocess(t)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	for _, code := range []codes.Code{codes.Unimplemented, codes.PermissionDenied, codes.Unavailable, codes.OK} {
		host := &fakeHost{probeCode: code}
		req := offerHost(t, api, host)
		if _, err := api.InitHostServices(ctx, req); status.Code(err) != codes.FailedPrecondition || strings.Contains(err.Error(), "FAKE_PROBE_SECRET") {
			t.Fatalf("unsupported host accepted/leaked: %v", err)
		}
	}
	host := &fakeHost{probeCode: codes.InvalidArgument, readCode: codes.PermissionDenied}
	if _, err := api.InitHostServices(ctx, offerHost(t, api, host)); err != nil {
		t.Fatal(err)
	}
	raw := []byte(`{"allowed_user_ids":["42"]}`)
	if _, err := api.ApplyConfig(ctx, &pluginv1.ApplyConfigRequest{ConfigJson: raw}); err != nil {
		t.Fatal(err)
	}
	if _, err := api.QuerySnapshot(ctx, wrapperspb.Bytes([]byte(`{}`))); status.Code(err) != codes.PermissionDenied || strings.Contains(err.Error(), "FAKE_HOST_SECRET") {
		t.Fatal("denied read escaped or leaked", err)
	}
	tested, err := api.TestConfig(ctx, &pluginv1.TestConfigRequest{ConfigJson: raw})
	if err != nil || tested.GetSuccess() {
		t.Fatal("failed read reported success", tested, err)
	}
}
func TestSDKInitUnconfigured(t *testing.T) {
	api := subprocess(t)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	host := &fakeHost{probeCode: codes.InvalidArgument}
	initialized, err := api.InitHostServices(ctx, offerHost(t, api, host))
	if err != nil || !initialized.GetReady() {
		t.Fatal("unconfigured broker initialization must succeed", initialized, err)
	}
	health, err := api.Health(ctx, &pluginv1.HealthRequest{})
	if err != nil || !health.GetHealthy() || health.StatusJson != `{"ready":false,"configured":false}` {
		t.Fatal(health, err)
	}
	if _, err := api.QuerySnapshot(ctx, wrapperspb.Bytes([]byte(`{}`))); status.Code(err) != codes.FailedPrecondition {
		t.Fatal("unconfigured query accepted", err)
	}
	raw := []byte(`{"allowed_user_ids":["42"]}`)
	if _, err := api.ApplyConfig(ctx, &pluginv1.ApplyConfigRequest{ConfigJson: raw}); err != nil {
		t.Fatal(err)
	}
	if _, err := api.QuerySnapshot(ctx, wrapperspb.Bytes([]byte(`{}`))); err != nil {
		t.Fatal("init-before-Apply not usable", err)
	}
}

func TestSDKConfigFailuresAndContexts(t *testing.T) {
	p := newPlugin()
	ctx := context.Background()
	for _, raw := range []string{`{"admin_token":"SECRET"}`, `{"allowed_user_ids":["01"]}`, `{} {}`} {
		valid, err := p.ValidateConfig(ctx, &pluginv1.ValidateConfigRequest{ConfigJson: []byte(raw)})
		if err != nil || valid.GetValid() {
			t.Fatal("invalid validation", valid, err)
		}
		if _, err := p.ApplyConfig(ctx, &pluginv1.ApplyConfigRequest{ConfigJson: []byte(raw)}); status.Code(err) != codes.InvalidArgument {
			t.Fatal("apply swallowed error", err)
		}
	}
	if _, err := p.InitHostServices(ctx, nil); status.Code(err) != codes.FailedPrecondition {
		t.Fatal("nil init accepted", err)
	}
	if _, err := p.QuerySnapshot(ctx, nil); status.Code(err) != codes.FailedPrecondition {
		t.Fatal(err)
	}
	canceled, cancel := context.WithCancel(ctx)
	cancel()
	if _, err := p.InitHostServices(canceled, &pluginv1.InitHostServicesRequest{}); status.Code(err) != codes.Canceled {
		t.Fatal("cancelled init", err)
	}
	if _, err := p.GetInfo(canceled, nil); status.Code(err) != codes.Canceled {
		t.Fatal(err)
	}
	if _, err := p.Health(canceled, nil); status.Code(err) != codes.Canceled {
		t.Fatal(err)
	}
	if _, err := p.ValidateConfig(canceled, nil); status.Code(err) != codes.Canceled {
		t.Fatal(err)
	}
	if _, err := p.TestConfig(canceled, nil); status.Code(err) != codes.Canceled {
		t.Fatal(err)
	}
}
func TestNoPluginHandshakeRejected(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestPluginProcess$")
	for _, env := range os.Environ() {
		if !strings.HasPrefix(env, pluginv1.HandshakeConfig.MagicCookieKey+"=") {
			cmd.Env = append(cmd.Env, env)
		}
	}
	cmd.Env = append(cmd.Env, "TELEMETRY_TEST_HELPER=1")
	out, err := cmd.CombinedOutput()
	if err == nil || ctx.Err() != nil {
		t.Fatalf("no-handshake execution must promptly refuse: %v %s", err, out)
	}
}
