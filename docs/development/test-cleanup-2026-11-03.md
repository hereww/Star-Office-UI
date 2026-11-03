# 项目审查与测试产物清理（2026-11-03）

本次从 `origin/master` 的 `3b34deb3c7324c4d5720f5719d5d558128596c74` 建立清理分支。审查范围是项目测试入口、fixture 依赖、测试产物和正式/Quickstart 发布边界；未执行 Sub2API 宿主完整 Go/Vue 测试或生产验收。

## 已处理问题

| 问题 | 处理 |
| --- | --- |
| `qa_office_active_models.mjs` 导入被 Git 忽略的 `frontend/office/.local/tests/fixtures.mjs`，干净克隆缺失依赖 | 改用已跟踪的 `scripts/fixtures/office_wire.mjs`；Playwright 优先从项目加载，也支持 `OFFICE_QA_NODE_PACKAGE`，移除写死的用户目录 |
| `screen-overlay.test.mjs` 位于公开前端目录；Quickstart 只按目录排除测试，会打入此文件 | 原五项断言移至 `scripts/test_office_screen_overlay.mjs`；Quickstart 同时排除 `test_*`、`*.test.*`、`*.spec.*`、`conftest.py` 和测试/fixture/QA/截图目录，新增隔离回归用例 |
| 旧逐帧截图、浏览器截图和测试特写进入 Git，重新运行 QA 容易污染工作区 | 先复制到仓库外并逐文件校验，再移除 106 个生成图片；增加对应忽略规则及通用测试缓存/报告忽略规则 |
| 前端 README 将未提交的 `.local/tests/` 作为当前测试入口 | 标记其历史性质，新增可复跑的[测试入口](./testing.md) |

## 清理范围与恢复

共 **106 个文件、89,853,200 bytes（85.69 MiB）**，均为已跟踪生成图片：

- `assets/company-office-combined-preview-v1/qa-frames/` 中 48 个 JPG，以及 3 个 `test-detail*.png`。
- `assets/company-office-connected-v4/qa/` 中 13 个截图。
- `assets/company-office-connected-v5/qa/`、`archive/typing-prototype/qa/` 中 41 个图片，以及 1 个 `qa-quick-working-west.png`。

逐文件路径、字节数和 SHA-256 见[清理清单](./test-artifacts-2026-11-03.json)。清理前已将每个文件复制到仓库外的同级目录 `Star-Office-UI-archive-20261103/test-artifacts/`，逐一比对哈希后才删除工作区中的对应文件；归档内另有 `archive-manifest.json`。

恢复单个文件时，先按清单核对归档副本，再复制回原路径。归档只在本机存在；其他克隆可以用清单中的 `source_commit` 从 Git 读取原文件，例如：

```sh
git show 3b34deb3c7324c4d5720f5719d5d558128596c74:assets/company-office-combined-preview-v1/test-detail.png > /tmp/test-detail.png
```

历史 JSON 报告继续记录当时的图片路径，不能据此假定图片仍在干净克隆中。测试源码、保护基线、V3 的 QA mask/重建输入、源素材和生产部署证据均保留。移除当前树文件不会缩减已有 Git 历史。

## 验证结果

| 检查 | 结果 |
| --- | --- |
| Python `unittest discover -s scripts -p 'test_*.py'` | 273 项通过，包含新打包隔离用例；实际本机 HTTP → API → collector → Office → 前端 codec 及 Gunicorn 多 worker 幂等用例通过 |
| 当前 Node 契约命令（见测试入口） | 226 项通过、1 项可选遥测浏览器检查跳过 |
| V5 布局和屏幕 Canvas/Chromium 测试 | 20 项通过，含真实 Chrome Canvas 光栅检查 |
| 组合办公室、V5 摇滚房间、地图交互脚本 | 通过 |
| 正式前端依赖闭包 | 清理前后 244 个文件路径及 SHA-256 完全一致 |
| 正式 Office 包 | verifier 通过；归档 checksum 与全部 524 个文件成员内容核对通过 |
| Quickstart 包 | verifier 通过；归档 checksum 与全部 441 个文件成员内容核对通过；244 个正式前端依赖均存在且字节一致，测试/fixture 路径命中为 0 |
| Git diff 格式检查 | `git diff --check` 通过 |

环境和验证产物位于本机根目录 `.local/review-20261103/`，不提交。此次未运行 Docker 构建、离线安装、完整地图浏览器验收或生产部署。

## 初次审查项（同日后续修复见下文）

1. **历史 V3 播放器测试有 23 项失败。** `scripts/test_office_v3_player.mjs` 的早期脸部贴片 fixture 与当前整帧合同不一致，缺少 `up.working.frames`，且仍比较旧脸部几何；本次扩展测试实际复现。测试及其生产依赖未修改，失败没有被跳过或删除。需后续迁移 fixture、绘制断言和资源基线后再恢复这组测试。
2. **全仓通用安全预检未通过。** `scripts/security_check.py` 命中 Sub2API 冻结补丁 `integrations/sub2api/host-source/openspec/changes/add-openai-compatible-prompt-audit/source-freeze/aicodex-prompt-audit-tracked.patch` 第 461、505 行的两个 `httptest` Authorization 示例常量，分别用于 transport guard/observe 测试，非本次新增。未修改冻结补丁或扩大扫描排除范围，也未对这些常量做外部凭据有效性验证，因此不宣称全仓安全扫描通过。扫描只报告路径与类型，没有输出令牌值。

## 同日修复结果

23 项测试失败均位于 `scripts/test_office_v3_player.mjs`，具体分组如下：

| 原失败项 | 数量 | 处理 |
| --- | --- | --- |
| 冻结模板/运行时资源对应关系、校验器接受有效方向集合与 down fallback | 2 | 冻结模板与当前运行时分开验证；保留原模板哈希与家具复制约束，当前角色检查整帧元数据和尺寸 |
| 初始化幂等、图片加载失败/尺寸错误重试、跨实例缓存隔离、共享初始化失败恢复、浏览器 Image/decode 重试、无效构造参数 | 6 | 合成 loader 为四方向提供 4 套 768×576 图集；故障注入改为实际加载的 `frames-*` 路径 |
| 六状态时钟、同状态 no-op/切换复位、实际重绘返回值、QA setFrame 与无效输入原子性 | 4 | 断言现行“12帧后保持第0帧，按60/36/12帧周期恢复”的完整角色帧行为 |
| 四方向图层与裁剪、背向图集/LED、await 切向保留状态、缺失方向、原子提交、乱序切向、初始化被新切向抢占、初始化尊重已在途切向 | 8 | 背向同样加载完整图集；各方向均验证一次整帧裁剪，无脸部椭圆遮罩、镜像或旋转 |
| 屏幕多边形裁剪不外溢 | 1 | 保留逐像素中心遮罩检查；角色/家具不进入屏幕遮罩 |
| reducedMotion 不改变角色时钟与帧 | 1 | 保留四方向六状态角色断言和静态屏幕检查 |
| 绘制异常后的 context 平衡与重试 | 1 | 整帧绘制和屏幕绘制失败后仍检查上下文、可重试性 |

迁移后该文件 **28/28 通过**，原 23 项失败全部消除。还修复了负例矩阵使用无效 fixture 导致“因其他原因拒绝也算通过”的问题：先验证基础 fixture 合法，再逐项注入错误，并补充整帧路径/帧数/fps/时钟负例。没有删除用例、添加 skip/TODO，或修改生产播放器、素材和冻结模板。

安全预检为两个明确的 `httptest` 示例增加**文件路径 + 完整值 SHA-256** 精确豁免。不是整文件豁免；扫描仍遍历补丁内所有匹配。同文件新增可疑值、相同值换文件、修改示例后缀、其他 key 类型均会报错，且不打印值。新增 `scripts/test_security_check.py` 的 6 项回归全部通过。冻结补丁字节未改，其 SHA-256 仍为 `f751a13cce3f3a73cd60cae3aececcef6e1e76dcec8c551a7a4747f032234d2b`。

最终复跑：Python **279 项通过**；Node **274 项通过、1 项可选遥测浏览器检查跳过**（包含迁移后的 V3 和真实 Chrome Canvas 测试）；本地模式 `security_check.py` 返回 `Result: OK`。没有启动生产服务、使用真实凭据或部署。

复跑时另观察到一次波动：Python 和 Chrome 同时运行的首轮中，Gunicorn 并发 HTTP 用例出现一次 `HTTP 0` 连接失败；随后该用例单独运行、完整 Python 串行回归和连续 8 次同用例复跑均通过。尚未定位该次波动的原因，没有通过增加重试或超时掩盖它。连续复跑的 Gunicorn 日志保存在本机 `.local/review-20261103/gunicorn-diagnostics/`，不作为生产稳定性结论。
