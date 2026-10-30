# 新版代码地图

## 运行链路

```text
HTTP /admin
  └─ backend/app.py
      └─ frontend/office/index.html 或 admin.html
          └─ bootstrap.mjs
              └─ app.mjs
                  ├─ employee.mjs / admin.mjs
                  ├─ codec.mjs / admin-codec.mjs
                  ├─ transport.mjs
                  └─ map-loader.mjs
                      ├─ 当前场景 runtime
                      ├─ 当前场景 telemetry adapter
                      ├─ reference-v3 render-quality
                      └─ vendor/phaser
```

当前地图装配的依赖关系是：

```text
connected-v5/runtime
  ├─ connected-v5/seated-player
  │   └─ reference-v3/directional-player
  ├─ connected-v5/screen-overlay
  ├─ connected-v5/rock-room-animation
  └─ connected-v5/furniture-contract / bubble-layout

connected-v5/telemetry-adapter
  └─ connected-v4/telemetry-adapter
      ├─ reference-v3/runtime
      ├─ office/model
      └─ office/bubble-status
```

`connected-v4` 和 `connected-v5` 是源码目录与运行时标识，不是项目发行号。V4 目录保留共享遥测桥、家具基线和兼容回归；V5 目录拥有当前连排工位、角色模板、独立屏幕和摇滚房间场景。

## 目录职责

| 目录 | 责任 | 修改前先确认 |
| --- | --- | --- |
| `backend/office_*.py` | 契约、授权范围、采集快照、存储和安全会话 | 公共投影是否泄露私有字段；旧 API 是否保持隔离 |
| `frontend/office/` | 页面、状态投影、管理员交互和地图装配 | 是否把运行时算法错误放进页面层 |
| `frontend/company-office/connected-v5/` | 当前连排工位场景、角色模板、屏幕和摇滚房间 | manifest、坐标、遮挡和 reduced-motion 契约 |
| `frontend/company-office/connected-v4/` | 共享家具/座位契约、遥测桥和兼容测试 | 是否会破坏 V5 依赖或冻结像素边界 |
| `frontend/company-office/reference-v3/` | 基础角色渲染、屏幕效果、字体和参考布局 | 是否需要完整回归；不要用候选图覆盖冻结资源 |
| `scripts/` | 静态检查、发布打包、浏览器和像素 QA | 输出是否写入 QA 或本地证据目录 |
| `deploy/office/` | 正式发布、预检、备份、回滚和健康读回 | 是否生成新的不可变 release ID |

## 发布边界

`scripts/package_office_release.py` 从 `frontend/` 的依赖闭包和必要兼容入口生成不可变发布包。`assets/`、`.local/`、测试、截图和候选素材不会因为位于相邻目录而自动进入发布包。修改 loader、manifest 或 import 后，必须检查闭包清单和 `SHA256SUMS`，再进行目标环境验收。

## 推荐测试顺序

```text
静态语法/契约
  → connected-v4/connected-v5 专项测试
  → node scripts/test_company_office.mjs
  → python3 scripts/test_office_release.py
  → 真实浏览器或部署只读验收
```

失败时先判断是页面层、运行时层、数据契约还是发布闭包问题，不要为了让单个截图通过而修改基础渲染或复制一套新运行时。
