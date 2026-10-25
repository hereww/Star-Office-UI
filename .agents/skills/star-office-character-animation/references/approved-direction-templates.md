# 已确认的行走方向模板

2026-10-01，用户确认“行走方向可以了，作为模板记录保存”；同时指出办公动画仍有问题。

- 模板包：`../assets/approved-walk-directions-v1/`。
- 清单：`../assets/approved-walk-directions-v1/template-manifest.json`，含八张96×96 RGBA原样复制图、来源和SHA-256。
- 四方向各A/B两图：`up/A.png`、`up/B.png`；`down/A.png`、`down/B.png`；`left/A.png`、`left/B.png`；`right/A.png`、`right/B.png`。

后续行走出图时，用原有orange-cat-reference.png约束身份，另附模板中的对应方向A/B约束朝向与姿势；不要混入其他方向，不自动把两张参考循环补成12帧。

确认的是朝向模板，不是完整12帧循环验收，也不是生产接入许可。未通过的down-v7完整旧稿没有收录。

办公working-down-v2已标为用户未通过，只保留问题记录，不当作办公母版或已确认模板。20°轻俯视只是此前提示词目标，不能把这次问题稿变成已确认相机模板。
