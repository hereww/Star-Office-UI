> **历史冻结交付，已被 0.1.1 替代（2026-10-04）。** 下文“未部署/未取得 SSH/Linux 未运行”等描述是最初离线整理时点，不代表当前站点。随后 0.1.0 已实际安装、Linux 44/44 和生产 API 35/35 通过，但 HTTP LAN 配置 iframe 出现 randomUUID 缺失，已升级到 0.1.1。当前使用 `/Users/hepingyu/Documents/ChatGPT/sub2api/dist/user-telemetry-v0.1.1`；生产完整结果见 `/Users/hepingyu/Documents/ChatGPT/sub2api/docs/production-qa-20261004/INSTALLATION_STATUS_ZH.md`。本目录已恢复原 0.1.0 宿主补丁，未修改安装包/签名；`host.patch` 只是同一历史补丁的别名。当前 0.1.1 包另有公钥，不可混用。

# 用户遥测插件 0.1.0 离线验收与发布校验

整理日期：2026-10-04。插件 ID：`com.lvdong.user-telemetry`。

## 1. 结论与适用范围

**结论：已有证据支持固定宿主基线加本包补丁后的本地隔离验收通过，不代表线上已安装、已部署或生产验收完成。** 离线文档整理读取已有本地报告与测试日志，补齐发布manifest和SHA-256清单；主代理另完成真实网站的只读登录/版本/插件路由预检及三平台包验签。没有重新签名或打包、没有安装或重启生产宿主、没有修改源码或Star-Office-UI。现场预检与离线验收分开记录，见 `/Users/hepingyu/Documents/ChatGPT/sub2api/docs/production-qa-20261004/INSTALLATION_STATUS_ZH.md`。

- 验收宿主：`Wei-Shaw/sub2api`，基线提交 `b8dece9000c68815a5b867ca5a1e6f236e173905`，源码版本 `0.2.13`。
- **必须先应用 `sub2api-user-telemetry-host.patch` 并重建宿主。原版固定基线不支持此遥测能力，会拒绝安装包。** 清单要求 `plugin_protocol=1`、`user_telemetry_api=1`、`ui_bridge=1`，不包含 `transport_api`。
- 声明的 `>=0.2.13 <0.3.0` 是兼容范围声明，不是整个范围的实测承诺。
- 原生验收环境是隔离 PostgreSQL、Redis、签名原生插件和 fixture 用户；不是生产数据。报告中上传、配置、启用、重启、撤销及卸载均发生在该隔离环境。
- **Darwin ARM64 已实际运行受管子进程；Linux AMD64、Linux ARM64 仅完成交叉编译及包验签，没有 Linux 原生运行验收。** 不得据此声称 Linux 部署就绪。
- **隔离浏览器验收不覆盖生产登录或真人step-up/2FA。** 其父页面使用disposable login bridge；主代理后续真实网站登录成功，但没有出现2FA挑战，不能据此宣称开启2FA时的管理链路已验证。
- **当前发布者的一次性签名私钥已销毁**，这是 `README_INSTALL_ZH.md` 明确记录的发布事实；本轮未搜索或读取私钥，也未重新签名。已有公钥仍用于验证现有包；后续发布需采用自己安全管理的私钥和发布者 ID，不能依赖已销毁私钥继续签发。

## 2. 证据索引

### 发布目录内的证据

| 文件 | 可支持的事实 | 不可推出的结论 |
|---|---|---|
| `README_INSTALL_ZH.md` | 基线、必需宿主补丁、三平台边界、私钥销毁、生产未部署 | 所有版本兼容或线上安装成功 |
| `native-acceptance.json` | `passed=true`；45/45 项隔离原生检查通过；fixture snapshot | 生产数据正确或真人认证通过 |
| `patch-verification.json` | 固定基线 `clean_apply=true`、`post_apply_compile=true` | 全量后端测试、其他基线可用、Linux运行通过 |
| `ASTRA_SECURITY_RECHECK_ZH.md` | 指定静态审计范围内修复与复核结论、9个定向单测通过的审计记录 | 全 runtime 安全认证、OS沙箱、生产压力测试 |
| `browser-qa/native-browser-qa.json` | 两种视口的真实插件 UI/config/runtime 证据；明确临时父登录桥 | 生产登录、2FA、真实管理员整页工作流通过 |
| `browser-qa/native-sandbox-900.png`、`browser-qa/native-sandbox-390.png` | 与浏览器报告配套的已存在截图文件 | 本轮重新完成视觉验收或秘密永不泄露 |

### 本机测试日志（未复制入发行包）

日志根目录：`/Users/hepingyu/Documents/ChatGPT/sub2api/.local/telemetry-acceptance`。以下文件为本轮只读核对对象，未读取数据库文件、信任配置中的秘密或运行时凭据。

- `native-acceptance.log`
- `patch-verification.log`
- `packager-tests.log`
- `ui-bridge-tests.log`
- `frontend-plugin-tests.log`
- `frontend-build.log`
- `audit-fix-tests.log`
- `main-integration-test.log`
- `go-vet.log`（0字节，仅能确认文件为空）
- `go-full-tests.jsonl`、`go-race-tests.jsonl`、`go-runtime-race-tests.jsonl`（主代理补充只读聚合核对）

## 3. 已完成测试、构建与证据限制

| 项目 | 已有结果 | 精确范围与限制 |
|---|---|---|
| 后端全量Go测试记录 | **12974 test/subtest pass，14 skip，0 fail** | `go-full-tests.jsonl`；54个包pass，59个无测试包skip；14个测试跳过有环境/外部依赖条件，不能当作通过 |
| 定向service/repository/plugin race记录 | **352 pass，1 skip，0 fail** | `go-race-tests.jsonl`，7个包pass；原transport runtime integration缺包跳过 |
| runtime/public/admin race记录 | **489 pass，0 skip，0 fail** | `go-runtime-race-tests.jsonl`，5个包pass；不是整个后端race覆盖 |
| 原生隔离端到端验收 | **45/45 通过** | JSON与日志一致；隔离PG/Redis、fixture用户、Darwin ARM64受管进程；逐项见第4节 |
| 干净基线补丁应用与编译 | **通过** | JSON记录clean_apply及post_apply_compile；下列日志包项不能扩展为全量后端测试 |
| 补丁验证Go测试包 | **5个包ok** | `pkg/usertelemetry`、`pkg/pluginapi/v1`、`cmd/user-telemetry-plugin`、`cmd/user-telemetry-plugin/internal/telemetry`、`cmd/server` |
| 验收命令包 | **无测试文件，非单测通过** | `cmd/user-telemetry-acceptance`在补丁/集成日志标记`[no test files]`；命令的实际端到端验收另由45项报告支持 |
| 签名打包器测试 | **30/30 通过** | 路径穿越、非规范归档、重复JSON、文件/哈希/模式、平台与清单校验、错误签名/公钥/无签名、二进制与UI篡改、私钥混入拒绝、原子输出、CLI及可复现包等；不代表本轮重新打包 |
| UI桥接测试 | **8/8 通过，0 skipped、0 todo** | 精确origin/source/token/ID校验、配置规范化、先保存再test、失败/超时反馈、拒绝未知字段、卸载清理、无外部资源或广域消息 |
| 管理员插件页面定向测试 | **1文件、2/2 通过** | `PluginsView.spec.ts`；不是整个前端测试集 |
| 前端i18n构建前测试 | **1文件、3/3 通过** | `localeKeyCompleteness.spec.ts`；构建日志包含这些测试 |
| 前端构建 | **通过** | 日志命令为`pnpm run check:i18n && vue-tsc -b && vite build`；Vite记录`built in 13.72s` |
| 安全修复测试日志 | **3个包ok** | `internal/handler/admin`、`internal/service`、`internal/repository`；日志没有逐个case数量，不将其冒充9个具名case的明细 |
| 主集成测试日志 | **2个包ok** | `internal/handler/admin`、`pkg/usertelemetry`；另1个命令包无测试文件 |
| Astra安全复核 | **限定范围复核完成** | 报告记载三个P2及假通过问题已修复，同范围未见残留必须修复的P0/P1/P2，并记载9个定向单测通过；不与其他包日志叠加计算独立用例总数 |
| 浏览器QA | **2/2 视口通过** | 900×900、390×844；原生UI加载、配置保存/读回、真实runtime test、sandbox allow-scripts、无横向溢出、无外部请求、无页面错误 |
| Go vet | **无法确认通过** | 仅有0字节`go-vet.log`，未见命令、退出码或独立成功报告；空日志不能单独证明成功 |
| Linux AMD64 / ARM64 | **交叉编译及包验签完成；运行未验证** | 平台完成情况依据安装说明；本轮没有执行Linux二进制 |

**已有非致命警告保留，不粉饰为“零警告”：** 前端定向测试有localStorage实验性警告及Browserslist数据陈旧提醒；构建有Browserslist提醒、5处动静态导入分块警告及大于500 kB的chunk提醒。最终测试/构建成功记录存在，但本轮未修复这些警告。

## 4. 45项原生隔离验收的完整清单

以下名称逐项来自`native-acceptance.json.checks`，每项`passed=true`，并与本地验收日志成功结论一致。HTTP状态及重启/卸载结果均为隔离环境事实。

1. **通过** — `signed-package tampering rejected`
2. **通过** — `native plugin-management upload`。记录：HTTP 201
3. **通过** — `publisher signature verified and initially disabled`
4. **通过** — `configuration saved through native manager`。记录：HTTP 200 
5. **通过** — `native independent read-only runtime enabled`。记录：HTTP 200 
6. **通过** — `native UI resource session issued`
7. **通过** — `signed-package UI served with sandbox CSP`
8. **通过** — `UI resource token cannot export user data`
9. **通过** — `native sandbox browser desktop and mobile`。记录：real signed UI + resource/CSP/config handlers; disposable parent login bridge
10. **通过** — `export denies unrelated credential absent`
11. **通过** — `export denies unrelated credential admin token`
12. **通过** — `export denies unrelated credential model key`
13. **通过** — `export denies unrelated credential UI token`
14. **通过** — `credential issue refuses ambiguous empty scope`
15. **通过** — `scoped export credential issued`。记录：HTTP 201
16. **通过** — `expired credential refused`
17. **通过** — `credential cannot cross plugin installation`
18. **通过** — `URL bearer disclosure refused`
19. **通过** — `credential inventory exposes explicit cursor`
20. **通过** — `credential inventory can reach oldest active credential`
21. **通过** — `five-field snapshot from live PostgreSQL and Redis`。记录：HTTP 200 
22. **通过** — `only requested page and stable user IDs`
23. **通过** — `real token total includes multiple and deleted historical keys`
24. **通过** — `live concurrent user slots = 2`
25. **通过** — `API metadata is complete without deleted key`
26. **通过** — `email and blank username retained`
27. **通过** — `no model or admin secrets in export`
28. **通过** — `pagination and >2^53 ID preservation`
29. **通过** — `unlimited concurrency not fabricated as zero`
30. **通过** — `slot release changes count to one`
31. **通过** — `confirmed no slots returns real zero`
32. **通过** — `user-scope escape rejected`
33. **通过** — `oversized query rejected`
34. **通过** — `credential list has no token or hash`
35. **通过** — `scope narrowing revokes old credential user permission immediately`
36. **通过** — `approved scope restores through native configuration lifecycle`
37. **通过** — `HTTP omitted defaults follow saved timezone and page size`
38. **通过** — `fixture defaults restored`
39. **通过** — `Redis failure produces unknown concurrency`
40. **通过** — `persisted installation and scope recover after host restart`。记录：HTTP 200
41. **通过** — `native management route revokes credential`
42. **通过** — `credential revocation takes immediate effect`
43. **通过** — `new scoped credential usable after restart`
44. **通过** — `disable closes output endpoint`
45. **通过** — `uninstall revokes credentials without deleting business data`

其中数据对账覆盖：邮箱与空用户名保留、非删除Key元数据、多个Key及已删除历史Key的真实token合计、超过2^53的用户ID、分页、并发槽位2→1→0、无限制并发不伪造零、Redis失败返回unknown、保存配置中的默认时区/页大小生效。不得将fixture对账迁移成生产用户对账结论。

## 5. 明确未完成、跳过或未提供证据的项目

- **Linux原生运行与Linux浏览器/宿主部署验收未执行。** 两个Linux目标的交叉编译不能替代实际进程启动、依赖、权限、生命周期和导出验证。
- **生产登录本轮已成功，但开启step-up时的站内二次验证/2FA未验证。** 既有adminAuth与step-up开关语义保留，不宣称所有管理操作始终强制2FA。
- **没有生产安装、部署、重启、配置或遥测凭据签发。** 已核对网站版本和未注册遥测路由，服务器SSH认证失败；镜像/提交/架构仍未知。生产备份、迁移、回滚、模型路由回归与真实用户对账需要服务器访问后继续。
- 未接入办公室动画、未修改Star-Office-UI，也没有动画侧按`user_id`绑定的验收。
- 后端全量及两组定向race已有JSON事件日志并已核对；不是整个后端race覆盖。前端只有构建及定向测试证据；`[no test files]`不是通过的测试用例。
- 未提供Go vet退出状态；不能把无输出默认记为通过。
- 静态安全复核不是全runtime安全认证；没有OS级沙箱认证、真实生产压力测试或所有未来版本兼容性验证。
- 本轮未重跑全量功能测试，三平台安装包签名/哈希已重新验证通过；新SHA清单只证明文件内容一致性，不自行证明安全性或来源真实性。

## 6. 安全与安装门槛（待部署方执行，本轮未操作）

1. 识别实际宿主版本、提交、OS/架构与部署方式。匹配固定基线后，在干净副本检查并应用本包宿主补丁、重建；不同基线必须先适配，不能强行套用。
2. 备份既有配置、PG、插件数据与镜像标签并保留回滚方案。迁移仅新增遥测凭据表的说明来自安装文档，不代表生产迁移已执行。
3. 仅将当前公钥条目合并至已有可信发布者配置，保留其他发布者，保持`allow_unsigned: false`。已销毁私钥不可恢复为后续发布凭据；后续使用自己安全管理的新签名材料和发布者身份。
4. 插件默认停用，配置只允许`allowed_user_ids`、`timezone`、`page_size`；必须显式批准实际user_id范围。消费凭据范围与当前批准范围取交集，模型Key、管理员token、UI资源token不得作为消费凭据。
5. 在真人已认证管理员会话验证原有adminAuth/step-up策略；勿为了脚本关闭安全开关。仅通过HTTPS Authorization头使用独立消费凭据，不放URL、动画前端、截图或日志。
6. “只读”限定业务/RPC输出；管理控制表写入及原有并发槽位过期清理仍存在。签名校验及子进程隔离不等于OS沙箱。
7. 待经授权的真实环境验证完成后，才能给出该环境的安装/生产验收结论；不要使用隔离验收脚本清理生产业务数据。

## 7. 发布文件校验与无循环清单规则

离线发布整理新增`ACCEPTANCE_ZH.md`、`RELEASE_MANIFEST.json`、`SHA256SUMS`；主代理在实际网站预检后同步更新本文、安装说明与发布清单。`.s2plugin`及宿主补丁原始字节保持不变，未重打包、未重新签名。

- `RELEASE_MANIFEST.json.files`记录14个有效载荷文件（原有13个文件加本验收文档）的相对路径、字节数、SHA-256。**manifest不包含自身，也不包含SHA256SUMS**，以避免交叉哈希循环。
- `SHA256SUMS`记录上述14个文件及`RELEASE_MANIFEST.json`，共15条。**SHA256SUMS不包含自身**。
- 顺序是先验收文档，再manifest，最后SHA清单。目录内最终共16个文件；按相对路径排序，递归纳入browser-qa文件，不将`.local`日志或任何秘密加入发行清单。
- SHA清单与manifest不是额外的数字签名。攻击者同时修改内容和清单仍可能重新计算哈希；来源真实性仍依赖可信公钥及现有`.s2plugin`签名，而非这些文档。

离线核对命令（只读；不启动宿主、不安装插件）：

```sh
cd /Users/hepingyu/Documents/ChatGPT/sub2api/dist/user-telemetry-v0.1.0
shasum -a 256 -c SHA256SUMS
```

还应确认manifest的每条`size_bytes`、`sha256`与对应文件一致，manifest无自身条目、SHA清单无自身条目、两份清单的文件集合符合上述规则。缺文件、额外发行文件或哈希差异均需先查清，不能以“校验通过”掩盖。
