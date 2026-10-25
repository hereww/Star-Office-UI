# Sub2API 用户遥测插件：线上安装与验收结果

日期：2026-10-04（Asia/Shanghai）。站点：`http://192.168.100.221:8080/admin/plugins`。

## 结论

**已实际安装 0.1.1，安装 ID 为 `1`；验收末次读回为已启用、运行健康、可信发布者签名已验证。** 此文件替代此前“SSH 访问待提供、尚未安装”的前置检查结论；原始预检证据仍保留，不能用其旧状态代表当前结果。

开发按用户要求使用 GPT-6.1 Sol 子代理分模块完成，主代理集成、构建和实际部署；安全审计与 HTTP UI 修复限定复核按指定 GPT-6 Astra 调度。审计不是对全部代码或未来运行状态的安全认证。

## 范围与当前配置

- 一个角色对应一个终端用户 `user_id`，不是上游账号，也不是一把 Key。
- 只输出邮箱、真实用户名、API Key 的 **ID/名称/状态**、已入库 Token 总量、当前用户槽位并发及上限。
- **不输出 API Key 明文、成本、请求正文、动画状态或任务事件；未修改或接入 Star-Office-UI。**
- 保存并读回：`allowed_user_ids=["1"]`、`timezone="Asia/Shanghai"`、`page_size=100`。没有开放其余用户。
- 两个短期验收消费凭据均已撤销，最后盘点 **总计 2、撤销 2、有效 0**。管理员 JWT 等 API 测试认证值只在内存使用，收尾已重置 API REPL；保留用户已登录浏览器页面。

## 真实验收

| 项目 | 结果 | 证据 |
|---|---:|---|
| 生产 HTTP API | 37/37 | `api-acceptance-v0.1.1.json` |
| 真实已登录浏览器，桌面与手机 | 13/13 | `browser-acceptance-v0.1.1.json` |
| Linux amd64 隔离原生宿主/插件/PG/Redis | 44/44 | `linux-native-acceptance-v0.1.1.json` |
| UI Bridge 回归 | 14/14 | 发行目录 `qa/bridge-tests-final-20261004.log` |
| 签名打包工具回归 | 31/31 | 发行目录 `qa/packager-tests-final-20261004.log` |
| 干净基线 48 文件补丁、定向 Go 测试与 Linux 验收程序构建 | 通过 | 发行目录 `patch-verification.json`、`qa/clean-go-tests-final-20261004.log` |
| 三个平台包签名与全部 payload 哈希 | 通过 | 发行目录 `package-verification.json` |

真实数据按 PostgreSQL/Redis 对账，未造生产 fixture：

- 用户 `1` 的邮箱与数据库一致；**用户名实际为空字符串**，没有从邮箱或页头显示名推导补齐。
- 非删除 Key 元数据 **10 个**，字段只含 `id/name/status`，逐项与 PG 一致。
- 中国时区历史窗口 `[2026-10-03 00:00:00, 2026-10-04 00:00:00)`，2198 条用量记录，Token 总量 **`"328922024"`**，与四计数器 PG 聚合一致，不重复计入 cache_creation 的 5m/1h 子项。
- 当前并发在该次前后 Redis 夹取采样中为 **1**，上限 **5000**，遥测值一致。并发会变化，不应将该次快照当作现在固定值。
- 此真实历史窗口没有已删除 Key 的用量行；已删除 Key 的历史统计由隔离 fixture 覆盖，不冒充线上真实删除场景。

## 现场问题与修复

0.1.0 在 HTTP LAN 下的 sandbox 配置页无条件调用 `crypto.randomUUID()`，该非 secure context 中方法缺失，导致加载失败。0.1.1 优先使用 randomUUID，缺失时使用 `crypto.getRandomValues` 的安全随机请求 ID；保留来源、origin、bridge token、请求 ID、响应类型和超时检查。安全随机不可用时 fail closed，不使用 `Math.random()`。

修复重新编译并签名为新包，没有直接修改已签名包，也没有关闭验签。真实站点配置加载、重新加载和原生“测试”按钮均已通过；手机页面无水平溢出。

页面仍显示 **“未验证版本”**：签名 manifest 没有声明 `tested_sub2api_versions`，不是本环境没有做验收。首次启用使用明确的 `accept_untested:true`，保持版本确认门禁与签名/能力校验，没有为消除黄标改包。

## 宿主、数据保全与回滚

- 原 image 标签是 0.2.8，但自更新后真实运行二进制为 **0.2.13 / `3040209f205472038c1ba745a1bedd2edd9053b1`**，不能只按旧标签恢复。
- 当前宿主镜像：`local/sub2api:user-telemetry-0.1.0-3040209f-20261004`。宿主能力修订名 0.1.0 与插件发行 0.1.1 不冲突；本次插件修复未新增宿主能力。
- 必要的两次 app-only 切换分别为 2026-10-04 13:19:40、13:49:26（Asia/Shanghai），第二次为加载新的发布者公钥。保留 PostgreSQL、Redis 和其他 **10 个容器**，其 ID/StartedAt/镜像未变化，没有重启 Docker。
- 迁移数 291→292，唯一新增 `242_user_telemetry_credentials.sql`，已有迁移 checksum 保持；未回填/删除业务表。
- `.env` 和原 config 字段保留，`allow_unsigned:false`。原有 step-up/TOTP 开关未改变。宿主与插件均 UID/GID 1000。
- 最后盘点 users=8、api_keys=18、accounts=20（均含软删除）保持；usage_logs=59083，正常业务增长，不要求用量表不变。临时入站规则、隔离验收容器/network 残留为 0。
- 备份：`/root/sub2api-deploy/backups/pre-user-telemetry-20261004T040155Z`，包含真实旧程序、Compose/env/config/data、PG dump 等，已核对校验。
- 已保留真实旧 0.2.13 回滚镜像：`local/sub2api:pre-user-telemetry-20261004T040155Z`。回滚先停用插件并保存配置、安全排空，再只重建 app；**不要拉旧 latest 标签代替真实旧程序，也不要默认恢复整库覆盖之后的新业务记录。** 没有实际演练生产回滚。

## 明确的验收边界

1. 临时 app-only NEW TCP 拒绝规则不是绝对 HTTP admission gate；已有 keepalive 可以继续请求。观察到槽位为 0、已入库用量稳定且无活动 INSERT 后排空，没有直接取得 usage queue stats，不保证绝对零丢失。
2. 不进行生产故障注入、压力测试、卸载、实际回滚演练；0.1.1 的 Darwin arm64/Linux arm64 仅编译和验签，不是原生运行通过。
3. 浏览器未点击“保存/保存并测试”；配置保存通过真实管理员 HTTP API，浏览器正确读回。原生“测试”按钮已实际点击成功。
4. 本次站点的 step-up/TOTP 原本关闭，未验收开启后的真人二次验证场景。
5. 只读指业务输出/RPC 权限，不是 OS 级沙箱或零 Redis 写入；原并发读取会清理过期槽位。
6. 已在 HTTP LAN 完成测试；HTTP 不提供传输机密性。正式接入使用 HTTPS/受保护后端，专用凭据不得放 URL、动画前端、截图或日志。当前没有留下正式消费凭据。

发行目录：`/Users/hepingyu/Documents/ChatGPT/sub2api/dist/user-telemetry-v0.1.1`。原始 JSON、审计报告与真实截图保留在本报告所在目录。

## 收尾只读健康读回

2026-10-04 14:18:49（Asia/Shanghai）只读核对：Sub2API、PostgreSQL、Redis 均 running/healthy，`/health` 返回 `{"status":"ok"}`。未增加重启或配置变更；证据 `final-live-health-readback.json`。
