#!/usr/bin/env python3
"""Build transparent rock-room occlusion layers from the approved room background.

The room remains a single unchanged background. These small derived PNGs only
restore the front-most parts of the existing drums and microphone stands after
character sprites are drawn, so the cats do not visually cut through props.
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
BACKGROUND = ROOT / "frontend/company-office/reference-v3/office-background-layered.png"
OUTPUT_DIR = ROOT / "frontend/company-office/connected-v5/media/rock-room"
ROOM_BOUNDS = (708, 701, 480, 206)
MAP_SIZE = (1584, 993)


def copy_masked(background: Image.Image, mask: Image.Image) -> Image.Image:
    layer = Image.new("RGBA", background.size, (0, 0, 0, 0))
    layer.paste(background, (0, 0), mask)
    return layer.crop(
        (
            ROOM_BOUNDS[0],
            ROOM_BOUNDS[1],
            ROOM_BOUNDS[0] + ROOM_BOUNDS[2],
            ROOM_BOUNDS[1] + ROOM_BOUNDS[3],
        )
    )


def build_drum_front(background: Image.Image) -> Image.Image:
    mask = Image.new("L", background.size, 0)
    draw = ImageDraw.Draw(mask)
    # Existing bass-drum face/rim. Only this front face is restored; the upper
    # drums stay behind the drummer so the cat remains visibly readable.
    draw.ellipse((913, 795, 984, 848), fill=255)
    return copy_masked(background, mask)


def build_stage_mics_front(background: Image.Image) -> Image.Image:
    mask = Image.new("L", background.size, 0)
    draw = ImageDraw.Draw(mask)

    # Left microphone: head, shaft and tripod from the existing room pixels.
    draw.ellipse((839, 793, 849, 804), fill=255)
    draw.line((844, 801, 839, 838), fill=255, width=3)
    draw.line((839, 836, 827, 850), fill=255, width=3)
    draw.line((839, 836, 850, 850), fill=255, width=3)

    # The centre microphone stays in the unchanged room background. Restoring
    # its full shaft after the vocalist is drawn cuts a dark line through the
    # cat's face and body; leaving it behind the transparent sprite preserves
    # the natural head/stand occlusion without repainting the room.

    # Right microphone mirrors the left-stage position.
    draw.ellipse((1058, 793, 1068, 804), fill=255)
    draw.line((1063, 801, 1068, 838), fill=255, width=3)
    draw.line((1068, 836, 1057, 850), fill=255, width=3)
    draw.line((1068, 836, 1080, 850), fill=255, width=3)

    return copy_masked(background, mask)


def main() -> None:
    background = Image.open(BACKGROUND).convert("RGBA")
    if background.size != MAP_SIZE:
        raise SystemExit(f"unexpected background size: {background.size}, expected {MAP_SIZE}")
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    outputs = {
        "drum-kit-front.png": build_drum_front(background),
        "stage-mics-front.png": build_stage_mics_front(background),
    }
    for name, image in outputs.items():
        image.save(OUTPUT_DIR / name, optimize=True)
        print(f"wrote {OUTPUT_DIR / name} {image.size} RGBA")


if __name__ == "__main__":
    main()
