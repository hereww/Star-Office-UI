# 最新 V5 角色/工位模板：发布准备完成，正式部署待连接恢复

核验时间：2026-10-07 20:58（Asia/Shanghai）。

**本报告不是上线成功报告。新模板尚未部署到服务器；本轮没有服务器文件写入、配置保存或服务重启。**

## 当前状态

| 项目 | 已验证状态 |
| --- | --- |
| 当前服务器发布版本 | `office-v5-short-status-04` |
| 本次待发布版本 | `office-20261007-v5-character-template-01` |
| 服务器配置版本 | v3 |
| 工位 / 已绑定数量 | 16 / 4 |
| 采集源状态 | `ok` |
| 员工入口、健康、状态快照、TLS 后台入口 | 均 HTTP 200；页面 MIME 为 `text/html` |
| 正式部署阻断 | `root@192.168.100.221` SSH 认证拒绝 |
| 指定 GPT-6-astra 独立审计 | 前两次请求返回 provider 503，没有独立审计结果，不计为通过 |

读取真实服务器 HTTP/TLS 入口，只能证明以上应用层状态。由于 SSH 尚不可用，本轮未验证服务器当前指针、镜像、磁盘、备份、容器重启计数或其他服务状态。

## 最新 V5 集成范围

- 机器可读合同：`connected-v5-character-template-v1`，场景 `company-office-connected-v5`。
- 沿用两组连续长桌、16 工位、四向固定坐姿、局部表情及独立屏幕特效。
- 后台橘猫预览使用真实 V5 `ConnectedSeatedPlayer`，只绘制椅子和角色；不使用旧 V4 独立工位合成器，不叠加家具、行走或敲键盘手部动画。
- 后台候选列表可选择布偶、英短、美短、狸花猫、奶牛猫、狮子白猫、简州猫并查看静态概念图。它们仍是候选而非生产就绪动画：方向/状态控件禁用，不可保存为角色绑定，不替换地图角色。
- 模板 JSON 通过后台同源版本化链接访问，已经纳入发布资源依赖闭包。
- AI 生成 Skill 已明确最新 V5 入口；历史 down 单工位与行走说明仅用于明确历史需求，不再作为默认生成流程。
- 原有 28 个 PNG 保持 SHA 不变；当前 102 个发布源文件逐项校验与不可变包相同。

## 本地测试证据

| 测试组 | 结果 | 证据 |
| --- | --- | --- |
| 后端 API / Store / App 集成 | 91/91 | `backend-tests.log` |
| V5 模板、屏幕、坐姿、气泡等单元 | 103/103 | `v5-unit-final.log` |
| 前端单元 | 30/30 | `frontend-unit-final.log` |
| 发布安全与依赖闭包 | 60/60 | `release-tests-final.log` |
| V5 实际浏览器视觉测试 | 19/19 | `v5-browser-report.json`，端口 19035 重跑的通过结果 |
| 确切发布包的桌面 / 手机 / 后台浏览器测试 | 7/7 | `package-browser-asserted.log` 与 `package-browser-asserted/browser-report.json` |

确切发布包浏览器测试使用隔离模拟 API，并不是生产管理员验收。后端有 SQLite ResourceWarning，但 91 项测试全部成功。Skill 本轮做了入口和未变 YAML 头部的定向检查；完整 `quick_validate.py` 因当前 Python 环境缺少 PyYAML 未执行成功，不安装额外依赖。

证据根目录：`/Users/hepingyu/Documents/ChatGPT/Star-Office-UI/.local/office-v5-character-template-20261007`。

## 不可变发布包

- 路径：`/Users/hepingyu/Documents/ChatGPT/Star-Office-UI/.local/office-v5-character-template-20261007/releases/office-20261007-v5-character-template-01.tar.gz`
- 大小：18,924,005 bytes。
- SHA-256：`ee15d4b8d17e47d08fd02f80b7abf810c71a111995d1582ffa98d3d914d8fa2c`。
- `validate_release.py verify` 通过，未发现私密材料进入公开发布包。
- 复核状态：`/Users/hepingyu/Documents/ChatGPT/Star-Office-UI/.local/office-v5-character-template-20261007/delivery-status.json`。
- 真实入口只读证据：`/Users/hepingyu/Documents/ChatGPT/Star-Office-UI/.local/office-v5-character-template-20261007/live-readonly-recheck-20261007T125715Z.json`。
- 本地候选预览截图：`/Users/hepingyu/Documents/ChatGPT/Star-Office-UI/.local/office-v5-character-template-20261007/package-browser-asserted/admin-demo-british-shorthair.png`。

## 恢复 SSH 后的发布流程

1. 只读读取真实运行版本指针、Office 镜像/容器、独立入口、数据目录、用户采集范围与磁盘余量。旧脚本中的 `office-20261006-v5-production-06` 不能作为当前回滚目标；应使用现场真实基线。
2. 备份并验证当前 release pointer、Office 持久数据/SQLite、env 与独立入口配置。凭据不输出、不纳入公开交付。不能因磁盘紧张未经授权清理其他服务、镜像或业务数据。
3. 传输本次不可变包并核验 SHA，使用已有 Linux wheelhouse 离线构建；仅切换必要 Office 服务和隔离入口。
4. 验证员工 V5、模板 JSON、资源 SHA、TLS 后台 MIME，以及七候选的切换预览与禁用保存；验证配置 v3、原绑定、采集范围/周期及其他服务未改变。
5. 只有新版本实际可用、持久状态读回和回滚检查均通过后，才能写正式上线成功报告。指定 GPT-6-astra 审计须取得真实结果，不能将此前 503 记为通过或静默换模型。

## 用户需要做的一步

请在本机终端使用现有 SSH 登录方式自行认证，密码或私钥不要发送到聊天。如果希望本任务复用已经认证的连接，可执行：

```sh
ssh -M -S ~/.ssh/star-office-v5-deploy.sock -o ControlPersist=15m root@192.168.100.221
```

登录后保持会话，并在本聊天告知已连接。后续可通过该 socket 复用连接，不需要将密码传入工具或存入文件。
