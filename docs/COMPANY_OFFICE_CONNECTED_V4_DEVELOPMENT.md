# Connected-v4 连排工位运行时开发记录

更新时间：2026-10-03。此文档只记录运行时子任务，主线程负责路由、正式验收脚本、截图与用户视觉确认。

## 版本与边界

- 新场景 `company-office-connected-v4`，`ConnectedOfficeRuntime.load('/static/company-office/connected-v4/')`。
- 继承 `../reference-v3/runtime.mjs`；可选兼容导出名 `ReferenceOfficeRuntime`。
- 不覆盖 reference-v3，不修改旧角色/表情、背景、房间、服务器、状态接口或业务映射。
- 16席：红区纵向4对8席；绿区横向上4下4。主工位仍 `desk-12`；所有 role/group/binding/guestSlots 保留。
- 本任务没有远端部署、commit 或后端API状态写入；所有自测状态变化为浏览器本地 demo。

## 文件职责

| 文件 | 职责 |
| --- | --- |
| `frontend/company-office/connected-v4/runtime.mjs` | 父运行时适配、真实manifest加载、角色/屏幕替换、快照 |
| `frontend/company-office/connected-v4/furniture-contract.mjs` | 统一manifest验证、真实manifest字段适配、原角色透明包络、坐标变换 |
| `frontend/company-office/connected-v4/seated-player.mjs` | 继承原DirectionalSeatedPlayer，只裁原椅子＋原actor，真实桌沿遮挡 |
| `frontend/company-office/connected-v4/screen-overlay.mjs` | 每席独立小屏幕纹理，polygon裁切、背屏LED、窄侧屏柔和色变 |
| `frontend/company-office/connected-v4/layout.json` | 新家具fit及初始座位配置，旧房间/背景引用 |
| `frontend/company-office/connected-v4/assets.json` | 显式指向原 reference-v3/assets.json，不复制生成角色参数 |
| `frontend/company-office/connected-v4/style.css` | 已退役；正式入口直接使用 `reference-v3/controls.css` 或 `frontend/office/office.css` |

## 原角色绝对不变

运行时加载当前 reference-v3/assets.json 并深克隆，仅将图片URL解析为绝对URL；所有 character 数值、方向、faceRect、faceClipEllipse、poseAnchor、headAnchor、scale、动作映射保持原样。椅子也直接引用旧back/front图片。没有修改原图、镜像、旋转、重制角色或新增手部。

工作/同步60、休息36、出错12帧状态时钟保持；12fps；四套各12帧。业务状态仍六个，writing/researching/executing共用working表情。

`ConnectedSeatedPlayer` 原封继承 `_drawActor()`、`bodyPlacement()` 和采样时钟，重写 `_render()` 只绘：旧椅子back裁切→原actor→旧椅子front裁切。旧桌/键盘/显示器从不绘入角色纹理。新家具每张一体长桌只绘一次，而不是八张旧小桌拼接。

非up角色采用 `destination-out` 结合真实新家具alpha，仅在固定下身区域做桌沿遮挡，不覆盖脸部。up沿用原actor→椅背前景顺序，确保背坐角色面朝桌上显示器。

真实48帧测得原actor＋椅子alpha包络 `[x,y,w,h]`：

- up `[47,63,88,106]`
- down `[38,1,115,103]`
- left `[86,41,83,121]`
- right `[8,30,90,139]`

新角色替换与方向切换均重新构造 ConnectedSeatedPlayer，不回退到带独立小桌的原播放器；失败加载/冲突在原站位上不提交，异步操作采用last-request-wins。

## 家具manifest统一接口

所有图像、屏幕和接触点是原图像素；家具统一等比 contain，不独立拉伸坐标。统一字段：

```json
{
  "image": "bench.png",
  "actualPixelSize": [1680,536],
  "alphaBounds": [0,0,1680,536],
  "seatContacts": [{"id":"desk-09","side":"top","anchor":[168,36]}],
  "screens": [{"seatId":"desk-09","kind":"back","led":[180,160,4,3]}]
}
```

上例仅字段示范，不是完整可加载manifest；真实必须8个contacts＋8个screens。统一 `alphaBounds` 使用XYWH；`led` 接受XY或XYWH。正屏须给真实玻璃内侧polygon；背屏仅LED，禁止绘背壳polygon为屏幕。接触点可位于图像边界之外（紧alpha家具图没有椅子边缘留白时），最终逻辑地图/禁区验证仍严格。

### 已交付真实素材的适配（不修改素材manifest）

- 两代理的 `alphaBoundsConvention` 明确LTRB，运行时取 `visibleAlphaBounds`（同为LTRB）转XYWH，避免低alpha毛边导致家具看起来过小。原alpha范围保存在manifest.normalization里供审计。
- 纵向：`point` 为躯干中心，`characterDirection` 为方向，`id` 为席位；奇数左/朝右，偶数右/朝左。坐姿pose接触点Y=躯干世界Y＋30×工位scale。只移动整个席位，不改角色参数。
- 横向：`position` 为桌沿，`row=north/south` 转 `side=top/bottom`；桌沿转换到原椅子pose的Y偏移为down `8×scale`、up `27×scale`。
- 横向 `visible:false` 为背屏；LED对象 `{position,radius,sourceVisible}` 转小矩形。`sourceVisible:false` 的正屏LED仅是代理建议点，运行时不虚构该硬件，不绘制。
- 纵向3px宽可见侧屏：不强塞文字/终端图形，用六状态不同的温和颜色变化；变化严格裁在原侧屏polygon内。

### 实际放置

- 纵向fit `[340,105,250,315]`；visible家具世界范围 `[422.9348,105,84.1304,315]`。原角色worldScale=0.5，左右4对，准确匹配每对Y300/667/1035/1398。
- 横向fit `[760,488,420,200]`；visible家具世界范围 `[760,522.2541,420,131.4917]`。原角色worldScale=0.56，上4朝下、下4真正背坐朝上。没有把桌表面机械贴在最初approx fit的Y470顶边。
- 全部角色/椅子包络验证不碰办公室或摇滚房间禁区；桌子visible alpha也验证原禁区。图像仍保留透明边缘，不裁改或插值升级素材。

## 高清、气泡、状态与安全

完整继承原OfficeRenderQuality、系统中文字体、屏幕空间bubble排布、camera/density缩放、响应式和reducedMotion。真实浏览器1920×1080/DPR2实测Canvas/WebGL均3840×2287。

屏幕采用每个显示区域192×192独立纹理，由新长桌原图坐标直接转换；不会每帧重绘整张家具。横向4背屏仅LED、4正屏沿真实玻璃polygon显示原screen-effects六状态；键盘静止。每席stateEpoch独立，本地demo不会POST后端。

点击角色使用pixelPerfect alpha命中，避免透明的192px画布抢相邻席位点击。原bubble和控制面板事件复用。

快照包括 `scene`、`furnitureMode:'connected-benches'`、benchCount=2、每bench seatCount=8、真实像素尺寸、alphaWorld、屏幕绑定和sourceSpriteHashes。sourceSpriteHashes实际从原角色base/face文件读取SHA-256，16个唯一原sprite引用；它是原资源来源证据，不把用户后续替换图冒充原sprite。

## 替换接口

- `replaceCharacter(character,{baseUrl,stationId})`：只接受当前方向，加载失败保留原角色，成功仍chair-only播放器；原状态/时钟由epoch重新采样。
- `setStationDirection(id,direction)`：四向真资源，保留真实接触点和状态，不镜像/旋转，验证座位包络再提交。
- `replaceScreen(stationId,{kind,polygon,led})`：统一接口源像素配置，同席唯一绑定，先验证完整manifest再更新显示；缺失背屏LED或自交polygon拒绝且不撤掉旧屏。
- `replaceServer()` 原父类直接继承。

## 本子任务自测（主线程正式验收另行执行）

1. Node语法：全部新 `.mjs` 通过。
2. 统一/真实两份manifest与contact转换：16席、8＋8屏幕、房间禁区/座位重叠均通过；自交屏幕polygon拒绝；原character所有非URL参数一致。
3. 实际Chrome Canvas：4向×6状态24组，与独立复算的原actor＋原椅子裁切逐像素一致；原时钟不变。此项用远离角色的遮挡fixture专测角色/表情保真，不代替真实桌沿视觉验收。
4. 实际 connected 路由启动：scene正确、2长桌/16席/16屏、16个原sprite SHA引用、0 JS错误、真实4K画布。
5. 全16席×4向×6状态384组本地demo采样通过；16次原角色替换后仍ConnectedSeatedPlayer/chair-only；屏幕替换成功＋无效配置回滚；实际绑定不变。自测无API写入。
6. 已目视看纵桌、横桌和最终全图截图（浏览器内存输出，不写主线程截图目录）。最终视觉确认仍归用户，主线程正式验收报告另行保存。

## 主线程接入/验收注意

- 路由import `runtime.mjs`，load如上；继续 `body.dataset.officeMap='reference'` 复用高清CSS，`officeVariant='connected-v4'` 可标记新版本。
- 原 `/static/company-office/reference-v3/controls.mjs` 的mountOfficeControls直接兼容本运行时；无需复制控制模块。
- background和server是新layout里的相对旧版本URL，preload继承可正常解析；若index有背景路径拼接逻辑，必须使用 `new URL(layout.background,runtime.baseUrl)`，不能误加connected-v4额外前缀。
- 主线程验证上下两侧正反屏层级/桌沿、移动端/4K文字、角色所有参数与URLs原封不变、旧90文件hash、demo安全等。
- 图片源实际为纵887×1774、横1774×887；场景继承真实4K渲染不意味着这些生成图片是原生4K，不宣称其native4K或用户已批准。

## 2026-10-03 小修：头顶气泡避让新长桌屏幕

本次仅增加 `frontend/company-office/connected-v4/bubble-layout.mjs` 并更新本版本runtime；没有改变角色/家具/原版runtime。

- `layoutClearBubbles()`先继承原高清气泡排布，再根据真实家具manifest保护玻璃/背壳polygon及LED。只重新排布挡屏的气泡，不修改其他正常气泡。
- 桌面绿区下排up气泡优先移至头部斜上方列间空隙；手机气泡较宽时采用位于上排头部下方、监视器上方的清晰横行，仍在对应up角色头顶上方。
- 保护区保留2个CSS像素余量；排布同样避开全部可见角色头部和其他气泡。必要的细引导线采用直角绕屏路径，不跨玻璃；路径不可用时不会画一条遮屏直线。
- `snapshot()`增加每席 `bubbleScreenClear`、`bubbleScreenRelocated`、`bubbleLeader` 和全局 `screenProtectionRects`，方便主线程独立验证；`replaceScreen()`成功后立即重新避让。
- 本子任务实际Chrome检查4种viewport/DPR：3840×2160/1、1920×1080/2、390×844/3、844×390/3；每种4视图×6状态24组，总96组。
- 96组检查：bubble不碰screen、不碰head、bubble互不重叠；up仍在头上；648段新引导线不碰screen。均零失败。自测不写后端、不写主线程QA脚本/截图目录。
- 已目视桌面绿区及手机竖屏排布；最终截图由主线程重新生成，用户视觉确认边界不变。

## 2026-10-03 像素QA结论：读回后端迁移，不修改播放器实现

严格360样本最初出现desk-01脸框外像素差异，包含静态椅腿。双方诊断确认Chrome频繁getImageData使默认Canvas从GPU迁至CPU，低alpha的destination-out遮挡在两种后端存在预乘alpha舍入差异。这不是实际身体动画或运行时角色缺陷；脸框没有放宽。

最终按主线程确认，仅测试实例预先使用 `canvas.getContext('2d',{willReadFrequently:true})`，随后初始化独立同一ConnectedSeatedPlayer并附加真实benchContext遮挡。撤回曾在播放器构造中添加的willReadFrequently设置，正式播放器保留原父构造和渲染实现；没有更改角色、五官、身体、时钟或遮挡几何。

主线程原测试脚本（由主线程完善读回方法，本子任务不编辑脚本）重新运行记录如下：

- 撤回播放器测试读回设置后，`node scripts/test_office_connected_v4_pixels.mjs`：**5 pass / 0 fail**，360样本脸框外变化0。
- 同一最终版本 `node scripts/test_office_connected_v4.mjs`：**31 pass / 0 fail**，包括原90文件hash、真实桌面4K、手机横竖屏、原character参数/URL、气泡/头部、六状态时钟、点击和后端状态不变。
- 仅气泡避屏为本次最终功能变更；正式播放器不含willReadFrequently设置。验收脚本、reference-v3、家具和角色素材均未由本子任务修改。

## 2026-10-03 最终子任务交接与停止编辑

主线程最新回报：浏览器 **31/31 pass**；像素 **6/6 pass**（包含384组）。主线程已目视桌面east-states图：气泡移至隔板上方，屏幕内容完整；phone portrait亦成功避屏。这些是主线程本轮验收结果，不替代最终用户视觉确认。

bubble-layout实现至此收尾；正式播放器没有willReadFrequently改动，原角色/家具/参考版本继续保持。此子任务停止编辑，不再扩改功能。后续screen collision assertion、功能稳定性/小单测、最终截图、交付文档与STATUS由主线程负责；本子任务不修改上述文件或覆盖主线程结果。


## 主线程最终验收补充

2026-10-03：新增屏幕碰撞、pan、reduce-motion断言后，真实浏览器最终35/35通过；新契约12/12通过；像素及384组测试6/6通过。最终依据见 `COMPANY_OFFICE_CONNECTED_V4_ACCEPTANCE.md` 与 `assets/company-office-connected-v4/qa/browser-qa.json`。此前31/31为中间轮次，不是最终计数。
