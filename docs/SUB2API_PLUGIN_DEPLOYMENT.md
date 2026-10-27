# Sub2API 用户遥测插件安装说明

本文只安装 Star Office UI 所需的用户遥测插件。它运行在 Sub2API 的原生插件管理器中，不是独立 HTTP 服务，也不会替代 Sub2API 主服务。安装前先完成 [`SUB2API_DEPLOYMENT.md`](./SUB2API_DEPLOYMENT.md)。

## 组件和安全边界

插件只返回已批准的 Sub2API 终端用户的身份、非删除 API Key 元数据、已入库 Token 总量和当前用户槽位并发。它不返回明文 API Key、数据库密码、管理员 JWT、模型请求正文、成本或动画事件，也不新增外部监听端口。

Star Office UI 的 Collector 使用：

~~~text
GET /api/v1/plugins/{installation_id}/user-telemetry/status
GET /api/v1/plugins/{installation_id}/user-telemetry
~~~

认证使用 s2ut_... 专用只读凭据。installation_id 是上传后得到的数字安装 ID，不是 com.lvdong.user-telemetry 这样的 manifest 插件 ID。

## 需要准备的交付物

每次插件安装都要同时准备以下材料，并保持版本成组：

- 签名的 .s2plugin；
- 包内 manifest.json、signature.json 的校验结果；
- 发布者 key_id 和对应的 32 字节 Ed25519 公钥（Base64 或 PEM）；
- 插件包 SHA-256；
- 与 manifest requires.sub2api、plugin_protocol、user_telemetry_api、ui_bridge 匹配的 Sub2API 宿主镜像或构建源码；
- 目标架构 runtime（例如 linux-amd64 或 linux-arm64）；
- 已验证的宿主补丁/构建说明和回滚镜像。

仓库内 integrations/sub2api/plugin-tools/ 保存打包和验签工具，integrations/sub2api/patches/ 保存历史补丁、manifest、签名和验收说明。仓库不保存长期签名私钥，也不保证每个历史目录都包含最终 .s2plugin 文件；没有签名包时，必须通过受控发布渠道取得，或在联网构建机按发布说明重新打包签名。

## 第一步：确认宿主兼容性

不要先上传包再猜版本。先读取包 manifest：

~~~bash
PLUGIN=/opt/sub2api/plugins/lvdong-user-telemetry.s2plugin
unzip -p "$PLUGIN" manifest.json | jq .
~~~

确认以下字段：

- id、version 与发布记录一致；
- requires.sub2api 覆盖实际宿主版本；
- requires.plugin_protocol = 1；
- requires.user_telemetry_api = 1；
- requires.ui_bridge = 1；
- runtimes 包含目标 OS/架构；
- ui.entrypoint 存在且包内哈希完整。

例如仓库内 user-telemetry-v0.2.1 的历史 manifest 声明了 >=0.2.14 <0.3.0，并记录实际测试版本 0.2.15。这个值只是该发布包的兼容声明，不能把它当成任意未来版本的保证；实际部署必须以目标包的 manifest 和验收记录为准。

如果宿主尚未提供 User Telemetry API、独立插件协议或对应 UI Bridge：

1. 在干净、独立的源码 checkout 中先执行 git apply --check；
2. 按对应补丁目录的 README_INSTALL_ZH.md 或 README.md 构建新的宿主镜像；
3. 对宿主运行 Go、前端 Bridge、迁移和插件集成测试；
4. 先以新镜像替换 Sub2API 应用容器，保留 PostgreSQL、Redis 和旧应用镜像；
5. 宿主健康后再安装 .s2plugin。

不要把补丁直接套到正在运行的生产 checkout，也不要对一个已经包含补丁的目录重复 git apply。如果目标宿主版本与补丁基线不同，先做版本适配，不要强行覆盖。

## 第二步：离线验签和平台检查

在联网构建机或内网验收机执行验签。OpenSSL 必须支持 Ed25519；不要把未验证的公钥从包内直接当成信任根：

~~~bash
KEY_ID=<manifest 对应的 key_id>
PUBLIC_KEY_B64=<通过可信渠道取得的 32 字节 Base64 公钥>

python3 integrations/sub2api/plugin-tools/s2plugin.py verify \
  "$PLUGIN" \
  --key-id "$KEY_ID" \
  --public-key-base64 "$PUBLIC_KEY_B64" \
  --platform linux-amd64 \
  --openssl "$(command -v openssl)"
sha256sum "$PLUGIN"
~~~

目标是 linux-arm64 时把 --platform 改成 linux-arm64。验签通过只证明包内声明、文件哈希和签名匹配，不证明宿主已经安装、插件进程已经启动或目标平台已经原生运行通过。

## 第三步：合并宿主信任配置

在 Sub2API 的配置文件中**追加**发布者条目，保留已有发布者和插件配置：

~~~yaml
plugins:
  allow_unsigned: false
  trusted_publishers:
    <key_id>: "<32-byte-ed25519-public-key-base64>"
~~~

不要用示例公钥覆盖生产配置，不要为消除“未验证版本”提示而关闭签名验证、改 manifest 或重签第三方包。配置更新后只重建/重启 Sub2API 应用容器；不需要重启 PostgreSQL、Redis 或其他无关服务。变更前先保存旧配置和旧应用镜像。

## 第四步：上传、配置和启用

在 Sub2API 管理后台的“插件”页面：

1. 上传已验签的 .s2plugin；
2. 确认名称、版本、签名状态、兼容性和 Linux runtime；
3. 保持初始状态为停用；
4. 保存最小批准范围，例如：

~~~json
{"allowed_user_ids":["42","43"],"timezone":"Asia/Shanghai","page_size":100}
~~~

allowed_user_ids 必须是 Sub2API 的终端用户 ID，不能为空，不能填上游账号 ID、API Key ID 或邮箱。配置中不放数据库密码、管理员 JWT、OAuth 值或模型 Key。

5. 先执行原生“测试”并读回配置，确认错误会明确返回；
6. 只在签名、兼容性、配置和只读测试全部通过后启用插件。

如果管理页要求确认“未验证版本”，只能在已经完成该宿主/插件组合的人工验收后确认；它不是关闭验签的替代品。

## 第五步：签发 Collector 专用凭据

插件启用后，通过受保护的管理员 API 签发**有限期、最小用户范围**的只读凭据：

~~~http
POST /api/v1/admin/plugins/{installation_id}/user-telemetry/credentials
Content-Type: application/json

{"name":"office-read-only","user_ids":["42","43"],"expires_in_seconds":3600}
~~~

创建/撤销接口继承宿主原有 adminAuth 和 step-up 语义。expires_in_seconds 必须显式填写，通常为 60 到 2678400 秒；响应中的 data.token 只返回一次，数据库只保存 hash。把 token 写入 Office 主机的 0400/0600 文件，不要放 URL、前端、截图、shell 历史或日志。

安装后应保存凭据元数据、到期时间和撤销方式，不保存 token 副本。需要停止办公室读取时，先停用 Collector 或插件，再撤销凭据。

## 第六步：只读验收

使用专用凭据验证：

- GET /api/v1/plugins/id/user-telemetry/status 返回固定的 healthy、ready、configured 摘要；
- GET /api/v1/plugins/id/user-telemetry 只返回批准用户；
- 错误凭据为 401，越权用户为 403，停用/未就绪/查询失败为 503，限流为 429；
- 不返回 API Key 明文、管理员 JWT、模型请求正文或原始插件 JSON；
- 分页复用同一 start/end/timezone，不会把跨页时间窗口变成不同窗口。

验收通过后，在 Star Office 的 deploy/office/env.example 中配置：

~~~text
OFFICE_SUB2API_BASE_URL=https://<sub2api-受保护入口>
OFFICE_INSTALLATION_ID=<上传后得到的数字安装 ID>
OFFICE_USER_IDS=42,43
OFFICE_CREDENTIAL_EXPIRES_AT=<凭据 UTC 到期时间>
OFFICE_CONSUMER_FILE=/opt/star-office-ui/private/office-consumer.token
~~~

Collector 只读这些端点，不向 Sub2API 发模型请求，也不把消费 token 交给浏览器。Office 端到端部署继续看 [`SYSTEM_DEPLOYMENT.md`](./SYSTEM_DEPLOYMENT.md)。

## 停用、升级和回滚

停用时按以下顺序：

1. 停止或隔离 Office Collector；
2. 在插件管理页停用插件；
3. 撤销该安装的所有 Office 消费凭据；
4. 保留配置、数据库迁移、旧插件包和旧宿主镜像，完成原因记录。

升级时先准备与新 manifest 匹配的宿主镜像和插件包，先在隔离环境测试，再做 app-only 切换。回滚时恢复旧 Sub2API 应用镜像、旧信任配置和旧插件状态；不要默认恢复整个 PostgreSQL 数据库，也不要删除共享用户、Key 或 usage logs。

## 参考资料

- [`integrations/sub2api/plugin-tools/README.md`](../integrations/sub2api/plugin-tools/README.md)：.s2plugin 打包、签名、公钥和离线验签。
- [`integrations/sub2api/patches/user-telemetry-v0.1.1/README_INSTALL_ZH.md`](../integrations/sub2api/patches/user-telemetry-v0.1.1/README_INSTALL_ZH.md)：宿主补丁、插件安装和回滚边界。
- [`integrations/sub2api/patches/user-telemetry-v0.1.1/USER_TELEMETRY_API_ZH.md`](../integrations/sub2api/patches/user-telemetry-v0.1.1/USER_TELEMETRY_API_ZH.md)：遥测 API v1、统计口径和错误语义。
- [`integrations/sub2api/patches/user-telemetry-v0.2.1/README.md`](../integrations/sub2api/patches/user-telemetry-v0.2.1/README.md)：0.2.15 宿主的历史构建说明，使用前必须重新核对目标版本。
