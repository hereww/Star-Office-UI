# 公司办公室 v3 本地开发与验收

验收日期：2026-10-03（本地时间，Asia/Shanghai）。仅本地开发与隔离预览，不包含远端部署或 Git 提交。

## 已落地的范围

- 办公区总计 **16 席＝红区8＋绿区8**。红区双面4＋4，每侧3同事＋1AI；绿区两排4＋4。角色槽位合计12同事＋4AI，不包含背景里经理室／会议室椅子。
- 采用当前白色芯片测试间地图。测试道具保留；蓝区摇滚房；左侧自上至下茶水间／杂物室／较大的会议室／设备间。额外靠会议室墙的一排仅预留，不加入16席。
- 单独的四向家具、坐姿底图与脸图。真正朝上背向没有五官。没有镜像或旋转正面凑方向，没有行走、身体呼吸摇晃或敲键盘手部动画。
- **原正面底图＋四套表情图与冻结模板 SHA256 完全一致**。原映射、12帧／12fps不变：working、syncing时钟60；idle时钟36；error时钟12。writing／researching／executing继续共用working表情。
- 16席分别有持久的头顶气泡、状态、详情、名称、绑定和播放时钟。气泡背景＋尾巴距头顶至少3逻辑像素；全图精简显示，聚焦／分区显示名称和状态。
- 显示器／键盘随家具方向正确分层。屏幕是裁剪后的局部效果：休眠暗屏、写作文档光标、研究扫描、执行终端行、同步进度块、异常柔和双脉冲。显示器背壳只亮LED，不透屏。
- 设备间服务器是独立 RGBA 资产；角色替换不换家具。运行时提供 `replaceCharacter`／`replaceServer`，坏资源不会部分替换成功。
- 控制面板可选择16席、四向坐姿、四种视图、六种本地演示状态和返回实际状态。支持键盘操作、44px触控目标、手机竖／横屏、减少动态效果偏好。

## 子代理分工与集成

| 模块 | 分工 | 交付 |
|---|---|---|
| 左向角色 | Harvey | left repair-v2，固定身体／轮廓＋四套脸图；睡觉嘴部保留检查 |
| 右向角色 | Einstein | right repair-v3-idle-mouth，只修复睡觉嘴部遮罩，保留其他动作与旧版 |
| 家具／服务器 | Faraday | 四套独立朝向家具、后前层、屏幕／座位锚点、独立服务器 |
| 播放／屏幕／运行测试 | Heisenberg | deterministic player、screen effects、28播放器测试、51运行测试，状态绑定／气泡修复 |
| 控制面板 | Linnaeus | controls.mjs／controls.css，16席选择／演示安全边界／响应式控件 |
| 独立素材审计 | Harvey | 347项素材检查、只读哈希与像素不变量报告 |
| 主代理 | 集成与真实浏览器验收 | 地图分层、背向资源归一化、配置构建、主页面接入、实际Chrome／API／移动端／回退验收 |

## 首轮验证结果（本轮修正见补充验收）

| 检查 | 实际结果 |
|---|---|
| 播放器 Node tests | 28/28 |
| 运行时 Node tests | 51/51 |
| 真实 Chrome 验收 | 44/44，无skip |
| 静态素材审计 | 347通过、0失败、2项冻结原图alpha警告 |
| 真 Canvas2D 像素不变量 | 四方向×六状态×15时间点＝360次；动态区域外变化0 |
| 原版回归 | 72帧确定性合成、21冻结文件／运行时副本检查通过 |
| 旧场景 | `?scene=floorplan`／`?scene=v1`／`?scene=legacy`浏览器可用 |
| 页面语法 | 2个内联脚本＋新ES模块检查通过 |
| 实际API烟测 | 隔离 `/set_state`→`/status`→主工位，六状态通过；演示期间收到新实际状态，返回时恢复最新实际值；原state/detail已恢复 |
| Agent客户端集成 | 明确使用浏览器route fixture：3个辅助AI席＋1个溢出，不抢主工位，面板提示待分配；无真人注册／joinKey写入 |
| 设备屏幕 | 六种样式不同、裁剪有效、背壳仅LED、减少动态效果偏好有效 |
| 资源替换 | 角色／服务器成功路径及坏图回滚均实测 |

真实浏览器验收覆盖1440×1000桌面、390×844手机竖屏、844×390手机横屏，无横向溢出。已人工查看全图、分区、背向工位和四向六状态合成图；**技术验收不代替用户对新素材的外观确认**。

## 状态来源与安全边界

默认实际模式只把原 `/status` 接到主工位 `desk-12`。其余席位未接入时显示“未绑定”，不假装是真人工作状态。

`/agents` 中仅已批准、非主／非演示agent可进入固定席。辅助AI默认使用07、08、16；已存在的在线绑定先保留；显式 `stationId` 可供以后的人类状态适配器绑定其他席位，但本次没有增加后端人类人员管理系统。空闲席可复用，重复／溢出不增加第17个角色。

进入本地演示后16席显示“演示”来源，不POST工作状态。背景API仍缓存最新实际值；返回时恢复，未绑定依然未绑定。服务器演示状态跟随主工位，不跟随当前选择席位。

替换接口目前是开发者运行时接口，不是新增持久上传页面：

```js
await window.officeRuntime.replaceCharacter(characterConfig, {
  baseUrl: '/static/company-office/reference-v3/',
  stationId: 'desk-12'
}); // characterConfig.direction须匹配当前工位方向，四动作／锚点／尺寸须有效
await window.officeRuntime.replaceServer('media/server-rack.png');
```

## 本地运行与复测

工作目录 `/Users/hepingyu/Documents/ChatGPT/Star-Office-UI`：

```sh
# 使用已存在的Flask环境，不安装／部署新服务
/Users/hepingyu/Documents/律动虚拟办公室/.venv/bin/python scripts/preview_company_office.py \
  --port 19000 --data-dir .local/office-reference-v3-preview

node scripts/build_office_v3_config.mjs
node --test scripts/test_office_v3_player.mjs scripts/test_office_v3_runtime.mjs
node scripts/test_company_office.mjs

/Users/hepingyu/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 \
  scripts/audit_office_v3_assets.py --no-write

# 此旗标明确允许对隔离loopback预览进行state/detail烟测并恢复；不要指向其他数据目录
node scripts/test_office_v3_browser.mjs --allow-isolated-state-write
```

预览仅监听 `127.0.0.1:19000`。预览脚本现同时失效根页面的模块级HTML缓存、禁用预览静态immutable缓存；仅Jinja自动加载不足以刷新根首页。debug仍关闭，不修改生产Flask配置。浏览器测试使用本机已安装Chrome及bundled Playwright，未下载浏览器。Node依赖路径可用 `OFFICE_QA_NODE_PACKAGE` 覆盖；URL可用 `OFFICE_QA_URL` 覆盖，但仍只允许loopback。

## 报告与截图

在 `assets/company-office-reference-v3/integration-qa/`：

- `browser-qa.json`：44项真实页面验收逐项结果。
- `canvas-pixel-audit.json`：360次真实画布采样的动态区域边界。
- `asset-audit.json`／`asset-audit.md`：347项、冻结哈希、144实际脸帧、192离线组合采样与2项警告。
- `desktop-demo-overview.png`／`desktop-demo-east.png`：明确标识“演示”的16席／绿区效果。
- `desktop-overview.png`／`desktop-west.png`／`desktop-east.png`：默认实际来源。
- `desktop-back-workstation.png`：真背向坐姿与屏幕。
- `four-directions-six-states.png`：24种真实播放器合成效果（示例时刻，不等价于完整动画）。
- `mobile-portrait.png`／`mobile-landscape.png`：实际触控viewport截图。

## 尚需外观确认及保留事项

- 新左右／背向素材和家具仍等用户确认；`humanApproved`未擅自改成true。原已确认的正面模板不重新设计。
- 右向后续已升级为repair-v4-aligned：12帧均明确张嘴，原3秒idle时钟未改；左向和原正面不动。
- 原down工作表情图alpha为240–255，等待图只有部分格存在完全透明区域。这是冻结原素材的边界；播放器按原ellipse裁剪，没有擅自改原图。
- 保留被拒候选、修复旧版和生成来源；备份位于 `.local/company-office-backups/reference-v3-development/`，不回滚仓库中其他既有修改。
- 未部署远端、未改变生产API／人员数据、未提交Git。真实12个人的工作状态源接入不在本轮演示绑定范围。

## 右向与4K补充修正

当前右向选择 `character-right/repair-v4-aligned`，上一轮v3-idle-mouth保留为历史版本、不再接入。新Node测试87/87、原浏览器44/44、新4K/交互45/45、素材347通过。详见 `docs/COMPANY_OFFICE_V3_RIGHT_4K_ACCEPTANCE.md`。这里的4K是实际渲染与文字层；原1584×993地图画稿不冒充原生4K。
