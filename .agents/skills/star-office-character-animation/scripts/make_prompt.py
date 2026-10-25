#!/usr/bin/env python3
"""Compose cardinal-only character/workstation prompts; no requests or file writes."""
import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def load_config():
    return json.loads((ROOT / "references/prompts.json").read_text(encoding="utf-8"))


def compose(request, reference=None, distinct=False, direction=None, workstation_reference=None):
    config = load_config()
    name = request.lower().strip()
    if name == "workstation":
        facing = direction or config["default_direction"]
        if facing != "down":
            raise ValueError("当前静态工位提示词只定义朝下；不要旋转冒充其他方向工位")
        ref = Path(reference).expanduser().resolve() if reference else ROOT / config["default_reference"]
        if not ref.is_file():
            raise ValueError("风格参考图片不存在：" + str(ref))
        return {"requested": request, "action": "workstation", "label": "静态工位前后两层",
                "business_state": None, "direction": facing, "asset_type": "static_workstation_layers",
                "workstation_context": True, "workstation_reference_used": False,
                "frame_count": 1, "preview_fps": 0,
                "grid": {"columns": 2, "rows": 1, "order": "rear-then-front"},
                "target_cell_size": config["office_target_cell_size"], "target_sheet_size": [384, 192],
                "referenced_image_paths": [str(ref)], "transparent_background": True,
                "prompt": config["static_workstation_prompt"], "runtime_integrated": False}
    state = config["state_aliases"].get(name, name)
    state_map = config["state_actions_distinct" if distinct else "state_actions_default"]
    if state in state_map:
        action, business_state = state_map[state], state
    elif name in config["actions"]:
        action, business_state = name, None
    else:
        raise ValueError("未知动作或状态：" + request)
    walking_direction = action.removeprefix("walk-") if action.startswith("walk-") else None
    if direction is not None and direction not in config["allowed_directions"]:
        raise ValueError("朝向只允许up/down/left/right，不允许斜向")
    if walking_direction and direction and direction != walking_direction:
        raise ValueError("行走动作和指定朝向冲突：" + action + " / " + direction)
    facing = walking_direction or direction or config["default_direction"]
    ref = Path(reference).expanduser().resolve() if reference else ROOT / config["default_reference"]
    if not ref.is_file():
        raise ValueError("母版图片不存在：" + str(ref))
    at_workstation = action in config["workstation_actions"]
    refs = [str(ref)]
    if workstation_reference:
        if not at_workstation:
            raise ValueError("工位参考仅用于working/writing/researching/executing/syncing")
        station = Path(workstation_reference).expanduser().resolve()
        if not station.is_file():
            raise ValueError("工位参考不存在：" + str(station))
        refs.append(str(station))
    blocks = [config["common_prompt"]]
    if not reference:
        blocks.append(config["default_identity_prompt"])
    blocks.append(config["direction_prompts"][facing])
    if at_workstation:
        blocks.extend([config["workstation_prompt"], config["workstation_direction_prompts"][facing]])
        blocks.append(
            "The second attached image is a fixed workstation GEOMETRY reference only. Preserve its alignment, but DO NOT reproduce any furniture."
            if workstation_reference else
            "No workstation geometry reference is attached. Generate only a seated character pose concept, never furniture. Hand contact/alignment cannot be verified without the actual station."
        )
    if at_workstation and facing == "down":
        blocks.append(config["office_geometry_prompt"])
    blocks.append(config["actions"][action]["prompt"])
    return {
        "requested": request,
        "action": action,
        "label": config["actions"][action]["label"],
        "business_state": business_state,
        "direction": facing,
        "workstation_context": at_workstation,
        "workstation_reference_used": bool(workstation_reference),
        "asset_type": "character_only",
        "frame_count": config["frame_count"],
        "preview_fps": config["preview_fps"],
        "grid": config["grid"],
        "target_cell_size": config["office_target_cell_size" if at_workstation else "target_cell_size"],
        "target_sheet_size": config["office_target_sheet_size" if at_workstation else "target_sheet_size"],
        "referenced_image_paths": refs,
        "transparent_background": True,
        "prompt": "\n\n".join(blocks),
        "runtime_integrated": False,
    }



def compose_expression(request, reference=None, face_reference=None, direction=None):
    """Office-only expression atlas; never animate or output a complete seated body."""
    if direction not in (None, "down"):
        raise ValueError("当前固定坐姿表情模板仅支持正面down，不旋转脸部冒充其他方向")
    if reference and not face_reference:
        raise ValueError("替换角色时请用--face-reference提供该角色静态坐姿的脸部裁图")
    config = json.loads((ROOT / "references/seated-expressions.json").read_text(encoding="utf-8"))
    name = request.lower().strip()
    action = config["state_map"].get(name, name)
    if action not in config["actions"]:
        raise ValueError("表情模式只支持working/idle/syncing/error及原六业务状态")
    face = Path(face_reference).expanduser().resolve() if face_reference else ROOT / "assets/orange-cat-seated-face-reference.png"
    master = Path(reference).expanduser().resolve() if reference else ROOT / "assets/orange-cat-reference.png"
    for ref in (face, master):
        if not ref.is_file():
            raise ValueError("参考图片不存在：" + str(ref))
    return {"requested": request, "action": action, "label": config["actions"][action]["label"],
            "business_state": name if name in config["state_map"] else None,
            "direction": "down", "asset_type": "face_only", "animation_mode": "expression-only",
            "frame_count": 12, "preview_fps": 12, "expression_interval_seconds": config["actions"][action].get("face_clock_frames", 60) / 12,
            "face_clock_frames": config["actions"][action].get("face_clock_frames", 60),
            "grid": {"columns": 4, "rows": 3, "order": "row-major"},
            "target_cell_size": [90, 58], "target_sheet_size": [360, 174],
            "referenced_image_paths": [str(face), str(master)], "transparent_background": True,
            "prompt": config["common_prompt"] + "\n\n" + config["actions"][action]["prompt"],
            "runtime_integrated": False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", nargs="?", help="walk-up/down/left/right、业务state，或workstation静态工位")
    parser.add_argument("--reference", help="替换默认橘猫母版的本地图片路径")
    parser.add_argument("--distinct-state", action="store_true", help="拆分writing/researching/executing的工作动作")
    parser.add_argument("--direction", choices=["up", "down", "left", "right"], help="固定朝向；办公默认down，行走由动作名决定")
    parser.add_argument("--workstation-reference", help="已独立绘制的固定工位几何参考路径；不将家具画进角色图")
    parser.add_argument("--expression-only", action="store_true", help="当前办公模式：固定坐姿，仅12帧脸部表情，不生成手或家具")
    parser.add_argument("--face-reference", help="固定坐姿脸部裁图；替换角色时必须同时提供")
    parser.add_argument("--json", action="store_true", help="包含母版、工位、朝向、帧规格和提示词的JSON")
    parser.add_argument("--list", action="store_true", help="显示默认8套动作与业务状态映射")
    args = parser.parse_args()
    if args.list:
        config = load_config()
        print(json.dumps({"default_actions": config["default_actions"], "business_state_to_action": config["state_actions_default"], "allowed_directions": config["allowed_directions"], "default_stationary_direction": config["default_direction"]}, ensure_ascii=False, indent=2))
        return
    if not args.action:
        parser.error("需要动作/状态，或使用--list")
    try:
        if args.expression_only:
            if args.distinct_state or args.workstation_reference:
                raise ValueError("表情模式不混用--distinct-state或工位整图；只附脸部裁图和母版")
            result = compose_expression(args.action, args.reference, args.face_reference, args.direction)
        else:
            if args.face_reference:
                raise ValueError("--face-reference仅用于--expression-only")
            result = compose(args.action, args.reference, args.distinct_state, args.direction, args.workstation_reference)
    except ValueError as exc:
        parser.error(str(exc))
    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        print(f"动作：{result['action']} · {result['label']} · 朝向：{result['direction']}")
        for i, ref in enumerate(result['referenced_image_paths']):
            print(f"附图{('脸部裁图' if i == 0 else '母版') if result['asset_type'] == 'face_only' else ('母版' if i == 0 else '工位')}：{ref}")
        print(f"规格：{result['frame_count']}帧，{result['grid']['columns']}列×{result['grid']['rows']}行，预览{result['preview_fps']}fps；真实透明背景；类型={result['asset_type']}")
        print("\n" + result["prompt"])


if __name__ == "__main__":
    main()
