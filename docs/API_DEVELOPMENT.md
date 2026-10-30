# 公司项目接入 API 开发文档

本文面向**调用 API 的项目开发者**。公司项目可以直接上报遥测，不需要安装、调用或配置 Sub2API。Office 后端已提供 standalone 适配器，继续使用新版办公室的工位、角色和公开快照。

适配基准：`office-workspace-20261030-04` 的前端契约。本文对应本分支代码；合并代码不会自动更新现有服务器。部署、密钥发放和工位映射由服务维护者按 [运维说明](TEAM_API_OPERATIONS.md) 完成。

## 1. 交接时向服务维护者领取什么

| 项目 | 示例 | 说明 |
| --- | --- | --- |
| API 地址 | `https://office-api.company.example` | 已部署的 HTTPS 源站，不包含接口路径 |
| project_id | `company` | 凭据授权的项目；不是 Sub2API 用户或插件 ID |
| subject_id | `developer-1` | 稳定的成员、Agent 或服务标识；双方确认映射后使用 |
| 项目写入凭据 | 通过受控方式单独发放 | 仅在公司项目后端使用，不放入浏览器、Git 或日志 |

服务维护者负责把 subject_id 绑定到办公室工位。同一主体可以显示在多个工位。调用方不需要提交工位、角色图片或布局，也不需要改办公室前端。

首次交接必须确认上表配置已提供、服务已部署，并用一条开发环境观测完成写入及办公室读回。只拿到仓库或本文，不代表某个线上地址已经启用新 API。

## 2. 数据链路和开发者需要完成的工作

```text
公司项目后端：读取真实指标，每 5 秒采样
  → POST /api/v1/projects/{project_id}/telemetry
  → 独立 API 校验、幂等、保存最新观测
  → Office standalone 采集器和工位映射
  → /api/office/snapshot
  → 新版办公室：状态气泡、模型、Token、角色、设备间
```

调用方负责采集和汇总数据；API 不代理模型请求、不自动扫描项目、不自行计算模型用量。

- 并发：当前仍在处理的请求数，完成、失败、取消都应释放计数。多个进程先汇总，再由一个写入者发布同一 subject。
- 用量：北京时间当日累计的绝对值，从项目的持久化记录统计并去重；避免重复计算缓存子项。API 不把每次上报的 total 相加。
- 模型：仅正在处理的请求，按 requested_model / upstream_model 汇总请求数；不从历史请求猜测当前模型。
- 不能提供的指标使用 unavailable 或 untracked；不要用 0 代替未知。
- 即使业务状态没有变化，也每 5 秒重新观测并上报。只有重新测量的指标才能更新其 observed_at。

这是一条完整主体观测接口，不是局部 PATCH；每次都提交全部指标组。

## 3. 写入接口

`POST /api/v1/projects/{project_id}/telemetry`

请求头：

```http
Authorization: Bearer <项目写入凭据>
Content-Type: application/json
Idempotency-Key: <与 body.event_id 相同；此头可省略>
```

以下时间仅用于展示字段；实际请求使用采样时间：

```json
{
  "schema_version": 1,
  "event_id": "evt-company-developer-1-0001",
  "subject_id": "developer-1",
  "observed_at": "2026-10-30T08:00:00.000000Z",
  "service_state": "ready",
  "identity": {
    "name": "研发成员",
    "quality": "fresh",
    "observed_at": "2026-10-30T08:00:00.000000Z"
  },
  "concurrency": {
    "current": 3,
    "limit": 20,
    "quality": "fresh",
    "observed_at": "2026-10-30T08:00:00.000000Z"
  },
  "today_usage": {
    "total": "9007199254740993",
    "date": "2026-10-30",
    "timezone": "Asia/Shanghai",
    "window_end": "2026-10-30T08:00:00.000000Z",
    "quality": "fresh",
    "observed_at": "2026-10-30T08:00:00.000000Z"
  },
  "active_models": {
    "models": [
      {"requested_model": "company-model", "upstream_model": "actual-model", "requests": "3"}
    ],
    "quality": "partial",
    "observed_at": "2026-10-30T08:00:00.000000Z"
  }
}
```

| 字段 | 类型及约束 | 含义 |
| --- | --- | --- |
| schema_version | 整数 1 | 此遥测契约版本；与 Office 快照的版本体系独立 |
| event_id | 1–128 位标识 | 每次新观测生成新 ID；网络重试使用原 ID |
| subject_id | 1–128 位稳定标识 | 不要为每个请求创建新主体 |
| observed_at | 带时区 ISO 8601 | 此次主体观测时间；指标时间不得晚于它 |
| service_state | ready / degraded / offline / unknown | 被观测服务的状态，用于设备间；独立于业务忙闲 |
| identity.name | 字符串，最多 120 字符 | 允许公开显示的名字；不是邮箱或凭据 |
| concurrency.current | 0–9007199254740991 的整数 | 当前并发；必须来自可信观测 |
| concurrency.limit | 1–9007199254740991 的整数 | 项目为该主体配置的并发上限 |
| today_usage.total | 非负十进制字符串，最多 80 位 | 保留精度，不转换为 JavaScript Number |
| today_usage.date / timezone | YYYY-MM-DD / Asia/Shanghai | 北京时间当日窗口 |
| today_usage.window_end | 带时区时间 | 统计已覆盖到的时间，不得晚于用量 observed_at |
| active_models.models | 最多 32 项 | 相同请求模型与上游模型只能出现一次 |
| requested_model | 1–200 字符 | 调用方请求的模型名称 |
| upstream_model | 字符串或 null | 实际模型名；无法取得映射时为 null |
| requests | 正十进制字符串，不超过 int64 | 该模型的当前请求数 |

标识必须匹配 `[A-Za-z0-9][A-Za-z0-9._:-]{0,127}`。同一 subject_id / event_id 可在不同项目使用，彼此隔离。单个规范化观测最多 16 KiB；传输层硬上限 256 KiB。每个项目最多 500 个稳定主体，超限返回明确错误，不会静默丢弃。

时间统一保存为 UTC，精度到微秒。时钟最多容忍领先服务端 5 秒；未来观测在其时间到达前不作为可信状态。新观测应使用递增时间；同主体同一时间但数据不同返回 409。

## 4. 质量、心跳与未知值

identity、concurrency、today_usage 支持 fresh / unavailable / untracked；active_models 还支持 partial。

| quality | 含义 |
| --- | --- |
| fresh | 此字段组已成功观测，值可信 |
| partial | 仅模型字段使用，当前覆盖部分请求链路 |
| unavailable | 本次无法取到数据 |
| untracked | 项目尚未实现该指标的采集 |

未知组必须保留完整结构，将业务值和 observed_at 设为 null；模型列表设为 []。例如：

```json
{
  "concurrency": {"current": null, "limit": null, "quality": "untracked", "observed_at": null},
  "today_usage": {"total": null, "date": null, "timezone": null, "window_end": null, "quality": "untracked", "observed_at": null},
  "active_models": {"models": [], "quality": "untracked", "observed_at": null}
}
```

这只是三个字段组的示例；实际 POST 仍要包含主体信息和 identity。

默认 15 秒过期，可由服务维护者配置。每个主体和每项指标分别判断时间。一个主体更新不会使其他主体恢复可信；发送心跳不会自动刷新旧指标；昨天的 Token 不会显示成今天。offline 会使该主体的业务指标不可用。

可信 current=0 表示休息。新版按并发显示：1–2 工作中、3–4 忙碌中、5–8 玩命干活中、9 及以上狂暴模式；未知显示未知。调用方不需要提交 writing 等动画状态。

## 5. 成功、幂等和错误处理

首次事件返回 201：

```json
{
  "accepted": true,
  "created": true,
  "applied": true,
  "project_id": "company",
  "subject_id": "developer-1",
  "event_id": "evt-company-developer-1-0001",
  "observed_at": "2026-10-30T08:00:00.000000Z"
}
```

同项目、相同 event_id 和相同内容重试返回 200、created=false。JSON 对象键的顺序不影响幂等。重复响应的 applied 表示原事件是否应用过，不表示又执行了一次。迟到事件可被接受，但 applied=false，不覆盖较新状态。

幂等记录默认保留 7 天。event_id 应使用 UUID 等长期唯一值，不要在窗口之外循环复用。重试必须复用整个原始请求，包括时间和指标，不能只复用 event_id 后重新采样。

| 状态码 | 处理 |
| --- | --- |
| 400 | 字段、类型或时间错误；修正后用新事件发送，禁止盲重试 |
| 401 | 凭据无效；停止发送并联系维护者 |
| 403 | 项目或读写权限不匹配；不要更换路径绕过 |
| 409 CONFLICT | ID 复用了不同内容，或同时间出现冲突观测；检查写入者和采样逻辑 |
| 409 CAPACITY_EXCEEDED | 主体已达 500 个；联系维护者调整项目划分 |
| 413 | 传输请求过大；单个规范化观测超过 16 KiB 会返回 400 |
| 408 / 429 / 500 / 502 / 503 / 504 或网络超时 | 有限退避后重试原请求，建议最多 3 次 |

错误响应为 `{"error":{"code":"...","message":"...","request_id":"..."}}`，响应头也有 X-Request-ID。问题反馈提供状态码、request_id、事件 ID，不提供密钥或完整业务请求。

## 6. 可直接使用的 Python 客户端

[examples/team_api_client.py](../examples/team_api_client.py) 只使用 Python 标准库，已处理超时、有限重试、重试请求不变和禁止携带密钥跟随重定向。

```python
import json
import os
from pathlib import Path
from examples.team_api_client import TeamAPIClient

config = json.loads(Path(os.environ["TEAM_API_CONFIG"]).read_text())
client = TeamAPIClient(
    os.environ["TEAM_API_BASE_URL"],
    config["project_id"],
    config["key"],
)
# observation 为第 3 节定义的完整观测，由公司项目读取真实指标后构造。
result = client.publish(observation)
assert result["accepted"] is True
```

维护者交付的 producer.json 包含 project_id、subject_id、key，属于秘密文件，权限 0600，不进版本库。客户端返回失败时由公司项目决定告警或暂存；不阻塞模型请求的主业务流程，也不要无限堆积重试。

## 7. 查询与联调

- `GET /api/v1/health`：进程存活，无需凭据。
- `GET /api/v1/readiness`：数据库写入能力与鉴权配置，无需凭据；不能代替业务验收。
- `GET /api/v1/openapi.json`：机器可读 OpenAPI 3.1 文档，无需凭据。
- `GET /api/v1/projects/{project_id}/snapshot`：需要单独的 telemetry:read 凭据；返回 complete=true、全部 subjects 和各组 freshness。写入凭据访问它返回 403，是预期的权限隔离。

快照中的过期值是保留的历史观测，调用方必须读取 freshness。Office 适配器会在公开快照中清空过期指标；不要直接把项目快照作为浏览器数据源或把写入密钥交给前端。

[OpenAPI 文件](../api_service/openapi.json) 可导入兼容 OpenAPI 3.1 的客户端工具。服务端还检查时间先后、时区窗口和同时间冲突，这些跨字段规则以本文及错误响应为准。

开发交接验收：

1. 写入真实开发环境样本，收到 201；重试原请求收到 200。
2. 同事与维护者确认同一个 subject 在指定工位显示正确名字、并发、模型和 Token。
3. 停止上报，超过有效期后显示未知，不能继续显示旧的工作状态。
4. 恢复上报后恢复；未知指标仍显示未知，可信零显示休息或零用量。
5. 换成另一项目地址或使用写入凭据查询，返回 403。
6. 使用大整数字符串、模型映射和 partial 样本验证展示不丢精度和语义。

## 8. 旧状态接口的关系

`/api/v1/events`、`/agents`、`/snapshot` 是原有代理状态接口，保留用于兼容。**公司项目接新版办公室应使用本文的 projects/telemetry 接口。** 旧 agents 快照不是 Office stations 快照。

旧 PUT 现在必须提供 occurred_at，路径 ID 可作为 body.id 的默认值，未知字段被拒绝。旧事件支持 after_sequence 顺序分页，代理支持 after_id；快照带 complete / next_cursor 和每个代理的 freshness。旧接口需要另外配置 API_SERVICE_KEY 或 API_KEY_FILE，项目凭据不能用于访问它们。

团队接入不需要调用任何 `/api/v1/plugins/...` 接口。
