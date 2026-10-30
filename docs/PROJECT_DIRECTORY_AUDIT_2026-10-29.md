# Star Office UI 目录结构与团队接手说明

> 审计日期：2026-10-29（北京时间）  
> 审计范围：仓库一级目录、主要二级目录、关键入口文件和现有文档  
> 审计方式：只读扫描目录与文件，抽查 README、配置、运行入口和发布脚本  
> 文档状态：目录结构说明；目录变化时同步维护，作为团队接手和导航入口

## 1. 如何阅读这个仓库

这个仓库不是单一前端项目，而是由以下几类内容组成：

1. Star Office UI 的 Python/Flask 后端。
2. 旧版完整看板和新版 Company Office 前端。
3. Electron、Tauri 两套桌面容器。
4. Sub2API 用户遥测集成源码和插件工具。
5. Quickstart、正式办公室发布、vLLM 部署工具。
6. 前端素材、动画素材、地图配置和 QA 证据。
7. 架构、部署、验收、变更记录和生产审计文档。

团队接手时，先根据工作类型选择边界：

| 工作类型 | 首先阅读 | 主要目录 |
| --- | --- | --- |
| 修改员工端/管理员端 | frontend/office/README.md、docs/PROJECT_STRUCTURE.md | frontend/office/、backend/office_*.py |
| 修改地图、角色、家具、动画 | docs/ANIMATION_ARCHITECTURE.md、相关 V4/V5 文档 | frontend/company-office/、assets/ |
| 修改 API、状态、存储 | docs/office-production/API_CONTRACT_V1.md | backend/、scripts/test_office_*.py |
| 修改 Sub2API 遥测 | integrations/sub2api/README.md、docs/SYSTEM_DEPLOYMENT.md | integrations/sub2api/ |
| 修改发布或升级 | docs/DEPLOYMENT.md、deploy/office/README.md | deploy/、scripts/package_*.py |
| 修改桌面应用 | 对应壳的 README | desktop-pet/ 或 electron-shell/ |
| 做验收或回归 | 对应功能文档和测试脚本 | scripts/、.local/、docs/office-production/evidence/ |

## 2. 一级目录总览

| 路径 | 类型 | 主要职责 | 团队使用规则 |
| --- | --- | --- | --- |
| .agents/ | 工具配置 | 仓库级 Agent 技能和协作扩展 | 修改前确认是否影响本地 Agent 工作流 |
| .local/ | 本地产物 | 预览、截图、回滚、审计、测试中间文件 | 只作为证据和工作区使用，不作为源码依赖，不发布 |
| assets/ | 设计与 QA 素材 | 地图、角色、家具、参考图、素材审计和 QA 资料 | 修改素材时同步记录来源、版本和验证结果 |
| backend/ | 后端源码 | Flask 主服务、办公室 API、采集器、存储和安全逻辑 | API 或数据结构变更必须同步契约和测试 |
| deploy/ | 发布与部署 | Quickstart、正式办公室发布、vLLM 部署和归档输出 | 发布操作先备份、预检、校验，再切换 |
| desktop-pet/ | Tauri 桌面壳 | 透明桌面窗口和后端进程管理 | 只负责容器，不复制业务状态 |
| dist/ | 历史发布物 | 已生成的发行说明或旧发布目录 | 只读参考；新的发布物优先进入发布流程 |
| docs/ | 项目文档 | 架构、部署、契约、计划、验收和生产证据 | 新功能必须补入口文档和验证状态 |
| electron-shell/ | Electron 桌面壳 | Electron 版桌面窗口、托盘和兼容层 | 与 Tauri 并行维护，不能假设两者行为完全一致 |
| frontend/ | 前端源码和资源 | 旧版页面、新版办公室、地图运行时和本地第三方库 | 新版办公室与旧版页面保持边界，不混用运行时 |
| integrations/ | 外部系统集成 | Sub2API 宿主源码、遥测插件、补丁和打包验签工具 | 不提交生产凭据、数据库、签名私钥或依赖缓存 |
| scripts/ | 工具与测试 | 构建、预览、测试、QA、打包和安全检查 | 脚本是验证入口，修改行为时同步维护测试 |
| wheelhouse/ | 离线依赖占位 | 为 Quickstart/Docker 离线包提供 wheelhouse 上下文 | 根目录通常为空；实际 wheelhouse 在发布包中生成 |

## 3. 一级目录和二级目录说明

### 3.1 .agents/

- .agents/skills/：本仓库专用技能和工作流。
- 用途：辅助角色动画、项目操作或团队约定。
- 注意：这里的内容影响 Agent 如何操作项目，涉及技能变更时应单独审查。

### 3.2 .local/

这是仓库内规模较大的本地工作证据目录，包含预览、浏览器截图、生产审计、回滚快照、模型状态和临时诊断。

当前可见的主要二级目录包括：

- .local/office-preview-view/：办公室预览。
- .local/office-connected-v5-preview/、.local/office-connected-v5-preview-audit/：V5 预览和审计。
- .local/office-deploy-audit-*/：不同日期的部署审计证据。
- .local/office-v5-*/：V5 动画、模板、全屏、会话心跳和缩放相关验证。
- .local/admin-state-capture/、.local/live-face-capture-*/：管理页或角色状态捕获。
- .local/company-office-backups/：本地备份。
- .local/_audit_pillow/：审计辅助环境或依赖检查。

团队规则：

- .local 是证据区，不是正式源码区。
- 截图、测试输出和临时备份应说明日期、场景和结论。
- 不要从 .local 反向复制文件到正式静态资源，除非已经确认它是正式资产并补充来源记录。
- .gitignore 已将根 .local/ 作为本地目录排除。

### 3.3 assets/

一级目录保存设计资产、参考图、素材构建结果和 QA 证据。主要二级目录：

- assets/character-animation-proposals/：角色动画方案和候选素材。
- assets/company-office-combined-preview-v1/：组合办公室预览、场景配置、导航测试和像素 QA。
- assets/company-office-connected-v4/：V4 连接办公室资产和状态资料。
- assets/company-office-connected-v5/：V5 连接办公室资产、角色/家具资源和 QA。
- assets/company-office-floorplan-v2/：V2 平面图、布局 JSON、原图、移动端和单元 QA。
- assets/company-office-map-v1/：地图原图、生成记录和 QA 报告。
- assets/company-office-reference-v3/：V3 参考办公室、区域说明和集成 QA。
- assets/rock-room-band-v1/：摇滚房间角色、乐器和归一化结果。
- 根目录图片：项目 README 使用的快速预览或通用参考图。

团队规则：

- 资产目录名称带有版本和场景含义，不能只凭文件名判断是否已上线。
- 生成图、编辑图、运行时图和 QA 截图应分开保存。
- 资产变更要同步更新对应的 assets.json、布局 JSON、状态文件或 QA 报告。
- 不要把 QA 截图直接当作运行时资源。

#### 2026-10-30 归档更新

本次建立了外部素材归档快照，源文件保留在工作区，没有删除或移动：

```text
/Users/hepingyu/Documents/ChatGPT/Star-Office-UI-archive-20261030/assets-deprecated-20261030/
```

快照包含 841 个文件、约 160.96 MiB，范围是旧预览、QA、明确拒绝的背景候选、V3 历史角色候选和旧动画方案。逐文件 SHA-256、字节数及归档时工作区状态见 `archive-manifest.json`。V5 QA、V3 集成审计和 rock-room 预览中已有修改或未跟踪文件，因此只做快照，原路径继续作为当前工作证据。

必须留在工作区的运行/重建核心包括：`assets/room-reference.webp`、`assets/room-reference.png`、`assets/company-office-floorplan-v2/`、`assets/company-office-connected-v4/{horizontal,vertical}/`、`assets/company-office-reference-v3/{furniture,server}/`、`assets/rock-room-band-v1/source/` 和 `normalization.json`，以及 2026-10-14 breed 生成源。正式发布仍从 `frontend/` 依赖闭包取运行图片。

相关开发规则和恢复步骤见 `docs/PROJECT_STRUCTURE.md`、`docs/ANIMATION_ARCHITECTURE.md` 和 `docs/ASSETS_ARCHIVE_2026-10-30.md`。

### 3.4 backend/

后端是 Flask 主服务和新版办公室数据边界。主要文件职责：

| 文件 | 职责 |
| --- | --- |
| app.py | 主 Flask 进程、旧版入口和新版办公室路由装配 |
| office_api.py | 新版办公室 API、管理员接口和兼容边界 |
| office_contract.py | 办公室数据契约、快照和配置结构 |
| office_collector.py | 从 Sub2API 采集遥测并写入办公室快照 |
| office_store.py | 办公室配置、快照和 SQLite/JSON 数据存储 |
| office_settings.py | 办公室运行配置 |
| office_security.py | 办公室登录、CSRF、权限和安全边界 |
| office_characters.py | 角色资料、状态和角色配置 |
| security_utils.py | 通用安全工具 |
| store_utils.py | 通用存储和原子写入工具 |
| memo_utils.py | 备忘或状态辅助逻辑 |
| run.sh | 后端启动辅助脚本 |
| requirements.txt | 后端运行依赖 |

修改顺序建议：

1. 先修改契约和存储边界。
2. 再修改 API 或采集器。
3. 再更新前端投影。
4. 最后运行 API、存储、collector 和发布测试。

### 3.5 deploy/

部署目录同时包含交付包、正式办公室发布和 vLLM 脚本。

#### deploy/bundles/

- Quickstart 或套件归档、SHA256 文件。
- 属于交付输出，不是业务源码。
- 每个归档要保留 bundle ID 和校验值。
- 不能覆盖旧归档来伪造版本历史。

#### deploy/office/

正式办公室发布包和运维入口：

- Dockerfile、compose.yaml：容器构建和服务编排。
- entrypoint.py、wsgi.py：容器入口和生产 WSGI。
- env.example：配置模板，只允许占位符。
- nginx*.conf.template：反向代理、HTTPS、隔离入口模板。
- preflight.sh、validate_release.py、verify_image.py：发布前检查和产物校验。
- backup.sh、rollback.sh、volume_archive.py：备份、回滚和数据卷保存。
- healthcheck.py：健康检查。
- build_offline.sh：离线构建。
- out/：本地生成的候选发布包和解包目录。
- wheelhouse/：正式办公室离线依赖。

`deploy/office/wheelhouse/linux-cp311-x86_64/` 是当前工作区可见的 Linux CPython 3.11 x86_64 wheelhouse；它属于发布构建输入，不是开发机虚拟环境。

团队规则：out/ 只属于本地发布工作区；发布必须使用新 release ID，并保留备份、校验和回滚证据。

#### deploy/quickstart/

可复制安装和升级入口：

- install.sh：联网或离线安装，支持 Docker/native。
- update.sh：保留数据和凭据的离线更新。
- verify.sh、verify_bundle.py：安装包和服务验证。
- docker-compose.yml、Dockerfile、entrypoint.py：Quickstart 运行时。
- configure_sub2api.py：Sub2API 联动配置。
- env.example：环境变量模板。
- uninstall.sh：卸载入口。
- .runtime/：本地运行时状态，不应进入源码发布。

#### deploy/vllm/

- vllm-deploy.sh：带备份、健康检查、Key 文件和回滚逻辑的 vLLM Docker 部署脚本。
- README.zh-CN.md：使用说明和安全约束。
- .gitignore：部署现场生成物排除规则。

不要把 API Key、模型缓存、容器日志或服务器凭据写入仓库。

### 3.6 desktop-pet/

Tauri 桌面容器：

- src/：桌面页面、最小化页面和字体。
- src-tauri/：Rust/Tauri 工程、权限、图标、生成 schema 和原生入口。
- package.json：npm run dev、npm run build 和 Tauri CLI。
- README.md：开发运行和后端自动拉起说明。
- STATE_API.md：桌面端状态接口说明。

职责边界：桌面壳负责窗口和后端进程启动，业务状态仍由根项目 Python 后端管理。

### 3.7 dist/

- dist/Star-Office-UI-release-20260302/：历史发行目录和发行说明。
- 这里更像历史交付物存档，不是当前开发入口。
- 新发布优先走 deploy/quickstart/ 或 deploy/office/。

### 3.8 docs/

文档内容可按以下二级区域理解：

- docs/office-production/：生产办公室 API、部署、QA、状态、证据和当前模型资料。
- docs/office-production/evidence/：按功能和日期保存生产或集成证据。
- docs/office-production/qa/：按发布和功能保存 QA 结果。
- docs/screenshots/：通用文档截图。
- 根目录 Markdown：架构、部署、计划、验收、变更记录、维护 SOP 和发布清单。

关键入口：

- docs/PROJECT_STRUCTURE.md：现有运行时边界说明。
- docs/DEPLOYMENT.md：Star Office UI 部署。
- docs/SYSTEM_DEPLOYMENT.md：Sub2API、插件、Collector 和 Office 的系统部署顺序。
- docs/ANIMATION_ARCHITECTURE.md：动画和资源架构。
- docs/office-production/API_CONTRACT_V1.md：生产办公室 API 契约。
- docs/PROJECT_MAINTENANCE_SOP.md：维护操作约定。
- docs/OPEN_SOURCE_RELEASE_CHECKLIST.md：开源发布检查。

文档规则：

- 计划文档说明“准备做什么”。
- 实施文档说明“代码如何实现”。
- 验收文档说明“验证了什么、没有验证什么”。
- 生产部署文档必须记录目标环境、release ID、备份、健康检查和回滚证据。
- 历史报告不要覆盖修改，新增日期化文件更容易追溯。

### 3.9 electron-shell/

Electron 桌面容器：

- main.js：主进程、窗口、托盘和后端拉起。
- preload.js：给旧前端提供兼容桥接。
- standalone-assets/：桌面壳需要的独立前端资源。
- package.json、package-lock.json：Node 依赖和启动入口。
- README.md：开发启动和环境变量。

当前定位是可运行迁移骨架，与 Tauri 并行存在。修改 Electron 时要单独验证主窗口、mini 窗口、托盘和后端进程生命周期。

### 3.10 frontend/

前端一级目录同时保留旧版页面和新版办公室。

#### frontend/company-office/

新版办公室地图、角色、家具和运行时：

- connected-v4/：V4 连接运行时、遥测适配器和资源。
- connected-v5/：V5 连接运行时、座位角色、家具、摇滚房间和屏幕效果。
- reference-v3/：V3 参考运行时和参考素材。
- media/：共享角色、角色品种、方向帧、状态帧和通用媒体。
- 根目录 JSON：角色目录、角色资料、地图布局、资产契约和集成配置。
- 根目录 runtime.mjs、seated-compositor.mjs、pixel-face-animation.mjs：运行时装配和动画组合。

修改地图或角色时，先确认当前入口实际使用的是 V4、V5 还是参考 V3；不能只看到同名素材就直接替换。

#### frontend/office/

新版正式办公室页面：

- index.html：员工入口。
- admin.html：管理员入口。
- app.mjs、bootstrap.mjs：页面启动。
- model.mjs、transport.mjs：数据模型、轮询、会话和写入。
- map-loader.mjs：地图运行时加载。
- employee.mjs：员工页。
- admin.mjs、admin-codec.mjs：管理页和管理数据编解码。
- office.css：页面样式。
- active-models.mjs、today-usage.mjs：管理端模型和使用量展示。
- media/：办公室页面专用媒体。
- release-manifest.json：发布资源闭包清单。
- .local/tests/：本地单元、浏览器测试、fixture、截图和报告。

其中 `frontend/office/.local/tests/` 是该前端自己的测试证据目录，和根目录 `.local/` 的预览、部署审计产物分开管理。

正式办公室前端必须遵守 frontend/office/README.md 中的 API、Boot、隐私、鉴权、发布 manifest 和测试边界。

#### frontend/fonts/

- 本地字体文件和字体许可证。
- 使用或替换字体时保留许可证和来源说明。

#### frontend/vendor/

- 固定版本的本地第三方运行时，目前包含 Phaser。
- 不使用 CDN，不随意升级版本；升级要重新做浏览器和像素 QA。

#### 根目录旧版页面和资源

- index.html、game.js、layout.js：旧版完整看板入口和运行时。
- join.html、invite.html、office-agent-push.py：加入办公室、邀请和 Agent 推送。
- 根目录图片/WebP：旧版地图、家具、角色和状态资源。
- electron-standalone.html：Electron 旧版独立入口。

旧版根页面与 frontend/office/ 是两套边界，修改新版办公室时不要顺手改旧版逻辑。

### 3.11 integrations/

#### integrations/sub2api/

Sub2API 集成是一个相对独立的子系统：

- host-source/：固定的 Sub2API 宿主源码副本。
  - backend/：宿主后端和插件宿主。
  - frontend/：宿主前端。
  - deploy/：宿主部署文件。
  - docs/：上游/集成说明。
  - tools/：工具和构建辅助。
  - skills/：宿主相关技能或工作流。
  - openspec/：规格和变更记录。
  - .github/：宿主副本的 CI、Issue/PR 模板等仓库元数据。
  - assets/：宿主副本使用的静态资源。
- patches/：按插件版本保存的补丁，例如 user-telemetry-v0.1.0 到 v0.2.1。
- plugin-tools/：插件打包、验签和测试工具。
- SOURCE_MANIFEST.json：源码版本、来源和完整性信息。
- README.md：集成边界、构建、安装和回滚说明。

团队规则：

- host-source/ 是固定集成副本，不代表目标服务器已经安装或启用该插件。
- 当前版本、目标宿主版本和补丁版本必须在部署前重新核对。
- 真实 OAuth、token、数据库、签名私钥和生产配置不进仓库。
- 插件改动需同时验证宿主兼容性、插件测试、签名和安装回滚。

### 3.12 scripts/

脚本大致分为五类：

| 类型 | 示例 | 用途 |
| --- | --- | --- |
| 构建/打包 | package_*.py、build_*.mjs | 生成资源、发布包和配置 |
| 素材检查 | audit_*、normalize_* | 审核尺寸、帧、遮挡和归一化 |
| 本地预览 | preview_*、capture_* | 生成页面、截图和预览证据 |
| QA/集成测试 | test_*、qa_* | API、浏览器、像素、发布和生产只读验证 |
| 安全检查 | security_check.py | 检查敏感文件、配置和发布边界 |

脚本执行前先看参数和 README，确认是本地合成测试、只读生产检查还是会写入部署目录的发布脚本。测试结果应记录命令、目标、时间和结论。

### 3.13 wheelhouse/

- 根目录只有占位 README 和 .gitkeep。
- 它用于让 Docker 构建上下文在没有离线依赖时仍然有效。
- 真正的 Linux CPython wheelhouse 由打包脚本从外部目录复制到交付包。
- 不要把开发机临时虚拟环境或不匹配架构的 wheel 放入这里。

## 4. 根目录文件说明

| 文件 | 用途 |
| --- | --- |
| README.md | 中文总入口、快速运行、发布入口和安全边界 |
| README.en.md、README.ja.md | 英文、日文说明 |
| LICENSE | 根项目许可 |
| VERSION | 当前项目版本 |
| pyproject.toml、uv.lock | Python 项目元数据和锁定依赖 |
| backend/requirements.txt | 后端运行依赖 |
| state.sample.json | Agent 状态模板 |
| runtime-config.sample.json | 运行配置模板 |
| join-keys.sample.json | 邀请 key 模板 |
| asset-defaults.json、asset-positions.json | 默认资产和位置配置 |
| healthcheck.sh | 基础健康检查入口 |
| set_state.py | 本地状态切换工具 |
| office-agent-push.py | Agent 加入和状态推送工具 |
| convert_to_webp.py、resize_map.py、*_spritesheet.py | 图片和精灵图处理工具 |
| repack_star_working.py | Star 角色工作动画重新打包 |
| agent-invite-template.txt | Agent 邀请文本模板 |
| SKILL.md | 项目级技能或工作说明 |

## 5. 团队协作建议

### 接手一个功能

1. 先确认功能属于旧版页面、新版办公室、桌面壳、Sub2API 集成还是部署系统。
2. 阅读对应 README、契约或部署文档。
3. 用 git status --short 保存当前工作区状态，避免覆盖其他人的未提交修改。
4. 先改契约或配置，再改实现，再改测试。
5. 在 .local/ 生成验证证据，并在文档中写清楚已验证和未验证范围。
6. 需要发布时使用新的 release ID，保留旧归档和校验值。

### 提交改动时建议写清楚

- 修改了哪个目录和文件。
- 解决了什么问题。
- 是否改变 API、数据结构、资源路径或发布清单。
- 本地执行了哪些测试。
- 哪些内容只在本地验证，哪些内容已经在目标环境读回。
- 是否需要备份、迁移、回滚或其他团队配合。

### 状态标记建议

| 标记 | 含义 |
| --- | --- |
| 已实现 | 代码已经存在，但不等于已部署 |
| 本地已验证 | 在本机或合成 fixture 中通过 |
| 已打包 | 生成了归档和校验值 |
| 已部署 | 目标环境完成切换 |
| 已读回 | 从目标环境读回版本、健康状态或业务结果 |
| 待验收 | 仍缺目标环境或业务验收证据 |
| 未验证 | 目前没有足够证据，不应写成已完成 |

## 6. 当前审计发现

### P1：工作区存在大量未提交修改和未跟踪发布产物

审计时 git status --short 显示后端、前端、部署、文档、素材和测试均有修改；同时存在 deploy/office/out/、deploy/bundles/ 等候选归档或解包目录。

影响：团队成员如果直接合并、清理或重置工作区，可能覆盖其他人的功能改动、QA 证据或回滚材料。

建议：把源码改动、QA 证据和发布归档分别审查；未确认前不要执行 git clean、全量 reset 或批量删除。

### P1：部署输出目录与源码目录混在同一仓库工作区

deploy/office/out/ 和 deploy/bundles/ 中包含日期化发布包、解包目录和校验文件。

影响：新成员容易把候选包当作当前源码，也可能误提交或误使用旧 release ID。

建议：README 明确这些目录属于本地交付工作区；正式交付使用独立归档和新 release ID。

### P2：版本化前端运行时较多，入口选择成本高

当前同时存在旧版根前端、reference-v3、connected-v4、connected-v5、正式 frontend/office/、Electron 和 Tauri 壳。

影响：修改同名资源或运行时文件时容易改错版本，测试结果也可能对应错误入口。

建议：每个任务开头写明“入口、release ID、运行时版本和验证脚本”，并把功能文档链接到明确目录。

### P2：文档数量多，但计划、实施、验收、生产证据需要更明确地分层

docs/ 与 docs/office-production/ 已有较多材料，但不同日期和阶段的文件并列存在。

影响：团队可能把旧计划当成当前状态，或者把本地 QA 当成生产验收。

建议：在每份文档开头增加“状态、目标版本、目标环境、已验证、未验证、替代文档”字段。

### P3：部分子目录 README 的路径仍带有历史本机路径示例

例如桌面壳文档中存在旧工作站路径示例。

影响：新成员复制命令后会得到错误路径，降低首次启动成功率。

建议：统一使用仓库相对路径或 $PWD，避免写入个人工作站绝对路径。

## 7. 推荐的团队文档入口关系

建议把以下文件作为团队导航：

1. 根目录 README.md：项目是什么、如何快速运行、发布入口在哪里。
2. 本文档：目录职责和接手路径。
3. docs/PROJECT_STRUCTURE.md：运行时边界、组件关系和数据目录。
4. docs/DEPLOYMENT.md：Star Office UI 部署。
5. docs/SYSTEM_DEPLOYMENT.md：完整系统部署。
6. frontend/office/README.md：新版办公室前端契约。
7. integrations/sub2api/README.md：Sub2API 集成边界。
8. deploy/office/README.md：正式发布和回滚。
9. docs/office-production/：生产环境的日期化证据和验收记录。

审阅后，如果团队认可本文档的分类，可以再把它链接到根目录 README.md 的“文档入口”，并把旧的 docs/PROJECT_STRUCTURE.md 调整为更纯粹的运行时架构文档。

