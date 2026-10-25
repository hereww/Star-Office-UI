# 发布包有界交付记录（2026-10-04）

## 完成边界

仅新增 `deploy/office/`、`scripts/package_office_release.py`、`scripts/test_office_release.py`。
未修改 backend/frontend/既有素材/docs/共享契约；未访问远端、未签发凭据、未创建CA、未部署/重启服务。

## RC归档

- Release ID：`office-20261004-v1-rc1`
- 静态前缀：`/static/releases/office-20261004-v1-rc1`
- 应用 host 绑定：`127.0.0.1:19011`，19001已占用，绝不替换。
- 外部：192.168.100.221:19000只读、:19443 HTTPS；19443/19011冲突立即停止。
- 归档：`deploy/office/out/office-20261004-v1-rc1.tar.gz`
- 完整选择/字节校验清单：同release目录 `release-manifest.json` 和 `SHA256SUMS`。
- 归档SHA256：`bc671e1075eb3869e15f6e79e21c1c660766f5d914bf569105b7fc027c89129d`
- 前端选择：59个文件（28 PNG、21 ES Modules、6 JSON、2 HTML、1 CSS、1本地Phaser JS）。
- 总源文件：85；归档文件：148。原图PNG无转码，源副本/public副本/现有原图SHA256均相等。
- 私密材料审计：146 payload files，0 findings；独立tar member排除检查再次通过。

## 验证

- 主线程隔离venv：Python 3.12.14；`scripts/test_office_release.py` 44/44通过。
- 全部发布shell脚本 `bash -n`通过；包完整性验证及外部归档SHA通过。
- 发布Python文件的3.11语法检查通过（**不是Python3.11容器启动验收**）。
- 测试全部使用temporary fixture，包含原图字节、依赖闭包、私密文件排除、同机HTTP显式开关、
  秘钥独立/强度、hash含$原样读取、无路由注册拒绝、匿名legacy拒绝/写入CSRF、端口冲突停止、
  临时SQLite+snapshot备份恢复、危险tar/损坏DB拒绝且保留旧数据。
- 输出日志：`deploy/office/test-release.log`（不进入发布包）。

## 剩余上线门槛

1. SSH尚未取得；/opt/star-office-ui路径、旧容器/卷/Nginx/firewall和客户端迁移须主线程核实。
2. 本机无Docker/Nginx实机；未构建镜像、未启动容器、未验证TLS信任/实际卷权限/远端回滚。
3. 本RC未提供Linux CPython3.11 wheelhouse：`offline_wheelhouse=false`，离线build/preflight硬停止。
   目标须复用经核实的缓存Python3.11 image与完整同架构wheelhouse；不自动联网下载。
4. 私密env、独立Office signing secret、FLASK_SECRET_KEY、strong ASSET_DRAWER_PASS、admin hash、
   consumer file和证书均需主线程从安全渠道预置，消费文件仅collector只读bind，实际UID10001/0400或0600。
5. 上游默认HTTPS；同机HTTP只准显式OFFICE_ALLOW_HTTP=1 + literal 192.168.100.221，管理始终HTTPS。
6. 旧客户端兼容入口为HTTPS `api/office/admin/compat/<旧路径>`，必须迁移并通过登录/CSRF。
   本RC仅包含V4精选资源；完整旧场景/编辑器的回退依赖保留的旧镜像和旧数据，不宣称已在新包验收。
7. 此RC是集成过程中源码快照；浏览器QA完成并冻结源码后，必须新release ID重打包。
   严禁把44个fixture测试或静态包校验当作容器/生产/浏览器验收。

## PNG选择清单

- `frontend/company-office/connected-v4/media/horizontal/desk-bank-horizontal.png`
- `frontend/company-office/connected-v4/media/vertical/connected-vertical-eight-seats.png`
- `frontend/company-office/media/character-base.png`
- `frontend/company-office/media/face-error-dizzy.png`
- `frontend/company-office/media/face-idle-sleep.png`
- `frontend/company-office/media/face-syncing.png`
- `frontend/company-office/media/face-working.png`
- `frontend/company-office/reference-v3/media/character-left/repair-v2/character-base.png`
- `frontend/company-office/reference-v3/media/character-left/repair-v2/face-error.png`
- `frontend/company-office/reference-v3/media/character-left/repair-v2/face-idle.png`
- `frontend/company-office/reference-v3/media/character-left/repair-v2/face-syncing.png`
- `frontend/company-office/reference-v3/media/character-left/repair-v2/face-working.png`
- `frontend/company-office/reference-v3/media/character-right/repair-v4-aligned/base.png`
- `frontend/company-office/reference-v3/media/character-right/repair-v4-aligned/face-error.png`
- `frontend/company-office/reference-v3/media/character-right/repair-v4-aligned/face-idle.png`
- `frontend/company-office/reference-v3/media/character-right/repair-v4-aligned/face-syncing.png`
- `frontend/company-office/reference-v3/media/character-right/repair-v4-aligned/face-working.png`
- `frontend/company-office/reference-v3/media/character-up/base.png`
- `frontend/company-office/reference-v3/media/furniture/down-back.png`
- `frontend/company-office/reference-v3/media/furniture/down-front.png`
- `frontend/company-office/reference-v3/media/furniture/left-back.png`
- `frontend/company-office/reference-v3/media/furniture/left-front.png`
- `frontend/company-office/reference-v3/media/furniture/right-back.png`
- `frontend/company-office/reference-v3/media/furniture/right-front.png`
- `frontend/company-office/reference-v3/media/furniture/up-back.png`
- `frontend/company-office/reference-v3/media/furniture/up-front.png`
- `frontend/company-office/reference-v3/media/server-rack.png`
- `frontend/company-office/reference-v3/office-background-layered.png`
