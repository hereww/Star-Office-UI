# 正式办公室前端（API contract v1）

本目录只新增前端；不修改旧页面、V4 runtime、后端、共享脚本或动画素材。正式脚本采用原生 ES Modules + 项目自带 Phaser 3.80.1。无 React/Vite、CDN、旧状态轮询、浏览器凭据存储。

## Flask 模板与 Boot

- 员工模板：`frontend/office/index.html`，主线程映射 `/`。
- 管理模板：`frontend/office/admin.html`，主线程映射 `/admin`。
- 模板里的 `{{OFFICE_BOOT_JSON}}` 应由服务器替换为安全转义 JSON（至少转义 `<`、`>`、`&`，防止结束 script 标签）。页面赋值 `window.__OFFICE_BOOT__` 后启动。
- `mode` **只由 Boot** 决定，不根据 URL、查询参数或账号猜测。

```js
window.__OFFICE_BOOT__ = {
  mode: 'employee', // 管理入口为 'admin'
  release_prefix: '/static/releases/office-v1-dev',
  admin_url: '/admin',
  employee_url: '/',
  poll_interval_ms: 2000,
  preview_fixture: true // 仅隔离验收，显示明显的模拟数据标识；正式部署不要设置
};
```

`release_prefix` 是静态资源根目录，不是 `office/` 目录。全部自有脚本/CSS 从 `${release_prefix}/office/` 加载，模块内部相对导入保持同一 release。现有素材、V4 与 Phaser 分别从相邻 `company-office/`、`vendor/` 加载。不会请求 bare `/static` 或旧 assets/list。`admin_url` / `employee_url` 由主线程提供，前端不主动跳转、不推测域名；部署入口沿用主线程路由。快照固定每 2000ms 轮询，单请求最长 8 秒、不重叠；管理员明细每 10 秒读取本地管理接口，不访问 Sub2API。

只读员工 UI 在首个快照之前，仅为 `desk-09` 至 `desk-12` 四个相邻工位显示中性“等待数据”占位，其余 12 席为空；不保存前端账号 ID，不提交或迁移配置。有效绑定完全以公共 snapshot 的完整 16 席为准，服务端的窄授权范围不会被前端扩大。桌面详情宽 320px；900px 以下初始收起底部抽屉，点击工位展开，避免挡住地图。手机横屏使用右下浮动抽屉。桌面首次展示遵循 `details_collapsed`。

## 运行时桥接

`map-loader.mjs` 的 `createOfficeMap(host, boot, options)`：
1. 载入项目本地 Phaser、V4 `ConnectedOfficeRuntime`、`render-quality.mjs`。
2. `ConnectedOfficeRuntime.load(versionedAssetBase)`，调用 `prepareOfficeRendering()` 设置 physical backing；不使用 Scale.RESIZE。
3. Scene 调用 `runtime.preload(scene)`、`runtime.create(scene)`。
4. **create 后**构造 `new OfficeRuntimeAdapter(runtime, { mode: 'live'|'preview' })`（`connected-v4/telemetry-adapter.mjs`）。
5. Scene update 调用 `adapter.update(time, delta)`；销毁调用 `adapter.destroy()` 再释放 Phaser。

句柄接口：`applyTelemetrySnapshot(wire)`、`applyDisplaySettings(display)`、`selectStation(id,{focus})`、`setView(view)`、`setDemoState(state)`（仅 preview）、`dispose()`。选择通过现有 `office-runtime-change` 事件监听，不依赖旧 index 的内联 UI。员工快照先白名单化再重建 runtime wire，不把 API 响应对象直接送进地图。

管理员动画地图使用完全独立的 preview runtime，始终有“本地演示”标记。四向小窗复用 `DirectionalSeatedPlayer` 原素材，不变更正式座位坐标；六状态同时控制小窗与本地地图。配置草稿弹窗再使用独立 live adapter 展示绑定/别名/显示偏好，所有角色为未知静态状态，不把其他人的并发搬到新工位。关闭弹窗销毁实例。

## 配置、鉴权、隐私

- GET session 创建 CSRF；POST `{username,password}` 登录并取得轮换 CSRF；PUT/POST/DELETE 带 `X-CSRF-Token`；fetch 为 same-origin、no-store、redirect:error。
- 浏览器仅 HTTPS 管理入口可登录，本地隔离开发同样要求 TLS；服务器仍负责强哈希、安全 Cookie、限速和权限校验。
- 用户/Key IDs、Token total 仅接受字符串；保留空用户名；未知值保持 null。管理员明细和 codec 动态分离于员工模块，不提供示例身份。
- Config GET 解包 `{config,history}`，PUT 发 `{expected_version,config:{bindings,display,collection}}`。保存/恢复后 GET，必须版本和完整 config 内容一致才显示成功；409 不自动重试，保留草稿。
- 草稿修改后可直接保存；预览是可选的本页检查。同一用户/工位冲突、40 字别名、授权范围与配置值会本地校验，后端仍是唯一权威。
- 源失败/过期/并发 unavailable/untracked/null 一律未知，不假空闲。每席 observed_at 单独校验 freshness；统计由脱敏状态计算。
- V5 全屏由地图与只读 `fullscreen-hud` 组成：桌面 HUD 固定在右侧深色留白轨道，手机竖屏改为底部横向角色卡。每个已绑定角色仅显示现有头像、真实用户名、状态短语、当前模型、采样时刻对话并发与 `today_usage`（北京时间当日已入库 Token 总量）；Token 总量保持十进制字符串并按独立时间窗校验，缺失/过期显示“未知”，不会伪造为 0。HUD 无按钮，不会抢地图拖动或聚焦操作。
- 401/403 管理读取失败清除显示与内存中的身份详情。密码/CSRF 不写日志或 storage；所有外来文本均 textContent/text node。

## 主线程 QA 选择器

| 区域 | 选择器 |
|---|---|
| 地图画布 | `.map-host canvas` |
| 加载状态 | `.map-loading`（成功后 hidden） |
| 员工侧栏/底部抽屉 | `.employee-detail`, `#seat-detail` |
| 员工选择 | `.seat-pill`, `[aria-pressed=true]` |
| 员工统计 | `.count.bound`, `.count.working`, `.count.idle`, `.count.unknown` |
| 管理登录 | `input[name=username]`, `input[name=password]`, `.login-form` |
| 管理五页 | `[data-page=overview]`, `[data-page=bindings]`, `[data-page=demo]`, `[data-page=display]`, `[data-page=diagnostics]` |
| 草稿/保存/读回 | `[data-preview]`, `[data-save]`, `[data-read]`, `.save-state`, `.admin-notice` |
| 绑定表单 | `.binding-card select`, `.binding-card input[type=text]`，按 16 席顺序 |
| 本地演示 | `.demo-tag`, `[data-direction=up|down|left|right]`, `[data-state=idle|writing|researching|executing|syncing|error]`, `.character-preview canvas` |
| 管理详情/诊断 | `.admin-user-details`, `.diagnostics-panel`, `.history-panel` |

## 目录内测试与发布隔离

```sh
node frontend/office/.local/tests/unit.test.mjs # 也可 node --test <同一路径>
node frontend/office/.local/tests/browser.mjs
```

浏览器测试用 `createRequire('/Users/hepingyu/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json')` 读取现有 playwright，`channel:'chrome'`，不安装依赖/浏览器。测试在 Chrome request routing 中提供合成数据和现有本地素材，不启动服务器、不触碰生产。主线程另行负责真实 Flask 路由/会话/缓存/证书联调。

所有 tests/fixtures/截图/报告均在 `.local/tests/`，正式依赖树无引用。现有版本路由拒绝 `.local`；部署打包仍应按 `release-manifest.json` 显式名单打包，完全排除 `.local`。不要把该目录全文复制到公开静态包。

## 已验证 / 尚需集成验证

已验证：单元测试与 Chrome 合成接口 QA，DPR2 实际 backing、桌面/平板/手机、真实 V4 资产加载、五页操作、草稿预览/保存读回、恢复、冲突、异常恢复、明细清除、四向六状态。截图和浏览器报告位于 `.local/tests/artifacts/`。

尚需主线程：真实 Flask API session/config/CSRF 及数据库持久化；实际管理员凭据及用户1单用户采集；HTTPS 证书信任、部署缓存策略、多浏览器连续运行与生产回滚。前端子任务不访问生产，也不声称本地合成数据证明已部署。

### 稳定 data-testid（主线程 E2E 推荐）

- 共用：`office-app`、`office-map`、`isolation-fixture-banner`（仅 `preview_fixture:true`）。
- 员工：`source-status`、`last-sample`、`employee-notice`、`stats-bound|busy|idle|unknown`、`details-toggle`、`seat-details`、`focus-seat`、`seat-desk-01` 至 `seat-desk-16`、`view-overview|west|east|workstation`。
- 登录：`admin-username`、`admin-password`、`admin-login`、`admin-logout`。HTTP 不渲染登录表单，不发送管理 session 请求。
- 五页：`nav-overview|bindings|demo|display|diagnostics`。
- 绑定：`binding-user-desk-12`、`binding-alias-desk-12`、`binding-enabled-desk-12`（其余工位同规则）。
- 配置：`config-preview`、`config-save`、`config-read`、`config-save-state`；弹窗 `config-dialog`、`draft-preview-ack`、`dialog-confirm`、`dialog-cancel`；历史恢复 `config-restore-<version>`。
- 遥测/诊断：`admin-telemetry`、`source-diagnostics`、`collection-interval`。
- 动画：`local-demo-marker`、`demo-direction-up|down|left|right`、`demo-state-idle|writing|researching|executing|syncing|error`。

地图公开选择/渲染生命周期继续通过既有 `office-runtime-change` / `office-runtime-ready` 事件与 adapter 方法接入，不额外设置带私人遥测的全局调试对象。草稿预览内第二个 `office-map` 请在 `config-dialog` 范围内定位，避免和正式图混淆。

### 管理字段质量 / 观测时间定向修复

用户名与邮箱质量均取插件字段组 `quality.identity`；Key、Token、并发分别取其自身字段组。显示为“可信（fresh）/不可用（unavailable）/未跟踪（untracked）/过期（stale）”，未知 code 仅显示“未知（原 code）”，不根据字段是否有值猜测鲜度。

`admin-last-observed` 明确表示 **并发观测 · 北京时间**，仅使用 `observed_at.concurrency`；null、缺失或无效 timestamp 显示“未知”，不回退到 identity/api_keys/token_usage 的时间。该只读节点提供 `data-observed-field="concurrency"` 与有效时的 `data-observed-at` 原 timestamp。

质量只读节点：`admin-quality-username`、`admin-quality-email`、`admin-quality-api_keys`、`admin-quality-token_usage`、`admin-quality-concurrency`。`data-quality-source` 标明字段组（前两个均为 identity），`data-quality-code` 保留原 code；null 时不伪造 code 属性。

定向测试：`.local/tests/admin-metadata.test.mjs`，包含四种质量、未知 code、identity 共享映射、独立并发时间、北京时间转换、null 与空用户名语义以及实际 DOM 节点 hooks。此修复不重复全量浏览器异常矩阵。

### 保存 / 恢复响应不确定性

PUT 保存或 POST 恢复遇到网络失败、超时或无法解析成功响应时，服务器可能已经提交。前端显示“保存或恢复结果未确认，请先重新读取服务端版本，不要重复提交”，不承诺状态未改变、不自动重复提交。401/403/409 的原有特定提示仍保留；成功响应后仍需 GET 比对保存版本与完整内容。定向测试位于 `.local/tests/transport-accuracy.test.mjs`。

### 手机聚焦工位定向修复

在 ≤900px 视口点击 `focus-seat`（“聚焦这个工位”）时，先收起 `seat-details` 抽屉并把焦点交回 `details-toggle`（不滚动），再调用原运行时聚焦接口。桌面仍保留 320px 侧栏；地图锚点、角色比例和遥测更新视角行为不变。再次点击 `details-toggle` 可显式展开详情。

定向 Chrome 测试（不连接服务器、不重复全量异常矩阵）：

```sh
node frontend/office/.local/tests/mobile-focus.mjs
```

该测试使用 390×844/DPR3 手机竖屏与真实本地 V4 运行时，检查收起发生在聚焦之前、角色头部/工位中心可见、后续快照轮询不重新展开、可手动重开详情以及桌面侧栏行为。报告与修复前后截图保留在本目录 `.local/tests/artifacts/mobile-focus-*`，不参与公开发布。

### 2026-10-04 四用户姓名 / 工作数量公共适配

以共享契约末尾的四用户扩展为准。公共 station 新增且仅新增 `username: string|null`、`identity_quality`、`identity_observed_at`。员工 `codec → model → toRuntimeSnapshot → map-loader.runtimeEnvelope → adapter` 均通过白名单投影，保留 config version、generated_at、display 设置；邮箱、账号 ID、Key 元数据、Token、授权范围及任意 source/display 附加字段不进入员工投影或地图。老 schema_version=1 无身份字段仍能读取，显示“用户名未知”。

- 非空新鲜用户名单独显示，与工位 alias 并存；不从 email / ID / alias 推导姓名。
- fresh 空字符串或空白字符串仍为原字符串，文字显示“用户名未设置”；无数据/不可用/过期为 null，文字显示“用户名未知”。外来字符串只作为文本渲染，显示时移除控制字符，不渲染 HTML。
- 气泡与姓名/数量详情统一为单行 **用户名：X**，包含 X=0；无可信并发使用 **用户名：—**，不伪造零；不显示账号号、工位号、状态句或单位。技术 activity/动画仍为 busy/writing、idle/idle、unknown/neutral；统计标题保持处理中/待命/未知，管理并发字段仍可用技术标题。
- source error 或本地 GET 失败立即清空公共缓存中的用户名/并发；身份和并发分别按各自观测时间检查 3×poll_interval 鲜度。
- 员工本地 1 秒 freshness timer 比较整个安全视图变化，不再仅比较 sourceOK，因此源仍正常时也会刷新单席过期身份/并发。地图边界在调用 adapter 前再次按当前时间剔除过期姓名；最终逐帧清理与紧凑单行动态气泡布局由遥测适配器完成；气泡横向中心固定在自己的角色头部，仅可在附近上下错开。

新增只读 hooks：`employee-display-name`（alias）、`employee-username`（带 `data-identity-quality`）、`employee-work-count`（精确数字/未知占位）。已有 `seat-desk-09`…`seat-desk-12`、`stats-*`、手机抽屉/聚焦 hooks 不变。

目录内定向验证：

```sh
node --test frontend/office/.local/tests/four-user-identity.test.mjs frontend/office/.local/tests/unit.test.mjs frontend/office/.local/tests/admin-metadata.test.mjs frontend/office/.local/tests/transport-accuracy.test.mjs
node frontend/office/.local/tests/four-user-browser.mjs
node frontend/office/.local/tests/mobile-focus.mjs
```

合成四人 fixtures 只在 `.local/tests/four-user-fixtures.mjs`；不会加入 release manifest 或被生产 bundle 引用。Chrome 用本地 route fulfillment 提供合成响应与现有素材，没有启动服务、连接生产或重做主线程完整矩阵。四用户浏览器测试记录送入真实 adapter 的匿名 envelope，覆盖四席/12空席、姓名与alias并存、0/未知工作数、空/null/过期、源异常/读取失败、保持镜头与角色时钟、手机减少动态与抽屉回归。独立鲜度检查扣住下次 HTTP 响应，验证 sourceOK 仍 true 时本地计时器触发更新。

运行时气泡源码不在本目录写集。主线程整合新版 runtime 后仍需执行它负责的整链路双行气泡/动态效果/发布验收；本目录测试不冒充该验收。

本轮最后一次定向复跑已读取共享目录里到位的新版 adapter，四席双行气泡全文（含 0 与未知）逐项断言通过；桌面与手机 reduced-motion 截图已复核。这只证明本地合成响应 + 当前前端/运行时协作，不代替主线程 collector/授权/部署验收。


### 2026-10-22 角色状态栏当前模型

全屏角色卡及选中工位详情新增“当前模型”。数据使用 Sub2API `active_models` 的当前转发请求；采集器和员工快照分别白名单投影 `requested_model`、`upstream_model`、`requests`，不读取历史用量来推断模型。公共请求数为十进制字符串，多个模型逐行显示，映射不同则显示“请求模型 → 上游模型”，同模型多个请求显示“× 数量”。

模型观测时间独立于身份、并发和采集时间，达到 3×采集间隔即清空模型并显示“已过期”；源失败立即显示“未知”。旧数据源未返回模型字段时仍正常显示其他状态。“暂无活跃模型”仅在模型列表确实为空且可信并发为 0 时显示；有并发但暂未采到模型时显示“暂未识别”。上游 `partial` 保留在 `data-quality` 和提示说明中，表示当前观测只覆盖部分请求链路。

只读节点：`hud-models`、`employee-models`。模型名称通过文本节点显示，长名称换行，手机竖屏的角色栏留出对应高度；地图气泡与动画接口保持原有内容。新增模块 `active-models.mjs` 纳入本地发布清单和实际依赖闭包。

验证：`node --test scripts/test_office_active_models.mjs` 与 `python -m unittest scripts.test_office_active_models`。
