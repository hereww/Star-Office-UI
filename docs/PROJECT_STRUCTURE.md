# 项目结构与新旧边界

本文档说明当前 `Star-Office-UI` 的目录来源、运行入口和开发边界。当前项目参考上游项目主分支，保留原项目的旧版像素办公室入口，同时新增新版 Office、独立通用 API、Sub2API 集成和发布运维工具。项目发布号只在根目录元数据中维护；本文档不把发布号写进目录规则。

## 标记规则

| 标记 | 含义 | 开发要求 |
| --- | --- | --- |
| [原项目旧版] | 原参考项目已有的入口或资源 | 保持兼容性；不要把它当作新版 Office 的入口 |
| [新版重构] | 当前项目新增的 Office、API、运行时或测试 | 新功能优先放这里，并同步契约、测试和发布清单 |
| [共享/演进] | 原路径继续使用，但实现已经扩展 | 修改前检查旧版和新版是否共用同一文件 |
| [集成新增] | 当前项目为外部系统加入的代码和工具 | 与主项目保持边界，不提交外部凭据、数据库或缓存 |
| [发布运维新增] | 当前项目新增的安装、打包、预检、备份和回滚工具 | 使用新的 release ID，保留校验和回滚材料 |
| [本地证据/历史] | 截图、QA、候选包、旧发行物和本地归档 | 只能作为证据或参考，不作为运行时源码 |

## 与参考项目的结构对照

原项目的顶层结构只有 assets/、backend/、desktop-pet/、dist/、docs/、electron-shell/、frontend/ 和 scripts/。当前项目保留这些目录，并新增 .agents/、api_service/、api-service/、deploy/ 和 integrations/sub2api/。

| 路径 | 原参考项目 | 当前项目 | 当前定位 |
| --- | --- | --- | --- |
| frontend/index.html、frontend/game.js、frontend/layout.js | 旧版像素办公室主入口和页面运行时 | 继续保留 | [原项目旧版] 兼容入口 |
| backend/app.py | Flask 主服务、旧版页面和状态 API | 继续保留并增加 Office 装配 | [共享/演进] |
| desktop-pet/、electron-shell/ | 桌面封装 | 继续复用 Python 后端 | [原项目旧版/共享] |
| assets/room-reference.png/.webp | 原始办公室参考素材 | 继续用于旧版/Quickstart 兼容路径 | [共享/演进] |
| frontend/office/ | 原项目没有 | 员工端、管理员端、数据模型和资源清单 | [新版重构] |
| frontend/company-office/ | 原项目没有 | reference-v3、connected-v4、connected-v5 运行时和素材 | [新版重构] |
| backend/office_*.py | 原项目没有 | Office 契约、API、collector、存储、安全和角色配置 | [新版重构] |
| api_service/、api-service/ | 原项目没有 | 不依赖 Sub2API 的项目遥测 API、部署入口和旧状态接口 | [新版重构] |
| integrations/sub2api/ | 原项目没有 | 宿主源码副本、补丁、插件工具和集成文档 | [集成新增] |
| deploy/ | 原项目没有 | Quickstart、正式发布、离线构建、备份和回滚 | [发布运维新增] |
| scripts/ | 少量素材、安全和 smoke test 脚本 | 增加 Office、浏览器、像素、API 和发布测试 | [共享/演进] |
| docs/ | 项目介绍、部署、维护和历史报告 | 增加新版架构、API、Office 开发、发布和验收文档 | [共享/演进] |
| .agents/ | 原项目没有 | 角色动画和仓库协作技能 | [新版重构] |
| .local/、deploy/office/out/、dist/ | 不作为当前开发入口 | 本地证据、候选包和历史发行物 | [本地证据/历史] |

原项目中的 docs/screenshots/readme-cover-*.jpg 和历史发行说明属于参考项目的历史资料。当前新版的截图、QA 和发布证据应放在对应的 assets/、frontend/office/、.local/ 或 docs/office-production/ 目录中，不要把历史截图当作新版验收证据。

当前新版开发入口是 `docs/development/README.md` 和 `docs/development/code-map.md`；`frontend/company-office/README.md` 负责解释地图运行时目录。带日期或历史运行时标识的文档只作证据，不作为新的代码组织规则。

## 素材与清理边界

`assets/` 是素材源、重建输入和 QA 证据区，不是正式静态资源根目录。正式 Office 发布由 `frontend/` 的依赖闭包组成，不能把整个 `assets/` 目录复制到发布包。素材是否保留要看运行时导入、manifest、重建脚本和旧版兼容入口，不能只按目录名称或文件日期判断。

| 路径或类别 | 当前状态 | 修改规则 |
| --- | --- | --- |
| `assets/room-reference.png`、`assets/room-reference.webp` | 旧版后台和 Quickstart fallback 仍使用 | 必须保留；变更前检查 `backend/app.py` 和 `deploy/quickstart/Dockerfile` |
| `assets/company-office-floorplan-v2/` | 当前地图的源图、布局、manifest 和生成依据 | 保留可重建输入；运行时副本进入 `frontend/company-office/` |
| `assets/rock-room-band-v1/source/`、`normalization.json` | 当前 V5 摇滚房间的重建输入 | 保留；预览图与运行时副本分开管理 |
| `assets/company-office-connected-v4/`、`assets/company-office-reference-v3/` 的源图和 manifest | V4/V3 兼容边界、家具和服务器资源来源 | 先跑 adapter、V3 回归和发布闭包检查，再决定归档 |
| `assets/**/qa/`、`integration-qa/`、组合预览和候选方案 | QA 截图、报告、旧预览和未接入候选 | 仅作为证据；不得直接作为运行时依赖 |
| `archive/legacy-face-atlases/` | 已清理脸部图集的本地回滚副本 | 被 `.gitignore` 排除；不提交、不发布、不从源码导入 |
| `deploy/office/out/`、`deploy/bundles/`、`.local/` | 候选发布物、交付输出和本地证据 | 只保留必要清单和校验材料；不要把生成物当源码修改 |

本次清理已经移除未被当前发布闭包导入的脸部图集、像素脸动画模块、无用 CSS shim 和未接入候选板；当前 V4/V5/reference-v3 运行时、旧根页面、Electron 兼容路径和可重建核心素材继续保留。完整清理清单见 [DEPRECATED_ASSETS_CLEANUP_2026-10-30.md](./DEPRECATED_ASSETS_CLEANUP_2026-10-30.md)，引用审计见 [DEPRECATED_ASSETS_AUDIT_2026-10-30.md](./DEPRECATED_ASSETS_AUDIT_2026-10-30.md)，快照恢复规则见 [ASSETS_ARCHIVE_2026-10-30.md](./ASSETS_ARCHIVE_2026-10-30.md)。

## 当前目录树

~~~text
Star-Office-UI/
├── .agents/                     [新版重构] 仓库技能和角色动画工作流
├── api_service/                 [新版重构] 独立通用 API、项目鉴权、OpenAPI 和存储
├── api-service/                 [新版重构] API 依赖、凭据生成、容器和环境模板
├── assets/                      [共享/演进] 原始素材、新版地图、角色、家具和 QA
├── backend/                     [共享/演进] Flask 主服务、旧 API 和新版 Office 后端
│   ├── app.py                   [共享/演进] 原版主入口，按配置装配 Office 模式
│   └── office_*.py              [新版重构] Office API、契约、collector、存储和安全
├── deploy/                      [发布运维新增]
│   ├── quickstart/              可复制安装、校验、升级和卸载
│   ├── office/                  正式发布、Compose、预检、备份和回滚
│   └── bundles/                 交付归档和校验文件
├── desktop-pet/                 [原项目旧版/共享] Tauri 桌面壳
├── dist/                        [本地证据/历史] 历史发行物
├── docs/                        [共享/演进] 架构、契约、开发、部署和验收文档
├── electron-shell/              [原项目旧版/共享] Electron 桌面壳
├── frontend/
│   ├── index.html               [原项目旧版] 旧版看板入口
│   ├── game.js、layout.js       [原项目旧版] 旧版页面运行时
│   ├── office/                  [新版重构] 员工端、管理员端、数据投影和专项测试
│   ├── company-office/          [新版重构] V3/V4/V5 地图、角色、家具和运行时
│   ├── fonts/                   [新版补充] 本地字体和许可证
│   └── vendor/                  [共享/演进] 固定版本本地第三方运行时
├── integrations/sub2api/        [集成新增]
│   ├── host-source/             宿主源码副本
│   ├── patches/                 按宿主版本保存的补丁
│   └── plugin-tools/            插件打包、验签和测试工具
├── scripts/                     [共享/演进] 构建、预览、QA、安全检查和测试
├── .local/                      [本地证据/历史] 本地预览、截图、审计和回滚材料
├── VERSION                      [新版补充] 发布元数据单一来源
└── pyproject.toml               [共享/演进] Python 项目元数据
~~~

工作区可能还会出现 archive/、wheelhouse/、deploy/office/out/ 等本地目录。它们分别用于历史归档、离线构建输入或候选发布物，不能直接作为当前运行时依赖，也不应在没有审核的情况下提交或复制到生产环境。

## 运行时边界

~~~text
浏览器
  └─ backend/app.py :19000
       ├─ 默认模式：根目录旧版页面和旧状态接口
       └─ OFFICE_ENABLED=1：frontend/office 员工端、管理员端和 /api/office/*

团队工具 / Agent
  └─ api_service :19100
       └─ /api/v1/projects/{project_id}/telemetry → SQLite 最新主体观测
            └─ office_team_collector（standalone）→ 现有 Office 快照和工位

Sub2API（可选）
  └─ backend/office_collector.py
       └─ Office 快照 / frontend/office 展示
~~~

/api/office/* 和 /api/v1/* 是两套接口边界。独立通用 API 默认不依赖 Sub2API，也不保存 API key、Bearer token、密码、Cookie、邮箱或上游原始响应。

## 入口和修改顺序

- 旧版快速查看：python3 backend/app.py，默认监听 19000，使用根目录 frontend/。
- 新版 Office：设置 OFFICE_ENABLED=1、OFFICE_RELEASE_ID、独立数据目录和开发密钥后启动同一入口。
- 独立通用 API：python3 -m api_service.app，默认监听 19100。
- 桌面壳：desktop-pet/ 和 electron-shell/ 只是容器，状态仍由 Python 后端管理。
- 遥测采集：backend/office_collector.py 为统一入口；OFFICE_TELEMETRY_PROVIDER=standalone 调用通用 API，其余使用可选 Sub2API 链路。公司接入按 API_DEVELOPMENT.md 与 TEAM_API_OPERATIONS.md 配置。

涉及新版 Office 时，按以下顺序修改：

1. 后端契约和存储：backend/office_contract.py、backend/office_api.py、backend/office_collector.py。
2. 前端数据投影和运行时：frontend/office/、frontend/company-office/。
3. 资源清单和发布配置：frontend/office/release-manifest.json、scripts/package_office_release.py、deploy/office/；如果涉及素材，先确认源图、manifest 和运行时副本的关系。
4. 对应测试：scripts/test_office_*.py、scripts/test_office_*.mjs 和 frontend/office/ 下的专项测试；素材清理还要跑发布闭包和 V3/V4/V5 相关回归。
5. 使用新 release ID 打包，保留校验值，完成目标环境读回后再切流量；不要用本地 QA 截图替代部署验收。

## 运行时数据和安全边界

开发状态可通过 STAR_OFFICE_DATA_DIR 指向独立目录。state.json、agents-state.json、join-keys.json、runtime-config.json、SQLite、快照、日志、.env、API key、消费凭据、管理员密码哈希、CA 私钥和真实用户数据不能提交到 Git。

.local/、deploy/office/out/ 和 dist/ 的内容只表示本地证据、候选发布或历史参考。它们不证明当前代码已经部署，也不替代生产浏览器、网络、数据新鲜度和回滚验收。
