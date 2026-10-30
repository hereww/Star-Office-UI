#!/usr/bin/env python3
"""Normalize generated complete-character atlases to the office frame contract.

This operates on whole generated cells. It never composes a face layer, clips an
ellipse, or writes pixels onto a base character. The generated cell is scaled as
one image to the existing base silhouette bounds, then placed on a transparent
192x192 canvas.
"""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image


CELL = 192
COLS = 4
ROWS = 3


def clean_alpha(image: Image.Image) -> Image.Image:
    image = image.convert("RGBA")
    pixels = image.load()
    for y in range(image.height):
        for x in range(image.width):
            r, g, b, a = pixels[x, y]
            if a < 16:
                pixels[x, y] = (r, g, b, 0)
    return image


def cell_grid(image: Image.Image, rows: int) -> list[Image.Image]:
    width, height = image.size
    cell_w, cell_h = width // COLS, height // rows
    if cell_w <= 0 or cell_h <= 0:
        raise ValueError(f"invalid source dimensions: {image.size}")
    return [
        image.crop((col * cell_w, row * cell_h, (col + 1) * cell_w, (row + 1) * cell_h))
        for row in range(rows)
        for col in range(COLS)
    ]


def normalize_cells(cells: list[Image.Image], target_bbox: tuple[int, int, int, int]) -> Image.Image:
    if len(cells) != 12:
        raise ValueError(f"expected 12 cells, got {len(cells)}")
    left, top, right, bottom = target_bbox
    target_size = (right - left, bottom - top)
    atlas = Image.new("RGBA", (CELL * COLS, CELL * ROWS), (0, 0, 0, 0))
    for index, source in enumerate(cells):
        source = clean_alpha(source)
        bbox = source.getchannel("A").getbbox()
        if not bbox:
            raise ValueError(f"source cell {index} has no visible pixels")
        sprite = source.crop(bbox).resize(target_size, Image.Resampling.NEAREST)
        cell = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))
        # Copy RGBA directly. Using the sprite as its own mask multiplies its
        # alpha (and RGB) a second time, making translucent edges dark/faint.
        cell.paste(sprite, (left, top))
        x = (index % COLS) * CELL
        y = (index // COLS) * CELL
        atlas.paste(cell, (x, y))
    return atlas


def normalize(source: Path, base: Path, output: Path, section: int | None = None) -> None:
    source_image = clean_alpha(Image.open(source))
    base_image = clean_alpha(Image.open(base))
    if base_image.size != (CELL, CELL):
        raise ValueError(f"base must be 192x192: {base}")
    target = base_image.getchannel("A").getbbox()
    if not target:
        raise ValueError(f"base has no visible pixels: {base}")
    rows = 9 if source_image.height * 4 == source_image.width * 9 else 3
    cells = cell_grid(source_image, rows)
    if rows == 9:
        if section not in (0, 1, 2):
            raise ValueError("a 4x9 source requires --section 0, 1, or 2")
        cells = cells[section * 12 : (section + 1) * 12]
    atlas = normalize_cells(cells, target)
    output.parent.mkdir(parents=True, exist_ok=True)
    atlas.save(output)


def repeat_base(base: Path, output: Path) -> None:
    image = clean_alpha(Image.open(base))
    if image.size != (CELL, CELL):
        raise ValueError(f"base must be 192x192: {base}")
    atlas = Image.new("RGBA", (CELL * COLS, CELL * ROWS), (0, 0, 0, 0))
    for index in range(12):
        x = (index % COLS) * CELL
        y = (index // COLS) * CELL
        atlas.paste(image, (x, y))
    output.parent.mkdir(parents=True, exist_ok=True)
    atlas.save(output)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("base", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--section", type=int, default=None, help="0/1/2 for a stacked 4x9 source")
    parser.add_argument("--repeat-base", action="store_true")
    args = parser.parse_args()
    if args.repeat_base:
        repeat_base(args.base, args.output)
    else:
        normalize(args.source, args.base, args.output, args.section)


if __name__ == "__main__":
    main()
