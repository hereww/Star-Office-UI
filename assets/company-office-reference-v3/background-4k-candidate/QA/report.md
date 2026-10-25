# 4K 背景画稿候选 QA — 不接入

## 决定

**doNotIntegrate: true / eligibleForIntegration: false / humanApproved: false / runtimeIntegrated: false**

内置 image_gen 仅尝试一次编辑。目标是 4224×2648（1584:993 的精确等比），实际返回 **1584×993 RGB PNG**。长边仅 1584，不达到 ≥3840 的原生 4K 门槛。保存的是未经后处理的原始返回图，没有插值放大、裁切、拉伸或变形；不能把纹理更锐利称作原生 4K。未使用 CLI 模型，未启动子代理。

## 视觉核验

同时查看了源图与原始生成图。大布局、全画幅、白色测试间、摇滚房、左侧四房间和空工位地面从完整画面观察均保留；未看到新增角色/文字/家具或明显重构布局。地板对比度、墙边和道具细节发生了重绘/增强，因此不宣称每个道具像素和所有边界完全不变。

## 关键边界坐标核验

坐标为原生 1584×993 像素，上左为原点。对目视选定的 24 个关键边界附近使用 37×37 灰度梯度局部相关、±8px 搜索；没有缩放、全局配准或修改图像。下列坐标是边界附近的 **patch 中心**，并非经分割认证的墙角像素。23/24 样本最佳匹配为零偏移；茶水间左上样本为 (0,-1)px，可能由锐化后的边缘分布变化引起，不能据此断言墙体实际移动，也不能以本方法认证全图严格几何锁定。

| 关键边界附近 | 源图 patch 中心 | 候选最佳匹配中心 | Δx,Δy | NCC |
|---|---|---|---|---|
| lab west-bottom wall junction | [665, 270] | [665, 270] | [0, 0] | 0.91357 |
| lab southwest outer corner | [665, 288] | [665, 288] | [0, 0] | 0.96182 |
| lab southeast outer corner | [877, 288] | [877, 288] | [0, 0] | 0.93311 |
| lab left door hinge area | [790, 266] | [790, 266] | [0, 0] | 0.88429 |
| lab right corridor door hinge area | [885, 258] | [885, 258] | [0, 0] | 0.90378 |
| east upper office bottom boundary | [1001, 279] | [1001, 279] | [0, 0] | 0.89013 |
| east lower office northwest corner | [952, 286] | [952, 286] | [0, 0] | 0.93121 |
| east lower office southwest corner | [955, 449] | [955, 449] | [0, 0] | 0.95911 |
| east lower office southeast corner | [1234, 445] | [1234, 445] | [0, 0] | 0.91179 |
| pantry northwest corner | [361, 440] | [361, 439] | [0, -1] | 0.88472 |
| pantry northeast corner | [583, 439] | [583, 439] | [0, 0] | 0.90649 |
| pantry/storage partition west | [364, 557] | [364, 557] | [0, 0] | 0.95636 |
| pantry/storage partition east | [581, 557] | [581, 557] | [0, 0] | 0.9422 |
| storage/meeting partition west | [361, 639] | [361, 639] | [0, 0] | 0.93866 |
| storage/meeting partition east | [581, 640] | [581, 640] | [0, 0] | 0.94462 |
| meeting/equipment partition west | [360, 783] | [360, 783] | [0, 0] | 0.87491 |
| meeting/equipment partition east | [582, 782] | [582, 782] | [0, 0] | 0.93107 |
| equipment southeast corner | [585, 906] | [585, 906] | [0, 0] | 0.93527 |
| rock room northwest corner | [708, 704] | [708, 704] | [0, 0] | 0.92865 |
| rock room northeast corner | [1177, 705] | [1177, 705] | [0, 0] | 0.82825 |
| rock room southwest/door corner | [708, 906] | [708, 906] | [0, 0] | 0.95263 |
| rock room southeast wall corner | [1155, 908] | [1155, 908] | [0, 0] | 0.96431 |
| main entrance west jamb | [614, 918] | [614, 918] | [0, 0] | 0.94447 |
| main entrance east jamb | [720, 920] | [720, 920] | [0, 0] | 0.9299 |

## 不变量复核

- **same full framing and aspect ratio**: `pass` — 1584x993 source and output; complete exterior silhouette visible without crop/padding/stretch.
- **room boundaries, doorways and wall coordinates**: `no_obvious_visible_layout_shift_but_exact_lock_unverified` — 24 local boundary patches: 23 best-match offsets (0,0); pantry northwest patch at (361,440) matches (361,439), a 1px edge-profile difference. This may reflect sharpening and does not prove wall movement. No gross room/door shift seen in full-image inspection.
- **white chip-test room and existing equipment**: `visually_retained` — White floor/walls, workbench, test instruments, chair, cabinets, column and doors remain at the same visible locations. Fine outlines/textures were enhanced; exhaustive pixel-perfect prop identity is not certified.
- **rock room layout and props**: `visually_retained` — Drum kit, orange and cream guitars, amplifiers, two foreground wedge monitors, acoustic panels, rug, stands and cables retain the visible arrangement. No visible added furniture.
- **pantry/storage/larger meeting/equipment stack**: `visually_retained` — Four left rooms, partition and doorway arrangement retained; empty equipment room remains empty with the existing wall vent.
- **empty open-office floor**: `visually_retained` — Large beige areas remain empty; no added workstations/characters. Floor checker pattern is more contrasty, so texture/color changes exist.
- **no text, characters, new furniture**: `no_visible_additions` — No new labels, characters, signage or furniture visible. Original tiny decorative details were not replaced with legible textual overlays.

## 运行资源隔离

本模块未写入 frontend/index.html、runtime.mjs、layout.json、assets.json 或运行底图；没有在 frontend/company-office/reference-v3/media/background-4k/ 创建可发布文件。候选失败不改变当前预览，也不阻塞主线程修复。
运行文件读回观察：`unchangedAtReadback=True`；运行底图 SHA-256 与快照一致：`True`。

## 绝对路径

- 候选图：`/Users/hepingyu/Documents/ChatGPT/Star-Office-UI/assets/company-office-reference-v3/background-4k-candidate/source/builtin-enhanced-candidate.png`
- 源图快照：`/Users/hepingyu/Documents/ChatGPT/Star-Office-UI/assets/company-office-reference-v3/background-4k-candidate/source/office-background-layered-original.png`
- 最终 prompt：`/Users/hepingyu/Documents/ChatGPT/Star-Office-UI/assets/company-office-reference-v3/background-4k-candidate/prompt/generation-prompt.txt`
- Manifest：`/Users/hepingyu/Documents/ChatGPT/Star-Office-UI/assets/company-office-reference-v3/background-4k-candidate/manifest.json`
- 数值 QA：`/Users/hepingyu/Documents/ChatGPT/Star-Office-UI/assets/company-office-reference-v3/background-4k-candidate/QA/qa.json`
- 边界坐标 QA：`/Users/hepingyu/Documents/ChatGPT/Star-Office-UI/assets/company-office-reference-v3/background-4k-candidate/QA/boundary-coordinates.json`

## 验证边界

此次结论仅针对独立背景候选；没有重测主线程 renderer、字体、右向动画、浏览器 4K 画布或设备分辨率，也没有将任何旧测试结果当作此候选的通过证据。原生分辨率不达标已足够拒绝接入；其余视觉观察不抵消此硬门槛。
