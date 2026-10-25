# 固定坐姿工位 · 已确认表情模板

2026-10-01。最新要求：不画、不播放敲键盘的手，保留静态键盘，只用表情表达工作状态。

## 现在播放什么

- 一张静态坐姿底图，身体/头部轮廓/耳朵/尾巴/位置/尺度不变。
- 静态工位后景 + 角色底图 + 固定脸部表情 + 静态工位前景。桌子、显示器、键盘保持同一资产和坐标。
- 四套表情：working专注、idle仰脸张嘴熟睡、syncing等待、error迷糊旋涡眼。每套12帧，4列×3行，局部单格90×58，均按12fps播放：工作/同步每5秒一次；睡觉每3秒一次嘴部呼噜变化；迷糊旋涡眼连续循环。睡觉的仰头由仰脸抬鼻、闭眼、露下巴和张嘴表现，不物理旋转原静态头部。
- 原六业务状态不变：writing/researching/executing共用working；其余同名映射。这里展示工位上的idle/error只为资产对比，不修改生产地图的区域和路径。
- 旧手部图保留为历史来源，但当前配置、加载器、绘制器和界面都不使用它们。

## 本地预览

当前预览：`http://127.0.0.1:54634/`（本地临时服务，不是生产部署）。

关闭服务后，可在本目录用已有Python运行`python3 -m http.server 54634 --bind 127.0.0.1`。

`index.html` / `preview.mjs`是预览，`seated-compositor.mjs`是局部表情播放器，`office-assets.json`保存组合坐标和素材路径。

## 换角色

保持工位资源与坐标不动；替换`character.base`与同角色四套表情图，并一次配置`poseAnchor`、`scale`、`faceRect`、`faceClipEllipse`。当前播放器为正面down；其他方向需要独立资产，不能旋转冒充。没有测试第二个真实角色，也没有新增自动上传/姿态转换功能。

项目Skill的表情入口：`scripts/make_prompt.py working --expression-only --json`。自定义角色须同时提供自己的`--reference`与`--face-reference`，不套橘猫身份。

## 来源与检查

- `source/`保留历次内置生成的原图与真实提示词（本次只新增熟睡和旋涡眼两套，各一次生成12帧）；`generation.json`记录来源及哪些资源已停用。
- `package-assets.cjs`自动整理局部脸部图集，不做逐帧手工修绘。源图有真实alpha；紧裁脸部贴图可能是实心区域，最终轮廓由程序固定椭圆裁切，不伪称每张整理后图集都有透明边缘。
- `verify-seated.mjs`检查资源、六状态共72帧的固定绘制坐标、无手部加载/绘制以及底图/工位与v1逐字节一致，结果在`qa-assets.json`。
- `browser-qa.json`记录浏览器首帧/眨眼帧像素检查：脸部之外全相同；关闭表情后整幅画布全相同。`browser-qa-sleep-dizzy.json`记录新版熟睡/旋涡眼全24帧检查，脸部之外仍完全一致，且无手部。`preview-idle-sleep-detail.jpg`和`preview-error-dizzy-detail.jpg`为新版实际截图。

**用户已于2026-10-01确认这一版。** 固定模板保存于项目Skill的`assets/approved-office-expressions-v1/`，确认记录见`approval.json`。后续修改另建版本，不覆盖本模板。视觉确认不代表生产接入：仍未接入生产、未替换行走模板。历史浏览器QA记录中的pending字段反映检查当时状态，最新确认以`approval.json`为准。
