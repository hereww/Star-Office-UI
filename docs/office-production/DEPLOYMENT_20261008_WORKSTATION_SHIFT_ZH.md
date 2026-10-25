# 2026-10-08 绿区整组工位左移修正与部署记录

## 结果

2026-10-08 **22:02:27（北京时间）**完成内网发布，随后通过真实 LAN 浏览器验收。绿区横向 8 席工位整体左移，右端不再与原背景柱子重叠。

- 员工入口：`http://192.168.100.221:19000/`
- 管理入口：`https://192.168.100.221:19443/admin`
- 新发布：`office-v5-layout-shift-06`
- 镜像：`local/star-office-ui:office-v5-layout-shift-06`
- 镜像 SHA：`sha256:304b8992408130e27bfa64296136b4298d852592344410a80d263bea38cf9b8e`
- 发布包 SHA：`270d2d83e9f40749d18122214070724a603229ec24a4b5efc59d6ecc5085e341`
- 生产配置仍为 **v3**；快照采样状态为 **ok**。

## 修改范围

只修改 `frontend/company-office/connected-v5/layout.json` 的 **10 个 X 坐标**，统一水平偏移 **-48 个地图单位**。

| 对象 | 修改前 | 修改后 |
|---|---|---|
| 横向工位组 fit | `[760,488,420,200]` | `[712,488,420,200]` |
| 上排四席 X | `802,907,1012,1117` | `754,859,964,1069` |
| 下排四席 X | `802,907,1012,1117` | `754,859,964,1069` |
| 绿区视角中心 | `[963,577]` | `[915,577]` |

桌组、角色接触点、椅子、屏幕与气泡跟随同一布局同步移动。Y 坐标、座位间距、人物方向、比例、动画时钟及背景地图保持不变；未新增行走、手部或键盘交互。

以现有背景柱子及阴影的保守包围框 `[1158,588,80,110]` 作回归检查。家具**全部非透明像素**的最右世界坐标约 `1133.55`，间距约 **24.45 个地图单位**。没有与原有 `lab`、`right-offices`、`left-rooms`、`rock-room` 禁入区相交。

新增专用回归测试：`scripts/test_office_connected_v5_layout.mjs`。此保护只用于测试，未改变地图的禁入区或素材。

## 发布与保留边界

本次从已部署 `office-v5-short-status-04` 的不可变发布包冻结源码，再仅合并上述几何变化；**没有把当前工作区其他开发内容一起发布**。

- 97 个发布源文件中只有布局文件的源字节变化。
- 28 个原有图片资源 SHA 全部保持不变；包中没有凭据、运行时数据库或测试 hook。
- 镜像以现场已验证的上一版镜像为基础，仅新增布局与 manifest，依赖和后端代码保持相同；镜像内全部 97 个源文件校验通过。
- **只重建 `office-web`**。`office-collector` 的容器 ID、镜像、启动时间、挂载和重启计数均未改变，仍运行上一版且 healthy。
- Sub2API、PostgreSQL、Redis、Kaneo、旧办公室及其他业务容器在本次切换边界前后身份/镜像/启动时间/重启计数保持一致。
- 不改消费凭据、管理员密码、证书、SQLite 配置、数据卷、端口和防火墙。
- 保留当日已批准的只读公网 Host、员工路由与内网管理限制。
- 独立 Nginx 主配置字节不变；实际 `office-public-employee.conf` 中只替换发布 ID，语法校验后平滑 reload。

当前绑定读回：

| 工位 | 用户 ID |
|---|---:|
| desk-09 | 4 |
| desk-10 | 7 |
| desk-11 | 8 |
| desk-14 | 1 |

SQLite `quick_check=ok`；配置版本 3、历史版本数 3、审计条数 3、配置 payload SHA 均保持一致。

前期只读检查发现采集器存在上游错误；切换前已独立恢复正常。本次没有通过重启采集器或伪造空闲来处理该问题，最终实际遥测为 `ok`。

## 验收结果

| 检查 | 结果 |
|---|---|
| 隔离发布源运行时/屏幕/气泡/遥测桥接测试 | **109/109** |
| 新增整组左移与全部 alpha 像素柱子避让测试 | **2/2** |
| 发布工具单元测试 | **60/60** |
| 隔离不可变包浏览器检查 | **14/14** |
| 真实 LAN 浏览器检查 | **14/14** |
| 上线后只读 HTTP/TLS/路由/快照审计 | **18/18** |
| 回滚文本变换及拒绝歧义检查 | **8/8** |
| 回滚脚本现场 `--check` | **通过；未实际执行回滚切换** |
| `git diff --check` | **通过** |

浏览器覆盖桌面 `1920×1080 / DPR2`、真实 Fullscreen API、平板、手机横竖屏，均确认工位不与柱子重叠、四个真实绑定气泡可见、背向 `desk-14` 气泡正常、轮询不移动镜头或重置角色时钟。未发现 JavaScript 错误、核心资源 404、外部素材请求或后端写入。这些是浏览器设备模拟检查，不替代所有实体设备认证。

生产验收没有创建测试用户、模型 Key、虚假并发或压力请求；并发阈值测试使用隔离本地快照。最终生产截图来自未注入任何测试 hook 的真实页面。

截图：

- `qa/deploy-20261008/lan-final-green.jpg`
- `qa/deploy-20261008/lan-final-fullscreen-green.jpg`
- `qa/deploy-20261008/lan/desktop-dpr2-overview.jpg`
- `qa/deploy-20261008/lan/phone-portrait-green.jpg`
- `qa/deploy-20261008/lan/phone-landscape-green.jpg`

## 备份与回滚

独立备份：

```text
/home/star-office-backups/20261008-before-workstation-shift-06
```

保存旧镜像归档、旧 manifest、受限 env、Nginx wrapper 和实际 include，以及 office/legacy 两个数据卷。数据卷使用 SQLite 在线备份 API；归档 SHA 复核并在私人临时目录解包验证数据库可恢复性，**没有恢复或覆盖生产卷**。

回滚工具：

```text
/opt/star-office-ui/rollback-workstation-shift-to-short-status-04.py
```

默认只读校验：

```bash
python3 -B /opt/star-office-ui/rollback-workstation-shift-to-short-status-04.py --check
```

只有在明确需要回退时执行：

```bash
python3 -B /opt/star-office-ui/rollback-workstation-shift-to-short-status-04.py --confirm-web-only-cutover
```

该脚本只将 web 镜像、发布 ID 和已验证的 ingress include 切回 `office-v5-short-status-04`；不回退当前数据库、工位绑定或凭据，不重启 collector/其他容器。如果之后有人修改过 ingress，脚本拒绝强行覆盖，要求先核查现场。

已经验证备份完整性、隔离解包、原镜像 ID、两个发布包、Nginx 新旧语法和回滚参数变换；**没有为演练再切换线上服务**，不能把 `--check` 写成回滚执行分支已实机验收。

## 发布过程说明

- 本地 `office-v5-layout-shift-05` 因校验发现没有预期布局 delta 被拒绝，从未上传或上线；最终使用新的不可变 ID `06`，没有覆盖旧包。
- 第一次远端构建已完成备份与镜像，但部署检查发现当前 Nginx 已改为 wrapper/include 结构，发布 ID 不在 wrapper 内；检查在写入线上 env、重建 web 或 reload 之前停止。
- 随后读取真实 include，复用已校验的备份、不可变包和已构建镜像完成最小切换。原失败日志保留在私人 staging，未把模板配置覆盖到已批准的公网入口。

非敏感证据位于 `evidence/deployment-20261008-workstation-shift/`。秘密文件和备份数据均仅保留在服务器受限目录，没有导出到报告、截图或 Git。
