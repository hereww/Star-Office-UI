# company-office v3 left — rejected candidate archive

**不合格候选，仅归档，不可集成。** 所有生成/整理文件在本目录及对应frontend目录。原确认模板与原角色母版未改变。

- `manifest.json`：完整left character config、时钟、文件hash及拒绝原因；URL以reference-v3为根。
- `character-base.png`：192×192静态left侧坐姿（脚趾块前爪歧义，严格无手未通过）。
- `face-working.png`、`face-idle.png`、`face-syncing.png`、`face-error.png`：360×174候选局部表情，12帧4×3，90×58单格。
- `originals/`：内置image_gen原图，未改动。
- `prompts/`：5条实际生成提示词，每个动作一次调用。
- `sources/`：原角色身份母版副本、新left底图脸部裁图及8x参考。
- `frames/`：每套12张90×58，纯分格，无新增帧。
- `scripts/preprocess_left.py`：仅裁切/缩放/图集整理，不画表情、不复制帧。
- `scripts/qa_left.py`：实际alpha、帧差、固定脸区及模板hash检查。
- `qa/REVIEW.md`及`qa/validation-measurements.json`：拒绝原因、逐帧数据。
- `qa/*contact*.png`：离线合成接触表，用于看接缝/锚点，不是runtime修改。
- `FILES.md`与`files.json`：所有本次改动的完整绝对路径清单。

时钟：working=60、idle=36、syncing=60、error=12，fps=12。没有旋转前向或镜像素材，没有物理摇头/呼吸，也没有把前向图集当left。
