# V5 员工页面 Hover 专项验收

日期：2026-10-12（北京时间）

## 验收入口与范围

- 唯一验收入口：本地 `http://127.0.0.1:19025/` 的新版 employee 页面。
- 实际加载场景：`company-office-connected-v5`；16 席；`expression-plus-screen-effects`。
- 未打开旧独立页面、旧素材抽屉或 `?scene=...` 入口；未请求旧 `/status`、`/agents`。
- V5 正常复用底层 reference-v3 几何/渲染及 connected-v4 适配器工厂，不等于使用旧版验收页面。
- 13 项使用浏览器内隔离模拟数据；另 1 项只读获取现有内网办公室的匿名快照。模拟截图有醒目标识，不作为线上运行证明。
- 未部署服务器，未修改账号绑定、凭据、采集器、地图/角色素材或其他服务。

## 本轮发现并修复

1. 自定义 hit area 参数传法未启用手型指针：改成明确的 Phaser 交互配置对象。
2. 高分屏按 backing canvas 像素判定拖动：转换为 CSS 像素后使用 8px 阈值。3px 微动不再误判成拖动。
3. 高分屏悬停边框偏细：按实际渲染密度计算屏幕空间描边与四角标记。
4. 拖动期间抑制新 hover，释放或离开画布后清理拖动状态；在 pointerup 再检查距离，防止遗漏最后一段移动。

## 结果

- 新版 V5 浏览器专项：14/14 通过。
- V5 布局、screen-only 和 production bridge 单元/契约测试：17/17 通过。
- 交互辅助测试：通过，覆盖 backing density 1/2/4 的 CSS 拖动阈值。
- 浏览器错误、失败响应、写请求、旧接口请求：均为 0。
- 检查桌面 1920×1080 / DPR2、全屏、1024×768 平板、390×844 手机竖屏、844×390 手机横屏。
- 红绿区 16 个工位分别验证命中；悬停不改变相机和动画时钟；放大拖动不选中；静止点击保留自定义视角；显式聚焦按钮生效。
- 减少动态效果模式保留静态描边。

机器报告：`acceptance.json`。其中 viewport 检查验证布局和画布尺寸，不宣称完成手机真机触摸手势全量验收。

## 复现

```sh
python3 scripts/preview_office_employee.py --port 19025
```

在另一终端：

```sh
node scripts/test_office_employee_hover.mjs
node scripts/test_office_map_interaction.mjs
node --test scripts/test_office_connected_v5_layout.mjs scripts/test_office_connected_v5_screen_only_stations.mjs scripts/test_office_v5_production_bridge.mjs
```

预览只监听 loopback，不提供管理路由。前端从当前工作区加载，真实数据仅转发既有内网匿名快照；QA 调试 hook 仅由测试浏览器拦截注入，不写入发布源文件。

## 截图

- `v5-employee-live-hover-green.png`：新版 V5 + 现有匿名内网快照。
- `v5-employee-hover-green-detail.png`：隔离模拟数据，绿区悬停细节。
- `v5-employee-fullscreen-hover.png`：新版 V5 全屏悬停。
- `v5-employee-1024x768.png`、`v5-employee-390x844.png`、`v5-employee-844x390.png`：响应式布局。
