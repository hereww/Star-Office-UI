# 测试入口与生成物边界

测试源码保留在 `scripts/`，共享合成数据在 `scripts/fixtures/`。测试不连接生产数据；需要本地预览服务的浏览器脚本单独执行。不要用 `node --test scripts/*.mjs` 扫描整个目录：其中包含构建、修图、部署 QA 和需要指定目标的浏览器脚本。

## Python

从仓库根目录运行，使用独立环境：

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements.txt -r api-service/requirements-dev.txt
.venv/bin/python -m unittest discover -s scripts -p 'test_*.py'
```

覆盖 API、collector、SQLite、授权/CSRF、发布、Quickstart、素材归一化和独立遥测。HTTP/Gunicorn 集成测试仅使用本机随机端口，需要 `node` 可用；开发依赖包含 OpenAPI 校验使用的 `jsonschema` 和 `PyYAML`。

## 当前 Node 契约回归

以下命令使用 Node 内置测试运行器，无需浏览器或额外 npm 依赖。遥测适配器的可选浏览器检查默认跳过。

```sh
node --test \
  scripts/test_office_active_models.mjs \
  scripts/test_office_bubble_layout.mjs \
  scripts/test_office_bubble_status.mjs \
  scripts/test_office_character_profile_assets.mjs \
  scripts/test_office_character_profile_runtime.mjs \
  scripts/test_office_connected_v4_contract.mjs \
  scripts/test_office_connected_v5_screen_only_player.mjs \
  scripts/test_office_connected_v5_screen_only_stations.mjs \
  scripts/test_office_full_frame_assets.mjs \
  scripts/test_office_screen_overlay.mjs \
  scripts/test_office_telemetry_adapter.mjs \
  scripts/test_office_v3_render_quality.mjs \
  scripts/test_office_v3_runtime.mjs \
  scripts/test_office_v5_character_template.mjs \
  scripts/test_office_v5_production_bridge.mjs \
  scripts/test_server_cabinet_animation.mjs
node scripts/test_company_office.mjs
node scripts/test_office_connected_v5_rock_room.mjs
node scripts/test_office_map_interaction.mjs
```

`test_office_screen_overlay.mjs` 从 `frontend/company-office/connected-v5/screen-overlay.test.mjs` 移出，保留原来的五项断言。测试源码不能作为公开运行时资源发布。

## Canvas 与浏览器

```sh
node --test scripts/test_office_connected_v5_layout.mjs scripts/test_office_connected_v5_screen.mjs
```

这组测试使用 `@napi-rs/canvas`；屏幕测试还使用 Playwright 和已安装的 Chrome。可通过 `OFFICE_QA_NODE_PACKAGE` 指向现有 npm 项目的 `package.json`，本仓库没有自动安装浏览器的步骤。

`qa_office_active_models.mjs` 使用已跟踪的 `scripts/fixtures/office_wire.mjs`，优先加载项目中的 Playwright，也接受上述依赖路径。它需要单独启动的 Office 预览服务；运行前核对脚本的 `OFFICE_MODEL_QA_*` 配置。其他 `qa_*` 和浏览器/像素脚本也需要各自的服务、证书或显式环境配置，不属于默认契约命令。

## 历史测试与已知失败

`frontend/office/.local/tests/` 是未提交的早期本地验收副本，干净克隆不包含它；不要从已跟踪脚本导入，也不要把旧报告当作当前通过结果。

`node --test scripts/test_office_v3_player.mjs` 仍可手工运行。2026-11-03 审查发现 23 项失败：其 fixture 仍提供脸部贴片、缺少背向整帧路径，并比较早期脸部几何，而当前播放器要求整帧合同。该测试保留以便后续迁移；没有删除失败断言、标记 TODO 或放宽生产播放器校验。当前整帧资源、V3 runtime、V4/V5 角色与屏幕使用上面的专项测试。

## 输出与发布

- 新截图、日志和报告优先写入根目录 `.local/`。现有 V4/V5 QA 图片目录已加入忽略规则。
- JSON 报告、保护基线和重建输入继续保留；不能把 `qa/` 目录中的所有文件直接删除。
- 正式 Office 包从前端依赖闭包取文件；Quickstart 同时排除测试文件名、tests/fixtures/QA/截图目录。
- 打包后运行对应 verifier，并核对 manifest 与 `SHA256SUMS`。本地测试不代表生产部署验收。
