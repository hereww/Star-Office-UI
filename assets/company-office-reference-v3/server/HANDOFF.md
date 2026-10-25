# v3 独立服务器资源交接

状态：`server-asset-ready-for-integration`。仅机柜资源完成，未修改布局、运行时、家具或角色，未子委派，未远端部署。用户视觉批准与实际场景集成不在本资源 QA 声明内。

## 资源

- 运行文件：`frontend/company-office/reference-v3/media/server-rack.png`，RGBA **256×320**，路径相对 v3 根是 `media/server-rack.png`。
- 本目录 `server-rack.png` 是逐字节一致的资源副本。
- `sources/server-rack-source.png` 是内置 image_gen 的完整 **1122×1402** 原输出，未改动。
- `GENERATION_PROMPT.txt` 已更新成实际完整 prompt；调用参数与原图 SHA256 分别见 `generation-request.json`、`generation-record.json`。
- `scripts/normalize_server.py` 只裁透明 margin、等比 nearest 缩放、放入透明画布；不绘图、不修 RGB、不旋转或镜像。裁切框 `[241,184,907,1245]`，缩放后 `[191,304]`，放置偏移 `[32,9]`。最后纵向1px画布对齐，让三灯都能在65×83 nearest采样中保留，不移动/绘制机柜局部或 LED。

## 造型核验

六个独立托盘单元；第2、4、6托盘各一条绿灯，共三条。黑灰石墨材质，细通风栅，固定办公室俯视视角，正面＋窄右侧＋少量顶部。没有文字、人、场景、地面、背景棋盘格或大阴影。

## LED 配置（以最终完整256×320透明画布为准）

| 托盘 | LED rectPx | centerPx | centerNormalized | 65×83槽内中心偏移 |
| --- | --- | --- | --- | --- |
| 2 | [75,107,10,4] | [80,109] | [0.3125,0.340625] | [20.31,28.27] |
| 4 | [75,188,10,4] | [80,190] | [0.3125,0.59375] | [20.31,49.28] |
| 6 | [75,267,10,3] | [80,268.5] | [0.3125,0.839063] | [20.31,69.64] |

比例矩形及未四舍五入的65×83像素范围见 `manifest.json` 的 `leds`。

主代理建议的 `layout.server.leds`（相对 server.bounds 左上角，中心坐标）：
```json
[[20.31,28.27],[20.31,49.28],[20.31,69.64]]
```

**只读发现：**现有布局是 `bounds=[433,795,65,83]`、`leds=[[17,25],[17,43],[17,61]]`，旧坐标对新机柜会左偏并逐排上偏，不能直接复用。新坐标建议已记录，但 layout/runtime 没有被本任务改动。

计算任意显示尺寸时使用：`bounds.x + centerNormalized.x * bounds.width`、`bounds.y + centerNormalized.y * bounds.height`。现有 runtime 的3×2 LED矩形会比原图薄条略高；若要严格贴合源图，使用 manifest 的比例宽高（约2.54×1.04、2.54×1.04、2.54×0.78于65×83），或针对整像素预览使用3×1条。此处只建议，不改渲染代码。

## QA

- `qa/alpha-qa.json`：最终alpha范围0..255，四角和全部边缘alpha=0；透明像素占32.2815%；源图真实alpha，不是棋盘格贴图；完整源文件未改。
- 256×320检测到3个独立绿色像素组件；65×83仍检测到3个3×1绿条。
- `qa/server-rack-at-65x83.png` 是实际目标尺寸；`qa/server-rack-at-65x83-8x.png` 是nearest放大预览；`qa/server-rack-3x.png` 是完整尺寸检查。
- `qa/visual-qa.json` 记录六托盘、正面/窄右侧、材质和小图可读性目视核验。
- `qa/final-qa.json`：原图精确复制、实际完整prompt、纯margin裁切＋缩放像素重现，以及106份家具/原冻结模板文件哈希未变。

## 家具遮挡建议（只读，不改文件）

继续保留家具 manifest 中 up／left／right 的 `back → screen → actor → front`，不要为统一接口把 screen 改为最后一层：当背向头部遮住屏幕底部时，特效应被头部挡住。down 仍用 `back → actor → front → screen`，且 screen.visible=false，仅允许后壳 LED。当前 DirectionalSeatedPlayer 已按每方向 order 绘制，不需本资源任务改动。
