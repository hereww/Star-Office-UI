# 橘猫正面工位办公 · 12 帧候选方案

- 制作日期：2026 年 10 月 1 日（Asia/Shanghai）。
- 方式：项目 `$star-office-character-animation` 约束 + 内置 imagegen，一次生成；不接续旧失败稿。
- 状态：概念候选，未获用户验收，不是生产就绪图集。

## 当前视觉方案

同一橘猫母版，正面向下坐在木色桌面、青色座椅的局部工位上。桌边横向，电脑背面朝观众、屏幕朝角色，爪子在键盘上轻微交替打字，配合一次眨眼。整套不混入其他方向或其他动作。

图片包含 4 列 × 3 行、共 12 个候选动作格，按从左到右、从上到下读取；规划播放速度为 12 fps，约 1 秒一轮。本轮只交付原始候选图，没有生成播放预览，也没有确认循环接缝。

## 后续资源关系（保持既定方案）

- 行走：上、下、左、右各 12 帧，分别生成，不混在同一动作图中。
- 默认工作素材：writing / researching / executing 共用本方案的 working。
- idle、syncing、error 使用各自的独立动作提示词；不新增业务状态。
- 办公默认朝下正面；其他正交工位只按实际需要生成，不默认将所有状态乘以四。

## 简单检查与限制

- 已目视确认 12 个完整工位构图、正面朝向，没有混入斜向角色。
- 原图是 1448 × 1086 的 RGBA PNG，实际 Alpha 含透明像素。
- 桌椅和显示器在不同格中仍有轻微尺寸、位置差异；只作为外观与动作候选，不声称家具逐帧完全固定或可直接生产接入。
- 没有附当前地图的正交工位参考；这是新规则下的工位概念稿，不声称已经精确匹配现有地图。
- 本图含桌椅电脑，不能直接叠到已有相同家具的地图上造成双工位。
- 本轮未切帧、未缩放、未镜像凑帧、未修改任何生产前后端代码，也不自动重试或修绘。

## 文件

- 原始候选图：`/Users/hepingyu/Documents/ChatGPT/Star-Office-UI/assets/character-animation-proposals/2026-10-01-working-down-v1/working-down-concept.png`
- 实际生成提示词：`/Users/hepingyu/Documents/ChatGPT/Star-Office-UI/assets/character-animation-proposals/2026-10-01-working-down-v1/prompt.txt`
- 参数与检查记录：`/Users/hepingyu/Documents/ChatGPT/Star-Office-UI/assets/character-animation-proposals/2026-10-01-working-down-v1/generation.json`
- 橘猫身份母版：`/Users/hepingyu/Documents/ChatGPT/Star-Office-UI/.agents/skills/star-office-character-animation/assets/orange-cat-reference.png`
