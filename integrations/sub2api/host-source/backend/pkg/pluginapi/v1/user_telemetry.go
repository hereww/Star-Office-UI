// Package pluginv1 provides the native user telemetry SDK. The telemetry service
// deliberately has no Forward RPC. BytesValue payloads are pkg/usertelemetry JSON.
package pluginv1

import (
	"context"
	hcplugin "github.com/hashicorp/go-plugin"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/wrapperspb"
)

const UserTelemetryAPIVersion = 1
const UserTelemetryPluginName = "user_telemetry"
const UserTelemetryCapability = "sub2api.user_telemetry.read.v1"
const UserTelemetryMaxResponseBytes = 4 * 1024 * 1024

// PluginLifecycleClient is common to both independent plugin protocols.
type PluginLifecycleClient interface {
	GetInfo(context.Context, *GetInfoRequest, ...grpc.CallOption) (*GetInfoResponse, error)
	Health(context.Context, *HealthRequest, ...grpc.CallOption) (*HealthResponse, error)
	ValidateConfig(context.Context, *ValidateConfigRequest, ...grpc.CallOption) (*ValidateConfigResponse, error)
	ApplyConfig(context.Context, *ApplyConfigRequest, ...grpc.CallOption) (*ApplyConfigResponse, error)
	TestConfig(context.Context, *TestConfigRequest, ...grpc.CallOption) (*TestConfigResponse, error)
	InitHostServices(context.Context, *InitHostServicesRequest, ...grpc.CallOption) (*InitHostServicesResponse, error)
}

type UserTelemetryPluginServer interface {
	GetInfo(context.Context, *GetInfoRequest) (*GetInfoResponse, error)
	Health(context.Context, *HealthRequest) (*HealthResponse, error)
	ValidateConfig(context.Context, *ValidateConfigRequest) (*ValidateConfigResponse, error)
	ApplyConfig(context.Context, *ApplyConfigRequest) (*ApplyConfigResponse, error)
	TestConfig(context.Context, *TestConfigRequest) (*TestConfigResponse, error)
	InitHostServices(context.Context, *InitHostServicesRequest) (*InitHostServicesResponse, error)
	QuerySnapshot(context.Context, *wrapperspb.BytesValue) (*wrapperspb.BytesValue, error)
}
type UserTelemetryPluginClient interface {
	GetInfo(context.Context, *GetInfoRequest, ...grpc.CallOption) (*GetInfoResponse, error)
	Health(context.Context, *HealthRequest, ...grpc.CallOption) (*HealthResponse, error)
	ValidateConfig(context.Context, *ValidateConfigRequest, ...grpc.CallOption) (*ValidateConfigResponse, error)
	ApplyConfig(context.Context, *ApplyConfigRequest, ...grpc.CallOption) (*ApplyConfigResponse, error)
	TestConfig(context.Context, *TestConfigRequest, ...grpc.CallOption) (*TestConfigResponse, error)
	InitHostServices(context.Context, *InitHostServicesRequest, ...grpc.CallOption) (*InitHostServicesResponse, error)
	QuerySnapshot(context.Context, *wrapperspb.BytesValue, ...grpc.CallOption) (*wrapperspb.BytesValue, error)
}
type UnimplementedUserTelemetryPluginServer struct{}

func (UnimplementedUserTelemetryPluginServer) GetInfo(context.Context, *GetInfoRequest) (*GetInfoResponse, error) {
	return nil, status.Error(codes.Unimplemented, "GetInfo is not implemented")
}
func (UnimplementedUserTelemetryPluginServer) Health(context.Context, *HealthRequest) (*HealthResponse, error) {
	return nil, status.Error(codes.Unimplemented, "Health is not implemented")
}
func (UnimplementedUserTelemetryPluginServer) ValidateConfig(context.Context, *ValidateConfigRequest) (*ValidateConfigResponse, error) {
	return nil, status.Error(codes.Unimplemented, "ValidateConfig is not implemented")
}
func (UnimplementedUserTelemetryPluginServer) ApplyConfig(context.Context, *ApplyConfigRequest) (*ApplyConfigResponse, error) {
	return nil, status.Error(codes.Unimplemented, "ApplyConfig is not implemented")
}
func (UnimplementedUserTelemetryPluginServer) TestConfig(context.Context, *TestConfigRequest) (*TestConfigResponse, error) {
	return nil, status.Error(codes.Unimplemented, "TestConfig is not implemented")
}
func (UnimplementedUserTelemetryPluginServer) InitHostServices(context.Context, *InitHostServicesRequest) (*InitHostServicesResponse, error) {
	return nil, status.Error(codes.Unimplemented, "InitHostServices is not implemented")
}
func (UnimplementedUserTelemetryPluginServer) QuerySnapshot(context.Context, *wrapperspb.BytesValue) (*wrapperspb.BytesValue, error) {
	return nil, status.Error(codes.Unimplemented, "QuerySnapshot is not implemented")
}

type userTelemetryPluginClient struct{ cc grpc.ClientConnInterface }

func NewUserTelemetryPluginClient(cc grpc.ClientConnInterface) UserTelemetryPluginClient {
	return &userTelemetryPluginClient{cc: cc}
}
func (c *userTelemetryPluginClient) GetInfo(ctx context.Context, in *GetInfoRequest, opts ...grpc.CallOption) (*GetInfoResponse, error) {
	out := new(GetInfoResponse)
	err := c.cc.Invoke(ctx, "/sub2api.plugin.v1.UserTelemetryPlugin/GetInfo", in, out, opts...)
	if err != nil {
		return nil, err
	}
	return out, nil
}
func (c *userTelemetryPluginClient) Health(ctx context.Context, in *HealthRequest, opts ...grpc.CallOption) (*HealthResponse, error) {
	out := new(HealthResponse)
	err := c.cc.Invoke(ctx, "/sub2api.plugin.v1.UserTelemetryPlugin/Health", in, out, opts...)
	if err != nil {
		return nil, err
	}
	return out, nil
}
func (c *userTelemetryPluginClient) ValidateConfig(ctx context.Context, in *ValidateConfigRequest, opts ...grpc.CallOption) (*ValidateConfigResponse, error) {
	out := new(ValidateConfigResponse)
	err := c.cc.Invoke(ctx, "/sub2api.plugin.v1.UserTelemetryPlugin/ValidateConfig", in, out, opts...)
	if err != nil {
		return nil, err
	}
	return out, nil
}
func (c *userTelemetryPluginClient) ApplyConfig(ctx context.Context, in *ApplyConfigRequest, opts ...grpc.CallOption) (*ApplyConfigResponse, error) {
	out := new(ApplyConfigResponse)
	err := c.cc.Invoke(ctx, "/sub2api.plugin.v1.UserTelemetryPlugin/ApplyConfig", in, out, opts...)
	if err != nil {
		return nil, err
	}
	return out, nil
}
func (c *userTelemetryPluginClient) TestConfig(ctx context.Context, in *TestConfigRequest, opts ...grpc.CallOption) (*TestConfigResponse, error) {
	out := new(TestConfigResponse)
	err := c.cc.Invoke(ctx, "/sub2api.plugin.v1.UserTelemetryPlugin/TestConfig", in, out, opts...)
	if err != nil {
		return nil, err
	}
	return out, nil
}
func (c *userTelemetryPluginClient) InitHostServices(ctx context.Context, in *InitHostServicesRequest, opts ...grpc.CallOption) (*InitHostServicesResponse, error) {
	out := new(InitHostServicesResponse)
	err := c.cc.Invoke(ctx, "/sub2api.plugin.v1.UserTelemetryPlugin/InitHostServices", in, out, opts...)
	if err != nil {
		return nil, err
	}
	return out, nil
}
func (c *userTelemetryPluginClient) QuerySnapshot(ctx context.Context, in *wrapperspb.BytesValue, opts ...grpc.CallOption) (*wrapperspb.BytesValue, error) {
	out := new(wrapperspb.BytesValue)
	err := c.cc.Invoke(ctx, "/sub2api.plugin.v1.UserTelemetryPlugin/QuerySnapshot", in, out, opts...)
	if err != nil {
		return nil, err
	}
	return out, nil
}
func RegisterUserTelemetryPluginServer(s grpc.ServiceRegistrar, impl UserTelemetryPluginServer) {
	s.RegisterService(&UserTelemetryPlugin_ServiceDesc, impl)
}
func _UserTelemetryPlugin_GetInfo_Handler(srv interface{}, ctx context.Context, dec func(interface{}) error, interceptor grpc.UnaryServerInterceptor) (interface{}, error) {
	in := new(GetInfoRequest)
	if err := dec(in); err != nil {
		return nil, err
	}
	if interceptor == nil {
		return srv.(UserTelemetryPluginServer).GetInfo(ctx, in)
	}
	info := &grpc.UnaryServerInfo{Server: srv, FullMethod: "/sub2api.plugin.v1.UserTelemetryPlugin/GetInfo"}
	return interceptor(ctx, in, info, func(ctx context.Context, req interface{}) (interface{}, error) {
		return srv.(UserTelemetryPluginServer).GetInfo(ctx, req.(*GetInfoRequest))
	})
}
func _UserTelemetryPlugin_Health_Handler(srv interface{}, ctx context.Context, dec func(interface{}) error, interceptor grpc.UnaryServerInterceptor) (interface{}, error) {
	in := new(HealthRequest)
	if err := dec(in); err != nil {
		return nil, err
	}
	if interceptor == nil {
		return srv.(UserTelemetryPluginServer).Health(ctx, in)
	}
	info := &grpc.UnaryServerInfo{Server: srv, FullMethod: "/sub2api.plugin.v1.UserTelemetryPlugin/Health"}
	return interceptor(ctx, in, info, func(ctx context.Context, req interface{}) (interface{}, error) {
		return srv.(UserTelemetryPluginServer).Health(ctx, req.(*HealthRequest))
	})
}
func _UserTelemetryPlugin_ValidateConfig_Handler(srv interface{}, ctx context.Context, dec func(interface{}) error, interceptor grpc.UnaryServerInterceptor) (interface{}, error) {
	in := new(ValidateConfigRequest)
	if err := dec(in); err != nil {
		return nil, err
	}
	if interceptor == nil {
		return srv.(UserTelemetryPluginServer).ValidateConfig(ctx, in)
	}
	info := &grpc.UnaryServerInfo{Server: srv, FullMethod: "/sub2api.plugin.v1.UserTelemetryPlugin/ValidateConfig"}
	return interceptor(ctx, in, info, func(ctx context.Context, req interface{}) (interface{}, error) {
		return srv.(UserTelemetryPluginServer).ValidateConfig(ctx, req.(*ValidateConfigRequest))
	})
}
func _UserTelemetryPlugin_ApplyConfig_Handler(srv interface{}, ctx context.Context, dec func(interface{}) error, interceptor grpc.UnaryServerInterceptor) (interface{}, error) {
	in := new(ApplyConfigRequest)
	if err := dec(in); err != nil {
		return nil, err
	}
	if interceptor == nil {
		return srv.(UserTelemetryPluginServer).ApplyConfig(ctx, in)
	}
	info := &grpc.UnaryServerInfo{Server: srv, FullMethod: "/sub2api.plugin.v1.UserTelemetryPlugin/ApplyConfig"}
	return interceptor(ctx, in, info, func(ctx context.Context, req interface{}) (interface{}, error) {
		return srv.(UserTelemetryPluginServer).ApplyConfig(ctx, req.(*ApplyConfigRequest))
	})
}
func _UserTelemetryPlugin_TestConfig_Handler(srv interface{}, ctx context.Context, dec func(interface{}) error, interceptor grpc.UnaryServerInterceptor) (interface{}, error) {
	in := new(TestConfigRequest)
	if err := dec(in); err != nil {
		return nil, err
	}
	if interceptor == nil {
		return srv.(UserTelemetryPluginServer).TestConfig(ctx, in)
	}
	info := &grpc.UnaryServerInfo{Server: srv, FullMethod: "/sub2api.plugin.v1.UserTelemetryPlugin/TestConfig"}
	return interceptor(ctx, in, info, func(ctx context.Context, req interface{}) (interface{}, error) {
		return srv.(UserTelemetryPluginServer).TestConfig(ctx, req.(*TestConfigRequest))
	})
}
func _UserTelemetryPlugin_InitHostServices_Handler(srv interface{}, ctx context.Context, dec func(interface{}) error, interceptor grpc.UnaryServerInterceptor) (interface{}, error) {
	in := new(InitHostServicesRequest)
	if err := dec(in); err != nil {
		return nil, err
	}
	if interceptor == nil {
		return srv.(UserTelemetryPluginServer).InitHostServices(ctx, in)
	}
	info := &grpc.UnaryServerInfo{Server: srv, FullMethod: "/sub2api.plugin.v1.UserTelemetryPlugin/InitHostServices"}
	return interceptor(ctx, in, info, func(ctx context.Context, req interface{}) (interface{}, error) {
		return srv.(UserTelemetryPluginServer).InitHostServices(ctx, req.(*InitHostServicesRequest))
	})
}
func _UserTelemetryPlugin_QuerySnapshot_Handler(srv interface{}, ctx context.Context, dec func(interface{}) error, interceptor grpc.UnaryServerInterceptor) (interface{}, error) {
	in := new(wrapperspb.BytesValue)
	if err := dec(in); err != nil {
		return nil, err
	}
	if interceptor == nil {
		return srv.(UserTelemetryPluginServer).QuerySnapshot(ctx, in)
	}
	info := &grpc.UnaryServerInfo{Server: srv, FullMethod: "/sub2api.plugin.v1.UserTelemetryPlugin/QuerySnapshot"}
	return interceptor(ctx, in, info, func(ctx context.Context, req interface{}) (interface{}, error) {
		return srv.(UserTelemetryPluginServer).QuerySnapshot(ctx, req.(*wrapperspb.BytesValue))
	})
}

var UserTelemetryPlugin_ServiceDesc = grpc.ServiceDesc{ServiceName: "sub2api.plugin.v1.UserTelemetryPlugin", HandlerType: (*UserTelemetryPluginServer)(nil), Methods: []grpc.MethodDesc{
	{MethodName: "GetInfo", Handler: _UserTelemetryPlugin_GetInfo_Handler},
	{MethodName: "Health", Handler: _UserTelemetryPlugin_Health_Handler},
	{MethodName: "ValidateConfig", Handler: _UserTelemetryPlugin_ValidateConfig_Handler},
	{MethodName: "ApplyConfig", Handler: _UserTelemetryPlugin_ApplyConfig_Handler},
	{MethodName: "TestConfig", Handler: _UserTelemetryPlugin_TestConfig_Handler},
	{MethodName: "InitHostServices", Handler: _UserTelemetryPlugin_InitHostServices_Handler},
	{MethodName: "QuerySnapshot", Handler: _UserTelemetryPlugin_QuerySnapshot_Handler},
}, Metadata: "user_telemetry.proto"}

type UserTelemetryHostServiceServer interface {
	ReadUserTelemetry(context.Context, *wrapperspb.BytesValue) (*wrapperspb.BytesValue, error)
}
type UserTelemetryHostServiceClient interface {
	ReadUserTelemetry(context.Context, *wrapperspb.BytesValue, ...grpc.CallOption) (*wrapperspb.BytesValue, error)
}
type UnimplementedUserTelemetryHostServiceServer struct{}

func (UnimplementedUserTelemetryHostServiceServer) ReadUserTelemetry(context.Context, *wrapperspb.BytesValue) (*wrapperspb.BytesValue, error) {
	return nil, status.Error(codes.Unimplemented, "ReadUserTelemetry is not implemented")
}

type userTelemetryHostServiceClient struct{ cc grpc.ClientConnInterface }

func NewUserTelemetryHostServiceClient(cc grpc.ClientConnInterface) UserTelemetryHostServiceClient {
	return &userTelemetryHostServiceClient{cc: cc}
}
func (c *userTelemetryHostServiceClient) ReadUserTelemetry(ctx context.Context, in *wrapperspb.BytesValue, opts ...grpc.CallOption) (*wrapperspb.BytesValue, error) {
	out := new(wrapperspb.BytesValue)
	err := c.cc.Invoke(ctx, "/sub2api.plugin.v1.UserTelemetryHostService/ReadUserTelemetry", in, out, opts...)
	if err != nil {
		return nil, err
	}
	return out, nil
}
func RegisterUserTelemetryHostServiceServer(s grpc.ServiceRegistrar, impl UserTelemetryHostServiceServer) {
	s.RegisterService(&UserTelemetryHostService_ServiceDesc, impl)
}
func _UserTelemetryHostService_ReadUserTelemetry_Handler(srv interface{}, ctx context.Context, dec func(interface{}) error, interceptor grpc.UnaryServerInterceptor) (interface{}, error) {
	in := new(wrapperspb.BytesValue)
	if err := dec(in); err != nil {
		return nil, err
	}
	if interceptor == nil {
		return srv.(UserTelemetryHostServiceServer).ReadUserTelemetry(ctx, in)
	}
	info := &grpc.UnaryServerInfo{Server: srv, FullMethod: "/sub2api.plugin.v1.UserTelemetryHostService/ReadUserTelemetry"}
	return interceptor(ctx, in, info, func(ctx context.Context, req interface{}) (interface{}, error) {
		return srv.(UserTelemetryHostServiceServer).ReadUserTelemetry(ctx, req.(*wrapperspb.BytesValue))
	})
}

var UserTelemetryHostService_ServiceDesc = grpc.ServiceDesc{ServiceName: "sub2api.plugin.v1.UserTelemetryHostService", HandlerType: (*UserTelemetryHostServiceServer)(nil), Methods: []grpc.MethodDesc{
	{MethodName: "ReadUserTelemetry", Handler: _UserTelemetryHostService_ReadUserTelemetry_Handler},
}, Metadata: "user_telemetry.proto"}

// UserTelemetryClient binds the independently dispensed client to its broker.
type UserTelemetryClient struct {
	UserTelemetryPluginClient
	Broker *hcplugin.GRPCBroker
}
type GRPCUserTelemetryPlugin struct {
	hcplugin.NetRPCUnsupportedPlugin
	Impl UserTelemetryPluginServer
}

func (p *GRPCUserTelemetryPlugin) GRPCServer(broker *hcplugin.GRPCBroker, server *grpc.Server) error {
	RegisterUserTelemetryPluginServer(server, p.Impl)
	if receiver, ok := p.Impl.(HostBrokerReceiver); ok {
		receiver.SetHostBroker(broker)
	}
	return nil
}
func (p *GRPCUserTelemetryPlugin) GRPCClient(_ context.Context, broker *hcplugin.GRPCBroker, conn *grpc.ClientConn) (any, error) {
	return &UserTelemetryClient{UserTelemetryPluginClient: NewUserTelemetryPluginClient(conn), Broker: broker}, nil
}
func ServeUserTelemetry(impl UserTelemetryPluginServer) {
	hcplugin.Serve(&hcplugin.ServeConfig{
		HandshakeConfig: HandshakeConfig,
		Plugins:         map[string]hcplugin.Plugin{UserTelemetryPluginName: &GRPCUserTelemetryPlugin{Impl: impl}},
		GRPCServer:      hcplugin.DefaultGRPCServer,
	})
}
