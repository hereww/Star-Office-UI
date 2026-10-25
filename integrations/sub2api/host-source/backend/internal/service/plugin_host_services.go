package service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	pluginv1 "github.com/Wei-Shaw/sub2api/pkg/pluginapi/v1"
	"github.com/Wei-Shaw/sub2api/pkg/usertelemetry"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/wrapperspb"
)

// 通用宿主服务（HostService）的资源上限。这些限制与任何具体插件能力无关，
// 只用于约束单个插件对共享存储的占用，属于防御性护栏而非业务策略。
const (
	// pluginKVMaxPluginKeyLen 与清单 id 的 maxLength 一致（manifest.schema.json），
	// 确保任何可安装插件的 pluginKey 都能通过校验，不会被误判为不可用。
	pluginKVMaxPluginKeyLen  = 160
	pluginKVMaxNamespaceLen  = 128
	pluginKVMaxKeyLen        = 256
	pluginKVMaxValueBytes    = 256 * 1024
	pluginKVMaxListLimit     = 1000
	pluginKVDefaultListLimit = 100
	pluginKVMaxTTL           = 90 * 24 * time.Hour
)

// PluginKVStore 是宿主向插件提供的通用命名空间键值存储端口。它对存储介质保持中立
// （由 repository 层用 Redis 等实现），供任何插件持久化跨请求 / 跨副本 / 跨重启的
// 状态。pluginKey 由宿主根据服务该连接的运行时注入，插件无法伪造，从而保证不同
// 插件之间命名空间严格隔离。
type PluginKVStore interface {
	Get(ctx context.Context, pluginKey, namespace, key string) ([]byte, bool, error)
	Set(ctx context.Context, pluginKey, namespace, key string, value []byte, ttl time.Duration) error
	Delete(ctx context.Context, pluginKey, namespace, key string) error
	List(ctx context.Context, pluginKey, namespace, keyPrefix string, limit int) ([]string, error)
}

// PluginOutboundIdentity 是宿主为某账号解析出的、可直接用于出站请求的身份材料：
// 访问令牌、宿主会附加的出站请求头，以及账号代理。
type PluginOutboundIdentity struct {
	AccountID   int64
	Platform    string
	AccountType string
	ProxyURL    string
	Token       string
	Headers     http.Header
}

// PluginAccountInfo 是宿主向插件公开的、单个账号的「可读、非机密」视图。它绝不包含
// 凭据（access_token / refresh_token / cookie 等）——凭据只经 ResolvePluginOutboundIdentity
// 交付。范围内的账号一律返回（包含 active 但当前被暂停的：限流 / 临时不可调度 / 过载），
// 由插件自行决策（例如跳过已暂停账号，避免密集打扰）；管理性禁用 / 过期账号由仓储查询
// 上游过滤，不在此出现。Schedulable 是宿主权威判定（account.IsSchedulable），是插件
// 排除账号的首选信号。
//
// 只保留少量稳定的决策核心字段；账号其余可读信息（含日后新增字段）全部放进
// MetadataJSON，从而账号模型新增字段时宿主无需改契约、无需改映射、插件无需重编。
type PluginAccountInfo struct {
	ID          int64
	Platform    string
	AccountType string
	Name        string
	Status      string
	Schedulable bool
	IsShadow    bool
	// MetadataJSON 是账号全量可读、非机密字段的 JSON 对象（键为账号模型字段名）。
	MetadataJSON []byte
}

// pluginAccountScopeEntry 是账号范围中的一条 (platform, accountType) 规则。
// Platform 为具体平台；AccountType 为空表示该平台下任意账号类型。
type pluginAccountScopeEntry struct {
	Platform    string
	AccountType string
}

// PluginAccountScope 是宿主授予某插件的账号可见范围，由该插件清单声明的能力推导而来
// （见 PluginManager.buildHostServices）。它是权限边界的唯一事实来源：插件永远无法
// 越过它枚举或解析范围外账号，也无法自行扩大范围。
type PluginAccountScope struct {
	entries []pluginAccountScopeEntry
}

func newPluginAccountScope(entries ...pluginAccountScopeEntry) PluginAccountScope {
	clean := make([]pluginAccountScopeEntry, 0, len(entries))
	for _, e := range entries {
		if strings.TrimSpace(e.Platform) == "" {
			continue
		}
		clean = append(clean, e)
	}
	return PluginAccountScope{entries: clean}
}

// Empty 报告范围是否为空。空范围表示插件不具备任何账号目录能力。
func (s PluginAccountScope) Empty() bool { return len(s.entries) == 0 }

// Contains 报告某 (platform, accountType) 是否落在范围内。AccountType 为空的范围条目
// 匹配该平台下任意类型。
func (s PluginAccountScope) Contains(platform, accountType string) bool {
	for _, e := range s.entries {
		if e.Platform != "" && e.Platform != platform {
			continue
		}
		if e.AccountType != "" && e.AccountType != accountType {
			continue
		}
		return true
	}
	return false
}

// Platforms 返回范围内去重后的具体平台列表，供实现方按平台枚举账号。
func (s PluginAccountScope) Platforms() []string {
	seen := make(map[string]struct{}, len(s.entries))
	out := make([]string, 0, len(s.entries))
	for _, e := range s.entries {
		if _, ok := seen[e.Platform]; ok {
			continue
		}
		seen[e.Platform] = struct{}{}
		out = append(out, e.Platform)
	}
	return out
}

// PluginAccountDirectory 让插件枚举其范围内的账号（携带全量可读元数据），并按需解析
// 这些账号的出站身份，无需等待一条真实请求流经插件。ResolvePluginOutboundIdentity 会把
// 账号凭据交给插件进程，属敏感能力；ListPluginAccounts 只交付非机密元数据。两者都必须
// 把范围收敛到宿主传入的 scope。宿主只对「清单声明了对应账号能力」的插件构造 scope
// （见 PluginManager.buildHostServices）。
type PluginAccountDirectory interface {
	ListPluginAccounts(ctx context.Context, scope PluginAccountScope, platform, accountType string) ([]PluginAccountInfo, error)
	ResolvePluginOutboundIdentity(ctx context.Context, scope PluginAccountScope, accountID int64) (*PluginOutboundIdentity, error)
}

// pluginHostServiceServer 实现 pluginv1.HostServiceServer，是宿主经 go-plugin broker
// 反向暴露给单个插件进程的服务端点。它绑定到具体插件的 pluginKey，因此每个运行时都有
// 自己的实例；所有键值操作都被强制限定在该插件的命名空间内。
type pluginHostServiceServer struct {
	pluginv1.UnimplementedHostServiceServer
	telemetryReader PluginUserTelemetryReader
	telemetryScope  func(context.Context) ([]string, error)
	telemetryOnly   bool
	pluginKey       string
	store           PluginKVStore
	directory       PluginAccountDirectory
	// scope 是宿主授予本插件的账号可见范围。账号目录的两个 RPC 都以它为权限边界。
	scope PluginAccountScope
}

func newPluginHostServiceServer(pluginKey string, store PluginKVStore, directory PluginAccountDirectory, scope PluginAccountScope) *pluginHostServiceServer {
	return &pluginHostServiceServer{pluginKey: pluginKey, store: store, directory: directory, scope: scope}
}

func (s *pluginHostServiceServer) ready() bool {
	return s != nil && s.store != nil && isValidPluginKVSegment(s.pluginKey, pluginKVMaxPluginKeyLen)
}

func (s *pluginHostServiceServer) KVGet(ctx context.Context, req *pluginv1.KVGetRequest) (*pluginv1.KVGetResponse, error) {
	if !s.ready() {
		return nil, status.Error(codes.Unavailable, "宿主键值存储不可用")
	}
	if req == nil {
		return nil, status.Error(codes.InvalidArgument, "请求为空")
	}
	if err := validatePluginKVNamespace(req.Namespace); err != nil {
		return nil, err
	}
	if err := validatePluginKVKey(req.Key); err != nil {
		return nil, err
	}
	value, found, err := s.store.Get(ctx, s.pluginKey, req.Namespace, req.Key)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "读取键值失败: %v", err)
	}
	if !found {
		return &pluginv1.KVGetResponse{Found: false}, nil
	}
	return &pluginv1.KVGetResponse{Found: true, Value: value}, nil
}

func (s *pluginHostServiceServer) KVSet(ctx context.Context, req *pluginv1.KVSetRequest) (*pluginv1.KVSetResponse, error) {
	if !s.ready() {
		return nil, status.Error(codes.Unavailable, "宿主键值存储不可用")
	}
	if req == nil {
		return nil, status.Error(codes.InvalidArgument, "请求为空")
	}
	if err := validatePluginKVNamespace(req.Namespace); err != nil {
		return nil, err
	}
	if err := validatePluginKVKey(req.Key); err != nil {
		return nil, err
	}
	if len(req.Value) > pluginKVMaxValueBytes {
		return nil, status.Errorf(codes.InvalidArgument, "值超过 %d 字节上限", pluginKVMaxValueBytes)
	}
	ttl, err := pluginKVTTL(req.TtlSeconds)
	if err != nil {
		return nil, err
	}
	if err := s.store.Set(ctx, s.pluginKey, req.Namespace, req.Key, req.Value, ttl); err != nil {
		return nil, status.Errorf(codes.Internal, "写入键值失败: %v", err)
	}
	return &pluginv1.KVSetResponse{}, nil
}

func (s *pluginHostServiceServer) KVDelete(ctx context.Context, req *pluginv1.KVDeleteRequest) (*pluginv1.KVDeleteResponse, error) {
	if !s.ready() {
		return nil, status.Error(codes.Unavailable, "宿主键值存储不可用")
	}
	if req == nil {
		return nil, status.Error(codes.InvalidArgument, "请求为空")
	}
	if err := validatePluginKVNamespace(req.Namespace); err != nil {
		return nil, err
	}
	if err := validatePluginKVKey(req.Key); err != nil {
		return nil, err
	}
	if err := s.store.Delete(ctx, s.pluginKey, req.Namespace, req.Key); err != nil {
		return nil, status.Errorf(codes.Internal, "删除键值失败: %v", err)
	}
	return &pluginv1.KVDeleteResponse{}, nil
}

func (s *pluginHostServiceServer) KVList(ctx context.Context, req *pluginv1.KVListRequest) (*pluginv1.KVListResponse, error) {
	if !s.ready() {
		return nil, status.Error(codes.Unavailable, "宿主键值存储不可用")
	}
	if req == nil {
		return nil, status.Error(codes.InvalidArgument, "请求为空")
	}
	if err := validatePluginKVNamespace(req.Namespace); err != nil {
		return nil, err
	}
	if req.KeyPrefix != "" {
		if err := validatePluginKVKey(req.KeyPrefix); err != nil {
			return nil, err
		}
	}
	limit := int(req.Limit)
	if limit <= 0 {
		limit = pluginKVDefaultListLimit
	}
	if limit > pluginKVMaxListLimit {
		limit = pluginKVMaxListLimit
	}
	keys, err := s.store.List(ctx, s.pluginKey, req.Namespace, req.KeyPrefix, limit)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "列举键值失败: %v", err)
	}
	return &pluginv1.KVListResponse{Keys: keys}, nil
}

func (s *pluginHostServiceServer) ListAccounts(ctx context.Context, req *pluginv1.ListAccountsRequest) (*pluginv1.ListAccountsResponse, error) {
	if s != nil && s.telemetryOnly {
		return nil, status.Error(codes.PermissionDenied, "用户 telemetry 禁止访问账号目录")
	}
	if s == nil || s.directory == nil || s.scope.Empty() {
		return nil, status.Error(codes.Unavailable, "账号目录不可用")
	}
	if req == nil {
		return nil, status.Error(codes.InvalidArgument, "请求为空")
	}
	infos, err := s.directory.ListPluginAccounts(ctx, s.scope, req.Platform, req.AccountType)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "列举账号失败: %v", err)
	}
	resp := &pluginv1.ListAccountsResponse{
		AccountIds: make([]int64, 0, len(infos)),
		Accounts:   make([]*pluginv1.AccountInfo, 0, len(infos)),
	}
	for i := range infos {
		resp.AccountIds = append(resp.AccountIds, infos[i].ID)
		resp.Accounts = append(resp.Accounts, accountInfoToPlugin(infos[i]))
	}
	return resp, nil
}

func (s *pluginHostServiceServer) ResolveOutboundIdentity(ctx context.Context, req *pluginv1.ResolveOutboundIdentityRequest) (*pluginv1.ResolveOutboundIdentityResponse, error) {
	if s != nil && s.telemetryOnly {
		return nil, status.Error(codes.PermissionDenied, "用户 telemetry 禁止访问账号目录")
	}
	if s == nil || s.directory == nil || s.scope.Empty() {
		return nil, status.Error(codes.Unavailable, "账号目录不可用")
	}
	if req == nil || req.AccountId <= 0 {
		return nil, status.Error(codes.InvalidArgument, "account_id 无效")
	}
	identity, err := s.directory.ResolvePluginOutboundIdentity(ctx, s.scope, req.AccountId)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "解析账号出站身份失败: %v", err)
	}
	if identity == nil {
		return &pluginv1.ResolveOutboundIdentityResponse{Found: false}, nil
	}
	return &pluginv1.ResolveOutboundIdentityResponse{
		Found:       true,
		AccountId:   identity.AccountID,
		Platform:    identity.Platform,
		AccountType: identity.AccountType,
		ProxyUrl:    identity.ProxyURL,
		Token:       identity.Token,
		Headers:     headersToPlugin(identity.Headers),
	}, nil
}

// accountInfoToPlugin 把宿主的账号元数据视图映射为线上契约消息。只映射稳定的决策核心
// 字段；其余可读信息经 MetadataJSON 透传。绝不携带凭据。
func accountInfoToPlugin(info PluginAccountInfo) *pluginv1.AccountInfo {
	return &pluginv1.AccountInfo{
		Id:           info.ID,
		Platform:     info.Platform,
		AccountType:  info.AccountType,
		Name:         info.Name,
		Status:       info.Status,
		Schedulable:  info.Schedulable,
		IsShadow:     info.IsShadow,
		MetadataJson: info.MetadataJSON,
	}
}

func pluginKVTTL(seconds int64) (time.Duration, error) {
	if seconds < 0 {
		return 0, status.Error(codes.InvalidArgument, "ttl_seconds 不能为负")
	}
	if seconds == 0 {
		return 0, nil
	}
	// 先在整数秒上比较上限，避免 seconds*time.Second 溢出 int64 后回绕成负值、
	// 从而绕过上限检查把负 TTL 传给 Redis。
	maxSeconds := int64(pluginKVMaxTTL / time.Second)
	if seconds > maxSeconds {
		return 0, status.Errorf(codes.InvalidArgument, "ttl_seconds 超过上限 %d", maxSeconds)
	}
	return time.Duration(seconds) * time.Second, nil
}

func validatePluginKVNamespace(namespace string) error {
	if namespace == "" {
		return status.Error(codes.InvalidArgument, "namespace 不能为空")
	}
	if !isValidPluginKVSegment(namespace, pluginKVMaxNamespaceLen) {
		return status.Error(codes.InvalidArgument, "namespace 仅允许字母、数字、'.'、'_'、'-' 且长度受限")
	}
	return nil
}

func validatePluginKVKey(key string) error {
	if key == "" {
		return status.Error(codes.InvalidArgument, "key 不能为空")
	}
	if !isValidPluginKVSegment(key, pluginKVMaxKeyLen) {
		return status.Error(codes.InvalidArgument, "key 仅允许字母、数字、'.'、'_'、'-' 且长度受限")
	}
	return nil
}

// isValidPluginKVSegment 限定命名段字符集为 [A-Za-z0-9._-]。这既避免 Redis glob
// 元字符（*?[]）污染 SCAN，也避免 ':' 破坏内部键结构，从而保证命名空间隔离可靠。
func isValidPluginKVSegment(value string, maxLen int) bool {
	if value == "" || len(value) > maxLen {
		return false
	}
	for _, r := range value {
		switch {
		case r >= 'a' && r <= 'z':
		case r >= 'A' && r <= 'Z':
		case r >= '0' && r <= '9':
		case r == '.' || r == '_' || r == '-':
		default:
			return false
		}
	}
	return true
}

// PluginUserTelemetryReader is the injected, host-side secret-free data port.
type PluginUserTelemetryReader interface {
	ReadUserTelemetry(context.Context, json.RawMessage) (json.RawMessage, error)
}

func (s *pluginHostServiceServer) ReadUserTelemetry(ctx context.Context, req *wrapperspb.BytesValue) (*wrapperspb.BytesValue, error) {
	if s == nil || !s.telemetryOnly {
		return nil, status.Error(codes.PermissionDenied, "未授予用户 telemetry 能力")
	}
	if s.telemetryReader == nil || s.telemetryScope == nil {
		return nil, status.Error(codes.Unavailable, "用户 telemetry 未初始化")
	}
	if req == nil || len(req.Value) == 0 || len(req.Value) > pluginConfigMaxBytes {
		return nil, status.Error(codes.InvalidArgument, "无效 telemetry 请求")
	}
	allowed, err := s.telemetryScope(ctx)
	if err != nil {
		return nil, status.Error(codes.PermissionDenied, "用户 telemetry 未启用或授权已撤销")
	}
	query, err := usertelemetry.DecodeQuery(req.Value)
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "无效 telemetry query")
	}
	query, err = query.Restrict(allowed)
	if err != nil {
		return nil, status.Error(codes.PermissionDenied, "用户超出授权范围")
	}
	query, _, _, err = query.Normalize(time.Now())
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "无效 telemetry query")
	}
	raw, err := json.Marshal(query)
	if err != nil {
		return nil, status.Error(codes.Internal, "无法编码 query")
	}
	readCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	result, err := s.telemetryReader.ReadUserTelemetry(readCtx, raw)
	if err != nil {
		return nil, status.Error(codes.Unavailable, "用户 telemetry 读取失败")
	}
	// Recheck persistent scope after reading; an in-flight read cannot leak a
	// previously authorized user after an administrator narrows scope or disables.
	latest, err := s.telemetryScope(ctx)
	if err != nil {
		return nil, status.Error(codes.PermissionDenied, "用户 telemetry 授权已撤销")
	}
	if _, err := query.Restrict(latest); err != nil {
		return nil, status.Error(codes.PermissionDenied, "用户 telemetry 授权已撤销")
	}
	clean, err := validatePluginTelemetrySnapshot(result, query)
	if err != nil {
		return nil, status.Error(codes.Internal, "用户 telemetry 返回无效快照")
	}
	return wrapperspb.Bytes(clean), nil
}

// Configuration is administrator-owned, never taken from plugin RPC arguments.
// Only allowlist, timezone, explicit window and page are configurable in v1.
type pluginTelemetryConfig struct {
	AllowedUserIDs []string `json:"allowed_user_ids"`
	Timezone       string   `json:"timezone,omitempty"`
	Page           int      `json:"page_size,omitempty"`
}

func decodePluginTelemetryConfig(raw []byte) (pluginTelemetryConfig, error) {
	var c pluginTelemetryConfig
	if len(raw) == 0 || len(raw) > pluginConfigMaxBytes {
		return c, errors.New("无效 telemetry 配置")
	}
	// Keep the host and plugin configuration contracts identical and minimal.
	fields, err := decodePluginTelemetryConfigFields(raw)
	if err != nil {
		return c, err
	}
	raw, err = json.Marshal(fields)
	if err != nil {
		return c, err
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if err := d.Decode(&c); err != nil {
		return c, errors.New("telemetry 配置只允许 allowed_user_ids/timezone/page_size")
	}
	if err := d.Decode(new(any)); err != io.EOF {
		return c, errors.New("无效 telemetry 配置尾部")
	}
	if len(c.AllowedUserIDs) < 1 || len(c.AllowedUserIDs) > 500 {
		return c, errors.New("allowed_user_ids 必须包含 1..500 个用户")
	}
	seen := map[string]bool{}
	for _, id := range c.AllowedUserIDs {
		if _, err := usertelemetry.ParseID(id); err != nil || seen[id] {
			return c, errors.New("allowed_user_ids 必须是不重复的 canonical ID")
		}
		seen[id] = true
	}
	q := usertelemetry.Query{UserIDs: c.AllowedUserIDs, Timezone: c.Timezone, PageSize: c.Page}
	normalized, _, _, err := q.Normalize(time.Now())
	if err != nil {
		return c, err
	}
	c.Timezone, c.Page = normalized.Timezone, normalized.PageSize
	return c, nil
}
func validatePluginTelemetrySnapshot(raw []byte, query usertelemetry.Query) (json.RawMessage, error) {
	if len(raw) == 0 || len(raw) > pluginv1.UserTelemetryMaxResponseBytes {
		return nil, errors.New("telemetry 快照超过大小限制")
	}
	var snapshot usertelemetry.Snapshot
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if err := d.Decode(&snapshot); err != nil {
		return nil, errors.New("telemetry 快照包含非白名单字段或类型")
	}
	if err := d.Decode(new(any)); err != io.EOF {
		return nil, errors.New("telemetry 快照包含多余 JSON")
	}
	if snapshot.SchemaVersion != 1 || snapshot.Window.Start != query.Start || snapshot.Window.End != query.End || snapshot.Window.Timezone != query.Timezone || len(snapshot.Users) > query.PageSize {
		return nil, errors.New("telemetry 快照协议或窗口不一致")
	}
	allowed := map[string]bool{}
	seen := map[string]bool{}
	for _, id := range query.UserIDs {
		allowed[id] = true
	}
	for _, u := range snapshot.Users {
		if !allowed[u.UserID] || seen[u.UserID] {
			return nil, errors.New("telemetry 快照跨用户范围")
		}
		seen[u.UserID] = true
		for _, key := range u.APIKeys {
			if _, err := usertelemetry.ParseID(key.ID); err != nil {
				return nil, errors.New("telemetry API ID 无效")
			}
		}
	}
	if snapshot.NextCursor != nil {
		if _, err := usertelemetry.ParseID(*snapshot.NextCursor); err != nil || !allowed[*snapshot.NextCursor] {
			return nil, errors.New("telemetry 快照游标无效")
		}
	}
	return json.Marshal(snapshot)
}

func decodePluginTelemetryConfigFields(raw []byte) (map[string]json.RawMessage, error) {
	d := json.NewDecoder(bytes.NewReader(raw))
	token, err := d.Token()
	if err != nil || token != json.Delim('{') {
		return nil, errors.New("telemetry 配置必须是对象")
	}
	fields := map[string]json.RawMessage{}
	for d.More() {
		token, err := d.Token()
		key, ok := token.(string)
		if err != nil || !ok {
			return nil, errors.New("telemetry 配置字段无效")
		}
		if _, duplicate := fields[key]; duplicate {
			return nil, errors.New("telemetry 配置字段不得重复")
		}
		switch key {
		case "allowed_user_ids", "timezone", "page_size":
		default:
			return nil, errors.New("telemetry 配置包含未知字段")
		}
		var value json.RawMessage
		if err := d.Decode(&value); err != nil || bytes.Equal(bytes.TrimSpace(value), []byte("null")) {
			return nil, errors.New("telemetry 配置字段类型无效")
		}
		fields[key] = value
	}
	if _, err := d.Token(); err != nil {
		return nil, errors.New("telemetry 配置无效")
	}
	if err := d.Decode(new(any)); err != io.EOF {
		return nil, errors.New("telemetry 配置尾部无效")
	}
	return fields, nil
}
