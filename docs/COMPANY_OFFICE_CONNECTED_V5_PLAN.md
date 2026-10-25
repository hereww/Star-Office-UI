# 连排工位 V5：屏幕动画-only 开发计划与验收口径

日期：2026-10-05  
目标：在保留原角色、原表情、原家具方向和地图的前提下，让工作状态通过显示器的开发软件画面表现，不再实现角色敲键盘手部动画。

## 1. 不可变边界

1. 只支持 `up/down/left/right` 四个固定坐姿方向；不做行走模式。
2. `up` 是背坐；背面屏幕只能显示 LED，不显示正面代码。
3. 红区 8 席、绿区 8 席，共 16 个办公区工位；连排桌和工位方向保持当前方案。
4. 原角色底图、表情图集、身体、头部、尾巴、椅子与家具素材保持不变。
5. 当前唯一模式名为 `expression-plus-screen-effects`。
6. 所有玩家必须满足：

```js
handsRendered: false,
handsAction: 'none',
keyboardInteraction: false
```

7. 当前版本不得创建或依赖 `handsCanvas`、`handsCtx`、`working-hands.mjs` 或键盘坐标绑定。历史 typing prototype 只能放在 `assets/company-office-connected-v5/archive/typing-prototype/`。
8. 不把源桌面素材的放大尺寸称为原生 4K；4K 只指浏览器 drawing buffer／截图能力。

## 2. 屏幕效果设计

| 状态 | 屏幕内容 | 动画证据 |
| --- | --- | --- |
| `writing` | 代码编辑器 | 行号、语法 token、缩进、逐字输入、光标闪烁 |
| `researching` | 代码搜索／源码阅读 | 搜索栏、查询字符增长、搜索行高亮、源码窗口滚动 |
| `executing` | 编辑器 + 终端 | 终端输出逐步出现、滚动、命令和测试结果 |
| `syncing` | 同步模块 | 块状进度变化 |
| `error` | 错误提示 | 柔和双脉冲，不模拟键盘动作 |
| `idle` | 暗屏 | 静态，不产生无意义重绘 |

所有效果由 `screen-overlay.mjs` 根据 `state + elapsedMs + reducedMotion` 确定性采样，12fps 只作用于屏幕层。角色表情继续使用原有时钟，不因屏幕帧而漂移。

## 3. 数据与 manifest 计划

- 工位 manifest 的必需字段只包括工位锚点、方向、家具、屏幕 polygon／LED 等真实几何信息。
- `keyboardBounds`、`keyboardCenter` 是已移除的旧手部动画字段，不得成为校验必需项。
- 测试必须复制 manifest，删除所有键盘字段后再次加载 vertical／horizontal 两张连排桌，确认 16 个座位和 16 个屏幕仍成立。
- 屏幕 component 的 bounds 必须从原 polygon／LED 推导，禁止用大矩形放宽裁切。
- 角色、设备、服务器替换只能影响对应实例，不得改变其他席位的屏幕和表情时钟。

## 4. 分阶段执行

### 阶段 A：模式收敛

- 统一 `animationMode='expression-plus-screen-effects'`。
- 删除旧 hands／keyboard 测试入口，改为 screen-only player、station 和 pixel QA。
- 测试验证玩家没有 `handsCanvas`，snapshot 不再暴露手部／键盘元数据。

### 阶段 B：静态角色回归

- 四方向、六状态、12 个表情采样点与 V4 逐像素一致。
- 角色帧被冻结时，所有工作状态的角色像素保持不变；屏幕不写入玩家 canvas。
- `idle/syncing/error` 不添加任何手部或键盘交互副作用。

### 阶段 C：屏幕效果

- 验证工作屏幕的代码／搜索／终端真实 glyph，而不是只有颜色块或元数据。
- 验证 48 个 12fps 屏幕采样帧存在时间变化，并验证 cursor 的 true／false 闪烁。
- 背屏保持 LED-only，窄屏不绘制可读文字。
- 验证所有前屏像素位于独立 rasterized source polygon；LED 位于 source LED 矩形。

### 阶段 D：真实浏览器与替换回归

- Chromium 桌面 DPR2 drawing buffer 至少 3840×2160；中文字体加载且 text resolution ≥ 2。
- 手机竖屏／横屏不产生资源错误、水平溢出或后端写请求。
- 角色、设备／屏幕、服务器替换后，方向、表情时钟、屏幕动画和 screen-only contract 继续成立。
- 用无 `keyboardBounds`／无 `keyboardCenter` 的真实浏览器 manifest 响应重新加载两张桌子。

## 5. 测试入口与报告

```sh
PATH=/opt/homebrew/bin:$PATH node --test scripts/test_office_connected_v5_screen_only_player.mjs
PATH=/opt/homebrew/bin:$PATH node --test scripts/test_office_connected_v5_screen_only_stations.mjs
PATH=/opt/homebrew/bin:$PATH node scripts/test_office_connected_v5_screen.mjs
PATH=/opt/homebrew/bin:$PATH node scripts/test_office_connected_v5.mjs
PATH=/opt/homebrew/bin:$PATH node scripts/test_office_connected_v5_pixels.mjs
```

- 单测与专项报告：终端输出；screen test 为 18/18。
- 浏览器报告：`assets/company-office-connected-v5/qa/browser-qa.json`，当前 19/19。
- 严格像素报告：`assets/company-office-connected-v5/qa/pixel-qa.json`，当前 12/12。
- 新截图全部以 `screen-only-` 命名；`typing-detail` 和 `player-*-hands` 只作为历史文件保留，不得写入当前结果或文档结论。

## 6. 完成门槛

以下条件全部满足才算 V5 screen-effects-only 完成：

- [ ] 16 席、红 8／绿 8、四方向、无行走模式。
- [ ] `animationMode` 命名统一为 `expression-plus-screen-effects`。
- [ ] 所有玩家无 `handsCanvas`，并且 `handsRendered=false`、`handsAction='none'`、`keyboardInteraction=false`。
- [ ] 角色本体与 V4 逐像素一致；屏幕为独立外接层。
- [ ] 工作状态真实显示代码编辑、搜索、终端输出和光标／亮度变化。
- [ ] 背面 LED-only、窄屏无 glyph、polygon 无实心越界像素。
- [ ] 缺失 `keyboardBounds`／`keyboardCenter` 的 vertical／horizontal manifest 可加载。
- [ ] 4K/high-DPI、CJK 字体、手机竖横屏、无写请求和无资源错误通过。
- [ ] 角色／设备／服务器替换回归通过，V4、reference-v3 和历史素材保护通过。
- [ ] 新 screen-only 截图和 JSON 报告已生成；旧 typing-detail 截图未作为当前证据。
