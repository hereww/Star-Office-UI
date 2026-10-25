# 已确认办公表情模板

2026-10-01，用户确认“不过确定这一版”，对应当前固定坐姿、无键盘手、熟睡待命和旋涡眼出错版本。

- 模板包：`../assets/approved-office-expressions-v1/`。
- 原样文件与SHA-256：`../assets/approved-office-expressions-v1/template-manifest.json`。
- 坐姿底图/工位192×192；脸部图集360×174，4列×3行，每格90×58；12帧、12fps。
- working专注；idle仰脸闭眼张嘴熟睡；syncing等待；error迷糊旋涡眼。工作/同步5秒一轮；睡觉3秒一轮；旋涡眼连续循环。
- body/seat/furniture/keyboard锚点不动，不加载或绘制手。睡觉的后仰感来自脸部姿态，不物理旋转或摇晃整个头部/身体。
- 原六业务状态映射保持不变；不把working新增为API状态。
- 后续以此包为办公视觉模板，改角色/改动作另建版本，不覆盖已确认图集。

确认的是当前办公视觉模板，不是生产地图接入、任意角色自动适配或其他朝向工位的验证。原working-down-v2等旧失败稿仍不收录。
