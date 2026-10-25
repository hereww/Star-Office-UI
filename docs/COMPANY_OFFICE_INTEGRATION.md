# 公司主地图接入 v1

2026-10-01。接入的是 Flask `/` 返回的 **`frontend/index.html` Phaser 主页面**，不是素材独立演示页。远端服务未部署。

## 当前效果

- 默认地图：`frontend/company-office/office-map-v1.webp`，1280×720。
- 原雪山木屋背景及角色全部保留；`/?scene=legacy` 可查看原场景。
- 新图为上下左右正交平面；背景中央没有工位/角色，六套工位由程序叠加。
- 工位原尺寸192×192，朝下正对画面。`map-layout.json`集中保存点位、区域和访客位置。
- 已确认橘猫身体与四套脸部图集原样复制；椅子后景、角色、桌/显示器/键盘前景分层组合。
- 所有状态主角固定在 `desk-05`。无漂移、无手部动画。待命在工位仰脸熟睡，出错在工位旋涡眼。
- 工作三状态共用working，原六状态API不变：

| API状态 | 角色表情 | 帧数/fps | 播放方式 |
|---|---|---|---|
| idle | 仰脸张嘴熟睡 | 12 / 12fps | 每3秒一轮，其余保持第0帧 |
| writing | 专注 | 12 / 12fps | 每5秒一轮，其余保持第0帧 |
| researching | 专注 | 12 / 12fps | 同上 |
| executing | 专注 | 12 / 12fps | 同上 |
| syncing | 等待 | 12 / 12fps | 每5秒一轮，其余保持第0帧 |
| error | 迷糊旋涡眼 | 12 / 12fps | 连续循环 |

服务器状态保留在新机柜的提示、指示灯和错误描边中；旧版的大型sync/error角色效果不叠到新地图。`/agents`和访客列表继续使用原逻辑；访客仍按breakroom/writing/error放置，使用原访客形象，不伪装成新橘猫。公司模式暂不启用demo随机斜向tween。

手机默认完整显示16:9地图，不拉伸、不留2/3屏幕的黑色空区。主角没有接入未完成的行走动画；已确认的四向A/B只是方向模板，不能复制成12帧。

## 后续改什么

| 需求 | 文件/接口 |
|---|---|
| 换公司地图 | 新增版本背景，更新`frontend/company-office/map-layout.json`的background；画布仍1280×720 |
| 移动工位或改变数量 | `map-layout.json`的stations/mainStation；所有桌椅作为整体同坐标移动 |
| 固定家具组合比例 | `office-assets.json`的workstation配置；不改12帧脸部图集 |
| 换角色 | 准备同方向192×192坐姿底图、4套360×174脸部图集和角色锚点；更新character配置 |
| 运行时换角色 | `window.officeRuntime.replaceCharacter(characterConfig, {baseUrl: '/static/new-character/'})`；该目录不需要复制家具 |
| 改业务状态 | 不添加working API；继续原六状态`/set_state`、`/status` |
| 改表情节奏 | `office-assets.json`中的fps/faceClockFrames；维持12帧协议 |

角色替换接口先完整加载并验证新资源，再原子替换演员纹理；固定家具不动。任意站立PNG不能直接当坐姿底图。其他方向的坐姿需要对应独立资产，不能旋转当前down图集冒充。

冻结模板 `.agents/skills/star-office-character-animation/assets/approved-office-expressions-v1/` 未修改。`frontend/company-office/` 是运行副本，之后需要另建角色版本，不覆盖冻结源。

新版地图不是原公司户型的精确复刻，属于本次允许重新制作的正交办公室候选。实际布局仍可按验看反馈调整。

## 本机运行与隔离

使用已安装`backend/requirements.txt`的Python环境：

```sh
python scripts/preview_company_office.py --port 19000
```

- 真实Flask后端和主前端，监听`127.0.0.1`，不对外暴露。
- 临时业务/访客/运行配置保存在`.local/company-office-preview/`。
- 生产的默认数据目录不变；只有指定`STAR_OFFICE_DATA_DIR`才改为隔离目录。
- 旧版预览端口58085、63467、54634没有停止。
- 本次修改前代码快照在`.local/company-office-backups/`。Git原有README、Skill、候选素材修改保留，未提交、未推送。
- 原地图生成服务仍面向旧背景文件；新版本背景应在资产侧栏按精确路径上传，或更新map-layout里的版本路径，不通过旧搬家生成按钮覆盖冻结家具。

## 验收

```sh
node scripts/test_company_office.mjs
```

通过：六状态映射、72帧确定性绘制参数、源模板21文件SHA-256、角色/家具运行副本与原文件一致、12帧播放节奏、非法布局和状态拒绝。

实浏览器结果：`assets/company-office-map-v1/qa-report.json`。

- 通过真实`/set_state`和`/status`验证六状态；每套12帧均不同。
- 72帧脸部覆盖区域以外像素差异为0；六个工位坐标完全相同。
- 轮询相同状态不会重置动画时钟；旋涡眼在状态轮询后继续播放。
- 同一角色通过换角接口重载，家具坐标及业务状态不变。
- 三个临时访客在真实`/agents`及地图出现，点位/比例正常；测试后已经恢复隔离数据，未留下模拟访客。
- 手机390×844，真实触屏模拟，画布390×219.375，无横向溢出；测试后恢复默认视口。
- 最终稳定运行窗口无浏览器error/warn，/health和/agents均200。修改主页面重启本地预览期间有短暂轮询网络失败，已恢复；未重启远端或其他预览。原场景回退能显示，仍有原有star_idle第48帧警告，未修改原动画。

本机集成验收不等于远端部署、真实手机实机验收或新地图已获用户视觉确认。

## 公司实际平面图 v2（后续版本）

默认地图现已切换到纵向2048×2816公司户型：33开放工位＋3独立办公室展示工位，完整空间分析和最新接口见 [COMPANY_OFFICE_FLOORPLAN.md](COMPANY_OFFICE_FLOORPLAN.md)。本文上述1280×720六工位说明属于历史v1，现通过 `/?scene=v1` 回退。原场景仍用 `/?scene=legacy`。Runtime已经支持不同世界尺寸，不再要求画布或地图固定1280×720。
