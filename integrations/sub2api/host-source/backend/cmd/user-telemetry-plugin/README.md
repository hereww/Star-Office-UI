# 用户数据只读原生插件 — runtime/UI 交接

ID `com.lvdong.user-telemetry`，版本 `0.1.0`，唯一能力
`sub2api.user_telemetry.read.v1`。所有本任务文件位于本目录；没有修改宿主、SDK、
public contract、go.mod/go.sum 或部署配置，没有提交或部署。

## 接口与安全边界

- `main.go` 直接使用当前 SDK `ServeUserTelemetry` 和
  `UserTelemetryPluginServer`；不注册 TransportPlugin、不实现 Forward、没有 HTTP
  监听、上游请求、身份获取或消费端凭据 UI。
- `GetInfo/Health/ValidateConfig/ApplyConfig/TestConfig/InitHostServices/QuerySnapshot`
  均复用现有 lifecycle protobuf；QuerySnapshot/ReadUserTelemetry 为 JSON BytesValue。
- config 只有 `allowed_user_ids/timezone/page_size`。未知字段、重复 JSON 字段、null、
  非对象、尾随 JSON、非法类型、非 canonical/重复/越界 ID、非法时区或页大小均拒绝。
  `{}` 规范化为无授权 scope、Asia/Shanghai、100；无 scope 不能查询。空默认/撤销
  配置可以 Apply，但不是 enabled 状态。显式 page_size 必须是 1..500。
- `Health.healthy` 表示 gRPC 已注册（serverReady），允许临时未配置 runtime 完成
  Init/Apply；`status_json` 仅含 `ready/configured` 两个布尔值。
- Init 接受当前 HostServiceAPIVersion 或更新版本，经 go-plugin broker 连接，并
  实际调用 telemetry Read 的空 BytesValue 探测：**必须返回 InvalidArgument**，
  不接受 Unimplemented/PermissionDenied/Unavailable/成功响应。空请求不会查询用户。
  不把 broker 拨号成功当成 telemetry RPC 就绪；重初始化失败会清除旧 source。
- 现有 Init protobuf 没有独立 telemetry version/capability advertisement。版本通过
  HostServiceAPIVersion 检查；RPC 可用性通过上述无数据探测检查；实际读取逐次检查
  用户授权与 public Snapshot schema_version=1。若宿主增设显式协商字段，可进一步
  验证它；当前不猜测/新增 protobuf。权限不由空探测证明，由实际读取 fail closed。
- Query 要求 server+host+scope 就绪；请求严格解析，再 Restrict/Normalize，冻结窗口、
  默认时区与页大小；5 秒 deadline 和调用者取消传递至反向 RPC。
- 宿主 payload 解码为 public Snapshot 再 marshal，剥除各层未知字段（不原样透传）；
  检查 schema/window/page/user scope/重复用户/API ID/cursor；输入输出均最多 2 MiB。
  保留 public DTO 的 null/quality/observed_at/空 username，不伪装零值。
- Apply/host 切换原子更新并取消在途查询；返回前检查 generation，拒绝旧 scope
  数据。SDK host error 保留 gRPC code，但不回传可能包含身份/秘密的错误正文。
- TestConfig 验证输入但不隐式 Apply；真实读取当前已应用配置，响应仅成功与摘要。

## UI 协议

`ui/index.html` 无 CDN/外部网络请求、parent DOM/Cookie/storage 访问。iframe 使用
`sandbox="allow-scripts"`，保存是 type=button 的 bridge 调用，不依赖 allow-forms。

- config.load 成功响应 `data.config` 是原始配置对象。
- config.save 发送 `{source,bridge_token,type:'config.save',request_id,config:<原始对象>}`；
  宿主适配层把该 config 作为原始 HTTP API body，不再封装一层。
- config.save 成功后读取 `data.config`；config.test 不带 config，仅在保存完成后调用。
- 使用 sub2api.plugin.ready/ui.notify/ui.resize；错误、超时、保存已成功但测试失败分别反馈。
- 接收严格验证 parent source、精确宿主 origin、source 标识、bridge token、pending ID
  及响应 type；发送 targetOrigin 固定为资源 URL origin，拒绝跨 origin referrer。
  请求 15 秒超时，pagehide 清理。没有管理 token/API Key/OAuth/数据库字段。

## 已执行验证（2026-10-04，Go 1.27）

工作目录：`/Users/hepingyu/Documents/ChatGPT/sub2api/host-source/backend`。

```sh
go test -race -count=1 -cover ./cmd/user-telemetry-plugin/...
go vet ./cmd/user-telemetry-plugin/...
node --test cmd/user-telemetry-plugin/ui/bridge.test.cjs
NODE_PATH=/Users/hepingyu/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules \
 TELEMETRY_UI_QA_OUT="$PWD/cmd/user-telemetry-plugin/ui/qa" \
 node cmd/user-telemetry-plugin/ui/browser-smoke.cjs
GOOS=linux GOARCH=amd64 go build -o cmd/user-telemetry-plugin/.build/user-telemetry-linux-amd64 ./cmd/user-telemetry-plugin
GOOS=linux GOARCH=arm64 go build -o cmd/user-telemetry-plugin/.build/user-telemetry-linux-arm64 ./cmd/user-telemetry-plugin
```

Go tests 包括配置/scope/bounds/DTO filter/取消/并发、真正 SDK 子进程 broker 生命周期、
Init-before-Apply 和 Apply-before-Init、未配置 Query 拒绝、旧 host/缺失 RPC 拒绝、无握手
拒绝启动、未注册 TransportPlugin RPC。业务数据来源明确为 fake，不是生产验收。

Node bridge 单测 8 项 PASS。浏览器 smoke 用 Playwright + 本机 Google Chrome headless，
route.fulfill 截获假 HTTPS 页，不启动网络监听；真实 sandbox allow-scripts，在 900×900、
390×844 验证加载/保存/保存后测试/原始对象/非法 ID/无横向溢出。截图在 ui/qa/。
可通过 TELEMETRY_UI_BROWSER 指定本机浏览器，不需要下载或安装浏览器。

.build 和 ui/qa 为本地未签名 QA 产物，不是可安装签名包。打包只取实际目标二进制和
ui/index.html，不把测试脚本/截图混入 UI 清单。

## 主代理必须接续的集成验收

1. 最终交接前只读核对宿主 decodePluginTelemetryConfig 已由主代理收敛为
   `allowed_user_ids/timezone/page_size`，不再含 window/page 别名。插件从未增加
   window/page；主代理仍需重跑跨宿主保存/协议验收。
2. 确认宿主空 telemetry request 在检查 enabled scope **之前**返回 InvalidArgument，
   保证临时未配置 runtime 能 Init；实际用户读则仍检查 enabled/授权。
3. 继续签名 .s2plugin、native asset session/CSP/bridge 管理端 HTTP 原始对象、真实数据
   reader、启停/重启/卸载、消费端 credential 撤销验收。本任务没有宣称这些已完成。
