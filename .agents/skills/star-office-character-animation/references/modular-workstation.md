# 固定工位 / 独立角色约定

用户2026-10-01要求工位重画且固定、显示器与桌子不再错位，角色与工位自由组合，以后可程序换角色。不要回退到逐帧画角色＋家具的旧办法。

- 工位一份静态资源：完整相同画布的后景椅子PNG、前景桌子＋键盘＋显示器PNG；桌/屏不分开挪动。
- 办公角色一份透明4×3、12帧图集，帧内无家具。只取等格，不单独裁紧、归一化或修绘每帧。
- 组合顺序：后景椅子→角色→前景桌子电脑。工位坐标不依赖角色帧数或身份。
- 统一工位`size/seatAnchor/direction`，每角色配置`poseAnchor/scale/actions`。锚点是该素材的参考点，不保证模型精确画到提示词坐标。
- 当前办公逻辑画布192×192；不要因独立图层又将它们当96×96行走图集处理。生成大图可整格缩放到192。
- `writing/researching/executing`映射working；仍只接受原有6业务state。未制作idle/syncing/error时明确缺素材，不拿working冒充。
- 新角色需要同朝向的办公坐姿与动作。比例不同需一次性角色配置，不能承诺所有角色免配置；站立母版不能直接替代办公动作。

候选包（相对项目根）：`assets/character-animation-proposals/2026-10-01-modular-office-v1/`。

核心文件：`office-assets.json`保存坐标与动作；`office-compositor.mjs`实现`registerCharacter/setCharacter/setState/setFrame/sample`；`character-template.json`给替换描述示例。`source/*-prompt.txt`保留实际生成提示词，原图未覆盖。浏览器只做本地导入，角色描述里URL不用于网络抓取。

当前仅工位重绘、橘猫12帧候选、组合播放器；橘猫爪子未到指定键盘区、打字不明显，未获用户验收。镜头俯视角只是提示词目标，不是已精确量测或已确认模板。不要因为技术测试通过就说动作视觉通过。
