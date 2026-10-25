# 右向角色 repair-v2：定向修复完成，供主代理视觉复核

日期：2026-10-02。状态：`repair_v2_ready_for_human_review`；未自动视觉批准，未接入运行时，未自动通过工位遮挡验收。

## 本次改动

1. 用内置 image_generation / image_gen **新增一次中性脸编辑调用**：删除旧眼/眉/鼻/嘴，保留同画风橙白毛面。原图 `originals/neutral-base-original.png`、实际提示词 `prompts/neutral-base.txt`、参考底图 `references/base-right-4x.png`、来源 `generation-record.json` 均保留。
2. 将图工具画好的毛面一次裁切/配准到固定脸区；只采用工具原图内的RGB。原版192角色在脸区外及外轮廓的像素原样保留，整幅原alpha原样保留。没有代码补画毛色或五官。
3. 复用v1四套真实12帧图集，采用 region alpha trim 仅保留眼/眉/眼睑/鼻/嘴等内部五官像素，去掉会漂移的整块毛色/胡须/脸边填充。保留像素的RGB与坐标均与v1原帧完全一致；不移动单帧，不旋转，不镜像，不复制静帧，不重新生成动作。
4. 全部动作、全部帧共用 `faceRect=[86,60,90,58]`、`faceClipEllipse=[131,89,45,29]` 和同一中性底图。共享内部轮廓遮罩防止表情改动角色外轮廓。

## 供接收的文件

- 两个授权根目录各自的 `repair-v2/manifest.json` 内容一致。配置URL以 `frontend/company-office/reference-v3/` 为根。
- `base-neutral.png`：192×192 RGBA。
- `face-working.png`、`face-idle.png`、`face-syncing.png`、`face-error.png`：360×174 RGBA，4×3，单格90×58；各12个真实不同帧。
- 12fps；working/syncing 60-frame（5秒），idle 36-frame（3秒），error 12-frame（1秒连续循环）。原六业务state映射不变。
- `qa/final-combined-contact-sheet.png`：2304×768，4行×12列。行依次 working、idle、syncing、error；列依次帧0..11。**这是主代理应亲自看的最终组合图，不是裸表情atlas。**
- `qa/contact-{action}-12.png`：每动作单独4×3完整角色组合，768×576。
- `qa/overview.png`：依次中性底图、working、idle、syncing、error。
- `qa/preview-{action}.gif`：真实12帧按对应5/3/1秒时钟播放的查看辅助，不作为生产PNG透明度依据。
- `qa/error-eye-phases-12.png`：单眼旋涡12相位放大图。
- `qa/report.json`：数字校验、视觉说明和保留范围证据；`qa/numeric-report.json` 为可复现构建数字检查。

## QA

- 中性底图相对v1：**脸patch外变化0**；外轮廓保留原RGB/alpha。
- 所有48张组合：**body脸patch外变化0**、**头/身体外轮廓RGBA变化0**、**alpha占据轮廓变化0**；固定毛面在五官变化区域之外变化0。
- 不再保留旧眼/旧鼻/旧嘴；组合未观察到双鼻嘴。熟睡鼻/嘴采用生成图中的内部抬高姿态，不物理旋转头部。
- 四动作各12格非空；trim后完整帧和旋涡eye-only均保持12个不同帧。
- 旋涡眼每帧保持单眼迷糊语义，无突然回到普通瞳孔、第二眼或身体/头部切换。首尾eye变化87像素，相邻变化范围51..162，接缝不是异常大跳变。**不要求数学等角度**；自然连续感仍提供GIF与接缝图供人工最终确认。
- noHands语义已按用户澄清：裸sprite静态脚允许保留；最终工位合成不能露出敲键盘手，不允许身体动画。未在此素材任务中自动批准桌面遮爪效果。
- v1候选、v1 manifest、v1脚本及冻结模板合计121个原文件哈希均保持不变。没有修改UI/runtime/家具/其他方向；没有创建代理或部署。

## 后处理限制

`repair-v2/scripts/build_repair.py` 只做工具素材裁切/一次共同配准、原图局部保留、region alpha trim、真实图集整理、离线组合与数据检查。可见五官RGB直接来自v1同坐标帧，没有生成或代码绘制新眼鼻嘴。透明像素的RGB归零仅用于PNG透明数据清洁。

可复现命令：

```sh
PYTHONDONTWRITEBYTECODE=1 /Users/hepingyu/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 /Users/hepingyu/Documents/ChatGPT/Star-Office-UI/assets/company-office-reference-v3/character-right/repair-v2/scripts/build_repair.py
```
