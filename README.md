# Star Office UI 6.0.1

![Star Office UI 6.0.1](assets/company-office-connected-v5/qa/desktop-4k-overview.png)

> 面向团队开发者的项目入口、开发说明和文件结构索引。

Star Office UI 是一个实时 AI 协作办公室与状态可视化平台。当前仓库同时维护旧版看板、新版办公室、独立通用 API、可选 Sub2API 集成，以及 Electron/Tauri 桌面壳。不同入口有不同数据边界，开发前先确认自己要改的是哪一套运行时。

项目版本以 VERSION 为准；当前为 6.0.1。

## 先从这里开始

| 任务 | 先读 |
| --- | --- |
| 第一次运行项目 | [本地开发](#本地开发) |
| 修改员工端、管理员端或办公室 API | [新版办公室](#新版办公室) 和 [运行时边界](#运行时边界) |
| 接入团队工具或 Agent 状态 | [独立通用 API](#独立通用-api) 和 [API 开发说明](./docs/API_DEVELOPMENT.md) |
| 修改地图、角色、家具或动画 | [目录结构](#目录结构) 中的 frontend/company-office 和 [动画文档](./docs/ANIMATION_ARCHITECTURE.md) |
| 修改 Sub2API 遥测集成 | [integrations/sub2api/README.md](./integrations/sub2api/README.md) 和 [系统部署说明](./docs/SYSTEM_DEPLOYMENT.md) |
| 做安装、升级、发布或回滚 | [发布与部署](#发布与部署) 和 [部署指南](./docs/DEPLOYMENT.md) |
| 查看完整一级、二级目录职责 | [项目结构说明](./docs/PROJECT_STRUCTURE.md) |

## 项目边界

项目由以下几部分组成：

- Flask 主服务：负责旧版页面、新版办公室页面、办公室 API、状态快照和运行时资源。
- 新版办公室前端：frontend/office 提供员工入口和管理员入口，配套 16 席像素办公室、四向角色、状态气泡、屏幕特效和移动端布局。
- 独立通用 API：api_service/ 提供 provider-neutral 的 Agent 事件和快照接口，默认不依赖 Sub2API。
- 可选 Sub2API collector：只有在需要接入 Sub2API 用户遥测时才启用，不能当作默认开发依赖。
- 桌面壳：desktop-pet/ 是 Tauri 工程，electron-shell/ 是 Electron 工程；两者复用 Python 后端，但窗口和进程生命周期分别验证。
- 发布工具：deploy/quickstart/ 用于可复制安装和更新，deploy/office/ 用于正式办公室的不可变发布、预检、备份和回滚。

## 运行时边界

~~~text
浏览器
  └─ backend/app.py :19000
       ├─ 默认模式：根目录旧版页面和状态接口
       └─ OFFICE_ENABLED=1：frontend/office 员工端、管理员端和办公室 API

团队工具 / Agent
  └─ api_service :19100
       └─ SQLite：事件记录和最新 Agent 状态投影

Sub2API（可选）
  └─ backend/office_collector.py
       └─ Office 快照 / frontend/office 展示
~~~

两套 API 不要混用：

- 办公室接口使用 /api/office/*，服务员工端和管理员端。
- 独立通用 API 使用 /api/v1/*，服务团队工具和 Agent 集成。
- 独立通用 API 不保存 API key、Bearer token、密码、Cookie、邮箱或上游原始响应。
- 本地测试通过不代表已经完成生产部署或真实数据验收。

## 本地开发

### 环境要求

- Python 3.10 或更高版本。
- Node.js：运行前端 ESM、浏览器专项测试和桌面壳。
- Docker：仅在 Quickstart 或正式发布流程需要时使用。
- Go：只有修改 integrations/sub2api/host-source/backend 时需要，版本以该目录 go.mod 为准。

### 安装依赖

~~~bash
git clone https://github.com/hereww/Star-Office-UI.git
cd Star-Office-UI

python3 -m venv .venv
. .venv/bin/activate
python3 -m pip install -r backend/requirements.txt
cp state.sample.json state.json
~~~

### 默认模式：旧版看板

默认模式用于快速查看旧版完整看板，监听 19000：

~~~bash
python3 backend/app.py
~~~

打开 http://127.0.0.1:19000/。另一个终端可以切换本地状态：

~~~bash
python3 set_state.py writing "正在整理文档"
python3 set_state.py researching "正在查阅资料"
python3 set_state.py syncing "正在同步进度"
python3 set_state.py idle "待命中"
~~~

### Office 模式：新版员工端和管理员端

Office 模式默认关闭。需要验证新版办公室时，使用独立数据目录和开发密钥：

~~~bash
export OFFICE_ENABLED=1
export OFFICE_RELEASE_ID=office-v1-dev
export STAR_OFFICE_ENV=development
export STAR_OFFICE_DATA_DIR="$PWD/.local/dev-data"
export FLASK_SECRET_KEY="replace-with-a-random-value-at-least-24-chars"
export ASSET_DRAWER_PASS="replace-with-a-strong-password"

python3 backend/app.py
~~~

Office 模式下，员工入口和管理员入口分别是：

- http://127.0.0.1:19000/
- http://127.0.0.1:19000/admin

开发密钥只能用于本机验证。公网访问、证书、管理员凭据、Nginx 和回滚必须按 [部署指南](./docs/DEPLOYMENT.md) 执行。

## 独立通用 API

api_service/ 是不依赖 Sub2API 的 provider-neutral 接入层。团队工具向 /api/v1/events 写入规范化事件，办公室适配层或其他消费者从 /api/v1/snapshot 读取最新投影。默认监听 127.0.0.1:19100。

启动：

~~~bash
API_DATA_FILE="$PWD/.local/api-service/state.sqlite3" \
  python3 -m api_service.app
~~~

需要鉴权时：

~~~bash
API_AUTH_MODE=key \
API_KEY_FILE=/path/to/api-key \
API_DATA_FILE="$PWD/.local/api-service/state.sqlite3" \
  python3 -m api_service.app
~~~

API key 至少 24 个字符，只通过受控环境或权限为 0400/0600 的文件注入。不要写进仓库、请求 body、日志或浏览器 bundle。

完整的 v1 端点、事件格式、幂等规则、快照 freshness、错误码和接入约定见 [API_DEVELOPMENT.md](./docs/API_DEVELOPMENT.md)。

## 新版办公室

新版办公室的主要入口：

- frontend/office/index.html：员工端页面。
- frontend/office/admin.html：管理员端页面。
- frontend/office/app.mjs、bootstrap.mjs：页面启动和运行时装配。
- frontend/office/model.mjs、transport.mjs：数据模型、轮询、会话和 API 写入。
- frontend/office/map-loader.mjs：地图和运行时资源加载。
- frontend/office/release-manifest.json：发布资源闭包清单。
- frontend/office/：新版办公室页面、运行时资源和本地专项测试。

地图和角色运行时位于 frontend/company-office：

- connected-v4：V4 连接运行时和遥测适配。
- connected-v5：V5 连接运行时、座位角色、家具、摇滚房间和屏幕特效。
- reference-v3：参考运行时和参考素材。
- media：共享角色、方向帧、状态帧和通用媒体。

根目录 frontend/index.html、frontend/game.js、frontend/layout.js 和旧版图片属于另一套旧版入口。修改新版办公室时不要顺手改旧版逻辑；修改地图或角色时先确认当前发布入口是 V4、V5 还是 reference-v3。

## 目录结构

~~~text
Star-Office-UI/
├── api_service/                 独立通用 API：app、store、wsgi
├── api-service/                 API 启动包装和环境变量模板
├── assets/                      地图、角色、家具、参考图和 QA 素材
├── backend/                     Flask 主服务、办公室 API、collector、存储和安全
├── deploy/
│   ├── quickstart/              可复制安装、校验、升级和卸载
│   ├── office/                  正式发布、Compose、预检、备份和回滚
│   └── bundles/                 生成的交付归档和校验文件
├── desktop-pet/                 Tauri 桌面壳
├── dist/                        历史发行物
├── docs/                        架构、开发、部署、契约和验收文档
├── electron-shell/              Electron 桌面壳
├── frontend/
│   ├── company-office/          V3/V4/V5 地图、角色、家具和运行时
│   ├── office/                  新版员工端、管理员端和测试
│   ├── fonts/                   本地字体和许可证
│   └── vendor/                  固定版本本地第三方库
├── integrations/sub2api/
│   ├── host-source/             Sub2API 宿主源码副本
│   ├── patches/                 按宿主版本保存的集成补丁
│   └── plugin-tools/            插件打包、验签和测试工具
├── scripts/                     构建、预览、QA、安全检查和测试脚本
├── wheelhouse/                  根目录离线依赖占位
├── .local/                      本地预览、截图、审计、回滚和测试证据
├── VERSION                      当前版本号
└── pyproject.toml               Python 项目元数据
~~~

### 根目录常用文件

| 文件 | 用途 |
| --- | --- |
| backend/app.py | Flask 主入口 |
| backend/office_*.py | Office API、契约、存储、安全和 collector |
| api_service/app.py | 独立通用 API 入口 |
| api_service/store.py | 独立 API 的 SQLite 事件和状态存储 |
| state.sample.json | 本地状态文件模板 |
| runtime-config.sample.json | 运行配置模板 |
| join-keys.sample.json | 邀请 key 模板 |
| set_state.py | 本地状态切换工具 |
| office-agent-push.py | Agent 加入和状态推送工具 |
| healthcheck.sh | 环境相关健康检查示例；执行前先核对日志路径和 systemd 服务名 |
| asset-defaults.json、asset-positions.json | 默认资产和位置配置 |
| pyproject.toml、uv.lock | Python 元数据和锁定依赖 |
| SKILL.md | 项目级工作说明 |

以下目录不应被当作当前源码版本：

- .local/：本地证据和临时工作区。
- deploy/office/out/：候选发布包和解包目录。
- deploy/bundles/：本地生成的交付归档。
- dist/：历史发行物。
- state.json、SQLite、日志、.env 和 token 文件：运行时数据或秘密。

完整的一级、二级目录职责见 [PROJECT_STRUCTURE.md](./docs/PROJECT_STRUCTURE.md)。

## 测试矩阵

先运行与改动直接相关的测试，再运行提交前基线：

| 改动范围 | 推荐检查 |
| --- | --- |
| Python 后端、Office API、存储 | python3 -m compileall -q backend api_service scripts；python3 -m unittest scripts.test_office_api scripts.test_office_store -v |
| 独立通用 API | python3 -m unittest scripts.test_api_service -v；python3 -m compileall -q api_service scripts/test_api_service.py |
| Quickstart、正式发布工具 | python3 scripts/test_quickstart_update.py；python3 scripts/test_quickstart_config.py；python3 scripts/test_office_release.py |
| 地图、V4/V5、浏览器运行时 | node scripts/test_company_office.mjs；按改动运行 scripts/test_office_*.mjs 或 frontend/office/ 中的专项脚本 |
| Sub2API 插件工具 | PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s integrations/sub2api/plugin-tools/tests -v |
| Sub2API 宿主 | 在 integrations/sub2api/host-source/backend 执行 go test ./cmd/user-telemetry-plugin/... 和对应 node --test 命令 |

常用基线：

~~~bash
python3 -m compileall -q backend api_service scripts
python3 -m unittest scripts.test_api_service -v
python3 scripts/test_office_release.py
~~~

测试通过只说明对应本地代码、fixture 或离线工具通过。它不等于已部署、已连接 Sub2API、已完成浏览器验收或已完成生产回滚演练。

## 开发协作流程

每个任务按下面顺序推进：

1. 先判断影响边界：旧版页面、新版办公室、独立 API、Sub2API、桌面壳还是发布工具。
2. 先读对应 README、契约和测试入口，确认当前实际使用的运行时版本。
3. 修改契约、数据结构或配置时，同时更新实现、测试和文档。
4. 运行与改动直接相关的专项测试，再运行必要的基线测试。
5. 把截图、日志和测试输出放到 .local/；不要把本地证据当成生产验收。
6. PR 或交接说明写清楚：改了哪些目录、执行了哪些命令、哪些结果已验证、哪些仍待目标环境确认。
7. 发布或升级使用新的 release ID，保留校验值、备份和可回滚材料。

## 发布与部署

### Quickstart

用于互联网主机或内网主机的可复制安装和离线更新：

- deploy/quickstart/install.sh：联网或离线安装，支持 Docker/native。
- deploy/quickstart/update.sh：保留数据和凭据的离线升级。
- deploy/quickstart/verify.sh：安装包和服务检查。
- deploy/quickstart/uninstall.sh：卸载入口。

构建交付包和执行安装前，先读 [部署指南](./docs/DEPLOYMENT.md) 和 [deploy/quickstart/README.md](./deploy/quickstart/README.md)。

### 正式办公室发布

deploy/office/ 是不可变、可预检、可备份和可回滚的正式发布流程：

- build_offline.sh：离线构建。
- preflight.sh：目标主机只读预检。
- compose.yaml：office-web 和 office-collector 编排。
- backup.sh、rollback.sh：发布前备份和回滚。
- validate_release.py、verify_image.py：发布物和镜像校验。

正式发布不使用本机开发密钥，不覆盖旧 release，不把共享数据库或其他服务纳入办公室回滚。完整步骤见 [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md)。

## 文档地图

| 文档 | 内容 |
| --- | --- |
| [docs/PROJECT_STRUCTURE.md](./docs/PROJECT_STRUCTURE.md) | 运行时边界、组件关系、数据目录和源码边界 |
| [docs/API_DEVELOPMENT.md](./docs/API_DEVELOPMENT.md) | 独立通用 API 的契约、鉴权、接入和测试 |
| [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md) | 本地开发、Quickstart、正式发布、预检、备份和回滚 |
| [docs/SYSTEM_DEPLOYMENT.md](./docs/SYSTEM_DEPLOYMENT.md) | Sub2API、插件、Office 和 collector 的系统安装顺序 |
| [docs/SUB2API_DEPLOYMENT.md](./docs/SUB2API_DEPLOYMENT.md) | Sub2API 主服务、PostgreSQL、Redis 的安装 |
| [docs/SUB2API_PLUGIN_DEPLOYMENT.md](./docs/SUB2API_PLUGIN_DEPLOYMENT.md) | 插件验签、宿主兼容性、安装、凭据和回滚 |
| [frontend/office/README.md](./frontend/office/README.md) | 新版办公室前端契约、资源加载和专项测试 |
| [integrations/sub2api/README.md](./integrations/sub2api/README.md) | Sub2API 宿主、遥测插件、补丁和打包验签 |
| [deploy/office/README.md](./deploy/office/README.md) | 正式办公室发布包的运维约束 |

## 安全边界

- 不提交 API key、Bearer token、OAuth 凭据、管理员密码、密码哈希、Cookie、SQLite、快照、.env、CA 私钥或真实用户数据。
- 独立 API 的 metadata 禁止携带 token、secret、password、credential、authorization、api_key、cookie、email 和 user_id 等敏感字段。
- 生产环境的凭据通过受控环境变量、私有文件或密钥系统注入，不能写进前端 bundle。
- 不要执行 git clean、全量 reset、批量删除发布目录或重启共享服务来“清理”工作区，先确认未提交改动和回滚材料。
- 不要把本机健康检查、Docker healthy、HTTP 200 或本地截图写成生产已验收。

## 当前状态说明

README 描述的是代码和开发入口，不宣称当前目标主机已部署或已通过生产验收。生产状态、目标环境、release ID、备份、健康读回和浏览器验收以日期化的部署/验收文档为准。

## 许可

Star Office UI 根项目遵循根目录 [LICENSE](./LICENSE)。integrations/sub2api/host-source/ 保留 Sub2API 上游许可证和声明，使用该目录时同时遵守其中的许可要求。
