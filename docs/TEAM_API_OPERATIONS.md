# 通用遥测 API 部署与交接

本文供 API 和 Office 服务维护者使用。调用方只需阅读 [API 开发文档](API_DEVELOPMENT.md)。本实现以当前新版 Office 契约为边界，不要求 Sub2API、Redis 或外部数据库；使用独立 SQLite。

## 1. 组件与发布边界

- api_service：独立 HTTP API，项目鉴权、观测存储、幂等和快照。
- backend/team_telemetry.py：共享的通用指标契约。
- backend/office_team_collector.py：专用采集器，把项目主体映射到 Office 内部绑定 ID。
- 既有 Office Web、后台配置和前端：继续使用 /api/office/* 与 16 个工位。

OFFICE_TELEMETRY_PROVIDER=standalone 显式启用新采集链路；未设置时仍为现有 sub2api 模式。生产服务器不会因为合并代码自动切换。

本分支的接口、实际 HTTP 链路与新版前端契约验证见 [验收记录](TEAM_API_ACCEPTANCE.md)。Docker 镜像构建、目标机 TLS 和线上切换验收必须在实际部署时执行；不能用本地测试替代。

## 2. 生成项目凭据与映射

在仓库根目录执行：

```bash
python3 api-service/bootstrap.py --output .local/team-api --project company --subject developer-1
```

命令不覆盖既有文件，只打印文件路径：

| 文件 | 安装位置与用途 |
| --- | --- |
| api-project-keys.json | API 服务专用；包含项目写入和读取凭据及 permissions |
| office-reader-keys.json | Office 采集器专用；只有读取凭据 |
| office-subjects.json | Web 和 Collector 使用相同映射 |
| producer.json | 通过受控方式单独交给项目开发者；只有该项目写入凭据 |

生成的四个文件（包含映射文件）权限均为 0600；凭据读取器只接受 0400/0600。容器默认 UID/GID 10001，Linux 部署时应由维护者设置 API/Collector 使用的凭据及映射文件所有者为 10001:10001；不要将权限放宽到全局可读。样例生成在 .local 中，不能提交 Git。

凭据绑定项目，读写权限独立。API 启动时加载凭据，增加、轮换或撤销后重启/重载 API 工作进程，再用旧凭据验证 401、新凭据验证所需权限。采集器每轮读取凭据文件。

映射示例：

```json
[
  {"office_user_id":"1","project_id":"company","subject_id":"developer-1"},
  {"office_user_id":"4","project_id":"company","subject_id":"developer-2"}
]
```

office_user_id 是 Office 内部数字绑定 ID，不是 Sub2API 账号。新部署可自行分配；迁移时应显式复用希望保留的绑定 ID。映射列表不允许重复主体或重复内部 ID；同一主体要显示在多个工位，在后台将多个工位绑定到同一个内部 ID即可。

修改映射后同时重启 Web 和 Collector。映射不会重写已有工位、角色、显示设置或配置历史。新主体上报后，管理员可从现有用户选择器绑定到工位。首次空库仍沿用原有默认工位规则，生成器中的 ID 1 默认对应 desk-12。

## 3. 本机 API 启动

Python 3.10+；生产 Office 镜像继续使用项目要求的 Python 3.11。

```bash
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r api-service/requirements.txt

# 先完成第 2 节的凭据生成，再启动服务。

API_PROJECT_KEYS_FILE="$PWD/.local/team-api/api-project-keys.json" \
API_DATA_FILE="$PWD/.local/team-api/telemetry.sqlite3" \
python -m api_service.app
```

默认监听 127.0.0.1:19100，默认 API_AUTH_MODE=key。正式运行使用：

```bash
API_PROJECT_KEYS_FILE="$PWD/.local/team-api/api-project-keys.json" \
API_DATA_FILE="$PWD/.local/team-api/telemetry.sqlite3" \
gunicorn --workers 2 --threads 4 --bind 127.0.0.1:19100 api_service.wsgi:app
```

使用经过配置的 HTTPS 反向代理向公司项目提供访问；密钥不在 URL 中。API_ALLOWED_ORIGINS 默认空，后端集成不需要 CORS。只有显式 API_AUTH_MODE=none 才关闭鉴权，此模式仅用于隔离开发，不用于发给同事的正式服务。

| API 环境变量 | 默认值 | 用途 |
| --- | --- | --- |
| API_AUTH_MODE | key | key / none |
| API_PROJECT_KEYS_FILE | 必填（项目接口） | 项目凭据 JSON 文件 |
| API_DATA_FILE | .local/api-service/state.sqlite3 | 独立 SQLite 文件 |
| API_TELEMETRY_STALE_SECONDS | 15 | 每个主体和指标的有效期，5–300 秒 |
| API_TELEMETRY_RETENTION_DAYS | 7 | 幂等记录保留期，1–365 天 |
| API_BIND / API_PORT | 127.0.0.1 / 19100 | 开发服务器监听 |
| API_SERVICE_KEY / API_KEY_FILE | 空 | 仅旧状态接口需要，互斥 |

主体最新观测会持久化；幂等记录在写入时按保留期清理。每项目最多 500 个稳定主体，不能把每条业务请求当成新主体。密钥文件不进入数据库。

## 4. Office 启用 standalone

Web 和 Collector 都设置：

```bash
export OFFICE_TELEMETRY_PROVIDER=standalone
export OFFICE_SUBJECTS_FILE="$PWD/.local/team-api/office-subjects.json"
export OFFICE_DATA_DIR="$PWD/.local/team-office"
```

Collector 另外设置并启动：

```bash
OFFICE_API_BASE_URL=http://127.0.0.1:19100 \
OFFICE_API_KEYS_FILE="$PWD/.local/team-api/office-reader-keys.json" \
OFFICE_ALLOW_HTTP=1 \
python -m backend.office_collector
```

生产使用 HTTPS；示例 HTTP 仅用于本机或专用 Docker 内网。不要传入 OFFICE_SUB2API_BASE_URL、s2ut 凭据、插件安装 ID 或 Sub2API 用户范围。

Web 沿用现有 Office 主服务与管理员密码配置，只新增以上 provider 和映射文件设置。默认 5 秒采集；指标按 API 有效期与 Office 的 3 倍采集间隔中较小者失效。多个项目需要各自读取凭据；完整采集预算 10 秒，任一来源认证或响应失败都会使本轮快照失效，避免保留旧的可信状态。

项目暂未实现的 API Key/邮箱元数据不会伪造，后台显示没有 Key 元数据。公开页面只发布既有允许字段，不暴露 project_id、subject_id、内部映射或凭据。

## 5. 容器部署

[api-service/compose.yaml](../api-service/compose.yaml) 是单独的公司部署入口，包含 telemetry-api、office-web、office-collector，独立项目名 star-office-team 和独立数据卷。它不需要 Sub2API 服务。

先按现有 [Office 部署说明](../deploy/office/README.md) 从本次代码打包新的不可变 Office release，并离线构建 Office 镜像。新后端模块会进入 release 清单；不要直接使用审计时尚未含适配器的旧线上镜像。

离线构建使用的受控 env 设置 OFFICE_TELEMETRY_PROVIDER=standalone，并提供 OFFICE_API_BASE_URL、OFFICE_API_KEYS_FILE、OFFICE_SUBJECTS_FILE；其余签名、管理员、镜像和站点证书配置仍需提供。该模式的 validate_release 不要求 Sub2API 凭据或上游 CA。

给 Compose 提供以下受控环境变量：

- OFFICE_IMAGE、OFFICE_RELEASE_ID：此次新构建的不可变 Office 镜像及 release。
- TEAM_CONFIG_DIR：上述四个配置文件的绝对目录。
- OFFICE_ADMIN_SECRET、FLASK_SECRET_KEY、ASSET_DRAWER_PASS：沿用 Office 的独立随机配置要求。
- OFFICE_ADMIN_HASH_FILE：管理员密码哈希文件。
- OFFICE_ADMIN_URL、OFFICE_EMPLOYEE_URL：目标站点入口；反向代理按原有 Office 规则配置。
- 可选 TEAM_API_IMAGE、API_PORT、OFFICE_APP_PORT。

```bash
docker compose --env-file /absolute/private/team-office.env -f api-service/compose.yaml config --quiet
docker compose --env-file /absolute/private/team-office.env -f api-service/compose.yaml build telemetry-api
docker compose --env-file /absolute/private/team-office.env -f api-service/compose.yaml up -d
```

API 与 Office 主应用默认只映射主机回环端口，前面需要 HTTPS 入口。API 镜像默认在线安装锁定依赖；离线环境需预先构建/导入此镜像及基础镜像，不能假定 Office wheelhouse 自动包含独立 API 镜像。

不要用旧的 deploy/office/compose.yaml 启动 standalone；它仍是原有 Sub2API 部署配置。

## 6. 验证与交接

```bash
python -m pip install -r api-service/requirements-dev.txt
python -m unittest scripts.test_api_service scripts.test_team_telemetry scripts.test_team_api_http -v
python -m unittest scripts.test_team_api_contract -v
python -m unittest scripts.test_office_api scripts.test_office_collector scripts.test_office_store -q
```

测试使用临时数据和本机端口，不调用真实模型或现有生产服务。

交接前，在目标开发环境执行以下检查：

1. health 和 readiness 为 200；无凭据写入 401，跨项目或错误权限 403。
2. 公司项目写入完整观测，第一次 201、同内容重试 200；查看 applied。
3. 只读项目快照完整，Office /api/office/snapshot 的指定工位显示一致。
4. 多模型映射、partial、大 Token 字符串、可信零均正确。
5. 暂停该开发主体上报，超过有效期后变为未知；其他主体更新不能掩盖它。
6. 恢复上报后恢复；故障/离线的设备间状态与业务忙闲分开验证。
7. 工位、角色、配置版本及历史与预期一致；一个主体的多工位绑定保留。

将 API 地址、项目 ID、已映射主体清单、只含写入权限的 producer.json 和 API_DEVELOPMENT.md 交给调用方。不要把 API 服务的全部项目密钥文件发给调用方。

## 7. 备份与切换

API SQLite 与 Office 配置库分别备份，运行中使用 SQLite 在线备份或停止写入后复制，不能只复制 WAL 模式的主文件。保留受控密钥/映射配置，秘密文件不要放入普通代码归档。

现有生产从 Sub2API 切换前，先在独立数据目录完成上述开发环境验收，再备份 Office 配置并明确逐项主体映射。保留旧镜像和 provider 配置；回滚只恢复相应应用与配置，不删除持续写入的数据。切换应是单独的部署操作，本分支开发不会自动执行。
