# Star Office UI 6.0.1（未部署更新记录）

> 当前项目发行/打包基线仍为已部署并验收的 6.0.0。以下是 6.0.1 离线更新能力的开发记录；在完成新发布包、备份、预检和切流验收前，不把它标记为当前生产版本。

## 离线版本更新

- Quickstart 离线包新增 `deploy/quickstart/update.sh`，支持 Docker 和 native Python 更新。
- 更新前校验 `bundle-manifest.json`、`SHA256SUMS` 和包内文件集合，拒绝篡改、缺文件和重复包成员。
- 更新前备份私有 `.env`、安装状态和原生模式的用户生成背景/收藏素材；数据卷、资产卷和 Sub2API 凭据继续由安装目录或 Docker volume 管理。
- Docker 更新使用按 bundle ID 派生的镜像标签，避免覆盖旧镜像；支持从本地 `docker save` 归档加载镜像。
- 更新后读取 `/health` 返回体的 `version` 字段做版本确认，失败时恢复旧环境和安装状态，并在旧包目录仍可用时尝试重启旧版本。
- 安装后使用 `verify.sh --health-only` 做健康/版本读回，避免 native 运行时缓存和用户自定义素材被误判为发布包篡改；安装前仍执行完整清单校验。
- `/health` 返回项目 `version` 和 `release_id`，`verify.sh` 支持版本读回校验。
