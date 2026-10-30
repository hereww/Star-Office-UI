# 2026-10-26 后台明文 HTTP 入口部署记录

## 结果

按用户明确要求，后台入口切换为：

```text
http://hereww.i234.me:19443/admin
```

服务器 `192.168.100.221` 已切换到独立发布 `office-http-admin-20261026-01`，Nginx 19443 改为 HTTP 监听，后台 API、同源校验和会话 Cookie 使用显式开关 `OFFICE_ADMIN_ALLOW_HTTP=1`。

## 生产切换

- 新镜像：`local/star-office-ui:office-http-admin-20261026-02`
- 镜像 SHA：`sha256:0a9fad3814176cea04236dd3e6beef52c7d5f2c9c6d83883125da8583eb11434`
- 新发布目录：`/opt/star-office-ui/releases/office-http-admin-20261026-02`
- 当前 Nginx include：`/opt/star-office-ui/ingress/office-http-admin-20261026-02.candidate.conf`
- `/admin` 使用当前 include 中的动态代理，保证 HTTP 开关进入页面引导 JSON。
- 备份目录：`/opt/star-office-ui/private/backups/office-http-admin-20261026-before-01`

只重建了 `office-web`。`office-collector` 仍使用原镜像 `office-seat-multi-binding-20261026-03`；为制作一致性备份曾与 office-web 一起短暂停止并恢复，恢复后为 healthy。Sub2API、PostgreSQL、Redis、Kaneo 和旧办公室容器未重启。

## 验收

- 发布完整性校验：通过
- 环境校验：通过
- 离线 Docker 构建：通过
- HTTP 后台页面：`200 OK`
- HTTP 页面动态引导：`admin_http_allowed=true`，登录表单在 HTTP 页面可见
- HTTP `/health`：`200 OK`
- HTTP `/api/office/admin/session`：`200 OK`，Cookie 为 `HttpOnly; SameSite=Lax`，不再带 `Secure`
- HTTP 错误密码：返回 `401 LOGIN_FAILED`，没有返回 `HTTPS_REQUIRED`
- 新增 HTTP opt-in API 测试：`2/2` 通过
- 发布套件：`60/60` 通过

当前工作站从局域网访问公网域名时受到路由器 NAT 回环限制，公网探测没有在服务器访问日志中出现；因此“从真正外网访问该域名”的验收仍需在外网客户端完成。服务器本机通过带公网 Host 的 HTTP 请求已完成应用层读回。

## 回滚

未执行回滚。旧镜像仍保留；切换前的 Nginx wrapper、include、运行时环境、Office/legacy 数据卷归档和校验文件均在备份目录中。恢复前应先停用 HTTP 入口并重新运行 Nginx 语法、容器健康和数据读回检查。
