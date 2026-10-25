# idle 嘴部 mask 修复（只动 idle，保留旧版）

日期：2026-10-02。此轮没有图工具新调用，源图本身已有明确张嘴。仅放宽现有 idle alpha mask；不改底图、working/syncing/error、锚点、outline、UI/runtime 或旧候选。

## 原因核对

v2没有把嘴腔全部清掉，但 `[50,17,17,24]` 的嘴部框和只留暗色的策略截掉了部分右侧/下侧嘴腔，并几乎完全删除浅色口鼻毛面。保留下来的暗块落在中性底图的橙色脸颊上，失去仰脸张嘴的可读性。此前只凭小图和帧哈希给出的“张嘴可读”判断不充分，本报告以放大源图、mask与组合三者核对。

## 唯一素材修复

所有12帧共用扩展嘴部框 `[50,12,24,42]`（x=50..73, y=12..53）。在原v2 alpha mask上，仅并入既有源帧该框中的暗色嘴部和浅色muzzle像素。继续使用原有共同内部轮廓保护及ellipse clip。

没有单帧移位、缩放、旋转、重画或更改RGB。保留像素的RGB/alpha/坐标均直接来自同一既有源帧。框外idle特征逐像素不变；其他三套表情和中性底图不写入、不覆盖。新版manifest仅把 `character.actions.idle.face` 指向本目录新图；其他character配置完全一致。

## 文件

- `face-idle.png`：360×174 RGBA，4×3，90×58单格，12个真实不同帧。
- `manifest.json`：复用repair-v2中性底图与working/syncing/error；idle为新版路径。仍12fps、36-frame（3秒）时钟。
- `qa/mouth-idle-12-12x.png`：12帧组合后的嘴部12倍放大，4×3按行。
- `qa/mouth-phases-0-5-11-12x.png`：实际组合嘴部的第0、5、11帧横向放大；用来看最小/最大/回落相位。
- `qa/source-v2-v3-comparison-6x.png`：列依次源脸图、v2组合、新版组合；行依次0、5、11帧。
- `qa/contact-idle-12-2x.png`：12帧完整角色组合2倍放大。主代理应同时看完整组合，不只看裸face。
- `qa/face-idle-12-4x.png`：完整脸patch组合4倍放大。
- `qa/report.json`：诊断、每帧嘴部保留计数及不变性检查。
- `qa/idle-all-phases.gif`：仅查看12个实际相位；`qa/idle-clock-36.gif`：对应实际3秒时钟预览。GIF不是生产透明度依据。
- `scripts/relax_idle_mouth.py`：可复现的alpha mask后处理，不联网、不生成或代码绘制五官。

## 检查结果

- 每帧暗色嘴部及浅色muzzle已恢复，放大组合中12帧均保持开口，不是闭眼闭嘴图。
- 以第5帧和本次共同ROI计：v2暗色保留238像素→新版291像素；浅色muzzle保留3像素→新版351像素。
- 每帧mouth ROI外的idle像素变化0；body脸区外变化0；原外轮廓RGBA变化0；alpha占据轮廓变化0。
- 12帧哈希不同。并非复制静帧。
- 旧包和冻结模板共211个原文件哈希未变化。没有数学旋涡QA，也没有修改其他动作。

最终视觉通过仍由主代理亲自确认；没有把“睡觉”标签或像素计数作为自动通过依据。
