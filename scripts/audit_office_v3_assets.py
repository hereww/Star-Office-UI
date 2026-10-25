#!/usr/bin/env python3
"""Independent, offline, read-only office-v3 asset audit (stdlib + Pillow).

Default outputs are ONLY:
  assets/company-office-reference-v3/integration-qa/asset-audit.json
  assets/company-office-reference-v3/integration-qa/asset-audit.md
Never writes images, manifests, assets.json, runtime, approvals or a cache.
No build/repair helper or prior QA result is imported as an acceptance oracle.

Usage (the bundled Python has Pillow):
  /Users/hepingyu/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 scripts/audit_office_v3_assets.py
  ... scripts/audit_office_v3_assets.py --no-write
  ... scripts/audit_office_v3_assets.py --self-test

Exit 0: static asset checks passed (warnings may remain); exit 1: failure.
A missing/unselected target in assets.json falls back to the requested manifest,
with an explicit runtime-selection warning, never an implied integration pass.
"""
from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime
from fractions import Fraction
import hashlib
import io
import json
import math
from pathlib import Path
import sys
from typing import Any

try:
    import PIL
    from PIL import Image, ImageChops
except ImportError:
    print('Pillow is required; use the bundled Python documented in this script.', file=sys.stderr)
    raise SystemExit(1)

ROOT = Path(__file__).resolve().parents[1]
REF = ROOT / 'frontend/company-office/reference-v3'
REPORT_DIR = ROOT / 'assets/company-office-reference-v3/integration-qa'
OUTPUT_JSON = REPORT_DIR / 'asset-audit.json'
OUTPUT_MD = REPORT_DIR / 'asset-audit.md'
ACTIONS = ('working', 'idle', 'syncing', 'error')
CLOCKS = {'working': 60, 'idle': 36, 'syncing': 60, 'error': 12}
DIRS = ('down', 'up', 'left', 'right')
TARGET_MANIFESTS = {
    'up': 'media/character-up/manifest.json',
    'left': 'media/character-left/repair-v2/manifest.json',
    'right': 'media/character-right/repair-v4-aligned/manifest.json',
}
FROZEN_RELATIVE_FILES = {
    'base': 'media/character-base.png',
    'working': 'media/face-working.png',
    'idle': 'media/face-idle-sleep.png',
    'syncing': 'media/face-syncing.png',
    'error': 'media/face-error-dizzy.png',
}
BOUNDARIES = [
    'Static offline asset audit, not browser/runtime/API/UI acceptance; no screenshots or image regeneration.',
    'It verifies RGBA, dimensions, source alpha statistics, grid/cell content, frozen hashes and deterministic clipped compositions. It cannot prove semantic direction, natural spiral motion, fur aesthetics or sleeping-mouth readability.',
    'Furniture pixel layers are hash-checked and held fixed. Dynamic screen/LED effects are intentionally not rendered; final monitor/hand/paw occlusion needs integration visual QA.',
    'The approved down originals are immutable. Any opaque/near-opaque alpha cells are reported as historical frozen-template limitations, not silently relabelled as genuinely transparent or repaired.',
    'A manifest fallback validates the requested asset pack only. An unselected/missing runtime configuration is reported separately and does not become an integration approval.',
    'Pixel-centre ellipse clipping and nearest-neighbour offline placement are used. Browser subpixel/ellipse antialiasing and map zoom are outside this pixel audit.',
    'Only the two report files are written. All humanApproved/visualApproved fields are observed, never modified; a technical pass grants no new human approval.',
]


def sha_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def numeric_tuple(value: Any, length: int) -> bool:
    return (isinstance(value, (list, tuple)) and len(value) == length and
            all(isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) for v in value))


def canonical_rgba_hash(image: Image.Image) -> str:
    """Ignore invisible RGB so meaningless transparent bytes cannot fake frames."""
    rgba = image.convert('RGBA')
    occupied = rgba.getchannel('A').point(lambda value: 255 if value else 0)
    clean = Image.new('RGBA', rgba.size)
    clean.paste(rgba, (0, 0), occupied)
    return sha_bytes(clean.tobytes())


def alpha_statistics(image: Image.Image) -> dict[str, Any]:
    alpha = image.convert('RGBA').getchannel('A')
    histogram = alpha.histogram()
    count = image.width * image.height
    low, high = alpha.getextrema()
    return {
        'minimum': low, 'maximum': high, 'transparentPixels': histogram[0],
        'partialAlphaPixels': sum(histogram[1:255]), 'opaquePixels': histogram[255],
        'transparentFraction': round(histogram[0] / count, 6),
        'nonzeroPixels': count - histogram[0],
        'genuineTransparency': low == 0 and high >= 128,
    }


def geometry_masks(character: dict[str, Any]) -> tuple[Image.Image, Image.Image]:
    """Independent half-open rect and mathematical pixel-centre ellipse masks."""
    w, h = character['frameSize']
    rect = Image.new('L', (w, h))
    ellipse = Image.new('L', (w, h))
    if character.get('faceVisible', True) is False:
        return rect, ellipse
    x, y, fw, fh = character['faceRect']
    cx, cy, rx, ry = character['faceClipEllipse']
    rect.putdata([255 if x <= px < x + fw and y <= py < y + fh else 0
                  for py in range(h) for px in range(w)])
    ellipse.putdata([255 if ((px + .5 - cx) / rx) ** 2 + ((py + .5 - cy) / ry) ** 2 <= 1 else 0
                     for py in range(h) for px in range(w)])
    return rect, ellipse


def changed_pixels(a: Image.Image, b: Image.Image, allowed: Image.Image | None = None) -> int:
    if a.size != b.size:
        raise ValueError(f'difference size mismatch {a.size} vs {b.size}')
    bands = ImageChops.difference(a.convert('RGBA'), b.convert('RGBA')).split()
    delta = bands[0]
    for band in bands[1:]:
        delta = ImageChops.lighter(delta, band)
    nonzero = delta.point(lambda value: 255 if value else 0)
    if allowed is not None:
        nonzero = ImageChops.multiply(nonzero, ImageChops.invert(allowed))
    return nonzero.histogram()[255]


def clipped_actor(base: Image.Image, face: Image.Image | None,
                  character: dict[str, Any], ellipse: Image.Image) -> Image.Image:
    if face is None:
        return base.copy()
    x, y, w, h = character['faceRect']
    local = face.convert('RGBA').resize((w, h), Image.Resampling.NEAREST)
    layer = Image.new('RGBA', base.size)
    # Paste without a mask copies source RGBA exactly; multiply alpha once.
    layer.paste(local, (x, y))
    layer.putalpha(ImageChops.multiply(layer.getchannel('A'), ellipse))
    return Image.alpha_composite(base, layer)


def station_geometry(character: dict[str, Any], furniture: dict[str, Any]) -> dict[str, Any]:
    scale = Fraction(str(character['scale'])).limit_denominator(1000)
    px, py = (Fraction(str(v)).limit_denominator(1000) for v in character['poseAnchor'])
    sx, sy = (Fraction(str(v)).limit_denominator(1000) for v in furniture['seatAnchor'])
    x, y = sx - px * scale, sy - py * scale
    width, height = 192 * scale, 192 * scale
    factor = math.lcm(*(v.denominator for v in (x, y, width, height)))
    if factor > 10:
        raise ValueError(f'offline exact-coordinate renderer needs unsupported factor {factor}; no silent rounding')
    return {'placement': [float(v) for v in (x, y, width, height)], 'factor': factor,
            'origin': [int(x * factor), int(y * factor)],
            'actorSize': [int(width * factor), int(height * factor)]}


def compose_station(actor: Image.Image, back: Image.Image, front: Image.Image,
                    furniture: dict[str, Any], geometry: dict[str, Any]) -> Image.Image:
    factor = geometry['factor']
    size = (192 * factor, 192 * factor)
    layers = {'back': back.resize(size, Image.Resampling.NEAREST),
              'front': front.resize(size, Image.Resampling.NEAREST)}
    layer = Image.new('RGBA', size)
    layer.paste(actor.resize(tuple(geometry['actorSize']), Image.Resampling.NEAREST), tuple(geometry['origin']))
    layers['actor'] = layer
    result = Image.new('RGBA', size)
    for token in furniture['order']:
        if token != 'screen':  # Dynamic effects belong to the integration test.
            result = Image.alpha_composite(result, layers[token])
    return result


def station_allowed_mask(ellipse: Image.Image, geometry: dict[str, Any]) -> Image.Image:
    factor = geometry['factor']
    result = Image.new('L', (192 * factor, 192 * factor))
    result.paste(ellipse.resize(tuple(geometry['actorSize']), Image.Resampling.NEAREST), tuple(geometry['origin']))
    return result


class Audit:
    def __init__(self) -> None:
        self.checks: list[dict[str, Any]] = []
        self.inputs: dict[str, dict[str, Any]] = {}
        self.approvals: list[dict[str, Any]] = []
        self.directions: dict[str, Any] = {}
        self.runtime_config: dict[str, Any] | None = None
        self.runtime_selection: dict[str, Any] = {}
        self.template: dict[str, Any] = {}
        self.template_dir: Path | None = None
        self.frozen: dict[str, Any] = {}

    def check(self, name: str, passed: bool, *, detail: Any = None,
              expected: Any = None, warning: bool = False) -> bool:
        self.checks.append({'id': name, 'status': 'pass' if passed else ('warning' if warning else 'fail'),
                            'expected': expected, 'detail': detail})
        return passed

    def observe(self, path: Path, role: str) -> bytes:
        path = path.resolve()
        if not path.is_relative_to(ROOT):
            raise ValueError(f'input path escapes repository: {path}')
        data = path.read_bytes()
        key = str(path)
        if key not in self.inputs:
            self.inputs[key] = {'path': key, 'sha256Before': sha_bytes(data), 'bytes': len(data), 'roles': [role]}
        else:
            if role not in self.inputs[key]['roles']:
                self.inputs[key]['roles'].append(role)
            if self.inputs[key]['sha256Before'] != sha_bytes(data):
                self.check(f'input_snapshot.{path.name}', False, detail='Input changed between reads; rerun after build settles.')
        return data

    def read_json(self, path: Path, role: str) -> dict[str, Any]:
        value = json.loads(self.observe(path, role))
        if not isinstance(value, dict):
            raise ValueError(f'JSON root is not an object: {path}')
        self.approvals.append({'path': str(path.resolve()),
                               'humanApproved': value.get('humanApproved', 'absent'),
                               'visualApproved': value.get('visualApproved', 'absent')})
        return value

    def resolve_url(self, url: Any) -> Path:
        if not isinstance(url, str) or not url or '://' in url or '?' in url or '#' in url:
            raise ValueError(f'Expected a repository-local relative asset URL, got {url!r}')
        p = (REF / url).resolve()
        if not p.is_relative_to(ROOT):
            raise ValueError(f'asset URL escapes repository: {url!r}')
        return p

    def image(self, url: str, role: str, size: tuple[int, int], *, require_transparency: bool) -> tuple[Image.Image, dict[str, Any]]:
        path = self.resolve_url(url)
        data = self.observe(path, role)
        with Image.open(io.BytesIO(data)) as im:
            im.load()
            stats = {'url': url, 'path': str(path), 'sha256': sha_bytes(data), 'bytes': len(data),
                     'format': im.format, 'mode': im.mode, 'size': list(im.size),
                     'pngFrameCount': getattr(im, 'n_frames', 1), 'alpha': alpha_statistics(im)}
            rgba = im.convert('RGBA').copy()
        self.check(f'{role}.png_rgba', stats['format'] == 'PNG' and stats['mode'] == 'RGBA', detail=stats, expected='PNG with actual RGBA mode')
        self.check(f'{role}.size', stats['size'] == list(size), detail=stats['size'], expected=list(size))
        self.check(f'{role}.one_static_png', stats['pngFrameCount'] == 1, detail=stats['pngFrameCount'], expected=1)
        self.check(f'{role}.nonempty_alpha', stats['alpha']['nonzeroPixels'] > 0 and stats['alpha']['maximum'] >= 128,
                   detail=stats['alpha'], expected='Contains nonempty visible artwork')
        if require_transparency:
            self.check(f'{role}.genuine_alpha', stats['alpha']['genuineTransparency'], detail=stats['alpha'], expected='alpha min=0, max>=128; not baked checkerboard/opaque field')
        if rgba.size != size:
            raise ValueError(f'{role} wrong dimensions; refuse synthetic resizing to hide a spec failure')
        return rgba, stats

    def frozen_template(self) -> dict[str, Any]:
        candidate = ROOT / '.agents/skills/star-office-character-animation/assets/approved-office-expressions-v1'
        # Follow actual sourceTemplate if present; otherwise use the known frozen package.
        if self.runtime_config and self.runtime_config.get('sourceTemplate'):
            candidate = (ROOT / self.runtime_config['sourceTemplate']).resolve()
        self.template_dir = candidate
        self.template = self.read_json(candidate / 'template-manifest.json', 'frozen-template-manifest')
        entries = self.template.get('files', [])
        self.check('frozen.template_has_inventory', bool(entries), detail=len(entries), expected='Recorded immutable SHA256 entries')
        by_name = {entry['path']: entry for entry in entries}
        records = []
        for entry in entries:
            path = (candidate / entry['path']).resolve()
            if not path.is_relative_to(candidate):
                raise ValueError(f'frozen inventory escapes template: {entry["path"]}')
            data = self.observe(path, 'frozen-inventory')
            digest = sha_bytes(data)
            matched = digest == entry['sha256'] and len(data) == entry.get('bytes', len(data))
            self.check(f'frozen.file.{entry["path"]}', matched, detail={'path': str(path), 'actualSha256': digest}, expected=entry['sha256'])
            records.append({'path': str(path), 'expectedSha256': entry['sha256'], 'actualSha256': digest, 'matches': matched})
        self.frozen = {'templateDirectory': str(candidate), 'inventoryCount': len(entries), 'allInventoryHashesMatch': all(v['matches'] for v in records), 'inventory': records, 'runtimeDownBindings': []}
        return by_name

    def bind_down(self, character: dict[str, Any], inventory: dict[str, Any], actual_runtime: bool) -> None:
        urls = {'base': character['base'], **{key: character['actions'][key]['face'] for key in ACTIONS}}
        for kind, frozen_relative in FROZEN_RELATIVE_FILES.items():
            entry = inventory[frozen_relative]
            path = self.resolve_url(urls[kind])
            digest = sha_bytes(self.observe(path, f'down-frozen-binding:{kind}'))
            ok = digest == entry['sha256']
            self.check(f'down.frozen_sha256.{kind}', ok, detail={'url': urls[kind], 'actualSha256': digest}, expected=entry['sha256'])
            self.frozen['runtimeDownBindings'].append({'kind': kind, 'runtimeUrl': urls[kind], 'runtimePath': str(path),
                                                      'frozenRelativePath': frozen_relative, 'expectedSha256': entry['sha256'],
                                                      'runtimeSha256': digest, 'matches': ok, 'actualConfigObserved': actual_runtime})
        self.frozen['down5HashesMatch'] = all(v['matches'] for v in self.frozen['runtimeDownBindings'])
        self.frozen['runtimeDownConfigObserved'] = actual_runtime
        self.frozen['runtimeDownVerified'] = actual_runtime and self.frozen['down5HashesMatch']

    @staticmethod
    def asset_binding(character: dict[str, Any]) -> dict[str, Any]:
        return {'base': character.get('base'), 'actions': {k: character.get('actions', {}).get(k, {}).get('face') for k in ACTIONS}}

    def validate_character(self, direction: str, character: dict[str, Any]) -> None:
        self.check(f'{direction}.direction', character.get('direction') == direction, detail=character.get('direction'), expected=direction)
        self.check(f'{direction}.canvas', character.get('frameSize') == [192, 192], detail=character.get('frameSize'), expected=[192, 192])
        if character.get('frameSize') != [192, 192]:
            raise ValueError('Invalid canvas size; no silent correction')
        for key in ('poseAnchor', 'headAnchor'):
            good = numeric_tuple(character.get(key), 2) and all(0 <= v <= 192 for v in character[key])
            self.check(f'{direction}.{key}', good, detail=character.get(key), expected='Fixed finite 2D anchor inside logical canvas')
            if not good:
                raise ValueError(f'Invalid {key}')
        self.check(f'{direction}.scale', character.get('scale') == .6, detail=character.get('scale'), expected=.6)
        if not isinstance(character.get('scale'), (int, float)) or character['scale'] <= 0:
            raise ValueError('Invalid scale')
        self.check(f'{direction}.four_actions', set(character.get('actions', {})) == set(ACTIONS), detail=list(character.get('actions', {})), expected=list(ACTIONS))
        for action in ACTIONS:
            entry = character.get('actions', {}).get(action, {})
            self.check(f'{direction}.{action}.clock', entry.get('faceClockFrames') == CLOCKS[action], detail=entry.get('faceClockFrames'), expected=CLOCKS[action])
        visible = character.get('faceVisible', True)
        if direction == 'up':
            face_refs = {k: v.get('face') for k, v in character.get('actions', {}).items() if v.get('face') is not None}
            loose_files = sorted(str(p) for p in (REF / 'media/character-up').rglob('face*.png'))
            self.check('up.no_face_resources', visible is False and not face_refs and not loose_files,
                       detail={'faceVisible': visible, 'actionFaceReferences': face_refs, 'facePNGFiles': loose_files}, expected='faceVisible:false and zero face-resource URLs/PNGs')
            if visible is not False:
                raise ValueError('up must be faceVisible:false')
            return
        self.check(f'{direction}.face_visible', visible is True, detail=visible, expected=True)
        self.check(f'{direction}.face_frame_size', character.get('faceFrameSize') == [90, 58], detail=character.get('faceFrameSize'), expected=[90, 58])
        rect, ellipse = character.get('faceRect'), character.get('faceClipEllipse')
        valid = (numeric_tuple(rect, 4) and all(isinstance(v, int) and not isinstance(v, bool) for v in rect) and
                 rect[2:] == [90, 58] and rect[0] >= 0 and rect[1] >= 0 and rect[0] + rect[2] <= 192 and rect[1] + rect[3] <= 192)
        self.check(f'{direction}.fixed_face_rect', valid, detail=rect, expected='Fixed half-open 90x58 rectangle inside 192x192')
        ellipse_valid = (numeric_tuple(ellipse, 4) and ellipse[2] > 0 and ellipse[3] > 0 and
                         ellipse[0] - ellipse[2] >= 0 and ellipse[1] - ellipse[3] >= 0 and
                         ellipse[0] + ellipse[2] <= 192 and ellipse[1] + ellipse[3] <= 192)
        self.check(f'{direction}.fixed_face_ellipse', ellipse_valid, detail=ellipse, expected='Positive fixed ellipse entirely inside canvas')
        if not valid or not ellipse_valid:
            raise ValueError('Invalid face geometry')

    def validate_furniture(self, direction: str, furniture: dict[str, Any], declared: dict[str, Any]) -> tuple[Image.Image, Image.Image, dict[str, Any]]:
        self.check(f'{direction}.furniture.canvas', furniture.get('size') == [192, 192], detail=furniture.get('size'), expected=[192, 192])
        self.check(f'{direction}.furniture.anchor', numeric_tuple(furniture.get('seatAnchor'), 2), detail=furniture.get('seatAnchor'), expected='Fixed finite seatAnchor')
        self.check(f'{direction}.furniture.order', len(furniture.get('order', [])) == 4 and set(furniture.get('order', [])) == {'back', 'actor', 'front', 'screen'}, detail=furniture.get('order'), expected='Exactly back/actor/front/screen once each')
        self.check(f'{direction}.furniture.manifest_config', furniture == declared['furniture'], detail=furniture, expected=declared['furniture'])
        images, stats = {}, {}
        for kind in ('back', 'front'):
            images[kind], stats[kind] = self.image(furniture[kind], f'{direction}.furniture.{kind}', (192, 192), require_transparency=True)
            expected = declared.get('sha256', {}).get(kind)
            self.check(f'{direction}.furniture.{kind}.declared_sha256', expected is not None and stats[kind]['sha256'] == expected, detail=stats[kind]['sha256'], expected=expected)
        full, stats['full'] = self.image(declared['normalized'], f'{direction}.furniture.full', (192, 192), require_transparency=True)
        expected_full = declared.get('sha256', {}).get('full')
        self.check(f'{direction}.furniture.full.declared_sha256', expected_full is not None and stats['full']['sha256'] == expected_full, detail=stats['full']['sha256'], expected=expected_full)
        rebuilt = Image.alpha_composite(images['back'], images['front'])
        split_delta = changed_pixels(rebuilt, full)
        # Transparent RGB is not meaningful for layer reconstruction, but record raw difference separately.
        semantic_match = canonical_rgba_hash(rebuilt) == canonical_rgba_hash(full)
        self.check(f'{direction}.furniture.layers_reconstruct_full', semantic_match, detail={'rawRGBAChangedPixels': split_delta, 'visibleRGBAHashMatches': semantic_match}, expected='Complementary static layers reconstruct normalized artwork')
        stats['rawLayerReconstructionDelta'] = split_delta
        stats['visibleLayerReconstructionMatches'] = semantic_match
        stats['layerImageHashesBeforeSamples'] = {k: canonical_rgba_hash(v) for k, v in images.items()}
        return images['back'], images['front'], stats

    def audit_direction(self, direction: str, character: dict[str, Any], manifest: dict[str, Any],
                        furniture: dict[str, Any], furniture_declared: dict[str, Any], source: str) -> None:
        self.validate_character(direction, character)
        for key, expected in (('fps', 12), ('frameCount', 12), ('grid', [4, 3])):
            if key in manifest:
                self.check(f'{direction}.manifest.{key}', manifest[key] == expected, detail=manifest[key], expected=expected)
        base, base_stats = self.image(character['base'], f'{direction}.base', (192, 192), require_transparency=True)
        back, front, furniture_stats = self.validate_furniture(direction, furniture, furniture_declared)
        geometry = station_geometry(character, furniture)
        rect_mask, ellipse = geometry_masks(character)
        station_allowed = station_allowed_mask(ellipse, geometry)
        base_station = compose_station(base, back, front, furniture, geometry)
        report: dict[str, Any] = {'configSource': source, 'character': character, 'furnitureConfig': furniture,
                                  'base': base_stats, 'furniture': furniture_stats, 'stationGeometry': geometry,
                                  'faceVisible': character.get('faceVisible', True), 'actions': {}}
        first_actor = None
        first_station = None
        for action in ACTIONS:
            frames, frame_stats, raw_hashes = [], [], []
            atlas_stats = None
            if direction != 'up':
                face_url = character['actions'][action]['face']
                atlas, atlas_stats = self.image(face_url, f'{direction}.{action}.atlas', (360, 174), require_transparency=direction != 'down')
                for index in range(12):
                    x, y = index % 4 * 90, index // 4 * 58
                    cell = atlas.crop((x, y, x + 90, y + 58))
                    frames.append(cell)
                    frame_stats.append(alpha_statistics(cell))
                    raw_hashes.append(canonical_rgba_hash(cell))
                self.check(f'{direction}.{action}.twelve_nonempty_cells', len(frames) == 12 and all(s['nonzeroPixels'] > 0 and s['maximum'] >= 128 for s in frame_stats), detail=frame_stats, expected='12 nonempty 90x58 row-major cells')
                self.check(f'{direction}.{action}.twelve_distinct_visible_cells', len(set(raw_hashes)) == 12, detail=len(set(raw_hashes)), expected=12)
                transparent = all(s['genuineTransparency'] for s in frame_stats)
                self.check(f'{direction}.{action}.cell_alpha', transparent,
                           detail={'perFrame': frame_stats, 'note': 'Frozen down alpha is preserved, not repaired.' if direction == 'down' else 'Independent side-frame transparency check'},
                           expected='Every cell has true alpha=0 outside visible artwork', warning=direction == 'down')
            else:
                frames = [None] * 12  # Clock sampling only, not invented face frames.
            actors, stations, measurements = [], [], []
            action_actor0, action_station0 = None, None
            for index, cell in enumerate(frames):
                actor = clipped_actor(base, cell, character, ellipse)
                station = compose_station(actor, back, front, furniture, geometry)
                if action_actor0 is None:
                    action_actor0, action_station0 = actor, station
                if first_actor is None:
                    first_actor, first_station = actor, station
                measurement = {
                    'frameOrClockSample': index,
                    'bodyOutsideFaceRectVsBase': changed_pixels(actor, base, rect_mask),
                    'bodyOutsideEllipseVsBase': changed_pixels(actor, base, ellipse),
                    'bodyOutsideEllipseVsActionFrame0': changed_pixels(actor, action_actor0, ellipse),
                    'bodyOutsideEllipseVsFirstStateFrame0': changed_pixels(actor, first_actor, ellipse),
                    'workstationOutsidePlacedFaceVsBase': changed_pixels(station, base_station, station_allowed),
                    'workstationOutsidePlacedFaceVsActionFrame0': changed_pixels(station, action_station0, station_allowed),
                    'workstationOutsidePlacedFaceVsFirstStateFrame0': changed_pixels(station, first_station, station_allowed),
                }
                measurements.append(measurement)
                actors.append(canonical_rgba_hash(actor))
                stations.append(canonical_rgba_hash(station))
            maxima = {key: max(v[key] for v in measurements) for key in measurements[0] if key != 'frameOrClockSample'}
            self.check(f'{direction}.{action}.fixed_body_and_furniture', all(v == 0 for v in maxima.values()), detail=maxima, expected='Zero changed pixels outside the fixed face allowance across all frames and states')
            if direction != 'up':
                self.check(f'{direction}.{action}.twelve_distinct_clipped_actors', len(set(actors)) == 12, detail=len(set(actors)), expected=12)
            else:
                self.check(f'up.{action}.static_no_face_actor', len(set(actors)) == 1 and len(set(stations)) == 1, detail={'actorHashes': len(set(actors)), 'stationHashes': len(set(stations))}, expected='One static actor/workstation over 12 clock samples')
            report['actions'][action] = {
                'clockFrames': character['actions'][action].get('faceClockFrames'),
                'expectedClockFrames': CLOCKS[action], 'atlas': atlas_stats,
                'actualFaceAtlasFrameCount': 0 if direction == 'up' else len(frames),
                'clockSamplesChecked': 12, 'grid': None if direction == 'up' else [4, 3],
                'cellSize': None if direction == 'up' else [90, 58],
                'sourceVisibleFrameHashes': raw_hashes, 'uniqueSourceVisibleFrames': len(set(raw_hashes)),
                'uniqueClippedActorFrames': len(set(actors)), 'uniqueComposedStationFrames': len(set(stations)),
                'perFrameAlpha': frame_stats, 'invariantMaxima': maxima, 'frames': measurements,
            }
        report['furniture']['layerImageHashesAfterSamples'] = {'back': canonical_rgba_hash(back), 'front': canonical_rgba_hash(front)}
        unchanged = report['furniture']['layerImageHashesBeforeSamples'] == report['furniture']['layerImageHashesAfterSamples']
        self.check(f'{direction}.furniture.unchanged_during_sampling', unchanged, detail=report['furniture']['layerImageHashesAfterSamples'], expected='Original back/front pixels unchanged during all 48 samples')
        # Validate any recorded side output hashes, rather than trusting prior technicalPassed.
        for entry in manifest.get('files', []):
            if 'url' in entry and 'sha256' in entry:
                actual = sha_bytes(self.observe(self.resolve_url(entry['url']), f'{direction}:manifest-output-sha'))
                self.check(f'{direction}.manifest_output_sha.{entry["url"]}', actual == entry['sha256'], detail=actual, expected=entry['sha256'])
        self.directions[direction] = report

    def run(self) -> dict[str, Any]:
        cfg_path = REF / 'assets.json'
        if cfg_path.is_file():
            self.runtime_config = self.read_json(cfg_path, 'runtime-assets-config')
            for key, expected in (('fps', 12), ('frameCount', 12), ('grid', [4, 3]), ('animationMode', 'expression-only')):
                self.check(f'runtime.global.{key}', self.runtime_config.get(key) == expected, detail=self.runtime_config.get(key), expected=expected)
        else:
            self.check('runtime.assets_json_available', False, warning=True, detail=str(cfg_path), expected='Current assets.json; manifest fallback will be used')
        inventory = self.frozen_template()
        manifests = {d: self.read_json(REF / rel, f'target-{d}-manifest') for d, rel in TARGET_MANIFESTS.items()}
        furniture_manifest = self.read_json(REF / 'media/furniture/manifest.json', 'furniture-manifest')
        fallback_down = {
            'id': 'orange-cat-frozen-seated', 'direction': 'down', 'base': '../media/character-base.png',
            'frameSize': [192, 192], 'poseAnchor': self.template['poseAnchor'], 'scale': self.template['scale'],
            'faceRect': self.template['faceRect'], 'faceClipEllipse': self.template['faceClipEllipse'],
            'faceFrameSize': [90, 58], 'headAnchor': [100, 30], 'faceVisible': True,
            'actions': {k: {'face': '../' + v, 'faceClockFrames': CLOCKS[k]} for k, v in FROZEN_RELATIVE_FILES.items() if k != 'base'},
        }
        actual_dirs = self.runtime_config.get('directions', {}) if self.runtime_config else {}
        for direction in DIRS:
            try:
                actual = actual_dirs.get(direction, {})
                expected = fallback_down if direction == 'down' else manifests[direction]['character']
                current = actual.get('character')
                selected = current is not None and (direction == 'down' or self.asset_binding(current) == self.asset_binding(expected))
                self.runtime_selection[direction] = {'target': 'approved-office-expressions-v1' if direction == 'down' else TARGET_MANIFESTS[direction],
                                                     'selectedInAssetsJson': selected,
                                                     'runtimeBindings': self.asset_binding(current) if current else None,
                                                     'manifestBindings': self.asset_binding(expected),
                                                     'configSource': 'assets.json' if selected else 'manifest_fallback'}
                self.check(f'runtime.{direction}.target_selected', selected, warning=True,
                           detail=self.runtime_selection[direction], expected='Current assets.json references the requested target package')
                character = current if selected else expected
                manifest = self.template if direction == 'down' else manifests[direction]
                furniture_declared = furniture_manifest['directions'][direction]
                furniture = actual.get('furniture') if selected else furniture_declared['furniture']
                if not furniture:
                    raise ValueError('Selected runtime direction has no furniture config')
                if selected and direction != 'down':
                    differences = {key: {'runtime': character.get(key), 'manifest': expected.get(key)}
                                   for key in ('direction', 'base', 'frameSize', 'poseAnchor', 'scale', 'faceRect', 'faceClipEllipse', 'faceFrameSize', 'faceVisible')
                                   if character.get(key) != expected.get(key)}
                    self.check(f'runtime.{direction}.asset_geometry_matches_manifest', not differences, detail=differences, expected='Same fixed character geometry; headAnchor may be an integration override')
                    if character.get('headAnchor') != expected.get('headAnchor'):
                        self.runtime_selection[direction]['headAnchorIntegrationOverride'] = {'runtime': character.get('headAnchor'), 'manifest': expected.get('headAnchor'), 'modifiedByAudit': False}
                if direction == 'down':
                    self.bind_down(character, inventory, selected)
                    for key in ('poseAnchor', 'scale', 'faceRect', 'faceClipEllipse'):
                        self.check(f'down.frozen_geometry.{key}', character.get(key) == self.template.get(key), detail=character.get(key), expected=self.template.get(key))
                self.audit_direction(direction, character, manifest, furniture, furniture_declared,
                                     self.runtime_selection[direction]['configSource'])
            except (OSError, ValueError, KeyError, TypeError) as error:
                self.check(f'{direction}.audit_exception', False, detail=f'{type(error).__name__}: {error}')
                self.directions.setdefault(direction, {'error': f'{type(error).__name__}: {error}'})
        # Top-level down is an active alias too; don't ignore a divergent original binding.
        if self.runtime_config and self.runtime_config.get('character') and actual_dirs.get('down', {}).get('character'):
            self.check('runtime.top_level_down_alias', self.asset_binding(self.runtime_config['character']) == self.asset_binding(actual_dirs['down']['character']),
                       detail=self.asset_binding(self.runtime_config['character']), expected=self.asset_binding(actual_dirs['down']['character']))
        for record in self.inputs.values():
            try:
                after = sha_bytes(Path(record['path']).read_bytes())
            except OSError:
                after = None
            record['sha256After'] = after
            record['unchangedDuringAudit'] = after == record['sha256Before']
        stable = all(v['unchangedDuringAudit'] for v in self.inputs.values())
        self.check('read_only.input_snapshot_unchanged', stable, detail=[v['path'] for v in self.inputs.values() if not v['unchangedDuringAudit']], expected='Every observed config/manifest/image/frozen file unchanged during this run')
        return self.report()

    def report(self) -> dict[str, Any]:
        counts = Counter(v['status'] for v in self.checks)
        passed = counts['fail'] == 0 and set(self.directions) == set(DIRS)
        sample_count = sum(v['actions'][a]['clockSamplesChecked'] for v in self.directions.values() if 'actions' in v for a in ACTIONS)
        atlas_count = sum(v['actions'][a]['actualFaceAtlasFrameCount'] for v in self.directions.values() if 'actions' in v for a in ACTIONS)
        return {
            'schemaVersion': 1, 'auditModule': 'independent-office-v3-static-assets',
            'checkedAtLocal': datetime.now().astimezone().isoformat(), 'root': str(ROOT),
            'passed': passed, 'status': 'passed_with_warnings' if passed and counts['warning'] else ('passed' if passed else 'failed'),
            'scope': 'Static assets and immutable down bindings only; no human/browser/runtime approval',
            'alphaPolicy': {'sideAtlasesAndBaseAndFurniture': 'Genuine source transparency is required.',
                            'frozenDownAtlases': 'Original alpha limitations are warnings only when immutable SHA256 checks also pass; never silently fixed or presented as transparent.',
                            'checkMeaning': 'Tests source alpha statistics, not perceptual background detection.'},
            'summary': {'passChecks': counts['pass'], 'failedChecks': counts['fail'], 'warnings': counts['warning'],
                        'directions': len(self.directions), 'actualFaceFramesChecked': atlas_count,
                        'actorAndWorkstationClockSamples': sample_count, 'observedReadOnlyInputCount': len(self.inputs)},
            'runtimeTargetsAllSelected': all(v['selectedInAssetsJson'] for v in self.runtime_selection.values()) and len(self.runtime_selection) == 4 and self.frozen.get('runtimeDownVerified', False),
            'runtimeSelection': self.runtime_selection, 'frozenApprovedDown': self.frozen,
            'directions': self.directions, 'checks': self.checks,
            'failures': [v for v in self.checks if v['status'] == 'fail'],
            'warnings': [v for v in self.checks if v['status'] == 'warning'],
            'readOnlyInputs': list(self.inputs.values()),
            'approvalFieldsObserved': self.approvals, 'humanApprovalModified': False,
            'materialsOrRuntimeOrConfigModified': False, 'boundaries': BOUNDARIES,
            'reportPaths': {'json': str(OUTPUT_JSON), 'markdown': str(OUTPUT_MD)},
            'execution': {'python': sys.executable, 'pythonVersion': sys.version.split()[0], 'pillowVersion': PIL.__version__},
        }


def markdown_report(report: dict[str, Any]) -> str:
    summary = report['summary']
    lines = ['# Office v3 independent asset audit', '',
             f'**Result: {report["status"]}** — {summary["passChecks"]} passed checks, {summary["failedChecks"]} failures, {summary["warnings"]} warnings.',
             '', 'This is an offline technical asset result, **not human approval**. No material/runtime/config/approval was changed.', '',
             '## Actual targets and read-only configuration', '',
             '| Direction | Source | Runtime target selected | Face atlases / samples | Body/station exterior max delta |',
             '|---|---|---|---|---|']
    for direction in DIRS:
        selection = report['runtimeSelection'].get(direction, {})
        entry = report['directions'].get(direction, {})
        if 'actions' not in entry:
            lines.append(f'| {direction} | unavailable | {selection.get("selectedInAssetsJson", False)} | ERROR | {entry.get("error", "incomplete")} |')
            continue
        actions = entry['actions']
        count = sum(v['actualFaceAtlasFrameCount'] for v in actions.values())
        maximum = max(value for v in actions.values() for value in v['invariantMaxima'].values())
        lines.append(f'| {direction} | {entry["configSource"]} | {selection.get("selectedInAssetsJson", False)} | {count} face frames / 48 clock samples | {maximum} pixels |')
    lines += ['', 'Base PNGs: 192x192 RGBA. Face atlases: 360x174 / 4x3 / 90x58, 12 source-visible and clipped-actor frames per action. Up has **zero face atlases**, sampled as a static back-facing asset, not cloned expression frames.',
              '', 'Working / idle / syncing / error clocks: 60 / 36 / 60 / 12 at configured 12fps.', '',
              f'Observed {summary["actualFaceFramesChecked"]} actual face frames; {summary["actorAndWorkstationClockSamples"]} fixed-coordinate actor/workstation samples.', '',
              '## Frozen approved original down: SHA256', '',
              f'Frozen inventory: {report["frozenApprovedDown"].get("inventoryCount", 0)} files; all recorded hashes match: {report["frozenApprovedDown"].get("allInventoryHashesMatch", False)}.',
              f'Actual runtime down configuration observed and all five PNGs match: {report["frozenApprovedDown"].get("runtimeDownVerified", False)}.', '',
              '| Asset | Runtime URL | Exact immutable SHA256 match |', '|---|---|---|']
    for v in report['frozenApprovedDown'].get('runtimeDownBindings', []):
        lines.append(f'| {v["kind"]} | `{v["runtimeUrl"]}` | {v["matches"]}: `{v["runtimeSha256"]}` |')
    lines += ['', '## Alpha facts and limitations', '',
              '| Direction/action | Raw atlas alpha min/max | Cells with genuine transparency | Distinct source / clipped actor |',
              '|---|---|---|---|']
    for direction, entry in report['directions'].items():
        for action, v in entry.get('actions', {}).items():
            if not v['atlas']:
                continue
            alpha = v['atlas']['alpha']
            genuine = sum(s['genuineTransparency'] for s in v['perFrameAlpha'])
            lines.append(f'| {direction}/{action} | {alpha["minimum"]}/{alpha["maximum"]} | {genuine}/12 | {v["uniqueSourceVisibleFrames"]}/{v["uniqueClippedActorFrames"]} |')
    lines += ['', '**An RGBA mode is not proof of transparent background.** Genuine source alpha is min=0 with visible artwork >=128; partial-alpha maximum 254 is valid and is not forced to 255.',
              'Frozen down working/syncing alpha limitations are disclosed below and their immutable bytes are verified. The runtime clips face overlays to the configured ellipse; this audit checks stable exterior body pixels, not an invented transparent re-export.', '',
              '## Static body and furniture', '',
              'Each action was composed with the exact fixed faceRect and pixel-centre ellipse, without per-frame alignment/rotation. Body pixels outside rect/ellipse were compared with the base, each action first frame, and the first state frame. Workstation pixels outside the placed face were compared likewise.',
              'Furniture back/front/full PNGs are checked against manifest SHA256; complementary layers reconstruct the full normalized asset; layer bytes remain fixed through all state samples. Screens/LED dynamics are excluded.', '',
              '## Integration headAnchor observations (no mutation)', '']
    for direction, selection in report['runtimeSelection'].items():
        if 'headAnchorIntegrationOverride' in selection:
            v = selection['headAnchorIntegrationOverride']
            lines.append(f'- {direction}: runtime {v["runtime"]}, source manifest {v["manifest"]}. Main integration override retained; do not copy old manifest anchors back into assets.json.')
    lines += ['', '## Failures', '']
    if not report['failures']:
        lines.append('- None in the audited static-asset contract.')
    for value in report['failures']:
        lines.append(f'- **{value["id"]}**: {json.dumps(value["detail"], ensure_ascii=False)}')
    lines += ['', '## Warnings / unverified selection', '']
    if not report['warnings']:
        lines.append('- None.')
    for value in report['warnings']:
        detail = value['detail']
        if isinstance(detail, dict) and 'perFrame' in detail:
            genuine = sum(v['genuineTransparency'] for v in detail['perFrame'])
            detail = {'genuinelyTransparentCells': f'{genuine}/12', 'perFrameAlphaRanges': [[v['minimum'], v['maximum']] for v in detail['perFrame']], 'note': detail.get('note')}
        lines.append(f'- **{value["id"]}**: {json.dumps(detail, ensure_ascii=False)}')
    lines += ['', '## Read-only and acceptance boundaries', '']
    lines.extend('- ' + boundary for boundary in report['boundaries'])
    lines += ['', f'All {summary["observedReadOnlyInputCount"]} observed inputs are hash-checked again at the end of the run; see JSON for before/after SHA256 and per-frame measurements.',
              '', '## Re-run', '', '```sh', f'{report["execution"]["python"]} {ROOT / "scripts/audit_office_v3_assets.py"}', '```',
              '', '`--no-write` runs the audit without saving reports; `--self-test` checks pure in-memory positive/negative cases without any file writes.', '',
              f'JSON: `{OUTPUT_JSON}`', f'Markdown: `{OUTPUT_MD}`', '']
    return '\n'.join(lines)


def self_test() -> dict[str, Any]:
    """In-memory regression tests only; never mutates a real asset to test errors."""
    results = []
    # Detect a genuine body change outside the permitted face; do not auto-pass.
    base = Image.new('RGBA', (192, 192), (100, 70, 20, 255))
    c = {'frameSize': [192, 192], 'faceVisible': True,
         'faceRect': [38, 64, 90, 58], 'faceClipEllipse': [76, 93, 32, 27]}
    rect, ellipse = geometry_masks(c)
    damaged = base.copy(); damaged.putpixel((0, 0), (1, 2, 3, 255))
    results.append(('detect_body_drift', changed_pixels(damaged, base, rect) == 1))
    # A mouth/eye colour change inside allowed geometry is not body drift.
    face = Image.new('RGBA', (90, 58)); face.putpixel((38, 29), (20, 0, 0, 254))
    actor = clipped_actor(base, face, c, ellipse)
    results.append(('keep_face_change_inside_allowance', changed_pixels(actor, base, ellipse) == 0 and changed_pixels(actor, base) == 1))
    results.append(('partial_alpha_254_is_valid', alpha_statistics(face)['genuineTransparency']))
    opaque = Image.new('RGBA', (90, 58), (255, 180, 90, 240))
    results.append(('opaque_rgba_is_not_transparent', not alpha_statistics(opaque)['genuineTransparency']))
    empty_rgb = Image.new('RGBA', (90, 58), (0, 0, 0, 0))
    hidden_noise = Image.new('RGBA', (90, 58), (120, 31, 10, 0))
    results.append(('invisible_rgb_cannot_fake_distinct_frames', canonical_rgba_hash(empty_rgb) == canonical_rgba_hash(hidden_noise)))
    results.append(('frozen_byte_change_detected', sha_bytes(b'approved') != sha_bytes(b'changed')))
    up_rect, up_ellipse = geometry_masks({'frameSize': [192, 192], 'faceVisible': False})
    results.append(('up_has_zero_face_allowance', not up_rect.getbbox() and not up_ellipse.getbbox()))
    furniture = {'seatAnchor': [131, 128], 'order': ['back', 'screen', 'actor', 'front']}
    g = station_geometry({'poseAnchor': [96, 174], 'scale': .6}, furniture)
    results.append(('exact_fractional_common_registration', g['factor'] == 5 and g['origin'] == [367, 118]))
    pixels = Image.new('RGBA', (192, 192))
    station = compose_station(base, pixels, pixels, furniture, g)
    moved = station.copy(); moved.putpixel((0, 0), (1, 2, 3, 255))
    results.append(('detect_station_drift_outside_face', changed_pixels(moved, station, station_allowed_mask(ellipse, g)) == 1))
    return {'passed': all(v for _, v in results), 'fileWrites': 0, 'cases': [{'name': name, 'passed': passed} for name, passed in results]}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--no-write', action='store_true', help='Read-only audit with no report writes')
    parser.add_argument('--self-test', action='store_true', help='Pure in-memory regression tests; no writes')
    args = parser.parse_args()
    if args.self_test:
        result = self_test(); print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0 if result['passed'] else 1
    regression = self_test()
    audit = Audit()
    try:
        report = audit.run()
    except (OSError, ValueError, KeyError, TypeError) as error:
        audit.check('audit.initialization_exception', False, detail=f'{type(error).__name__}: {error}')
        report = audit.report()
    report['inMemoryRegressionTests'] = regression
    if not regression['passed']:
        report['passed'] = False
        report['status'] = 'failed'
        report['failures'].append({'id': 'in_memory_regression', 'status': 'fail', 'detail': regression, 'expected': 'All in-memory checks pass'})
    if not args.no_write:
        REPORT_DIR.mkdir(parents=True, exist_ok=True)
        OUTPUT_JSON.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
        OUTPUT_MD.write_text(markdown_report(report))
    print(json.dumps({'status': report['status'], 'passed': report['passed'], **report['summary'],
                      'runtimeTargetsAllSelected': report['runtimeTargetsAllSelected'],
                      'downFrozenRuntimeFiveMatches': report['frozenApprovedDown'].get('runtimeDownVerified', False),
                      'failureIds': [v['id'] for v in report['failures']],
                      'warningCount': report['summary']['warnings'],
                      'warningIds': [v['id'] for v in report['warnings']],
                      'humanApprovalModified': False,
                      'inMemoryRegressionTestsPassed': regression['passed'],
                      'reportsWritten': [] if args.no_write else [str(OUTPUT_JSON), str(OUTPUT_MD)]}, ensure_ascii=False, indent=2))
    return 0 if report['passed'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
