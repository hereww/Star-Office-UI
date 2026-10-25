# Sub2API 用户遥测插件 0.1.1

日期：2026-10-04（Asia/Shanghai）。插件 ID：`com.lvdong.user-telemetry`。

**已在 `http://192.168.100.221:8080/admin/plugins` 实际安装：安装 ID 1，已启用/健康/签名已验证。** 此目录是当前交付；0.1.0 为历史包，HTTP 配置页兼容问题已被本版替代。

## 做什么，不做什么

一个角色对应一个 Sub2API 终端用户。输出邮箱、真实用户名、API Key **ID/名称/状态**、已入库 Token 总量、当前用户槽位并发/上限。用户和 Key ID、Token 总量为十进制字符串；字段失败明确报错或 unknown，不伪装为零。

不暴露明文 Key、不读取模型请求正文、不计成本、不发动画状态或任务事件、不改办公室工程。没有独立桥接服务或额外监听端口。

## 必要的宿主前提

这是**原生插件管理器可安装的签名 `.s2plugin` + 必需的宿主兼容补丁**，不是在原版 Sub2API 上只上传一个包即可运行。

- 开发/干净应用基线：`Wei-Shaw/sub2api`，`b8dece9000c68815a5b867ca5a1e6f236e173905`，0.2.13。
- 清单要求 `plugin_protocol=1`、`user_telemetry_api=1`、`ui_bridge=1`；没有 `transport_api`，不伪装成 OpenAI OAuth transport。
- **原版 0.2.13 不具备该新能力，会拒绝安装；须先匹配本目录宿主补丁并重建前后端。** `>=0.2.13 <0.3.0` 只是声明边界，不保证所有未来版本兼容。
- 线上真实提交 `3040209f205472038c1ba745a1bedd2edd9053b1` 与基线仅 VERSION 文件不同；构建显式保留 0.2.13。生产 image 旧标签 0.2.8 不是运行二进制版本。
- 线上已完成宿主适配；不要在现有开发目录或生产环境再次应用补丁。

## 交付文件

| 文件/目录 | 用途 |
|---|---|
| `lvdong-user-telemetry-0.1.1.s2plugin` | 三平台 runtime、UI、manifest 和签名的原生安装包 |
| `sub2api-user-telemetry-host.patch` | SDK、受管生命周期、reader、鉴权路由、DI、迁移、插件源码和测试；干净基线 48 文件 |
| `publisher-public-key.txt` / `plugins-trust.yaml` | 原始 32 字节 Base64 公钥及新增信任条目示例；不是完整生产配置 |
| `USER_TELEMETRY_API_ZH.md` / `snapshot.schema.json` | Snapshot v1 契约、统计口径、错误与凭据管理 |
| `ACCEPTANCE_ZH.md` / `qa/` | 生产 API、真实浏览器、Linux 隔离验收、收尾测试、截图 |
| `ASTRA_SECURITY_RECHECK_ZH.md` / `ASTRA_HTTP_UI_RECHECK_ZH.md` | 初期凭据安全及本版 HTTP UI 修复的限定审计 |
| `patch-verification.json` / `package-verification.json` | 补丁应用/构建及三平台签名/哈希检查 |
| `tools/` | 本版可选签名打包工具及 31 项回归；已有包无需重签 |
| `RELEASE_MANIFEST.json` / `SHA256SUMS` | 发行内容、已测平台/边界、逐文件校验；校验清单本身不是数字签名 |

包 SHA-256：`33af87e484d9cb490c575fcb2ffb710f890d3f63d4a1cd0e231533e65319c980`。

## 在其他宿主安装

1. **识别真实运行版本/提交/OS/架构与部署方式，先备份。** 留存真实当前程序、Compose/env/config、插件数据、PG dump 和回滚镜像。不要依据 image 标签或盲拉 latest。
2. 在与基线匹配、已独立初始化 Git 的干净源码副本执行 `git apply --check` 后实际应用本目录补丁；确认 48 文件完整存在。Git archive 解压目录如果仍落在外层 Git 仓库内，必须先建独立仓库，不能把“全部 skipped”当通过。
3. 按既有构建流程重建前后端：Go 1.27，上游 Dockerfile/CI 使用 pnpm 9；保留锁文件和实际版本。当前已生成 Wire 文件。唯一新迁移 `242_user_telemetry_credentials.sql` 由宿主执行，只新增遥测控制表，不修改业务用户/Key/用量。
4. 将公钥条目 `lvdong-user-telemetry-v1-011` **合并**到已有 `plugins.trusted_publishers`，保留原条目与配置，保持 `allow_unsigned:false`。`plugins-trust.yaml` 不得整份覆盖 config。若宿主仅启动时读取信任配置，安全排空后只更新 app；不必重启 PG/Redis/Docker。
5. 在原生“插件管理”上传本目录签名包，初始停用。配置必须填实际终端用户的批准范围，例如：

```json
{"allowed_user_ids":["1"],"timezone":"Asia/Shanghai","page_size":100}
```

空范围不授权。只接受这三个字段；不接收数据库密码、管理员 JWT、OAuth 或模型 Key。线上仅授权用户 1，其他用户需另行明确批准。

6. 保存并测试，确认后启用。签名 manifest 没有 `tested_sub2api_versions`，原生卡片仍会显示“未验证版本”；本目录对固定基线/本环境有独立验收，不代表所有版本。批准此次确知兼容的未声明版本时使用原生确认流程；不要关闭验签、改 manifest 或重签只为了去掉黄标。
7. 管理 API 签发独立专用只读消费凭据，显式用户范围与有效期；保留宿主 adminAuth/step-up 原有语义，若要求真人二次验证须在当前会话完成，不为自动化关闭安全开关。
8. 消费接口使用 `Authorization: Bearer <专用消费凭据>`，**不是管理员 JWT、模型 Key、UI resource token**。按 `USER_TELEMETRY_API_ZH.md` 对账同窗口 PG/Redis；之后动画侧按 `user_id` 绑定角色。

本版一次性构建私钥已销毁，不在包/源码/发行目录中。未来发行需使用自己安全管理的私钥与发布者 ID；本次直接安装已有签名包即可，不需要重新签名。

## 当前站点与运维

- 已启用 0.1.1，user_id 1；时区 Shanghai、page_size 100。
- 两个验收凭据已撤销，active=0；此交付不包含可用消费 token。正式动画接入时再签发最小范围凭据。
- 备份：`/root/sub2api-deploy/backups/pre-user-telemetry-20261004T040155Z`。
- 真实旧 0.2.13 回滚镜像：`local/sub2api:pre-user-telemetry-20261004T040155Z`。先停用插件、保存配置、安全排空，再只恢复 app；不默认恢复整库覆盖新记录。生产回滚未演练。
- 优先原生停用/卸载；启用状态的卡片禁止直接卸载。卸载级联删除该安装的消费凭据，不删用户/Key/usage_logs；本次没有在生产执行卸载。
- 新表无需立即删除；删除需单独备份与确认，不用验收脚本清理生产。

## 安全与性能边界

HTTP LAN 的真实配置加载已通过；HTTP 仍不提供机密性。**正式消费建议 HTTPS/受保护后端**；凭据不放 URL、动画前端、截图和日志。每角色每帧查询不可取，应批量低频查询。

认证前预算为每宿主 20 次/秒、burst 40、最多 16 在途；导出最多 8 在途、5 秒超时。只读是业务/RPC 权限，不是 OS 沙箱或零 Redis 写入，槽位读逻辑会清理过期项。签名只确认来源/字节，不使未知发布者二进制变得安全。

验收细节及未做事项见 `ACCEPTANCE_ZH.md`；线上报告绝对路径：`/Users/hepingyu/Documents/ChatGPT/sub2api/docs/production-qa-20261004/INSTALLATION_STATUS_ZH.md`。
