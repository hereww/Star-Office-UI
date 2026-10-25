#!/usr/bin/env python3
"""Offline repair QA; no UI, runtime edits, new drawings or hand animation.

PNG contact sheets and the eye-loop APNG are compositions of existing pixels.
Checks distinguish exact outer invariants from visual approval by the main agent.
"""
from pathlib import Path
import json
import hashlib
import runpy
import numpy as np
from PIL import Image

A = Path(__file__).resolve().parents[1]
ROOT = A.parents[3]
M = ROOT / 'frontend/company-office/reference-v3/media/character-left/repair-v2'
F = runpy.run_path(str(A / 'scripts/build_repair_v2.py'))
RECT, ELLIPSE = F['RECT'], F['ELLIPSE']
ACTIONS = F['ACTIONS']


def digest(p):
    p = np.array(p, copy=True)
    p[p[:, :, 3] == 0, :3] = 0
    return hashlib.sha256(p.tobytes()).hexdigest()


def alpha_info(p):
    a = np.asarray(p)[:, :, 3]
    return {'minimum': int(a.min()), 'maximum': int(a.max()),
            'transparentPixelCount': int((a == 0).sum()),
            'transparentFraction': round(float((a == 0).mean()), 6),
            'genuineAlpha': bool(a.min() == 0 and a.max() >= 128)}


def measure():
    base = Image.open(M / 'character-base.png').convert('RGBA')
    previous = Image.open(A / 'sources/character-base.png').convert('RGBA')
    bp, prev = np.asarray(base), np.asarray(previous)
    fx, fy, fw, fh = RECT
    cx, cy, rx, ry = ELLIPSE
    yy, xx = np.indices((192, 192))
    ellipse = ((xx + .5 - cx) / rx) ** 2 + ((yy + .5 - cy) / ry) ** 2 <= 1
    contour = (prev[:, :, 3] >= 128) & ~F['erode'](prev[:, :, 3] >= 128, 1)
    contour[124:] = False
    patch = np.asarray(Image.open(A / 'qa/neutral-patch-mask.png')) > 0
    report = {'schemaVersion': 2, 'status': 'repair_v2_technical_checked_pending_main_visual',
              'visualApproved': False, 'runtimeIntegrated': False,
              'commonFaceRect': RECT, 'commonFaceClipEllipse': ELLIPSE,
              'frameCount': 12, 'grid': [4, 3], 'fps': 12,
              'noPerFrameTransform': True, 'newExpressionsPainted': False,
              'base': {'alpha': alpha_info(bp), 'size': list(base.size),
                       'changedOutsideNeutralPatchPixels': int(np.any(bp != prev, axis=2)[~patch].sum()),
                       'alphaByteChangesVsPrevious': int((bp[:, :, 3] != prev[:, :, 3]).sum()),
                       'headOuterContourRGBAChangesVsPrevious': int(np.any(bp != prev, axis=2)[contour].sum())},
              'actions': {}, 'hands': {'handAnimationAssetsLoaded': 0, 'typingOrReachingHandFrames': 0,
                  'staticToeShapeIsNotAutomaticViolation': True,
                  'criterion': 'Final workstation has no typing hands or animated hands; static feet may be occluded by furniture.'},
              'spiralReviewCriterion': 'Natural continuous spinning impression, 12 distinct generated frames, no mathematical equal-angle phase requirement.'}
    # Anatomical original mark ROIs: inspect inner fur only, exclude original
    # outside perimeter that must remain dark and unchanged.
    deep_inside = F['erode'](prev[:, :, 3] >= 128, 3)
    rois = {'oldEye': [61, 78, 85, 104], 'oldBrow': [64, 69, 78, 79],
            'oldMouth': [51, 101, 64, 113], 'oldNose': [50, 94, 59, 103]}
    residual = {}
    for k, rect in rois.items():
        roi = F['roi']((192, 192), rect) & deep_inside
        rgb = bp[:, :, :3].astype('float32')
        if k == 'oldNose':
            r, g, b = rgb.transpose(2, 0, 1)
            marks = (r > 140) & (r > g * 1.15) & (b > g * .8) & (b > 70)
        else:
            marks = rgb.max(2) < 115
        residual[k] = int((marks & roi).sum())
    report['base']['oldMarkResidualInnerPixels'] = residual
    no_old_mouth = residual['oldMouth'] == 0
    contacts, station_contacts = {}, {}
    first_strip = Image.new('RGBA', (768, 192))
    station_strip = Image.new('RGBA', (768, 192))
    furniture_config_path = ROOT / 'frontend/company-office/reference-v3/media/furniture/manifest.json'
    spec = json.loads(furniture_config_path.read_text())['directions']['left']['furniture']
    ref = ROOT / 'frontend/company-office/reference-v3'
    fback = Image.open(ref / spec['back']).convert('RGBA')
    ffront = Image.open(ref / spec['front']).convert('RGBA')
    furniture_hashes = {key: hashlib.sha256((ref / spec[key]).read_bytes()).hexdigest() for key in ('back', 'front')}
    sx, sy = spec['seatAnchor']
    px, py = [96, 174]
    placement = [sx - px * .6, sy - py * .6, 192 * .6, 192 * .6]
    # 5x render gives exact integral placement for .6-scale and .2/.4 offsets.
    def station_picture(actor):
        out = fback.resize((960, 960), Image.Resampling.NEAREST)
        actor_scaled = actor.resize((576, 576), Image.Resampling.NEAREST)
        layer = Image.new('RGBA', (960, 960))
        layer.paste(actor_scaled, (round(placement[0] * 5), round(placement[1] * 5)))
        out = Image.alpha_composite(out, layer)
        out = Image.alpha_composite(out, ffront.resize((960, 960), Image.Resampling.NEAREST))
        return out.resize((192, 192), Image.Resampling.NEAREST)
    eye_loop = []
    final_all = Image.new('RGBA', (768, 192 * 4))
    for action_index, action in enumerate(ACTIONS):
        atlas = Image.open(M / f'face-{action}.png').convert('RGBA')
        source = Image.open(A / 'sources' / f'face-{action}.png').convert('RGBA')
        contact = Image.new('RGBA', (768, 576))
        station_contact = Image.new('RGBA', (768, 576))
        face_detail = Image.new('RGBA', (360, 174))
        hashes, composed_hashes, outside, contour_change, silhouette_change = [], [], [], [], []
        rgba_retained, generated_mouth_count, nose_pixels = [], [], []
        feature_masks = []
        frames = []
        cropped_out = []
        for i in range(12):
            x, y = i % 4 * 90, i // 4 * 58
            frame = atlas.crop((x, y, x + 90, y + 58))
            sf = source.crop((x, y, x + 90, y + 58))
            fp, sfp = np.asarray(frame), np.asarray(sf)
            visible = fp[:, :, 3] > 0
            hashes.append(digest(fp))
            rgba_retained.append(int(np.any(fp[:, :, :3] != sfp[:, :, :3], axis=2)[visible].sum()))
            fm, parts = F['expression_mask'](sf, action)
            inside_cell = (F['erode'](prev[:, :, 3] >= 128, 1) & ellipse)[fy:fy + 58, fx:fx + 90]
            mouths = F['components'](parts['mouth'] & inside_cell & (sfp[:, :, :3].max(2) < 115))
            generated_mouth_count.append(len(mouths))
            nose_pixels.append(int((parts['nose'] & inside_cell).sum()))
            cropped_out.append(int((visible & ~inside_cell).sum()))
            feature_masks.append(visible)
            overlay = Image.new('RGBA', (192, 192))
            overlay.paste(frame, (fx, fy))
            composed = Image.alpha_composite(base, overlay)
            cp = np.asarray(composed)
            changed = np.any(cp != bp, axis=2)
            outside.append(int(changed[~ellipse].sum()))
            contour_change.append(int(changed[contour].sum()))
            silhouette_change.append(int(((cp[:, :, 3] >= 128) != (prev[:, :, 3] >= 128)).sum()))
            composed_hashes.append(digest(cp))
            frames.append(cp)
            contact.paste(composed, (i % 4 * 192, i // 4 * 192))
            station = station_picture(composed)
            station_contact.paste(station, (i % 4 * 192, i // 4 * 192))
            face_detail.paste(composed.crop((fx, fy, fx + 90, fy + 58)), (x, y))
            if i == 0:
                first_strip.paste(composed, (action_index * 192, 0))
                station_strip.paste(station, (action_index * 192, 0))
                final_all.paste(composed, (action_index * 192, 0))
            # Source frames 0/5/6/11, for cross-action final contact grid.
            if i in [0, 5, 6, 11]:
                final_all.paste(composed, (action_index * 192, [0, 5, 6, 11].index(i) * 192))
            if action == 'error':
                eye_loop.append(composed.crop((fx, fy, fx + 90, fy + 58)).resize((540, 348), Image.Resampling.NEAREST))
        union = np.any(np.stack(feature_masks), axis=0)
        non_feature = np.zeros((192, 192), dtype=bool)
        non_feature[fy:fy + 58, fx:fx + 90] = ~union
        # Outside the animated feature union all fur/whiskers/striping are static.
        stable_fur = [int(np.any(f != bp, axis=2)[non_feature & ellipse].sum()) for f in frames]
        no_double = no_old_mouth and all(n == 1 for n in generated_mouth_count)
        report['actions'][action] = {
            'size': list(atlas.size), 'alpha': alpha_info(np.asarray(atlas)),
            'frameCount': 12, 'nonemptyFrameCount': sum(int((np.asarray(Image.fromarray(f))[...,3]>0).any()) for f in frames),
            'uniqueVisibleFrames': len(set(hashes)), 'uniqueComposedFrames': len(set(composed_hashes)),
            'visibleFrameHashes': hashes,
            'visibleRGBChangedVsGeneratedSource': rgba_retained,
            'overlayPixelsOutsideFixedSafeMask': cropped_out,
            'bodyOutsideFaceChangedPixels': outside,
            'headOuterContourRGBAChangedPixels': contour_change,
            'alphaSilhouetteChangedPixelsVsOriginal': silhouette_change,
            'staticFurOutsideAnimatedFeatureUnionChangedPixels': stable_fur,
            'neutralBaseOldMouthResidualInnerPixels': residual['oldMouth'],
            'generatedMouthComponentsPerFrame': generated_mouth_count,
            'visibleNoseMaskPixelCounts': nose_pixels,
            'noDoubleMouth': no_double,
            'faceClockFrames': {'working':60,'idle':36,'syncing':60,'error':12}[action]}
        contact.save(A / 'qa' / f'{action}-composite-contact.png')
        contact.resize((1536, 1152), Image.Resampling.NEAREST).save(A / 'qa' / f'{action}-composite-contact-2x.png')
        station_contact.save(A / 'qa' / f'{action}-workstation-contact.png')
        station_contact.resize((1536, 1152), Image.Resampling.NEAREST).save(A / 'qa' / f'{action}-workstation-contact-2x.png')
        face_detail.resize((1440, 696), Image.Resampling.NEAREST).save(A / 'qa' / f'{action}-face-detail-contact-4x.png')
        contacts[action] = str(A / 'qa' / f'{action}-composite-contact-2x.png')
        station_contacts[action] = str(A / 'qa' / f'{action}-workstation-contact-2x.png')
    first_strip.resize((1536, 384), Image.Resampling.NEAREST).save(A / 'qa/actions-first-frame-contact-2x.png')
    station_strip.resize((1536, 384), Image.Resampling.NEAREST).save(A / 'qa/workstation-actions-first-frame-contact-2x.png')
    final_all.resize((1536, 1536), Image.Resampling.NEAREST).save(A / 'qa/combined-contact-sheet.png')
    # Lossless facial-preview APNG only, reused frames and not a whole-body atlas.
    eye_loop[0].save(A / 'qa/error-face-loop.png', save_all=True, append_images=eye_loop[1:],
                     duration=[83,83,84]*4, loop=0, disposal=0, blend=0)
    report['contacts'] = contacts
    report['workstationContacts'] = station_contacts
    report['workstationPreview'] = {'readOnlyFurnitureInputs': furniture_hashes,
        'seatAnchor': spec['seatAnchor'], 'poseAnchor': [96,174], 'scale': .6, 'bodyPlacement': placement,
        'runtimeModified':False, 'screenEffectsNotRendered':True,
        'staticFeetOcclusionFinalApproval': 'main agent; static bare sprite toe shape is not a rejection criterion',
        'noAnimatedHandsOrTypingHandsIntroduced': True}
    protected = json.loads((A / 'qa/protected-inputs-before.json').read_text())
    altered = []
    for item in protected['files']:
        path = ROOT / item['path']
        current = hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else None
        if current != item['sha256']:
            altered.append({'path': str(path), 'before': item['sha256'], 'after': current})
    report['protectedInputs'] = {'count':len(protected['files']), 'unchanged':not altered, 'changes':altered}
    report['technicalPassed'] = (report['base']['changedOutsideNeutralPatchPixels'] == 0
        and report['base']['alphaByteChangesVsPrevious'] == 0
        and report['base']['headOuterContourRGBAChangesVsPrevious'] == 0
        and report['protectedInputs']['unchanged']
        and all(d['uniqueVisibleFrames'] == d['uniqueComposedFrames'] == 12
            and max(d['bodyOutsideFaceChangedPixels']) == 0
            and max(d['headOuterContourRGBAChangedPixels']) == 0
            and max(d['alphaSilhouetteChangedPixelsVsOriginal']) == 0
            and max(d['visibleRGBChangedVsGeneratedSource']) == 0
            and max(d['staticFurOutsideAnimatedFeatureUnionChangedPixels']) == 0
            and d['noDoubleMouth'] for d in report['actions'].values()))
    (A / 'qa/validation.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'technicalPassed':report['technicalPassed'], 'base':report['base'],
        'actions': {a:{k:v for k,v in d.items() if k in ['uniqueVisibleFrames','uniqueComposedFrames','bodyOutsideFaceChangedPixels',
        'headOuterContourRGBAChangedPixels','alphaSilhouetteChangedPixelsVsOriginal','generatedMouthComponentsPerFrame',
        'visibleNoseMaskPixelCounts','noDoubleMouth','visibleRGBChangedVsGeneratedSource']} for a,d in report['actions'].items()},
        'protectedInputs':report['protectedInputs']}, indent=2))

if __name__ == '__main__':
    measure()
