# 连排工位 V4 · 新版交付与验收

日期：2026-10-03。用户要求参考金黄色木桌制作纵向／横向连续连排版本，修正显示器和键盘，原角色不变；指定使用 gpt-6.1-sol 子代理。

## 看新版

- 新候选：`http://127.0.0.1:19000/?scene=connected`
- 原工位：`http://127.0.0.1:19000/?scene=reference`（默认首页仍为原版本）
- 新旧页顶部均提供对比入口。只运行本机隔离预览，无远端部署、Git提交、生产状态写入。

## 实际变化

| 区域 | 连排家具 | 角色方向 | 数量 |
| --- | --- | --- | --- |
| 红区 | 一张纵向连续双面长桌，四组木桌板接缝相连、中央隔板贯通 | 左侧向右、右侧向左 | 4＋4＝8 |
| 绿区 | 一张横向连续双面长桌，四列木桌板相连、中央隔板贯通 | 上排正面向下、下排真正背面向上 | 4＋4＝8 |

每席一台显示器、一套实体键盘和鼠标；不沿用参考图中重复的屏幕／平板，不在键盘上绘屏幕内容。上排背屏只保留真实指示灯，正面屏幕内按六业务状态绘制文档、检索、执行、同步、休息、报错效果。竖桌的窄侧屏用克制的颜色与亮度变化，不强塞可读文字。

两张桌子分别独立用内置 image_gen 生成，不是旋转同一张图；人物、椅子、地板均未画入新家具。角色与原椅子由现有资源实时合成，旧独立小桌不再绘制。新增下身桌沿遮挡，脸部和头部不变。

横桌背坐角色的气泡会避开显示器玻璃和背壳，并在需要时用折线连接到头顶。气泡不能遮头、互相覆盖或遮住屏幕状态；手机也保持按屏幕像素计算的中文字号。

## 保留的内容

- 原四向橘猫、角色位置参数、脸框、图集、12fps、60／36／60／12时钟全部保留。
- 六业务状态映射不变，writing／researching／executing仍共用working表情。
- 固定身体，不增加打字手、行走或呼吸晃动。背面不伪造可见脸部。
- 红8＋绿8；座位ID、人员/AI角色、主工位desk-12、绑定接口、服务器和房间不变。
- 当前白色芯片测试间、测试道具和背景原样保留。
- 角色替换和屏幕替换接口继续使用连排合成；加载失败或无效配置不破坏当前资源。
- 默认只有主工位接入实际状态；其他未绑定工位如实标记。演示仅浏览器本地，不写入后台。

## 分辨率与素材边界

保留上一轮真实4K画布和系统中文字体。1920×1080／DPR2实测Canvas与WebGL drawing buffer均为 **3840×2287**。不是放大截图。

素材实际尺寸如实记录：纵向桌887×1774、横向桌1774×887；地图原画1584×993。这些源图**不是原生4K**，未插值放大冒充原生4K。运行时保留原PNG字节与透明度，通过visibleAlphaBounds进行等比布局；源图轻微低alpha毛边已记录。

## 验证结果

- 原播放器／运行时／渲染契约：**87/87通过**。
- 新连排配置、锚点、禁区、屏幕、气泡契约：**12/12通过**。
- 真实Chrome桌面、手机横竖屏：**35/35通过**；含16席、四向、实际Canvas/WebGL、字体、气泡头部和屏幕避让、点击、相机pan、旧版入口、后端零写入。
- 实际Canvas像素／屏幕／替换组合验收：**6/6通过**；含360个角色采样，脸部区域外变化0；16席×4向×6状态共384组；六类屏幕模式互异且不越玻璃或LED范围。
- **90个原版本、原角色、原表情、原地图相关文件SHA256不变**。
- 原地图回归、模块语法、首页2个内联脚本语法和git diff空白检查通过。
- Reduce-motion关闭屏幕闪烁，但不擅改用户确认的表情时钟。

像素采样使用同一ConnectedSeatedPlayer和真实家具遮挡，在独立willReadFrequently Canvas上读取，防止浏览器GPU→CPU readback切换造成抗锯齿差异；没有为测试改动正式播放器或放宽动态区域。

手机检查是浏览器模拟，非真机验收。技术检查与主线程目视检查已完成；**用户对新家具的视觉确认仍待定，humanApproved保持false。**

## 子代理分工

三个模块均使用用户指定的 **gpt-6.1-sol**：Poincare制作纵桌，Curie制作横桌并定向修正键盘朝向，Sagan实现原角色适配／连排运行时／气泡避屏。主线程负责路由、集成、浏览器与像素验收、原版保护检查。

## 文件与复现

运行时代码：`frontend/company-office/connected-v4/`。

素材与完整提示词：
- `assets/company-office-connected-v4/vertical/prompt.txt`
- `assets/company-office-connected-v4/vertical/connected-vertical-eight-seats.png`
- `assets/company-office-connected-v4/horizontal/prompt.txt`
- `assets/company-office-connected-v4/horizontal/desk-bank-horizontal.png`

实际合成截图：
- `assets/company-office-connected-v4/qa/desktop-4k-overview.png`
- `assets/company-office-connected-v4/qa/desktop-4k-west-states.png`
- `assets/company-office-connected-v4/qa/desktop-4k-east-states.png`
- `assets/company-office-connected-v4/qa/phone-portrait-east.png`
- `assets/company-office-connected-v4/qa/phone-landscape-east.png`

报告：`browser-qa.json`、`pixel-qa.json`、`contract-tests.log`、`protected-baseline.json`，均位于上述qa目录。

```sh
node --test scripts/test_office_v3_player.mjs scripts/test_office_v3_runtime.mjs scripts/test_office_v3_render_quality.mjs scripts/test_office_connected_v4_contract.mjs
node scripts/test_office_connected_v4.mjs
node scripts/test_office_connected_v4_pixels.mjs
node scripts/test_company_office.mjs
```

保留本轮首页备份于 `.local/company-office-backups/connected-v4/index.before.html`。不回退整个Git工作区，不覆盖其他未提交工作。
