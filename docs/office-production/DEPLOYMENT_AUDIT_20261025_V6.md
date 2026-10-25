# Star Office UI v6.0.0 部署审计

审计日期：2026-10-25（Asia/Shanghai）
审计范围：服务器已部署的办公室前端/后端，与当前工作区源码及已保存的不可变发布包进行只读比对。
审计方式：HTTP/API 读取、版本化静态资源读取、SHA-256 比对；没有执行服务器写入、重启、切流或配置保存。

## 服务器实际版本

| 项目 | 只读结果 |
| --- | --- |
| 员工入口 | `http://192.168.100.221:19000/` 返回 HTTP 200 |
| 页面发布前缀 | `/static/releases/office-full-frame-20261024-03` |
| 健康检查 | `/health` 返回 HTTP 200，`status=ok` |
| 快照接口 | `/api/office/snapshot` 返回 HTTP 200、`schema_version=1` |
| 快照配置版本 | `config_version=9` |
| 采集状态 | `source.status=ok`，`rack_state=working` |
| 管理入口 | `https://192.168.100.221:19443/admin` 返回 HTTP 200 页面；本次只检查页面可达性，不把 `-k` 读取当作 TLS 信任验收 |

服务器返回的员工页面明确引用 `office-full-frame-20261024-03`，不是旧 RC 或候选 `office-rack-status` 包。

## 角色与前端资源

服务器快照包含 16 个工位，角色分布为：

```text
orange-cat-v1             13
american-shorthair-v1      1
ragdoll-v1                 1
british-shorthair-v1       1
```

摇滚房间已启用 4 个演奏角色：`bassist-tuxedo`、`drummer-orange-tabby`、`guitarist-gray`、`vocalist-cream`。

服务器版本化静态资源中的 `character-catalog.json` 包含 8 个角色目录：

```text
orange-cat-v1
ragdoll-v1
british-shorthair-v1
american-shorthair-v1
tabby-v1
tuxedo-cat-v1
white-lion-cat-v1
jianzhou-cat-v1
```

因此，服务器已部署的前端包含本轮多角色完善结果；当前配置实际绑定的是其中 4 个角色，其余角色已经随发布包提供，可由管理配置按授权范围继续使用。

## 源码与发布包比对

本地保存的 `deploy/office/out/office-full-frame-20261024-03/` 与当前工作区源码比对结果：

- 516 个后端、部署工具和版本化前端依赖文件 SHA-256 完全一致。
- `frontend/office/index.html` 与 `admin.html` 只有发布时注入 release 前缀造成的模板差异。
- 发布包的 `SHA256SUMS` 全部通过。
- 服务器读取的角色目录、角色运行时、V5 runtime 和 telemetry adapter SHA-256 与本地源码完全一致。
- 发布包中的 8 个角色 manifest 与本地 `frontend/company-office/media/character-breeds/` 对应。

## 结论

服务器当前部署的 `office-full-frame-20261024-03` 是本工作区当前办公室前端/后端代码对应的最后一个已验证发布包。以这套已部署、已验收的代码作为正式项目版本，现标记为 **Star Office UI v6.0.0**。

`v6.0.0` 是项目/源码版本标记；服务器的不可变路径仍保留原 release ID `office-full-frame-20261024-03`，这样可以保留现有回滚和审计指针。正式切换到新的 `office-v6-*` 路径需要另行生成新包、备份、预检和切流验收，本次没有执行该变更。

本次未验证 Sub2API 插件健康字段：服务器快照中的 `plugin_status.status` 为 `unknown`，但采集源本身为 `ok`，并发/角色快照可正常读取。该字段不影响本次“前端/后端发布字节与当前源码一致”的结论。
