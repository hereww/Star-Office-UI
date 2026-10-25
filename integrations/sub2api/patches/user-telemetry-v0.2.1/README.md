# 用户遥测插件 0.2.1 / Sub2API 0.2.15

本发行包已在生产安装，并通过目标宿主 0.2.15 的兼容性、签名和功能验收。完整证据见 `../../docs/production-qa-0.2.15-20261011/acceptance.md`。

- `lvdong-user-telemetry-0.2.1.s2plugin`：最终签名安装包。
- `manifest.json`、`signature.json`：安装包内同一份清单与签名。
- `publisher-public-key.pem`、`publisher-public-key.b64`：发布者公钥；key ID 为 `lvdong-user-telemetry-v0215`。
- `s2plugin-compat.py`：本次实际使用的打包及验证工具，Python 3.8+、支持 Ed25519 的 OpenSSL。
- `sub2api-0.2.15-telemetry.patch`：相对官方提交 `f2669c8cf62555cd92389b3f55920e9e6e7c6ff2` 的实际构建源码补丁，包括新增文件和前端依赖配置。
- `build-info.json`：生产宿主、插件与补丁的 SHA256、源文件列表。
- `Dockerfile.runtime`：本次基于官方 0.2.15 镜像覆盖定制宿主二进制的运行镜像定义，需要同一构建输出的 `sub2api` 与 `resources/`。

## 复现源码与构建约束

在官方提交的独立 checkout 应用补丁后，源码应与本轮验收来源一致；这一点已实际验证。前端锁文件和 `pnpm-workspace.yaml` 按本次 pnpm 11 构建保留，请使用相同主版本并核对依赖锁。编译前端后需将 frontend build 输出嵌入 Go 后端。

宿主构建使用 Go 1.27.2、`CGO_ENABLED=0`、`GOOS=linux`、`GOARCH=amd64`、`-tags embed`、`-trimpath`，并注入：

```text
-X main.Version=0.2.15
-X main.Commit=f2669c8cf62555cd92389b3f55920e9e6e7c6ff2
-X main.Date=2026-10-09T03:35:49Z
-X main.BuildType=telemetry
```

`BuildType=telemetry` 是遥测定制宿主的后台升级保护条件。官方 Dockerfile 默认使用 `release`，复现该定制宿主时必须保留 telemetry 标记。

## 仅验证已签名安装包

```sh
python3 s2plugin-compat.py verify lvdong-user-telemetry-0.2.1.s2plugin   --key-id lvdong-user-telemetry-v0215   --public-key publisher-public-key.pem   --platform linux-amd64   --openssl /path/to/openssl
```

临时签名私钥已清理，当前安装包与公钥仍可直接验证和安装。新版本发布需使用受控签名密钥签名，并重新完成兼容验收。
