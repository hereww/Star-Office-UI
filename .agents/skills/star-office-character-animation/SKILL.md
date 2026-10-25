---
name: star-office-character-animation
description: 用同一角色母版为 Star-Office-UI 最新 V5 共享长桌生成四向固定坐姿角色和12帧局部表情，并保留独立屏幕特效。适用于小猫与办公角色替换；行走仅在明确请求时使用历史模板，不用于场景背景或Codex宠物注册。
---

# Star Office 角色动画提示词

## 最新 V5 模板优先（2026-10-07）

当前正式产品基线为 `company-office-connected-v5`，不是 V4 独立工位。新增角色或工位模板任务先读 [V5 角色与共享工位模板](references/connected-v5-template.md) 及项目 `frontend/company-office/connected-v5/character-template.json`。

- 两组连续长桌、16 个工位和屏幕内容全部共享；生成角色时禁止画入家具或键盘手部动作。
- 四向底图固定，down/left/right 只有局部脸部表情变化；up 为背面，不画脸部图集。`ConnectedSeatedPlayer` 只画椅子与角色，由 V5 长桌完成遮挡。
- 表情层沿用旧 approved 素材的 12 帧约定，运行时为 `expression-plus-screen-effects`：屏幕特效独立运行，背屏 LED-only。
- 七个猫品种目前只可选静态概念预览，不可保存为生产角色。不得将静态概念图或旧工位播放器冒充 V5 已接入角色。
- 下面旧 down 模板与行走说明仅用于原素材出处/明确历史需求；它们不能覆盖本节 V5 约束，也不能重新引入行走。

### 当前 V5 使用入口

1. 使用 `connected-v5/character-template.json` 的 `generation.prompts` 和对应方向的 `baselineGeometry`，不要先调用历史 `workstation` 脚本生成新的独立桌子。
2. 按 [V5 角色与共享工位模板](references/connected-v5-template.md) 生成四向固定坐姿底图，以及 down/left/right 各四状态的局部表情；up 保持真实背面。默认不生成行走资源。
3. 在最新 V5 后台的动画预览中选择角色。七个新品种当前只有静态候选图；补齐并验收资源前保持候选，不伪造方向或动画，不开放保存绑定。
4. 生产替换需完成 V5 合同的发布门槛和实际服务器验收。模板/本地预览通过不等于已正式部署。

## 历史素材来源：down 固定坐姿表情（2026-10-01）

以下是 2026-10-01 的 down 素材来源说明，不是当前 V5 的四向生成入口。固定坐姿原则仍适用，但家具图层与四向合同以上面的 V5 模板为准：**不生成、不播放敲键盘的手；只保留静态键盘，工作状态用表情表达。**

- 一张静态坐姿底图 + 四套12帧脸部表情：working专注、idle仰脸闭眼张嘴熟睡、syncing等待、error迷糊旋涡眼。
- 身体、头部轮廓、耳朵、尾巴、座位位置与尺度全部不变；睡觉的后仰效果由仰脸抬鼻、露下巴和张嘴的脸部图表现；桌子、键盘和显示器固定；禁止呼吸晃动、摇头或整角色轮播。
- 表情图集仍是4列×3行、12fps；工作/同步每5秒播一次12帧；待命保持仰脸睡态，每3秒一次嘴部呼噜变化；出错12帧连续循环旋涡眼。身体和头部轮廓仍固定，不做物理后仰旋转或摇晃。
- 脸部只在固定区域覆盖；默认局部单格90×58，角色底图/工位192×192。换角色时一次配置自己的poseAnchor、scale、faceRect/faceClipEllipse，并替换同角色脸部图集；不要动家具。
- 使用 `scripts/make_prompt.py working --expression-only --json`；idle/syncing/error同样带`--expression-only`。替换角色再提供`--reference /绝对路径/母版.png --face-reference /绝对路径/固定坐姿脸部裁图.png`，不强套橘猫身份。
- 当前表情提示词在[seated-expressions.json](references/seated-expressions.json)。旧[提示词库](references/prompt-library.md)里的打字、呼吸、摇头属于历史整角色方案，不用于当前坐姿模式；普通行走保持原流程。
- 当前版本已由用户于2026-10-01确认，固定保存为`assets/approved-office-expressions-v1/`；使用前读[已确认办公模板](references/approved-office-expressions.md)。后续修改另建版本，不覆盖本包。项目根目录`assets/character-animation-proposals/2026-10-01-seated-office-states-v2/`保留预览及生成来源；视觉已确认，但未接入生产。

## 历史单工位与行走素材制作约定（非 V5 默认流程）

用户选择的是简单的**提示词生成动画素材**，不是逐帧修绘工程：

- 一个动作 → 一条提示词 → 一次生成完整12帧；四方向各12帧，不是四方向合计12帧。
- 新素材预览默认12fps，即12帧约1秒；帧数和播放速度是两个参数。这是新素材约定，不是说原版所有动画都只有12帧。
- 角色统一4列×3行，按行播放；普通全身行走/待命/告警目标单格96×96（当前工位模式用局部表情规格），办公角色与固定工位共享192×192坐标、角色整图768×576。工位单独用2列×1行保存后景/前景，不是12帧家具动画。生成原图可更大，裁切整理时保留共同尺度，不要求模型精确输出像素尺寸。
- 所有动作附**同一母版图片**，默认 `assets/orange-cat-reference.png`；用户指定的母版优先；使用`--reference`时按该角色身份生成，不套橘猫毛色/物种文字。
- 朝向只允许 **up / down / left / right**；整套12帧固定同一朝向。禁止斜向、45°、三分之四视角或旋转镜头。向上是背面，向下正面，左右是对应侧面。
- 办公动作默认 **down：正对画面坐在工位上**，不是斜坐。桌椅、键盘、显示器和角色沿地图十字轴配套；其他方向需要独立工位与脸部参考；该历史模板只实现down；当前 V5 按四向合同独立生成，不旋转图集冒充其他朝向。
- 行走图集为**角色-only**。当前办公是face-only；工位与固定坐姿的结合方式是程序组合，不是把桌椅电脑画进12帧：工位单独静态绘制，桌子/显示器/键盘保存在同一前景资产；后景椅子→角色→前景桌子电脑。每角色配置一次`poseAnchor/scale`，换帧、换角色都不得移动家具。
- 固定坐姿底图结合工位参考一次制作；随后表情只附该底图的脸部裁图与身份母版。任意站立PNG不能自动变办公姿势，不默认生成手部接触动画。
- 全部真实透明背景，不生成办公室全景、地板、文字、气泡或特效场景。

## 历史已确认素材与未通过素材

- 历史 down 办公素材包为`assets/approved-office-expressions-v1/`，包含固定坐姿、无手工位与完整四套表情。用户确认不代表生产接入许可。

- 四向行走朝向已由用户在2026-10-01确认，模板原样保存于 `assets/approved-walk-directions-v1/`；生成行走时先读 [方向模板索引](references/approved-direction-templates.md)，以原母版约束身份、对应方向A/B约束朝向和姿势。
- 这份模板每方向只有A/B两张参考，不是完整12帧循环，也不代表生产就绪。不要复制凑帧或把down-v7旧失败稿当成已通过。
- 工位办公working-down-v2被用户指出仍有问题，已记录为未通过；保留问题稿，不用它做已确认办公模板，也不将其相机角度自动升级为已确认约定。

## 历史行走最小资源包（仅明确请求行走时）

仅在用户明确请求历史行走资源包时生成8套：`walk-up / walk-down / walk-left / walk-right / idle / working / syncing / error`，合计96帧。

业务状态仍是 `idle / writing / researching / executing / syncing / error`。原版主角色的 `writing / researching / executing` 共用 `star_working`，新素材默认也共用 `working`。不要新增一个名为working的业务状态，或把executing理解为跑步。

用户明确要六状态的动作各有区别时，启用三个独立提示词 `writing / researching / executing` 代替共用working；此时四方向加六状态是10套/120帧。不默认额外制作。

源码映射和原版隐藏角色/单独同步、报错效果的区别见 [状态映射](references/state-mapping.md)。动作定义和公共提示词在 [prompts.json](references/prompts.json)，可直接复制的完整提示词见 [提示词库](references/prompt-library.md)。

## 历史脚本使用方式（非 V5 默认入口）

1. 先用`scripts/make_prompt.py workstation`获取静态工位提示词（当前仅down，1个工位、2层）；家具验看后再选择动作或状态，用 `scripts/make_prompt.py walk-down`、`scripts/make_prompt.py writing --expression-only` 获取当前固定坐姿表情提示词；`writing`默认选择共用working，历史整角色`writing --distinct-state`才选择独立文档动作，当前表情模式不启用它。办公默认朝下；旧全身坐姿概念入口仍保留，但不用于当前办公播放；当前只用`--expression-only`。脚本仅输出文本，不联网、不调用模型、不修改生产。
2. 仅请求方案/提示词时，到这里即可。请求出图时，读取可用的 `$imagegen` Skill，用内置图片生成工具，附母版与可用工位参考的绝对路径并设 `transparent_background=true`。每个动作一次调用，不在同图里混四方向或多个工作状态。
3. 简单检查：实际有12格、只有指定的四向之一、办公图没有家具、坐姿与工位同轴、组合后键盘没有手部覆盖、表情以外像素不动、角色没有明显变样、PNG真实透明、没有裁掉身体。生成不符合要求时如实展示问题并停在该候选；不自动反复重试、不拼接失败稿、不用镜像或复制静帧凑12张。
4. 保存原图、动作名、帧数/网格/fps说明；需要时一次性裁成12PNG/图集并出预览。不要把4关键帧、骨骼图、逐接缝评分、独立审查或宠物8×11图集列为默认前置步骤。

生产接入是另一个任务：保留现有状态API、路径、区域和服务器/同步/报错效果。没有接入和测试之前，不宣称新角色动画已随业务状态运行。

办公素材默认分离；旧组合图未通过，不复用为模板。地图已有家具时复用其几何/图层，不再叠出一套工位。

## 历史模块化办公候选

2026-10-01新工位及角色首稿：`assets/character-animation-proposals/2026-10-01-modular-office-v1/`（项目根目录下）。组合规格与替换接口见[模块化工位约定](references/modular-workstation.md)。静态家具及替换机制可独立检查；本轮橘猫手部没有伸到键盘两侧，办公动作未验收，不称生产完成。
