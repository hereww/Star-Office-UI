# 公司实际平面图适配 v2

本目录保留空间依据、结构图、完整提示词、原始生成图和实浏览器QA。地图已经接入真实本机Flask主页面；新地图仍待用户视觉验看，未远端部署。

- 空间来源：`/Users/hepingyu/Downloads/1203平面图.pdf`，渲染`source-floorplan.png`。
- 原生SVG分析：`floorplan-analysis.svg` / `.png`，由`build_company_floorplan.mjs`生成。
- AI布局参考：`layout-guide.png`（实际生成时版本，保留不覆盖）。
- 内置imagegen参数 / 完整prompt：`generation-request.json` / `map-prompt.txt`。
- 原始AI背景：`generated-original.png`，1070×1470。
- 运行背景：`frontend/company-office/office-map-floorplan-v2.webp`，2048×2816，无损WebP，最近邻规范。
- 当前布局：`layout.json`、`frontend/company-office/map-layout.json`；33开放席分组16+8+6+3；3独立办公室展示工位另算。
- QA：`unit-qa.json`、`browser-qa.json`、`mobile-qa.json`、`final-guest-qa.json`、`final-runtime-qa.json`。
- 浏览器截图：`main-map.png`、`workstation-sleep.png`、`workstation-working.png`、`workstation-error.png`、手机两个视图PNG。

`desktop-guest-qa.json`记录中途桌面检查；其访客点后来移动到通道，最终点位以`final-guest-qa.json`为准。手机图中三个本地验收访客是临时测试数据，均已移除。`mobile-qa.json`里的拖动是浏览器原生拖动；原始CDP触点派发不受当前浏览器支持，未冒充真实设备测试。

已确认的身体、工位、4套表情和组合器原样保留。主角无新增行走循环。小会议室椅子本版6张、原图可读8张，此静态软装差异记录于文档；地图属于游戏化适配而非施工图。

完整分析：`docs/COMPANY_OFFICE_FLOORPLAN.md`。
