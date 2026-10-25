# 用户遥测 API v1

一个角色对应一个 Sub2API **终端用户**。只输出邮箱、用户名、API Key 元数据、recorded Token 总量和用户槽位并发；不输出成本、模型请求正文、明文密钥或动画状态。

## 消费端

`GET /api/v1/plugins/{installation_id}/user-telemetry`

`installation_id` 是上传响应中的数字安装 ID，不是 manifest 的字符串插件 ID。认证只接受专用 `s2ut_` 随机凭据；请求头传递，不能使用管理员 JWT、模型 Key 或 UI 资源 token。

| 参数 | 语义 |
|---|---|
| `user_ids` | 可选，逗号分隔 canonical int64 十进制字符串；省略为此凭据范围与当前批准范围的交集；显式越权返回 403 |
| `start` / `end` | 一起提供 RFC3339 时间，使用 `[start,end)`；最长 31 天，仅容忍一分钟时钟偏差，不允许更远的未来窗口。省略则为已配置时区当日零点至本次查询时刻 |
| `timezone` | 可选 IANA 时区；省略取已保存配置，默认 Asia/Shanghai |
| `page_size` | 可选 1..500；省略取已保存配置，默认 100；显式 0 不合法 |
| `cursor` | 上一页 `next_cursor`，按用户 ID 升序 keyset 分页 |

分批查询要复用首批响应的明确 start/end/timezone，避免每页默认结束时间改变。正常返回直接为版本化 Snapshot JSON，不包在管理员 API 的 data 外层。`Cache-Control: no-store`。

```json
{
  "schema_version":1,
  "window":{"start":"2026-10-03T00:00:00+08:00","end":"2026-10-04T00:00:00+08:00","timezone":"Asia/Shanghai"},
  "users":[{
    "user_id":"42","email":"fixture42@example.com","username":"研发助手",
    "api_keys":[{"id":"101","name":"工作A","status":"active"},{"id":"102","name":"工作B","status":"disabled"}],
    "token_usage":{"total":"210"},"concurrency":{"current":2,"limit":5},
    "quality":{"identity":"fresh","api_keys":"fresh","token_usage":"fresh","concurrency":"fresh"},
    "observed_at":{"identity":"2026-10-04T02:30:00Z","api_keys":"2026-10-04T02:30:00Z","token_usage":"2026-10-04T02:30:00Z","concurrency":"2026-10-04T02:30:00Z"}
  }],
  "next_cursor":null
}
```

以上是**测试 fixture 的形状示例，不是线上数据**。用户、Key、游标 ID 以及 Token 总量采用字符串，避免 JS 2^53 精度丢失。用户名为空时保留空串，不用邮箱造出“用户名”。

### 统计口径

- Token 总量为窗口内已入库 `input_tokens + output_tokens + cache_creation_tokens + cache_read_tokens`。各项先转 numeric；cache_creation 的 5m/1h 子项不重复计入。
- 统计按 user_id 汇总所有 Key，包含已删/轮换 Key 的历史用量；Key 元数据列表只列当前非删除的 Key。数据保留/清理决定可查历史，不是无限永久累计。
- 采样时间表示查询完成时刻，**不保证当前生成/异步写入的全部用量已经入库**。
- 并发是当前 **Sub2API 用户槽位占用**，不是 QPS、Key 数或上游账号并发。可观测路径中无槽位才是 0；读取失败为 `current:null, quality.concurrency:"unavailable"`；限制<=0 的不登记槽位路径为 `null/untracked`。
- disabled 用户仍可能有未结束请求，不能根据 status 强制归零。
- Token 读取失败为 `total:null/unavailable`、采样时间 null；成功且没有记录才是字符串 `"0"`。
- 身份/Key 元数据失败、每页超过 10000 个 Key 或响应资源上限会明确失败，**不返回假空列表或静默截断**。当前 runtime 总响应上限 2 MiB，宿主 RPC 上限 4 MiB。可减小用户页，但单用户自身超限仍会失败。

### 错误

400：格式、时间窗、页大小或 URL 凭据错误；401：缺失/错误/过期/撤销/跨安装凭据；403：用户范围不允许；429：认证/导出预算耗尽；503：插件未启用、未就绪、认证数据库不可用或查询失败。

不把 503/null 映射为“用户空闲”或“使用量为零”。已成功字段可以与明确未知的 Token/并发字段共存；身份/Key 不完整时整次请求失败。

## 管理凭据

管理路径均继承原有 adminAuth。创建/撤销挂载原有 step-up 中间件（按宿主已有开关语义，不在此强行开启 2FA）。

- `POST /api/v1/admin/plugins/{installation_id}/user-telemetry/credentials`

```json
{"name":"office-read-only","user_ids":["42","43"],"expires_in_seconds":3600}
```

必须显式非空范围：1..500，不重复 canonical ID；过期秒数 60..2678400；用户必须在当前批准范围。响应 201 的 `data.token` 只展示一次；数据库只存 SHA-256。不得在日志/前端持久化此秘密。

- `GET /api/v1/admin/plugins/{installation_id}/user-telemetry/credentials?page_size=100&cursor=...`

`data` 为 `{credentials:[...],next_cursor:null|"..."}`，按凭据 ID 降序，页大小 1..500。必须走完分页才能完成盘点；不会在第 1000 条静默隐藏旧凭据。列表没有明文 token/hash。

- `DELETE /api/v1/admin/plugins/{installation_id}/user-telemetry/credentials/{credential_id}`：立即撤销。
- `GET /api/v1/admin/plugins/{installation_id}/user-telemetry`：管理员审查输出，仍受插件批准范围。

每次外部读取均重新认证并与当前插件批准范围求交集，不缓存旧授权。凭据撤销对后续请求立即生效；已在认证时通过的请求仍受查询期限约束。配置缩小范围立即影响旧凭据；插件停用关闭输出；卸载级联移除凭据。

## 本轮未实现

不发 SSE/WebSocket/任务事件；不计算 working/rest/error；不改角色/地图；不做成本/账单；不拉取上游 OAuth 身份；不监听额外 HTTP 端口。后续动画侧只消费此 JSON，按 user_id 做映射。
