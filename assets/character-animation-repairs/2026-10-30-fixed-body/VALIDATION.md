# 2026-10-30 动画修复验收

本记录覆盖本地源码、最终 PNG 和 Chromium 中实际 V5 播放器；没有远程部署或后端数据修改。

| 优先级 | 问题 | 修复结果 |
| --- | --- | --- |
| P1 | 英短朝右的休息/异常状态接近透明，同步状态发灰 | 修复导出器重复 alpha 混合；从历史母版恢复完整帧。休息状态母版内部像素的 alpha 中位数由 32 恢复至 253。 |
| P1 | 正式遥测路径遗漏摇滚房间的逐帧更新 | 每次 runtime update 推进一次房间动画，统一处理减少动态效果的 on/off/system 设置。未知工位屏幕仍保持静态。 |
| P2 | 其他品种工作动画为重复静帧，休息/同步/异常有身体漂移 | 重建 7 品种 × 3 可见方向 × 4 动作，共 84 套、1008 帧。所有帧 alpha 与母版一致，脸部之外 RGBA 固定，工作动画全部恢复可见变化。 |
| P2 | 睡眠表情黑色眼眶残影、细微变化不可见 | 修复旧离线算法的眼眶填充，既有嘴/舌头及侧面眼弧随呼吸周期变化。 |
| P2 | 摇滚图集裁切读到上一行像素 | 先隔离当前单元再裁切；移除 48 帧中的 20 帧顶部污染，所有帧第 12 行以下身体像素不变。 |

## 验证结果

- 53 项 Node 回归通过：完整帧质量门槛、角色替换、V5 正式桥接、屏幕动画与独立播放器。
- 4 项 Python 导出/裁切回归通过；摇滚素材尺寸、透明度、几何与污染检查通过。
- Chromium 使用真实 `frontend/office/map-loader.mjs` 与 telemetry adapter，在本地演示模式检查 8 品种 × 6 业务状态 × 16 工位，即 768 组合、9216 次完整图集帧采样，并验证实际时间推进、摇滚播放和减少动态效果设置。无页面异常或 HTTP 失败。
- 独立代理核对 37 个历史来源文件 SHA-256；仅使用归档来源、21 张母版和构建脚本，在无 Git 的隔离目录重建 84 张 PNG，全部字节及构建报告与最终版本一致。
- 备份范围中未列为修复目标的 87 个文件逐字节不变，包括橘猫、背面、角色母版等资源。
- `git diff --check` 通过。

本次没有宣称全仓库历史测试通过：旧 `test_office_telemetry_adapter.mjs` 的图片模拟仍只返回 192×192，与当前 768×576 图集合同不符；代理用修复前 adapter 隔离复现了相同失败。

## 复验命令

```sh
node --test scripts/test_office_full_frame_assets.mjs scripts/test_office_v5_production_bridge.mjs scripts/test_office_character_profile_runtime.mjs scripts/test_office_character_profile_assets.mjs scripts/test_office_connected_v5_screen_only_player.mjs scripts/test_office_connected_v5_screen.mjs
python3 -m unittest discover -s scripts -p 'test_normalize_full_frame_assets.py'
python3 -m unittest discover -s scripts -p 'test_normalize_rock_room_band_sprites.py'
node scripts/test_office_connected_v5_rock_room.mjs
node scripts/qa_office_animation_repair.mjs
```

Python 需要 Pillow；Chromium 验收需要 Playwright 与 Chrome。浏览器 JSON、整图截图和修复前后截图输出到 `.local/qa/animation-repair/`；可通过 `OFFICE_ANIMATION_QA_DIR` 改变输出目录。依赖路径可通过 `OFFICE_QA_NODE_PACKAGE` 指向包含 Playwright 的 `package.json`。历史来源及重建方法见同目录 `README.md`。
