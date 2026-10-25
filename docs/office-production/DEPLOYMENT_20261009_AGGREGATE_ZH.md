# Star-Office-UI 最新聚合版本正式部署报告

- **部署状态**：已正式部署并完成线上读回
- **切换时间**：2026-10-08 20:23:54 UTC（北京时间 2026-10-09 04:23:54）
- **目标服务器**：`192.168.100.221`
- **员工入口**：`http://192.168.100.221:19000/`
- **后台入口**：`https://192.168.100.221:19443/admin`
- **最新 Release ID**：`office-v5-aggregate-20261009-02`
- **服务器发布目录**：`/opt/star-office-ui/releases/office-v5-aggregate-20261009-02`
- **发布镜像**：`local/star-office-ui:office-v5-aggregate-20261009-02`
- **镜像 ID**：`sha256:5d0c37c0cfed984d362eb5114b6bf4f106041488d7ab2fe918378372b1cd74a6`
- **本地不可变发布包**：`.local/office-v5-aggregate-20261009/releases/office-v5-aggregate-20261009-02.tar.gz`
- **发布包 SHA-256**：`373e32667bf6c8e5f2cee9d1d9dc61731581fd7dd955de447b6e9d9397d24635`

> 注：镜像 ID 以服务器构建日志和现场读回为准；上面的镜像 ID 为本轮构建得到的完整值。发布包和服务器均使用不可变 Release ID，没有覆盖旧发布包。

## 1. 本次聚合上线内容

本次不是 V4 覆盖，而是把当前开发对话中已经完成并验收的内容聚合为一个新的 V5 发布包：

- V5 连排长桌和绿区工位左移修正，保留 16 个工位；
- `company-office-connected-v5` screen-only 场景；
- 四向固定坐姿角色、局部表情、独立屏幕特效；
- 12 帧、12fps 的角色表情节奏；
- 明确不包含行走、手部敲键盘或键盘交互；
- 四猫摇滚房间、两层遮挡关系和独立屏幕/舞台效果；
- 可复用角色/工位模板：`connected-v5-character-template-v1`；
- 后台角色预览可切换查看橘猫及七种候选猫；
- 候选猫预览与生产配置隔离，预览不会替换地图角色，也不会写入生产配置。

### 候选猫目录

| 角色 | Profile ID | 当前状态 | 可保存到生产配置 |
|---|---|---|---|
| 橘猫 | `orange-cat-v1` | `ready` | **可以** |
| 布偶猫 | `ragdoll-v1` | `prompt-ready` | 否 |
| 英短 | `british-shorthair-v1` | `prompt-ready` | 否 |
| 美短 | `american-shorthair-v1` | `prompt-ready` | 否 |
| 狸花猫 | `tabby-v1` | `prompt-ready` | 否 |
| 奶牛猫 | `tuxedo-cat-v1` | `prompt-ready` | 否 |
| 狮子白猫 | `white-lion-cat-v1` | `prompt-ready` | 否 |
| 简州猫 | `jianzhou-cat-v1` | `prompt-ready` | 否 |

七种候选猫均为 `production_ready=false`、`assignable=false`，当前只用于概念预览和后续 AI 生成规格登记。它们不会被后台保存为当前生产角色；生产线上仍保持橘猫 `orange-cat-v1`。

## 2. 服务器现场读回

现场读回证据：`evidence/deployment-20261009-aggregate/server-after.json`

- Web 容器：`star-office-production-office-web-1`，`running / healthy`；
- Web 镜像：`local/star-office-ui:office-v5-aggregate-20261009-02`；
- Web 容器重启次数：`0`；
- Collector 容器：仍为 `local/star-office-ui:office-v5-short-status-04`；
- Collector 容器 ID、启动时间、重启次数保持不变；
- Office 独立 ingress：`active`；
- 员工入口、后台入口和健康接口均可访问；
- 其他业务容器没有被本轮重启或重建。

### 生产数据与采集边界

- SQLite `quick_check=ok`；
- 配置版本：`v3`；
- 历史版本数：`3`；
- 审计记录数：`3`；
- 配置 payload SHA-256 保持不变：`22a8c18627022382daf860a9949391d66999ab1469c2743e151f328706433cc4`；
- 采集周期：`5` 秒；
- 采集源最终状态：`ok`；
- 工位数：`16`；
- 真实绑定仍为 `desk-09 -> 4`、`desk-10 -> 7`、`desk-11 -> 8`、`desk-14 -> 1`；
- 当前生产外观读回为 `orange-cat-v1`，`allow_fallback=false`。

本轮没有新增用户、模型 Key、消费凭据或模拟并发，也没有修改现有 SQLite 配置和审计数据。

## 3. 线上只读复核

最近一次只读复核证据：`evidence/deployment-20261009-aggregate/live-recheck-20261008.json`

复核时间为 **2026-10-08 20:38:44 UTC**：

| 检查 | 结果 |
|---|---|
| 员工入口 HTTP 状态 | `200` |
| 健康接口 | `200`，`service=star-office-ui`，`status=ok` |
| 员工首页 Release 标记 | `office-v5-aggregate-20261009-02` |
| 生产快照 | `200`，16 工位，采集源 `ok` |
| 配置版本 | `3` |
| 后台角色目录 | `200`，8 个角色，模板 ID 正确 |
| 可保存角色 | 只有 `orange-cat-v1` |
| 未登录读取后台配置 | `401` |
| 本轮复核写入 | `false`，没有写请求 |

真实 LAN 浏览器验收报告：`.local/office-v5-aggregate-20261009/live-browser-compact/report.json`

- `20 passed / 0 failed`；
- 桌面、平板、手机竖屏、手机横屏均通过；
- 16 个工位和 4 个实际绑定通过；
- V5 模板、四猫摇滚房间和两层遮挡通过；
- screen-only 约束通过：无行走、无手部、无键盘交互；
- 无 JavaScript 错误、资源错误、外部请求或后台写入。

候选猫与后台预览的冻结包浏览器验收覆盖桌面、平板、手机和后台会话隔离，共 `8/8` 通过，证据：`.local/office-v5-aggregate-20261009/package-browser-rerun-01/browser-report.json`。其中的候选预览截图为隔离发布包验收截图，不冒充生产管理员登录后的截图。

## 4. 备份、回滚与保留边界

上线前备份已完成并通过隔离恢复可读性检查：

```text
/home/star-office-backups/20261009-before-aggregate-02
```

备份和切换边界证据：`.local/office-v5-aggregate-20261009/backup.log`

- 在线备份 SQLite 数据库，没有停止 Collector；
- Office 数据卷和旧 Web 镜像均已归档；
- 隔离恢复读回通过；
- 没有覆盖生产数据卷；
- 没有删除历史发布包、旧镜像或回滚材料；
- 只切换了 Office Web 和对应的独立 ingress 引用；
- Collector、Sub2API、PostgreSQL、Redis、Kaneo 及其他业务服务不在本轮重启范围内。

服务器根分区现场约 **92%** 使用率、剩余约 **3.5G**。本轮没有因磁盘紧张直接删除任何历史发布包、备份或其他业务数据；清理应另行审计和执行。

## 5. 测试与验收摘要

| 测试组 | 结果 | 证据 |
|---|---:|---|
| 后端/API 回归 | `91/91` | `.local/office-v5-aggregate-20261009/api-regression-02.log` |
| 后端全量测试 | `197/197` | `.local/office-v5-aggregate-20261009/backend-all-tests.log` |
| V5 实际浏览器测试 | `19/19` | `.local/office-v5-aggregate-20261009/v5-browser-report.json` |
| 冻结发布包浏览器验收 | `8/8` | `.local/office-v5-aggregate-20261009/package-browser-rerun-01/browser-report.json` |
| 真实 LAN 浏览器验收 | `20/20` | `.local/office-v5-aggregate-20261009/live-browser-compact/report.json` |
| 发布安全/依赖闭包 | 通过 | 发布目录 `release-manifest.json`、`SHA256SUMS` |
| 发布包完整性 | 通过 | `validate_release.py verify` 记录 |

历史像素保护套件的 `v5-pixel-report.json` 仍记录有 inherited baseline mismatch，具体是历史 `frontend/company-office/reference-v3/runtime.mjs` 基线不一致；另一次运行还遇到本机 `127.0.0.1:19000` 未启动。该套件不能写成“完整像素回归全部通过”，但不影响本次已冻结发布包的运行时、发布安全、隔离浏览器和真实 LAN 验收结论。

## 6. 规划与审计代理状态

- 规划代理按要求使用 **`gpt-6.1-sol`**，已完成兼容性检查：旧 Collector 可保持不变，新 Web 与现有 v3 SQLite 兼容，候选预览不写生产配置，Web-only 切换边界成立。
- 独立审计按要求使用 **`gpt-6-astra`**。但本轮向 `http://192.168.100.221:8080/v1/responses` 发起的审计请求多次返回 provider `503`，没有拿到有效的 Astra 审计结果。
- 因此本报告只把发布包检查、服务器现场读回和真实浏览器验收记为通过；**不把 GPT-6-astra 审计写成通过，也没有静默换用其他模型代替**。

## 7. 当前结论与后续边界

**结论：最新聚合版已经正式部署到 `192.168.100.221`，当前线上不是 V4，而是 `office-v5-aggregate-20261009-02`。**

当前可以直接使用：

1. 员工端查看 V5 16 工位实时办公室；
2. 后台查看角色动画和七种候选猫的概念预览；
3. 在候选预览中切换查看，不会误写生产角色；
4. 后续以 `connected-v5-character-template-v1` 为模板继续生成完整角色素材。

尚未声称完成的事项：

- 七种候选猫还没有成为生产可分配角色；
- 本轮没有做完整的生产后台管理员登录后逐只视觉走查；
- GPT-6-astra 独立审计因 provider 503 尚未完成；
- 历史 inherited pixel baseline mismatch 尚未被改写成通过。
