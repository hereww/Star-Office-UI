# HTTP UI 0.1.1 上线修复限定复核

日期：2026-10-04（Asia/Shanghai）  
性质：本地源码只读复核；唯一写入物为本报告。

## 结论

**在下述固定源码快照和限定变更范围内，未发现必须修复的 P0 / P1 / P2 项。**

- UI 使用安全随机数回退，没有因兼容 HTTP 而改用 `Math.random()`、时间戳或纯计数器；请求响应的来源、origin、bridge token、请求 ID、结果类型绑定及超时清理仍有效。
- `--version` 仅将发行版本显式选择范围扩展为 `0.1.0` / `0.1.1`；两个版本共用严格 manifest 校验、Ed25519 原始字节验签和 payload SHA-256 校验路径，没有发现新参数引入免验签、忽略哈希或绕过私钥隔离的分支。
- **这不是生产发布验收，不表示真实 HTTP LAN 或 opaque sandbox 的线上 UI 已通过。** 用户提供的“生产 enabled/healthy、35 个 HTTP API 验收通过、打包测试 31/31 通过”仅为任务背景，本轮未独立验证。

模型标识限制：任务明确要求 GPT-6 Astra。当前会话工具未提供可读回核验的实际推理模型标识，本报告不虚构模型署名；主代理／调用方须确认本会话的实际模型选择，不能以文件名中的 ASTRA 作为证明。

## 范围与证据文件

以下别名仅用于报告内定位，均指本地文件，不指线上部署副本：

- **UI**：`/Users/hepingyu/Documents/ChatGPT/sub2api/host-source/backend/cmd/user-telemetry-plugin/ui/index.html`
- **MAIN**：`/Users/hepingyu/Documents/ChatGPT/sub2api/host-source/backend/cmd/user-telemetry-plugin/main.go`（仅确认版本常量）
- **PACK**：`/Users/hepingyu/Documents/ChatGPT/sub2api/plugin-tools/s2plugin.py`
- **HTTP-TEST**：`/Users/hepingyu/Documents/ChatGPT/sub2api/host-source/backend/cmd/user-telemetry-plugin/ui/bridge-http-compat.test.cjs`
- **BRIDGE-TEST**：`/Users/hepingyu/Documents/ChatGPT/sub2api/host-source/backend/cmd/user-telemetry-plugin/ui/bridge.test.cjs`
- **PACK-TEST**：`/Users/hepingyu/Documents/ChatGPT/sub2api/plugin-tools/tests/test_s2plugin.py`
- **HOST-BRIDGE**：`/Users/hepingyu/Documents/ChatGPT/sub2api/host-source/frontend/src/views/admin/PluginsView.vue`（只读桥接协议相关行，非宿主全量审计）

未访问生产、未读取真实密码／凭据／配置、未执行远端命令、未运行签名打包、未修改源码或 dist。未重新进行其他全量审计。内存测试只使用合成消息、合成 manifest 和测试标记，无真实用户数据。

## 1. HTTP / opaque sandbox 请求 ID 回退

| 检查点 | 检查行 | 结论及依据 |
| --- | --- | --- |
| 版本更新 | UI 15；MAIN 22–23 | UI 展示和 native 版本常量均为 `0.1.1`。不等于已编译二进制／已发布包版本确认。 |
| 安全随机回退 | UI 46–61 | 优先调用 `crypto.randomUUID()`；缺失、抛错或返回空／非字符串时走 `getRandomValues(new Uint8Array(16))`，编码为 32 位十六进制并追加递增序号。无弱随机回退。16 字节描述适用于回退分支；不将 UUID v4 称为 128 位随机熵。 |
| 熵源故障关闭 | UI 49、55–58、63–70、102–106、122–125 | 熵源不可用／抛错时不创建该配置请求，清理 pending 和监听器，关闭按钮；序号溢出也失败关闭。依赖浏览器原生 Crypto 实现，不防御同一脚本域中被恶意替换的 Crypto。 |
| 请求绑定 | UI 31–44、73–80 | 使用 URL 中的宿主 origin；向父页面发送时锁定精确 origin。接收端必须同时匹配 `event.source === window.parent`、宿主 origin、固定 source 标记、bridge token、字符串 request ID、pending 项、对应 `.result` 类型及布尔 ok。仅正确响应能消费 pending 项。 |
| 超时／重放／销毁 | UI 68–70、77–79、121–126 | 保留 15,000 ms 超时删除；成功响应取消 timer；发送异常清理 timer/pending；pagehide 关闭会话。删除后的旧 ID 无法再消费请求，递增序号防止同一页面内重复随机输出造成 ID 重用。 |
| opaque 协议方向 | HOST-BRIDGE 327–332、602–650；UI 32–44、74–78 | 宿主 iframe 仍是 `sandbox="allow-scripts"`，宿主接收子消息检查 origin `"null"` 加确切 contentWindow 和 token；子页面接收父消息检查父页面的 HTTP origin，不能改成 `"null"`。宿主向 opaque iframe 回发的既有 `"*"` 并非本次 UI 修改新增；UI 向父页没有改成通配 origin。 |
| 请求 ID 格式兼容 | HOST-BRIDGE 607–617、642–650 | 宿主对非空字符串做 trim/pending 绑定，不强制 UUID 格式，因此 32 位 hex + 序号可兼容；UI 输出无前后空白。 |
| 空 referrer | UI 32–39；HOST-BRIDGE 332 | 宿主使用 no-referrer；UI 在 referrer 为空时取自身 URL origin。补充内存测试覆盖此路径，没有要求放宽来源检查。 |

**限定可用性结论：** 在浏览器向该文档提供可用 `getRandomValues()` 的条件下，现有回退代码能够消除 `randomUUID` 缺失导致的请求构造失败。Node VM 测试人为注入 Crypto 和消息事件，并不创建真实 opaque browsing context，不能替代实际浏览器确认。

## 2. 包版本、签名、哈希与私钥边界

| 检查点 | 检查行 | 结论及依据 |
| --- | --- | --- |
| 版本选择入口 | PACK 20–21、225–228、412、438–439 | 默认仍为 `0.1.0`，CLI choices 与函数入口使用同一支持集合，函数要求字符串。显式 `--version 0.1.1` 传入 keyword-only 参数。未知值、非字符串及伪装版本均拒绝。 |
| manifest 校验 | PACK 174–217、285–291、375–379 | 校验身份／版本、固定字段、协议要求、只读 capability、runtime 路径、平台和 UI 哈希声明。verify 支持两个已列举版本，不是任意版本放行；归档文件集合必须与 manifest 完全对应。 |
| 版本进入签名 | PACK 41–43、150–171、285–297、380–384 | version 是 manifest 内容，先编码成确定字节，再 Ed25519 签名。verify 对包中原始 manifest 字节验签；把 `0.1.0` 改成 `0.1.1` 即使两者都合法，仍不能沿用旧签名。没有“版本合法即可跳过签名”的分支。 |
| 文件哈希 | PACK 197–200、289、385–397 | 每个声明的 payload 用 SHA-256 校验，实际消费长度也需匹配；UI／runtime 内容变更须重哈希并重签 manifest。签名通过不替代文件哈希检查。 |
| 信任来源 | PACK 60–66、128–147、339–345、380–384 | 要求调用者提供外部信任公钥，校验 Ed25519 格式、签名长度、算法及 key-id；不从包内取信任公钥；保留内置 transport key-id 禁用约束。 |
| 私钥隔离 | PACK 87–113、116–125、220–222、231–261、267–281 | 版本参数不参与密钥路径选择。保留输入符号链接检查、私钥不得在 UI 树内、runtime/UI 与私钥 samefile/hardlink 排除、payload 私钥 PEM／完整私钥字节拒绝；不回显 OpenSSL stderr。未实际打开任何私钥。 |
| 原子输出与复验 | PACK 300–320 | 临时归档写入后 fsync，并完成 `verify_package` 才 replace 最终输出；版本参数不改变这一顺序。 |

**发行流程提醒（非本次新增 P2）：** 新 UI 和 MAIN 已标为 `0.1.1`，发布命令必须显式传 `--version 0.1.1`。工具不会运行 arbitrary runtime 来证明其内部版本与 manifest 一致，也不会解析 UI 文案来强制版本一致；旧版本默认值是用户要求保留的兼容行为。本轮没有验证实际发行命令、二进制、签名包或生产版本。

## 3. 本轮验证与测试边界

### 实际运行：只读、无联网的本地测试

1. Node `v26.0.0` 执行两份 UI 测试：**14/14 通过，0 失败，0 跳过**。
   - HTTP-TEST 54–96：无 randomUUID 的 load/save/test；伪造来源、origin、token、ID、结果类型和 ok；UUID 优先及抛错回退；相同随机字节下的序号去重；熵源缺失关闭；版本展示。
   - BRIDGE-TEST 23–57：原桥接绑定、保存后测试、错误展示、超时、卸载清理及无广泛来源发送。
2. 复用 HTTP-TEST 的内存 harness，额外 **3 个场景通过**，未写测试文件：
   - 空 referrer 的 HTTP 初始化；触发超时后旧回复被丢弃；重新 load 生成不同 ID，旧回复不能消费新 pending，正确回复可完成。
   - 初次成功后安全熵源失效：不再发配置请求，移除监听器并禁用按钮。
   - randomUUID 返回空字符串时进入安全回退。
3. Python `-B` 内存加载 PACK，**30 项版本／CLI／manifest 检查通过**：
   - 两个支持版本；10 类非法值在 manifest 与函数入口拒绝。
   - CLI 默认 0.1.0、显式 0.1.0／0.1.1 的参数传递，以及 4 类非法 CLI 值拒绝。
   - 修改版本会改变待签名 manifest 字节。
   - CLI build 以捕获函数替代，输入读取和 OpenSSL 入口设为拒绝调用。**这些检查不是实际打包、验签或密钥泄漏测试。**

### 仅阅读，未重新执行

PACK-TEST 94–101 提供显式 0.1.1 打包／验证及旧 0.1.0 验证用例；152–190 提供内容篡改、原始 manifest 字节变化、重哈希未重签、错误公钥／签名／算法／key-id 用例；233–275 覆盖符号链接、复制／嵌入／hardlink 私钥和错误密钥算法；331–386 覆盖输出原子性、输入保护与 CLI；388–404 有独立 Go 密码学语义测试。

PACK-TEST 27–51 会在工作区创建临时目录、临时测试私钥和归档。为遵守只读边界，本轮未运行该套件，也没有把用户报告的 31/31 计为自己的实测结果。

## 4. 仍未覆盖与交接条件

1. 主代理仍须在真实 HTTP LAN 页面、实际 `sandbox="allow-scripts"` iframe 中执行 browser QA，至少覆盖初始 config.load、保存、保存后测试、重载、超时和旧响应丢弃；本轮没有访问该地址。
2. 未验证目标浏览器／版本在实际 HTTP 和 opaque 环境中暴露哪些 Crypto 方法、真实 CSP／sandbox／资源路由／缓存行为；内存 harness 不是浏览器验收。
3. 未编译 MAIN；未读取 dist、签名私钥、信任发布者配置或真实 .s2plugin；未验证生产安装后的 UI 字节与本报告源文件一致。
4. 未重跑真实签名／哈希篡改矩阵，尤其未将全部旧版安全负例分别在 0.1.1 上重放；关于密码学未放松的结论来自共用控制流检查及测试代码阅读。
5. 不包含独立的 HTTP 传输机密性／中间人防护结论、宿主全部授权流程审计、key 文件系统权限／运维轮换审计或构建供应链审计。安全请求 ID 不会把 HTTP 变成 HTTPS。
6. 本次查询的目标文件没有可用的 Git tracked 基线用于可靠的 0.1.0→0.1.1 diff；结论绑定当前源码快照及指定改动范围，不宣称完整历史差异已验证。
7. 序号达到 MAX_SAFE_INTEGER 的拒绝仅做静态检查；真实浏览器 15 秒计时与长时间运行未实测。测试手动触发超时回调。
8. 若下列源码哈希变化，应重新限定复核；即使哈希不变，仍须由主代理完成新包版本一致性、签名／哈希验证和真实 browser QA。

## 5. SHA-256 源码快照

以下文件在本轮读取／测试后、写报告前重新计算，与初次记录一致：

- `/Users/hepingyu/Documents/ChatGPT/sub2api/host-source/backend/cmd/user-telemetry-plugin/ui/index.html`
  - SHA-256：`e57a46d7e30576ba3ed5d6a4d82c9ea8f5188437d90c26c32e5b44fc945de8e6`
- `/Users/hepingyu/Documents/ChatGPT/sub2api/host-source/backend/cmd/user-telemetry-plugin/main.go`
  - SHA-256：`10675751cef6127a1c0bd1d05e06bed24e8eeba2ed535ec7fef32738c2dd0876`
- `/Users/hepingyu/Documents/ChatGPT/sub2api/plugin-tools/s2plugin.py`
  - SHA-256：`fe062f3a1e63f099c57273dae7cb8b1b245f69437e6ba4e71d667650475f82bc`
- `/Users/hepingyu/Documents/ChatGPT/sub2api/host-source/backend/cmd/user-telemetry-plugin/ui/bridge-http-compat.test.cjs`
  - SHA-256：`2784550e2419e79f399855adcc7bec5c465b5e6107fe7569306cce7a3482ac62`
- `/Users/hepingyu/Documents/ChatGPT/sub2api/host-source/backend/cmd/user-telemetry-plugin/ui/bridge.test.cjs`
  - SHA-256：`728f0fae40ecf2a481786b06ef27d9ced6188c9a8f195965cbc257a52328f6f2`
- `/Users/hepingyu/Documents/ChatGPT/sub2api/plugin-tools/tests/test_s2plugin.py`
  - SHA-256：`8d742d704eb40d98756988235e930cc0acc46b3772a9e66bc3f93c0d2bd81679`

本报告未将本地测试结果提升为线上 UI 已通过的声明。
