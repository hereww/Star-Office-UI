# 固定身体与局部表情修复（2026-10-30）

修复覆盖 7 个非橘猫品种、4 个方向、4 个状态，共 112 张图集。84 张正面/侧面图集有真实局部表情变化；28 张背面图集在各帧、各状态中均逐像素复制角色母版。输出继续是 `frontend/company-office/media/character-breeds/<profile>/<direction>/frames-<action>.png`，每张 768×576、4×3 排列、单帧 192×192。橘猫、角色母版和前端渲染接口不在本次构建修改范围内。

## 已发现的根因

原导出器把 RGBA 图片作为自身蒙版重复 `paste`，导致颜色和 alpha 相乘；工作图集重复静帧，而其他生成完整帧有身体漂移。首次离线恢复固定了身体，但逐帧视觉复审又发现：旧表情参数眼心偏移 3–6 像素、清眼范围不足；整张旧睡脸覆盖造成双鼻、原虹膜残影及每 4 帧一次的脸纹跳变；深毛眼睑对比不足；背面图集仍留有 alpha/RGB 导出损伤。

本次恢复直接使用母版的真实眼睛像素表现睁眼与眨眼，旋涡只作用于原眼内部；睡眠仅替换实测眼/嘴区域，保留原鼻子。没有把整张历史睡脸重新贴入完整帧。

## 可独立重建的来源

`sources.json` 保存 51 个输入文件的归档路径及 SHA-256：

- 44 个文件逐字节取自提交 `18d63442fbb8c67fff9123c7c4ff0ee2171e0531`，包括 28 张四向母版、7 个历史 manifest、8 套真实生成的局部 idle 图集和未经修改的历史表情实现。
- 另外 7 张 192×192 母帧裁自提交 `2f7cb0db1bc7f7780dddba13c6d17987f07a926c` 的完整 idle 图集：美短右侧、狸花三向、简州三向；简州左侧选第 6 帧，其余选第 0 帧。每条来源记录包含原 atlas 路径、原 atlas SHA-256、原提交、帧号、裁剪坐标和归档母帧 SHA-256。

构建只读本目录归档，不依赖 Git 对象或临时备份；开始时校验全部输入哈希，并确认当前角色母版与归档母版一致。7 张完整母帧只提供闭眼局部纹理，不复用其身体、鼻嘴、轮廓或 alpha。它们的 RGB 直接从 PNG 读取，避免按旧损伤 alpha 叠到母版后把睁眼虹膜混入闭眼。

`legacy-pixel-face-animation.mjs` 是原始历史实现。`offline-pixel-face-animation.mjs` 是构建专用派生实现，保留历史眨眼/旋涡/睡眠节奏，改用实测特征与真实源像素。运行时没有导入本目录中的代码或脸层，只加载最终完整帧 PNG。

## 几何与视觉修补

`source/facial-repair-overrides.json` 按品种及方向保存独立修补参数，所有 bounds 都使用 192×192 母版全图坐标 `[左, 上, 右不含, 下不含]`：

- `eyeBounds`、`mouthBounds` 是允许改变 RGB 的区域；`noseBounds` 在任何状态中均保持原 RGBA。
- `eyeFeatureBounds` 可单独记录真实眼球范围，避免扩大清理边缘时改变虹膜位置或尺寸。
- `closedEyeSource` 记录局部闭眼纹理的文件、帧号、眼心及可选安全采样框。8 个方向取历史局部 idle 图集，7 个方向取历史完整 idle 的母帧裁图；仅眼部小块配准，下缘接回同品种毛色，避免带入第二个鼻子/旧嘴。
- 奶牛猫与狮子白猫的另外 6 个方向使用实测同毛色来源恢复闭眼底色；奶牛猫使用可读的暖灰眼睑线，禁止把白鼻梁/白下巴颜色扩散进黑毛眼窝。
- 狮子白猫三方向显式设置 `eyelidStroke: 2`，防止 1 像素闭眼弧在 V5 的 0.5 缩放下变成几个孤立点；其余品种保持各自已验收的线条。
- 睡眠口部只清理母版旧嘴的暗像素，并从相邻真实口周毛色恢复；原鼻子不重画。舌头及眼睑内部有 1 像素的轻微周期变化，不移动头、身体或轮廓。

每一帧的 alpha 都直接复制原母版，不提升透明度。眼嘴区域外、鼻子、耳朵、身体、尾巴的 RGBA 均固定；距离半透明轮廓不足 2 像素的部位也固定。背面连透明区域的 RGB 也原样复制。

`build-report.json` 记录 112 张输出的 SHA-256、母版哈希、修补几何、闭眼来源、不同帧数量、变化像素数量，以及派生实现和参数文件哈希。多个时刻可合理复用相同姿态，但每套可见方向动画都有真实可见差异，不以复制母版或不可见噪点充当动画。

## 重建与验收

在仓库根目录运行：

```sh
node scripts/rebuild_fixed_body_character_atlases.mjs
node --test scripts/test_office_full_frame_assets.mjs
python3 scripts/test_normalize_full_frame_assets.py
```

只生成可审阅候选，不覆盖运行素材：

```sh
node scripts/rebuild_fixed_body_character_atlases.mjs --output-root .local/qa/candidate
node scripts/rebuild_fixed_body_character_atlases.mjs --output-root .local/qa/candidate --profile ragdoll-v1 --direction left
```

未知选项、重复选项或缺少选项值会立即失败。构建需要 `@napi-rs/canvas` 和 `pngjs`，本次使用版本分别为 0.1.100、7.0.0。脚本优先加载项目依赖，可通过 `OFFICE_QA_NODE_PACKAGE` 指向已安装这些依赖的 `package.json`，也支持本机 Codex 依赖目录。Python 回归需要 Pillow。

验收既包括像素约束，也包括逐帧放大和实际 V5 缩放视觉复核：不能仅凭 alpha、区域或不同帧数量合格就宣称脸部正确。修复前证据、候选及独立复审保留于 `.local/qa/cat-review-20261030/`；本轮 112 张运行图集与脚本备份位于 `.local/rollback/cat-detail-repair-20261030-170654/`，仅用于本机回滚，重建不依赖该目录。

`node scripts/qa_office_animation_repair.mjs` 使用正式 map-loader、遥测 adapter 和仓库 PNG，在本机 Chromium 检查真实时钟、回环及状态切换。完整候选集也可通过 `OFFICE_ANIMATION_QA_ASSET_ROOT` 指定根目录预先检查；该模式只替换七个非橘猫的完整帧请求，缺失文件直接失败，正式验收必须取消此环境变量。输出目录可通过 `OFFICE_ANIMATION_QA_DIR` 指定。

本轮逐品种问题及最终验收结果见 [OTHER-CATS-REVIEW.md](OTHER-CATS-REVIEW.md)。
