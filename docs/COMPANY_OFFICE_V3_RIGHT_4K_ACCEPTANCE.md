# 右向表情对位与 4K 渲染修正验收

## 本轮范围与执行

用户在本地预览指出右向动画错位，要求重做、整体4K级画面与清晰文字，并指定 `gpt-6.1-sol` 子代理。

- Newton：重做右向四套表情，统一脸部对位、头锚与裁剪范围，交付 `repair-v4-aligned`。
- Erdos：高DPI/4K真实画布、系统中文字体、屏幕空间注释、缩放和拖动适配。
- Galileo：严格保留布局的原生4K底图候选验证。返回图仍为1584×993，已标记拒绝接入。
- 主线程：资源集成、预览缓存修复、回归脚本、真实浏览器与原用户IAB检查。

没有远端部署、Git提交或生产人员数据更改；所有服务烟测均在原隔离预览数据目录内。

## 右向错位的根因与修正

旧版脸部动作源和固定身体来自不同生成/归一化过程；不同动作的眼鼻嘴基准不一致。此前只修睡觉嘴部alpha，没有统一五官在固定头部上的位置。移动整只猫或椅子并不能修复这个逐帧问题。

新包重新生成工作、休息、同步、出错四套12帧，共用同一右向底图与头部模板、同一切分与映射。标准图集仍为360×174、4列×3行、每格90×58。没有镜像、旋转或复制静帧凑动画。

最终配置（构建脚本完整采用manifest，不覆盖新锚点）：

- `poseAnchor: [112,174]`，`scale: 0.6`
- `headAnchor: [110,8]`
- `faceRect: [84,54,90,58]`
- `faceClipEllipse: [139,82,47,36]`
- 12fps、时钟60/36/60/12；原六业务状态映射不变。

实际 `DirectionalSeatedPlayer` + 原右向家具渲染48帧，主线程与角色子代理均检查真实合成图：

- 每动作12个不同的实际工位合成帧。
- 脸框外身体变化0；透明轮廓占位变化0；五官被椭圆裁断0。
- 休息12帧都明确闭眼张嘴，最小口腔仍有96个黑色像素。
- 旋涡眼固定在同一眼窝，桌沿和键盘不遮脸。

原正面表情文件、左向/背向、家具、白色实验室底图及16席布局保持不变；新右向外观仍留待用户确认，`humanApproved`没有擅自改为true。

## 真实 4K / high-DPI 渲染

不是放大截图，也不是把 `resolution` 字段写进配置后假定生效：Phaser采用明确的物理画布尺寸，CSS显示大小与物理尺寸分离，实际读取canvas和WebGL drawing buffer核验。

| 浏览器视窗 | DPR | 场景CSS尺寸 | 实际画布 / drawing buffer | 文字纹理倍率 |
|---|---:|---:|---:|---:|
| 1440×1000 | 1 | 1058×836 | 1058×836 | 1 |
| 1920×1080 | 2 | 1538×916 | **3840×2287** | 3 |
| 3840×2160 | 1 | 3394×1996 | **3840×2258** | 2 |
| 手机390×844 | 3 | 390×331.5 | 1170×995 | 3 |
| 手机844×390 | 3 | 844×280.796875 | 2532×842 | 3 |

- 去掉1500px大屏上限；大屏布局充分利用可用空间。
- UI、气泡、姓名、状态、房间和设备间文字采用清晰中文系统字体；文字独立按屏幕字号/DPR渲染，不随地图放大成像素字。
- 角色像素纹理仍按原像素风渲染，192×192合成坐标不变，不破坏原图。
- 注释在窄屏避让头部和其他气泡，必要时使用引导线。屏外标注隐藏但16个状态仍持续存在。
- 拖动与缩放变化最多30次/秒触发注释布局；不持续重建未改变的文字纹理。
- 原生触摸CSS位移先换算物理像素，避免DPR2/3时拖动距离缩小；不会与Phaser触摸指针重复处理。
- 极端DPR/大视窗有8192单轴、约8K像素数的分配上限；手机不强制分配桌面4K画布。

### 分辨率边界

**4K指实际画布、输出和文字层，并不等于所有源纹理都是原生4K。** 已批准地图原画仍为1584×993。一次内置图片增强请求要求4224×2648，实际仍返回1584×993，因此候选留在 `assets/company-office-reference-v3/background-4k-candidate/`，`doNotIntegrate:true`，没有插值放大后冒充原生4K，也未替换已确认地图。

## 本地预览缓存修复

根首页使用的是 `backend.app._INDEX_HTML_CACHE`，不是Jinja模板；此前仅启用Jinja自动加载仍会返回旧首页。仅在 `scripts/preview_company_office.py` 中：

- 每次读取首页都失效本地HTML缓存，以源文件mtime更新资源版本。
- 预览的WSGI外层覆盖immutable静态缓存，保证相对ES-module import和新资源刷新有效。
- Flask debug仍关闭，仍只绑定loopback及原隔离数据目录；生产后端文件没有因本修正而更改。

已刷新用户原IAB页面并切换红区，确认新右向坐姿和清晰文字实际出现，不只是单独测试截图。

## 验证结果

- Node：播放器28 + 运行时51 + 新渲染契约8 = **87/87**。
- 原真实Chrome功能回归：**44/44**；含六状态实际API烟测、演示不写后端、原状态恢复、资源替换回滚、三个旧场景。
- 新真实Chrome渲染/交互回归：**45/45**；含4K、DPR1/2/3、手机横竖屏、文字字号与纹理倍率、点击坐标、窗口resize、鼠标及CDP模拟原生触摸pan。
- 347项离线素材检查通过，0失败，2项原正面冻结alpha警告保留。
- 四方向×六状态×15时间点，360次实际Canvas2D采样，动态区域外变化0。
- 原地图回归通过；52个本轮保护文件SHA256及原布局JSON不变。
- 4K测试截图以真实device分辨率保存，不做后期放大。手机测试是浏览器模拟，不宣称真机验收。

可复现命令：

```sh
node scripts/build_office_v3_config.mjs
node --test scripts/test_office_v3_player.mjs scripts/test_office_v3_runtime.mjs scripts/test_office_v3_render_quality.mjs
node scripts/test_company_office.mjs
python scripts/audit_office_v3_assets.py
node scripts/test_office_v3_browser.mjs --allow-isolated-state-write
node scripts/test_office_v3_4k.mjs
node scripts/capture_office_v3_right.mjs
```

后两个浏览器套件建议顺序执行，避免4K截图拍到并行API烟测的临时状态。状态烟测在finally中恢复原state/detail。

## 交付证据

- `assets/company-office-reference-v3/repair-v4-qa/4k-browser-qa.json`
- `assets/company-office-reference-v3/repair-v4-qa/right-browser-composite-qa.json`
- `assets/company-office-reference-v3/repair-v4-qa/right-four-actions-12frames-4k.png`
- `assets/company-office-reference-v3/repair-v4-qa/desktop-4k-3840-dpr1-overview.png`
- `assets/company-office-reference-v3/repair-v4-qa/desktop-4k-3840-dpr1-west.png`
- `assets/company-office-reference-v3/repair-v4-qa/desktop-retina-1920-dpr2-west.png`
- `assets/company-office-reference-v3/integration-qa/browser-qa.json`
- `assets/company-office-reference-v3/character-right/repair-v4-aligned/qa/technical-report.json`
