# Star-Office-UI 状态与新角色素材

本映射读取当前本地源码，不依赖旧失败稿。此Skill只制作素材，没有修改系统。

| 业务state | 含义 | 当前浏览器主角色视觉 | 默认新素材action | 可选独立动作 |
| --- | --- | --- | --- | --- |
| idle | 待命 | star_idle，休息区沙发锚点 | idle | idle |
| writing | 整理文档 | star_working | working | writing |
| researching | 搜索信息 | star_working | working | researching |
| executing | 执行任务 | star_working | working | executing |
| syncing | 同步备份 | 主角色隐藏；sync_anim独立循环 | syncing | syncing |
| error | 出错 | 主角色隐藏；error_bug独立表现 | error | error |

`working`仅是共用**动画素材名**，业务state仍用writing/researching/executing。同步与错误的橘猫角色提示词是拟新增角色素材，不是声称原版已存在同样的橘猫动画；将来接入时需显式处理原版隐藏主角色的显示策略，不能只替换旧图就期望它自动出现。

## 四方向与状态的关系

方向素材是移动时的视觉资源，不是业务state。`walk-up/down/left/right`分别表示面向屏幕上/下/左/右的原地步行；实际地图坐标移动仍由原逻辑控制。向上是背面，不画出正面的眼睛；向下正面；左右严格对应侧面，不采用三分之四视角，也不要靠镜像替代独立生成。

只有接入任务才讨论移动/到达切换。这里不新增状态、不改状态轮询，也不宣称原版主角色已经启用了这些四方向橘猫资源。

## 源码依据

- `frontend/index.html`：`STATES`、`normalizeState`、`applyVisualState`、`fetchStatus`、`moveStar`。当前主角色writing/researching/executing走同一个`star_working`分支；star_working原资源为38帧/12fps，而非12帧。
- `backend/app.py`：`VALID_AGENT_STATES`、`STATE_TO_AREA_MAP`、`normalize_agent_state`。不要更改六状态协议。
- 前端researching的area是researching；后端STATE_TO_AREA_MAP把researching归到writing区域。此处保留两者，不将其误写成完全相同或擅自“统一”。
- 后端状态兼容别名：working/busy/write→writing，run/running/execute/exec→executing，sync→syncing，research/search→researching。执行任务不是画面中的跑步。

## 新素材统一规格

每套12帧、默认12fps、4列×3行、透明角色精灵、目标单格96×96。这个规格适用于本Skill的新素材；原图各自帧数/格尺寸并不统一，不直接覆盖现有38帧或其他动画资源。

## 工位与四向坐姿

办公默认down：正对画面坐在桌后，桌椅/键盘/显示器同轴；只允许up/down/left/right，禁止斜向和45°。working、可选writing/researching/executing及syncing结合局部工位，家具在12帧中保持不动，只有角色动作变化。idle仍用于休息待命区域，error用于告警区域，不为这两个状态擅自新增工位。

办公的其他朝向按实际需要生成，不自动把8套基础包乘以四倍。附当前地图工位图可用于匹配形状和位置；没有参考就标为工位概念稿。生成的局部工位组合画面不是可以直接重复贴到地图上的角色层：若地图已有同一桌椅电脑，接入任务应复用家具，避免叠出双工位。本轮不修改那些图层。
