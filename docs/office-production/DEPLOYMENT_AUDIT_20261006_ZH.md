# 律动实时办公室：审计整理与服务器部署交付

**日期：2026-10-06，Asia/Shanghai。技术上线验收通过；管理员设备首次 CA 信任仍需设备所有者完成。**

## 1. 正式发布结论

| 项目 | 本轮确认结果 |
|---|---|
| 服务器 | `192.168.100.221` |
| 员工入口 | `http://192.168.100.221:19000/`，仅办公室局域网 |
| 管理入口 | `https://192.168.100.221:19443/admin`，独立 HTTPS 登录 |
| 正式不可变发布 | `office-20261006-v5-production-06` |
| 发布目录 | `/opt/star-office-ui/releases/office-20261006-v5-production-06` |
| 两个服务真实镜像 ID | `sha256:4b26b4d71939fdfd8176814ec5bb05af3d4fbef158b75084c0e1ebd2ba3e196e` |
| 应用监听 | `127.0.0.1:19011`，不直接对外开放 |
| 独立入口服务 | `star-office-ingress.service`，active、开机启用 |
| 最后状态比对 | 2026-10-06 23:09 CST；最终 API 复验 23:03 CST、末次健康复核 23:10 CST |
| 配置持久化 | v2，版本历史 2 条、配置审计 2 条，SQLite `quick_check=ok` |
| 已批准采集范围 | 用户 `1,4,7,8`；没有签发新凭据、没有扩展范围 |

交付范围是已经确认的 **V5、红区 8 席＋绿区 8 席、固定坐姿/表情/屏幕效果**。
保留工位方向、角色、设备替换及气泡，不做行走，不恢复手部/键盘动画。
正式员工页、管理页的版本文案一致。旧原版办公室和其他业务容器继续运行，没有被本轮部署覆盖。

这是内网技术交付，不是公网发布、全栈漏洞认证、全 WCAG 合规声明、物理手机兼容认证或资产商业授权。

## 2. 审计发现与已完成修复

| 发现 | 修复及验证 |
|---|---|
| 生产入口仍加载 V4 | 切换到 V5 runtime/adapter；共享遥测桥改为显式 runtime 工厂，避免降级 V5 原型链。16 席和 4 个绑定通过真实浏览器检查。 |
| Web 和 collector 的批准用户范围可能不一致 | 两者必须显式设置同一 `OFFICE_USER_IDS`；不再默默退回默认单用户。现场只读确认批准范围 `1,4,7,8`。 |
| 员工 HTTP 内网不具备 SubtleCrypto，可能使地图初始化崩溃 | 不在非安全上下文调用不可用的接口；只把运行时溯源标为 `unavailable-in-insecure-context`，不伪造成功 hash。发布包和镜像的 SHA 验证仍强制执行。 |
| 发布依赖扫描误把屏幕终端展示文字当资源 | 排除终端提示前缀展示字符串，并增加回归测试；实际运行时依赖闭包仍校验。 |
| Docker local context 在归一化 mtime/等长改动时出现旧字节复用 | 构建改用 tar 流上下文；包内清单、镜像构建阶段、构建后隔离容器、两个真实运行容器均核对 96 个源文件 SHA/大小。错误候选被拒绝，没有清理共享 build cache。 |
| 宿主 Nginx 检查通过但启动失败 | 为实际包含 ngx_lua 的宿主 binary 设置已安装的 Lua 库路径；部署独立办公室 wrapper，不启动宝塔旧总配置，不加载无关 vhost。 |
| 根路径文件 alias 拼接错误 | 员工首页改为 `root + try_files`；release 目录可由 Nginx worker 遍历，private 目录仍受限。 |
| 管理 `/admin` 返回 `application/octet-stream`，浏览器开始下载 | 最后实机浏览器检查发现；设置显式 `text/html`，补充该位置的 nosniff/frame headers，增加回归测试。生成新的不可变发布 06，不修改 05 的冻结字节。真实登录页面和登录/退出 9 项验证通过。 |

最终 06 与 05 的入包原始 backend/frontend 字节一致；唯一原始发布源文件差异是 Nginx 模板。
96 个入包原始源文件与本地现有源码一致，28 个入包图像文件逐字节保留，没有重绘、重编码或替换已批准素材。

初期候选 01–03 不作为生产或验收结论；04/05 留作历史操作证据。最终 06 是本报告唯一正式发布。

## 3. 测试与实机验收

### 3.1 本地/回归：354 项通过

| 类别 | 结果 | 证据 |
|---|---:|---|
| Python 后端、配置、权限、采集、发布包及新增 MIME 回归 | 191/191 | `evidence/deployment-20261006/tests/backend-191.log` |
| 前端及 V5 生产遥测桥 | 98/98 | `evidence/deployment-20261006/tests/frontend-98.log` |
| 浏览器运行时/V4 兼容及 V5 screen-only 回归 | 65/65，无 skip | `evidence/deployment-20261006/tests/runtime-65.log` |

前端/运行时两组在 05 发布前通过；06 的原始 backend/frontend 文件 SHA 与 05 全部相同，且最终 06 再次经过下面的实机检查。
191 项 Python 回归包括最后新增的管理 MIME 回归，在 06 打包前重新运行。

### 3.2 最终 06 实机：46 项通过

| 类别 | 结果 | 边界 |
|---|---:|---|
| 员工 LAN 浏览器 | 19/19 | 桌面、平板、手机横/竖屏；只 GET/HEAD，测试注入仅存在于该浏览器内，不修改线上文件。 |
| 最终 HTTPS/API | 18/18 | 正常验证 CA 链和服务器 IP；负向 PUT 均拒绝，配置 v2 → v2，没有再次保存或增加配置版本。 |
| 管理登录 UI | 9/9 | 隔离 Chrome 进程只 pin 该服务器的精确 SPKI；无 config save，最后主动 logout/revoke。**不等于管理员 OS 已信任证书。** |

员工端确认：V5、16 席、4 个批准绑定；无行走、hands 或 keyboard 层；高 DPI canvas；CJK 字体加载；无横向溢出；绿区四个用户名/并发气泡可见；无 JavaScript 错误、缺失资源、外域资源请求或后台写入。

API 确认：未登录拒绝、员工 HTTP 无管理/legacy 写入口、local fixture 不公开、Secure/HttpOnly/SameSite=Lax 的 session cookie、独立管理员登录、CSRF 缺失 403、跨域 403、旧配置版本 409、精确配置读回、批准范围、HTML MIME、16 席快照以及登出后 401。
Cookie `Path=/` 用于已审计的 legacy 兼容路径，**不是 Strict 或 API-only cookie**。

初次验收曾完成一次同内容保存 v1 → v2，并立即 GET 精确读回；绑定、显示和采集内容未改变。
这次真实写入证据保存在 `api-initial-versioned-save.json`。最终 06 的 18 项报告另存 `api-acceptance.json`，没有重复 bump 版本。

实际采样时间连续向前推进，source 状态 `ok`。员工公开 snapshot 未出现邮件、用户 ID、Key、凭据、请求正文等被禁止的字段。

### 3.3 视觉/交互审计：16/20

此评分仅是本轮范围内的工程审阅，不是第三方认证：

| 维度 | 评分 | 依据及未覆盖项 |
|---|---:|---|
| 可访问性 | 3/4 | 已见跳转链接、按钮/输入名称、状态语义；可见输入缺失标签为 0。canvas 的全面键盘/读屏体验与完整对比度审计未覆盖。 |
| 性能 | 3/4 | 资源同源、本地依赖、不可变静态缓存、高 DPI 上限；四设备测试 ready 样本约 1.8–2.5 秒，包含脚本等待，**不是冷启动性能基准**。 |
| 响应布局 | 3/4 | 模拟桌面/平板/横竖手机无横向溢出、四气泡可见；最小可见按钮高度 36 px，触控优化建议向 44 px 靠拢。这是 UX 目标，不把 44 px 假称为所有 WCAG AA 的强制要求。 |
| 主题一致性 | 3/4 | 保留已批准办公室美术、品牌绿和明亮控制台；目前既定 light 模式，canvas 部分固定色，未扩展深色主题。 |
| 反模式控制 | 4/4 | 未大改已接受方案；未知不伪装为 0；配置草稿/服务端版本分离、保存读回；未引入行走、手部动画、外域依赖或无关装饰。 |

已人工检查最终全景、手机视图及登录截图，未见阻断使用的错位或视觉故障。
绿区 QA 截图使用浏览器注入对象直接切视图，toolbar 仍可能显示全景选中；这是测试操作方式，不是以截图证明 UI 按钮切换故障。

## 4. 服务、网络和秘密隔离

- 新服务：`star-office-production-office-web-1`、`star-office-production-office-collector-1`。
- 同一真实镜像、UID/GID `10001:10001`、只读 rootfs、cap_drop ALL、no-new-privileges；均为 healthy。
- 持久卷保持：`star-office-production-office-data`、`star-office-production-legacy-data`。
- 独立 ingress 仅监听办公室端口，LAN 范围 `192.168.100.0/24`；应用本身只绑定 loopback。
- 原有 19000 防火墙 rich rule 未更改；仅添加 19443 的同范围 runtime/permanent rule，没有全局防火墙 reload 或广泛开放。
- 主配置 `/opt/star-office-ui/ingress/nginx.conf` 包含最终 06 不可变 Nginx 配置；Nginx 只平滑 reload 本办公室独立服务。
- private 目录 `0700`，`office.env` 为 `0600`；独立密码 hash 以 UID10001、`0400` 挂入 web。
- consumer 凭据仅 collector 挂载；实际 web 容器没有消费者凭据文件或相关环境变量。
- 未打印或纳入交付的内容：root SSH 密码、管理员初始密码、consumer token、Cookie/CSRF、管理员 JWT、模型 Key、服务器私钥。
- 发布包安全排除审计检查 174 个 payload 文件，发现私密材料 0；local fixtures、运行数据库/snapshot、私密环境与未选中候选素材没有入包。

本轮没有修改用户电脑信任库。不要以“证书 pin UI 测试通过”替代真实管理员设备的信任操作，也不要以 blanket TLS bypass 作为交付方式。

## 5. 管理员首次使用

1. 从本机交付路径取得公开 CA 文件，核对指纹：
   - `/Users/hepingyu/Documents/ChatGPT/Star-Office-UI/docs/office-production/evidence/deployment-20261006/office-root-ca.crt`
   - 同目录 `ca-fingerprint.txt`
   - SHA-256：`C8:51:E0:F8:CA:98:18:1F:C2:C6:2D:05:45:FC:25:CB:37:45:E5:06:D6:E2:AD:B8:33:5E:ED:64:3C:AE:89:20`
2. 由管理员在自己设备上确认并信任该公开 CA，再打开 HTTPS 管理入口；不建议直接跳过证书警告。
3. 管理用户名 `admin`。强随机初始密码只在服务器 root 可读文件：
   `/opt/star-office-ui/private/admin-bootstrap-password.txt`。
   不在报告、源码、截图或聊天中展示密码，不要把该文件发到普通群聊。
4. CA 私钥签发后已销毁，没有放服务器或发布包；服务器只保留自己的受限叶证书私钥。服务器证书 180 天，CA 365 天，应安排到期前重新签发。

## 6. 原系统保护、备份与回滚

### 6.1 原系统不变

逐一比对原 11 个容器的 ID、真实镜像 ID、StartedAt、RestartCount 均不变：
`sub2api`、`kaneo-kaneo-1`、`kaneo-postgres-1`、`star-office-ui`、`ai-goofish-monitor-app`、
`newapi_yymx-new-api-1`、`newapi_yymx-redis-1`、`sub2api-postgres`、`sub2api-redis`、
`east-asia-power-postgres`、`newapi_yymx-mysql-1`。

旧办公室 `/opt/star-office-ui/src` 的 160 个文件 SHA 全部不变。没有重启共享数据库、Redis、Kaneo、Sub2API 或旧办公室。

### 6.2 已实际执行的恢复演练

| 材料 | 服务器位置 | 已完成验证 |
|---|---|---|
| 原办公室镜像/配置/源码 | `/home/star-office-backups/20261006-v5-before` | 原 160 文件解压逐字节比对；无网络临时容器运行原真实镜像 health 200；旧容器不变。 |
| 新办公室持久状态 | `/home/star-office-backups/20261006-v5-production-state` | 在线 SQLite backup API＋原子 snapshot 文件；恢复到本任务临时卷；归档字节一致、v2、2 历史、2 audit、4 用户、数据库完整性通过。 |

原真实镜像：`sha256:28f1bc788fdcc80f30ff36ece47110e0b7a73b56cce84ed49a38927fb346ee53`。
回退保护标签：`local/star-office-ui:rollback-20261006-v5`，并有实际镜像 tar 备份，不以旧标签臆测镜像内容。

演练没有停生产 collector，没有覆盖生产卷。只删除本任务自己的临时恢复卷。
私密原 docker inspect、compose、配置和源数据不复制到公开交付目录。

### 6.3 应急代码回退准备

服务器脚本：`/opt/star-office-ui/rollback-office-v5-06-to-v5-05.sh`。

- `--check` 已通过：验证 05 归档/实际镜像、受限环境、恢复 Nginx 语法；两个运行办公室容器 ID 在检查前后不变。
- 代码回退目标为 05；准备的回退 ingress **保留最后 /admin HTML MIME 修复**，不把下载缺陷重新带回。
- 保持现有配置、历史、审计和持久卷，不还原/删除业务数据。
- 仅明确使用 `--confirm-office-only-cutover` 才触发办公室两个服务的停止/重建和独立 ingress reload。
- **本轮没有实际切回生产 05**；不要将 `--check` 或临时卷恢复演练称为生产全流程切回成功。
- 回退后必须再验证真实浏览器登录、已保存配置 GET 和采样前进；不能只看 healthy。

历史 `rollback-to-validated-v5-04.sh` 是早期 05 的检查点脚本，不适用于当前 06；当前交付以本节新脚本为准。

## 7. 运维风险与验收边界

| 优先级 | 项目 | 状态/建议 |
|---|---|---|
| P1 | 根分区容量 | 最终现场约 96%，可用约 2.0 GB；`/home` 可用约 7.8 GB。尽快安排扩容或经确认的定向清理；本轮未擅自删共享镜像、缓存或业务数据。 |
| P1 | 专用 consumer 凭据到期 | **2026-11-05 13:33:20 CST**。到期前按批准范围续签/替换专用 consumer；不能使用管理员 JWT 或模型 Key 顶替。 |
| 首次使用动作 | 管理设备 CA 信任 | 本轮未修改 OS 信任。需要管理员完成该设备动作；服务端 CA/IP 验证和隔离浏览器 pin 测试已过。 |
| 待单独审查 | 美术商业使用权限 | 原仓库 README/LICENSE 保留非商用美术声明；本轮未逐项核查所有现有/原创资产的权属与许可，内网技术部署不代表取得商业授权。公司商业使用前需按来源核查或替换。 |
| 范围外 | 宿主/基础依赖安全升级 | 现有 CentOS 8/Nginx 1.24 基础设施未升级；本轮不是全面 CVE 扫描或供应链认证。 |
| P2 | 移动端触控/无障碍深化 | 保持本次批准方案；后续可优化 36 px 按钮、完整键盘导航/读屏、对比度及实体手机验收。 |

本轮发现的功能上线阻断均已修复并复验。上述运维风险、设备动作、权利审查及范围外事项不能被“测试全部通过”掩盖。

## 8. 交付文件与可复核证据

本机正式包及校验：

- `/Users/hepingyu/Documents/ChatGPT/Star-Office-UI/.local/office-deploy-audit-20261006/releases/office-20261006-v5-production-06.tar.gz`
- 同名 `.sha256`；归档 SHA-256：`891ab04b7446f9567a0bf46a72bce4383d841d8b1dbc1ebf079173dfc76fe01c`

本报告相邻证据根目录：
`/Users/hepingyu/Documents/ChatGPT/Star-Office-UI/docs/office-production/evidence/deployment-20261006`。

关键索引：

- `final-health.json`：两个服务 healthy、零重启、错误/异常关键字计数为 0、ingress 开机启动和受限文件权限。
- `final-state.json`：真实镜像/容器、旧数据不变、持久配置、采样推进、公开字段边界、磁盘。
- `release06-build-summary.json`：离线镜像、96 源文件、原始 backend/frontend 与 05 相同。
- `release06-cutover-summary.json`：办公室限定切换与 HTML MIME 修复。
- `browser-final/report.json`：最终 06 员工端 19 项及设备数据。
- `api-acceptance.json`：最终 06 TLS/API 18 项，v2 → v2。
- `api-initial-versioned-save.json`：先前唯一一次同内容保存 v1 → v2 和精确读回。
- `admin-ui-report.json`、`admin-login.png`：最终 06 管理端 9 项和无密码登录截图。
- `old-restore-summary.json`、`restore-summary.json`：两个真实隔离恢复演练。
- `rollback-summary.json`：当前 06 的回退检查，明确没有生产切回。
- `tests/`：本地/回归及实机浏览器原始日志。
- `delivery-hygiene.json`：主动凭据/私钥排除、源文件 SHA 和 git diff 检查。

服务器另外保留只含已审查交付材料的副本：`/home/star-office-delivery/20261006`；不包含 private env、密码或运行数据库。

工作区原有未提交/未跟踪开发内容保留；没有执行 git reset/clean、没有擅自提交。本报告和导航更新在发布冻结后整理，不改写最终 06 的发布目录字节。
