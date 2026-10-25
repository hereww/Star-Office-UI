# 连排工位 V5：屏幕动画-only 实现验收记录

日期：2026-10-05  
版本路由：`/?scene=connected-v5`  
范围：本地浏览器预览；不写后端、不改生产状态。

## 1. 当前实现口径

- `animationMode='expression-plus-screen-effects'` 是唯一 V5 运行时命名。
- 角色沿用原 `reference-v3` 的固定坐姿、四方向和表情时序；角色本体不做键盘动作。
- `handsCanvas`、`handsCtx`、`handsRendered` 的手部绘制实现不属于当前 V5。`working-hands.mjs` 已归档至 `assets/company-office-connected-v5/archive/typing-prototype/`，当前前端路径不再存在。
- 玩家状态固定满足：`handsRendered=false`、`handsAction='none'`、`keyboardInteraction=false`。
- 工位只提供静态家具与外接屏幕层；家具 manifest 不要求 `keyboardBounds` 或 `keyboardCenter`。
- 红区 8 席、绿区 8 席，共 16 席；不启用行走模式；支持 `up/down/left/right` 固定坐姿，其中 `up` 是背坐。

## 2. 屏幕动画契约

屏幕层由 `connected-v5/screen-overlay.mjs` 独立采样，角色帧和屏幕帧互不串扰：

- `writing`：深色代码编辑器、真实行号、语法 token、缩进、逐字符输入进度和光标闪烁。
- `researching`：代码搜索栏、搜索查询、搜索行高亮、连续源码阅读窗口和光标变化。
- `executing`：源码窗口、终端输出、测试结果／构建输出和终端光标。
- `syncing`：模块块状进度。
- `error`：柔和双脉冲错误提示。
- `idle`：暗屏静态状态。
- 背面屏：只显示 LED；窄侧屏不绘制可读 glyph。
- 所有前向内容在真实 source manifest polygon 内裁切；LED 使用独立 source LED 矩形。
- `prefers-reduced-motion` 下屏幕仍保留静态语义，但不推进闪烁、滚动和进度。

## 3. 替换与兼容

- 角色替换：保留方向、pose anchor、表情时钟和固定身体，不增加手部层。
- 设备／屏幕替换：重新建立对应的 polygon 或 LED 外接层，替换后继续执行屏幕动画。
- 服务器替换：只替换服务器资源；16 个工位的角色与屏幕状态不串联。
- manifest 回归：删除两种桌面 manifest 中所有 `keyboardBounds`／`keyboardCenter` 后，仍能加载 16 席、16 块屏幕并通过六状态采样。
- `connected-v4`、`reference-v3`、历史批准素材和 V4 源码树保持回归保护。

## 4. 当前验收命令

```sh
PATH=/opt/homebrew/bin:$PATH node --test scripts/test_office_connected_v5_screen_only_player.mjs
PATH=/opt/homebrew/bin:$PATH node --test scripts/test_office_connected_v5_screen_only_stations.mjs
PATH=/opt/homebrew/bin:$PATH node scripts/test_office_connected_v5_screen.mjs
PATH=/opt/homebrew/bin:$PATH node scripts/test_office_connected_v5.mjs
PATH=/opt/homebrew/bin:$PATH node scripts/test_office_connected_v5_pixels.mjs
PATH=/opt/homebrew/bin:$PATH node scripts/test_office_connected_v4_contract.mjs
PATH=/opt/homebrew/bin:$PATH node scripts/test_office_v3_player.mjs
PATH=/opt/homebrew/bin:$PATH node scripts/test_office_v3_runtime.mjs
git diff --check
```

旧的 `test_office_connected_v5_hands.mjs`、`test_office_connected_v5_keyboard.mjs` 已删除，避免测试入口残留旧手部／键盘口径。

## 5. 最新结果

- screen-only 玩家／工位单测：**16/16**。
- 屏幕代码／搜索／终端专项单测：**18/18**。
- V5 浏览器验收：**19/19**。
  - 桌面、手机竖屏、手机横屏；
  - 16 席、四方向、无行走；
  - 无 `handsCanvas`、无键盘交互；
  - 4K/high-DPI、中文字体加载、无页面／资源／写请求错误；
  - 代码／搜索／终端屏幕、背面 LED-only、四向角色／设备／服务器替换；
  - 删除键盘标注后的真实 Chromium 加载回归。
- screen-only 严格像素 QA：**12/12**。
  - 384 个方向／工位／状态组合；4608 个角色采样；角色像素与 V4 完全一致；
  - 192 个工作屏幕循环；屏幕变化不改变角色像素；
  - 16 块屏幕 × 6 状态 × 48 次屏幕采样；polygon／LED 裁切和状态动画通过；
  - 屏幕工作画面包含实际 Canvas 行号、代码 token、搜索栏和终端 glyph；
  - 4K 截图为 3840×2160；源桌面图不宣称为原生 4K。
- 新屏幕专项单测：**18/18**，其中真实 Chromium 屏幕 raster 证据覆盖 48 帧／状态、光标闪烁、语法颜色、代码行号、搜索查询、终端输出和 polygon 裁切。

## 6. 当前 QA 证据

当前验收截图统一使用 `screen-only-` 前缀：

- `assets/company-office-connected-v5/qa/screen-only-desktop-4k-states.png`
- `assets/company-office-connected-v5/qa/screen-only-desktop-4k-overview.png`
- `assets/company-office-connected-v5/qa/screen-only-right-workstation.png`
- `assets/company-office-connected-v5/qa/screen-only-left-workstation.png`
- `assets/company-office-connected-v5/qa/screen-only-down-workstation.png`
- `assets/company-office-connected-v5/qa/screen-only-up-workstation.png`
- `assets/company-office-connected-v5/qa/screen-only-phone-portrait-states.png`
- `assets/company-office-connected-v5/qa/screen-only-phone-landscape-states.png`
- `assets/company-office-connected-v5/qa/screen-only-pixel-4k.png`

`typing-detail-*.png`、`player-*-hands.png` 等历史打字手部截图不属于本次验收结果，不能作为当前版本证据。

报告：

- `assets/company-office-connected-v5/qa/browser-qa.json`
- `assets/company-office-connected-v5/qa/pixel-qa.json`

## 7. 本地预览

```sh
.local/office-production-20261004/venv/bin/python \
  scripts/preview_company_office.py \
  --port 19000 \
  --data-dir .local/office-connected-v5-preview
```

打开：`http://127.0.0.1:19000/?scene=connected-v5`
