# 部署指南

本文档区分本地开发、普通独立运行和正式办公室发布。正式发布是离线、不可变、可回滚流程；本地测试通过不等于已经完成生产部署。

## 1. 本地开发

要求 Python 3.10 或更高版本。建议使用虚拟环境：

```bash
cd Star-Office-UI
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r backend/requirements.txt
cp state.sample.json state.json
python backend/app.py
```

浏览器打开 `http://127.0.0.1:19000/`。另一个终端可以切换状态：

```bash
python set_state.py writing "正在整理文档"
python set_state.py syncing "同步进度中"
python set_state.py error "发现问题，排查中"
python set_state.py idle "待命中"
```

开发模式默认关闭新版办公室（`OFFICE_ENABLED=0`），保留旧版完整看板。需要测试新版办公室时，先准备独立数据目录和强密钥，再显式开启：

```bash
export OFFICE_ENABLED=1
export OFFICE_RELEASE_ID=office-v1-dev
export STAR_OFFICE_ENV=development
export STAR_OFFICE_DATA_DIR="$PWD/.local/dev-data"
export FLASK_SECRET_KEY="replace-with-a-random-value-at-least-24-chars"
export ASSET_DRAWER_PASS="replace-with-a-strong-password"
python backend/app.py
```

开发服务器只用于本机验证。公网访问应使用受控反向代理或 Cloudflare Tunnel，并且不能把开发密钥带入生产。

## 2. 测试和检查

提交前至少运行：

```bash
python -m compileall -q backend scripts
python scripts/test_office_release.py
```

前端/专项回归按改动选择对应脚本，例如：

```bash
node scripts/test_company_office.mjs
node scripts/test_office_connected_v5_screen_only_player.mjs
node scripts/test_office_v5_production_bridge.mjs
```

`scripts/test_office_release.py` 是离线发布工具测试，不会连接真实 Sub2API、Docker、Nginx 或生产服务器。

## 3. 生成正式离线发布包

发布必须使用新的不可变 release ID。先查看并运行发布测试，再使用与目标架构匹配的已审核 wheelhouse：

```bash
python scripts/test_office_release.py
python scripts/package_office_release.py \
  --release-id office-YYYYMMDD-v1 \
  --output deploy/office/out \
  --wheelhouse /path/to/linux-cp311-wheelhouse
```

打包器会按 ESM/CSS/JSON 实际依赖闭包选择资源，生成 `source_files`、`files`、`SHA256SUMS` 和外部 SHA256。它会排除 `.local`、测试夹具、QA 截图、候选原图、运行时数据库、密钥和 CA 私钥；不能覆盖已经存在的 release ID。

没有 Linux CPython 3.11 wheelhouse 时可以生成源码归档，但不能声称离线镜像构建已通过；不能用 macOS 或 Python 3.14 wheel 冒充目标依赖。

## 4. 目标主机预检和离线构建

以下操作只针对已确认的独立办公室发布目录。先通过安全渠道复制归档、外部 checksum、受限环境文件和必要证书/凭据文件；不把真实秘密写入 Git、命令行、日志或聊天。

```bash
RELEASE=/opt/star-office-ui/releases/office-YYYYMMDD-v1
ENV=/opt/star-office-ui/private/office.env

sha256sum -c "$RELEASE"/*.sha256
python3 "$RELEASE/deploy/office/validate_release.py" verify "$RELEASE"
"$RELEASE/deploy/office/build_offline.sh" "$RELEASE" "$ENV"
"$RELEASE/deploy/office/preflight.sh" "$RELEASE" "$ENV"
```

`build_offline.sh` 使用本地 Docker 镜像和 wheelhouse，执行 `--pull=false --network=none`；缺少缓存镜像或依赖时停止。`preflight.sh` 是只读检查，会校验镜像、端口、Compose、证书和候选 Nginx 配置，不会联系上游或启动服务。

Compose 只启动两个隔离服务：

```bash
docker compose --env-file "$ENV" \
  -f "$RELEASE/deploy/office/compose.yaml" \
  up -d --no-build --pull never office-web office-collector
```

`office-web` 和 `office-collector` 使用同一个不可变镜像、专用 named volume 和 UID/GID `10001:10001`。Web 只读取管理密码哈希；collector 才能读取上游消费凭据和 CA bundle。容器根文件系统只读，服务只在 loopback 发布应用端口。

## 5. Nginx、TLS 和验收

正式入口由已审核的独立 Nginx 配置提供：员工入口为 HTTP/LAN 的 `19000`，管理入口为 HTTPS/LAN 的 `19443/admin`。实际 IP、端口、证书 SAN、现有服务和防火墙必须在目标主机只读核对后才能使用，不能把示例地址当成当前事实。

上线前必须确认：

- 证书链和客户端信任正确，禁止用 `curl -k` 或忽略浏览器警告代替验收。
- `19001` 等已有服务没有被占用、替换或重启；新办公室端口冲突时停止。
- 未登录不能读取管理和旧写接口；同源 session + CSRF 才能保存配置。
- `/health`、`/api/office/snapshot`、版本化静态资源和员工/管理页面均可用。
- 采集异常显示未知状态而不是伪造 `0`；web 前端无法读取消费凭据。
- 桌面、平板、手机横竖屏和减少动态行为通过浏览器 QA。

Nginx 配置修改必须先 `nginx -t`，切换只使用平滑 `nginx -s reload`；不重启共享 Nginx、Sub2API、PostgreSQL 或 Redis。

## 6. 备份、升级和回滚

首次切换前由运维确认旧服务实际镜像、卷、挂载、Nginx 和防火墙，并完成 SQLite/JSON 备份及恢复演练。后续已部署的同一 Compose 项目可使用：

```bash
"$CURRENT/deploy/office/backup.sh" \
  "$CURRENT" "$CURRENT_ENV" "$BACKUP_DIR" "$NGINX_CONF" \
  --confirm-office-stop

"$CURRENT/deploy/office/rollback.sh" \
  "$CURRENT" "$CURRENT_ENV" "$VERIFIED_BACKUP" "$NGINX_CONF" \
  --confirm-office-stop
```

脚本只停止和恢复办公室自己的 `office-web`、`office-collector` 及专用卷；不会删除旧系统、触碰共享数据库或自动拉取镜像。回滚前会先保留当前数据和安全副本，恢复后必须重新检查健康状态、快照新鲜度、配置版本和浏览器入口。

## 7. 禁止事项

- 不要把 `state.json`、`join-keys.json`、SQLite、snapshot、`.env`、token、密码哈希或私钥提交到 Git。
- 不要直接覆盖旧 release 目录、旧镜像 tag 或共享数据卷。
- 不要用本机测试、HTTP 200、Docker `healthy` 或镜像标签代替真实浏览器/网络/数据验收。
- 不要在未核对目标主机前执行 SSH、Nginx、Docker、端口或防火墙变更。

