# 右向坐姿表情 repair-v4-aligned

日期：2026-10-03。仅角色资产模块；旧版、原 approved-office-expressions-v1、运行时、index和assets.json未改。

## 根因及修复

1. 原版独立生成的4动作局部脸源与另一次全身无五官图分别缩放，未共用解剖位置基准。普通鼻部ROI `(67,24)` 与idle ROI `(55,6)` 不同，随后v3局部拼嘴只补alpha，不能纠正鼻嘴相对固定口鼻的注册。
2. 原脸框 `[86,60,90,58]`、椭圆 `[131,89,45,29]` 不适合idle源的上扬鼻和下颌。原headAnchor `[131,89]` 是面中而非耳顶。poseAnchor是整角色静态坐标，不是随帧错位的原因。
3. 本版4动作都以同一右向无五官底图和同一头部模板重新通过内置imagegen生成。每次调用一个动作完整12格；idle第一次边缘连接、第二次小嘴均保留为拒绝源，最终另一次完整12格张嘴源通过检查。
4. 不复用旧表情像素。全部新源统一切分4x3源格、统一归一化为123x109，再以固定origin `[57,18]` 把生成五官投到192底图。所有帧/动作同一映射，不逐帧平移/旋转/镜像。只提取生成五官原RGBA、清除生成轮廓的alpha；不编程绘制五官、不复制静帧。
5. 最终从192底图坐标 `[84,54,90,58]` 裁出标准90x58脸源，每套360x174。不是60x68目标脸拉伸。中间试验60x68已弃用；当前manifest为标准源格与等尺寸目标脸框。

## 接口（必须全部使用manifest.character，不覆盖锚点）

- base: `media/character-right/repair-v4-aligned/base.png`
- frameSize: `[192,192]`
- poseAnchor: `[112,174]`
- scale: `0.6`
- headAnchor: `[110,8]`，耳顶高度
- faceRect: `[84,54,90,58]`
- faceClipEllipse: `[139,82,47,36]`
- faceFrameSize: `[90,58]`
- actions working/idle/syncing/error: 本版本独立face PNG
- 12帧、12fps、4x3；时钟60/36/60/12，六业务状态映射完全不变。

## 闭环检查

使用现有真实DirectionalSeatedPlayer导入本包，原right家具后/前层、原分层顺序、原screenEffects，无修改运行时。Chrome真实Canvas渲染四动作×12帧，48张192x192工位PNG已保存。四动作大图均逐格查看：眼鼻嘴落在同一固定头部；idle所有格明确闭眼张嘴；没有原闭嘴线残留；桌面/键盘没有遮到脸，眼/嘴不被椭圆裁断；error旋涡在固定眼窝，working/syncing为稀疏眨眼。

机器复算：48帧每动作12个不同RGBA格；全部五官被椭圆剪掉像素=0；脸框外底图差异=0；透明轮廓alpha占位变化=0；原图部分内部alpha为254，五官叠加后内部alpha数值变化另行记录，不以此冒充完全RGBA不变；idle黑色口腔像素每帧96–128，最小相位也明确张嘴。

注意：此技术视觉复核不是用户最终视觉确认；`humanApproved:false`、`visualApproved:false`保留。`integrationAllowed:true`只表示允许主线程集成和回归。没有部署，也没有把这些改动接入默认assets.json。

## 分辨率边界

生成源实际1535x1025，已如实保留。角色母版192x192、图集360x174为原像素方案的逻辑规格。大图使用最近邻放大供审阅，不声称源图原生4K。主线程负责整体场景4K画布和字体。

## 文件

- `manifest.json`：完整接口、源和验收
- `sources/`：4动作新生成源 + 2个被拒绝idle源
- `qa/face-*-12-4x.png`：逐帧面部近景
- `qa/character-*-12.png`：固定底图逐帧合成
- `qa/workstation-*-12-2x.png`：真实192工位逐帧合成2x检查
- `qa/workstation-four-actions-all-48.png`：4行×12格真实工位总览
- `qa/technical-report.json`：实算技术指标
- `qa/browser-render-report.json`：真实播放器每帧snapshot
- `scripts/`：规范化、manifest和Chrome闭环QA脚本
