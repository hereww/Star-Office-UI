"""Safe, versioned visual character catalog for the production office.

The catalog is deliberately separate from telemetry and credentials. It describes
which visual profiles exist and which ones are safe to assign to the live office.
Static concepts may be previewed while their profiles remain non-assignable
until their assets pass the full runtime/pixel QA matrix.
"""
from __future__ import annotations

import copy

DEFAULT_CHARACTER_PROFILE_ID = "orange-cat-v1"
CHARACTER_TEMPLATE_ID = "connected-v5-character-template-v1"
CHARACTER_ANIMATION_MODE = "full-frame"
CHARACTER_MANIFEST_CONTRACT_VERSION = 2

# Keep this allowlist server-owned. Do not accept arbitrary asset paths or prompt
# text from the admin/browser configuration payload.
_CHARACTER_PROFILES = (
    {
        "id": "orange-cat-v1",
        "label": "橘猫",
        "breed": "orange domestic shorthair",
        "status": "ready",
        "production_ready": True,
        "assignable": True,
        "directions": ["up", "down", "left", "right"],
        "actions": ["working", "idle", "syncing", "error"],
        "template_id": CHARACTER_TEMPLATE_ID,
        "description": "V5 固定坐姿整帧动画；共享长桌和独立屏幕效果，不含行走或键盘手部动画。",
        "fallback_profile_id": None,
        "animation_mode": CHARACTER_ANIMATION_MODE,
        "manifest_contract_version": CHARACTER_MANIFEST_CONTRACT_VERSION,
    },
    {
        "id": "ragdoll-v1",
        "label": "布偶猫",
        "breed": "ragdoll",
        "status": "ready",
        "production_ready": True,
        "assignable": True,
        "directions": ["up", "down", "left", "right"],
        "actions": ["working", "idle", "syncing", "error"],
        "template_id": CHARACTER_TEMPLATE_ID,
        "description": "V5 四向固定坐姿动画；支持工作、休息、同步、异常表情，屏幕效果独立播放。",
        "fallback_profile_id": None,
        "animation_mode": CHARACTER_ANIMATION_MODE,
        "manifest_contract_version": CHARACTER_MANIFEST_CONTRACT_VERSION,
    },
    {
        "id": "british-shorthair-v1",
        "label": "英短",
        "breed": "british shorthair",
        "status": "ready",
        "production_ready": True,
        "assignable": True,
        "directions": ["up", "down", "left", "right"],
        "actions": ["working", "idle", "syncing", "error"],
        "template_id": CHARACTER_TEMPLATE_ID,
        "description": "V5 四向固定坐姿动画；支持工作、休息、同步、异常表情，屏幕效果独立播放。",
        "fallback_profile_id": None,
        "animation_mode": CHARACTER_ANIMATION_MODE,
        "manifest_contract_version": CHARACTER_MANIFEST_CONTRACT_VERSION,
    },
    {
        "id": "american-shorthair-v1",
        "label": "美短",
        "breed": "american shorthair",
        "status": "ready",
        "production_ready": True,
        "assignable": True,
        "directions": ["up", "down", "left", "right"],
        "actions": ["working", "idle", "syncing", "error"],
        "template_id": CHARACTER_TEMPLATE_ID,
        "description": "V5 四向固定坐姿动画；支持工作、休息、同步、异常表情，屏幕效果独立播放。",
        "fallback_profile_id": None,
        "animation_mode": CHARACTER_ANIMATION_MODE,
        "manifest_contract_version": CHARACTER_MANIFEST_CONTRACT_VERSION,
    },
    {
        "id": "tabby-v1",
        "label": "狸花猫",
        "breed": "chinese tabby",
        "status": "ready",
        "production_ready": True,
        "assignable": True,
        "directions": ["up", "down", "left", "right"],
        "actions": ["working", "idle", "syncing", "error"],
        "template_id": CHARACTER_TEMPLATE_ID,
        "description": "V5 四向固定坐姿动画；支持工作、休息、同步、异常表情，屏幕效果独立播放。",
        "fallback_profile_id": None,
        "animation_mode": CHARACTER_ANIMATION_MODE,
        "manifest_contract_version": CHARACTER_MANIFEST_CONTRACT_VERSION,
    },
    {
        "id": "tuxedo-cat-v1",
        "label": "奶牛猫",
        "breed": "tuxedo cat",
        "status": "ready",
        "production_ready": True,
        "assignable": True,
        "directions": ["up", "down", "left", "right"],
        "actions": ["working", "idle", "syncing", "error"],
        "template_id": CHARACTER_TEMPLATE_ID,
        "description": "V5 四向固定坐姿动画；支持工作、休息、同步、异常表情，屏幕效果独立播放。",
        "fallback_profile_id": None,
        "animation_mode": CHARACTER_ANIMATION_MODE,
        "manifest_contract_version": CHARACTER_MANIFEST_CONTRACT_VERSION,
    },
    {
        "id": "white-lion-cat-v1",
        "label": "狮子白猫",
        "breed": "white long-haired cat",
        "status": "ready",
        "production_ready": True,
        "assignable": True,
        "directions": ["up", "down", "left", "right"],
        "actions": ["working", "idle", "syncing", "error"],
        "template_id": CHARACTER_TEMPLATE_ID,
        "description": "V5 四向固定坐姿动画；支持工作、休息、同步、异常表情，屏幕效果独立播放。",
        "fallback_profile_id": None,
        "animation_mode": CHARACTER_ANIMATION_MODE,
        "manifest_contract_version": CHARACTER_MANIFEST_CONTRACT_VERSION,
    },
    {
        "id": "jianzhou-cat-v1",
        "label": "简州猫",
        "breed": "jianzhou cat",
        "status": "ready",
        "production_ready": True,
        "assignable": True,
        "directions": ["up", "down", "left", "right"],
        "actions": ["working", "idle", "syncing", "error"],
        "template_id": CHARACTER_TEMPLATE_ID,
        "description": "V5 四向固定坐姿动画；支持工作、休息、同步、异常表情，屏幕效果独立播放。",
        "fallback_profile_id": None,
        "animation_mode": CHARACTER_ANIMATION_MODE,
        "manifest_contract_version": CHARACTER_MANIFEST_CONTRACT_VERSION,
    },
)

CHARACTER_PROFILE_IDS = frozenset(profile["id"] for profile in _CHARACTER_PROFILES)

# These are the four already-produced V5 rock-room performers.  They are a
# separate scene-role catalog: they do not pretend to be Sub2API users or
# workstation character profiles.  The backend may only toggle visibility for
# this fixed allowlist; it cannot accept arbitrary asset paths from the UI.
ROCK_ROOM_PERFORMERS = (
    {"id": "drummer-orange-tabby", "label": "橘猫鼓手", "role": "drummer", "asset": "./media/rock-room/drummer-orange-tabby.png"},
    {"id": "guitarist-gray", "label": "灰猫吉他手", "role": "guitarist", "asset": "./media/rock-room/guitarist-gray.png"},
    {"id": "bassist-tuxedo", "label": "奶牛猫贝斯手", "role": "bassist", "asset": "./media/rock-room/bassist-tuxedo.png"},
    {"id": "vocalist-cream", "label": "奶油猫主唱", "role": "vocalist", "asset": "./media/rock-room/vocalist-cream.png"},
)
ROCK_ROOM_PERFORMER_IDS = frozenset(item["id"] for item in ROCK_ROOM_PERFORMERS)
DEFAULT_ROOM_CHARACTERS = {
    "rock": {"enabled": True, "performers": {item["id"]: True for item in ROCK_ROOM_PERFORMERS}}
}


def normalize_room_characters(value):
    """Return canonical room-role visibility or None for invalid input."""
    if not isinstance(value, dict) or set(value) != {"rock"}:
        return None
    room = value.get("rock")
    if not isinstance(room, dict) or set(room) != {"enabled", "performers"} or type(room["enabled"]) is not bool:
        return None
    performers = room["performers"]
    if not isinstance(performers, dict) or set(performers) != ROCK_ROOM_PERFORMER_IDS:
        return None
    if any(type(enabled) is not bool for enabled in performers.values()):
        return None
    return {"rock": {"enabled": room["enabled"], "performers": {key: performers[key] for key in sorted(performers)}}}


def safe_room_characters(value):
    normalized = normalize_room_characters(value)
    if normalized is None:
        normalized = DEFAULT_ROOM_CHARACTERS
    return copy.deepcopy(normalized)


def public_room_character_catalog():
    return {"schema_version": 1, "rooms": [{"id": "rock", "label": "摇滚房间", "performers": copy.deepcopy(list(ROCK_ROOM_PERFORMERS))}]}


def character_profile(profile_id: str):
    """Return a defensive copy of one profile or None for unknown IDs."""
    for profile in _CHARACTER_PROFILES:
        if profile["id"] == profile_id:
            return copy.deepcopy(profile)
    return None


def is_known_character_profile(profile_id: str) -> bool:
    return isinstance(profile_id, str) and profile_id in CHARACTER_PROFILE_IDS


def is_assignable_character_profile(profile_id: str) -> bool:
    profile = character_profile(profile_id)
    return bool(profile and profile["assignable"] and profile["production_ready"])


def public_character_profiles():
    """Expose only safe metadata; no local paths, prompts, or source provenance."""
    fields = ("id", "label", "breed", "status", "production_ready", "assignable",
              "directions", "actions", "template_id", "description", "fallback_profile_id",
              "animation_mode", "manifest_contract_version")
    return [{key: copy.deepcopy(profile[key]) for key in fields} for profile in _CHARACTER_PROFILES]


def public_character_profile(profile_id: str):
    profile = character_profile(profile_id) or character_profile(DEFAULT_CHARACTER_PROFILE_ID)
    fields = ("id", "label", "breed", "status", "production_ready", "assignable",
              "directions", "actions", "template_id", "description", "fallback_profile_id",
              "animation_mode", "manifest_contract_version")
    return {key: copy.deepcopy(profile[key]) for key in fields}
