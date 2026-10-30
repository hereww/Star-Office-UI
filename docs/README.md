# 文档入口

这里按“当前开发说明、运行与发布、历史证据”分层。当前开发请从无日期、无发行号的文档开始；带日期或历史运行时标识的文件只用于追溯，不作为新的实现说明。

## 当前开发

1. [项目结构与边界](./PROJECT_STRUCTURE.md)
2. [新版开发入口](./development/README.md)
3. [新版代码地图](./development/code-map.md)
4. [动画与素材接入](./ANIMATION_ARCHITECTURE.md)
5. [服务部署与回滚](./DEPLOYMENT.md)

素材清理和归档请同时阅读：[素材审计](./DEPRECATED_ASSETS_AUDIT_2026-10-30.md)、[素材清理记录](./DEPRECATED_ASSETS_CLEANUP_2026-10-30.md) 和 [素材归档记录](./ASSETS_ARCHIVE_2026-10-30.md)。这些日期化文件记录证据，不替代无日期的开发规则。

## 资产和协作

- [素材归档记录](./ASSETS_ARCHIVE_2026-10-30.md)：外部快照、恢复规则和保留边界。
- [公司办公室代码说明](../frontend/company-office/README.md)：运行时目录的职责和修改顺序。
- [新版办公室页面说明](../frontend/office/README.md)：页面、数据投影和测试边界。
- [公司办公室运行时说明](../frontend/company-office/README.md)：V3/V4/V5 场景、兼容边界和地图装配规则。

## 历史证据

`office-production/`、`*_ACCEPTANCE.md`、`*_PLAN.md`、带日期的部署记录和 QA 目录是不可变审计材料。它们可以证明某次验收或部署发生过，但不要把其中的旧路径、旧 release ID 或旧实验结论直接复制到新功能。

## 版本规则

项目发行号只在根目录 `VERSION`、构建元数据和生成的发布清单中维护。当前开发文档不在标题、目录或代码边界中重复发行号；`connected-v4`、`connected-v5`、`reference-v3` 仅作为运行时/场景标识。
