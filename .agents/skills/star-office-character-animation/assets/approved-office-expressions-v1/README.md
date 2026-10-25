# 已确认办公表情模板 v1

用户于2026-10-01确认当前版本。角色坐姿、工位和键盘固定，无键盘上的手。

- working：专注表情；writing/researching/executing共用。
- idle：仰脸闭眼张嘴熟睡，嘴部轻微呼噜变化。
- syncing：耐心等待。
- error：迷糊旋涡眼连续转圈。

每套12帧、12fps；工作/同步5秒一轮，睡觉3秒一轮，旋涡眼连续循环。

`template-manifest.json`记录原样复制文件、来源和SHA-256，`approval.json`记录用户确认范围。保留角色与工位分离、固定锚点和脸部区域组合约定；后续换角色或改动作须另建版本，不覆盖本包。

完整预览与原始生成记录仍保存在项目根目录`assets/character-animation-proposals/2026-10-01-seated-office-states-v2/`。本包也包含可独立静态服务的`index.html`及播放器。

视觉已确认；生产就绪、生产地图接入和第二角色替换验证均未声明完成。本次不提交Git、不部署。
