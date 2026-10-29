# 独立通用 API 开发说明

本文档描述 `api_service/`。它是 Star Office UI 的 provider-neutral 接入层，
用于团队工具向项目推送代理状态，或由办公室页面读取统一快照。服务默认不连接
Sub2API，也不要求安装 Sub2API、数据库、Redis 或任何外部遥测组件。

## 1. 边界

独立 API 只保存两类数据：

- 代理的最新状态投影：`id`、展示名、状态、说明、区域、来源和非敏感 metadata。
- 已接收事件：事件 ID、类型、发生时间、来源和规范化数据。

API 不接收或保存密码、模型 Key、Bearer token、Cookie、上游原始响应、用户邮箱、
计费信息或 Sub2API 凭据。Sub2API 可以作为未来的外部 provider adapter，但不会出现在
默认启动路径中。当前办公室 `/api/office/*` 契约保持独立；通用 API 使用 `/api/v1/*`，
避免两个版本体系互相覆盖。

```text
团队工具 / CI / Agent
          │ POST /api/v1/events 或 PUT /api/v1/agents/{id}
          ▼
standalone-api :19100 ── SQLite（事件 + 最新状态）
          │ GET /api/v1/agents、/snapshot
          ▼
Star Office UI 适配层或其他项目
```

## 2. 本地启动

要求 Python 3.10+，复用仓库已有的 Flask 依赖：

```bash
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r backend/requirements.txt
API_DATA_FILE="$PWD/.local/api-service/state.sqlite3" \
  python -m api_service.app
```

默认监听 `127.0.0.1:19100`。也可以使用：

```bash
API_BIND=127.0.0.1 API_PORT=19100 api-service/run.sh
```

正式环境使用进程管理器加载 `api_service.wsgi:app`，例如：

```bash
gunicorn --workers 2 --bind 127.0.0.1:19100 api_service.wsgi:app
```

服务首次启动会创建 SQLite 文件并设为仅当前用户可读写。生产部署应把
`API_DATA_FILE` 放在独立数据卷中，备份前停止写入或使用 SQLite 在线备份，升级后用
`GET /api/v1/readiness` 和一条只读快照请求做读回验证。

## 3. 配置

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `API_BIND` | `127.0.0.1` | 监听地址；对外发布应放在反向代理之后 |
| `API_PORT` | `19100` | 监听端口 |
| `API_DATA_FILE` | `.local/api-service/state.sqlite3` | SQLite 数据文件 |
| `API_AUTH_MODE` | `none` | `none` 仅适合本机开发；生产使用 `key` |
| `API_SERVICE_KEY` | 空 | `key` 模式下的服务间密钥，至少 24 个字符 |
| `API_KEY_FILE` | 空 | 密钥文件，与 `API_SERVICE_KEY` 二选一，权限设为 0400/0600 |
| `API_ALLOWED_ORIGINS` | 空 | 精确逗号分隔的 CORS 来源；空值表示不启用 CORS |
| `API_SNAPSHOT_STALE_SECONDS` | `30` | 快照最后事件超过此秒数后标记 `stale` |

不要把密钥写进请求 body、仓库、日志或前端 bundle。`API_AUTH_MODE=key` 时，业务端点
接受 `Authorization: Bearer <key>` 或 `X-API-Key: <key>`；健康端点仍可匿名访问。

## 4. 端点契约（v1）

所有业务响应都带 `X-Request-ID`。错误统一为：

```json
{
  "error": {
    "code": "INVALID_REQUEST",
    "message": "事件格式无效。",
    "request_id": "a1b2c3"
  }
}
```

### `GET /api/v1/health`

存活检查，不访问外部 provider。成功返回 `200`：

```json
{"status":"ok","service":"star-office-api","api_version":"1","schema_version":1,"generated_at":"2026-10-30T08:00:00Z"}
```

### `GET /api/v1/readiness`

检查 SQLite 可读写和鉴权配置。`ready=true` 返回 `200`，否则返回 `503`。健康为 ok
不代表已有业务事件或快照是 fresh。

### `GET /api/v1/config`

返回非敏感能力和协议版本，不返回密钥、文件路径或运行时异常：

```json
{
  "api_version":"1", "schema_version":1, "auth_mode":"key", "provider":"standalone",
  "snapshot_stale_seconds":30,
  "capabilities":["agents.read","events.write","events.read","snapshot.read"]
}
```

### `GET /api/v1/agents`

查询最新代理投影。支持 `state` 和 `limit`（1–200）：

```json
{
  "schema_version":1,
  "agents":[{
    "id":"agent-1", "name":"研发代理", "state":"writing", "detail":"处理中",
    "area":"writing", "source":"team-service",
    "updated_at":"2026-10-30T08:00:00Z", "metadata":{"team":"dev"}
  }]
}
```

状态枚举为 `idle`、`writing`、`researching`、`executing`、`syncing`、`error`、`offline`。
`unknown` 只能由消费端在没有可信状态时显示，不能作为写入状态。

### `POST /api/v1/events`

推荐的写入方式。事件 ID 是幂等键；重放同一个 ID 返回 `200` 且 `created=false`，不会
重复写入事件。新事件返回 `201`。

```json
{
  "event_id":"evt-20261030-agent-1-0001",
  "type":"agent.state_changed",
  "occurred_at":"2026-10-30T08:00:00+08:00",
  "source":"team-service",
  "agent":{
    "id":"agent-1", "name":"研发代理", "state":"writing",
    "detail":"处理中", "area":"writing", "metadata":{"team":"dev"}
  },
  "metadata":{"request":"build-42"}
}
```

服务会把带时区的时间规范化为 UTC `Z` 字符串。metadata 只能是少量标量值；包含
`token`、`secret`、`password`、`credential`、`authorization`、`api_key`、`cookie`、`email` 或 `user_id`
等字段会被拒绝。`occurred_at` 不能超出服务时钟未来 5 分钟；请求体上限为 256 KiB。

### `PUT /api/v1/agents/{agent_id}`

为简单客户端提供直接状态写入。body 字段与事件中的 `agent` 相同，并且必须提供
`event_id` 或 `Idempotency-Key`。需要审计、重试或多消费者时优先使用事件端点。

### `GET /api/v1/events`

读取已接收事件，支持 `since=<ISO-8601>` 和 `limit`（1–200）。返回顺序为最近接收的
事件优先；消费者应使用自己的 checkpoint，不能把 `sequence` 当作跨实例公共 ID。

### `GET /api/v1/snapshot`

返回适合项目适配层消费的 provider-neutral 快照：

```json
{
  "schema_version":1,
  "generated_at":"2026-10-30T08:00:05Z",
  "source":{"provider":"standalone","status":"ok","freshness":"fresh","last_event_at":"2026-10-30T08:00:00Z"},
  "agents":[{"id":"agent-1","name":"研发代理","state":"writing","detail":"处理中","area":"writing","source":"team-service","updated_at":"2026-10-30T08:00:00Z","metadata":{"team":"dev"}}]
}
```

`freshness` 为 `fresh`、`stale`、`empty` 或 `unknown`。消费端在 `stale`/`empty` 时应显示
未知或离线状态，不要推断为 idle。

## 5. 接入现有项目

团队服务可直接推送事件：

```bash
curl -fsS -X POST http://127.0.0.1:19100/api/v1/events \
  -H 'Authorization: Bearer <API_SERVICE_KEY>' \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: evt-20261030-agent-1-0001' \
  --data @event.json
```

Star Office UI 的接入层只需要读取 `/api/v1/snapshot`，再将 `agents` 映射到现有办公室
的座位绑定和 UI 状态。不要把 API 密钥放进浏览器；浏览器应访问项目后端的同源代理，
由后端注入 `Authorization`。座位、角色、显示设置仍由现有 `/api/office/admin/config`
管理，通用 API 不修改这些配置。

最小 Python 客户端示例：

```python
import os
import requests

base = os.environ["OFFICE_API_BASE_URL"].rstrip("/")
headers = {"Authorization": f"Bearer {os.environ['API_SERVICE_KEY']}"}
snapshot = requests.get(f"{base}/api/v1/snapshot", headers=headers, timeout=3).json()
if snapshot["source"]["freshness"] != "fresh":
    raise RuntimeError("API snapshot is stale")
```

## 6. Provider/适配器约定

通用 API 接收的是规范化事件，provider 只负责把外部系统转换成上述事件。适配器必须：

1. 为每条状态变化生成稳定、可重放的 `event_id`。
2. 保留原始发生时间和时区，不能用轮询时间伪造 `occurred_at`。
3. 只发送允许字段，先在适配器侧删除凭据、邮箱、原始响应和计费字段。
4. 对 `408`、`429`、`502`、`503` 使用有限指数退避；重试必须复用同一 `event_id`。
5. 遇到 `400` 先修复契约，不要无限重试；遇到 `401`/`403` 停止并告警。

Sub2API 适配器若以后需要开发，应放在独立 integration 目录，通过这个事件契约接入，
不能把 `/api/v1/plugins/...` 路径、Sub2API 凭据或宿主响应直接暴露给本服务客户端。

## 7. 测试与验收

```bash
python -m unittest scripts.test_api_service -v
python -m compileall -q api_service scripts/test_api_service.py
curl -fsS http://127.0.0.1:19100/api/v1/health
curl -fsS http://127.0.0.1:19100/api/v1/readiness
```

验收至少包括：匿名 health、readiness、key 鉴权、事件校验、重复事件幂等、状态查询、
快照 freshness、请求 ID、超大请求拒绝、敏感 metadata 拒绝，以及 SQLite 文件权限。
健康检查通过不能替代事件写入和快照读回；部署切换后应使用一条实际事件写入、重复提交、
`GET /agents` 和 `GET /snapshot` 完成闭环验证，再宣布接入完成。

## 8. 错误与运维边界

客户端应按错误码处理：`INVALID_REQUEST`（修正请求）、`UNAUTHENTICATED`（重新注入密钥）、
`NOT_FOUND`（检查 ID）、`REQUEST_TOO_LARGE`（拆分 payload）和 `INTERNAL_ERROR`（携带
`request_id` 查服务日志）。服务日志只记录异常类型和 request ID，不记录请求 body、密钥或
上游内容。

备份时保留 SQLite 文件和当前环境配置的受控副本；回滚时停止新进程、恢复数据文件、启动
旧版本并读回 readiness/agents/snapshot。不要通过删除数据库来“清理”未知状态，也不要把
`api_service` 的数据目录放入 Git。
