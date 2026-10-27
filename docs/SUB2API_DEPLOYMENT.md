# Sub2API 主服务安装说明

本文只安装 Sub2API 主服务及其 PostgreSQL、Redis 依赖。用户遥测插件是单独的交付物，安装步骤见 [`SUB2API_PLUGIN_DEPLOYMENT.md`](./SUB2API_PLUGIN_DEPLOYMENT.md)。Star Office UI 的 Collector 也不会在本说明中自动安装。

## 使用哪个 Compose 文件

仓库内可复现的 Compose 文件位于：

~~~text
integrations/sub2api/host-source/deploy/docker-compose.local.yml
~~~

该文件使用 ./data、./postgres_data 和 ./redis_data 本地目录，便于备份和搬迁。生产环境应先把 image: ...:latest 改成已验收的固定 tag 或 digest，并把实际镜像记录到部署清单；不要把 latest 当作回滚版本。

## 前置条件

- Linux amd64 或 arm64，目标架构必须与镜像一致；
- Docker Engine 和 Docker Compose v2；
- 生产磁盘有足够空间保存数据库、Redis AOF、应用数据和备份；
- 只开放需要的 Sub2API HTTP 入口，PostgreSQL/Redis 不发布到公网；
- 已准备私有 .env，权限 0600。

## 联网 Docker 安装

在目标机创建部署目录，复制 Compose 文件：

~~~bash
sudo install -d -m 700 /opt/sub2api
sudo install -m 640 integrations/sub2api/host-source/deploy/docker-compose.local.yml \
  /opt/sub2api/docker-compose.local.yml
cd /opt/sub2api
sudo install -m 600 /dev/null .env
~~~

编辑 /opt/sub2api/.env。至少设置固定的数据库密码、Redis 密码、JWT 密钥、TOTP 加密密钥、管理员邮箱/密码和绑定地址。示例字段如下，CHANGE_ME 必须替换：

~~~dotenv
BIND_HOST=127.0.0.1
SERVER_PORT=8080
POSTGRES_USER=sub2api
POSTGRES_DB=sub2api
POSTGRES_PASSWORD=CHANGE_ME_LONG_RANDOM_VALUE
REDIS_PASSWORD=CHANGE_ME_LONG_RANDOM_VALUE
JWT_SECRET=CHANGE_ME_LONG_RANDOM_VALUE
TOTP_ENCRYPTION_KEY=CHANGE_ME_LONG_RANDOM_VALUE
ADMIN_EMAIL=admin@example.invalid
ADMIN_PASSWORD=CHANGE_ME_ADMIN_PASSWORD
TZ=Asia/Shanghai
~~~

生成随机值时在受控终端执行，例如：

~~~bash
openssl rand -hex 32
~~~

首次启动会执行数据库迁移并创建管理员。设置了 ADMIN_PASSWORD 时不要再从日志读取密码；若由宿主自动生成，日志读取必须在受控终端完成，不能把整段日志贴入聊天或工单。

启动并检查：

~~~bash
mkdir -p data postgres_data redis_data
docker compose --env-file .env -f docker-compose.local.yml pull
docker compose --env-file .env -f docker-compose.local.yml up -d
docker compose --env-file .env -f docker-compose.local.yml ps
docker compose --env-file .env -f docker-compose.local.yml logs --tail=100 sub2api
curl --fail --silent --show-error http://127.0.0.1:8080/health
~~~

如果 Sub2API 由另一台主机访问，把 BIND_HOST 改成受控 LAN 地址或交给已审核的 HTTPS 反向代理，并在防火墙中只放行必要来源。不要为了让 Collector 能访问而直接放开公网。

## 内网离线 Docker 安装

离线主机不能执行 pull、不能访问 PyPI/GitHub，也不能依赖构建时临时下载。应在一台联网且架构匹配的构建机上准备完整交付目录。

### 在联网构建机准备镜像包

1. 复制本说明使用的 Compose 文件和私有 .env 模板到临时目录。
2. 把 Compose 中的应用镜像从 latest 改成已验收的固定 tag/digest，并记录宿主构建版本。
3. 列出 Compose 使用的全部镜像，确认架构后拉取：

~~~bash
cd /path/to/sub2api-deploy
docker compose --env-file .env -f docker-compose.local.yml config --images \
  | sort -u > images.txt
while IFS= read -r image; do docker pull "$image"; done < images.txt
docker image inspect $(tr '\n' ' ' < images.txt) \
  --format '{{.RepoTags}} {{.Id}} {{.Architecture}}'
docker save -o sub2api-images.tar $(tr '\n' ' ' < images.txt)
sha256sum sub2api-images.tar docker-compose.local.yml images.txt > SHA256SUMS
~~~

如果使用的是带用户遥测能力的定制宿主镜像，必须把该确切镜像列入 images.txt，不能在离线目标机上用官方 latest 替代。

4. 把 docker-compose.local.yml、.env、data/、postgres_data/、redis_data/、sub2api-images.tar、SHA256SUMS 通过受控介质复制到内网目标机。.env 仍应单独限权，不要把真实秘密放入公开归档。

### 在离线目标机启动

~~~bash
cd /opt/sub2api
sha256sum -c SHA256SUMS
docker load --input sub2api-images.tar
docker compose --env-file .env -f docker-compose.local.yml \
  up -d --pull never
docker compose --env-file .env -f docker-compose.local.yml ps
curl --fail --silent --show-error http://127.0.0.1:8080/health
~~~

如果 docker load 后 Compose 仍提示缺镜像，说明镜像 tag/digest、架构或 Compose 文件不一致，应停止，不要临时开启联网回退。离线构建定制镜像需要完整 Go module、pnpm lock/cache 和基础镜像，属于单独的构建流程；本说明默认交付已经构建好的镜像归档。

## 初次配置和检查

启动成功后：

1. 通过受控 HTTPS/内网入口登录管理后台；
2. 确认数据库迁移完成、用户/Key/账户数据可读；
3. 确认 Redis healthy，且没有将 PostgreSQL/Redis 端口发布到不必要的网络；
4. 记录实际应用镜像 ID、Compose 文件 SHA-256、迁移状态和管理员配置；
5. 只有在 Sub2API 自身稳定后，才安装用户遥测插件。

插件安装前不要在 Sub2API 中创建用于“测试”的生产用户、API Key 或模型请求。插件的只读验收应使用已批准的真实用户范围和受控窗口。

## 常用运维命令

~~~bash
docker compose --env-file .env -f docker-compose.local.yml ps
docker compose --env-file .env -f docker-compose.local.yml logs --tail=200 sub2api
docker compose --env-file .env -f docker-compose.local.yml restart sub2api
docker compose --env-file .env -f docker-compose.local.yml stop
docker compose --env-file .env -f docker-compose.local.yml start
~~~

不要使用 down -v 作为日常重启命令；它会删除命名卷（如果部署方式改用了命名卷），并且容易让运维误以为数据已经备份。

## 备份、升级和回滚

数据库备份要使用 PostgreSQL 工具，不能只复制正在写入的数据库目录：

~~~bash
mkdir -p /opt/sub2api/backups/<timestamp>
docker compose --env-file .env -f docker-compose.local.yml exec -T postgres \
  sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  > /opt/sub2api/backups/<timestamp>/sub2api.sql
cp .env docker-compose.local.yml /opt/sub2api/backups/<timestamp>/
~~~

正式升级前还要保留旧应用镜像 ID、插件安装状态、信任公钥和 Redis/应用数据目录。新版本先在隔离环境迁移和验收，再切换同一 Compose 项目；不要直接覆盖旧 release 目录。

回滚时优先恢复旧应用镜像和旧配置，保留切换后的新业务记录。只有在数据迁移确实不可逆且已有恢复演练时，才按单独的数据库恢复方案操作。PostgreSQL、Redis 与 Sub2API 是共享基础服务，插件回滚不应默认重建或清空它们。

## 参考文件

- integrations/sub2api/host-source/deploy/docker-compose.local.yml
- integrations/sub2api/host-source/deploy/DOCKER.md
- integrations/sub2api/host-source/README_CN.md
- [`SUB2API_PLUGIN_DEPLOYMENT.md`](./SUB2API_PLUGIN_DEPLOYMENT.md)
