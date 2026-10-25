# Star-Office-UI V5 气泡短状态修复报告

> 核查日期：2026-10-06
> 
> 本文件记录本轮针对用户反馈的气泡、全屏换行和背向工位修复。它不等同于 192.168.100.221:19000 的正式切换证明。

## 已实现

- 地图气泡不再显示用户名、工位编号或并发数字；只显示一个短状态词。
- 可信、最新的工作并发映射为：
  - `0`：`休息中`
  - `1–2`：`工作中`
  - `3–4`：`忙碌中`
  - `5–8`：`玩命干活中`
  - `9+`：`狂暴模式`
- `null`、未跟踪、过期、连接错误、403/429/503 和超时不会被伪装成休息；统一显示数据未知类短文案。
- 气泡使用实际字形宽度贪心换行，保留全部文字，不使用省略号；窄屏、全屏和缩放时重新测量。
- `up` 方向角色的气泡在头部上方被显示器遮挡时，改为工位下方的本地气泡，并保留短引线；不再因避让失败而消失。
- 气泡时钟、角色动画时钟和各工位更新互相独立；旧 `/status`、`/agents` 写入不会覆盖 V5 正式遥测运行时。
- 未绑定工位继续只显示空工位；管理员详情/工位列表仍可保留配置的展示名和真实绑定信息。

## 修改范围

本轮最终冻结包相对线上发布 06 的原始源只改动两个运行时文件：

- `frontend/office/bubble-status.mjs`
- `frontend/company-office/connected-v4/telemetry-adapter.mjs`

角色素材、桌椅、地图、四向资源和既有动画帧未改动。最终包没有把当前工作区中其他并行开发中的角色配置或后端改动带入。

## 本地测试

最终冻结源目录：

`/Users/hepingyu/Documents/ChatGPT/Star-Office-UI/.local/office-status-bubble-fix/source-freeze-bubble-only-01`

定向测试结果：

| 测试 | 通过 | 失败 | 跳过 |
|---|---:|---:|---:|
| `test_office_bubble_status.mjs` | 31 | 0 | 0 |
| `test_office_bubble_layout.mjs` | 26 | 0 | 0 |
| `test_office_telemetry_adapter.mjs` | 33 | 0 | 1 |
| **合计** | **90** | **0** | **1** |

唯一跳过项是原有、需 `OFFICE_TELEMETRY_BROWSER=1` 才会启用的 Chromium 测试；不能把它记为通过。

发布目录校验器 `validate_release.py verify` 已通过。最终发布包：

`/Users/hepingyu/Documents/ChatGPT/Star-Office-UI/.local/office-status-bubble-fix/releases/office-v5-short-status-04.tar.gz`

SHA-256：`dc001a72b6de00ce71759163bdcd1373046d7f4364c0a5ca56bb85517028deda`

## 浏览器验收

- `http://127.0.0.1:58213/`：读取内网办公室的真实快照，仅做隔离预览；页面明确标记“尚未更新服务器”。已看到四个绑定工位气泡只显示短状态，用户列表/详情仍可显示绑定信息。
- `http://127.0.0.1:58214/`：合成夹具页，覆盖 `0/1–2/3–4/5–8/9+` 五档、背向工位、全屏、桌面 DPR2、平板、手机横竖屏和减少动态。
- 已检查全屏全景/绿区、窄屏自动换行、气泡与头部/显示器/相邻气泡不重叠；背向角色的气泡在工位下方可见。

截图证据：

- `.local/office-status-bubble-fix/browser/real-bubble-only.png`
- `.local/office-status-bubble-fix/browser/fixture-fullscreen-overview.png`
- `.local/office-status-bubble-fix/browser/fixture-fullscreen-green.png`
- `.local/office-status-bubble-fix/browser/fixture-phone-portrait.png`

## 正式内网状态与阻塞

`http://192.168.100.221:19000/` 当前仍是线上发布 06：截图和页面状态仍能看到旧的“用户名：数字”气泡。因此本轮**没有宣称正式服务器已经更新**。

当前阻塞是缺少可用的远端 SSH 登录方式：已核对过 root BatchMode、现有明确密钥和旧 ControlMaster/ssh-agent，均不能建立连接。没有连接前不能安全核对远端镜像、挂载、端口占用、备份状态，也不能把本地包直接当成已部署。

恢复访问后应按以下顺序执行：

1. 现场核对当前发布、容器/进程、Nginx、端口和数据卷；先备份并验证可恢复性。
2. 将上述包放入独立发布目录，运行 release verify/preflight，并核对包 SHA。
3. 只更新办公室服务，平滑重载 Nginx/Gunicorn；不重启 Sub2API、PostgreSQL 或 Redis。
4. 用 `19000` 员工视图和 `19443` 管理入口复核短状态、背向工位、配置读回和回滚材料。
5. 任一端口冲突、迁移未完成或回滚材料不完整时停在预发布，不强行换端口上线。

本轮未改 Sub2API 数据库、插件授权范围或凭据签发期限；永久消费凭据应在恢复可验证的 Sub2API 管理/服务器访问后单独执行并读回确认，不能用本地预览代替。

## 2026-10-07 正式上线更新

短状态气泡新版已部署到内网 `192.168.100.221`，发布为 `office-v5-short-status-04`。员工入口仍为 `http://192.168.100.221:19000/`，管理入口仍为 `https://192.168.100.221:19443/admin`。实际部署、绑定读回、浏览器截图、第一次误报自动回退和最终回滚检查请以 [2026-10-07 正式部署报告](DEPLOYMENT_20261007_SHORT_STATUS_ZH.md) 及 `evidence/deployment-20261007/` 为准。

当前绑定为 `desk-09 → 4`、`desk-10 → 7`、`desk-11 → 8`、`desk-14 → 1`；消费凭据到期时间读回为 2026-11-05 13:33:20（北京时间），本轮未执行永久凭据变更。
