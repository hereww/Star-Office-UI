# 新版开发入口

新版办公室由页面层、数据层、场景运行时和发布工具四个边界组成。先看[代码地图](./code-map.md)，再按要修改的边界进入代码；不要从截图、QA 目录或历史部署记录反推当前实现。素材相关改动先读[项目结构与边界](../PROJECT_STRUCTURE.md)中的“素材与清理边界”。

## 修改顺序

1. 数据契约或权限：`backend/office_contract.py`、`backend/office_api.py`、`backend/office_security.py`。
2. 页面和数据投影：`frontend/office/`。
3. 地图、角色、家具和屏幕：`frontend/company-office/`，先确认是当前生产场景还是兼容测试边界。
4. 发布闭包：`scripts/package_office_release.py`、`deploy/office/`。
5. 对应测试：先跑静态契约，再跑发布闭包和浏览器验收。

## 当前入口

- 员工页：`backend/app.py` 的 `_office_frontend_page('employee')` → `frontend/office/index.html`。
- 管理页：`backend/app.py` 的 `_office_frontend_page('admin')` → `frontend/office/admin.html`。
- 页面启动：`bootstrap.mjs` → `app.mjs` → `employee.mjs` 或 `admin.mjs`。
- 地图装配：`map-loader.mjs` 通过集中路径表装配当前场景、适配器、参考渲染和 Phaser。

## 不要直接修改的边界

- `deploy/office/out/`、`deploy/bundles/`：生成物和交付归档，不是源码。
- `.local/`、`assets/**/qa/`：本地证据和工作副本，不进入正式依赖闭包。
- `assets/`：源素材、manifest、候选和 QA 的分层目录；运行时只能从发布闭包中的 `frontend/` 副本读取。
- `archive/legacy-face-atlases/`：已清理素材的本地回滚副本，不提交、不发布、不作为新资源来源。
- `frontend/company-office/reference-v3/`：兼容基础和冻结回归边界；修改前必须有对应像素/契约证据。
- `frontend/company-office/connected-v4/`：共享家具、座位和遥测桥的兼容边界；当前场景使用其部分桥接实现，不能按目录删除。

## 协作要求

- 新逻辑放在拥有该职责的边界，不在页面文件里复制运行时算法。
- 新资源先写 manifest 或契约，再接入 loader；不要依赖目录邻近自动发布。
- 清理资源前先做文本引用、manifest、V3/V4/V5 回归和发布闭包检查；先建立可校验归档，再删除或移动。
- 改动后保留源文件、测试结果和发布闭包读回；不要用旧截图替代当前运行证据。
