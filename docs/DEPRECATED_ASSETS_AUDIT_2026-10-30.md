# 废弃资源、动画与代码审计（2026-10-30）

> 这份审计以当前正式办公室发布闭包为边界，记录候选和兼容保留项。本轮归档不删除、不移动、不重编码源文件，也不修改服务器；只在仓库外建立可校验快照。

## 结论

当前发布闭包包含 **244 个前端文件 / 45,437,899 bytes**；`frontend/` 总计 440 个文件，未进入当前发布闭包的文件为 196 个、69,215,442 bytes。未进入闭包不等于可以直接删除，因为旧根页面、Electron 和 V3 回归测试仍有兼容引用。

最明确的清理候选是旧脸部叠加图集、未导入的像素脸动画模块、两个未导入的 connected CSS shim 和未引用的角色候选展示板。V5 当前使用整帧角色图集与独立屏幕层，旧 typing prototype 已经按项目文档放入 archive。

## 候选分级

| 分级 | 类别 | 文件数 | 大小 | 处理建议 |
|---|---|---:|---:|---|
| P2 | `breed-face-atlases`（strong-cleanup-candidate） | 31 | 3,350,716 bytes | Move to a dated legacy archive after the character-profile and V3 regression suites are confirmed unchanged; do not delete in place. |
| P2 | `unused-face-overlay-module-and-shims`（strong-cleanup-candidate） | 4 | 1,079,743 bytes | Archive with this report, then remove only after a full text-reference and legacy-entrypoint review. |
| P2 | `reference-v3-character-candidates`（conditional-archive-candidate） | 36 | 1,291,602 bytes | Keep until the V3 regression scripts are retired or redirected; archive the complete subtree atomically if that decision is made. |
| P2 | `reference-v3-furniture-composites`（conditional-archive-candidate） | 4 | 86,081 bytes | Keep with the historical V3 manifest until that audit path is retired; archive the manifest and source images together. |
| P3 | `legacy-background-variants`（conditional-archive-candidate） | 2 | 4,549,091 bytes | Archive after verifying no legacy preview or Electron route still selects them. |
| P3 | `v5-typing-prototype-already-archived`（already-archived） | 11 | 5,076,951 bytes | Retain as rollback/design evidence; exclude from runtime and release packages. |
| P2 | `office-release-output-history`（generated-output-retention-candidate） | 14665 | 4,868,760,815 bytes | Retain the active/rollback packages and checksums; archive or remove older candidate IDs only after release rollback evidence is preserved. |
| P2 | `quickstart-bundle-history`（generated-output-retention-candidate） | 4758 | 8,767,858,367 bytes | Keep the latest approved bundle set; move older bundles to external archive storage before reclaiming disk space. |
| P3 | `design-proposal-assets`（non-runtime-design-evidence） | 226 | 99,374,378 bytes | Retain provenance, but keep them outside runtime paths; consolidate old proposal generations only when their source/QA records are preserved. |

## 证据与边界

### 当前发布闭包

发布入口是 `frontend/office/index.html`、`admin.html`、`map-loader.mjs`，地图使用 V5 runtime 和 V4 telemetry adapter。闭包由 `scripts/package_office_release.py` 解析 ESM、CSS、HTML 和 manifest 的相对依赖得到；QA、fixture、`.local` 和未选中的候选图不会因目录邻近而进入生产包。

### 必须保留的兼容项

- `frontend/company-office/runtime.mjs + seated-compositor.mjs + map-layout*.json`：Legacy root/Electron page and V3 regression tests still use this path.
- `frontend/company-office/reference-v3/controls.mjs + controls.css`：Legacy root page imports the controls directly; V4/V3 tests rely on the reference runtime boundary.
- `frontend/company-office/connected-v4/ and connected-v5/ runtime modules`：V5 production loads the V4 adapter and both graphs share the reference runtime identity.
- `frontend/company-office/media/character-breeds/**/{base,frames-*.png}`：Current character-profile manifests and the admin preview load these full-frame assets.
- `frontend/company-office/media/{character-base,face-*.png,workstation-*.png} and office-map*.webp`：Legacy CompanyOfficeRuntime/Electron compatibility still references this older single-seat pipeline.
- `frontend/index.html + frontend/game.js + frontend/layout.js + frontend/electron-standalone.html and root legacy sprites`：The legacy route and Electron shell still own this renderer; the production OFFICE release deliberately excludes it but the source tree keeps the compatibility path.

### 已归档项

- `assets/company-office-connected-v5/archive/typing-prototype/`：旧手部/键盘动画和 QA 截图已隔离，当前 V5 不再创建 `handsCanvas`、`working-hands.mjs` 或键盘坐标绑定。

### 大型本地产物

- `deploy/office/out/`：历史正式办公室候选发布包和解包目录，属于回滚/证据产物，不是源码运行依赖。
- `deploy/bundles/`：Quickstart 本地交付包和嵌入镜像，已被 `.gitignore` 忽略，不是源码运行依赖。
- `.local/`：预览、浏览器截图、部署审计和临时备份，不能当作运行时资源。

## 建议的整理顺序

1. 先将 `breed-face-atlases`、`unused-face-overlay-module-and-shims` 做一次完整文本引用和 V3/Electron 回归确认，再统一移动到日期化 legacy archive。
2. 保留 `reference-v3-character-candidates` 和 `reference-v3-furniture-composites`，直到旧 V3 审计脚本和历史预览决定退役；退役时按目录整体归档，避免只删 PNG 留下失效 manifest。
3. 对 `deploy/office/out/` 和 `deploy/bundles/` 采用“最新批准包 + 当前线上回滚包 + 校验文件”保留策略，其他包先外置归档再回收磁盘。
4. 每次实际移动或删除后重新运行本脚本、`python3 scripts/test_office_release.py`、V4/V5 契约测试和浏览器地图检查。

## 本次变更状态

本轮在不改运行时代码、不移动或删除源文件、不触碰线上部署的前提下，新增了一个仓库外素材快照。快照包含 841 个文件、168,776,258 bytes（约 160.96 MiB），源文件仍留在原路径；当前已修改或未跟踪的 QA 文件也没有被覆盖。

归档根目录：`/Users/hepingyu/Documents/ChatGPT/Star-Office-UI-archive-20261030/assets-deprecated-20261030/`。

归档清单：`/Users/hepingyu/Documents/ChatGPT/Star-Office-UI-archive-20261030/assets-deprecated-20261030/archive-manifest.json`。

完整范围、恢复步骤和验证记录见 `docs/ASSETS_ARCHIVE_2026-10-30.md`。机器可读审计清单仍为 `docs/DEPRECATED_ASSETS_AUDIT_2026-10-30.json`。
