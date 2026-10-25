# 角色模板与选择合同

日期：2026-10-13  
当前运行时：`company-office-connected-v5`  
模板：`connected-v5-character-template-v1`  
原始表情素材来源：`approved-office-expressions-v1`（仅作为角色素材，不作为 V4 工位模板）  
选择范围：全局默认角色 + 每个已绑定工位的独立角色动画

## 目标

把已确认的固定坐姿角色动画和共享工位拆成可复用合同：

- 工位、桌面、显示器、屏幕效果保持共享；
- 角色只负责透明底图、固定姿态和表情图集；
- 后台保存的是安全的角色 profile ID，不保存提示词、生成源路径或运行时密钥；
- 新品种先进入 `prompt-ready` 目录，完成素材、左右向接入和视觉 QA 后才标记 `ready` / `assignable`。

## 当前 V5 动画与工位合同

机器可读模板：`frontend/company-office/connected-v5/character-template.json`。后台「动画预览」提供该 JSON 的同源版本化链接，供后续 AI 生成和接入新角色使用。

- `animationMode`: `expression-plus-screen-effects`
- 固定坐姿，不重新引入行走或键盘手部逻辑；
- 12 帧，4×3，12 fps；
- 业务状态仍为 `idle / writing / researching / executing / syncing / error`；
- `writing / researching / executing` 共用 `working` 资源；
- `idle / syncing / error` 使用各自表情图集；
- 共享工位使用 V5 的两组连续长桌和 16 个工位；桌面、键盘和屏幕不随角色替换。
- V5 独立播放器 `ConnectedSeatedPlayer` 只合成原椅子和固定角色，桌面遮挡由原长桌 alpha 完成；不得叠回旧独立桌面。
- 屏幕内容由 `BenchScreenOverlay` 独立播放（screen-only）；背面只显示 LED，键盘无手部动画。
- 12 帧是表情图集大小，60 / 36 / 60 / 12 是 working / idle / syncing / error 的采样时钟；不得复制静帧凑满。

## profile 状态

| 状态 | 含义 | 可保存为当前角色 |
| --- | --- | --- |
| `ready` | 资源、方向、表情、透明度和运行时 QA 完成 | 是 |
| `prompt-ready` | 已登记生成提示与模板约束，尚无完整生产资源 | 否 |
| `preview` | 有候选图，但仍未通过完整 QA | 否 |
| `placeholder` | 只有目录元数据 | 否 |

当前八个 profile 均为 `ready`。布偶猫、英短使用生成的表情图集；美短、狸花猫、奶牛猫、狮子白猫、简州猫使用各自四向坐姿底图配合运行时局部表情图集。身体、工位、屏幕和背面约束保持不变。

## 后端配置

`/api/office/admin/config` 继续使用原有版本化 SQLite、乐观锁、CSRF 和保存后读回。配置增加：

```json
{
  "appearance": {
    "character_profile_id": "orange-cat-v1",
    "allow_fallback": false
  }
}
```

旧配置缺少 `appearance` 时自动使用橘猫默认值；如果历史/人工写入了未知、未就绪 profile 或 `allow_fallback=true`，读取和公开快照也会 fail-closed 回到橘猫，但不会改写不可变历史。第一期只允许保存 `assignable=true` 的 profile；`allow_fallback` 暂时固定为 `false`，在 runtime 预加载、原子替换和失败回滚完成前拒绝开启，避免后台选择了未完成角色却在员工页静默显示橘猫。

## 生成一个新品种的最小交付物

1. 固定坐姿透明底图；
2. down / left / right 各自的 `working / idle / syncing / error` 四套 4×3 表情图集；
3. `up / down / left / right` 四向固定坐姿资源；其中 up 为真实背面，`faceVisible=false`，不生成看不见的表情图集；
4. 一份 profile manifest，包含 `poseAnchor / headAnchor / scale / faceRect / faceClipEllipse`；
5. 12 帧尺寸、透明度、接触点、遮挡和屏幕独立性检查；
6. 通过 V5 运行时和移动端视觉审计后，才把目录状态改为 `ready`。

不允许把 down 方向旋转成 left/right，也不允许用历史行走图、键盘手部图或静态占位图冒充已完成办公角色。

## 本次交付与生产边界

七个新品种已完成四向与状态动画接入；动画预览和工位绑定可选择全部八个 profile。预览选择不会写入配置或改变 16 个地图角色，保存仍需通过现有版本化配置流程。

V5 模板代码、候选预览和不可变发布包的本地验收，不等于服务器部署完成。部署必须先读取当前 release/config，备份数据与入口，再只切换 Office 服务，并验证正式入口、资源 SHA 和配置版本未变。

## 工位独立角色动画（2026-10-13）

工位绑定可带可选的 `character_profile_id`，省略时跟随 `appearance.character_profile_id`。旧版本不增加字段，不改写 SQLite 历史。每个工位的角色由服务端和客户端共同检查可用状态；待生成或未通过运行时验收的候选角色不能保存。

管理端在每张工位卡片提供“角色动画”，可选“跟随全局”或已就绪角色。选择只编辑草稿；预览展示每个工位的有效角色及是否独立选择，然后按现有版本号保存并 GET 完整比对。切换工位上的绑定用户保留该工位角色，解除绑定移除该设置。工作和休息仍由真实遥测决定。公开快照只输出每个工位的角色 ID、名称和素材状态。
