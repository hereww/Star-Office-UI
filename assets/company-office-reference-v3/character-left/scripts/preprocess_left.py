#!/usr/bin/env python3
"""Non-painting preprocessing for built-in generated left-profile candidates.

Only whole-canvas nearest-neighbor scaling, equal grid slicing and lossless
packing/copying are permitted. No mirroring, rotation, re-centering, deformation,
alpha thresholding, pixel drawing, artificial frame synthesis or frame cloning.
The JSON plan lives next to this script's parent directory.
"""
from pathlib import Path
import json
import shutil
from PIL import Image

AUDIT = Path(__file__).resolve().parents[1]
ROOT = AUDIT.parents[2]
MEDIA = ROOT / 'frontend/company-office/reference-v3/media/character-left'
ACTIONS = ('working', 'idle', 'syncing', 'error')

def preprocess():
    plan = json.loads((AUDIT / 'preprocess-plan.json').read_text())
    MEDIA.mkdir(parents=True, exist_ok=True)
    source = Image.open(AUDIT / plan['baseSource']).convert('RGBA')
    if plan['baseCrop'] is not None:
        source = source.crop(plan['baseCrop'])
    base = source.resize(tuple(plan['baseResize']), Image.Resampling.NEAREST)
    base.save(AUDIT / 'character-base.png')
    base.save(MEDIA / 'character-base.png')
    reference = base.crop(tuple(plan['faceReferenceCrop']))
    reference.save(AUDIT / 'sources/face-left-reference.png')
    reference.resize((720, 464), Image.Resampling.NEAREST).save(
        AUDIT / 'sources/face-left-reference-8x.png')
    results = []
    for action in ACTIONS:
        entry = plan['atlases'][action]
        raw_path = AUDIT / entry['source']
        raw = Image.open(raw_path).convert('RGBA')
        crop = entry.get('sourceCrop')
        if crop is not None:
            raw = raw.crop(tuple(crop))
        # One uniform whole-sheet rescale, never fit/recenter individual faces.
        sheet = raw.resize((360, 174), Image.Resampling.NEAREST)
        name = f'face-{action}.png'
        sheet.save(AUDIT / name)
        shutil.copy2(AUDIT / name, MEDIA / name)
        frame_dir = AUDIT / 'frames' / action
        frame_dir.mkdir(parents=True, exist_ok=True)
        for index in range(12):
            x, y = (index % 4) * 90, (index // 4) * 58
            sheet.crop((x, y, x + 90, y + 58)).save(frame_dir / f'{index:02d}.png')
        results.append({'action': action, 'sourceSize': Image.open(raw_path).size,
                        'sourceCrop': crop, 'outputSize': sheet.size,
                        'frameSize': [90, 58], 'frameCount': 12,
                        'method': 'whole-sheet nearest-neighbor, row-major slicing'})
    (AUDIT / 'qa/preprocessing.json').write_text(json.dumps({
        'baseSourceSize': Image.open(AUDIT / plan['baseSource']).size,
        'baseSize': [192, 192], 'actualGeneratedAlphaPreserved': True,
        'paintedPixels': False, 'mirroring': False, 'rotation': False,
        'syntheticOrRepeatedFrames': False, 'results': results
    }, indent=2) + '\n')
    return results

if __name__ == '__main__':
    print(json.dumps(preprocess(), indent=2))
