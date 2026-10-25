# v3 右向角色素材：未通过候选

日期：2026-10-02。状态：`candidate_not_accepted`。不要因尺寸或哈希检查通过而接入运行时；`visualApproved=false`、`productionReady=false`、`runtimeIntegrated=false`、`doNotIntegrate=true`。

## 已交付

- 内置 `image_generation / image_gen`：右向独立底图 1 次，working / idle / syncing / error 每动作各 1 次，共 5 次。没有 CLI / Images API 替代调用，没有重试，没有镜像左向、旋转正面或复制静帧。
- `originals/`：5 张图工具原图，逐字节保留；来源/哈希/参考图见 `generation-record.json`。
- `prompts/`：5 条实际生成提示词及共用规格；`references/` 保存身份母版和该右向候选的脸部裁图。
- 当前目录和前端 `reference-v3/media/character-right/`：一张 `base-right-candidate.png`，192×192 RGBA；四张 `face-{working,idle,syncing,error}-candidate.png`，360×174 RGBA，4列×3行、每格90×58。`frames/{action}/00.png..11.png` 为各原图真实拆出的12帧。
- 两处 `manifest.json` 内容一致。`character.base` 与 `actions.*.face` **相对 reference-v3 根**，不是相对 manifest 所在目录。`scale=0.6`；固定 `faceRect=[86,60,90,58]`、`faceClipEllipse=[131,89,45,29]`。锚点是候选测量值，尚未对方向工位验收。
- 12fps：working / syncing 60-frame（5秒）时钟；idle 36-frame（3秒）；error 12-frame（1秒）连续循环。
- `qa/report.json`、`qa/normalized-sha256.json`：机器检查；`qa/candidate-overview.png`、`qa/composite-*-12.png`、`qa/eye-*-12-4x.png`：真实离线合成/局部放大检查；`qa/preview-*.gif`：12张真实表情帧按对应时钟播放的查看辅助。PNG才是透明度来源，GIF不是生产资源。

## QA结论

通过：严格右向真侧面、一只可见眼、原橘虎斑身份可辨认；无家具；所有PNG有真实alpha透明且未绘制棋盘背景；四套各12格非空且12个可见RGBA帧不同；尺寸、时钟与相对v3根的URL正确。离线固定脸区合成中，脸区椭圆外的身体/耳朵/尾巴全48帧逐像素不变。原冻结模板21个文件加身份源1个文件，合计22个SHA-256均未变化。

**未通过：**

1. 底图仍有一只静态前爪，违反“无手”。没有通过脚本抹去、重画或遮盖冒充通过。
2. 脸图的非表情毛色、胡须、鼻嘴位置/轮廓存在帧间及行间漂移。配置矩形固定不等于生成内容已经稳定；工作/睡觉/等待行间变化尤为明显。
3. 熟睡单独图集确有仰脸、闭眼、张嘴，但鼻子升高并向左收缩；透明叠加到原底图时保留了旧鼻嘴，出现双鼻嘴。不能作为已通过熟睡资源。
4. 出错12格都是真实生成的旋涡眼，各格曲线不同；没有确认符合严格等步长顺时针相位及自然连续接缝，不用“12个哈希不同”代替动画验收。

未修改UI、runtime、家具、其他方向或冻结模板，未部署、未创建新代理。全部保留为候选供复查。

## 脚本边界与复现

`normalize_assets.py` 只做必要裁切、共同尺度最近邻缩放、12格拆分和图集整理；不绘制、旋转、镜像、换色、修补透明度或合成新帧。底图用可见alpha边界确定裁切框，框内原alpha原样保留。`qa_assets.py` 只检查数据并生成离线查看预览，不修改生成资产或运行代码。

运行时不要自动安装依赖；使用已存在的Pillow/NumPy环境。当前可复现环境为：

```sh
PYTHONDONTWRITEBYTECODE=1 /Users/hepingyu/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 /Users/hepingyu/Documents/ChatGPT/Star-Office-UI/assets/company-office-reference-v3/character-right/scripts/normalize_assets.py base
# 动作参数分别为 working、idle、syncing、error，每次仅整理已有原图，不联网生成。
PYTHONDONTWRITEBYTECODE=1 /Users/hepingyu/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 /Users/hepingyu/Documents/ChatGPT/Star-Office-UI/assets/company-office-reference-v3/character-right/scripts/qa_assets.py
```
