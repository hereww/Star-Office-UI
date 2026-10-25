> **历史冻结交付，已被 0.1.1 替代（2026-10-04）。** 下文“未部署/未取得 SSH/Linux 未运行”等描述是最初离线整理时点，不代表当前站点。随后 0.1.0 已实际安装、Linux 44/44 和生产 API 35/35 通过，但 HTTP LAN 配置 iframe 出现 randomUUID 缺失，已升级到 0.1.1。当前使用 `/Users/hepingyu/Documents/ChatGPT/sub2api/dist/user-telemetry-v0.1.1`；生产完整结果见 `/Users/hepingyu/Documents/ChatGPT/sub2api/docs/production-qa-20261004/INSTALLATION_STATUS_ZH.md`。本目录已恢复原 0.1.0 宿主补丁，未修改安装包/签名；`host.patch` 只是同一历史补丁的别名。当前 0.1.1 包另有公钥，不可混用。

# Sub2API 用户数据输出插件 0.1.0

日期：2026-10-04。插件 ID：`com.lvdong.user-telemetry`。

## 最重要的安装前提

这是**可由原生插件管理器安装的签名 `.s2plugin`，加必要的宿主兼容补丁**，不是独立监控服务，也不伪装成 OpenAI OAuth transport。

- 开发/验收基线：`Wei-Shaw/sub2api`，提交 `b8dece9000c68815a5b867ca5a1e6f236e173905`，源码版本 **0.2.13**。
- **该提交的原版宿主不支持用户遥测能力，会拒绝此包；必须先应用本目录的宿主补丁并重建。**
- 清单要求 `plugin_protocol=1`、`user_telemetry_api=1`、`ui_bridge=1`，没有 `transport_api`。`>=0.2.13 <0.3.0` 只是声明的版本边界，不代表所有未来版本已验证。
- 2026-10-04 已通过真实网站/API 核对线上版本为 **0.2.13**、插件列表为空、用户遥测路由返回404；现有SSH密钥未获授权，**尚未安装或替换线上宿主**。架构、镜像/提交和部署路径尚未现场核实。现场预检报告：`/Users/hepingyu/Documents/ChatGPT/sub2api/docs/production-qa-20261004/INSTALLATION_STATUS_ZH.md`。未接入办公室动画。
- 包含 Darwin ARM64、Linux AMD64、Linux ARM64 runtime。**仅 Darwin ARM64 完成实际子进程运行验收，两个 Linux 目标完成交叉编译及包验签，未在 Linux 上运行验收。**

## 交付文件

| 文件 | 用途 |
|---|---|
| `lvdong-user-telemetry-0.1.0.s2plugin` | 原生签名安装包，只含三种 runtime、UI、manifest 与 signature |
| `sub2api-user-telemetry-host.patch` | SDK/能力、受管生命周期、只读 reader、鉴权端点、DI、迁移、插件源码与测试 |
| `publisher-public-key.txt` / `plugins-trust.yaml` | 原始 32 字节公钥 Base64 / 合并信任配置示例 |
| `USER_TELEMETRY_API_ZH.md` / `snapshot.schema.json` | 消费接口、错误语义与版本化数据契约 |
| `ACCEPTANCE_ZH.md` / `native-acceptance.json` | 验收说明与真实隔离验收结果 |
| `patch-verification.json` | 干净基线应用补丁后编译/测试验证 |
| `browser-qa/` | 原生 UI 资源、真实配置读回与 runtime test 的浏览器证据 |
| `SHA256SUMS` | 发布文件校验和 |

## 安装流程

1. **先识别实际宿主的版本、提交、OS/架构与部署方式。** 与基线不同，先做适配，不要强制应用补丁或直接覆盖镜像。
2. 备份宿主配置、PostgreSQL、插件数据目录和当前镜像标签；备份中的秘密不得放入 Git 或聊天。保留原镜像/配置用于回滚。
3. 在匹配的干净源码副本先检查、再应用补丁：

```sh
cd /Users/hepingyu/Documents/ChatGPT/sub2api/host-source
git apply --check /Users/hepingyu/Documents/ChatGPT/sub2api/dist/user-telemetry-v0.1.0/sub2api-user-telemetry-host.patch
# 仅在匹配的、尚未应用本补丁的干净副本执行；当前开发目录已应用，不能再应用一次。
git apply /Users/hepingyu/Documents/ChatGPT/sub2api/dist/user-telemetry-v0.1.0/sub2api-user-telemetry-host.patch
```

4. 按宿主既有构建流程重建前后端。源码要求 **Go 1.27**，上游 Dockerfile/CI 使用 **pnpm 9**；不要为了迁就本机 pnpm 11/12 改写锁文件。当前已生成 Wire 注入文件，不必部署时重新生成。新增 `242_user_telemetry_credentials.sql` 由宿主迁移机制执行；它只新增遥测凭据表，不改用户/Key/用量记录。
5. 将 `plugins-trust.yaml` 中的**一个公钥条目**合并到已有 `plugins.trusted_publishers`；保留其他发布者和既有配置，保持 `allow_unsigned: false`。当前发行使用一次性本地构建签名，**私钥已销毁，不在源码、包或发行目录中**。长期生产发布请用自己安全管理的签名私钥和发布者 ID 重新签名。
6. 仅更新/重启 Sub2API 宿主服务，不需要重启 PostgreSQL/Redis，也不新增桥接服务。启动后确认迁移、现有登录与模型路由正常。
7. 管理员进入原生“插件”管理页上传 `.s2plugin`。初始状态是停用。配置窗口填写：

```json
{"allowed_user_ids":["42","43"],"timezone":"Asia/Shanghai","page_size":100}
```

用户 ID 必须来自实际终端用户，不是上游账号 ID，也不是 API Key ID。空白默认配置没有授权，不能启用。配置只接受这三个字段；不接受数据库口令、JWT、OAuth 或模型 API Key。

8. 保存配置，再启用插件。包未声明上游官方测试版本，页面可能显示未测试确认：这里只对固定基线+本补丁有本地验收，不应把它当成其他版本兼容承诺。
9. 通过受保护的管理 API 签发**独立只读消费凭据**，显式指定用户范围及有效期。已有 adminAuth 与 step-up 路由保留；启用 step-up 时须在当前真人管理员会话完成站内二次验证，不要为了脚本关闭安全开关。消费端用此凭据，不用管理员 JWT/模型 Key/UI token。
10. 用实际使用过模型的用户对账：邮箱/用户名、全部非删除 Key 元数据、同窗口 recorded tokens、实际槽位变化；错误/停用/过期凭据必须失败或明确未知。确认后再由动画侧按 `user_id` 绑定角色。本插件不生成动画状态。

## 回滚与卸载

- 优先在原生插件管理页停用/卸载；卸载级联删除该安装的遥测凭据，**不删除用户、API Keys、usage_logs**。
- 回滚宿主前保存需保留的插件配置，并恢复原镜像/信任配置。原版宿主无法运行此新能力，不要留下启用状态再声称仍有输出。
- 新表无须立即删除；如确需删除，先单独备份并确认删除范围。不要用验收脚本清理生产数据库。

## 权限与资源边界

只读指业务输出与 RPC 权限；管理配置/凭据会写控制表，采样并发会按宿主原有逻辑清理过期槽位。子进程隔离与签名校验**不是 OS 级沙箱**，不要信任未知来源发布者/二进制。

正式消费应使用 HTTPS 下的 `Authorization: Bearer ...`；HTTP LAN 可测试但没有传输机密性；消费端凭据放服务端，禁止写入动画前端、URL、截图和日志。认证前有每宿主 20 次/秒、突发 40、最多 16 在途预算；输出查询最多 8 在途、5 秒超时。多角色优先批量轮询，而不是每帧分别发请求。
