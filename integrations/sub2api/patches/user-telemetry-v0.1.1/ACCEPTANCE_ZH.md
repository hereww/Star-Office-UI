# 用户遥测插件 0.1.1 验收

日期：2026-10-04（Asia/Shanghai）。结论：**已安装、已启用、健康、签名可信；用户 1 范围内的真实输出及 HTTP 页面配置加载通过。** 本报告不代表动画已接入、所有宿主版本兼容或所有平台原生运行通过。

## 证据矩阵

| 环境/测试 | 已通过 | 证据 |
|---|---:|---|
| 真实生产 HTTP API | 37/37 | `qa/api-acceptance-v0.1.1.json` |
| 真实已登录生产浏览器 | 13/13 | `qa/browser-acceptance-v0.1.1.json` |
| Linux amd64 隔离原生宿主、签名插件、PG、Redis | 44/44 | `qa/linux-native-acceptance-v0.1.1.json` |
| 本地合成消息 Bridge 回归 | 14/14 | `qa/bridge-tests-final-20261004.log` |
| 签名打包工具单元回归 | 31/31 | `qa/packager-tests-final-20261004.log` |
| 7 个定向 Go package + Linux amd64 验收程序构建 | 通过（Go 复跑缓存命中） | `qa/clean-go-tests-final-20261004.log` |
| 干净基线补丁 check/实际 apply、48 文件与 canonical 字节一致 | 通过 | `patch-verification.json` |
| 前端定向/i18n 17 测试、typecheck、Vite build | 通过（Sol 独立干净副本） | `qa/source-validation.json` |
| darwin-arm64 / linux-amd64 / linux-arm64 的签名及全部 payload 哈希 | 通过 | `package-verification.json`、`qa/package-verify-final-*.json` |

0.1.1 仅 Linux amd64 有本轮隔离原生运行和生产证据；其余两平台仅编译/验签。历史 0.1.0 的 Darwin 本地验收不能替代本版原生验收。测试缺少外部 PG 条件而跳过的两项定向 Go 测试，不计入执行通过；关键 PG 统计和凭据语义另由 Linux 原生 fixture 与真实生产对账覆盖。

## 真实站点

安装 ID `1`，版本 `0.1.1`，最后读回 `enabled / healthy / trusted`。批准配置仅 `allowed_user_ids=["1"]`、`Asia/Shanghai`、page_size=100。对应角色主键为 user_id，不按邮箱、显示名或 Key 做角色主键。

真实 PostgreSQL/Redis 对账：

| 输出 | 实测 |
|---|---|
| 用户身份 | 用户 1，邮箱与 PG 一致；username **空字符串**，没有推导填充 |
| API Key | 当前非删除元数据 10 个，字段仅 id/name/status，全部与 PG 一致 |
| 历史 Token | 2026-10-03 00:00:00+08:00 至 2026-10-04 00:00:00+08:00，半开窗口；2198 行，total=`"328922024"` |
| 当前并发/限制 | 该次采样 current=1，limit=5000；前后 Redis regular=1/live=0，遥测一致；动态值不是永久常量 |

Token = input + output + cache_creation + cache_read，先转 numeric，不重复加 5m/1h 子项，表示窗口内已入库用量，不保证异步队列已经全入库。真实该窗口已删除 Key 的用量行数为 0；删除 Key 历史统计用隔离 fixture 检查。

消费凭据与边界：

- 两版各签发一个 600 秒测试凭据，两个已撤销，最后有效数 **0**。仅存 32 字节 SHA-256，不落盘 token；API REPL 收尾重置。
- 无凭据、错误专用凭据、真实管理员 JWT、模型 Key 格式、实际 UI resource token 拒绝；user2 越权 403。
- URL 凭据 400，测试只使用 dummy 值，没有将真实 token 放 URL。
- page_size=0、不完整时间窗、超过 31 天时间窗 400；签发越界范围拒绝。
- 原生 disable 后管理员和外部导出 503；enable 恢复；真实撤销后 401。插件配置 API 保存和读回成功。

## 真实浏览器

- 直接使用已登录生产 `/admin/plugins`，不是 disposable_login_bridge 或静态沙盒冒充生产。
- 0.1.1 在真实 HTTP opaque sandbox 加载保存配置，source/origin/token/request_id 绑定与脚本独占 sandbox 保留。
- 实际点击原生“测试”成功；配置“重新加载”成功；启用状态禁止卸载，没有无关 OAuth 流量比例滑块。
- 桌面及手机截图在 `qa/`。手机请求 390×844，原生滚动条后有效 CSS 宽为 382、scrollWidth=382；iframe=332/332，无横向溢出。
- **没有点击 GUI“保存/保存并测试”**；保存以真实管理员 API 验证，GUI 读回正确。临时 viewport 已恢复。

“未验证版本”黄标是 manifest 缺少 tested_sub2api_versions 的原生文案，不是无验收；明确 accept_untested 确认后启用，确认门禁仍保留。没有放宽签名/能力检查。

## 审计和修复记录

GPT-6.1 Sol 子代理开发，GPT-6 Astra 调度执行限定只读审计与复核。初期凭据范围、认证前预算、凭据盘点分页问题修复后复核没有必须修复的 P0/P1/P2；HTTP UI 修复及 packager 显式版本选择的限定复核亦没有必须修复项。

本版针对 HTTP 非 secure context 下 randomUUID 缺失，新增 getRandomValues 的128位随机 ID + 序号回退；保留所有消息绑定和 15 秒超时；安全随机失败即关闭桥接，不使用 Math.random。重新编译/签名，不直接篡改旧签名包。

审计源码范围与生产验收是不同证据，不把静态“未发现问题”说成零风险或整个 runtime 安全认证。审计报告的模型自证限制保留；模型选择依据主代理实际调度，不依赖报告文件名。

## 部署、遗留与未验收事项

- 两次必要 app-only 切换；PG/Redis 和其他 10 个容器 ID/StartedAt/image 保留，原业务用户8/Key18/上游账号20数量保持。用量正常增长。
- 仅增加一个凭据表迁移，291→292；旧 ledger checksum 不变。配置/原信任条目保留，allow_unsigned=false。
- 备份与真实旧 0.2.13 回滚镜像留存，见 `qa/deployment.json`。没做实际回滚、生产卸载、压力或故障注入。
- 临时 NEW TCP 拒绝不是绝对 HTTP admission gate；观察槽位0/已入库用量稳定30秒，不宣称测得 usage queue=0、保证绝对零丢失。原程序正常退出，没有 observed forced shutdown。
- 最后临时gate、隔离容器/network残留0；宿主/子进程UID/GID1000；两个测试凭据撤销、active0。
- 先前一次隔离验收 harness 仍硬编码旧 publisher，导致1.1被拒绝；加显式 --publisher-id 后重跑44/44。初错证据保留在 `qa/linux-v0.1.1-initial-harness-publisher-mismatch.json`。
- 本地最初 Git archive QA 未独立初始化，git apply 在外层仓库跳过路径，assert 拦住；修正后真正应用并核对48文件。两个旧测试进程共写旧日志，日志不能作证；用唯一新日志重跑通过，旧日志留作 instrumentation 记录，不属于生产故障。
- 本次 step-up/TOTP 原本关闭，没测开启后的真人二次验证。没测其他宿主版本或 Darwin/Linux arm64 原生运行。没有接动画，没有正式消费 token。
- 只读不是 OS 沙箱或零 Redis 写；HTTP LAN 测试不等于 HTTPS 防护。正式消费使用受保护后端/HTTPS，凭据不入动画前端/URL/日志/截图。
