# 通用 API 交接验收记录

日期：2026-10-30。适用本次 standalone 遥测实现。结论：公司项目可按 [调用方文档](API_DEVELOPMENT.md) 上报真实指标，无需 Sub2API；Office 适配器已实现。服务维护者仍须完成目标环境部署并发放地址、项目 ID、主体映射及写入凭据，才能进行公司项目的实际接入。

## 新版对照边界

只读核对的线上基准为 `office-workspace-20261030-04`，已部署 Sub2API 为 `0.2.19`。现网遥测主接口响应正常；模型质量为 partial；单独的插件状态接口返回 404，不能据此声称插件状态健康。本次开发没有切换、重启或写入这些线上服务。

通用 API 复用 Office 的公开快照契约；没有要求同事重新实现办公室适配层。

| 新版能力 | standalone 实现 |
| --- | --- |
| 16 个工位、已有角色、配置和历史 | 复用 Office 存储与公开投影；测试保留一个主体绑定多个工位 |
| 姓名、并发、忙闲和分档气泡 | 从调用方完整观测投影；可信零与未知分开 |
| 今日 Token | 北京时间日窗口、绝对累计值、十进制字符串，跨日及过期不显示旧值 |
| 请求模型、实际模型、请求数 | 多模型映射、partial 和大整数计数保留 |
| 设备间状态 | service_state 与业务并发分开投影 |
| 故障和过期 | 按主体及每项指标独立判断；凭据/采集失败清空可信数据 |
| Sub2API Key 清单、安装 ID、插件健康状态 | 不模拟；使用公司项目自己的主体映射与服务状态 |

## 审计修复

- 原事件接口的并发幂等、JSON 键顺序幂等、整秒/小数秒排序及旧数据库时间迁移。
- PUT 路径 ID、显式重试时间、未知字段拒绝，以及 CORS 的 Idempotency-Key。
- 分主体过期判断、旧接口分页与完整性标识、数据库只读时 readiness=503。
- 非有限 JSON 数值拒绝、默认鉴权、受限秘密文件、项目隔离与读写权限分开。
- 新增真实指标契约、完整项目快照和 Office standalone 采集器，解除公司主体对 Sub2API 用户范围的依赖。

## 已执行验证

Python 共 262 项相关测试通过，覆盖 API、实际 HTTP、Office 契约/配置/采集、发布工具与交接文档。前端 70 项通过，1 项可选 Chromium 图像测试跳过。

实际链路使用临时数据库、合成指标和回环 HTTP：

```text
提供给同事的 TeamAPIClient
  → HTTP API
  → 真实 HTTP standalone Collector
  → Office /api/office/snapshot
  → 从当前服务器读取的新版 codec.mjs
```

确认 16 个工位契约、并发 3 的工作状态、Token `9007199254740993` 精度、模型映射和计数均保留。所用线上 codec 的 SHA-256 为 `cfa33b2daba8eb07c1236a19f7f8f048c8696caeb9e70b6ab12bb8d6fb4bab73`。

另以 Gunicorn 的 2 个工作进程和每进程 4 个线程启动独立 API，24 个并发重复请求得到 1 次创建、23 次幂等成功。HTTP 客户端遇到 503 后发送相同字节重试，并拒绝 307 重定向。OpenAPI 请求/响应、文档 JSON 示例、配置生成权限和禁止覆盖行为均经过检查。

为使仓库测试可复现，将活跃模型测试的合成快照移入受版本管理的夹具，更新旧遥测测试的模拟图片尺寸；另将既有上游不可用测试的错误期望改为其原本实现的 offline。没有为通过测试改变线上状态规则。

复现命令（Python 3.10+、Node；生产 Office 镜像为 Python 3.11）：

```bash
python -m pip install -r api-service/requirements-dev.txt
python -m unittest scripts.test_api_service scripts.test_team_telemetry scripts.test_team_api_http scripts.test_team_api_contract scripts.test_office_api scripts.test_office_collector scripts.test_office_store scripts.test_office_active_models scripts.test_office_app_integration scripts.test_office_release scripts.test_quickstart_update scripts.test_quickstart_config -q
node --test scripts/test_office_active_models.mjs scripts/test_office_bubble_status.mjs scripts/test_office_telemetry_adapter.mjs
```

默认 HTTP 测试使用仓库 codec；设置 OFFICE_CODEC_PATH 可使用已获取的目标部署 codec。测试不发送真实模型请求。

## 尚未执行的部署验证

本机未提供 Docker，因此 Compose 仅做 YAML/配置边界检查，未执行容器构建或启动。此次未做浏览器图像验收、目标 TLS 入口验收、真实公司项目指标验收或生产切换，也未将协议的 500 主体上限作为吞吐量承诺。交接时按 [部署说明](TEAM_API_OPERATIONS.md) 完成目标环境读回，不把本地通过当作已经上线。
