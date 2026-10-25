# Sub2API 集成源码

本目录保存 Star Office UI 对 Sub2API 用户遥测所需的完整可复现源码边界：

- `host-source/`：基于 Sub2API 上游固定提交的宿主源码，包含本地 `user-telemetry` API、插件宿主、管理员接口、迁移和前端插件管理改动。
- `host-source/backend/cmd/user-telemetry-plugin/`：只读用户遥测原生插件的 Go runtime、配置校验、HostService 交接、UI bridge 和测试。
- `plugin-tools/`：`.s2plugin` 打包、Ed25519 验签、公钥导出和独立测试工具。它不构建宿主、不启动二进制、不保存签名私钥。
- `patches/`：对应历史遥测版本的宿主补丁、manifest、schema 和安装说明；签名 `.s2plugin`、私钥、构建缓存和 `node_modules` 不放入仓库。
- `SOURCE_MANIFEST.json`：上游仓库、固定提交、目录用途和排除项。

当前宿主来源为：

```text
https://github.com/Wei-Shaw/sub2api.git
commit b8dece9000c68815a5b867ca5a1e6f236e173905
```

该目录保留 Sub2API 原有 `LICENSE`、README 和上游声明。Star Office UI 的 Python 后端只读取 Sub2API 的受限遥测接口，不把管理员 JWT、模型 Key、原始请求或计费凭据发送到浏览器。

为通过 GitHub Push Protection，宿主副本中上游 Google/Gemini OAuth client ID 和 client secret 已替换为 `REDACTED_*` 占位符；生产环境必须通过受控配置注入真实值，仓库不保存任何 OAuth 凭据。

## 构建与验证边界

先进入宿主源码目录安装 Go/Node 依赖；不能把当前仓库中排除的 `node_modules` 或构建产物当作源码依赖：

```bash
cd integrations/sub2api/host-source/backend
go test ./cmd/user-telemetry-plugin/...
go vet ./cmd/user-telemetry-plugin/...

cd ../frontend
pnpm install --frozen-lockfile
```

插件 UI 的 bridge 测试：

```bash
cd integrations/sub2api/host-source/backend
node --test cmd/user-telemetry-plugin/ui/bridge.test.cjs
node --test cmd/user-telemetry-plugin/ui/bridge-http-compat.test.cjs
```

`.s2plugin` 打包工具测试：

```bash
cd integrations/sub2api
PYTHONDONTWRITEBYTECODE=1 \
python3 -m unittest discover -s plugin-tools/tests -v
```

正式签名必须使用仓库外受控保存的 Ed25519 私钥；不要把私钥、真实 token、密码、`.env`、数据库、签名包或运行时缓存复制到本项目。打包工具的完整命令和宿主信任公钥配置见 [`plugin-tools/README.md`](./plugin-tools/README.md)。

## 与 Star Office UI 的连接

Star Office UI 的 `backend/office_collector.py` 只使用以下只读端点：

```text
GET /api/v1/plugins/{installation_id}/user-telemetry/status
GET /api/v1/plugins/{installation_id}/user-telemetry
```

采集器把上游结果规范化为办公室快照，前端只读取 `/api/office/snapshot`。Sub2API 插件、宿主遥测 API 和 Star Office UI 的公共投影必须分别通过各自测试；任何一个服务不可用时都应显示未知/故障状态，不伪造并发数。

## 版本与发布

Sub2API 宿主版本、插件版本、上游 commit、补丁 SHA256 和发布包 SHA256 必须写入独立发布 manifest。升级时：

1. 先复制新的上游源码或固定 commit，并核对补丁是否干净应用。
2. 运行宿主 Go、前端 bridge、插件 runtime 和 `.s2plugin` 验签测试。
3. 在隔离环境验证插件安装/启停/卸载、权限范围、快照 schema 和失败路径。
4. 再把对应的 `OFFICE_SUB2API_BASE_URL`、安装 ID、显式用户范围和受限消费凭据交给办公室 collector 做只读验收。

本目录的源码和测试上传到 GitHub 不等于已修改或部署线上 Sub2API；生产变更仍需单独备份、审批、切换和回滚验证。
