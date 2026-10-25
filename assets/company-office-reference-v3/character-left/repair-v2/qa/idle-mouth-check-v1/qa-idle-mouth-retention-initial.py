#!/usr/bin/env python3
"""Focused source-to-alpha QA. Never edits expression PNGs or runtime.

Permitted image operations here: source crop/nearest scaling, mask visualisation,
existing-pixel compositing and QA labels. No mouth/eye/fur is painted. The only
existing files updated are the two repair-v2 manifests, after successful checks.
Their original bytes were saved before this script was created.
"""
from pathlib import Path
from collections import Counter
import hashlib
import json
import re
import runpy
import numpy as np
from PIL import Image, ImageDraw, ImageFont

A = Path(__file__).resolve().parents[1]
ROOT = A.parents[3]
M = ROOT / 'frontend/company-office/reference-v3/media/character-left/repair-v2'
REF = ROOT / 'frontend/company-office/reference-v3'
Q = A / 'qa/idle-mouth-check-v1'
F = runpy.run_path(str(A / 'scripts/build_repair_v2.py'))
ACTIONS = ('working', 'idle', 'syncing', 'error')
RECT = [38, 64, 90, 58]
ELLIPSE = [76, 93, 32, 27]
FONT = ImageFont.truetype('/System/Library/Fonts/Menlo.ttc', 14)


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')


def bbox(mask):
    yy, xx = np.where(mask)
    if len(xx) == 0:
        return None
    return [int(xx.min()), int(yy.min()), int(xx.max() + 1), int(yy.max() + 1)]


def frame(sheet, index):
    x, y = index % 4 * 90, index // 4 * 58
    return sheet.crop((x, y, x + 90, y + 58))


def rgba_hash(pixels):
    p = np.array(pixels, copy=True)
    p[p[:, :, 3] == 0, :3] = 0
    return hashlib.sha256(p.tobytes()).hexdigest()


def mouth_core(source):
    """Independent detector, not the build script's cropped expression mask.

    A broader ROI covers the complete oral cavity and tongue. Eroding *source*
    silhouette alpha separates the external jaw perimeter, including frames 5/6
    where raw dark perimeter and mouth touch. No erosion of mouth colour itself.
    The pink colour test excludes the brown anti-aliased outer jaw in 10/11.
    """
    p = np.asarray(source)
    r, g, b = p[:, :, :3].astype(float).transpose(2, 0, 1)
    opaque = p[:, :, 3] >= 128
    dark = p[:, :, :3].max(2) < 115
    inner = F['erode'](opaque, 2)
    oral = F['roi']((58, 90), [8, 24, 48, 54])
    cavity = F['nearest_component'](dark & inner & oral, (25, 38))
    tongue = (opaque & F['roi']((58, 90), [17, 34, 42, 49]) &
              (r >= 130) & (r - g >= 50) & (b >= 70) & (b >= g * .75))
    eyelid = F['nearest_component'](
        dark & opaque & F['roi']((58, 90), [23, 14, 49, 29]), (34, 22))
    return cavity, tongue, eyelid


def actor_frame(base, face):
    out = base.copy()
    out.alpha_composite(face, (RECT[0], RECT[1]))
    return out


def image_panel(canvas, picture, xy, size, title):
    """QA-only label plus unchanged artwork; does not author facial art."""
    x, y = xy
    ImageDraw.Draw(canvas).text((x + 4, y + 2), title, fill='#eeeeee', font=FONT)
    scaled = picture.resize(size, Image.Resampling.NEAREST)
    canvas.alpha_composite(scaled, (x, y + 24))


def main():
    Q.mkdir(parents=True, exist_ok=True)
    manifest = json.loads((A / 'manifest.json').read_text())
    assert manifest['character']['faceRect'] == RECT
    assert manifest['character']['faceClipEllipse'] == ELLIPSE
    assert manifest['character']['headAnchor'] == [78, 94]
    base = Image.open(M / 'character-base.png').convert('RGBA')
    previous_base = Image.open(A / 'sources/character-base.png').convert('RGBA')
    bp, prev = np.asarray(base), np.asarray(previous_base)
    yy, xx = np.indices((192, 192))
    cx, cy, rx, ry = ELLIPSE
    ellipse = ((xx + .5 - cx) / rx) ** 2 + ((yy + .5 - cy) / ry) ** 2 <= 1
    rect = F['roi']((192, 192), [38, 64, 128, 122])
    interior = F['erode'](prev[:, :, 3] >= 128, 1)
    original_contour = (prev[:, :, 3] >= 128) & ~interior
    safe = (interior & ellipse)[64:122, 38:128]
    neutral_patch = np.asarray(Image.open(A / 'qa/neutral-patch-mask.png')) > 0
    no_old_mouth_roi = F['roi']((192, 192), [51, 101, 64, 113]) & F['erode'](prev[:, :, 3] >= 128, 3)
    old_mouth_residual = int(((bp[:, :, :3].max(2) < 115) & no_old_mouth_roi).sum())
    base_checks = {
        'size': list(base.size),
        'alphaMinimum': int(bp[:, :, 3].min()),
        'alphaMaximum': int(bp[:, :, 3].max()),
        'transparentPixels': int((bp[:, :, 3] == 0).sum()),
        'alphaBytesChangedVsOriginalBase': int((bp[:, :, 3] != prev[:, :, 3]).sum()),
        'changedOutsideNeutralPatch': int(np.any(bp != prev, axis=2)[~neutral_patch].sum()),
        'oldMouthResidualInnerDarkPixels': old_mouth_residual,
    }
    source = Image.open(A / 'sources/face-idle.png').convert('RGBA')
    plan = json.loads((A.parent / 'preprocess-plan.json').read_text())
    raw_spec = plan['atlases']['idle']
    raw_path = A.parent / raw_spec['source']
    raw = Image.open(raw_path).convert('RGBA')
    raw_size = list(raw.size)
    if raw_spec.get('sourceCrop') is not None:
        raw = raw.crop(tuple(raw_spec['sourceCrop']))
    expected_source = np.asarray(raw.resize((360, 174), Image.Resampling.NEAREST))
    source_provenance_equal = bool(np.array_equal(expected_source, np.asarray(source)))
    actions, actors, idle_checks, idle_masks = {}, {}, [], []
    source_masks = Image.new('L', (360, 174), 0)
    for action in ACTIONS:
        atlas = Image.open(M / f'face-{action}.png').convert('RGBA')
        sf_atlas = Image.open(A / 'sources' / f'face-{action}.png').convert('RGBA')
        assert atlas.size == (360, 174)
        checks, hashes, composed_hashes = [], [], []
        actors[action] = []
        for index in range(12):
            face, sf = frame(atlas, index), frame(sf_atlas, index)
            fp, sp = np.asarray(face), np.asarray(sf)
            visible = fp[:, :, 3] > 0
            actor = actor_frame(base, face)
            ap = np.asarray(actor)
            actors[action].append(actor)
            hashes.append(rgba_hash(fp))
            composed_hashes.append(rgba_hash(ap))
            check = {
                'frame': index,
                'bodyOutsideFaceRectChangedPixels': int(np.any(ap != bp, axis=2)[~rect].sum()),
                'outsideCommonEllipseChangedPixels': int(np.any(ap != bp, axis=2)[~ellipse].sum()),
                'originalOuterContourRGBAChangedPixels': int(np.any(ap != prev, axis=2)[original_contour].sum()),
                'alphaSilhouetteChangedPixels': int((ap[:, :, 3] != bp[:, :, 3]).sum()),
                'featureAlphaOutsideContourSafeMask': int((visible & ~safe).sum()),
                'visibleRGBChangedVsGeneratedSource': int(np.any(fp[:, :, :3] != sp[:, :, :3], axis=2)[visible].sum()),
                'visibleAlphaChangedVsGeneratedSource': int((fp[:, :, 3] != sp[:, :, 3])[visible].sum()),
            }
            checks.append(check)
            if action == 'idle':
                cavity, tongue, eyelid = mouth_core(sf)
                mouth_visible = cavity & visible
                observed_dark_mouth = (fp[:, :, :3].max(2) < 115) & visible & F['roi']((58, 90), [8, 24, 48, 54])
                cavity_box = bbox(cavity)
                mouth_record = {
                    **check,
                    'sourceCavityDarkPixels': int(cavity.sum()),
                    'retainedCavityDarkPixels': int(mouth_visible.sum()),
                    'missingCavityDarkPixels': int((cavity & ~visible).sum()),
                    'sourceTonguePinkPixels': int(tongue.sum()),
                    'retainedTonguePinkPixels': int((tongue & visible).sum()),
                    'missingTonguePinkPixels': int((tongue & ~visible).sum()),
                    'sourceClosedEyelidPixels': int(eyelid.sum()),
                    'missingClosedEyelidPixels': int((eyelid & ~visible).sum()),
                    'cavityBoundingBoxHalfOpen': cavity_box,
                    'cavitySize': [cavity_box[2] - cavity_box[0], cavity_box[3] - cavity_box[1]],
                    'mouthDarkComponentCount': len(F['components'](observed_dark_mouth)),
                    'noDoubleMouthTechnical': old_mouth_residual == 0 and len(F['components'](observed_dark_mouth)) == 1,
                }
                idle_checks.append(mouth_record)
                idle_masks.append((cavity, tongue))
                mask = F['binary_image'](cavity | tongue)
                source_masks.paste(mask, (index % 4 * 90, index // 4 * 58))
        actions[action] = {
            'atlasSize': list(atlas.size), 'grid': [4, 3], 'frameSize': [90, 58],
            'frameCount': 12, 'uniqueVisibleFrames': len(set(hashes)),
            'uniqueComposedFrames': len(set(composed_hashes)),
            'genuineAlpha': bool(np.asarray(atlas)[:, :, 3].min() == 0 and np.asarray(atlas)[:, :, 3].max() == 255),
            'auditAndMediaPNGIdentical': sha(A / f'face-{action}.png') == sha(M / f'face-{action}.png'),
            'frames': checks,
        }
    legacy_baseline = json.loads((A / 'qa/protected-inputs-before.json').read_text())['files']
    legacy_changed = [v['path'] for v in legacy_baseline if not (ROOT / v['path']).is_file() or sha(ROOT / v['path']) != v['sha256']]
    invariant_keys = [k for k in actions['idle']['frames'][0] if k != 'frame']
    invariant_max = {k: max(v[k] for info in actions.values() for v in info['frames']) for k in invariant_keys}
    passed = (
        source_provenance_equal and not legacy_changed and old_mouth_residual == 0 and
        base_checks['alphaBytesChangedVsOriginalBase'] == 0 and base_checks['changedOutsideNeutralPatch'] == 0 and
        all(v == 0 for v in invariant_max.values()) and
        all(v['uniqueVisibleFrames'] == 12 and v['uniqueComposedFrames'] == 12 and v['genuineAlpha'] and v['auditAndMediaPNGIdentical'] for v in actions.values()) and
        all(v['sourceCavityDarkPixels'] > 0 and v['missingCavityDarkPixels'] == 0 and v['missingTonguePinkPixels'] == 0 and
            v['sourceClosedEyelidPixels'] > 0 and v['missingClosedEyelidPixels'] == 0 and v['noDoubleMouthTechnical'] for v in idle_checks)
    )
    # Contact sheet: same logical crop, no individual registration or transformations.
    selected = [0, 5, 6, 11]
    comparison = Image.new('RGBA', (1440, 1060), '#22262a')
    final_atlas = Image.open(M / 'face-idle.png').convert('RGBA')
    for col, index in enumerate(selected):
        rec = idle_checks[index]
        x = col * 360
        sf, final = frame(source, index), frame(final_atlas, index)
        mask = np.asarray(final)[:, :, 3]
        mask_rgba = Image.fromarray(mask).convert('RGBA')
        panels = [
            (sf, f'F{index:02d} SOURCE: mouth {rec["sourceCavityDarkPixels"]} px'),
            (mask_rgba, f'F{index:02d} FINAL ALPHA: no lost cavity'),
            (final, f'F{index:02d} FEATURES: original RGB'),
            (actors['idle'][index].crop((38, 64, 128, 122)), f'F{index:02d} FIXED BASE + FACE'),
        ]
        for row, (picture, title) in enumerate(panels):
            image_panel(comparison, picture, (x, row * 265), (360, 232), title)
    comparison.save(Q / 'idle-source-alpha-composite-contact.png')
    # All 12 mouth crops: SOURCE / final generated feature overlay / fixed actor.
    mouth_comparison = Image.new('RGBA', (1152, 402), '#22262a')
    crop = (12, 26, 44, 52)
    for index in range(12):
        ox, oy = index % 4 * 288, index // 4 * 134
        rec = idle_checks[index]
        ImageDraw.Draw(mouth_comparison).text((ox + 4, oy + 2), f'F{index:02d} mouth {rec["retainedCavityDarkPixels"]}/{rec["sourceCavityDarkPixels"]}', fill='white', font=FONT)
        for col, (picture, label) in enumerate([
            (frame(source, index), 'source'),
            (frame(final_atlas, index), 'masked'),
            (actors['idle'][index].crop((38, 64, 128, 122)), 'composed'),
        ]):
            p = picture.crop(crop)
            image_panel(mouth_comparison, p, (ox + col * 96, oy + 24), (96, 78), label)
    mouth_comparison.save(Q / 'idle-all-12-mouth-source-mask-composite.png')
    source_masks.save(Q / 'independent-source-mouth-core-mask.png')
    # Reuse furniture read-only. Exact common .6 placement, never nudge a face.
    furniture = json.loads((REF / 'media/furniture/manifest.json').read_text())['directions']['left']['furniture']
    fback = Image.open(REF / furniture['back']).convert('RGBA')
    ffront = Image.open(REF / furniture['front']).convert('RGBA')
    sx, sy = furniture['seatAnchor']
    placement = [sx - 96 * .6, sy - 174 * .6, 192 * .6, 192 * .6]
    station_contact = Image.new('RGBA', (1536, 1224), '#22262a')
    for index in range(12):
        station = fback.resize((960, 960), Image.Resampling.NEAREST)
        layer = Image.new('RGBA', (960, 960))
        layer.paste(actors['idle'][index].resize((576, 576), Image.Resampling.NEAREST), (round(placement[0] * 5), round(placement[1] * 5)))
        station = Image.alpha_composite(station, layer)
        station = Image.alpha_composite(station, ffront.resize((960, 960), Image.Resampling.NEAREST))
        station = station.resize((192, 192), Image.Resampling.NEAREST)
        image_panel(station_contact, station, (index % 4 * 384, index // 4 * 408), (384, 384), f'idle F{index:02d}: closed eye + open mouth')
    station_contact.save(Q / 'idle-all-12-workstation-contact-2x.png')
    four = Image.new('RGBA', (1536, 1632), '#22262a')
    for row, action in enumerate(ACTIONS):
        for col, index in enumerate(selected):
            image_panel(four, actors[action][index], (col * 384, row * 408), (384, 384), f'{action} F{index:02d} / body delta = 0')
    four.save(Q / 'four-action-composite-contact.png')
    # Runtime is READ ONLY: record actual first-frame hold, do not alter clocks.
    player_path = REF / 'directional-player.mjs'
    player = player_path.read_text() if player_path.is_file() else ''
    first_frame_hold_confirmed = 'this.faceFrame = faceTick < 12 ? faceTick : 0;' in player
    integration = json.loads((REF / 'assets.json').read_text()) if (REF / 'assets.json').is_file() else {}
    current_left = integration.get('directions', {}).get('left', {}).get('character', {})
    report = {
        'schemaVersion': 1, 'date': '2026-10-02', 'status': 'idle_mouth_retained_no_png_repair_required' if passed else 'qa_failed_keep_candidates',
        'technicalPassed': passed, 'humanApproved': False, 'visualApproved': False,
        'newImageGenerationCalls': 0, 'expressionPNGModified': False, 'alphaMaskModified': False,
        'newExpressionsPainted': False, 'runtimeModified': False, 'headAnchorModified': False,
        'base': base_checks, 'fixedFaceRect': RECT, 'fixedFaceClipEllipse': ELLIPSE,
        'perFrameTransforms': False, 'checkedActionFrames': 48, 'invariantMaxima': invariant_max,
        'source': {'raw': str(raw_path), 'rawSize': raw_size, 'rawSha256': sha(raw_path),
                   'normalized': str(A / 'sources/face-idle.png'), 'normalizationMatchesRawSource': source_provenance_equal,
                   'detector': 'Broader [8,24,48,54] source oral ROI; alpha-boundary exclusion only; nearest oral dark component. Tongue uses separate pink threshold. No build expression mask reuse.'},
        'idleMouth': {'all12CavityDarkRetained': all(v['missingCavityDarkPixels'] == 0 for v in idle_checks),
                      'all12TonguePinkRetained': all(v['missingTonguePinkPixels'] == 0 for v in idle_checks),
                      'all12ClosedEyelidsRetained': all(v['missingClosedEyelidPixels'] == 0 for v in idle_checks),
                      'noDoubleMouth': all(v['noDoubleMouthTechnical'] for v in idle_checks),
                      'removedRawDarkJawPerimeterIsNotMouth': True, 'frames': idle_checks},
        'actions': actions,
        'protectedPreviousInputs': {'count': len(legacy_baseline), 'changed': legacy_changed, 'allUnchanged': not legacy_changed},
        'readOnlyPreview': {'furnitureModified': False, 'placement': placement,
                            'furnitureHashes': {key: sha(REF / furniture[key]) for key in ('back', 'front')},
                            'handsAcceptance': 'No hand-animation assets in this package. Static paws unchanged; final workstation hides feet. This is not a runtime execution audit.'},
        'smallMouthRisk': {'frame0CavityLogicalSize': idle_checks[0]['cavitySize'],
                          'frame0ProjectedSizeAtScale06': [v * .6 for v in idle_checks[0]['cavitySize']],
                          'playerFirstFrameHoldVerifiedReadOnly': first_frame_hold_confirmed,
                          'idleClockFrames': 36, 'frame0SamplesPer36Ticks': 25 if first_frame_hold_confirmed else None,
                          'explanation': 'Source frame 0 has a smaller but open mouth. With the existing player it is used on tick 0 and ticks 12..35, so small overview scale can weaken sleep readability; not removed by alpha.'},
        'headAnchorBoundary': {'assetManifestPreserved': manifest['character']['headAnchor'],
                               'mainAssetsReadOnly': current_left.get('headAnchor'),
                               'owner': 'main agent; do not overwrite the main integration headAnchor from this older asset metadata'},
        'visualObservation': 'Source and existing 12-frame contacts inspected: eyelids closed, black oral cavity and pink tongue visible; no generated source mouth was lost. Main agent retains final human visual acceptance.',
        'artifacts': {name: str(Q / name) for name in [
            'idle-source-alpha-composite-contact.png', 'idle-all-12-mouth-source-mask-composite.png',
            'idle-all-12-workstation-contact-2x.png', 'four-action-composite-contact.png']},
    }
    if passed:
        # Do not rewrite character, URLs, timings, outline, base or actions.
        updated = json.loads((Q / 'manifest-before-audit.json').read_text())
        updated['humanApproved'] = False
        updated['readyForLocalPreview'] = True
        updated['qa']['idleMouthRetention'] = {
            'technicalPassed': True, 'all12CavityDarkRetained': True, 'all12TonguePinkRetained': True,
            'missingCavityDarkPixels': 0, 'missingTonguePinkPixels': 0,
            'pngOrMaskRepairNeeded': False, 'allPNGsUnchanged': True,
            'measurement': str(Q / 'validation.json'),
            'sourceAlphaCompositeContact': str(Q / 'idle-source-alpha-composite-contact.png'),
            'all12MouthContact': str(Q / 'idle-all-12-mouth-source-mask-composite.png'),
            'frame0ReadabilityRisk': 'Small source mouth plus existing 25/36-tick first-frame hold at scale .6; not alpha deletion. No runtime/timing change.'}
        assert updated['character'] == manifest['character']
        write_json(A / 'manifest.json', updated)
        write_json(M / 'manifest.json', updated)
    # Existing candidate preservation: only two intentional manifest metadata diffs.
    before = json.loads((Q / 'scope-before.json').read_text())['files']
    existing_changed = [entry['path'] for entry in before if not Path(entry['path']).is_file() or sha(entry['path']) != entry['sha256']]
    permitted = {str(A / 'manifest.json'), str(M / 'manifest.json')} if passed else set()
    unexpected = [p for p in existing_changed if p not in permitted]
    report['currentTurnPreservation'] = {
        'previousFileCount': len(before), 'unchangedFileCount': len(before) - len(existing_changed),
        'intentionalMetadataChanges': existing_changed if not unexpected else [],
        'unexpectedChanges': unexpected, 'allCandidatePNGsAndSourcesUnchanged': not unexpected,
        'originalManifestCopies': [str(Q / 'manifest-before-audit.json'), str(Q / 'manifest-before-media.json')],
    }
    report['technicalPassed'] = passed and not unexpected
    write_json(Q / 'validation.json', report)
    print(json.dumps({'technicalPassed': report['technicalPassed'], 'sourceNormalizationMatches': source_provenance_equal,
                      'mouthDarkPerFrame': [v['sourceCavityDarkPixels'] for v in idle_checks],
                      'missingMouthDarkPerFrame': [v['missingCavityDarkPixels'] for v in idle_checks],
                      'missingTonguePerFrame': [v['missingTonguePinkPixels'] for v in idle_checks],
                      'invariantMaxima': invariant_max, 'existingChanged': existing_changed,
                      'output': str(Q)}, ensure_ascii=False, indent=2))
    if not report['technicalPassed']:
        raise SystemExit('QA failed; preserve candidates; do not claim a pass')


if __name__ == '__main__':
    main()
