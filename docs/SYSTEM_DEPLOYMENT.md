# Star Office UI 全系统部署手册

整理日期：2026-10-28（Asia/Shanghai）。版本、镜像、插件包和实际生产状态仍以目标环境现场核对为准。

本文把完整系统拆成四个可以独立安装、升级和回滚的组件：

1. **Sub2API 主服务**：API 网关、PostgreSQL 和 Redis。
2. **用户遥测插件**：安装在 Sub2API 内的签名 .s2plugin，只提供受限的只读用户遥测。
3. **Star Office UI**：员工看板、管理界面和静态资源。
4. **Office Collector**：Star Office UI 的服务端采集器，通过专用只读凭据读取 Sub2API，再把结果写入办公室快照。

Quickstart 默认 `OFFICE_ENABLED=0`，只启动独立看板；它不会安装 Sub2API 或签名插件。显式使用 `--with-sub2api` 后，Quickstart 会启动一个受限的 Office Collector，通过交互向导写入 Sub2API 地址、插件安装 ID、用户范围、`s2ut_...` 凭据、到期时间和 CA bundle。签名插件仍必须单独安装并启用；需要公网 HTTPS、Nginx、固定发布目录和严格生产门禁时，继续使用 `deploy/office` 正式发布流程。

## 组件关系

~~~mermaid
flowchart LR
    B[浏览器] --> W[Star Office UI web]
    W --> S[/api/office/snapshot]
    C[office-collector] -->|HTTPS + s2ut 只读凭据| H[Sub2API]
    H --> T[用户遥测插件]
    H --> P[(PostgreSQL)]
    H --> R[(Redis)]
    C --> D[(office data / snapshot)]
    D --> W
~~~

Collector 不把管理员 JWT、模型 Key、原始请求或数据库凭据交给浏览器。插件不可用、凭据过期或上游返回错误时，办公室必须显示 unknown/故障状态，不能把失败变成“空闲”或零用量。

## 先选择部署模式

| 模式 | 安装入口 | 是否需要 Sub2API/插件 | 适用场景 |
| --- | --- | --- | --- |
| 独立看板 | deploy/quickstart/install.sh | 否 | 演示、独立状态看板、没有遥测联动 |
| Quickstart 完整联动 | deploy/quickstart/install.sh --with-sub2api | 需要已安装插件 | 内网离线验证、单机部署、快速交付 |
| 完整系统（联网） | Sub2API Docker + 插件 + deploy/office | 是 | 能访问镜像仓库和依赖源的服务器 |
| 完整系统（内网离线） | 预先准备的镜像、wheelhouse、插件包和补丁 | 是 | 目标机不能访问互联网 |

如果只需要先确认 Star Office UI 能运行，直接使用 Quickstart：

~~~bash
sha256sum -c star-office-ui-<bundle-id>.tar.gz.sha256
tar -xzf star-office-ui-<bundle-id>.tar.gz
cd star-office-ui-<bundle-id>
./deploy/quickstart/install.sh --online --docker
# 内网主机：
# ./deploy/quickstart/install.sh --offline --docker
./deploy/quickstart/verify.sh --health-only --url http://127.0.0.1:19000
~~~

这条路径不会启用生产办公室 API，也不会读取 Sub2API。

如果已经完成 Sub2API 和插件安装，使用 Quickstart 的完整联动模式：

~~~bash
./deploy/quickstart/install.sh --offline --docker --with-sub2api
~~~

向导会隐藏读取 `s2ut_...` 凭据，凭据只写入 `private/office-consumer.token`；管理员密码只写入 PBKDF2 哈希文件。Docker 模式把管理员哈希、消费凭据和 CA 分到三个独立的 named volume：Web 只挂载管理员哈希，Collector 只挂载消费凭据和 CA。native 模式会并行启动 Web 与 `backend/office_collector.py`。

当前交付归档应由 `scripts/package_deploy_bundle.py` 的命令输出确定；归档旁的同名 `.sha256` 文件是校验依据。这样文档可以随不同 release ID 的离线包一起发布，而不会把某次构建的摘要写死在包内。

该归档只包含 Star Office UI Quickstart，不包含 Sub2API 数据、管理员凭据、插件签名私钥或正式消费 token。

已安装的 Quickstart 使用新包目录中的 `deploy/quickstart/update.sh --offline` 更新。升级器校验
包清单和 SHA-256，备份私有环境，保留数据/凭据/资产卷，并在 `/health` 返回体的 `version` 字段读回目标版本后
才报告成功；版本降级必须显式使用 `--allow-downgrade`。正式 `deploy/office` 发布仍遵守
不可变 release、备份、预检和回滚门槛。

## 交付物和目录规划

上线前应形成一份不含秘密的交付清单，至少记录：

- Star Office UI 归档、外部 SHA-256、不可变 release ID，以及目标架构的 Linux CPython 3.11 wheelhouse；
- Sub2API 的固定镜像 tag/digest、Compose 文件、私有 .env、PostgreSQL/Redis 数据备份；
- 插件 .s2plugin、manifest.json、signature.json、发布者公钥、插件包 SHA-256，以及与清单匹配的宿主构建版本；
- Office 的私有环境文件、管理员密码哈希、Sub2API 专用消费凭据、上游 CA bundle 和办公室服务端证书；
- 当前版本的镜像 ID、数据目录、Nginx 配置和可恢复的回滚材料。

推荐把可变数据和私有文件放在发布目录之外，例如：

~~~text
/opt/sub2api/                         # Sub2API Compose 和数据目录
/opt/star-office-ui/releases/<id>/    # 不可变 Star Office 发布目录
/opt/star-office-ui/private/          # 0600 环境、凭据、证书和密码哈希
/opt/star-office-ui/backups/          # 加密或受限备份
~~~

不要把 .env、token、密码哈希、SQLite、快照、私钥或 CA 私钥放进 Git、归档、截图或日志。

## 推荐安装顺序

### 1. 目标主机预检

先确认 Linux 架构（x86_64 或 aarch64）、Docker/Compose 版本、磁盘空间、时区、DNS、证书信任和已占用端口。完整系统可以同机部署，也可以拆成两台主机；拆分时只允许 Collector 访问 Sub2API 的受保护遥测入口。

示例端口只是规划值，必须在目标机重新核对：

| 组件 | 示例监听 | 网络边界 |
| --- | --- | --- |
| Sub2API | 8080 | 只对管理端或内网开放，生产建议由 HTTPS 反向代理承接 |
| PostgreSQL | 容器内部 5432 | 不发布到宿主机公网 |
| Redis | 容器内部 6379 | 不发布到宿主机公网 |
| Star Office 员工入口 | 19000 | 内网或受控反向代理 |
| Star Office 管理入口 | 19443/admin | HTTPS、管理员来源白名单 |
| Office 容器内部 | 127.0.0.1:19011 | 仅 Nginx/本机访问 |

### 2. 安装 Sub2API 主服务

按 [`SUB2API_DEPLOYMENT.md`](./SUB2API_DEPLOYMENT.md) 完成 Docker Compose、数据库迁移、管理员账号和 /health 检查。先确认 Sub2API 本身稳定，再继续安装插件。

### 3. 单独安装用户遥测插件

按 [`SUB2API_PLUGIN_DEPLOYMENT.md`](./SUB2API_PLUGIN_DEPLOYMENT.md) 验证签名、确认宿主兼容性、合并信任公钥、上传插件并保持初始停用。插件配置中的 allowed_user_ids 必须是实际 Sub2API 终端用户 ID，不能填上游账号 ID 或 API Key ID。

### 4. 安装 Star Office UI

只看板或内网快速联动场景使用 Quickstart。完整生产系统使用正式发布流程：

~~~bash
RELEASE=/opt/star-office-ui/releases/office-<release-id>
ENV=/opt/star-office-ui/private/office.env

sha256sum -c "$RELEASE"/*.sha256
python3 "$RELEASE/deploy/office/validate_release.py" verify "$RELEASE"
"$RELEASE/deploy/office/build_offline.sh" "$RELEASE" "$ENV"
"$RELEASE/deploy/office/preflight.sh" "$RELEASE" "$ENV"
docker compose --env-file "$ENV" \
  -f "$RELEASE/deploy/office/compose.yaml" \
  up -d --no-build --pull never office-web office-collector
~~~

office-web 和 office-collector 使用同一个不可变镜像；web 只读取管理员密码哈希，Collector 才能读取 Sub2API 消费凭据和 CA bundle。正式发布的证书、Nginx、备份、升级和回滚约束见 [`DEPLOYMENT.md`](./DEPLOYMENT.md) 与 [`deploy/office/README.md`](../deploy/office/README.md)。

### 5. 交付 Collector 的最小权限配置

插件启用并通过测试后，由管理员 API 签发独立的只读消费凭据。凭据只显示一次，应通过安全渠道写入受限文件：

~~~bash
umask 077
install -m 600 /dev/null /opt/star-office-ui/private/office-consumer.token
# 将 API 返回的一次性 s2ut_... 值写入上述文件；不要放入命令历史、日志或前端。
~~~

deploy/office/env.example 中的关键变量必须与插件和凭据实际状态一致：

~~~text
OFFICE_SUB2API_BASE_URL=https://<sub2api-受保护入口>
OFFICE_INSTALLATION_ID=<数字安装 ID>
OFFICE_USER_IDS=<插件批准范围的非空子集>
OFFICE_CREDENTIAL_EXPIRES_AT=<签发凭据的 UTC 到期时间>
OFFICE_CONSUMER_FILE=/opt/star-office-ui/private/office-consumer.token
OFFICE_UPSTREAM_CA_FILE=/opt/star-office-ui/private/upstream-ca-bundle.pem
~~~

OFFICE_INSTALLATION_ID 是插件管理页返回的数字安装 ID，不是 manifest 中的字符串插件 ID。OFFICE_USER_IDS 不能自动扩大；凭据过期前应安排轮换和重新验证。

### 6. 端到端验收

按以下顺序验收，每一步都要记录实际版本、镜像 ID、HTTP 状态和数据边界：

1. Sub2API /health 返回成功，PostgreSQL 和 Redis 均 healthy，数据库迁移完成。
2. 插件管理页显示签名可信、兼容、配置已保存；初次启用前完成一次只读测试。
3. 使用专用消费凭据读取遥测接口，成功返回的数据只包含批准用户范围；错误凭据、越权用户和停用插件必须失败。
4. Office Collector 健康检查通过，office-snapshot.json 的 connection.status 为 ok，sampled_at 在新鲜阈值内。
5. 浏览器访问员工入口和管理入口；管理写入必须经过 HTTPS、登录和 CSRF，不能用匿名 HTTP 200 代替验收。
6. 观察 Sub2API、Collector、Nginx 日志，确认没有输出消费 token、管理员 JWT、模型 Key、原始请求或完整上游响应。

Collector 失败时只保留脱敏的错误码和上次成功时间；不能把 401、403、503、超时或旧快照显示成零并发。

## 升级和回滚顺序

完整系统升级按“先兼容性、后切换”的顺序执行：

1. 备份 Sub2API Compose、.env、PostgreSQL、Redis、插件配置和当前镜像；保留旧镜像 ID，不用 latest 猜测旧版本。
2. 在隔离环境读取新插件 manifest，确认 requires.sub2api、plugin_protocol、user_telemetry_api、ui_bridge 和目标架构均匹配。
3. 先部署并验收新的 Sub2API 宿主，再上传新插件；插件初始停用，完成配置读回和只读测试后再灰度启用。
4. 签发新一枚最小范围、有限期的 Collector 凭据，部署新的 Office release，完成 snapshot、浏览器和 TLS 验收。
5. 切换完成后再撤销旧消费凭据；旧 release、旧镜像和旧数据保留到回滚窗口结束。

回滚优先停用/卸载插件、撤销新凭据、恢复旧 Sub2API 应用镜像和旧 Office release。不要默认恢复整个共享数据库，以免覆盖切换后新增的业务记录；只有在独立备份和恢复演练明确要求时才恢复数据库。

## 常见故障定位

| 现象 | 先检查 |
| --- | --- |
| Quickstart 正常但办公室没有用户数据 | 确认使用了 `--with-sub2api`，Collector profile 已启动，插件安装 ID/凭据/CA 与 Sub2API 当前状态一致 |
| 插件上传提示不兼容 | 读取 manifest 的宿主版本范围和协议字段，不能只看文件名或 Docker tag |
| 签名不可信 | signature.json.key_id、32 字节 Base64 公钥和 trusted_publishers 键必须完全一致 |
| Collector 为 unauthorized/forbidden | 凭据是否属于同一安装 ID、是否过期/撤销、OFFICE_USER_IDS 是否超出批准范围 |
| Collector 为 unknown 或 stale | 先检查 Sub2API HTTPS、CA bundle、网络 ACL 和插件状态；不要手动把快照改成成功 |
| 离线 Docker 试图联网 | 检查是否误用 pull、--pull=always 或未缓存的基础镜像；离线路径必须使用 --pull never/--pull=false |

## 相关文档

- [`SUB2API_DEPLOYMENT.md`](./SUB2API_DEPLOYMENT.md)：Sub2API 主服务的联网/离线 Docker 安装、配置、备份和升级。
- [`SUB2API_PLUGIN_DEPLOYMENT.md`](./SUB2API_PLUGIN_DEPLOYMENT.md)：签名用户遥测插件的独立安装、凭据和回滚。
- [`DEPLOYMENT.md`](./DEPLOYMENT.md)：Star Office UI 本地运行、Quickstart、正式办公室发布、TLS、备份和回滚。
- [`integrations/sub2api/README.md`](../integrations/sub2api/README.md)：仓库内 Sub2API 源码、补丁和工具边界。
