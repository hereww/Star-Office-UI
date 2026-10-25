#!/usr/bin/env python3
"""Read-only image measurements + offline QA montages, not runtime/UI integration.

All expression artwork is from the model. The only mask below emulates the
manifest clip ellipse for inspection and pixel-diff tests. It never repairs,
paints, synthesizes or saves changed production sprites. Contact sheets are
QA-only compositions, not newly generated/full-body animation assets.
"""
from pathlib import Path
import hashlib
import json
from itertools import combinations
import numpy as np
from PIL import Image

AUDIT = Path(__file__).resolve().parents[1]
ROOT = AUDIT.parents[2]
MEDIA = ROOT / 'frontend/company-office/reference-v3/media/character-left'
ACTIONS = ('working', 'idle', 'syncing', 'error')


def digest(pixels):
    a = np.array(pixels, copy=True)
    a[a[:, :, 3] == 0, :3] = 0
    return hashlib.sha256(a.tobytes()).hexdigest()


def alpha_info(im):
    a = np.asarray(im.convert('RGBA'))[:, :, 3]
    h, w = a.shape
    return {'size': [w, h], 'mode': im.mode,
            'min': int(a.min()), 'max': int(a.max()),
            'transparentPixels': int((a == 0).sum()),
            'transparentFraction': round(float((a == 0).mean()), 6),
            'effectiveOpaqueFraction128': round(float((a >= 128).mean()), 6),
            'binaryAlpha': bool(np.isin(a, [0, 255]).all()),
            'genuineAlpha': bool(a.min() == 0 and a.max() >= 128),
            'contentBBoxAlpha128': Image.fromarray(
                ((a >= 128) * 255).astype('uint8')).getbbox()}


def visible_difference(a, b):
    aa, bb = np.array(a, copy=True), np.array(b, copy=True)
    aa[aa[:, :, 3] == 0, :3] = 0
    bb[bb[:, :, 3] == 0, :3] = 0
    return np.any(aa != bb, axis=2)


def nose_measurement(frame):
    p = np.asarray(frame)
    r, g, b = p[:, :, :3].astype('float32').transpose(2, 0, 1)
    mask = (p[:, :, 3] >= 128) & (r > 140) & (r > g * 1.15) & (b > g * .8) & (b > 70)
    mask[:, 28:] = False
    mask[:18] = False
    mask[42:] = False
    y, x = np.where(mask)
    return None if len(x) == 0 else [round(float(x.mean()), 3), round(float(y.mean()), 3)]


def eye_dark_pixels(frame):
    # Fixed inner near-eye region; no whole-frame noise counted as expression.
    p = np.asarray(frame)[14:39, 23:49]
    return int(((p[:, :, :3].max(2) < 90) & (p[:, :, 3] >= 128)).sum())


def main():
    plan = json.loads((AUDIT / 'preprocess-plan.json').read_text())
    base = Image.open(MEDIA / 'character-base.png').convert('RGBA')
    bp = np.asarray(base)
    fx, fy, fw, fh = plan['faceRect']
    cx, cy, rx, ry = plan['faceClipEllipse']
    yy, xx = np.indices((192, 192))
    ellipse = ((xx + .5 - cx) / rx) ** 2 + ((yy + .5 - cy) / ry) ** 2 <= 1
    mask = Image.fromarray((ellipse * 255).astype('uint8'))
    face_roi = ellipse[fy:fy + fh, fx:fx + fw]
    # A deliberately broad feature ROI (eye+brow+mouth); separately measure fur.
    features = np.zeros((58, 90), dtype=bool)
    features[6:39, 20:50] = True
    features[33:53, 10:32] = True
    stable_inner = face_roi & ~features
    summary = {'schemaVersion': 1, 'candidateOnly': True,
               'method': 'actual PNG alpha, 12 row-major cells, visible RGBA hashes, exact offline manifest ellipse compositor',
               'noImageRepairs': True, 'base': alpha_info(base),
               'faceRect': plan['faceRect'], 'faceClipEllipse': plan['faceClipEllipse'],
               'actions': {}, 'passed': None,
               'limitations': ['Distinct RGBA hashes do not prove 12 distinct semantic phases.',
                               'Ellipse QA is not browser/runtime integration or user visual approval.',
                               'Nose centroids are color measurements, not perfect anatomical landmarks.']}
    first_frames = []
    for action in ACTIONS:
        atlas = Image.open(MEDIA / f'face-{action}.png').convert('RGBA')
        raw = Image.open(AUDIT / plan['atlases'][action]['source']).convert('RGBA')
        frames, hashes, clips, eye_hashes, bodies = [], [], [], [], []
        atlas_px = np.asarray(atlas)
        raw_counts = []
        montage = Image.new('RGBA', (192 * 4, 192 * 3), (0, 0, 0, 0))
        nose = []
        outside_face_changed = []
        outline_changed = []
        face_alpha_changed = []
        for index in range(12):
            x, y = (index % 4) * 90, (index // 4) * 58
            frame = atlas.crop((x, y, x + 90, y + 58))
            fp = np.asarray(frame)
            frames.append(fp)
            hashes.append(digest(fp))
            visible_patch = np.array(fp, copy=True)
            visible_patch[~face_roi] = 0
            clips.append(digest(visible_patch))
            eye_hashes.append(digest(fp[6:39, 20:50]))
            nose.append(nose_measurement(frame))
            raw_counts.append(int((fp[:, :, 3] >= 128).sum()))
            overlay = Image.new('RGBA', (192, 192), (0, 0, 0, 0))
            overlay.paste(frame, (fx, fy))
            clipped = Image.composite(overlay, Image.new('RGBA', (192, 192)), mask)
            composite = Image.alpha_composite(base, clipped)
            cp = np.asarray(composite)
            changed = visible_difference(bp, cp)
            outside_face_changed.append(int((changed & ~ellipse).sum()))
            face_alpha_changed.append(int(((bp[:, :, 3] >= 128) != (cp[:, :, 3] >= 128)).sum()))
            # Head outline safety: logical head y<=124; alpha silhouette difference.
            outline_changed.append(int(((bp[:124, :, 3] >= 128) != (cp[:124, :, 3] >= 128)).sum()))
            bodies.append(cp)
            montage.paste(composite, ((index % 4) * 192, (index // 4) * 192))
        montage.save(AUDIT / 'qa' / f'{action}-composite-contact.png')
        montage.resize((1536, 1152), Image.Resampling.NEAREST).save(
            AUDIT / 'qa' / f'{action}-composite-contact-2x.png')
        atlas.resize((1080, 522), Image.Resampling.NEAREST).save(
            AUDIT / 'qa' / f'{action}-atlas-3x.png')
        visible = [f[:, :, :3].astype('float32') * (f[:, :, 3:].astype('float32') / 255)
                   for f in frames]
        significant_stable_change = [int(((np.abs(visible[0] - v).max(2) > 16) & stable_inner).sum())
                                     for v in visible[1:]]
        first = Image.fromarray(bodies[0])
        first_frames.append(first)
        identical_pairs = [[i, j] for i, j in combinations(range(12), 2) if hashes[i] == hashes[j]]
        feature_changed = []
        stable_changed = []
        for i in range(1, 12):
            diff = visible_difference(frames[0], frames[i])
            feature_changed.append(int((diff & features & face_roi).sum()))
            stable_changed.append(int((diff & stable_inner).sum()))
        ns = np.array([n for n in nose if n is not None])
        drift = None if len(ns) < 2 else (ns.max(0) - ns.min(0)).round(3).tolist()
        summary['actions'][action] = {
            'alpha': alpha_info(atlas), 'rawAlpha': alpha_info(raw),
            'cellCount': 12, 'cellSize': [90, 58], 'grid': [4, 3],
            'nonemptyCellCount': sum(c > 0 for c in raw_counts),
            'visiblePixelUniqueFrameCount': len(set(hashes)), 'frameHashes': hashes,
            'clippedFaceUniqueFrameCount': len(set(clips)),
            'eyeRegionUniqueFrameCount': len(set(eye_hashes)),
            'identicalFramePairs': identical_pairs,
            'noseCentroids': nose, 'noseCentroidRangePx': drift,
            'darkEyePixelCounts': [eye_dark_pixels(Image.fromarray(f)) for f in frames],
            'featureChangedPixelsVsFrame0': feature_changed,
            'nonFeatureInnerChangedPixelsVsFrame0': stable_changed,
            'fixedBodyOutsideFaceChangedPixels': outside_face_changed,
            'headSilhouetteChangedPixelsVsBase': outline_changed,
            'alphaSilhouetteChangedPixelsVsBase': face_alpha_changed,
            'bodyFixedByStaticBaseAndClip': max(outside_face_changed) == 0,
            'headOutlineInvariantAfterClip': max(outline_changed) == 0,
            'exactNonFeaturePixelsInvariant': max(stable_changed) == 0,
            'visibleNonFeatureChangedPixelsThreshold16': significant_stable_change,
            'stableInnerMeasuredPixels': int(stable_inner.sum()),
            'rawGeneratedVisualReviewRequired': True}
    strip = Image.new('RGBA', (768, 192), (0, 0, 0, 0))
    for i, frame in enumerate(first_frames):
        strip.paste(frame, (i * 192, 0))
    strip.resize((1536, 384), Image.Resampling.NEAREST).save(AUDIT / 'qa/actions-first-frame-contact-2x.png')
    protected = json.loads((AUDIT / 'qa/protected-inputs-before.json').read_text())
    changes = []
    for entry in protected['files']:
        path = ROOT / entry['path']
        current = hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else None
        if current != entry['sha256']:
            changes.append({'path': entry['path'], 'before': entry['sha256'], 'after': current})
    summary['protectedInputs'] = {'count': len(protected['files']), 'unchanged': not changes, 'changes': changes}
    mirror = []
    for name in ['character-base.png'] + [f'face-{a}.png' for a in ACTIONS]:
        one, two = (AUDIT / name).read_bytes(), (MEDIA / name).read_bytes()
        mirror.append({'name': name, 'sha256': hashlib.sha256(one).hexdigest(), 'byteIdentical': one == two})
    summary['runtimeAuditCopyMatch'] = mirror
    summary['structuralPassed'] = summary['base']['genuineAlpha'] and all(
        d['alpha']['genuineAlpha'] and d['alpha']['size'] == [360, 174]
        and d['nonemptyCellCount'] == 12 and d['visiblePixelUniqueFrameCount'] == 12
        and d['clippedFaceUniqueFrameCount'] == 12
        for d in summary['actions'].values())
    summary['strictFixedFacePassed'] = all(
        d['bodyFixedByStaticBaseAndClip'] and d['headOutlineInvariantAfterClip']
        and max(d['visibleNonFeatureChangedPixelsThreshold16']) == 0
        for d in summary['actions'].values())
    summary['passed'] = bool(summary['structuralPassed'] and summary['strictFixedFacePassed'])
    summary['findings'] = ('Strict fixed-face alignment and invariant non-expression texture '
                           'requirement not met; this is a rejected candidate, not an approved direction.')
    (AUDIT / 'qa/validation-measurements.json').write_text(json.dumps(summary, indent=2) + '\n')
    print(json.dumps({'base': summary['base'], 'actions': {
        a: {k: v for k, v in data.items() if k in ['visiblePixelUniqueFrameCount', 'clippedFaceUniqueFrameCount',
             'eyeRegionUniqueFrameCount', 'noseCentroidRangePx', 'darkEyePixelCounts',
             'bodyFixedByStaticBaseAndClip', 'headOutlineInvariantAfterClip', 'exactNonFeaturePixelsInvariant',
             'headSilhouetteChangedPixelsVsBase']}
        for a, data in summary['actions'].items()}, 'protectedInputs': summary['protectedInputs']}, indent=2))

if __name__ == '__main__':
    main()
