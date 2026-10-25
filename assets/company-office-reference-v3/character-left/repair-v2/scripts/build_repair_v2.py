#!/usr/bin/env python3
"""Repair-v2: source-in/crop/mask normalization of image_gen artwork only.

The neutral RGB is edited by image_gen; expressions are existing generated
pixels. This script never draws an eye, a mouth or fur, rotates/reflections,
resets frame phases, independently translates frames, or creates duplicates.
Common placement, face ellipse, static original contour protection, per-feature
alpha extraction and hole-filling are preprocessing masks, not new artwork.
"""
from pathlib import Path
from collections import deque
import json
import numpy as np
from PIL import Image, ImageFilter

A = Path(__file__).resolve().parents[1]
ROOT = A.parents[3]
M = ROOT / 'frontend/company-office/reference-v3/media/character-left/repair-v2'
ACTIONS = ('working', 'idle', 'syncing', 'error')
SIZE, CELL, GRID = (192, 192), (90, 58), (4, 3)
RECT = [38, 64, 90, 58]
ELLIPSE = [76, 93, 32, 27]
NEUTRAL_BOUNDS = [48, 67, 104, 119]


def binary_image(mask):
    return Image.fromarray((mask * 255).astype('uint8'))


def dilate(mask, amount=1):
    return np.asarray(binary_image(mask).filter(ImageFilter.MaxFilter(2 * amount + 1))) > 0


def erode(mask, amount=1):
    return np.asarray(binary_image(mask).filter(ImageFilter.MinFilter(2 * amount + 1))) > 0


def fill_holes(mask):
    h, w = mask.shape
    outside = np.zeros((h, w), dtype=bool)
    queue = deque()
    for y, x in [(0, x) for x in range(w)] + [(h - 1, x) for x in range(w)] + [(y, 0) for y in range(h)] + [(y, w - 1) for y in range(h)]:
        if not mask[y, x] and not outside[y, x]:
            outside[y, x] = True
            queue.append((y, x))
    while queue:
        y, x = queue.popleft()
        for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)):
            yy, xx = y + dy, x + dx
            if 0 <= yy < h and 0 <= xx < w and not mask[yy, xx] and not outside[yy, xx]:
                outside[yy, xx] = True
                queue.append((yy, xx))
    return ~outside


def components(mask):
    seen = np.zeros_like(mask)
    result = []
    h, w = mask.shape
    for sy, sx in zip(*np.where(mask)):
        if seen[sy, sx]:
            continue
        q, points = deque([(sy, sx)]), []
        seen[sy, sx] = True
        while q:
            y, x = q.popleft()
            points.append((y, x))
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    yy, xx = y + dy, x + dx
                    if 0 <= yy < h and 0 <= xx < w and mask[yy, xx] and not seen[yy, xx]:
                        seen[yy, xx] = True
                        q.append((yy, xx))
        if len(points) >= 2:
            c = np.zeros_like(mask)
            ys, xs = np.array(points).T
            c[ys, xs] = True
            result.append(c)
    return result


def roi(shape, bounds):
    x0, y0, x1, y1 = bounds
    out = np.zeros(shape, dtype=bool)
    out[y0:y1, x0:x1] = True
    return out


def nearest_component(mask, center):
    allc = components(mask)
    if not allc:
        return np.zeros_like(mask)
    cx, cy = center
    def score(c):
        y, x = np.where(c)
        return (float(x.mean()) - cx) ** 2 + (float(y.mean()) - cy) ** 2
    return min(allc, key=score)


def expression_mask(frame, action):
    p = np.asarray(frame)
    rgb = p[:, :, :3].astype('float32')
    opaque = p[:, :, 3] >= 128
    dark = (rgb.max(2) < 115) & opaque
    brow = dark & roi((58, 90), [24, 4, 44, 16])
    eye = dark & roi((58, 90), [23, 14, 49, 40])
    # Fill only generated eye interiors; light sclera/highlights remain the
    # original generated RGB. Closed eyelids simply retain their dark strokes.
    eye = fill_holes(nearest_component(dilate(eye, 1), (34, 27)))
    brow = dilate(brow, 1)
    r, g, b = rgb.transpose(2, 0, 1)
    pink = opaque & (r > 140) & (r > g * 1.15) & (b > g * .8) & (b > 70)
    nose = nearest_component(pink & roi((58, 90), [8, 20, 25, 39]), (15, 31))
    nose = dilate(nose, 1)
    # Exclude the SOURCE frame's outside contour before selecting a mouth.
    # The old full-face crops include perimeter dark strokes, not facial art.
    source_inside = erode(opaque, 2)
    if action == 'idle':
        mouth_bounds, mouth_center = [16, 28, 39, 48], (25, 38)
    elif action == 'syncing':
        mouth_bounds, mouth_center = [16, 40, 26, 48], (20, 44)
    else:
        mouth_bounds, mouth_center = [15, 38, 25, 46], (18, 42)
    mouth = nearest_component(dark & source_inside & roi((58, 90), mouth_bounds), mouth_center)
    mouth = fill_holes(dilate(mouth, 1))
    mouth &= roi((58, 90), mouth_bounds)
    return brow | eye | nose | mouth, {'brow': brow, 'eye': eye, 'nose': nose, 'mouth': mouth}


def main():
    M.mkdir(parents=True, exist_ok=True)
    base = Image.open(A / 'sources/character-base.png').convert('RGBA')
    original = np.array(base)
    edited = np.array(Image.open(A / 'originals/neutral-base-repair-v2-original.png').convert('RGBA').resize(SIZE, Image.Resampling.NEAREST))
    y, x = np.indices((192, 192))
    cx, cy, rx, ry = ELLIPSE
    ellipse = ((x + .5 - cx) / rx) ** 2 + ((y + .5 - cy) / ry) ** 2 <= 1
    interior = erode(original[:, :, 3] >= 128, 1)
    bounds = roi((192, 192), NEUTRAL_BOUNDS)
    neutral_mask = bounds & interior & ellipse
    normalized = original.copy()
    normalized[neutral_mask, :3] = edited[neutral_mask, :3]
    # Preserve original alpha byte-for-byte: body/outer silhouette never redrawn.
    normalized[:, :, 3] = original[:, :, 3]
    Image.fromarray(normalized).save(A / 'character-base.png')
    Image.fromarray(normalized).save(M / 'character-base.png')
    binary_image(neutral_mask).save(A / 'qa/neutral-patch-mask.png')
    binary_image(interior & ellipse).save(A / 'qa/face-contour-safe-mask.png')
    Image.fromarray(normalized).resize((768, 768), Image.Resampling.NEAREST).save(A / 'qa/neutral-base-4x.png')
    fx, fy, fw, fh = RECT
    safe_cell = (interior & ellipse)[fy:fy + fh, fx:fx + fw]
    record = {'neutralEdit': {'resize': list(SIZE), 'bounds': NEUTRAL_BOUNDS,
              'method': 'generated RGB source-in fixed patch; previous original RGB outside patch and alpha everywhere retained',
              'neutralChangedPixels': int(np.any(normalized != original, axis=2).sum())},
              'commonRect': RECT, 'commonEllipse': ELLIPSE,
              'outlineProtection': 'one-logical-pixel interior erosion of original alpha>=128; original boundary RGBA retained',
              'featureMaskMode': 'generated-feature alpha extraction within shared landmarks; no feature is newly drawn',
              'perFrameTransforms': False, 'newExpressionsPainted': False, 'duplicatedFrames': False,
              'rotations': False, 'mirroring': False, 'actions': {}}
    for action in ACTIONS:
        atlas = Image.open(A / 'sources' / f'face-{action}.png').convert('RGBA')
        result = Image.new('RGBA', (360, 174), (0, 0, 0, 0))
        frame_dir = A / 'frames' / action
        frame_dir.mkdir(parents=True, exist_ok=True)
        masks = Image.new('L', (360, 174), 0)
        measures = []
        for i in range(12):
            px, py = i % 4 * 90, i // 4 * 58
            f = atlas.crop((px, py, px + 90, py + 58))
            fm, parts = expression_mask(f, action)
            fm &= safe_cell
            p = np.array(f)
            p[~fm, 3] = 0
            p[p[:, :, 3] == 0, :3] = 0  # clear invisible RGB only, never visible art
            normalized_frame = Image.fromarray(p)
            result.paste(normalized_frame, (px, py))
            masks.paste(binary_image(fm), (px, py))
            normalized_frame.save(frame_dir / f'{i:02d}.png')
            partdir = A / 'qa/feature-masks' / action
            partdir.mkdir(parents=True, exist_ok=True)
            # QA mask component images and measurements, not expression artwork.
            for key, pm in parts.items():
                if i == 0:
                    binary_image(pm & safe_cell).save(partdir / f'{key}-frame00.png')
            measures.append({'frame': i, 'visiblePixelCount': int((p[:, :, 3] > 0).sum()),
                             'partsPixelCounts': {key: int((pm & safe_cell).sum()) for key, pm in parts.items()},
                             'pixelsRejectedForContourSafety': int((expression_mask(f, action)[0] & ~safe_cell).sum())})
        name = f'face-{action}.png'
        result.save(A / name)
        result.save(M / name)
        masks.save(A / 'qa' / f'feature-mask-{action}.png')
        result.resize((1080, 522), Image.Resampling.NEAREST).save(A / 'qa' / f'{action}-feature-atlas-3x.png')
        record['actions'][action] = measures
    (A / 'normalization.json').write_text(json.dumps(record, indent=2) + '\n')
    print(json.dumps({'neutralChangedPixels': record['neutralEdit']['neutralChangedPixels'],
                      'commonRect': RECT, 'commonEllipse': ELLIPSE,
                      'outputRoot': str(M)}, indent=2))

if __name__ == '__main__':
    main()
