# left repair-v2

**定向修复完成、技术检查通过，交主代理最终视觉验。** 原不合格候选与所有原确认模板仍保留。

加载新 `manifest.json` 的character字段；其PNG URL均以reference-v3根解析。

- `character-base.png`：去掉旧五官的中性底图，192x192，alpha与原底图相同。
- `face-{working,idle,syncing,error}.png`：原生成帧mask规范化，360x174，4x3，90x58。
- `originals/neutral-base-repair-v2-original.png`、`prompts/neutral-base-repair-v2.txt`：本轮1次内置image_gen的原图及实际提示词。
- `sources/`：只读原候选的源图快照。
- `frames/`：每动作12张alpha规范化局部图。
- `normalization.json`、`generation-log.json`：完整加工/生成记录。
- `scripts/`：可复现的mask整理与离线QA，不画新表情、不旋转、不复制。
- `qa/REVIEW.md`、`qa/validation.json`：脸外0变化、轮廓0变化、noDoubleMouth结果。
- `qa/combined-contact-sheet.png`和workstation/face-detail contact：主代理验图。
- `FILES.md`、`files.json`：本次新增文件的全部绝对路径。

noHands是最终工位无敲键盘手且不加载手动画，不自动否定静态爪形；旋涡看自然连续感，不增数学等角度硬门槛。

本包未接管UI/runtime、未改家具、未部署。visualApproved=false等待主代理最终确认不等于修复失败。
