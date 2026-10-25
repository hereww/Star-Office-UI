# Star-Office-UI V5 短状态气泡正式部署报告

- **部署日期**：2026-10-07（北京时间）
- **目标主机**：`192.168.100.221`（内网）
- **员工入口**：`http://192.168.100.221:19000/`
- **管理入口**：`https://192.168.100.221:19443/admin`
- **发布目录**：`/opt/star-office-ui/releases/office-v5-short-status-04`
- **发布镜像**：`local/star-office-ui:office-v5-short-status-04`
- **镜像 SHA-256**：`sha256:c075c5bf786b194423971c72684c9a2e4663a283fcd5885a0f04d7dc92477563`
- **归档 SHA-256**：`dc001a72b6de00ce71759163bdcd1373046d7f4364c0a5ca56bb85517028deda`

## 1. 上线结果

2026-10-07 12:14:20（北京时间）完成新版切换。两个办公室服务均已通过健康检查，独立入口服务只做配置校验后平滑 reload：

- `star-office-production-office-web-1`：新版镜像，healthy
- `star-office-production-office-collector-1`：新版镜像，healthy
- 未重启 Sub2API、PostgreSQL、Redis、Kaneo、旧办公室或其他业务容器
- 未改变办公室数据卷、凭据文件、端口和防火墙规则
- 生产配置仍为 **v3**，SQLite `quick_check=ok`，配置和审计记录读回一致
- 公共快照脱敏检查通过；员工端没有邮箱、原始用户 ID、Key/Token 详情
- 管理员 API 未登录请求返回 `401`；员工端旧 `/status`、`/agents`、编辑入口返回 `404`

第一次切换因运维脚本把 Docker 挂载列表按顺序比较而误报，已自动回退到旧版；没有改写生产数据库。修正为按挂载目标语义比较后第二次切换成功。该过程保留在 `deployment-report.json` 和 `deployment-attempt2.log` 中。

## 2. 当前真实绑定与采集范围

上线现场读回的配置版本为 v3，当前绑定如下：

| 工位 | Sub2API 用户 ID |
|---|---:|
| `desk-09` | `4` |
| `desk-10` | `7` |
| `desk-11` | `8` |
| `desk-14` | `1` |

采集授权范围为字符串用户 ID：`1`、`4`、`7`、`8`。本轮没有新增用户、模型 Key 或模拟并发，也没有重新签发消费凭据。

现场读回的消费凭据到期时间为 **2026-11-05 13:33:20（北京时间）**，并非永久；本轮没有把它改成永久，避免把未执行的凭据变更误报为完成。

## 3. 气泡与动画验收

正式页面使用采样快照，不直接让浏览器访问 Sub2API。气泡不再显示用户名、工位号或并发数字，只按可信并发显示短状态：

| 可信并发 | 气泡文字 |
|---:|---|
| `0` | `休息中` |
| `1–2` | `工作中` |
| `3–4` | `忙碌中` |
| `5–8` | `玩命干活中` |
| `9+` | `狂暴模式` |

未知、过期、未跟踪或连接异常不会伪装成休息；背向角色的气泡会避开上方显示器，在工位下方显示。页面仍保持 V5 的 screen-effects-only 边界，不恢复行走模式或手部/键盘动作。

真实内网浏览器验收已覆盖：

- 绿区真实用户气泡和背向工位：`qa/deploy-20261007/lan-green-status.jpg`
- 原生全屏绿区：`qa/deploy-20261007/lan-fullscreen-green.jpg`
- 全景视角：`qa/deploy-20261007/lan-fullscreen-overview.jpg`
- 桌面 1920×1080：`qa/deploy-20261007/lan-desktop-1920x1080.jpg`
- 手机竖屏自动换行：`qa/deploy-20261007/lan-mobile-portrait.jpg`
- 手机横屏：`qa/deploy-20261007/lan-mobile-landscape.jpg`
- 平板 1024×768：`qa/deploy-20261007/lan-tablet.jpg`
- 最终恢复正常窗口、退出全屏的真实绿区：`qa/deploy-20261007/lan-final-green.jpg`

浏览器看到的采样数量会随真实 Sub2API 快照变化；验收没有向生产写模拟状态或制造请求。线上观察到的实际并发为 0–2，只能验证真实休息/工作状态；3 条以上分档和长文案按字形换行由冻结发布包之前的隔离夹具与定向测试覆盖，不冒充线上高并发实测。

1920×1080/DPR2 原生全屏已通过只读浏览器 DOM 状态确认，画布后备分辨率已记录于 `browser-layout.json`；截图本身由浏览器工具按视口尺寸输出 JPEG，不等同于画布像素尺寸。设备尺寸模拟不等于实体手机/平板测试。测试后已清除设备模拟并退出全屏。

浏览器加载观测：97 条响应中唯一的 404 是原页面未设置的 `/favicon.ico`，无核心地图/模块 404、网络加载失败或应用控制台错误。该站点图标缺失不影响地图；本轮未为此夹带额外发布变更。

## 4. 回滚保护

上线前备份位于服务器受限目录：

```text
/home/star-office-backups/20261007-before-short-status-04
```

两个数据卷和旧镜像均完成 SHA 校验及隔离恢复演练。恢复演练只验证备份可恢复性，没有覆盖生产卷。当前版本的回滚检查脚本为：

```text
/opt/star-office-ui/rollback-short-status-to-v5-06.py
```

只读检查：

```bash
python3 -B /opt/star-office-ui/rollback-short-status-to-v5-06.py --check
```

检查已通过，确认旧版 `office-20261006-v5-production-06`、旧镜像、原/现 Nginx 语法和备份 SHA 可用，检查前后业务容器身份不变。真正回滚必须明确执行 `--confirm-office-only-cutover`；只切办公室两个服务，保留当前凭据、用户范围、配置和审计，不恢复应用数据卷。

```bash
python3 -B /opt/star-office-ui/rollback-short-status-to-v5-06.py --confirm-office-only-cutover
```

本次已实际经历并验证一次部署脚本自动代码回退成功；最终独立应急脚本仅执行 `--check` 和 10 项合成辅助函数测试，没有为演练再次切换线上服务。不能把检查或模拟测试写成该脚本执行分支已实机验收。请不要用历史通用 `deploy/office/rollback.sh` 替代此脚本：它的恢复数据卷语义与本次只回退代码的方案不同。

## 5. 运行注意事项

- 主分区使用率约 **96%**，可用空间约 **1.9 GB**；`/home` 可用约 **7.7 GB**。本轮没有擅自删除镜像、缓存或业务数据。
- 管理入口使用包含服务器 IP 的内网证书。管理员设备如果尚未信任内部 CA，需要按证书信任说明完成一次设备侧信任；不应关闭证书校验或绕过浏览器安全提示。
- 采集凭据仍需在到期前按既定范围续签；不要用 Sub2API 管理员 JWT 或模型 Key 替代专用消费凭据。

## 6. 非敏感证据索引

- `evidence/deployment-20261007/status.json`
- `evidence/deployment-20261007/deployment-report.json`
- `evidence/deployment-20261007/post-deployment-audit.json`
- `evidence/deployment-20261007/rollback-check.log`
- `evidence/deployment-20261007/rollback-short-status-to-v5-06.py`
- `evidence/deployment-20261007/rollback-helper-tests.log`（10 项模拟测试，不触达生产）
- `evidence/deployment-20261007/final-readonly-audit.json`（北京时间 12:53 最终现场复核）
- `evidence/deployment-20261007/browser-layout.json`
- `evidence/deployment-20261007/browser-network.json`
- `evidence/deployment-20261007/deployment-attempt2.log` 和 `deployment-attempt3.log`
- `qa/deploy-20261007/`

敏感的 `office.env`、消费凭据、管理员密码哈希、私钥和运行数据库没有复制到本地交付目录，也没有写入本报告。
