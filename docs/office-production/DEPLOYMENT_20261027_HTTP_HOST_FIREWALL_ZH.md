# 2026-10-27 后台 HTTP Host 限制与端口放行记录

## 变更

- 活动配置：`/opt/star-office-ui/ingress/office-http-admin-20261026-02.candidate.conf`
- 两个 Nginx server 均改为 `server_name _;`，移除 Host 域名白名单判断。
- `19443/tcp` 已加入 firewalld `public` 区，运行时和永久配置均已生效。
- 只重载 `star-office-ingress.service`，没有重启 `office-web`、采集器、Sub2API、数据库、Redis 或 Kaneo。
- 回滚材料：`/opt/star-office-ui/private/backups/office-http-host-20261027-before-01`

## 服务器侧验证

- Nginx 配置检查通过，`star-office-ingress.service` 为 `active`。
- `http://192.168.100.221:19443/admin`：HTTP 200。
- 使用 `Host: hereww.i234.me`：HTTP 200。
- 使用任意测试 Host：HTTP 200，说明 Host 白名单已移除。
- `/health`：HTTP 200。
- 通过预认证会话后，域名登录错误密码返回 `401 LOGIN_FAILED`，没有再返回 `HTTPS_REQUIRED` 或 Host 拒绝。
- HTTP 会话 Cookie 保留 `HttpOnly; SameSite=Lax`，没有 `Secure`，符合已启用的明文 HTTP 模式。

## 外网边界

当前工作站位于同一内网，访问 `hereww.i234.me` 的公网地址会受到路由器 NAT 回环限制；这次请求没有出现在服务器访问日志中。因此服务器监听、防火墙和应用层已完成，路由器 WAN 端口转发仍需用手机流量或其他外网客户端打开：

```text
http://hereww.i234.me:19443/admin
```

