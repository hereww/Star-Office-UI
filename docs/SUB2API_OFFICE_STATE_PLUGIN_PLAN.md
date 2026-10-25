# Sub2API 办公室状态插件开发规划 v1

- 日期：2026-10-02（Asia/Shanghai）
- 状态：规划草案；本轮仅新增本文档，未开发插件、未修改现有业务代码、未部署。
- 核心约定：**一个办公室角色对应一个 Sub2API 用户；同一用户所有 API Key 的调用合并展示。**
- 建议形态：独立的 `sub2api-office-bridge` 状态桥接服务。先用现有只读接口验证，再补齐网关请求事件。不是把动画逻辑塞进模型转发插件。

## 1. 本次核对的事实与边界

### 1.1 Sub2API

本机 `/Users/hepingyu/Documents/ChatGPT/sub2api` 当前没有 Sub2API 后端业务源码，也没有配置 Git remote，不能据此判断线上版本。

本次核对上游 `Wei-Shaw/sub2api` 的固定提交：

```text
458b92abd4b0b09d123d4c6727dd8d59060bd883
commit timestamp: 2026-10-02T06:45:18Z
```

已核对的上游能力：

1. API Key 关联 `user_id`；用量记录另外包含 `api_key_id` 和上游 `account_id`。角色身份必须采用前者，不能用上游账号替代用户。
2. 管理端已有 `/ops/user-concurrency` 相对路由，提供用户当前并发、排队数、并发上限和采集时间。部署时需确认完整 API 前缀、版本、监控开关和权限。
3. 用量 schema 有用户、模型、输入/输出/缓存 tokens、费用、耗时、首 token 耗时等字段；字段存在不代表每条请求都已填充，也不代表能实时读到。
4. 原生插件 manifest 能力仍限定 `openai.oauth.outbound_transport.v1`。协议已增加 HostService KV 和账号目录等设施，但没有全平台、按终端用户订阅请求生命周期的通用接口；Forward 起始消息携带的是上游 `account_id`，未提供这里需要的 `user_id`。
5. 用户并发读取存在 best-effort 降级：缓存读取失败时可能跳过该批次，最后返回空结果或缺失用户。**不能把 HTTP 200 + 用户未出现直接当成可靠的“空闲”。** 正式版需要显式的采集有效性或可验证的权威快照。

以上是上游源码事实，不是对当前线上实例的实测结论。开发第一步仍需只读核对实际镜像/提交、API 和代表性请求。

### 1.2 当前办公室

本次直接查看的本地文件：

- `/Users/hepingyu/Documents/ChatGPT/Star-Office-UI/frontend/company-office/runtime.mjs`
- `/Users/hepingyu/Documents/ChatGPT/Star-Office-UI/frontend/company-office/seated-compositor.mjs`
- `/Users/hepingyu/Documents/ChatGPT/Star-Office-UI/frontend/company-office/map-layout.json`
- `/Users/hepingyu/Documents/ChatGPT/Star-Office-UI/frontend/index.html`
- `/Users/hepingyu/Documents/ChatGPT/Star-Office-UI/backend/app.py`

当前布局是 `company-office-floorplan-v2`，有 36 个工位，主工位为 `desk-26`。运行时只在 `mainStation` 实例化一个新坐姿角色，不是 36 个独立角色。

现有六状态为 `idle / writing / researching / executing / syncing / error`。其中三个工作态共用 `working` 表情；`working` 是素材动作名，不新增同名业务 API 状态。

`/status` 是单主角状态；`/agents`、`/agent-push` 是另一套访客链路。后者当前包含 joinKey、审批和超时离线语义，不宜直接冒充正式员工用户状态。

因此本项目要同时做：**用户状态桥接 + 办公室多角色运行时**。保留既有主角/访客入口，不把所有用户轮流覆盖到 `/set_state`。

## 2. 产品目标与非目标

### 目标

- 一眼知道哪些用户在调用模型、哪些在等待、哪些最近调用失败。
- 每个用户固定对应一个角色和工位，多个 Key、模型、客户端仍归属同一个角色。
- 点击角色能看当前活动、最近调用和授权范围内的使用统计。
- 数据不可信或断开时明确显示“状态未知/数据已过期”，而不是假装全部待命。
- 动画服务出问题不影响 Sub2API 的模型调用、路由、计费或已有会话。

### 非目标

- 第一版不做员工绩效排名、真实考勤或“AI 工作效率”评分。
- 不读取、保存或展示用户提示词、回答正文、代码、文件路径和工具参数。
- 不把 HTTP 请求数量当任务数量，不把费用或 tokens 当真实完成进度。
- 不生成新角色素材、不接未通过验收的行走动画、不修改冻结的办公表情母版。
- 不根据模型名、调用间隔、耗时或 token 数猜“研究、写代码、开会、部署”。

## 3. 身份与绑定模型

```text
Sub2API 实例 + user_id（稳定身份）
  ├─ API Key A ─┐
  ├─ API Key B ─┼─ 聚合用户状态 ─ 一个 character_id ─ 一个 station_id
  └─ API Key C ─┘
```

建议绑定字段：

| 字段 | 用途 | 规则 |
|---|---|---|
| instance_id | 区分 Sub2API 实例 | 自定义稳定标识，不用可能变化的 URL 当主键 |
| user_id | 用户身份 | API 中用十进制字符串传递，保留 int64 精度 |
| character_id | 办公室角色身份 | 稳定 UUID；不随改名或更换皮肤变化 |
| display_name | 名牌 | 默认显式配置的别名；不默认公开邮箱 |
| scene_id / station_id | 地图和工位 | 显式绑定；工位冲突拒绝保存，不静默顶替 |
| character_asset_id | 角色皮肤 | 引用独立资源版本；允许换皮不换身份 |
| department | 展示部门 | 办公室配置，不直接等同于 API Key 的路由分组 |
| enabled / visible | 是否采集/显示 | 与 Sub2API 用户启停状态分开 |

约束：`(instance_id, user_id)` 与角色一对一；同场景一个工位最多绑定一个角色。账号改名或轮换 Key 不生成新角色。新用户进入“待绑定”列表，不自动占工位；用户禁用/删除后保留绑定历史并标记状态，不自动删除角色资产。

## 4. 插件提供的内容：三层交付

### A. 动画驱动层：第一优先级

| 内容 | 建议字段 | 来源与可信边界 | 画面用途 |
|---|---|---|---|
| 身份和工位 | character_id, user_id, display_name, station_id | 用户目录 + 绑定配置 | 稳定角色与名牌 |
| 活动状态 | activity | 用户并发快照；正式版为事件集合 | 待命、处理、等待、异常 |
| 当前并发 | active_requests | 快照或活动请求集合 | “处理中 × 3” |
| 排队数 | queued_requests | 明确的用户排队信号；不等于队列名次 | 等待表情和徽标 |
| 活动模型 | active_models | 需要在途事件；仅有历史用量时返回空/未知 | 角色详情和短气泡 |
| 最近活动 | last_request_at, last_finished_at | 已观察请求/完成记录，注明来源 | 最近一次调用时间 |
| 异常摘要 | alerts, last_error_category | 最终失败或明确账号状态；脱敏枚举 | 警示徽标和错误短动画 |
| 数据可信度 | source_mode, observed_at, stale_after_ms, data_valid, completeness | 采集服务与权威数据源 | 断线/过期覆盖层 |
| 渲染提示 | visual_state, state_since, label | 桥接层规则输出，不掩盖事实层 | 复用现有六状态素材 |

### B. 信息展示层：基础接入稳定后增加

- 今日调用数：成功、失败、取消分别统计；不能只用计费记录估算失败率。
- 输入、输出、缓存读写 tokens：分项展示，不未经验证相加成一个含糊的总数。
- 今日实际扣费：核对部署版本的计费语义；明确金额单位和倍率，不混用标价成本、上游成本、用户实际扣费。
- 可用余额、订阅/额度限制、Key 到期与限流提示：按限制范围记录，不能因为一个 Key 出问题就宣告整个用户不可用。
- 响应时间与首 token 耗时：允许 null，按窗口显示；不伪造实时 token 速度。
- 最近 20 条脱敏事件：开始、排队、输出、完成、失败、恢复。
- 办公室总览：已绑定用户数、正在处理人数、总并发、等待人数、告警人数；不给未经观测的“在线人数”。

用量和费用的权威来源是 Sub2API；桥接服务不重新计费。展示统计按 Asia/Shanghai 自然日查询，时间在接口中带时区/UTC 偏移；统计窗口、覆盖范围、最后更新时间必须可查。

### C. 任务语义层：需要客户端埋点，后续单独接

只有可信客户端主动上报时，才展示：

- `task_id / session_id`：外部工作任务和会话标识。
- `task_phase`：researching / writing / executing / waiting_user 等真实工作阶段。
- `task_label`：经用户许可的短标题；默认不从提示词提取。
- `progress`：仅当任务有真实总量/完成量；其他情况返回 null。
- `presence`：客户端心跳，区别于网关有无流量。

身份由服务器认证绑定，客户端不能通过任意填写 `user_id` 冒充其他角色。工具执行期间可能完全没有模型请求；模型响应结束也不代表任务完成。多客户端分别持有心跳/任务租约，再在用户层聚合。

## 5. 状态设计与动画映射

必须分开保留五类信息：

1. `activity`：idle / processing / waiting / unknown。
2. `request_phase`：queued / waiting_first_response / streaming / retrying / complete / failed / cancelled / unknown。
3. `account_status`：enabled / disabled / deleted / unknown；具体余额/额度/Key 问题放分范围的告警。
4. `presence`：online / offline / unknown。没有客户端心跳时默认 unknown。
5. `freshness`：fresh / stale / unavailable。

`visual_state` 只是动画兼容输出：

| 可信业务信号 | visual_state | 用户看到的解释 |
|---|---|---|
| 可信快照中无活动请求，且无有效任务上报 | idle | 待命/暂无模型调用；不推断客户端或其他任务状态 |
| 有请求处理中，但未细分阶段 | writing | 模型处理中；借用工作表情，不声称正在写文档 |
| 正在流式输出 | writing | 正在输出 |
| 只有排队请求或明确在等待首响应/重试 | syncing | 等待响应/排队/重试中 |
| 明确最终失败，且没有其他有效工作 | error（短暂） | 最近调用失败；随后待命并保留告警 |
| 客户端明确上报查资料 | researching | 查资料中 |
| 客户端明确上报执行工具 | executing | 执行任务中 |
| 客户端明确上报写作 | writing | 写作中 |
| 状态源过期/不可用 | 保留兼容帧 + stale 覆盖层 | 状态未知，不继续宣称“正在工作” |
| 用户禁用 | 中性静态帧 + disabled 覆盖层 | 用户已禁用，不伪装成模型错误 |

聚合规则：

- 有有效活动请求/任务时保持工作态；另一个请求失败只增加告警，不让所有工作中断。
- 并发阶段冲突：有效工具执行/明确任务语义与在途请求分别展示；不以任意最后一个事件覆盖用户事实。主气泡用“处理中 × N”，详情列出各活动。
- 最后一个活动请求结束后，建议保留约 2 秒视觉收尾，再待命；事实计数立即变零，收尾不是继续计时收费。
- 对一闪即逝的短请求可显示“刚完成一次调用”，不能在事后假装它仍在执行。
- error 动画建议 3–5 秒；限流重试属于等待，主动取消单独记录，不自动判为故障。
- 同状态刷新不能重置动画时钟；每个角色单独保存 state_since 与动画 epoch。
- 长时间没有模型请求只能说明无已观察到的网关活动，不代表用户下班或客户端已退出。

## 6. 推荐架构与开发路线

```text
Sub2API
  ├─ 已有用户目录 / 用户并发 / 用量 / 错误接口 ─┐
  └─ 后续最小请求生命周期事件扩展 ──────────────┤
                                              v
                              sub2api-office-bridge
                              ├─ 用户与角色绑定
                              ├─ 采集有效性和多请求聚合
                              ├─ 脱敏、权限、短期事件缓存
                              └─ 快照 + SSE + 轮询兜底
                                              |
                              办公室同源后端/访问代理
                                              |
                              Phaser 多角色运行时
```

### 路线一：只读 API 试接（用于最快验证，不宣称完整实时）

- 单个后端采集器批量读并发，不让每个浏览器按用户频繁请求 Sub2API。
- 建议起始频率：并发 2 秒一次；用户目录 60–120 秒；用量 30–60 秒。均为待负载验证的配置，不是既有性能保证。
- 必须显示 `source_mode=polling`、采集时间及质量；历史模型只能标为“最近使用模型”，不能标为“当前模型”。
- 能验证身份、工位、粗粒度忙闲、等待和统计布局；会漏掉两个轮询周期之间的短请求。
- 现有 best-effort 空结果无法完全证明无并发；没补可靠质量信号前，空闲只能是“未观测到活动/低可信”。不能作为精确状态验收版本。

### 路线二：正式版最小宿主事件扩展（推荐生产目标）

在真实部署对应的 Sub2API 源码版本中增加轻量只读遥测，不改变请求/响应、路由、配额和计费逻辑：

- 完成 Key 归属识别后建立内部唯一 logical_request_id 和 user_id。
- 记录用户排队开始/结束、转发开始、首个有效输出、最终完成/失败/取消。
- 通用 HTTP middleware 只能兜底开始/结束；流阶段和失败需从实际 handler/service 的解析结果发出。
- SSE keepalive 或响应头写出不等于首 token；流中错误即使 HTTP 为 200，也要记最终失败。
- 重试/切换上游是同一逻辑请求的 attempt，不重复创造员工或计数为多个客户端请求。
- WebSocket 按内部逻辑请求/响应周期记录，不按一条长连接永久计忙；异步媒体任务按 job 生命周期另行集成，不能用提交 HTTP 结束表示生成完成。
- 协议覆盖列表在第一步核对后冻结；没有观测器的路径显式标为 unsupported/unknown，不冒充已覆盖。
- 同时提供带质量标志的活动请求快照，负责断流、重启和丢事件后的校准。

事件发送走有界内存队列和异步出口；动画侧不可用时模型请求照常执行。允许遥测退化，但必须增加丢弃指标、标记 incomplete，并触发快照校准。不要为了“保证动画事件投递”把外部 HTTP/Redis 写入变成每次模型请求必须成功的条件。

### 为什么不直接交付现成 .s2plugin 包

当前宿主能力限制和用户事件缺口决定：仅打包一个 transport 插件无法完整实现该需求。若必须从 Sub2API“插件管理”安装，需要先设计并实现新的只读观测能力（例如拟议 `gateway.activity.observe.v1`）、事件/快照 HostService、权限与版本协商，再打包；该 capability 是本方案提议，不是上游现有功能。

## 7. 对外接口与数据契约（均为拟新增）

| 接口 | 用途 |
|---|---|
| GET /api/office/v1/bootstrap | 当前账号有权查看的绑定、用户状态、能力列表及对应事件游标 |
| GET /api/office/v1/characters | 批量角色状态，带版本、采集时间和质量 |
| GET /api/office/v1/characters/:id | 某角色当前活动、最近事件、可见统计 |
| GET /api/office/v1/events | SSE：角色变更、告警变更、来源质量变化、心跳 |
| GET /api/office/v1/health | 仅返回桥接运行/依赖健康摘要，不泄露用户信息 |
| PUT /api/office/v1/bindings/:id | 管理员保存用户、角色、工位映射；需审计与冲突校验 |
| POST /internal/office/v1/events | 后续服务端事件入口；独立写权限，不向普通浏览器开放 |

快照示例（虚构用户和计数，仅展示契约）：

```json
{
  "schema_version": 1,
  "character_id": "character-demo-42",
  "identity": {
    "instance_id": "sub2api-office-a",
    "user_id": "42",
    "display_name": "研发助手",
    "station_id": "desk-26"
  },
  "status": {
    "activity": "processing",
    "request_phase": "streaming",
    "visual_state": "writing",
    "label": "模型处理中 × 2",
    "account_status": "enabled",
    "presence": "unknown"
  },
  "workload": {
    "active_requests": 2,
    "queued_requests": 1,
    "active_models": ["example-model"],
    "task_phase": null,
    "progress": null
  },
  "alerts": [],
  "statistics": null,
  "telemetry": {
    "source_mode": "events",
    "completeness": "complete",
    "data_valid": true,
    "observed_at": "2026-10-02T15:30:00+08:00",
    "state_since": "2026-10-02T15:29:58+08:00",
    "stale_after_ms": 15000,
    "revision": 27,
    "cursor": "demo-stream:1042"
  }
}
```

SSE bootstrap 必须带一致性游标，订阅重放该游标之后的事件；游标过期返回 reset 并重拉快照，避免“读快照与建连接之间漏事件”。浏览器断开后指数退避重连；数据源心跳与 SSE 连接心跳分开，不能用连接还活着掩盖上游停采。

事件信封建议包含：schema_version、event_id、instance_id、producer_boot_id、sequence、logical_request_id、user_id、event_type、occurred_at、received_at，以及白名单 payload。按 request_id/boot_id 和序列幂等处理，终态不可被迟到 start 复活；桥接重启先拿权威快照。

活动请求使用集合/状态机聚合，不用无保护的 start +1 / end -1。租约用于故障恢复，但租约过期应标记未知并校准，不能把仍在运行的长请求自动当作成功结束。多 Sub2API 副本必须合并观察，不能只看某一个进程的内存。

## 8. 办公室前端需要改哪些地方

建议新增独立数据适配器和多角色管理器，名称待实施时确定：

- `OfficeStateClient`：bootstrap/SSE/重连/版本与 freshness 检查。
- `OfficeActorManager`：Map<character_id, actor>，绑定工位、创建/销毁、独立状态时钟。
- `OfficeActor`：复用现有 SeatedOfficePlayer，按角色独立生成或缓存表情纹理。
- `OfficeBindingsPanel`：用户选择、工位选择、角色皮肤、显示别名；先做简单配置，不另造管理大平台。
- `OfficeCharacterDetail`：先显示真实状态、并发和采集质量，统计后加。

不把 36 个角色的名字、状态都硬编码成“橘猫”。不更改家具锚点、桌前后遮挡和已确认的 12 帧表情。`/?scene=legacy`、原 `/status` 和访客模式保留；Sub2API 模式使用独立开关，停用后回到原有状态源。

未分配用户的工位保持空位。人数超出可用工位时提示容量不足，后续再考虑分页办公室，而不是叠人或移动已有角色。更新一个用户不得让其他角色动画重新开始。

## 9. 权限、隐私与存储

- 模型调用 Key、管理员 JWT、OAuth token、代理凭据不进入前端、不写入版本库、不放在 URL 查询参数中。
- 正式版使用专用只读 office scope，只返回授权用户的白名单字段；不能把计划中的权限当成宿主已经支持。
- 若现部署只有宽权限管理 API，需补最小只读接口/服务身份，或经明确接受风险后仅在受保护后端保存管理凭据做短期试接。HTTP 只发 GET 不意味着凭据本身只读。
- 内部事件写入口用服务身份与 mTLS/签名等可验证机制；限制来源、有效期、重放、请求大小和用户范围。普通用户只能读自己的角色；办公室负责人按授权列表读多个角色。
- 浏览器通过同源受控后端访问；绑定修改做 CSRF/权限校验和审计。默认不公开办公室人员/消费数据。
- 桥接层自己的绑定数据、事件缓存与 Sub2API 业务表隔离；不直接依赖或写入宿主未公开的 Redis key/数据库内部结构。
- 单副本试验可用 SQLite 存绑定 + 内存状态；正式多副本用独立 namespace 的持久配置/短期状态服务，并设置明确保留时间。
- 可审计事件仅保留必要元数据，建议默认最近 24 小时；不复制请求正文、回答、原始错误体、完整 IP/邮箱和 headers。

## 10. 分阶段开发与验收

### 阶段 A：冻结契约 + 只读试接

交付：版本/接口能力矩阵、角色绑定表、模拟数据、API 采集器、状态质量标识。

检查实际运行版本、业务 API 前缀和鉴权；确认用户并发接口的监控开关、缺失用户含义、失败降级以及用量字段。没有生产只读凭据时用明确标记的模拟数据完成本地联调，不冒充线上数据。

### 阶段 B：多角色 MVP

交付：同图至少 3 个绑定用户独立变化、待命/工作/等待/错误表情、并发徽标、过期覆盖层、绑定配置及回退开关。

用 API polling 可验布局和粗粒度观测，但不据此承诺捕获所有请求。保护所有现有未提交改动与冻结素材。浏览器验桌面和移动端缩放、遮挡、名牌与详情操作。

### 阶段 C：准确请求事件与稳定性

交付：部署版本适配的最小遥测补丁、活动请求权威快照、完整事件聚合、断线重放、日志与质量指标；对所有承诺支持的入口实际发请求验收。

- 目标：本地/内网测试事件到动画切换 p95 < 2 秒；这是验收目标，不是未测试的性能结论。
- 同一用户 3 个 Key、5 个并发请求：只显示一个角色，直到最后一个请求结束才待命。
- 不同用户同时请求：状态、统计、告警互不串用。
- 一条失败 + 一条成功进行中：仍工作，带错误徽标。
- 重试、多上游切换、重复事件、乱序、无 start 的终态：不重复计数、不负数、不复活已结束请求。
- 短请求、长流、SSE keepalive、流内失败、HTTP 200 中断、主动取消分别验证。
- WebSocket/异步媒体入口若纳入支持，必须以逻辑请求/job 做专门测试，未实现则公开 unsupported。
- 数据源停采、Redis 异常、桥接进程重启、浏览器重连：进入 stale/unknown 并正确恢复，不误报离线或空闲。
- 用量暂未落库：仍能及时显示结束，统计稍后补齐；费用按权威记录对账且不因重放重复计入。
- 插件完全关闭、队列满、网络中断：Sub2API 原请求内容、成功/失败语义、计费保持原行为；测量而不是仅声明性能不受影响。
- 越权读用户、伪造事件 user_id、未授权绑定、密钥泄露扫描全部纳入验收。

### 阶段 D：信息卡与任务语义

交付：经核对口径的用量/费用、额度提示、脱敏事件时间线。只有拿到真实客户端 hook 后，才加入 researching/executing、客户端在线和任务进度。

## 11. 第一版推荐范围

先做好八件事：用户绑定、固定工位、独立多角色、忙闲/等待/错误表情、并发数、最近调用提示、数据源健康、断线恢复。

费用/额度和复杂工具阶段不要阻塞第一版；但明确的用户归属、数据质量、权限隔离和不干扰模型请求不能推迟。

本轮没有连接或改动线上服务。后续部署仍需单独明确目标实例，备份配置/绑定，灰度接入少量用户，验证真实模型请求与持久化，保留关闭扩展即可回退的路径。

## 12. 核对来源（固定提交，避免随 main 漂移）

以下为源码定位；完整 URL 在代码块中记录，供后续复核。

```text
https://raw.githubusercontent.com/Wei-Shaw/sub2api/458b92abd4b0b09d123d4c6727dd8d59060bd883/backend/ent/schema/api_key.go
https://raw.githubusercontent.com/Wei-Shaw/sub2api/458b92abd4b0b09d123d4c6727dd8d59060bd883/backend/ent/schema/usage_log.go
https://raw.githubusercontent.com/Wei-Shaw/sub2api/458b92abd4b0b09d123d4c6727dd8d59060bd883/backend/internal/service/ops_concurrency.go
https://raw.githubusercontent.com/Wei-Shaw/sub2api/458b92abd4b0b09d123d4c6727dd8d59060bd883/backend/internal/server/routes/admin.go
https://raw.githubusercontent.com/Wei-Shaw/sub2api/458b92abd4b0b09d123d4c6727dd8d59060bd883/backend/pkg/pluginapi/v1/manifest.schema.json
https://raw.githubusercontent.com/Wei-Shaw/sub2api/458b92abd4b0b09d123d4c6727dd8d59060bd883/backend/pkg/pluginapi/v1/plugin.proto
```
