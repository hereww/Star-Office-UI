# 动画逻辑与新增像素角色接入指南

> 基于当前工作副本代码的静态梳理；这是开发导航，不代表已经接入 `hatch-pet` 或 HyperFrames。路径均相对于仓库根目录。运行时服务器上的资源/版本可能与本地不同。

## 1. 先确定你在改哪一个画面

| 画面 | 当前入口 | 动画引擎/资源 | 注意 |
| --- | --- | --- | --- |
| 浏览器办公室 `/` | `backend/app.py` 的 `index()` → `frontend/index.html` | 内联 Phaser 3.80.1 场景 (`preload/create/update`) + 少量 DOM/CSS 动效 | **主要开发入口**；没有引用 `frontend/game.js` 或 `frontend/layout.js`。 |
| Electron 独立窗口 `/electron-standalone` | `backend/app.py` → `frontend/electron-standalone.html` | 另一份内联 Phaser 页面 | 后端只在文件缺失时从 `index.html` 复制；已有文件不会自动同步。改网页动画不等于改 Electron 动画。 |
| 桌宠主窗口 | `desktop-pet/src/index.html` | 独立 Phaser、程序绘制角色纹理、网格/POI 寻路 | 与办公室不是同一套 spritesheet；通过 Tauri `read_state` 读取状态。 |
| 桌宠最小化窗口 | `desktop-pet/src/minimized.html` | Canvas 2D 按网格抽帧 + `requestAnimationFrame` | 复用办公室图片路径，但有独立的帧规格、帧范围、缩放和状态映射；轮询本机 `/status`。 |
| 旧版/旁路代码 | `frontend/game.js`、`frontend/layout.js`、`electron-shell/standalone-assets/` | 有另一套素材名和帧尺寸 | **不要仅修改这里并期待浏览器办公室生效**；先核对具体打包/页面引用。 |

浏览器办公室的 Phaser 配置在 `frontend/index.html` 的 `config`：1280×720、`pixelArt: true`；桌面 FIT、触屏 RESIZE 并调整摄像机。静态文件由后端 `/static/...` 提供；图片 URL 带版本参数（`{{VERSION_TIMESTAMP}}`）。

## 2. 状态 → 动画的数据流

```text
外部状态写入 / 用户测试按钮 POST /set_state
           ↓
backend/app.py: state.json → GET /status
  （仅 writing/researching/executing 过期时，load_state 按 ttl_seconds 自动回 idle；默认 300 秒）
           ↓  浏览器 update() 每约 1000ms 触发 fetchStatus()
normalizeState() → currentState → applyVisualState()
           ↓                    ↓
角色/机房/同步/报错精灵可见性与播放      气泡文字/打字机状态栏
```

后端 `VALID_AGENT_STATES` 为 `idle / writing / researching / executing / syncing / error`；`/set_state` 只接受这些**标准值**。前端兼容别名：`working→writing`、`run|running→executing`、`sync→syncing`、`research→researching`；后端 `normalize_agent_state()` 对访客推送的别名更多。`state.detail` 只影响状态文案，不直接选帧。

| 标准状态 | 浏览器主角/特效 | 机房 | 位置/路径现状 |
| --- | --- | --- | --- |
| `idle` | `star_idle` 可见、循环；工作角色隐藏；同步图首帧；报错虫隐藏 | 固定第 0 帧 | 主角固定沙发中心 `(798,272)`。 |
| `writing` / `researching` / `executing` | 沙发主角隐藏；工位 `star_working` 可见、循环 | `serverroom_on` 循环 | 工作精灵固定 `(217,343)`；三种业务状态**目前共用工作动画**。 |
| `syncing` | 两个主角精灵均隐藏；`sync_anim` 从第 1 帧循环（可播放帧不足则首帧） | 循环 | 同步精灵固定 `(1157,592)`。 |
| `error` | 两个主角精灵均隐藏；`error_bug` 在 `(1007,221)` 循环 | 循环 | 代码注释仍提两点往返，但 `update()` 实际固定虫的位置。 |

切换主要靠 `applyVisualState()` 直接设置可见性/播放，不是完整的“先走到工位再切换”状态机。`pendingDesiredState` 目前仅初始化/清零、未看到被赋为具体状态，`waypoints` 未见构建；`moveStar()` 留有移动计算，但大多数非 idle 状态下 `star` 已隐藏。**以后要做走路过场，须先补状态过渡与路径分配，不能仅上传走路帧。** `/status` 每次成功轮询都会重调视觉同步；`update()` 还对机房、同步、报错动画做逐帧兜底。

## 3. 当前资源契约（以实际加载代码和本地图片尺寸为准）

`frontend/index.html` 的 `preload()` 决定“图片文件 → 纹理 key/帧宽高”，`create()` 决定“纹理 → 动画 key/帧范围/FPS/精灵位置和 depth”；两个位置都要检查。下表总帧格数只表示图片可按该尺寸切出的格数，**不是**所有格子都会播放。

| 资源 → 纹理 key | 图片尺寸；单帧；格数 | `create()` 中播放范围/速率 | 用途 |
| --- | --- | --- | --- |
| `star-idle-v5.png` → `star_idle` | 2048×1536；256×256；8×6=48 | 动态取 `frameTotal`，12 fps 循环 | 沙发主角；与沙发同中心锚点。 |
| `star-working-spritesheet-grid.webp` → `star_working` | 2400×1500；300×300；8×5=40 | **0..37**，12 fps 循环 | 工位主角，scale 0.9、depth 900；桌子 depth 1001 遮挡。 |
| `sync-animation-v3-grid.webp` → `sync_anim` | 1792×1792；256×256；7×7=49 | 按 `frameTotal` 计算，从 **1** 开始、12 fps；非同步固定 0 | 独立同步装饰，不是主角贴图。 |
| `error-bug-spritesheet-grid.webp` → `error_bug` | 1760×1980；220×220；8×9=72 | **0..71**，12 fps 循环 | 报错虫精灵（不是主角 error 动作）。 |
| `serverroom-spritesheet.webp` → `serverroom` | 7200×251；180×251；40×1 | 动态取帧，6 fps；idle 首帧 | 非 idle 机房灯效。 |
| `coffee-machine-v3-grid.webp` → `coffee_machine` | 2760×1840；230×230；12×8=96 | 动态取帧，12.5 fps 常驻 | 背景循环。 |
| `guest_anim_1..6.webp` → 同名纹理 | 每张 128×64；32×32；4×2=8 | `guest_anim_i_idle` 0..7，8 fps | 访客循环；非 demo 约放大 4 倍、底部锚点。 |
| `flowers-bloom-v2.webp` → `flowers` | 512×512；**当前加载时为 65×65**；整除截取最多 7×7 格 | 不是循环动画；当前只随机选 0..15，点击换格子 | 单个花盆的外观变体；需优先处理尺寸不匹配。 |
| `plants/posters/cats-spritesheet.webp` | 160×160 单格 | 随机一格，点击换格子 | 皮肤/摆件集合，**不是时间序列动画**。 |

图片尺寸用本机 `sips` 读取，以上五类角色图片的容器均报告有 alpha 通道，但**有通道不代表每格背景确实透明**。新增素材应抽样检查角点、边缘和运动帧的像素 alpha。`frontend/index.html` 的花朵备注和资源缩略图提示仍有 128×128 的说法，实际加载是 65×65；这张 512×512 图片不能无余量地切成 4×4 个 65×65 格。不要照注释盲改资源。

## 4. 访客与桌宠是独立的动画消费者

- 浏览器 `fetchGuestAgents()` 每约 3500ms 拉 `/agents`；`renderGuestAgentsInScene()` 按 agentId 维护角色、名字、气泡，优先 `guest_anim_i`，无效时静态头像/星星兜底。一般访客位置固定以避免轮询抖动；`?demo=1` 模式随机点位、2–3 秒 Phaser tween 平滑移动、逐帧跟随气泡。新增访客动作要同时考虑 `agent.state/area`、`GUEST_AVATARS`、动画注册和离场销毁。demo 特殊分支用纹理 key `guest_anim_1` 调用 `anims.play()`，而 `create()` 注册的是 `guest_anim_1_idle`：这是需要回归验证的潜在不一致。
- 桌宠主窗口在 `desktop-pet/src/index.html` 由 `map` 的 POI/网格和 `SPEED * dt / 1000` 决定行走，方向决定 `move_up/down/left/right`，抵达后播状态动作，idle 可能随机走动；`buildCharAnims()` 用程序生成的 `cf*/cb*/cl*/cr*` 纹理组合动画。该目录 `STATE_API.md` 的状态/路径描述不能代替当前代码和 Tauri 命令的核对。
- 最小化桌宠 `desktop-pet/src/minimized.html` 读取 `/status`（2 秒），把 writing/researching/executing 归并为 `working`；映射到办公室的 idle/working/sync/error 四张图，以图片宽度除以单帧宽度计算列数、Canvas 裁切逐帧播放。因此主页面资源换名、换帧尺寸、改变动画起止位置时必须同步这里。

## 5. 素材替换和新动画的推荐开发顺序

1. **明确目标：** 是替换现有角色/状态，新增业务状态，增加走路过场，还是制作像素化/马赛克溶解转场？这四项的代码改动范围不同；不要把“像素角色动画”与“画面像素化效果”混为一谈。
2. **生产资产：** 参考本机 `hatch-pet` Skill 从同一个角色源制作连续状态帧和 QA 接触表；需要注册为 Codex 宠物时才走宠物注册流程。`hatch-pet` v2 是 **8×11、单格 192×208** 的宠物 atlas，**与本项目 256/300/220/32 等格尺寸和状态语义不兼容**，不能把整张图直接覆盖任一现有资源。先按状态抽帧、选帧并确定性重排，或新增一套明示行/列/帧范围的项目纹理适配器；保留原版作为对照。生成一整张大图不等于逐帧一致性 QA。
3. **列出动画元数据：** `asset path`、单帧宽高、网格排列、有效帧范围、fps、循环与否、原点（脚底/中心）、缩放、depth、所属业务状态、播放端（网页/Electron/桌宠）、移动路径/结束处理。新增动作尽量把这些定义集中，避免继续散落魔法数字。
4. **接入浏览器：** `preload()` 加纹理 → `create()` 注册独立的动画 key/精灵 → `applyVisualState()` 管状态切换 → `update()` 只保留逐帧运动/守卫；新增状态要同步 `STATES`、后端 `VALID_AGENT_STATES`/`normalize_agent_state`、状态发送方和最小化窗口映射。如果只是换图片不改框架，也要核对帧规格和渲染锚点。
5. **处理复用：** Electron 是独立页面，最小化窗口是独立播放器，Tauri 主窗口是另一角色管线；决定共享图片或共享状态映射，再显式同步，别假设单处修改自动传递。HyperFrames 更适合**额外的视频/可 seek 时间轴场景**（路径、转场、镜头），当前实时办公室仍由 Phaser 驱动，暂不需要为此替换引擎。
6. **验收：** 先离线核对每张图宽高可整除单帧、真实 alpha、帧数/空白格、帧顺序和锚点稳定；再在浏览器切换六种状态（包括异常状态和回 idle）、观察缩放/遮挡/气泡/移动端；必要时分别打开 Electron 与桌宠两个窗口。`scripts/smoke_test.py` 只覆盖 HTTP/状态 API，不验证逐帧视觉效果。

资产抽帧还可参考 `gif_to_spritesheet.py`、`webp_to_spritesheet.py`；网页素材编辑器在 `frontend/index.html` 的 `commitAssetUpdate()` 调 `/assets/upload`，后台在 `backend/app.py` 转换 GIF/WebP 并备份目标。**上传逻辑不校验新图必须符合 `preload()` 的帧大小/帧数量**，动图默认保留原单帧尺寸，静态图自动切格时还会传 64×64；所以应先离线预检、备份和预览，再提交替换，不能把上传成功当成动画兼容。若调试 HTML/JS，留意 `backend/app.py` 缓存首页 HTML：改源码后需按开发环境的重启/缓存策略刷新，不能只看浏览器刷新。

## 6. 素材源、QA 和归档边界（2026-10-30）

当前运行图片位于 `frontend/`，`assets/` 保存生成源、manifest、归一化输入和 QA 证据。正式 Office 发布使用 `scripts/package_office_release.py` 的依赖闭包，不按 `assets/` 目录整体发布。需要重建时，使用 `assets/rock-room-band-v1/source/`、`assets/company-office-floorplan-v2/` 等源目录和对应脚本；不要把 QA 截图或旧 preview 当作运行时图片。

旧预览、QA、拒绝候选和 V3 历史候选已建立外部快照：

```text
/Users/hepingyu/Documents/ChatGPT/Star-Office-UI-archive-20261030/assets-deprecated-20261030/
```

快照是可恢复副本，不是删除记录；源文件仍在工作区。恢复任何文件前，先读取快照根目录的 `archive-manifest.json`，按 SHA-256 校验后再复制回工作区。当前修改中的 V5/V3/rock-room QA 保留在原路径，避免归档动作覆盖未提交工作。

## 7. 下一次开发可以直接定位的函数

- 浏览器：`frontend/index.html` → `STATES` / `normalizeState` / `preload` / `create` / `applyVisualState` / `fetchStatus` / `update` / `moveStar` / `renderGuestAgentsInScene` / `commitAssetUpdate`。
- 后端：`backend/app.py` → `load_state` / `get_status` / `set_state_endpoint` / `normalize_agent_state` / `assets_upload`。
- 桌宠：`desktop-pet/src/index.html` → `fetchState` / `updateScene` / `buildCharAnims`；`desktop-pet/src/minimized.html` → `normalizeState` / `resolveFrameRangeByState` / `loadSpriteByState` / `drawFrame`。

**推荐第一个小改动：** 先做一张现有角色的“独立新动作”样例，按元数据明确目标画面、帧范围、透明度/锚点和状态映射；预览通过后再讨论统一的动画注册/资源 manifest，避免先大面积改造四个播放器。
