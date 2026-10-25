# V5 角色和共享工位模板

机器可读合同：项目根目录 `frontend/company-office/connected-v5/character-template.json`，ID `connected-v5-character-template-v1`。它记录四向锚点/尺度/脸部区域、帧时钟、共享长桌清单、生成提示与发布门槛。后台动画预览提供同源版本化 JSON 链接。

## 生成

1. 先读取合同的 `baselineGeometry` 和 `generation`。使用同一身份母版，按 up/down/left/right 独立生成固定坐姿透明底图。不要旋转、镜像或改变工位来适配角色。
2. down/left/right 每个方向使用对应坐姿脸部裁图，生成 working/idle/syncing/error 的脸部-only 4×3 图集，各12帧；up 固定背面且 faceVisible=false。
3. 保留身体、头部外轮廓、耳朵、尾巴和接触点固定。家具、键盘、屏幕、气泡不属于生成的角色图。`generation.prompts` 可替换 label/direction/action 后使用；出图仍用内置 imagegen，真实透明背景。
4. 替换新角色时每个方向只确定一次 poseAnchor/headAnchor/scale/faceRect/faceClipEllipse。当前播放器底图为192×192，可见表情单格90×58、整图360×174；复用同方向 V5 椅子与长桌像素。

## 预览和接入

- 橘猫用 V5 `ConnectedSeatedPlayer`（chair-only），不要使用旧独立工位完整合成器。共享桌面、遮挡和屏幕效果在 V5 地图中看。
- 候选概念图可在后台切换预览，但无方向/状态动画、不写 appearance、不调用 replaceCharacter。
- 只有全部四向资源、局部表情、透明度/锚点、16座遮挡、独立屏幕、移动端/全屏/背向工位和原子替换验收完成，才能同步后端和前端 ready allowlist。
- 地图仍只是状态投影，保留原绑定/权限/采集频率。源码模板更新不是生产部署证据；服务器部署需独立备份、最小 Office 切换及读回验收。
