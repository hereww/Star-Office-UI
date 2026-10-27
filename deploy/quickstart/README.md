# Star Office UI 一键部署包

这个目录是可复制的部署入口。`scripts/package_deploy_bundle.py` 会把后端、前端、Quickstart 安装器和可选 Linux CPython 3.11 wheelhouse 打成可校验归档。归档不包含 Sub2API 数据、真实凭据、管理员密码或插件签名私钥。

Quickstart 有两种模式：默认只启动 Star Office UI；显式加 `--with-sub2api` 才启动 Office Collector 并连接已经安装好的 Sub2API 用户遥测插件。插件本身必须先按仓库的独立说明安装和启用，Quickstart 不会替换或绕过 Sub2API 的签名校验。

## 只启动 Star Office UI

联网 Docker：

```bash
./deploy/quickstart/install.sh --online --docker
```

内网离线 Docker：归档需要带目标架构的 `wheelhouse/`，目标机还要预先缓存匹配的 `python:3.11-slim` 基础镜像；如果交付了完整镜像归档，可用 `--image-archive` 导入：

```bash
./deploy/quickstart/install.sh --offline --docker
./deploy/quickstart/install.sh --offline --docker --image-archive images/star-office-ui.tar
```

没有 Docker 的主机：

```bash
./deploy/quickstart/install.sh --online --native
./deploy/quickstart/install.sh --offline --native
```

默认端口为 `19000`，部署状态、私有文件、日志和 native 虚拟环境保存在 `~/.star-office-ui/`。用 `--install-dir`、`--port` 和 `--bind` 调整位置和监听地址。

## 完整联动安装

完整联动必须按下面顺序执行：

1. 按 [`docs/SUB2API_DEPLOYMENT.md`](../../docs/SUB2API_DEPLOYMENT.md) 部署 Sub2API 主服务，确认 `/health`、PostgreSQL 和 Redis 正常。
2. 按 [`docs/SUB2API_PLUGIN_DEPLOYMENT.md`](../../docs/SUB2API_PLUGIN_DEPLOYMENT.md) 单独验签、安装和配置用户遥测 `.s2plugin`，确认插件的 `allowed_user_ids` 是实际终端用户 ID，并通过插件的只读测试。
3. 在 Sub2API 管理 API 中为该插件签发有限期、最小范围的 `s2ut_...` 只读凭据。凭据只显示一次；把它交给下面的隐藏输入或 `--token-file`，不要放入 shell 参数、URL、截图或日志。
4. 解包 Star Office UI 离线包，在目标机执行：

```bash
./deploy/quickstart/install.sh --offline --docker --with-sub2api
```

安装器会交互要求填写：

- Sub2API 的 HTTPS origin，例如 `https://sub2api.intra.example`；
- 插件上传后得到的**数字安装 ID**；
- Star Office 允许展示的用户 ID 范围；
- `s2ut_...` 只读凭据（隐藏输入）；
- 凭据到期时间（带时区的 ISO-8601）；
- Sub2API CA bundle（回车可复制本机默认 CA；自签名内网证书必须指定 PEM CA 文件）；
- Star Office 管理员用户名和密码（隐藏输入）。

需要自动化时可以使用文件参数预填配置；凭据只允许从 0400/0600 文件读取，不能把 token 直接写进命令行：

```bash
./deploy/quickstart/install.sh --offline --docker --with-sub2api --non-interactive \
  --sub2api-base-url https://sub2api.intra.example \
  --installation-id 12 --user-ids 42,43 \
  --credential-expires-at 2026-12-31T12:00:00Z \
  --token-file /run/private/office-consumer.token \
  --ca-file /run/private/sub2api-ca.pem \
  --admin-password-file /run/private/office-admin-password
```

配置写入 `--install-dir` 下的私有文件：`.env` 只保存地址、安装 ID、用户范围、到期时间和文件路径；凭据保存为 `private/office-consumer.token`（0600），密码哈希保存为 `private/office-admin-password.hash`（0600），CA 保存为 `private/upstream-ca.pem`。Web 容器不会挂载凭据卷，只有 Collector 容器能读取它。

如果 Sub2API 只提供受控内网 HTTP，必须显式选择：

```bash
./deploy/quickstart/install.sh --offline --docker --with-sub2api \
  --allow-http-sub2api --allow-http-admin
```

HTTP 管理入口只适合隔离的内网验证；生产环境应使用 HTTPS 反向代理和 `deploy/office` 正式发布流程。

没有 Docker 的完整联动安装使用同一配置向导：

```bash
./deploy/quickstart/install.sh --offline --native --with-sub2api \
  --install-dir /opt/star-office-ui
```

native 模式会同时启动 Web 和 `backend/office_collector.py` 两个进程，分别写入 `star-office.log` 和 `office-collector.log`。升级或重新运行安装器会先停止这两个 Quickstart 进程，不会删除数据和凭据文件。

## 验证、更新和停止

```bash
./deploy/quickstart/verify.sh --url http://127.0.0.1:19000
./deploy/quickstart/uninstall.sh --install-dir ~/.star-office-ui
```

`uninstall.sh --purge` 才会删除 Docker named volume 或 native 数据目录；私有凭据和 `.env` 会保留，方便重新部署和凭据轮换。轮换凭据时重新运行 `install.sh --with-sub2api`，输入新 token 和新的到期时间，再在 Sub2API 侧撤销旧 token。

## 生成离线归档

在联网构建机准备目标架构 wheelhouse 后运行：

```bash
python scripts/package_deploy_bundle.py \
  --output deploy/bundles \
  --bundle-id star-office-ui-<release-id> \
  --wheelhouse deploy/office/wheelhouse/linux-cp311-x86_64
```

输出包括解包目录、`tar.gz` 和 `.sha256`。交付前在目标机执行 `sha256sum -c star-office-ui-<release-id>.tar.gz.sha256`。如果使用完整 Docker 镜像归档，还可以加入 `--image-archive images/star-office-ui.tar`。

## 通信方式

浏览器只请求 Star Office 的 `/api/office/snapshot`。Collector 每 5 秒从服务端发起两类 HTTPS GET：

```text
GET /api/v1/plugins/{installation_id}/user-telemetry/status
GET /api/v1/plugins/{installation_id}/user-telemetry
Authorization: Bearer s2ut_...
```

Sub2API 会校验安装 ID、凭据 hash 和当前插件批准范围，然后由插件宿主通过 HashiCorp go-plugin/gRPC 调用只读 `ReadUserTelemetry`；宿主从 PostgreSQL 读取用户、API Key 元数据和 usage_logs，从 Redis 读取当前并发。Collector 校验用户范围、固定的 Asia/Shanghai 时间窗口和分页结果后，把脱敏快照写入共享数据卷，Web 再读取快照。token 永远不会发给浏览器，也不会用于模型请求。

当前仓库 `integrations/sub2api/host-source` 的插件版本是 `0.1.1`，已经覆盖 Star Office 的身份、API Key 元数据、当日 Token 总量和并发指标。`integrations/sub2api/patches/user-telemetry-v0.2.1/` 是针对特定 Sub2API 0.2.15 的历史补丁，额外加入 `active_models` 扩展；补丁没有自动应用到当前 host-source，部署前必须按插件 manifest 和目标宿主版本重新验收。
