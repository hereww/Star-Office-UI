# 素材归档记录（2026-10-30）

本次对 `assets/` 做的是**可回滚快照归档**。源文件没有删除、移动或覆盖，生产代码、部署配置和线上服务也没有修改。

## 归档位置与清单

归档根目录：

```text
/Users/hepingyu/Documents/ChatGPT/Star-Office-UI-archive-20261030/assets-deprecated-20261030/
```

逐文件清单：

```text
/Users/hepingyu/Documents/ChatGPT/Star-Office-UI-archive-20261030/assets-deprecated-20261030/archive-manifest.json
```

快照共 **841 个文件、168,776,258 bytes（约 160.96 MiB）**。清单记录每个源文件的相对路径、归档路径、字节数、SHA-256 和归档时的 Git 工作区状态；`source_files_changed_by_archive` 为 `0`。

## 本次归档范围

- V4/V5 `qa/` 证据、屏幕截图和报告；包括当前已修改或未跟踪的 QA 文件。
- V5 `archive/typing-prototype/` 旧手部/键盘动画证据。
- `company-office-combined-preview-v1/`、`company-office-map-v1/` 等旧预览。
- V3 历史角色候选、背景候选和集成审计资料。
- `character-animation-proposals/` 中已经拒绝或暂不接入运行时的候选方案。
- `rock-room-band-v1/preview/` 预览图；`source/` 和归一化输入没有归档到这个快照之外，继续作为可重建源。

## 仍需留在工作区的素材

- `assets/room-reference.webp` 和 `assets/room-reference.png`：Quickstart 旧版资产抽屉仍有后端 fallback 读取。
- `assets/company-office-floorplan-v2/` 的源图、manifest、脚本输入和生成依据：地图可重建链路使用。
- `assets/rock-room-band-v1/source/` 及 `normalization.json`：摇滚房间素材的归一化链路使用。
- `assets/company-office-reference-v3/` 中当前 V3/V4/V5 仍引用的家具、服务器和结构素材。
- 所有当前修改中的 QA 工作副本：快照只是备份，原路径继续用于开发和验收。

## 运行与恢复规则

正式 Office 发布从 `frontend/` 依赖闭包取运行时文件，不把 `assets/` 整体打包；`scripts/package_office_release.py` 和 `scripts/test_office_v5_character_template.mjs` 都把这一边界作为契约。需要重建时从 `assets/` 的源目录和对应脚本生成到 `frontend/`，不要让运行时直接读取外部归档。

恢复前先读取 `archive-manifest.json`，对目标归档文件计算 SHA-256 并与清单比对，再复制回原相对路径。恢复只应针对明确的单个文件或目录，并保留当前工作副本的备份。

## 本次验证

- `python3 scripts/test_office_release.py`：60/60 通过。
- `node scripts/test_office_v5_character_template.mjs`：6/6 通过。
- `node scripts/test_office_connected_v5_screen_only_stations.mjs`：9/9 通过。
- `node scripts/test_office_connected_v5_rock_room.mjs`：通过。
- `node scripts/test_company_office.mjs`：通过。
- 归档清单逐文件复制和 SHA-256 校验通过；源文件仍全部存在。

`node --test scripts/test_office_v3_player.mjs` 仍受既有 `up.working.frames` 全帧配置缺失影响而失败。本次没有借归档动作修改 V3 播放器或候选素材，因此 V3 候选继续保留在源路径和快照中。
