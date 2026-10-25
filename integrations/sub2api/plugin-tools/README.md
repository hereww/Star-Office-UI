# User Telemetry `.s2plugin` 打包与离线验证工具

本目录是独立、非阻塞的构建/签名 sidecar。只消费**已经构建的插件二进制和 UI 目录**，不构建业务运行时、不修改宿主、不定义/修改 Telemetry RPC/DTO、不实现 transport、不赋予模型权限、不安装或部署。CLI 不启动输入二进制，不执行 UI，不解压验证包。

## 固定边界与安装性

按以下已冻结声明生成包：

- `id: com.lvdong.user-telemetry`；默认 `version: 0.1.0` 保持旧版打包兼容；HTTP 配置 UI 修复版本使用显式 `--version 0.1.1`，验证器兼容这两个发布版本。
- 唯一 capability：`sub2api.user_telemetry.read.v1`，`platform: sub2api`，`account_type: user`。
- `requires.plugin_protocol: 1`、`requires.user_telemetry_api: 1`、`requires.ui_bridge: 1`。
- 默认 `requires.sub2api: ">=0.2.13 <0.3.0"`，可用 `--sub2api-range` 配置。
- **没有** `requires.transport_api`、transport capability、模型调用权限或外部读取凭据。
- 必需 UI 入口是 `ui/index.html`；runtime 平台键使用 `GOOS-GOARCH`，例如 `linux-amd64`。

已只读核验上游固定提交 `b8dece9000c68815a5b867ca5a1e6f236e173905` 的以下文件：

- `/Users/hepingyu/Documents/ChatGPT/sub2api/host-source/backend/internal/service/plugin_package.go`：包路径、512 条目、大小、哈希、原始 manifest 字节验签、第三方发布者信任根。
- `/Users/hepingyu/Documents/ChatGPT/sub2api/host-source/backend/internal/service/plugin_manifest.go`：原版只接受 OpenAI OAuth transport 能力，且强制 transport API。
- `/Users/hepingyu/Documents/ChatGPT/sub2api/host-source/backend/internal/service/plugin_compatibility.go`：版本范围为全部 comparator token 的 AND；不支持 `^`、`~`、`||`、通配符。
- `/Users/hepingyu/Documents/ChatGPT/sub2api/host-source/backend/internal/config/config.go`：`PluginConfig.TrustedPublishers map[string]string`、`mapstructure:"trusted_publishers"`，以及默认大小限制。
- `/Users/hepingyu/Documents/ChatGPT/sub2api/host-source/deploy/config.example.yaml`：真实配置段为 `plugins.trusted_publishers`。

**原版固定提交不能安装此遥测包。** 它会拒绝新的要求字段/能力；不能靠版本号、`accept_untested`、允许未签名或伪装 transport 绕过。安装目标必须先具备主代理提供的条件 schema、User Telemetry API v1、对应独立插件协议及运行时/HostService 授权与可用性检查。这里不会擅自建立这些契约。

`package_verified` 仅指包的声明、内容、平台、哈希和签名通过本工具离线检查，**不表示目标宿主已验证安装/启用，更不证明输入二进制实际实现了 Telemetry 协议或适配所声明的 OS/架构**。未实际验收宿主，因此不生成 `tested_sub2api_versions`；宿主如要求接受未测试版本，仍需管理员明确确认，不能当作协议可用性证明。

## 依赖

- Python **3.9+**，仅标准库。
- 提供 `pkey` 与 Ed25519 `pkeyutl -rawin` 的 OpenSSL（建议已有的 OpenSSL 3.x）。使用 PATH 中的 `openssl` 或显式 `--openssl /absolute/path/to/openssl`；没有静默切换签名算法/库。
- 本机实测：Python 3.14.5、`/opt/homebrew/bin/openssl` 3.6.2。macOS 自带 `/usr/bin/openssl` 是 LibreSSL 3.3.6，不能假定支持这里所需的 Ed25519 操作。本工具不会自动安装依赖。
- Go **不是**打包依赖；仅可选的独立跨语言验证测试需要现有 Go 工具链，不依赖 Go module/第三方包，也不导入宿主源码。

## 输入与私钥安全

1. 由发布者明确提供**已有的外部 Ed25519 PKCS#8 PEM 私钥**；工具不生成、不保存、不输出私钥，也不将其拷贝到 scratch 或 ZIP。
2. 当前非交互 CLI 支持 OpenSSL 可直接读取的未加密 PEM；不提供口令参数/环境变量或凭据保存功能。需要加密密钥、HSM/签名代理时，另行设计安全签名流程，不把口令放 CLI。
3. 私钥应由发布者安全保管，限制文件权限（例如 `0600`），不放仓库/UI 构建目录/发行目录/宿主运行目录。只给宿主公钥。
4. 工具拒绝私钥处于 UI 树内、私钥被用作 runtime、UI 对私钥的 hardlink、输入 symlink（含父路径）以及 payload 中的私钥 PEM 标记/当前私钥完整字节。这里只是额外防漏措施，不是任意秘密扫描器；提供者仍须确保 UI/二进制没有 token、密码等秘密。
5. UI 必须是干净构建目录：隐藏文件/目录（包括 `.git`、`.env`、`.DS_Store`）直接报错，不悄悄打包或忽略。只接受普通文件和正常目录，不允许 symlink/FIFO/设备文件。
6. CLI 不修改任何输入。签名临时目录仅包含 manifest、签名和公共数据，操作完自动清理；测试生成的私钥仅为临时 fixture，全部清理，不是长期用户凭据。

## CLI 示例

以下 `/external/...` 路径均为示意：换成已准备好的输入、外部私钥和**已存在的输出父目录**，不会自动创建发行目录。宿主实际平台必须独立核验，不能用开发机架构代替。

### 打包一个或多个平台

```sh
python3 /Users/hepingyu/Documents/ChatGPT/sub2api/plugin-tools/s2plugin.py pack \
  --runtime linux-amd64:/external/build/user-telemetry-linux-amd64 \
  --runtime linux-arm64:/external/build/user-telemetry-linux-arm64 \
  --ui-dir /external/build/ui \
  --signing-key /external/secure/lvdong-user-telemetry-ed25519.pem \
  --key-id lvdong-user-telemetry-v1 \
  --require-platform linux-amd64 \
  --output /external/output/com.lvdong.user-telemetry-0.1.0.s2plugin \
  --openssl /opt/homebrew/bin/openssl
```

- `--runtime` 可重复；映射为 `平台:本地文件路径`，重复平台/没有任何平台立即失败。源二进制必须非空，不要求源文件在开发机可执行。
- `--require-platform` 可重复，用于提前声明交付目标；任何目标未提供 runtime 就报错。未指定时允许只构建所需平台；离线验证仍要求显式 `--platform`。
- 需要调整范围时传 `--sub2api-range '>=0.2.14 <0.3.0'`。本工具接受宿主 comparator + 完整 semver 的保守子集，例如 `>=`、`<`、`=`；token 间空格/逗号表示 AND，不接受 `^`、`~`、`||`、`*`。改变范围不能补足缺失的遥测 API。
- 插件 ID、版本、capability、UI 入口与三个协议要求不可用 CLI 改写。
- Windows runtime 在包内使用 `user-telemetry.exe`，其他平台使用 `user-telemetry`；不读取用户传入文件名作为 ZIP 路径。
- 输出必须为 `.s2plugin`，不能在 UI 树内、指向 symlink 或覆盖输入 runtime/私钥。

### 导出仅公钥，再校验包

```sh
PUBLIC_KEY_B64="$(python3 /Users/hepingyu/Documents/ChatGPT/sub2api/plugin-tools/s2plugin.py public-key \
  --signing-key /external/secure/lvdong-user-telemetry-ed25519.pem \
  --openssl /opt/homebrew/bin/openssl)"

python3 /Users/hepingyu/Documents/ChatGPT/sub2api/plugin-tools/s2plugin.py verify \
  /external/output/com.lvdong.user-telemetry-0.1.0.s2plugin \
  --key-id lvdong-user-telemetry-v1 \
  --public-key-base64 "$PUBLIC_KEY_B64" \
  --platform linux-amd64 \
  --openssl /opt/homebrew/bin/openssl
```

也可用 `--public-key /external/secure/publisher-public.pem` 提供已信任的 Ed25519 公钥 PEM，和 `--public-key-base64` 二选一。`verify` 不接受私钥当作公钥，不接受包内公钥作为信任根。`--key-id` 必须和签名一致；宿主内置保留 ID `sub2api-openai-transport-v1` 被明确拒绝。有效签名不能替代可信渠道核验发布者公钥。

成功返回一行 JSON；失败写 stderr、返回非零，OpenSSL 错误不会原样打印，避免泄露密钥细节。`public-key` stdout **只包含 32 字节公钥的 Base64**，不是 PEM、不是 44 字节 SPKI DER 的 Base64、不是十六进制，也不写凭据文件。

## 宿主合法信任公钥配置

真实字段格式为 `plugins.trusted_publishers: { signature_key_id: raw_32_byte_public_key_base64 }`。**合并到原配置，保留已有发布者/插件配置，不要整体替换。** 保持 `allow_unsigned: false`。例如下面是可被实际解析/解码的示例公钥；只用于展示格式，生产必须替换为发布者通过可信渠道确认的真实输出，不能信任此示例：

```yaml
plugins:
  allow_unsigned: false
  trusted_publishers:
    lvdong-user-telemetry-v1: "11qYAYKxCrfVS/7TyWQHOg7hcvPapiMlrwIaaPcHURo="
```

从前述命令取得真实 `$PUBLIC_KEY_B64` 后，可以仅打印待人工合并的配置（不会修改宿主）：

```sh
printf 'plugins:\n  allow_unsigned: false\n  trusted_publishers:\n    lvdong-user-telemetry-v1: "%s"\n' "$PUBLIC_KEY_B64"
```

依据实际 `plugin_package.go`：宿主使用 `base64.StdEncoding.DecodeString`，要求解码长度为 `ed25519.PublicKeySize`（32），以 `signature.json.key_id` 查这张 map。此插件不是官方 transport，不能复用/覆盖其内置信任根。所有会读取/恢复包的宿主实例都需配置正确公钥和实际 runtime 平台；配置加载、迁移、安装上传和启用由主代理/部署者另行验收，本模块未执行这些操作。

## 包结构、签名与输出一致性

```text
manifest.json
signature.json
runtimes/linux-amd64/user-telemetry
runtimes/linux-arm64/user-telemetry
ui/index.html
ui/assets/...
```

- `manifest.files` 完整覆盖每个 runtime 和 UI 文件；值为小写 64 字符 SHA-256，不包含 manifest/signature 自身。
- 生成 manifest 采用 UTF-8、固定 JSON 序列化（排序/紧凑分隔符）和一个结尾 LF。Ed25519 签名覆盖**这些精确字节**，ZIP 放入同一份字节，verify 不重新序列化；改空白也会失败。
- `signature.json` 仅有 `algorithm: ed25519`、`key_id`、Base64 `signature`（64 字节）。
- ZIP 只包含上述普通文件：路径是规范 POSIX 相对路径；拒绝 `..`、绝对路径、反斜线、盘符/冒号、空组件、控制字符、重复路径、额外文件/缺失声明、symlink 和额外 ZIP metadata/comment。验证不解压到磁盘。
- runtime 文件模式 `0700`，其他文件 `0600`；ZIP 时间戳固定、条目排序，无 directory entry 和本机来源路径。输入和同一密钥不变时，包字节可复现（同一 Python/zlib/OpenSSL 环境）。
- 与基线默认限制对齐：至多 **512 条目**（含两个根 JSON）、压缩上传 **128 MiB**、解压 **256 MiB**、manifest **2 MiB**、signature **64 KiB**；文件读取也有边界。解压预算保守预留 signature 上限。部署者更严格的实际限制仍优先。
- 先在输出同目录创建唯一临时文件，写入并 `fsync`，完成验签/全部文件 hash 复核后才 `os.replace` 原子替换；任何前置失败保留旧输出，清理临时文件。原子可见性不等于断电后的目录持久化保证，也不会替代外部发布审批/旧包留存。

## 测试

```sh
cd /Users/hepingyu/Documents/ChatGPT/sub2api
PYTHONDONTWRITEBYTECODE=1 \
S2PLUGIN_TEST_OPENSSL=/opt/homebrew/bin/openssl \
python3 -m unittest discover -s /Users/hepingyu/Documents/ChatGPT/sub2api/plugin-tools/tests -v
```

测试覆盖：contents/每文件 SHA-256/精确字节 Ed25519、UI/runtime 篡改、修改哈希但不重签、签名/公钥/key-id 错误、无签名、私钥不在包及拷贝/hardlink/embedded 拒绝、缺失平台/UI、非法路径/symlink/重复项/未声明文件/ZIP metadata、错误协议/版本范围、大小与条目上限、原子失败旧文件保留和临时清理、CLI、公钥导出、可复现输出。

测试私钥和 fixture 包创建在 `/Users/hepingyu/Documents/ChatGPT/sub2api/plugin-tools/.s2plugin-tests-*` 并清理，不产生正式发行包。`verify_signature.go` 只做独立 Go 标准库验签/哈希验证，用来确认 Python/OpenSSL 产物符合宿主 `crypto/ed25519` 的精确字节语义；没有 Go 时只跳过这一项，其余验签测试仍须成功。**这不是宿主安装集成测试。**
