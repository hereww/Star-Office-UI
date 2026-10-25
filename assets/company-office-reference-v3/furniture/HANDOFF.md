# v3 家具交接（仅家具，不是角色或运行时验收）

2026-10-02，本任务写集仅以下两个目录：
- `frontend/company-office/reference-v3/media/furniture/`
- `assets/company-office-reference-v3/furniture/`

主代理可读取 `frontend/company-office/reference-v3/media/furniture/manifest.json`，将 `directions.<direction>.furniture` 原样合并至 v3 方向配置。本文和 manifest 不修改 layout/assets/runtime/index。

状态：`furniture-ready-for-integration`。主代理通信工具因 native ancestor 限制拒绝投递；文件式交接已就绪，最终回复回传完整配置。

## 校准值

| direction | seatAnchor | screen.visible | order |
| --- | --- | --- | --- |
| up | [96,145] | true | back,screen,actor,front |
| down | [97,94] | false | back,actor,front,screen |
| left | [131,128] | true | back,screen,actor,front |
| right | [62,130] | true | back,screen,actor,front |

全部资源是完整 **192×192** 逻辑画布，绝不 trim。`seatAnchor` 遵从当前 player 的身体下部 `poseAnchor` 注册约定，不是头锚点。up 的注册测试按现有 rear source 整图 resize→192，poseAnchor=[96,170]、scale=0.6；如果主代理另外归一化 back body 的边界，应保留家具坐标并调整角色自己的 poseAnchor，而不是改桌椅。

路径（相对 reference-v3 根）统一 `media/furniture/<direction>-back.png`、`media/furniture/<direction>-front.png`。

- up：桌、键盘、正面屏幕后景；近侧椅背、扶手、转椅底盘前景。屏幕特效先于角色绘制，以免画到背向猫头上。
- down：上方椅的正面后景，下方桌与显示器后壳前景。键盘位于后壳后方、靠椅一侧。后壳只 LED；`visible:false` 不允许显示内容。polygon 是非渲染的四角投影记录，不是真正可见屏幕。
- left：桌左、椅右、角色面向左；显示器正面朝右靠角色。前层仅低位近扶手、桌的近沿/裙板/桌脚。
- right：桌右、椅左、角色面向右；显示器正面朝左靠角色。前层仅低位近扶手、桌的近沿/裙板/桌脚。

## 可追溯原材

- 原始 1254×1254 RGBA：`sources/{up,down,left,right}-source.png`，逐字节复制生成输出。
- up 是主代理给定候选；down/left/right 各一次独立 built-in image_gen，不旋转、不镜像。
- `prompts/<direction>.txt` 是每次调用的确切 prompt；`*-request.json` 是对应参数；`generation-record.json` 记录调用与原始文件哈希。
- `scripts/build_furniture.py`：只整图 nearest resize、移除低 alpha<16 游离噪点、互补透明 mask 分层，不画/修补 RGB 家具。
- up mask 中的橡木像素归 back，仅做 alpha 分配，不绘图。所有屏幕/键盘/支架结构来自生成图。

## QA 与范围边界

- `qa/alpha-qa.json`：尺寸、真实 alpha、边缘/四角透明、屏幕内部蓝色取样、LED 位于实心壳、back/front 无重叠且逐像素还原。
- `qa/registration-qa.json`：只读借用身体资源验证位置，down/left/right 前层遮脸像素=0；原冻结模板 19 文件与既存 SHA256 一致。
- `qa/registration-contact-sheet.png`：顺序 up/down/left/right。right 为其资源代理尚未接受的 base candidate，仅用作尺寸遮挡参考；它的手部/表情缺陷不属于本家具任务，绝不能据此声称该角色通过验收。
- `qa/interface-qa.json`：当前 DirectionalSeatedPlayer 方向接口接受；原六状态×两种 reduce-motion×六时点，共288屏幕采样通过；down 从不显示 polygon 内容。
- `qa/browser-qa.json` + `qa/browser-furniture-screen-qa.png`：现有本机 Chrome 验证工作／同步／错误屏幕；遮罩外变化像素=0，down 每次仅2个 LED 像素变化。未安装浏览器或依赖。
- `qa/visual-qa.json`：四原图、分层、角色定位联系图、浏览器实图已人工式目视核验。
- 家具生成／分层／遮挡核验通过，不代表主代理的 16席实际集成、运行时 QA 或其他角色验收通过。

未安装依赖、未改角色或原确认资源、未编辑运行时、未部署远端、未新建代理。
