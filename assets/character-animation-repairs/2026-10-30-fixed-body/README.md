# 固定身体表情图集修复（2026-10-30）

修复范围是 7 个非橘猫品种、正面和左右侧面、4 个状态，共 84 张图集。输出继续是 `frontend/company-office/media/character-breeds/<profile>/<direction>/frames-<action>.png`，每张 768×576，4×3 排列，单帧 192×192。橘猫、背面、角色母版和前端渲染接口不在本次构建范围内。

原导出器把 RGBA 图片又作为自身蒙版执行两次 `paste`，导致颜色和 alpha 被反复相乘；例如原 alpha 224 最后变成 152，128 变成 16。`scripts/normalize_full_frame_assets.py` 已改为直接复制 RGBA，专门的 Python 回归测试覆盖半透明颜色和两次拼装。单纯更正导出器无法恢复已经损坏的像素，也无法解决逐帧身体变化及工作状态重复静帧，因此本目录保存独立恢复来源。

## 历史来源

`sources.json` 列出提交 `18d63442fbb8c67fff9123c7c4ff0ee2171e0531` 的 37 个原始文件、原路径、归档路径及 SHA-256；`source/` 中这些原始文件逐字节保存，不依赖 Git 对象或临时目录。构建开始会校验全部哈希，并确认当前角色母版与历史母版一致。

- 布偶和英短的 3 个方向、美短正面和左侧的 idle 使用历史生成的 `face-idle.png`，共 8 套。
- 其余 76 套使用该提交的角色专用表情参数及当时的表情绘制实现，离线烘焙为完整帧。
- `legacy-pixel-face-animation.mjs` 是未经修改的历史实现。`offline-pixel-face-animation.mjs` 是仅供构建的派生版本，修补了下面列明的问题。

没有把缺失的原始生成图伪称为已找回，也没有把静态母版重复成 12 帧来充当可见方向的动画。一个循环可合理复用相同姿态；每套都有真实可见的表情差异，完整帧测试按合成后的可见变化检查。

## 离线修补与不变量

1. 原生 Canvas 可能延迟引用可变 canvas；通过 `getImageData` / `putImageData` 快照保存每一帧，防止所有状态被最后一帧覆盖。
2. 历史睡眠眼眶的邻近像素修补会把黑色眼球/眼眶复制回来。改用同一品种历史 working 闭眼已有的眼睑色填充，仍画原睡眠眼弧，消除残影。
3. 历史侧面睡眠分支完全忽略帧号，正面睡眠也仅有 2 像素嘴宽变化。侧面既有嘴/舌头及眼弧按呼吸周期变化 1 像素；正面既有舌头随嘴部呼吸移动 1 像素。鼻子、品种花纹和身体不动。
4. 所有帧的 alpha 逐像素复制原母版，不提升透明度。表情只可改变历史脸部矩形与椭圆交集内的 RGB，且必须距 alpha 低于 220 的轮廓至少 2 像素。矩形外的 RGBA、耳朵、身体、尾巴及半透明轮廓逐像素固定。

`build-report.json` 记录构建来源、派生实现哈希、每张输出的哈希、历史脸部矩形/椭圆、不同帧数量和相对母版的脸部变化像素数量。运行时没有导入本目录的代码、参数或脸层，只加载最终完整帧 PNG。

## 重建与验收

在仓库根目录运行：

```sh
node scripts/rebuild_fixed_body_character_atlases.mjs
node scripts/test_office_full_frame_assets.mjs
python3 scripts/test_normalize_full_frame_assets.py
```

构建需要 `@napi-rs/canvas` 和 `pngjs`；本次使用 0.1.100 和 7.0.0。脚本优先加载项目依赖，可通过 `OFFICE_QA_NODE_PACKAGE` 指向已安装这些依赖的 `package.json`，也支持本机 Codex 依赖目录。Python 回归测试需要 Pillow。

完整帧质量门槛检查全部 84 套 / 1008 帧的尺寸、alpha、脸外固定像素和可见表情变化，并用故障样本确认可以拒绝透明幽灵、身体漂移、静帧及不可见噪点。首次修复的素材备份由主任务保留于 `/tmp/star-office-animation-repair-20261030-151532`；它仅用于本机回滚，重建不依赖该目录。
