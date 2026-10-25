// user-telemetry-plugin is an independent Sub2API native plugin. The SDK owns
// process handshake and private RPC transport; this executable has no HTTP API.
package main

import (
	"context"
	"encoding/json"
	"sync"
	_ "time/tzdata"

	business "github.com/Wei-Shaw/sub2api/cmd/user-telemetry-plugin/internal/telemetry"
	pluginv1 "github.com/Wei-Shaw/sub2api/pkg/pluginapi/v1"
	public "github.com/Wei-Shaw/sub2api/pkg/usertelemetry"
	hcplugin "github.com/hashicorp/go-plugin"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/wrapperspb"
	_ "time/tzdata"
)

const pluginID = "com.lvdong.user-telemetry"
const pluginVersion = "0.1.1"

type telemetryPlugin struct {
	runtime  *business.Runtime
	mu       sync.Mutex
	broker   *hcplugin.GRPCBroker
	conn     *grpc.ClientConn
	epoch    uint64
	initGate chan struct{}
}

var _ pluginv1.UserTelemetryPluginServer = (*telemetryPlugin)(nil)
var _ pluginv1.HostBrokerReceiver = (*telemetryPlugin)(nil)

func newPlugin() *telemetryPlugin {
	return &telemetryPlugin{runtime: business.New(), initGate: make(chan struct{}, 1)}
}
func main() { pluginv1.ServeUserTelemetry(newPlugin()) }

func (p *telemetryPlugin) SetHostBroker(broker *hcplugin.GRPCBroker) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.epoch++
	p.runtime.SetHost(nil)
	if p.conn != nil {
		_ = p.conn.Close()
		p.conn = nil
	}
	p.broker = broker
	p.runtime.SetServerReady(broker != nil)
}

func (p *telemetryPlugin) GetInfo(ctx context.Context, _ *pluginv1.GetInfoRequest) (*pluginv1.GetInfoResponse, error) {
	if err := ctx.Err(); err != nil {
		return nil, status.FromContextError(err).Err()
	}
	return &pluginv1.GetInfoResponse{PluginId: pluginID, PluginVersion: pluginVersion, ProtocolVersion: pluginv1.ProtocolVersion, Capabilities: []string{public.Capability}}, nil
}
func (p *telemetryPlugin) Health(ctx context.Context, _ *pluginv1.HealthRequest) (*pluginv1.HealthResponse, error) {
	if err := ctx.Err(); err != nil {
		return nil, status.FromContextError(err).Err()
	}
	b, err := json.Marshal(p.runtime.Summary())
	if err != nil {
		return nil, status.Error(codes.Internal, "cannot encode health summary")
	}
	return &pluginv1.HealthResponse{Healthy: p.runtime.ServerReady(), Message: "telemetry lifecycle status", StatusJson: string(b)}, nil
}
func (p *telemetryPlugin) ValidateConfig(ctx context.Context, req *pluginv1.ValidateConfigRequest) (*pluginv1.ValidateConfigResponse, error) {
	if err := ctx.Err(); err != nil {
		return nil, status.FromContextError(err).Err()
	}
	_, normalized, err := business.ParseConfig(req.GetConfigJson())
	if err != nil {
		return &pluginv1.ValidateConfigResponse{Valid: false, Message: err.Error()}, nil
	}
	return &pluginv1.ValidateConfigResponse{Valid: true, Message: "configuration valid", NormalizedConfigJson: normalized}, nil
}
func (p *telemetryPlugin) ApplyConfig(ctx context.Context, req *pluginv1.ApplyConfigRequest) (*pluginv1.ApplyConfigResponse, error) {
	if err := p.runtime.Apply(ctx, req.GetConfigJson()); err != nil {
		return nil, err
	}
	return &pluginv1.ApplyConfigResponse{Applied: true, Message: "configuration applied"}, nil
}
func (p *telemetryPlugin) QuerySnapshot(ctx context.Context, req *wrapperspb.BytesValue) (*wrapperspb.BytesValue, error) {
	out, err := p.runtime.Query(ctx, req.GetValue())
	if err != nil {
		return nil, err
	}
	return wrapperspb.Bytes(out), nil
}
func (p *telemetryPlugin) TestConfig(ctx context.Context, req *pluginv1.TestConfigRequest) (*pluginv1.TestConfigResponse, error) {
	// The bridge tests saved config. Do not apply caller-supplied config or echo
	// host data in status; a real read proves current scope/version/permissions.
	if err := ctx.Err(); err != nil {
		return nil, status.FromContextError(err).Err()
	}
	if _, _, err := business.ParseConfig(req.GetConfigJson()); err != nil {
		return &pluginv1.TestConfigResponse{Success: false, Message: err.Error()}, nil
	}
	_, err := p.runtime.Query(ctx, []byte(`{}`))
	summary, marshalErr := json.Marshal(p.runtime.Summary())
	if marshalErr != nil {
		return nil, status.Error(codes.Internal, "cannot encode status summary")
	}
	if err != nil {
		return &pluginv1.TestConfigResponse{Success: false, Message: "telemetry is not ready or host read failed", StatusJson: string(summary)}, nil
	}
	return &pluginv1.TestConfigResponse{Success: true, Message: "read-only telemetry test passed", StatusJson: string(summary)}, nil
}

// InitHostServices verifies the version and actual read-only RPC, rather than
// treating a broker connection alone as proof of capability. An empty request
// must be rejected as InvalidArgument by the implemented v1 telemetry method;
// it does not read users or require an already-enabled saved scope. Unsupported,
// denied, unavailable and unexpected responses all fail closed. Authorization
// and public schema v1 are checked again on every real QuerySnapshot/TestConfig.
func (p *telemetryPlugin) InitHostServices(parent context.Context, req *pluginv1.InitHostServicesRequest) (*pluginv1.InitHostServicesResponse, error) {
	ctx, cancel := context.WithTimeout(parent, business.RequestTimeout)
	defer cancel()
	if err := ctx.Err(); err != nil {
		return nil, status.FromContextError(err).Err()
	}
	select {
	case p.initGate <- struct{}{}:
		defer func() { <-p.initGate }()
	case <-ctx.Done():
		return nil, status.FromContextError(ctx.Err()).Err()
	}
	if err := ctx.Err(); err != nil {
		return nil, status.FromContextError(err).Err()
	}
	p.mu.Lock()
	p.epoch++
	epoch := p.epoch
	broker := p.broker
	p.runtime.SetHost(nil)
	if p.conn != nil {
		_ = p.conn.Close()
		p.conn = nil
	}
	p.mu.Unlock()
	if req == nil || req.GetHostServiceId() == 0 || req.GetHostServiceApiVersion() < pluginv1.HostServiceAPIVersion || broker == nil {
		return nil, status.Error(codes.FailedPrecondition, "required telemetry host service version or broker missing")
	}
	conn, err := dialBroker(ctx, broker, req.GetHostServiceId())
	if err != nil {
		return nil, err
	}
	installed := false
	defer func() {
		if !installed {
			_ = conn.Close()
		}
	}()
	reader := pluginv1.NewUserTelemetryHostServiceClient(conn)
	if err := verifyHost(ctx, reader); err != nil {
		return nil, err
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	if ctx.Err() != nil {
		return nil, status.FromContextError(ctx.Err()).Err()
	}
	if p.epoch != epoch || p.broker != broker {
		return nil, status.Error(codes.FailedPrecondition, "host broker changed during initialization")
	}
	p.conn = conn
	p.runtime.SetHost(hostSource{reader: reader})
	installed = true
	return &pluginv1.InitHostServicesResponse{Ready: true, Message: "read-only telemetry host service initialized"}, nil
}

func verifyHost(ctx context.Context, reader pluginv1.UserTelemetryHostServiceClient) error {
	_, err := reader.ReadUserTelemetry(ctx, wrapperspb.Bytes(nil), grpc.MaxCallRecvMsgSize(business.MaxResponseBytes))
	if ctx.Err() != nil {
		return status.FromContextError(ctx.Err()).Err()
	}
	if status.Code(err) != codes.InvalidArgument {
		return status.Error(codes.FailedPrecondition, "required read-only telemetry capability unavailable")
	}
	return nil
}

func dialBroker(ctx context.Context, broker *hcplugin.GRPCBroker, id uint32) (*grpc.ClientConn, error) {
	type result struct {
		conn *grpc.ClientConn
		err  error
	}
	done := make(chan result)
	go func() {
		conn, err := broker.DialWithOptions(id, grpc.WithDefaultCallOptions(grpc.MaxCallRecvMsgSize(business.MaxResponseBytes)))
		select {
		case done <- result{conn, err}:
		case <-ctx.Done():
			if conn != nil {
				_ = conn.Close()
			}
		}
	}()
	select {
	case <-ctx.Done():
		return nil, status.FromContextError(ctx.Err()).Err()
	case r := <-done:
		if r.err != nil {
			return nil, status.Error(codes.Unavailable, "cannot connect telemetry host broker")
		}
		return r.conn, nil
	}
}

type hostSource struct {
	reader pluginv1.UserTelemetryHostServiceClient
}

func (s hostSource) Read(ctx context.Context, q public.Query) ([]byte, error) {
	raw, err := json.Marshal(q)
	if err != nil {
		return nil, status.Error(codes.Internal, "cannot encode telemetry query")
	}
	res, err := s.reader.ReadUserTelemetry(ctx, wrapperspb.Bytes(raw), grpc.MaxCallRecvMsgSize(business.MaxResponseBytes))
	if err != nil {
		return nil, err
	}
	if res == nil {
		return nil, status.Error(codes.DataLoss, "empty telemetry host response")
	}
	return res.GetValue(), nil
}
