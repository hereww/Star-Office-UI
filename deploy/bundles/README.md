# Star Office Suite Linux 整合包

当前发布包：`star-office-suite-20261028-01`。

整合包通过 GitHub Release 分发，适用于 Linux amd64/x86_64。它包含 Star Office UI、Sub2API 运行文件、插件包和纯 POSIX Shell 管理脚本。包内只保留首次安装所需的管理员账号入口；目标服务器安装时会重新生成密钥并创建空白数据目录。

整合包不包含生产数据库、PostgreSQL/Redis 数据、普通用户、API Key、上游账号、OAuth 凭据、遥测 token、插件安装记录、管理员密码或 TLS 私钥。安装后的 `runtime/` 目录属于目标服务器状态，不会上传到 GitHub。

## 下载和安装

打开 [star-office-suite-20261028-01 Release](https://github.com/hereww/Star-Office-UI/releases/tag/star-office-suite-20261028-01)，下载下面两个附件到目标 Linux 服务器：

```text
star-office-suite-20261028-01.tar.gz
star-office-suite-20261028-01.tar.gz.sha256
```

校验、解包并启动安装向导：

```sh
sha256sum -c star-office-suite-20261028-01.tar.gz.sha256
tar -xzf star-office-suite-20261028-01.tar.gz
cd star-office-suite-20261028-01
./install.sh --online
```

目标机已经预载固定镜像时使用 `./install.sh --offline`。安装完成后运行 `./manage.sh`，菜单提供安装、卸载、管理员账号和密码、端口、插件以及诊断选项；修改配置后脚本只重建受影响的应用容器。

本次归档 SHA-256：

```text
805ba8246e0e1f606251fc8ec93fa988c28c570e55f84ee380c1643929929318
```

详细的组件边界、数据排除项和回滚要求见 [`docs/SYSTEM_DEPLOYMENT.md`](../../docs/SYSTEM_DEPLOYMENT.md) 以及归档内的 `docs/INSTALL_ZH.md` 和 `evidence/PRODUCTION_BOUNDARY_ZH.md`。
