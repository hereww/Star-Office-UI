# 现有橘猫四向行走与办公候选预览

本目录是独立审图播放器，不是新的图像生成或生产接入。

- 四方向原有 A/B 两姿势各2张，以3fps示意轮换，不复制为12帧。
- 下向可切换到 v7 完整12帧旧失败稿，原有文件只读复制，未修绘。
- 工作使用最新 v2 的4×3原图，按原始等格播放12帧、12fps。
- writing/researching/executing切换仅改变业务标签，它们共用办公素材；idle/syncing/error标注为新方案未生成。
- 新方案四方向各12帧尚未齐备，不能据此宣称完成。
- 透明格背景仅为播放器背景；原PNG Alpha不修改。
- 所有源图片按SHA-256确认复制不变；完整路径与实际帧数见 preview-manifest.json。

入口：`/Users/hepingyu/Documents/ChatGPT/Star-Office-UI/assets/character-animation-proposals/2026-10-01-walk-work-preview/index.html`。直接打开也可离线播放，不依赖网络或CDN。localhost服务器仅用于内置浏览器预览。

## 本轮实际预览与验证

- 本机预览地址：http://127.0.0.1:58085/（临时localhost服务器，仅监听127.0.0.1）。
- 已实测办公与下向旧稿均播放到全部12帧、暂停/逐帧/首尾导航有效、96px尺寸有效；390px手机宽度无横向溢出。
- 已在Codex内置浏览器打开并保留可播放页面。播放器验证不等于素材视觉通过。
- 所有原始素材与复制件SHA-256仍一致，没有修绘。
