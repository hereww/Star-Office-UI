#!/usr/bin/env python3
"""Audit current runtime closure and classify stale asset/code candidates.

This command is intentionally read-only with respect to source assets.  It
uses the production-office packager's dependency closure as the authoritative
current-runtime boundary, then records compatibility and archive candidates in
JSON and Markdown.  It never deletes, moves, rewrites, or re-encodes assets.

Usage:
    python3 scripts/audit_deprecated_assets.py
    python3 scripts/audit_deprecated_assets.py --date 2026-10-30
"""
from __future__ import annotations

import argparse
from collections import Counter
from datetime import date
import importlib.util
import json
from pathlib import Path
import subprocess
from typing import Iterable


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MD = ROOT / "docs" / "DEPRECATED_ASSETS_AUDIT_2026-10-30.md"
DEFAULT_JSON = ROOT / "docs" / "DEPRECATED_ASSETS_AUDIT_2026-10-30.json"


def load_packager():
    source = ROOT / "scripts" / "package_office_release.py"
    spec = importlib.util.spec_from_file_location("office_release_packager", source)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load {source}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def files_under(path: Path) -> list[Path]:
    if path.is_file():
        return [path]
    if path.is_dir():
        return sorted(p for p in path.rglob("*") if p.is_file())
    return []


def rel(path: Path) -> str:
    return path.relative_to(ROOT).as_posix()


def stats(paths: Iterable[Path]) -> dict:
    paths = sorted({p for p in paths if p.is_file()})
    by_ext = Counter((p.suffix.lower() or "<none>") for p in paths)
    return {
        "files": len(paths),
        "bytes": sum(p.stat().st_size for p in paths),
        "extensions": dict(sorted(by_ext.items())),
        "paths": [rel(p) for p in paths],
    }


def expand(entries: Iterable[Path]) -> list[Path]:
    files: list[Path] = []
    for entry in entries:
        files.extend(files_under(entry))
    return files


def group(group_id: str, classification: str, severity: str, paths: Iterable[Path], evidence: str, action: str) -> dict:
    data = stats(paths)
    return {
        "id": group_id,
        "classification": classification,
        "severity": severity,
        "evidence": evidence,
        "action": action,
        **data,
    }


def tracked_count() -> int | None:
    try:
        return len(subprocess.check_output(["git", "ls-files"], cwd=ROOT, text=True).splitlines())
    except (OSError, subprocess.SubprocessError):
        return None


def build_report(audit_date: str) -> dict:
    packager = load_packager()
    selected_paths = set(rel(p) for p in packager.collect_frontend(ROOT))
    frontend_files = [p for p in (ROOT / "frontend").rglob("*") if p.is_file()]
    selected = [ROOT / p for p in selected_paths]
    unselected = [p for p in frontend_files if rel(p) not in selected_paths]

    breed_faces = list((ROOT / "frontend/company-office/media/character-breeds").glob("**/face-*.png"))
    candidate_character_dirs = [
        ROOT / "frontend/company-office/reference-v3/media/character-left",
        ROOT / "frontend/company-office/reference-v3/media/character-right",
        ROOT / "frontend/company-office/reference-v3/media/character-up",
    ]
    reference_furniture_composites = [
        ROOT / "frontend/company-office/reference-v3/media/furniture" / name
        for name in ("up.png", "down.png", "left.png", "right.png")
    ]
    legacy_backgrounds = [
        ROOT / "frontend/company-office/reference-v3/office-background.png",
        ROOT / "frontend/company-office/reference-v3/office-background-white-lab.png",
    ]
    orphan_code = [
        ROOT / "frontend/company-office/pixel-face-animation.mjs",
        ROOT / "frontend/company-office/connected-v4/style.css",
        ROOT / "frontend/company-office/connected-v5/style.css",
        ROOT / "frontend/office/media/character-breed-candidate-board.png",
    ]
    typing_archive = ROOT / "assets/company-office-connected-v5/archive/typing-prototype"

    groups = [
        group(
            "breed-face-atlases",
            "strong-cleanup-candidate",
            "P2",
            breed_faces,
            "The current full-frame manifests expose base.png and frames-*.png only; the V5/V4 validator rejects pixelFaceAnimation and the packager excludes these face atlases.",
            "Move to a dated legacy archive after the character-profile and V3 regression suites are confirmed unchanged; do not delete in place.",
        ),
        group(
            "unused-face-overlay-module-and-shims",
            "strong-cleanup-candidate",
            "P2",
            orphan_code,
            "No current runtime import reaches pixel-face-animation.mjs or either connected-v4/v5 style.css. The candidate board is not referenced by the admin page or the production release closure.",
            "Archive with this report, then remove only after a full text-reference and legacy-entrypoint review.",
        ),
        group(
            "reference-v3-character-candidates",
            "conditional-archive-candidate",
            "P2",
            [p for d in candidate_character_dirs for p in files_under(d)],
            "These candidate/repair trees are outside the current release closure, but V3 audit scripts and historical manifests still read them.",
            "Keep until the V3 regression scripts are retired or redirected; archive the complete subtree atomically if that decision is made.",
        ),
        group(
            "reference-v3-furniture-composites",
            "conditional-archive-candidate",
            "P2",
            reference_furniture_composites,
            "The production assets.json points to the directional back/front layers; these normalized composite PNGs are referenced by the historical furniture manifest and V3 audit evidence.",
            "Keep with the historical V3 manifest until that audit path is retired; archive the manifest and source images together.",
        ),
        group(
            "legacy-background-variants",
            "conditional-archive-candidate",
            "P3",
            legacy_backgrounds,
            "The active V5/V4/reference layouts use office-background-layered.png; these variants are outside the production closure and appear only in historical/preview context.",
            "Archive after verifying no legacy preview or Electron route still selects them.",
        ),
        group(
            "v5-typing-prototype-already-archived",
            "already-archived",
            "P3",
            files_under(typing_archive),
            "V5 documentation explicitly records handsCanvas/working-hands.mjs as retired; the complete prototype and QA evidence are already under an archive directory.",
            "Retain as rollback/design evidence; exclude from runtime and release packages.",
        ),
        group(
            "office-release-output-history",
            "generated-output-retention-candidate",
            "P2",
            expand((ROOT / "deploy/office/out").iterdir()) if (ROOT / "deploy/office/out").is_dir() else [],
            "deploy/office/out is a local immutable release-output directory. The active server release is office-workspace-20261030-01; older local packages are not runtime source.",
            "Retain the active/rollback packages and checksums; archive or remove older candidate IDs only after release rollback evidence is preserved.",
        ),
        group(
            "quickstart-bundle-history",
            "generated-output-retention-candidate",
            "P2",
            expand((ROOT / "deploy/bundles").iterdir()) if (ROOT / "deploy/bundles").is_dir() else [],
            "deploy/bundles is ignored local Quickstart output and has no source/runtime imports. It contains multiple dated bundles and embedded base images.",
            "Keep the latest approved bundle set; move older bundles to external archive storage before reclaiming disk space.",
        ),
        group(
            "design-proposal-assets",
            "non-runtime-design-evidence",
            "P3",
            files_under(ROOT / "assets/character-animation-proposals"),
            "These are proposal/source/QA assets and are not part of the production frontend dependency closure.",
            "Retain provenance, but keep them outside runtime paths; consolidate old proposal generations only when their source/QA records are preserved.",
        ),
    ]

    compatibility = [
        {
            "path": "frontend/company-office/runtime.mjs + seated-compositor.mjs + map-layout*.json",
            "reason": "Legacy root/Electron page and V3 regression tests still use this path.",
        },
        {
            "path": "frontend/company-office/reference-v3/controls.mjs + controls.css",
            "reason": "Legacy root page imports the controls directly; V4/V3 tests rely on the reference runtime boundary.",
        },
        {
            "path": "frontend/company-office/connected-v4/ and connected-v5/ runtime modules",
            "reason": "V5 production loads the V4 adapter and both graphs share the reference runtime identity.",
        },
        {
            "path": "frontend/company-office/media/character-breeds/**/{base,frames-*.png}",
            "reason": "Current character-profile manifests and the admin preview load these full-frame assets.",
        },
        {
            "path": "frontend/company-office/media/{character-base,face-*.png,workstation-*.png} and office-map*.webp",
            "reason": "Legacy CompanyOfficeRuntime/Electron compatibility still references this older single-seat pipeline.",
        },
        {
            "path": "frontend/index.html + frontend/game.js + frontend/layout.js + frontend/electron-standalone.html and root legacy sprites",
            "reason": "The legacy route and Electron shell still own this renderer; the production OFFICE release deliberately excludes it but the source tree keeps the compatibility path.",
        },
    ]

    return {
        "schema_version": 1,
        "audit_date": audit_date,
        "project": "Star-Office-UI",
        "working_tree": {
            "head": subprocess.check_output(["git", "rev-parse", "--short", "HEAD"], cwd=ROOT, text=True).strip() if (ROOT / ".git").exists() else None,
            "tracked_file_count": tracked_count(),
            "dirty_worktree_preserved": True,
        },
        "runtime_boundary": {
            "production_entrypoints": [
                "frontend/office/index.html",
                "frontend/office/admin.html",
                "frontend/office/map-loader.mjs",
                "frontend/company-office/connected-v5/runtime.mjs",
                "frontend/company-office/connected-v4/telemetry-adapter.mjs",
            ],
            "packager": "scripts/package_office_release.py",
            "selected_frontend_files": len(selected_paths),
            "selected_frontend_bytes": sum(p.stat().st_size for p in selected),
            "all_frontend_files": len(frontend_files),
            "unselected_frontend_files": len(unselected),
            "unselected_frontend_bytes": sum(p.stat().st_size for p in unselected),
            "unselected_frontend_extensions": dict(sorted(Counter((p.suffix.lower() or "<none>") for p in unselected).items())),
            "unselected_frontend_paths": sorted(rel(p) for p in unselected),
        },
        "groups": groups,
        "compatibility_retained": compatibility,
        "summary": {
            "source_files_changed": 0,
            "source_assets_moved": 0,
            "source_assets_deleted": 0,
            "deployment_touched": False,
            "reason": "Audit-only run; candidate cleanup remains reversible and reviewable.",
        },
    }


def markdown(report: dict) -> str:
    runtime = report["runtime_boundary"]
    groups = report["groups"]
    lines = [
        f"# 废弃资源、动画与代码审计（{report['audit_date']}）",
        "",
        "> 这份审计以当前正式办公室发布闭包为边界，记录候选和兼容保留项。审计过程不删除、不移动、不重编码源文件，也不修改服务器。",
        "",
        "## 结论",
        "",
        f"当前发布闭包包含 **{runtime['selected_frontend_files']} 个前端文件 / {runtime['selected_frontend_bytes']:,} bytes**；`frontend/` 总计 {runtime['all_frontend_files']} 个文件，未进入当前发布闭包的文件为 {runtime['unselected_frontend_files']} 个、{runtime['unselected_frontend_bytes']:,} bytes。未进入闭包不等于可以直接删除，因为旧根页面、Electron 和 V3 回归测试仍有兼容引用。",
        "",
        "最明确的清理候选是旧脸部叠加图集、未导入的像素脸动画模块、两个未导入的 connected CSS shim 和未引用的角色候选展示板。V5 当前使用整帧角色图集与独立屏幕层，旧 typing prototype 已经按项目文档放入 archive。",
        "",
        "## 候选分级",
        "",
        "| 分级 | 类别 | 文件数 | 大小 | 处理建议 |",
        "|---|---|---:|---:|---|",
    ]
    for item in groups:
        lines.append(f"| {item['severity']} | `{item['id']}`（{item['classification']}） | {item['files']} | {item['bytes']:,} bytes | {item['action']} |")
    lines += [
        "",
        "## 证据与边界",
        "",
        "### 当前发布闭包",
        "",
        "发布入口是 `frontend/office/index.html`、`admin.html`、`map-loader.mjs`，地图使用 V5 runtime 和 V4 telemetry adapter。闭包由 `scripts/package_office_release.py` 解析 ESM、CSS、HTML 和 manifest 的相对依赖得到；QA、fixture、`.local` 和未选中的候选图不会因目录邻近而进入生产包。",
        "",
        "### 必须保留的兼容项",
        "",
    ]
    for item in report["compatibility_retained"]:
        lines.append(f"- `{item['path']}`：{item['reason']}")
    lines += [
        "",
        "### 已归档项",
        "",
        "- `assets/company-office-connected-v5/archive/typing-prototype/`：旧手部/键盘动画和 QA 截图已隔离，当前 V5 不再创建 `handsCanvas`、`working-hands.mjs` 或键盘坐标绑定。",
        "",
        "### 大型本地产物",
        "",
        "- `deploy/office/out/`：历史正式办公室候选发布包和解包目录，属于回滚/证据产物，不是源码运行依赖。",
        "- `deploy/bundles/`：Quickstart 本地交付包和嵌入镜像，已被 `.gitignore` 忽略，不是源码运行依赖。",
        "- `.local/`：预览、浏览器截图、部署审计和临时备份，不能当作运行时资源。",
        "",
        "## 建议的整理顺序",
        "",
        "1. 先将 `breed-face-atlases`、`unused-face-overlay-module-and-shims` 做一次完整文本引用和 V3/Electron 回归确认，再统一移动到日期化 legacy archive。",
        "2. 保留 `reference-v3-character-candidates` 和 `reference-v3-furniture-composites`，直到旧 V3 审计脚本和历史预览决定退役；退役时按目录整体归档，避免只删 PNG 留下失效 manifest。",
        "3. 对 `deploy/office/out/` 和 `deploy/bundles/` 采用“最新批准包 + 当前线上回滚包 + 校验文件”保留策略，其他包先外置归档再回收磁盘。",
        "4. 每次实际移动或删除后重新运行本脚本、`python3 scripts/test_office_release.py`、V4/V5 契约测试和浏览器地图检查。",
        "",
        "## 本次变更状态",
        "",
        "本次只生成审计报告和机器可读清单，未修改运行时代码、未移动图片/动画、未删除文件、未触碰线上部署。这样可以把候选整理和回滚证据分开，避免误删当前地图依赖。",
        "",
        f"机器可读清单：`docs/DEPRECATED_ASSETS_AUDIT_{report['audit_date']}.json`。",
        "",
    ]
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--date", default=date.today().isoformat(), help="audit date used in output (YYYY-MM-DD)")
    parser.add_argument("--markdown", type=Path, default=DEFAULT_MD)
    parser.add_argument("--json", dest="json_path", type=Path, default=DEFAULT_JSON)
    args = parser.parse_args()
    report = build_report(args.date)
    args.json_path.parent.mkdir(parents=True, exist_ok=True)
    args.markdown.parent.mkdir(parents=True, exist_ok=True)
    args.json_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    args.markdown.write_text(markdown(report))
    print(f"markdown={args.markdown}")
    print(f"json={args.json_path}")
    boundary = {k: v for k, v in report["runtime_boundary"].items() if k != "unselected_frontend_paths"}
    print(json.dumps(boundary, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
