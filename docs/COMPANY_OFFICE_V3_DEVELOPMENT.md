# 公司办公室 v3 开发接口与分工

2026-10-02，用户已确认并授权开发及子代理并行。仅本地开发与隔离预览，未授权远端部署。

## 固定验收
- 原 approved-office-expressions-v1 所有文件不改；正面 character-base 与4套脸图原样复用。
- 仅固定坐姿，不行走，不加载/绘制手部。12fps/12帧；工作与等待60帧时钟，睡觉36帧，出错12帧。
- 红8+绿8总16席；红区双面4+4，绿区4+4。每区域6同事+2AI。16席各自独立状态、姓名、绑定、方向、气泡。
- 场景沿用白色测试间背景。绿区背景家具替换成同画风独立层；服务器单独可替换。
- 四方向独立坐姿和工位。up真正背向，无背面五官；left/right各自素材，不旋转前向、不复制静帧凑表情。
- 原六state idle/writing/researching/executing/syncing/error；writing/researching/executing共享working表情。
- 仅屏幕区域动，各状态样式独立；显示器背面只LED，不透屏。reduce motion应减少屏幕脉冲不改变原表情映射。
- demo必须可见标注，未绑定不伪装真人。API主状态同步主席，不串其他15席。

## 文件写入范围
- 主代理：reference-v3/runtime.mjs、layout.json、assets.json、map背景、furniture资源、back-body归一化、frontend/index.html接入、docs与集成QA。
- 左向资源代理：仅reference-v3/media/character-left/、assets/company-office-reference-v3/character-left/。
- 右向资源代理：仅reference-v3/media/character-right/、assets/company-office-reference-v3/character-right/。
- 播放模块代理：仅reference-v3/directional-player.mjs、screen-effects.mjs、scripts/test_office_v3_player.mjs。
- UI代理：仅reference-v3/controls.mjs、controls.css；不改index或runtime。
- 测试代理（后续）：独立v3集成验收脚本，旧测试不改。

## 资源接口
完整播放画布仍192x192（地图将整体缩放）。assets.json保留原config的fps/frameCount/grid/faceClockFrames/character字段，并新增directions。
方向配置为：
```
{
  character: {id,direction,base,frameSize:[192,192],poseAnchor:[...],scale:0.6,
    faceRect:[x,y,w,h],faceClipEllipse:[cx,cy,rx,ry],faceFrameSize:[90,58],
    headAnchor:[x,y],faceVisible:true,actions:{working:{face,faceClockFrames:60},idle:{face,faceClockFrames:36},syncing:{face,faceClockFrames:60},error:{face,faceClockFrames:12}}},
  furniture: {size:[192,192],seatAnchor:[96,94],back:'media/...',front:'media/...',
    screen:{visible:true,polygon:[[...],...],led:[x,y,w,h]},order:['back','actor','front','screen']}
}
```
相对URL以reference-v3为根。down character的原source URL为../media/...。up faceVisible:false，可无face图但动作时钟必须保留。左右素材manifest提供归一化192角色、360x174四套表情（每格90x58）、faceRect/faceClipEllipse/poseAnchor/headAnchor/scale。像素之外身体固定，不修改原模板。

## 播放模块接口（交给播放代理）
```
new DirectionalSeatedPlayer(canvas,assets,{baseUrl,direction:'down',imageLoader?,reducedMotion:false})
await player.initialize()
player.setState(state) // 同一state不重置时钟
player.setDirection(direction) // await; 更换方向保持状态和sample时间
player.sample(ms) // 从当前state起算，确定性绘制整套192画布，返回是否重绘（bool）
player.setFrame(0..11) // QA采样表情
player.snapshot() // direction/state/action/frame/faceFrame/clock/bodyPlacement/bodyFixed/handsRendered/screen
```
export BUSINESS_STATES可引用旧模块；export validateDirectionalAssets(assets)。图片加载可共享缓存，仅成功图片缓存，失败可重试。屏幕mask只动内部区域。静态家具与角色不旋转。支持未绑定时still-state=idle但气泡由runtime标注未绑定，不制造新APIstate。

## 场景运行接口（主代理实现）
```
await ReferenceOfficeRuntime.load('/static/company-office/reference-v3/')
runtime.preload(scene); runtime.create(scene); runtime.update(time)
runtime.setState(state,force=false) // 兼容旧主状态调用，只影响mainStation
runtime.setStationState(id,state,{detail='',source='demo'})
await runtime.setStationDirection(id,direction)
runtime.selectStation(id,{focus:false})
runtime.setView('overview'|'workstation'|'west'|'east')
runtime.setDemoMode(boolean)
runtime.guestPoint(area,index); runtime.applyView(); runtime.replaceCharacter(config,options)
runtime.snapshot()
```
snapshot包含：ready,mapSize,mainStation,activeStation,view,demoMode,walkIntegrated:false,player(主席),faceAnchor,stations数组,server，slots每个{id,name,role,region,direction,state,source:'live'|'demo'|'unbound',detail,bound,selected,player,bubbleAnchor,position}。
window.officeRuntime即此对象。window.dispatchEvent(CustomEvent('office-runtime-ready',{detail:runtime}))在create完成后。后续emit('office-runtime-change')由runtime用于状态UI刷新，不每帧。

## UI接口（交给UI代理）
export mountOfficeControls(runtime,{parent:HTMLElement}) -> {destroy(),refresh()}; main在office-runtime-ready调用。
仅生成独立面板：16席列表/红绿分区计数；点选席位；方向下拉；六state按钮；demo切换；全图/红区/绿区/选中工位视图；当前席位detail及source标签；返回真实状态。
state按钮在非demo且source live默认不提交后端，要求进入明确演示才本地设state，不调用/set_state。为existing API主状态沿用老状态控件。
UI使用中文、真实文本、触控44px、键盘操作/aria-live/pressed；颜色配合暖木地图，不大面积无意义卡片。所有动态内容textContent，不能innerHTML插入名字。

## 完成状态（2026-10-03，本地时间）

本地集成完成，详见 `docs/COMPANY_OFFICE_V3_ACCEPTANCE.md` 与 `assets/company-office-reference-v3/STATUS.json`。
Player 28/28、runtime 51/51、真实Chrome 44/44，素材审计347通过／0失败／2项原版alpha边界警告。新素材用户外观确认仍待完成，无远端部署。

后续修正：主工位desk-12不会被远端agent抢占；所有在线绑定先保留；两行气泡按实测高度置于头顶且尾巴保留3px间隙；设备间只用单一服务器状态标签；溢出agent在面板提示，不增第17席。旧主状态浮层在v3隐藏，状态来源统一看选中席位和气泡。

## 右向与4K后续修正

右向当前版本为 `repair-v4-aligned`，完整采用资源包headAnchor和faceRect，不再在配置构建器覆盖旧锚。新增 `render-quality.mjs`，物理画布与逻辑地图坐标分离，清晰中文系统字体与屏幕空间注释。源码、48帧实际组合与4K/交互45项验收见 `docs/COMPANY_OFFICE_V3_RIGHT_4K_ACCEPTANCE.md`。原地图和冻结正面资源保持不变；未部署远端。
