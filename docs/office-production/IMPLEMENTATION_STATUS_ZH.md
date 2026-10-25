# Star-Office-UI 正式版：实现与发布验收记录

> 最新四用户紧凑单行气泡与内网接入状态见 `COMPACT_BUBBLES_ZH.md`；RC4 两行气泡历史见 `FOUR_USER_BUBBLES_ZH.md`；下文保留 RC3 单用户历史验收，不覆盖其证据。


日期：2026-10-04 · 时区：Asia/Shanghai。

**当前状态：新版代码、离线部署包与本地隔离验收已完成；未部署到 192.168.100.221。**
生产接入、真实用户 1 遥测验收、服务器备份和实际切换/回滚仍等待可用 SSH。
本文中的浏览器截图与 Token/并发数据全部来自合成夹具，不是线上运行证据。

## 1. 已实现范围

- 继续使用 Flask、Phaser 和 ES Modules，保留 V4 连排工位、红区/绿区各 8 席。
- 默认仅绑定字符串用户 ID `"1"` 到 `desk-12`；其他 15 席显示空桌椅，不伪造员工。
- 员工页面提供脱敏快照、选席、显式聚焦、视角、全屏和可折叠详情；手机采用底部抽屉。
  手机点击聚焦先关闭遮挡画布的抽屉；遥测更新不会重开抽屉或移动镜头。
- 管理员五页：运行概览、工位绑定、隔离动画预览、显示设置、数据源诊断。
- 单实例采集进程默认每 5 秒读取上游，浏览器每 2 秒读取本地快照。
  `5/10/30` 秒采集配置可保存；等待期间检查周期变更，不增加浏览器相关的上游任务。
- 原子快照、独立 SQLite 配置/历史/审计、乐观版本校验，恢复历史形成新版本。
  前端执行草稿→预览→保存→完整 GET 内容与版本读回确认。
- 独立密码哈希与服务器会话，HTTPS-only 管理、CSRF/同源、共享 SQLite 登录预算。
  Cookie 强制 Secure/HttpOnly/SameSite=Lax；旧 Flask/素材抽屉会话不能冒充新管理员。
- 可信正并发使用 working/writing，可信零值使用 idle，未知或异常使用中性静态。
  失败快照清空敏感缓存；401/403/429/503 不映射成空闲或“请求失败”动画。
- 用户 ID、Key ID、Token 总量保留字符串；空用户名不伪造，未知保留 null。
  管理详情按 `quality.identity` 展示用户名/邮箱质量，按并发字段时间显示观测时间。
- 演示预览是独立场景，支持四向/六状态且无后台写入；正式场景不消费旧 `/status`、`/agents`。
- 原素材与布局不改，12fps 及 60/36/60/12 帧时钟保持。987 个受保护文件哈希无差异。

未扩展 Sub2API 插件协议、未读取其数据库、未上传新素材、未加入行走或任务分析。
4 个开发子任务均采用明确指定的 GPT-6.1-sol；没有静默替换模型或新建用户聊天。

## 2. 关键交付

以下路径相对于本仓库，仅用于文档索引：

| 内容 | 文件/目录 |
|---|---|
| 固定接口、字段与配置契约 | `docs/office-production/API_CONTRACT_V1.md` |
| 采集器与新 API | `backend/office_collector.py`、`backend/office_api.py` |
| 配置、鉴权、质量规则 | `backend/office_store.py`、`office_security.py`、`office_contract.py` |
| 员工/管理前端 | `frontend/office/`，交接见其中 `README.md` |
| V4 遥测适配器 | `frontend/company-office/connected-v4/telemetry-adapter.mjs` |
| Docker、Compose、Nginx、证书、备份/回滚 | `deploy/office/`，操作见其中 `README.md` |
| 本地合成端到端验收程序 | `scripts/qa_office_production_browser.mjs` |
| 最终验收证据 | `docs/office-production/evidence/` |

### 当前发布候选

- Release ID：`office-20261004-v1-rc3`；旧 RC1/RC2 原样保留，不覆盖同名归档。
- 归档：`deploy/office/out/office-20261004-v1-rc3.tar.gz`。
- 外部 SHA256：`2a236a234a4be766f274379e525e0f97378d29a46c14ea948c8b84648d6a7901`。
- 包内 `release-manifest.json`、`SHA256SUMS`，以及归档外部 `.sha256` 均已校验。
- 85 个源文件；发布白名单与实际运行依赖闭包选出 59 个前端文件，包含 28 个原字节 PNG。
- 10 个官方 PyPI wheels，完整依赖闭包、文件/RECORD/官方 SHA256 已验证。
  **仅为候选 Linux CPython3.11 x86_64 / glibc≥2.17；远端架构尚未确认。**
- 155 个 payload 文件秘密排除扫描，0 findings；无实际 .env、消费凭据、密码 hash 文件、
  私钥、运行数据库/快照、fixtures、QA 图片或未选择的候选素材。
- 本机无 Docker/Nginx，未构建镜像或启动生产容器。`offline_wheelhouse=true` 只表示
  包内有经审阅的依赖，不代表服务器架构、base image 或真实容器权限已验证。
- 极简发布包不包含旧完整编辑界面；保留旧镜像负责回退。
  兼容 API 仍受独立管理员会话保护；缺失旧 HTML 时 `/legacy` 安全返回 404 而非 500。
  **旧客户端迁移证据未完成时不能切换生产。**

## 3. 主线程实际复验

| 验收 | 结果 | 证据 |
|---|---:|---|
| 后端、持久化、安全和宿主边界 | 105/105 | `python-final-tests.txt` 中对应测试，共与发布测试合计 149 项 |
| 发布包、临时备份恢复、安全 tar 等 | 44/44 | 同上 |
| 运行时原基线与新增遥测测试 | 118/118，无跳过 | `runtime-unit-tests.txt`；包含真实 Chrome 检查 |
| 前端契约、元数据、保存结果准确性 | 50/50 | `frontend-unit-tests.txt` |
| 实际采集器→2 worker Gunicorn23→Flask/TLS→Chrome | 25 组通过 | `browser-acceptance.json` |
| 原素材/manifest/保护清单哈希 | 987 项无变化 | `asset-integrity.json` |
| 采集进程停止后自动过期 | 约 14.8 秒后 unknown，非 idle | `collector-stale.json` |
| 重启时上游 503 | 原成功快照不重新变新鲜；恢复后重新采样 | `collector-restart.json` |
| 冻结发布源码与包内校验 | 无差异，秘密 0 findings | `release-source-integrity.json` |
| 最终 RC3 包的实际静态依赖、画布和快照 | 通过，资源/页面错误为 0 | `package-browser.json`，仅 loopback 静态 harness，不是 Nginx 容器验收 |

浏览器检查覆盖：空用户名、跨两个 Key 汇总及 `9223372036854775808` 字符串精度；
可信正并发/零值、null/untracked、401/403/429/503、本地读取失败及恢复；
匿名权限、CSRF、重复绑定拒绝、保存→读回、Gunicorn 新 worker 后持久化、409 防覆盖、历史恢复；
独立预览不写真实状态、四向/六状态；桌面1920×1080/DPR2、平板、手机横竖屏及手机管理。

页面异常、外部网络请求和旧状态接口请求均为 0。主员工视图加 3 个新查看端、管理员同时查看，
该观察窗仅产生 3 次上游采集请求，未随浏览器数放大。

本地运行环境是 macOS/Python3.12.14/Gunicorn23，**不是 Linux CPython3.11 容器验收**。
Chrome 设备尺寸模拟不等于实体手机/平板确认。浏览器测试只对本轮 localhost 测试证书做精确
SPKI 匹配；直接 TLS 请求使用对应 CA 文件校验，未更改系统信任或关闭生产证书校验。

隔离员工预览在 `http://127.0.0.1:19025/`：实际 RC3 静态资源，页面额外标识模拟遥测；
管理源代码本地 TLS 验收已完成，不能用测试证书替代管理员设备的正式证书信任验收。

## 4. 远端状态与不能越过的门槛

- 已做只读可达性核查：19000 原办公室可用；8080 Sub2API 可用；19001 已占用。
  新应用私有端口固定为 **127.0.0.1:19011**，员工 19000、管理 19443 不变。
- 现有 SSH 密钥未能完成服务器认证；没有服务器容器/卷/Nginx/firewall 的现时清单。
  历史 `/opt/star-office-ui` 与 Nginx 路径只是候选，不能当作当前确认事实。
- 插件范围曾在只读核查中显示包含用户 1/4/7/8。本办公室消费器仍固定用户 1；
  **不得缩小/覆盖共享插件批准范围以迁就本消费器**。
- 尚未签发生产消费凭据，未保留 Sub2API 管理员 JWT 或模型 Key。
- 未改线上配置、未启动/停止线上办公室、未重启 Sub2API/PostgreSQL/Redis，未切换流量。

获得访问后严格按 `deploy/office/README.md` 执行：

1. 只读确认旧服务/挂载/客户端、服务器架构/libc、端口、Nginx及防火墙。
2. 备份现有办公室的真实镜像、配置、数据，验证在隔离路径可恢复；保留旧挂载。
3. 安全签发仅用户1、30天专用消费凭据，受限文件仅 collector 读取。
4. 安装带服务器 IP SAN 的内网证书，管理员设备确认信任，不跳过证书错误。
5. 单用户预发布，验证真实采样/未知/恢复、容器UID10001、只读 rootfs 和卷持久化。
6. 仅在客户端迁移、回滚及预发布验收通过后切换 19000/19443；必要时 Nginx `-t` 后平滑重载。
7. 失败恢复旧办公室并停止新采集器；不改写 Sub2API 数据库。

`preflight.sh` 是首次安装门槛，不擅自换端口。
`backup.sh/rollback.sh` 的新办公室卷逻辑已用临时 SQLite/snapshot 测试；
**首次旧办公室迁移和远端真实回滚必须按现场清单执行，尚未通过实际服务器演练。**

## 5. 复现命令

在仓库根目录，复用本轮隔离 venv：

```bash
PYTHONDONTWRITEBYTECODE=1 .local/office-production-20261004/venv/bin/python -m unittest \
  scripts.test_office_store scripts.test_office_collector scripts.test_office_api \
  scripts.test_office_app_integration scripts.test_office_release -q

node --test frontend/office/.local/tests/*.test.mjs

OFFICE_TELEMETRY_BROWSER=1 node --test \
  scripts/test_office_v3_runtime.mjs scripts/test_office_v3_player.mjs \
  scripts/test_office_v3_render_quality.mjs scripts/test_office_connected_v4_contract.mjs \
  scripts/test_office_telemetry_adapter.mjs
```

端到端脚本只接受 loopback 地址和本地明确合成夹具密码环境变量，拒绝生产主机。
运行会修改**测试数据库**并在本地滚动重载测试 Gunicorn worker，勿改为真实地址。

未提交/未跟踪的原地图与素材没有被 reset 或覆盖；本轮前置源码备份受限保存在
`.local/office-production-20261004/preflight/source-before.tar.gz`，不在部署包中。


## 2026-10-06 正式部署状态（覆盖上文历史 RC/未上线状态）

用户授权服务器部署后，已完成现场备份、V5 正式入口修复、仅用户 1/4/7/8 的已批准 consumer 接入、独立办公室 ingress 及实际验收。最终发布为 `office-20261006-v5-production-06`。

- 员工 `http://192.168.100.221:19000/`，管理 `https://192.168.100.221:19443/admin`。
- 使用现有专用 consumer，未签发新凭据或改写/缩小共享插件范围；本轮实际读取范围不是历史 RC 的单用户默认值。
- V5 16 席 screen-only、354 项本地/回归和最终 46 项实机检查通过。
- 原 11 容器身份/镜像/启动时间不变，旧 160 源文件 SHA 不变；旧系统和新状态的隔离恢复真实演练通过。
- 当前回退脚本仅 `--check` 验证，未生产切回；管理员设备 CA 信任仍需本人完成。

上文首次迁移步骤、待凭据/待访问/未演练等内容是历史状态，不可当作当前事实；本轮已批准范围、已执行动作及未完成边界以 [2026-10-06 正式交付报告](DEPLOYMENT_AUDIT_20261006_ZH.md) 为准。

## 2026-10-09 最新聚合版本正式部署状态

上一节的 `office-20261006-v5-production-06`、2026-10-07 短状态版和 2026-10-08 工位左移版均保留为历史不可变发布记录；当前线上以本节为准。北京时间 2026-10-09 04:23:54（UTC 2026-10-08 20:23:54）已完成 Web-only 正式切换：

- 最新 Release ID：`office-v5-aggregate-20261009-02`；
- 员工入口仍为 `http://192.168.100.221:19000/`，后台入口仍为 `https://192.168.100.221:19443/admin`；
- 已聚合 V5 连排长桌/绿区左移、角色/工位模板、四猫摇滚房间、两层遮挡和七种候选猫后台概念预览；
- 候选猫全部保持 `production_ready=false`、`assignable=false`，橘猫仍是唯一可保存的生产角色；
- Web 容器 healthy，Collector 镜像、容器 ID、启动时间和重启计数未变化；
- SQLite `quick_check=ok`，配置版本 3、历史版本 3、审计记录 3、既有绑定和采集周期保持不变；
- 真实 LAN 浏览器验收 `20/20` 通过，发布包浏览器验收 `8/8` 通过；
- 上线前备份位于 `/home/star-office-backups/20261009-before-aggregate-02`，没有执行回滚或删除历史材料。

正式报告：[DEPLOYMENT_20261009_AGGREGATE_ZH.md](DEPLOYMENT_20261009_AGGREGATE_ZH.md)。

独立 GPT-6-astra 审计本轮因 provider `503` 未取得有效结果，不计入通过；规划代理按要求使用 GPT-6.1-sol 并完成兼容性检查。历史像素保护套件仍有 inherited baseline mismatch，不能把它写成完整像素回归通过。
