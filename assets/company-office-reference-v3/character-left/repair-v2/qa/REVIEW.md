# 左向 repair-v2 — 技术修复完成，交主代理最终视觉验

本轮只用内置 image_gen **1次**定向编辑中性脸底图；四套表情继续使用原来真正生成的12帧。原候选、四套原图和 approved-office-expressions-v1 没有覆盖。

## 修复方式

- 用 image_gen 去掉固定 patch 内旧眼、眉、鼻、嘴，生成与原画风一致的橙/白毛面；不代码画毛面或表情。
- 新底图只接收固定 patch 内生成RGB；外围原图RGB及整个alpha通道原样保留，耳朵、头边、身体和尾不变。
- 四套 face 使用共同 `faceRect=[38,64,90,58]`、`faceClipEllipse=[76,93,32,27]`。仅所有图共用一次rect向左4像素调整，**无逐帧位移或独立缩放**。
- 图集alpha仅保留原生成眼、眉、鼻、嘴。去掉重复的毛色/脸周边层，并使用固定轮廓内侧mask避免眼鼻嘴跨出原轮廓。visible RGB逐像素来自对应的原生成帧，没有新增绘制、帧复制或旋转。
- working/syncing时钟60，idle 36，error12，fps12，4x3局部格90x58；仍是192x192静态身体底图，不是全身12帧生成。

## 实测结果

|动作|不同表情帧|不同合成帧|脸区外变化|max头轮廓RGBA变化|max alpha轮廓变化|double mouth|
|---|---:|---:|---:|---:|---:|---|
|working|12|12|0|0|0|无|
|idle|12|12|0|0|0|无|
|syncing|12|12|0|0|0|无|
|error|12|12|0|0|0|无|

- 原底图→中性底图：patch外变化0，原alpha通道byte变化0，头外圈RGBA变化0。
- 中性底图的旧眼/眉/鼻/嘴内侧残留检测均0；48帧每帧仅一个生成嘴部深色组件，`noDoubleMouth=true`。
- 48帧保留的可见五官RGB与源图对应像素完全相同，重绘计数0。
- 重复毛色图层已裁掉；所有动画五官mask并集外的毛面、胡须、条纹像素变化为0。
- 133个受保护输入文件SHA-256全部未变（包括原候选和原确认模板）。
- PNG均是真实RGBA透明；4套规范化脸图均非空且12帧不同。

## noHands修正口径

静态脚/爪形不作为裸sprite失败条件。检查是不加载手动画，最终工位不见敲键盘或前伸操作手。

本包包含只读当前LEFT家具的离线合成图；未修改家具。工位合成可见键盘无遮挡、无打字手，角色底部静态脚由椅子/近扶手层遮挡；最终遮挡效果由主代理验。手动画加载数0。

## 视觉观察与保留给主代理的判断

已查看修复后四动作组合contact、idle与error的12格脸部特写和LEFT工位合成。旧眉嘴重影已消除，原大块fur接缝不再由整脸重复覆盖造成。idle为闭眼张嘴扩大/缩小呼噜；error保留12种生成旋涡形态，另附12fps无损局部APNG。

旋涡验自然连续感，不额外要求数学等角度。最终连续感、睡态仰脸强度、动作差异和家具遮挡由主代理亲自视觉验。本报告不冒充最终视觉批准或生产runtime接入。

## 文件

- `manifest.json`：新character config与技术通过数据，URL以reference-v3根解析。
- `qa/validation.json`：逐帧测试结果及文件保护检查。
- `qa/combined-contact-sheet.png`：列working/idle/syncing/error；行frame 0/5/6/11。
- `qa/*-composite-contact-2x.png`：每动作完整12格裸角色合成。
- `qa/*-workstation-contact-2x.png`：每动作完整12格当前LEFT工位合成。
- `qa/*-face-detail-contact-4x.png`：12格脸部特写。
- `qa/error-face-loop.png`：无损APNG局部脸12fps循环（仅QA）。
- `scripts/build_repair_v2.py`：允许的裁切/缩放/alpha-mask规范化。
- `scripts/qa_repair_v2.py`：不接入runtime的离线QA与contact合成。

仅新增 repair-v2 子目录，未改父级旧manifest、UI、runtime、家具或其它方向。
