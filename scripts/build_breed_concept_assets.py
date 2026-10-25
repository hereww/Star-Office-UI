#!/usr/bin/env python3
"""Copy and audit completed generated static concepts without editing image pixels.

The seven originals are separate native image-generation outputs. These assets
are preview-only and do not make a character eligible for workstation animation.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import struct
import zlib
from pathlib import Path

PROFILES = (
    ("ragdoll-v1", "布偶猫"),
    ("british-shorthair-v1", "英短"),
    ("american-shorthair-v1", "美短"),
    ("tabby-v1", "狸花猫"),
    ("tuxedo-cat-v1", "奶牛猫"),
    ("white-lion-cat-v1", "狮子白猫"),
    ("jianzhou-cat-v1", "简州猫"),
)


def read_png(path: Path):
    blob = path.read_bytes()
    if blob[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError(f"not a PNG: {path}")
    pos = 8
    chunks = []
    width = height = bit_depth = color_type = interlace = None
    while pos < len(blob):
        size = struct.unpack(">I", blob[pos:pos + 4])[0]
        kind = blob[pos + 4:pos + 8]
        data = blob[pos + 8:pos + 8 + size]
        pos += 12 + size
        if kind == b"IHDR":
            width, height, bit_depth, color_type, _compression, _filter, interlace = struct.unpack(">IIBBBBB", data)
        elif kind == b"IDAT":
            chunks.append(data)
        elif kind == b"IEND":
            break
    if (bit_depth, color_type, interlace) != (8, 6, 0):
        raise ValueError(f"expected non-interlaced RGBA8 PNG, got {(bit_depth, color_type, interlace)}")
    raw = zlib.decompress(b"".join(chunks))
    row_bytes = width * 4
    rows = []
    previous = bytearray(row_bytes)
    pos = 0
    for _ in range(height):
        filter_type = raw[pos]
        pos += 1
        encoded = bytearray(raw[pos:pos + row_bytes])
        pos += row_bytes
        row = bytearray(row_bytes)
        for i, value in enumerate(encoded):
            left = row[i - 4] if i >= 4 else 0
            up = previous[i]
            up_left = previous[i - 4] if i >= 4 else 0
            if filter_type == 0:
                predictor = 0
            elif filter_type == 1:
                predictor = left
            elif filter_type == 2:
                predictor = up
            elif filter_type == 3:
                predictor = (left + up) // 2
            elif filter_type == 4:
                p = left + up - up_left
                pa, pb, pc = abs(p - left), abs(p - up), abs(p - up_left)
                predictor = left if pa <= pb and pa <= pc else up if pb <= pc else up_left
            else:
                raise ValueError(f"unsupported PNG filter {filter_type}")
            row[i] = (value + predictor) & 0xFF
        rows.append(row)
        previous = row
    return width, height, rows



def audit(path):
    width, height, rows = read_png(path)
    if width != height or width < 1024:
        raise ValueError(f"expected square concept at least 1024px: {path}")
    bounds = [width, height, -1, -1]
    opaque = transparent = 0
    for y, row in enumerate(rows):
        for x in range(width):
            alpha = row[x * 4 + 3]
            if alpha <= 8:
                transparent += 1
            else:
                if alpha >= 240:
                    opaque += 1
                bounds[0] = min(bounds[0], x)
                bounds[1] = min(bounds[1], y)
                bounds[2] = max(bounds[2], x)
                bounds[3] = max(bounds[3], y)
    margin = min(bounds[0], bounds[1], width - 1 - bounds[2], height - 1 - bounds[3])
    if margin < 24 or not opaque or not transparent:
        raise ValueError(f"artwork or transparent margin incomplete: {path}")
    return {"dimensions": [width, height], "alphaBounds": bounds,
            "minimumTransparentMargin": margin,
            "nearTransparentPixelFraction": round(transparent / (width * height), 4),
            "visibleAlphaThreshold": 8,
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, default=Path("assets/character-animation-proposals/2026-10-14-breed-concepts-v3/generated"))
    parser.add_argument("--output", type=Path, default=Path("frontend/office/media/character-breed-candidates"))
    parser.add_argument("--manifest", type=Path, default=Path("assets/character-animation-proposals/2026-10-14-breed-concepts-v3/metadata.json"))
    args = parser.parse_args()
    checked = [(profile_id, label, audit(args.source / (profile_id + ".png")))
               for profile_id, label in PROFILES]
    args.output.mkdir(parents=True, exist_ok=True)
    manifest = {"schemaVersion": 3, "kind": "breed-static-concepts",
                "status": "concept-ready", "completedDate": "2026-10-14",
                "generator": "OpenAI native image generation",
                "identityReference": "../2026-10-06-breed-candidates-v1/breed-candidate-board.png",
                "transparentBackground": True, "humanApproved": False,
                "productionAssignable": False, "animationComplete": False,
                "profiles": []}
    for profile_id, label, proof in checked:
        source = args.source / (profile_id + ".png")
        target = args.output / (profile_id + ".png")
        if not target.is_file() or hashlib.sha256(target.read_bytes()).hexdigest() != proof["sha256"]:
            shutil.copyfile(source, target)
        manifest["profiles"].append({"id": profile_id, "label": label,
            "image": "generated/" + profile_id + ".png",
            "runtimeImage": args.output.as_posix() + "/" + profile_id + ".png",
            "direction": "down", "status": "concept-ready",
            "productionReady": False, "assignable": False, **proof})
    args.manifest.parent.mkdir(parents=True, exist_ok=True)
    args.manifest.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"passed": True, "profiles": len(checked), "manifest": str(args.manifest)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
