#!/usr/bin/env python3
"""Normalize generated rock-room band sprite sheets to fixed 96x96 frames.

The generated source sheets contain a 4x3 transparent grid. We find the
true empty gutters between columns and rows so character limbs are never severed,
anchor each frame to a stable column center and floor baseline, and render
fixed 96x96 transparent cells without frame-to-frame jumping or distortion.
"""
from __future__ import annotations

import json
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIR = ROOT / "assets" / "rock-room-band-v1" / "source"
OUTPUT_DIR = ROOT / "frontend" / "company-office" / "connected-v5" / "media" / "rock-room"
PREVIEW_DIR = ROOT / "assets" / "rock-room-band-v1" / "preview"
FRAME_SIZE = (96, 96)
GRID = (4, 3)
PLAYBACK_FPS = 8
ANCHOR = (48, 88)
ALPHA_THRESHOLD = 16
MAX_CONTENT_HEIGHT = 82
MAX_CONTENT_WIDTH = 82

SOURCES = {
    "drummer-orange-tabby": ("orange-tabby-drummer-raw.png", 350, 360),
    "vocalist-cream": ("cream-vocalist-raw.png", 320, 360),
    "guitarist-gray": ("gray-guitarist-raw.png", 320, 360),
    "bassist-tuxedo": ("tuxedo-bassist-raw.png", 320, 360),
}


def find_gutters(image: Image.Image) -> tuple[list[int], list[int]]:
    """Locate true transparent gutters between rows and columns."""
    col_counts = [sum(1 for y in range(image.height) if image.getpixel((x, y))[3] >= ALPHA_THRESHOLD) for x in range(image.width)]
    row_counts = [sum(1 for x in range(image.width) if image.getpixel((x, y))[3] >= ALPHA_THRESHOLD) for y in range(image.height)]

    y_splits = [
        0,
        min(range(340, 370), key=lambda y: row_counts[y]),
        min(range(700, 730), key=lambda y: row_counts[y]),
        image.height,
    ]
    x_splits = [
        0,
        min(range(350, 420), key=lambda x: col_counts[x]),
        min(range(690, 760), key=lambda x: col_counts[x]),
        min(range(1030, 1100), key=lambda x: col_counts[x]),
        image.width,
    ]
    return x_splits, y_splits


def crop_isolated_cell(
    image: Image.Image,
    cell_bounds: tuple[int, int, int, int],
    crop_bounds: tuple[int, int, int, int],
) -> Image.Image:
    """Keep the shared crop geometry, padding outside this cell transparently.

    A floor-aligned crop can extend into the previous row or an adjacent
    column. Isolate the cell before cropping so those neighbours can never
    contribute pixels, even through the subsequent Lanczos filter.
    """
    left, top, _, _ = cell_bounds
    x0, y0, x1, y1 = crop_bounds
    isolated = image.crop(cell_bounds)
    return isolated.crop((x0 - left, y0 - top, x1 - left, y1 - top))


def make_sheet(role: str, filename: str, crop_w: int, crop_h: int) -> dict:
    source = SOURCE_DIR / filename
    output = OUTPUT_DIR / f"{role}.png"
    preview = PREVIEW_DIR / f"{role}.jpg"

    source_image = Image.open(source).convert("RGBA")
    # Clean noise fringe below alpha threshold
    alpha = source_image.getchannel("A").point(lambda v: 0 if v < ALPHA_THRESHOLD else v)
    source_image.putalpha(alpha)

    x_splits, y_splits = find_gutters(source_image)

    col_counts = [sum(1 for y in range(source_image.height) if source_image.getpixel((x, y))[3] >= ALPHA_THRESHOLD) for x in range(source_image.width)]
    row_counts = [sum(1 for x in range(source_image.width) if source_image.getpixel((x, y))[3] >= ALPHA_THRESHOLD) for y in range(source_image.height)]

    # Compute stable floor baseline for each row
    row_baselines = []
    for r in range(3):
        ys = [y for y in range(y_splits[r], y_splits[r + 1]) if row_counts[y] > 0]
        if not ys:
            raise ValueError(f"{source}: row {r} has no visible pixels")
        row_baselines.append(max(ys))

    scale = min(MAX_CONTENT_WIDTH / crop_w, MAX_CONTENT_HEIGHT / crop_h)
    scaled_w = int(round(crop_w * scale))
    scaled_h = int(round(crop_h * scale))

    sheet = Image.new("RGBA", (FRAME_SIZE[0] * GRID[0], FRAME_SIZE[1] * GRID[1]), (0, 0, 0, 0))
    preview_sheet = Image.new("RGBA", sheet.size, (239, 231, 206, 255))
    frame_metrics = []

    for frame in range(GRID[0] * GRID[1]):
        r = frame // GRID[0]
        c = frame % GRID[0]
        
        # Find bounds for this specific cell to avoid AI grid alignment drift across rows
        cell_xs = [
            x for x in range(x_splits[c], x_splits[c + 1])
            for y in range(y_splits[r], y_splits[r + 1])
            if source_image.getpixel((x, y))[3] >= ALPHA_THRESHOLD
        ]
        if not cell_xs:
            raise ValueError(f"{source}: cell ({r}, {c}) has no visible pixels")
        cx = (min(cell_xs) + max(cell_xs)) / 2
        base_y = row_baselines[r]

        x0 = int(round(cx - crop_w / 2))
        x1 = x0 + crop_w
        y0 = int(round(base_y - crop_h + 1))
        y1 = y0 + crop_h

        cell_bounds = (x_splits[c], y_splits[r], x_splits[c + 1], y_splits[r + 1])
        cropped = crop_isolated_cell(source_image, cell_bounds, (x0, y0, x1, y1))
        cropped = cropped.resize((scaled_w, scaled_h), Image.Resampling.LANCZOS)
        # Ensure clean alpha after Lanczos resampling
        cropped_alpha = cropped.getchannel("A").point(lambda v: 0 if v < ALPHA_THRESHOLD else v)
        cropped.putalpha(cropped_alpha)

        cell = Image.new("RGBA", FRAME_SIZE, (0, 0, 0, 0))
        dest_x = ANCHOR[0] - scaled_w // 2
        dest_y = ANCHOR[1] - scaled_h + 1
        cell.alpha_composite(cropped, (dest_x, dest_y))

        cell_x = c * FRAME_SIZE[0]
        cell_y = r * FRAME_SIZE[1]
        sheet.alpha_composite(cell, (cell_x, cell_y))
        preview_sheet.alpha_composite(cell, (cell_x, cell_y))

        cell_bbox = cell.getchannel("A").point(lambda v: 255 if v >= ALPHA_THRESHOLD else 0).getbbox()
        frame_metrics.append({
            "frame": frame,
            "bounds": list(cell_bbox) if cell_bbox else [0, 0, 0, 0],
            "frameCenter": (cell_bbox[0] + cell_bbox[2]) / 2 if cell_bbox else ANCHOR[0],
            "bottomY": cell_bbox[3] - 1 if cell_bbox else ANCHOR[1],
        })

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
        "frameCount": len(frame_metrics),
        "anchor": list(ANCHOR),
        "cropBox": [crop_w, crop_h],
        "normalizedContentSize": [scaled_w, scaled_h],
        "alphaThreshold": ALPHA_THRESHOLD,
        "alignment": "stable-body-anchor",
        "cropIsolation": "source-cell-before-resampling-with-transparent-padding",
        "frameMetrics": frame_metrics,
    }


def main() -> None:
    records = []
    for role, (filename, crop_w, crop_h) in SOURCES.items():
        records.append(make_sheet(role, filename, crop_w, crop_h))

    manifest = {
        "schemaVersion": 1,
        "tool": "scripts/normalize_rock_room_band_sprites.py",
        "frameSize": list(FRAME_SIZE),
        "grid": list(GRID),
        "frameCount": 12,
        "fps": PLAYBACK_FPS,
        "anchorMode": "fixed-world-anchor",
        "records": records,
    }
    (ROOT / "assets" / "rock-room-band-v1" / "normalization.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print("Rock room band normalization complete.")


if __name__ == "__main__":
    main()
