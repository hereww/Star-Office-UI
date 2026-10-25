# Star-Office 正式版隔离发布包

本目录只提供发布工具，**没有连接远端、签发凭据、创建 CA、部署或重启任何服务**。
目标 IP `192.168.100.221`；主线程只读探测发现 `19001` 已有服务，因此新应用仅绑定
`127.0.0.1:19011`。办公室员工入口仍 `http://192.168.100.221:19000/`，管理入口
`https://192.168.100.221:19443/admin`。任何 `19443` 或 `19011` 占用都必须 STOP，
不得替换其服务、擅自选其他端口或占用 `19001`。

`/opt/star-office-ui` **是历史目录候选，不是当前已验证事实**。以下流程要求主线程先恢复
SSH 授权、只读核对目录/容器/镜像/挂载/客户端/Nginx/防火墙，再确认此路径；未经核实不执行。
本机没有 Docker；本目录测试不是 Docker 镜像、Nginx 实机或线上验收；当前打包只作为RC归档，主线程
浏览器QA完成及源码冻结后必须以新release ID重打包，不能用旧快照冒充最终集成版本。

## 默认四用户 profile 与现有配置迁移

本次新增契约覆盖早先单用户默认：安装 ID 仍为 **`1`**，正式默认
**`OFFICE_USER_IDS=1,4,7,8`**。在**全新 SQLite 配置库**中，按显式采集范围初始化下列绑定：

| 用户（字符串 ID） | 默认工位 |
|---|---|
| `4` | `desk-09` |
| `7` | `desk-10` |
| `8` | `desk-11` |
| `1` | `desk-12` |

允许部署者显式设置非空、无重复、规范十进制 ID 的较窄子集，例如 `1` 或 `4,7`；
新库也只能绑定该子集对应工位。配置校验要求明确写出 `OFFICE_USER_IDS`，缺失、空值、
额外用户 `2`、重复 ID、前导零/符号/空白等非规范 ID 均拒绝。不会补入遗漏用户、
自动扩权或将单用户凭据默认为四用户可用；插件授权和专用消费凭据必须实际覆盖显式范围。

**当前进度（主代理只读 GUI 反馈）**：Sub2API 授权页已见用户 `1/4/7/8`。
这不是本子任务独立生产验证，也不代表凭据/部署完成；**生产专用消费 credential 和 SSH 部署
尚未完成**。发布工具不会自动修改 Sub2API 授权、签发凭据或访问/重启远端服务。

**已有 SQLite 绝不自动覆盖或迁移**：管理员先 GET 配置读取当前版本、保存迁移前版本，
再通过 `PUT /api/office/admin/config` 携带 `expected_version` 保存显式四用户绑定草稿，
然后重新 GET 比较新版本与绑定内容。409 时重新读取并人工合并，不强行覆盖。
较窄范围只能保存其对应绑定；恢复旧版也要重新校验当前范围，不能撤销授权或扩大凭据。
不要删除/重建 DB、执行直接 SQL 或依赖服务重启自动加席，历史审计与回滚材料继续保留。

新版气泡仅一行 **`用户名：X`**，X 是采样时刻的当前并发数（可信时包括 `0`）。
不显示用户 ID、工位号、状态句或单位；未知/未跟踪/失败并发使用 **`用户名：—`**，不伪造零。
气泡横向中心对齐自己的头部/工位，仅允许附近小幅上下错开，不漂到远处避让轨道。
长名称仅省略姓名部分，数值不丢精度；选中详情保留完整姓名。
新鲜但空/全空白用户名的气泡为 `未设置：X`，不可用/过期身份为 `用户名未知：—`；
不用邮箱、用户 ID 或展示别名补名。员工白名单仅新增 username/身份质量字段，
邮箱、原始 ID、API Key 元数据和 Token 明细仍不公开；演示隔离、不回写真实状态。
气泡动画、减少动态、四用户浏览器和权限验收由主代理集成，发布配置补丁不冒充 UI 验收。

**历史 RC1/RC2/RC3 的字节、配置模板和 checksum 保持不变**。本补丁只更新工作区的
下一版发布配置；不向已发行目录打补丁，不构建新发布包。主代理完成 UI QA 和版本化配置
保存/读回验收后，负责新的 immutable release，并重新完成全部部署门槛。

## 1. 发布内容与接入约定

- 同一个不可变 office 镜像启动 `office-web` 与唯一的 `office-collector`。
  Python **3.11**、Flask `3.0.2`、Pillow `10.4.0`、Gunicorn `23.0.0`；这些沿用项目/历史
  发布基线而非最新版本宣称。缓存/安全状态需目标环境核实，不自动升级、不拉新镜像。
- UID/GID `10001:10001`，只读容器根、临时 `/tmp`、无新增能力、日志轮转、
  `restart: unless-stopped`、各自健康检查。Docker unhealthy 不会自动触发重启；
  采集器上游异常会显示 unhealthy，须运维观察，不启用盲目自动重启。
- 独立 named volume `star-office-production-office-data`：
  `/data/office/office-config.sqlite3`（配置/审计/管理会话）和
  `/data/office/office-snapshot.json`（采集器原子快照）。两个进程共享该目录。
  另有 `star-office-production-legacy-data:/data/legacy`，**不挂载或覆盖旧生产卷**。
  新卷从镜像的 UID10001 目录初始化；已有同名卷须核实所有权、来源，禁止自动 chown 老卷。
- `OFFICE_DATA_DIR=/data/office`、`STAR_OFFICE_DATA_DIR=/data/legacy`；
  管理独立密钥 `OFFICE_ADMIN_SECRET` 与 `FLASK_SECRET_KEY` 分开，均符合 app 的强密钥
  校验（>=24，不能包含弱标记）。`ASSET_DRAWER_PASS` 仍须强密码，即使不开放旧抽屉。
- 后端统一入口仍为 `app:app`；**主线程在 app.py 注册 OFFICE Blueprint**。
  发布启动器验证契约路径/方法已注册，否则拒绝启动，不在发布代码中偷偷注册。
  主线程若调整 env，请同步本目录的 compose/启动器/验证器；不能把占位当成可上线配置。
- `OFFICE_ADMIN_PASSWORD_HASH_FILE` 是部署启动器选项，它读取仅 web 可见的 hash 文件，
  设置后端已经定义的 `OFFICE_ADMIN_PASSWORD_HASH`。哈希的 `$` 不经过 Compose/env_file
  插值，不用 `$$` 逃逸或把真实hash填进模板。生产接受后端的强 scrypt/pbkdf2 格式。
  **消费凭据文件仅 collector 挂载**；web 不获得消费 token、Sub2API 地址或 CA 挂载。
  两个文件使用受限只读 bind mount（不使用 Docker secret 默认0444），均由主线程安全预置为
  UID10001、0400/0600。不要在命令行、日志、环境模板、Git 或截图中填写凭据。
- 上游默认 HTTPS origin，默认安装 `1`、四用户 profile `1,4,7,8`；允许明确较窄子集，
  不允许其他用户或隐式扩权。专用消费凭据范围/到期元数据仍由主代理的安全签发流程提供。
  `OFFICE_UPSTREAM_CA_FILE` 是可信证书 bundle；不关闭 TLS 验证。仅主线程验证是同机链路后，
  可显式设置 `OFFICE_ALLOW_HTTP=1` 与 `http://192.168.100.221:<已核实端口>`；拒绝其他
  公网/私网 HTTP地址和 DNS 别名，不能通过该选项开放公网明文。管理端始终 HTTPS。
- 浏览器资源前缀统一 **`/static/releases/<release-id>`**，路径继续按源 `frontend/` 树布局，
  例如 `.../office/bootstrap.mjs`、`.../company-office/connected-v4/media/...png`。
  主线程实现 Flask 版本化 static 路由；Nginx 直接从发布包的 public 树读取同一内容。
  包中源 HTML 留存模板，public HTML 注入无秘密的 `release_prefix/mode`。
  ES Modules、JSON、PNG、选中媒体、中文字体（如 CSS 实际引用）、本地
  **`vendor/phaser-3.80.1.min.js`**均包含，Nginx 显式给 `.mjs` JavaScript MIME。
- 打包按 ESM/CSS/JSON **实际依赖闭包**选材；仅复制所选原图字节，不重新编码、缩放或优化。
  不打包 `/local`、tests/fixtures、QA 截图、候选原图、生成 prompt、`.env`、runtime DB、
  密钥、CA 私钥或整个 assets 候选目录。JSON 的 sourceRaw/sourceTemplate 等来源元数据
  不当作运行依赖。`source_files`、`files`、`SHA256SUMS`、归档外部 SHA256 可校验原图及包。manifest另含secret_exclusion审计，发现实际私钥头或非占位秘密赋值则拒绝。

## 2. 本地/目标离线构建

在开发端（建议与主线程同一隔离 Python3.12 venv）运行：

```bash
python scripts/test_office_release.py
python scripts/package_office_release.py --release-id office-20261004-v1 \
  --output deploy/office/out --wheelhouse /EXISTING/CURATED/linux-cp311-wheelhouse
```

缺少集成文件（例如 office.css/adapter）会明确失败，不替换成 demo。未提供 wheelhouse
仍可生成**源码归档交付包**，但 `offline_wheelhouse=false`，离线镜像构建/preflight 拒绝。
不允许往一个已有 release ID 上覆盖打包结果。

要求复用目标已有 Python3.11 缓存 image（优先 digest）、Linux目标架构/CPython3.11 wheels。
本机发现的 macOS cp314 Pillow wheel **不能使用**。必须离线准备包含所有传递依赖的完整
wheelhouse；打包验证格式/平台排除并记录每个 wheel 的 checksum，完整依赖可安装性由
目标 `--network=none` build 验证，不伪称本机已验证 Linux wheel 兼容性。镜像构建时传递依赖不从
网上解析最新版，只从经审阅的 wheelhouse 解析。

2026-10-04 已单独补齐候选目录 `deploy/office/wheelhouse/linux-cp311-x86_64/`，
包含官方 PyPI HTTPS 下载的完整10-wheel依赖闭包、tags/官方SHA256/RECORD审计，
以及原requirements与hash锁定清单的离线下载解析证据。详情见该目录 `README.md`、
`audit.json`、`SHA256SUMS`、`offline-resolution.json`。packager可用：

```bash
--wheelhouse /Users/hepingyu/Documents/ChatGPT/Star-Office-UI/deploy/office/wheelhouse/linux-cp311-x86_64
```

**linux/amd64 仅为候选**：尚未SSH核实远端uname、容器/base image架构及libc；
必须核实x86_64/CPython3.11/glibc>=2.17，不适用于Alpine/musl或ARM64。
本机仍无Docker；这不是实际镜像构建/启动验收。未改requirements、未安装任何依赖，
RC1未改、未生成RC2；主线程UIQA冻结后以新release ID打包。

主线程在确认目标目录后上传归档及外部 checksum，校验后解包至**新路径**，例如：

```bash
# 在已经确认的发布目录执行；不要用 --overwrite。
sha256sum -c office-20261004-v1.tar.gz.sha256
tar --no-same-owner -xzf office-20261004-v1.tar.gz
python3 office-20261004-v1/deploy/office/validate_release.py verify office-20261004-v1
```

`env.example` 复制到 `/opt/star-office-ui/private/office.env`（0600），安全渠道配置真实
私密值与已存在文件路径。**不 source .env，不打印 docker compose config**。
验证器兼容宿主 Python3.6+，镜像/app 固定 Python3.11。

```bash
RELEASE=/opt/star-office-ui/releases/office-20261004-v1
ENV=/opt/star-office-ui/private/office.env
"$RELEASE/deploy/office/build_offline.sh" "$RELEASE" "$ENV"
```

脚本只用本地缓存，`docker build --pull=false --network=none`、pip `--no-index`，
base/image 不存在则停止。离线 CI 必须预先配置本地 Docker builder，避免 builder provisioning
触发 registry；若不能保证离线，不进行 build。镜像 tag 已存在也停止，不能重写旧 tag。

## 3. TLS、网络、首次上线门槛

- 服务端 CSR 配置见 `server-certificate.cnf`，SAN 包含 `IP:192.168.100.221`、`CA:FALSE`。
  主线程在服务器安全创建/保存**服务端**私钥（0400/0600，root 所有），在已有受信 CA
  工作站签发。**不生成系统受信 CA、不自动安装信任、不把 CA 私钥放服务器或发布包**。
- 预置 `/opt/star-office-ui/private/office-server-chain.pem`、`office-server.key` 和客户端
  已信任的 `OFFICE_SERVER_CA_FILE`；证书链/IP/期限/公钥匹配检查必须通过。
  管理设备完成受信确认；不得用 `curl -k`、浏览器忽略警告或关闭 TLS 验证当作验收。
- Nginx 只 listen 目标 LAN IP，`allow 192.168.100.0/24; deny all`；容器仅 publish
  `127.0.0.1:19011`。firewall、路由/NAT、已有服务映射必须审计；**默认不开放公网端口**。
  本包没有防火墙变更脚本。禁止 `--add-port=19443/tcp` 全网放行；仅由主线程根据目标
  已验证 zone 配置 LAN 来源规则，并检查其他 zone/service/rich-rule 没有宽泛授权。
- 19000 白名单仅 GET/HEAD `/`、本 release `/static/releases/.../`、
  `/api/office/snapshot`、`/health`，其余（admin、assets、set_state、status、agents）404。
  HTTPS 使用 OFFICE session 鉴权；发布 WSGI guard 给旧接口额外登录/CSRF/来源保护。
  为使 Path=/api/office/admin 的 office cookie 能发送，旧浏览器/客户端迁移使用
  **`/api/office/admin/compat/<旧路径去掉首个斜线>`**，例如 `.../compat/set_state`。
  禁止把 session cookie Path 改为全站来逃避迁移。兼容写请求需要有效 Office session、
  同源 Origin 和 X-CSRF-Token；OPTIONS 也不作为绕过鉴权的出口。
  旧素材抽屉原有权限仍保留，外层兼容登录不会绕过旧内层校验。
- 新 HTTP/HTTPS入口不覆盖 old root/debug/assets 的匿名权限。普通 direct legacy path
  只有客户端**显式**携带有效 Office cookie 且在 HTTPS 时才可通过；匿名一律拒绝。
  已有 push 客户端若还使用旧匿名 19000/set_state，必须先迁移/停用/明确业务影响，
  **是主线程上线门槛，不是发布脚本自动决定**。

主线程安全核查并留存门槛证据后，才设置私密 env 中：
`OFFICE_CLIENT_MIGRATION_APPROVED=1`、`OFFICE_FIREWALL_AUDITED=1`、
`OFFICE_BACKUP_VERIFIED=1`。这些是运维证据开关，不是替代真正核查的证明。

```bash
"$RELEASE/deploy/office/preflight.sh" "$RELEASE" "$ENV"
```

preflight 不联系 Sub2API、不启动 office；读取 ss 验证 19443/19011 空闲。
两端口任一已监听立即 STOP，包括需要进一步核实的同名旧服务。首次部署通过后
才启动隔离应用，两个 named volume 自动创建（不覆盖旧卷）：

```bash
docker compose --env-file "$ENV" -f "$RELEASE/deploy/office/compose.yaml" \
  up -d --no-build --pull never office-web office-collector
# 检查两个服务 HEALTH，以及 loopback /health 和脱敏 snapshot。
# 仅允许显式 profile（默认1,4,7,8或其较窄子集）的实际遥测；
# 先验证专用消费凭据实际范围，不创建测试用户/Key、不发模型压力请求。
```

将 candidate Nginx 放入已备份的目标 vhost 的受控替换流程；preflight 已检查 existing/candidate
语法，但修改后的完整配置仍要 `nginx -t`。成功后 **仅 `nginx -s reload` 平滑重载**。
不可 restart Nginx、Sub2API、PostgreSQL、Redis，不运行原 smoke_test 的 /set_state 写测试。
失败保持旧流量。旧数据/卷/镜像始终保留。长期升级的 preflight 不能把自己的已用19443当
成“可随意替换”：主线程须单独验证监听身份并制定升级检查，不提供自动跳过冲突参数。

验收必须包括：未登录不能读管理/旧 API；HTTP 未开放 mutation；已登录可读配置；
同源 CSRF 才能保存并 GET 回读；版本冲突409；16工位资源无404；1920×1080/DPR2/平板/
手机横竖屏；TLS 受信；消费凭据无法从 web/env/前端获得；采集异常为未知而非零并发；
重启 collector 旧快照不自动变新鲜；查看端增加不增加上游采集次数。

## 4. 备份与回滚（只操作 office）

### 首次切换前：现有旧系统保护由主线程执行

因为原 `/opt/star-office-ui`、容器名称和挂载尚未核实，不能用新 compose 假装备份旧生产。
主线程要记录实际容器/image-ID、旧 compose/env、mount源、端口/Nginx vhost和防火墙；
私密目录权限0700，秘密文件0600，不在聊天/日志输出 docker inspect/env。对有 SQLite 的
旧卷使用 SQLite backup API 或明确的 office 写入停止窗口，JSON/原图保存原字节及 checksum。
用临时卷/隔离临时容器验证恢复、比较记录与文件数，然后才放行 BACKUP_VERIFIED。
旧后台若依赖完整素材目录，必须保留旧镜像和旧卷，不能靠本包的精选V4资源恢复旧编辑器。

首次回退：停止**新 compose 的 office-web/collector**，保留新数据；恢复旧 Nginx vhost，
`nginx -t && nginx -s reload`；必要时仅恢复/启动已核实的旧 office 容器原镜像及原挂载。
旧 office 根本没有被停则无须重启。验证原入口/原记录/客户端，不恢复或改写 Sub2API DB。

### 后续正式版升级：可执行工具

```bash
# 明确允许 office 写停止窗口，目的地必须全新且在发布目录之外。
"$CURRENT/deploy/office/backup.sh" "$CURRENT" "$CURRENT_ENV" \
  /opt/star-office-ui/private/backups/PREVIOUS_RELEASE /VERIFIED/office-vhost.conf \
  --confirm-office-stop
```

仅停止该 compose project 的两个 office 服务；校验 SQLite quick_check、原子JSON，
归档独立两个卷、旧 env、Nginx、immutable image-ID、保留release manifest digest。
备份目录保持运维所有者0700，不改成应用UID10001；归档通过受限helper stdout/stdin流式传递，
应用进程不能访问宿主备份目录。restore先在卷内staging验证完整payload，再替换旧文件。
消费者 token/CA 私钥不复制到发布包。备份是私密数据，需加密外部存储并限制访问。
脚本成功会保留 office 停止状态，切换或显式恢复同一版；不偷偷重启正在诊断的服务。

必须在**临时 Docker volume**演练恢复，使用同镜像 `volume_archive.py restore`
（临时卷挂载固定 `/restore-data`），读回 SQLite、绑定version、审计与JSON，删除临时卷
前保留验收结果。没有演练不能称“回滚已验证”。

```bash
"$CURRENT/deploy/office/rollback.sh" "$CURRENT" "$CURRENT_ENV" \
  /opt/star-office-ui/private/backups/PREVIOUS_RELEASE /VERIFIED/office-vhost.conf \
  --confirm-office-stop
```

rollback 先验证备份、留存源码与旧image-ID；先备份当前数据再恢复，拒绝 archive 路径穿越/
symlink/hardlink/devices。只恢复本 project 的专用卷，不触碰旧系统或其他服务。env/Nginx
原子替换；`nginx -t` 失败不 reload，保留当前的 safety backup；成功后仅拉起旧 office
镜像（`--no-build --pull never`）和平滑reload。恢复collector应重新成功采集，不能信任旧快照。
如果失败，停止切换、使用已保留的 safety backup；不要反复清空卷或恢复共享数据库。

## 5. 交付与已知限制

`python scripts/test_office_release.py` 使用 temporary fixture，不访问真实服务；验证字节保持、
依赖闭包、local/fixture/候选/秘密排除、checksums、prefix/ID、端口冲突硬停止、兼容鉴权、
Compose秘密隔离和离线策略。可从主线程隔离 Python3.12 venv运行，不改变项目依赖。
当前本机无 Docker/Nginx；无法证明镜像可构建、容器启动、volume权限、TLS/Nginx/firewall/
旧客户端迁移或远端恢复。归档/代码可交付，但正式上线必须等SSH、离线缓存和主线程验收。


## 2026-10-06 V5 审计与现场部署补充

- 正式 `frontend/office` 默认加载 connected-v5；共享遥测适配器通过运行时工厂保留 V5 继承链、屏幕特效与无手部交互契约，V4 独立回归仍保留。
- Web 与 collector 均要求同一个显式 `OFFICE_USER_IDS`，不再在 Web 中默认为扩大后的范围。
- HTTP/LAN 无 SubtleCrypto 时，浏览器素材来源哈希标为不可计算，不阻止画面，也不伪称校验通过。发布包 SHA256 校验仍强制；管理端继续 HTTPS。
- 现场确认旧 office 只在 Docker 私网监听，主机 19000/19443 未被监听，没有运行中的共享宿主 Nginx。只启用 `star-office-ingress.service` 的独立 office 配置；不启动宝塔旧主配置、不加载其他 vhost。原 `nginx.conf.template` 的服务器规则、LAN 白名单与路径隔离不变。
- `nginx-isolated.conf.template` 只替换 `@RELEASE_ID@`，部署时复制为 `/opt/star-office-ui/ingress/nginx.conf`；它包含该不可变 release 的 `deploy/office/nginx.conf`。必须先显式 `nginx -t -c` 再启用服务。先创建日志/cache目录；worker nobody。没有共享主进程时，不运行原 preflight 的默认 `nginx -t`/默认 reload；其余完整性、显式范围、证书、端口、secret-owner、Docker配置与备份门槛照常执行，不能静默跳过。
- TLS 新 CA 只用于办公室，不写入管理员电脑的信任库。公开 CA 与指纹可交付；私钥/密码/消费者凭据不能进入源码、发布包、QA 或聊天。
- 老容器保持运行、原 bind mount 不修改；旧源与实际镜像备份位于独立 `/home` 分区并先演练恢复。新服务用专用卷；不复制/恢复共享 Sub2API 数据库。
- 宿主已有 Nginx 1.24.0 是现有基础设施基线，不作为最新或完整漏洞审计结论。本次只用最小 office 配置，不升级/重启共享软件；单独的 Nginx 安全升级需要后续维护安排。

- 同尺寸/同归档时间的候选发布实际出现镜像 COPY 缓存保留旧文案。现在 office build 强制 `--no-cache`，镜像内保存校验过的 release manifest，在构建与启动前逐一核对 backend/frontend/deploy 原字节，最终运行容器还要再次执行 `verify_image.py`。镜像标签、HTTP200与 healthy 都不能替代字节一致性。

- 进一步实测：仅 `--no-cache` 仍无法避免现场 BuildKit 的本地上下文复用。最终工具改为 `tar -C "$release" -cf - . | docker build ... -`，完整传入该发布快照，不复用 local source；镜像 manifest 的 96 项源码逐字节校验已真实通过。这是构建上下文问题，未清理共享 build cache、未删除别的镜像。

- 宿主 Nginx 编译了 ngx_lua，独立 wrapper 必须使用现场已有 `/www/server/nginx/lib/lua/?.lua;;`，否则语法测试通过但启动失败。已纳入模板；systemd `RestartSec=5s` 避免紧密重试。未安装 Lua/Nginx、未启动宝塔主配置。
- 独立静态发布父目录 `/opt/star-office-ui/releases` 必须 0755 供 nobody worker 遍历；`private` 仍0700，secret文件保持0400/0600。根路径使用 `root + try_files` 精确索引，不用文件 alias 处理 `/`（实机会错误追加 index.html）。`/admin` 的精确文件 alias 不变。修正后真实 Nginx / 与 /admin 均200。
