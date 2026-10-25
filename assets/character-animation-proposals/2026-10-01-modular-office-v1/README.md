# 固定工位与独立办公角色 · v1

制作日期：2026-10-01。新方案不复用旧working-down-v1/v2组合图，不覆盖已确认四向行走模板。

## 本轮制作

1. 内置imagegen新绘制两层静态工位；后景空椅、前景桌子＋显示器＋键盘。桌子和显示器同一PNG，程序不会分别平移；正面向下、同轴、不斜摆。
2. 同一橘猫母版＋新工位几何参考，内置imagegen一次生成角色-only 12帧，4×3，12fps。
3. 统一等格提取、nearest整体缩放到192×192；未逐帧裁紧、重定位、补画、镜像或复制凑帧。
4. 程序组合：椅子→角色→桌子电脑；固定键盘接触小区域允许角色手部在桌面上方显示（所有角色共用遮挡规则，不是每帧修绘）。
5. 支持播放、暂停、逐帧、空工位、角色/工位分开查看。替换角色只注册图集、坐标锚点及尺度，不变工位。

## 视觉限制（必须保留）

- **角色手部未按提示词伸到键盘两侧，实际打字接触不明显**。目前主要是眨眼、轻微动作，不能标记为办公动画已完成或办公模板已验收。
- 个别帧有轻微形状变化，本轮不再逐帧修复、不自动重试生成。
- 当前只有橘猫真实新素材；接口替换测试使用同一图集的测试fixture，不是第二个完整角色。
- 20度轻俯视只是提示词目标；没有精确量测，也未获用户确认镜头模板。
- 家具设计是重绘候选，还没有针对当前生产地图接入；生产地图、后端、原状态API未改。

## 文件

- `source/workstation-layers-original.png`：生成工位原图1774×887，2×1（各887×887）。
- `source/orange-cat-working-original.png`：生成角色原图1448×1086，4×3（各362×362）。
- `source/*-prompt.txt`：本轮实际提示词；`generation.json`保留工具来源、引用和候选状态。
- `media/workstation-back.png` / `media/workstation-front.png`：共用192×192透明画布。
- `media/orange-cat-working.png`：768×576透明4×3；`frames/01..12.png`等格提取。
- `office-assets.json`：工位锚点、角色一次性锚点/尺度、业务映射。
- `office-compositor.mjs`：可复用候选组合模块；尚未加入生产场景。
- `index.html` / `preview.mjs`：纯本地预览。
- `character-template.json`：未来角色描述样例。坐标使用角色原生单格像素；比例变化需要自己的配置。
- `verify-office.mjs` / `qa-assets.json`：真实alpha/12格/接口和家具稳定结构检查；不等于视觉验收。
- `browser-qa.json` / `preview-desktop.jpg` / `preview-mobile.jpg`：本地交互和布局记录。

## 换角色

新角色需生成同朝向（down）的**办公坐姿12帧**，透明4×3，不画家具。站立PNG不能直接替代办公动作；比例不同需配一次`poseAnchor/scale`。不要声称任意角色免配置自动对齐。

```js
import {OfficeCompositor} from './office-compositor.mjs';
const player = new OfficeCompositor(canvas, config.workstation, {baseUrl: import.meta.url});
await player.initialize();
await player.registerCharacter(characterDescriptor);
player.setCharacter(characterDescriptor.id);
player.setState('writing'); // writing / researching / executing -> working
player.sample(500);         // 第7帧（0-based为6）
```

保留原有六状态：idle/writing/researching/executing/syncing/error。此包只制作working；其他动作缺失明确显示，不以working冒充。页面的本地PNG/JSON导入不上传，描述JSON里的路径不会触发其他网络素材下载。UI文件导入没有使用真实第二角色进行视觉验收。

## 运行与验证

无安装、无打包、无生产部署。用现有Python在此目录开仅localhost静态服务即可。

```sh
python3 -m http.server 63467 --bind 127.0.0.1
# 若有现成sharp模块
node package-assets.cjs
node verify-office.mjs
```

实际临时预览：`http://127.0.0.1:63467/`。旧58085行走预览服务器未停止。
