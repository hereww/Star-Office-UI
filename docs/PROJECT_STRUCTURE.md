# 项目结构与运行说明

本文档描述 `Star-Office-UI` 1.0.0 的代码边界、运行入口、数据文件和发布目录。项目同时保留旧版完整看板与新版隔离办公室入口；两者的资源、接口和部署方式不能混用。

## 组件关系

```text
浏览器 / Electron / Tauri
          │
          ▼
      backend/app.py  ─────── legacy UI 与旧 API
          │
          ├── OFFICE_ENABLED=1
          │       ├── frontend/office/              新版员工/管理入口
          │       ├── backend/office_api.py         新版管理 API 与兼容边界
          │       ├── backend/office_collector.py   上游 Sub2API 采集器
          │       └── frontend/company-office/       V4/V5 办公室运行时与素材
          │
          └── STAR_OFFICE_DATA_DIR                  运行时状态与配置目录
```

## 目录说明

| 路径 | 用途 | 是否进入正式发布包 |
| --- | --- | --- |
| `backend/` | Flask 主进程、办公室 API、采集器、SQLite/JSON 存储和安全边界 | 是，按发布清单选择 |
| `frontend/office/` | 版本化员工页、管理页、模块、样式和数据投影 | 是 |
| `frontend/company-office/` | V4/V5 地图、角色、家具、遥测适配器和运行时素材 | 是，按依赖闭包选择 |
| `frontend/vendor/` | 本地固定第三方运行时（包括 Phaser） | 仅实际依赖进入 |
| `frontend/index.html` 等根页面 | 完整看板入口，默认开发模式使用 | 按运行模式选择 |
| `desktop-pet/` | Tauri 桌面壳 | 独立开发/构建 |
| `electron-shell/` | Electron 桌面壳，版本 `1.0.0` | 独立开发/构建 |
| `scripts/` | 测试、素材检查、发布打包和离线验证工具 | 工具源码随仓库保存 |
| `deploy/office/` | Docker Compose、离线构建、预检、备份、回滚和发布校验 | 发布包带入必要文件 |
| `integrations/sub2api/` | Sub2API 宿主固定源码、用户遥测插件、`.s2plugin` 打包工具和版本补丁 | 源码进入仓库；依赖缓存、签名包和私钥排除 |
| `assets/` | 设计稿、候选素材、QA 资料和历史参考 | 不按目录整体发布 |
| `docs/` | 架构、契约、验收、部署和历史记录 | 文档目录不作为运行时依赖 |
| `state.sample.json`、`join-keys.sample.json` | 开发状态和邀请 key 模板 | 模板可发布，实际值不能发布 |
| `runtime-config.sample.json`、`.env.example` | 运行配置和生产环境变量模板 | 只含占位符 |
| `.local/`、`frontend/office/.local/` | 本地测试、截图、预览、回滚和审计中间文件 | 禁止发布 |
| `deploy/office/out/` | 本地生成的候选归档和解包目录 | 每个候选包单独审核后再交付 |

## 运行时数据

开发模式默认把状态文件写在项目根目录，可通过 `STAR_OFFICE_DATA_DIR` 改到独立目录。常见文件包括：

- `state.json`：主 Agent 当前状态。
- `agents-state.json`：访客 Agent 状态。
- `join-keys.json`：运行时邀请 key，由模板生成后再按需修改。
- `runtime-config.json`、`asset-positions.json`、`asset-defaults.json`：资产和运行配置。
- 生产办公室还会使用 `office-config.sqlite3` 和原子写入的 `office-snapshot.json`，它们属于数据卷，不能提交到 Git 或放入静态发布包。

所有真实密钥、消费凭据、管理员密码哈希、CA 私钥和生产数据库都应位于发布目录之外的受限路径。

## 入口和边界

- 开发入口：`python3 backend/app.py`，默认监听 `0.0.0.0:19000`，可用 `STAR_BACKEND_PORT` 覆盖。
- 新版办公室只有显式设置 `OFFICE_ENABLED=1` 才启用；生产环境应使用反向代理和隔离端口，不直接暴露 Flask 开发服务器。
- `OFFICE_RELEASE_ID` 决定 `/static/releases/<release-id>/` 的版本化资源前缀，发布后不可复用旧 release ID。
- `set_state.py` 只写本地状态文件；`office-agent-push.py` 用于访客 Agent 的 HTTP 加入和状态推送。
- Electron/Tauri 只是桌面容器，仍复用同一个 Python 后端，不拥有独立的状态数据库。
- Sub2API 集成源码、插件宿主改动和打包工具位于 `integrations/sub2api/`；Star Office UI 不复制 Sub2API 的运行时数据库、管理员凭据或模型 Key。

## 修改顺序

涉及新版办公室时，通常按以下顺序修改并验证：

1. 后端契约和存储：`backend/office_contract.py`、`backend/office_api.py`、`backend/office_collector.py`。
2. 前端数据投影和运行时：`frontend/office/`、`frontend/company-office/`。
3. 发布闭包和部署配置：`scripts/package_office_release.py`、`deploy/office/`。
4. 对应测试：`scripts/test_office_*.py`、`scripts/test_office_*.mjs`。
5. 用新 release ID 打包，保留旧归档和校验值，完成目标环境验收后再切流量。

