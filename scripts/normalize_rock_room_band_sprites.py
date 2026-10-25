#!/usr/bin/env python3
"""Normalize generated rock-room band sprite sheets to fixed 96x96 frames.

The generated source sheets are expected to contain a 4x3 transparent grid.  We
keep one shared scale and bottom-center anchor per sheet so frame-to-frame motion
reads as animation rather than camera drift.
"""
from __future__ import annotations

from pathlib import Path
from typing import Iterable

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIR = ROOT / "assets" / "rock-room-band-v1" / "source"
OUTPUT_DIR = ROOT / "frontend" / "company-office" / "connected-v5" / "media" / "rock-room"
PREVIEW_DIR = ROOT / "assets" / "rock-room-band-v1" / "preview"
FRAME_SIZE = (96, 96)
GRID = (4, 3)
ANCHOR = (48, 88)  # bottom-center, leaving a small transparent floor margin
ALPHA_THRESHOLD = 12
MAX_CONTENT_HEIGHT = 84
MAX_CONTENT_WIDTH = 88

SOURCES = {
    "drummer-orange-tabby": "orange-tabby-drummer-raw.png",
    "vocalist-cream": "cream-vocalist-raw.png",
    "guitarist-gray": "gray-guitarist-raw.png",
    "bassist-tuxedo": "tuxedo-bassist-raw.png",
}


def alpha_bbox(image: Image.Image) -> tuple[int, int, int, int] | None:
    alpha = image.getchannel("A").point(lambda value: 255 if value >= ALPHA_THRESHOLD else 0)
    return alpha.getbbox()


def union_boxes(boxes: Iterable[tuple[int, int, int, int]]) -> tuple[int, int, int, int]:
    boxes = list(boxes)
    if not boxes:
        raise ValueError("sprite sheet contains no visible pixels")
    left = min(box[0] for box in boxes)
    top = min(box[1] for box in boxes)
    right = max(box[2] for box in boxes)
    bottom = max(box[3] for box in boxes)
    return left, top, right, bottom


def make_sheet(source: Path, output: Path, preview: Path) -> dict:
    source_image = Image.open(source).convert("RGBA")
    if source_image.width % GRID[0] or source_image.height % GRID[1]:
        raise ValueError(f"{source}: source dimensions must divide evenly into a 4x3 grid")
    cell_w = source_image.width // GRID[0]
    cell_h = source_image.height // GRID[1]
    if cell_w != cell_h:
        raise ValueError(f"{source}: source cells must be square, got {cell_w}x{cell_h}")

    cells: list[Image.Image] = []
    boxes: list[tuple[int, int, int, int]] = []
    for frame in range(GRID[0] * GRID[1]):
        x = frame % GRID[0] * cell_w
        y = frame // GRID[0] * cell_h
        cell = source_image.crop((x, y, x + cell_w, y + cell_h))
        cells.append(cell)
        box = alpha_bbox(cell)
        if box is None:
            raise ValueError(f"{source}: frame {frame} is empty")
        boxes.append(box)

    shared_box = union_boxes(boxes)
    shared_w = shared_box[2] - shared_box[0]
    shared_h = shared_box[3] - shared_box[1]
    scale = min(MAX_CONTENT_HEIGHT / shared_h, MAX_CONTENT_WIDTH / shared_w)
    scaled_w = max(1, round(shared_w * scale))
    scaled_h = max(1, round(shared_h * scale))

    sheet = Image.new("RGBA", (FRAME_SIZE[0] * GRID[0], FRAME_SIZE[1] * GRID[1]), (0, 0, 0, 0))
    preview_sheet = Image.new("RGBA", sheet.size, (239, 231, 206, 255))
    for frame, (cell, box) in enumerate(zip(cells, boxes)):
        # Use the shared frame crop, not each frame's own crop, to hold scale and
        # bottom-center placement stable across the loop.
        shared_crop = cell.crop(shared_box).resize((scaled_w, scaled_h), Image.Resampling.LANCZOS)
        # Low-alpha generated fringe is visually indistinguishable from a halo at
        # game scale; remove it while keeping normal anti-aliased edge pixels.
        alpha = shared_crop.getchannel("A")
        alpha = alpha.point(lambda value: 0 if value < ALPHA_THRESHOLD else value)
        shared_crop.putalpha(alpha)
        cell_x = frame % GRID[0] * FRAME_SIZE[0]
        cell_y = frame // GRID[0] * FRAME_SIZE[1]
        dest_x = cell_x + ANCHOR[0] - scaled_w // 2
        dest_y = cell_y + ANCHOR[1] - scaled_h
        sheet.alpha_composite(shared_crop, (dest_x, dest_y))
        preview_sheet.alpha_composite(shared_crop, (dest_x, dest_y))

    output.parent.mkdir(parents=True, exist_ok=True)
    preview.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(output, optimize=True)
    preview_sheet.convert("RGB").save(preview, quality=95)

    return {
        "source": str(source.relative_to(ROOT)),
        "output": str(output.relative_to(ROOT)),
        "preview": str(preview.relative_to(ROOT)),
        "sourceSize": list(source_image.size),
        "frameSize": list(FRAME_SIZE),
        "grid": list(GRID),
        "frameCount": len(cells),
        "anchor": list(ANCHOR),
        "sharedContentBox": list(shared_box),
        "normalizedContentSize": [scaled_w, scaled_h],
        "alphaThreshold": ALPHA_THRESHOLD,
    }


def main() -> None:
    records = []
    for role, filename in SOURCES.items():
        records.append(
            make_sheet(
                SOURCE_DIR / filename,
                OUTPUT_DIR / f"{role}.png",
                PREVIEW_DIR / f"{role}.jpg",
            )
        )
    import json

    manifest = {
        "schemaVersion": 1,
        "tool": "scripts/normalize_rock_room_band_sprites.py",
        "frameSize": list(FRAME_SIZE),
        "grid": list(GRID),
        "frameCount": 12,
        "fps": 12,
        "anchor": list(ANCHOR),
        "records": records,
    }
    (ROOT / "assets" / "rock-room-band-v1" / "normalization.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
