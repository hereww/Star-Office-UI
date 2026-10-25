# 候选 Linux CPython 3.11 x86_64 wheelhouse

2026-10-04 有界补齐：仅使用项目现有 Python 3.12.14 venv 的 pip 25.0.1 **下载**，
没有安装依赖、升级应用 requirements、创建 runtime、安装 Docker、访问远端或重打 RC1/RC2。

## 架构与构建门槛

此目录是 **Linux / CPython 3.11 / x86_64（Docker linux/amd64）候选**，不是服务器架构确认。
SSH 尚未取得，远端 `uname -m`、容器平台、已有 Python3.11 base image 的架构和 libc 未核实。
本机没有 Docker；这里的下载/元数据/离线 resolver 验证**不等于实际安装、镜像启动或线上验收**。

平台原生 wheels 含 manylinux2014 / manylinux_2_17 x86_64 tag，目标要求 glibc >= 2.17；
不适用于 ARM64、Alpine/musl 或其他 Python ABI。主线程恢复授权后先只读核实服务器及缓存镜像，
不匹配则 STOP，不强制模拟 amd64、不自动拉新 base、不切换非官方源。之后才做 Python3.11
缓存镜像 `--pull=false --network=none` 实际构建和运行验收。SHA256 完整性验证不是漏洞审计。

## 固定输入与依赖选择

应用直接依赖保持原值：Flask 3.0.2、Pillow 10.4.0、Gunicorn 23.0.0。
requirements 原先未固定传递依赖；本次官方 PyPI 下载选择如下，随后由本目录唯一版本和 hash 固定。
不是向应用 requirements 添加或升级版本，也不声称选择版本已完成应用回归/安全审查。

| 包 | 下载版本 | wheel 类型 |
|---|---|---|
| Flask | 3.0.2 | py3-none-any |
| Pillow | 10.4.0 | cp311-cp311 / manylinux x86_64 |
| gunicorn | 23.0.0 | py3-none-any |
| blinker | 1.9.0 | py3-none-any |
| click | 8.5.0 | py3-none-any |
| itsdangerous | 2.2.0 | py3-none-any |
| Jinja2 | 3.1.6 | py3-none-any |
| MarkupSafe | 3.0.4 | cp311-cp311 / manylinux x86_64 |
| packaging | 26.3 | py3-none-any |
| Werkzeug | 3.1.9 | py3-none-any |

共 10 个 wheels，5,305,592 bytes；包字节未转换。

## 来源与验证证据

- 下载 index 只指定 `https://pypi.org/simple`，官方文件来自 HTTPS `files.pythonhosted.org`。
  pip 使用 `--isolated`、`PIP_CONFIG_FILE=/dev/null`，清除继承的所有 `PIP_*` 设置，
  禁用缓存与版本检查，不允许 sdist，不设 extra-index / find-links / 非官方镜像。
- `audit.json`：每个 wheel 的 filename/WHEEL tags、METADATA Name/Version/Requires-Python、
  完整 RECORD 内容 hash/尺寸、PyPI 版本 JSON 的文件 SHA256/尺寸/非 yanked 状态。
  Requires-Dist 按 Linux、CPython 3.11.0、无 extras 求完整递归闭包，Windows colorama 和
  未启用 extras 不进入目标运行依赖。报告明确远端/容器验证均为 false。
- `SHA256SUMS`：全部原始 wheels 的 SHA256。
- `requirements.lock.txt`：传递闭包的 exact-version + SHA256 清单，仅用于审计/下载验证。
  应用 `deploy/office/requirements.txt` 未改。未来镜像构建仅从这个已审阅目录解析，无网络回退。
- `offline-resolution.json` / `.log`：两次 `pip download --no-index`（原 requirements 和
  `--require-hashes` 锁定清单），临时目录解析结果均为同一 10 个 wheels，逐字节 hash 相同；
  临时目录用后清除，无安装行为。pip 本机运行不模拟目标 Linux，目标 markers 另由 audit 显式验证。
- `protected-input-hashes.json`：本轮执行前记录的 requirements 和已存在 RC1 归档 hash；
  审计重新读回均相同。RC1 manifest 仍标记没有 wheelhouse，不将其冒充新版本。
- `verification-tests.json`：4/4 临时 fixture 检查通过：完整闭包接受，缺少依赖、错误平台、
  损坏 wheel 均拒绝；未触及实际服务。
- `verify_wheelhouse.py`：现有 venv 可离线重验；仅显式 `--pypi` 才访问官方 HTTPS 元数据，
  验证不关闭 TLS，拒绝非官方 redirect。

从本目录运行 `shasum -a 256 -c SHA256SUMS` 可离线校验 wheels。
从项目根目录复用现有 venv（不安装任何包）：

```bash
PYTHONDONTWRITEBYTECODE=1 .local/office-production-20261004/venv/bin/python \
  deploy/office/wheelhouse/linux-cp311-x86_64/verify_wheelhouse.py
# 需要重新联网核对官方 PyPI hash 时，明确增加 --pypi；默认仅离线审计。
```

## Packager 使用

主线程完成 UI QA 冻结、确定**新 release ID**之后再打包，本轮未执行此命令：

```bash
--wheelhouse /Users/hepingyu/Documents/ChatGPT/Star-Office-UI/deploy/office/wheelhouse/linux-cp311-x86_64
```

现有 packager `collect_wheels()` 已只读接受 10/10。它只复制 `*.whl` 原字节并在发布 manifest /
SHA256SUMS 记录，不复制这里的 audit/log/lock/README/脚本，因此无需修改 packager 或当前 RC。
审计附件保留在本目录作为来源证据。是否上线仍由主线程架构、离线镜像和浏览器集成验收决定。
