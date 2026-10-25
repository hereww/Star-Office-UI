#!/usr/bin/env python3
"""Furniture-only normalization/alpha partition. Never draws/repaints furniture.

Only whole-image nearest resize and alpha masks are applied. No crop, trim,
rotation, mirror, synthesis, perspective warp or RGB repaint is permitted.
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageChops
import hashlib, json, os, argparse

ASSET = Path(__file__).resolve().parents[1]
ROOT = Path(__file__).resolve().parents[4]
MEDIA = ROOT / 'frontend/company-office/reference-v3/media/furniture'
V3 = MEDIA.parents[1]
DIRECTIONS = ('up', 'down', 'left', 'right')

def atomic_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(data, ensure_ascii=False, indent=2) + '\n'
    temp = path.with_name(path.name + '.writing')
    temp.write_text(payload, encoding='utf-8')
    os.replace(temp, path)

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def alpha_stats(image):
    alpha = image.getchannel('A')
    hist = alpha.histogram()
    area = image.width * image.height
    return {
        'size': list(image.size), 'mode': image.mode,
        'alphaExtrema': list(alpha.getextrema()),
        'transparentPixels': hist[0], 'opaque255Pixels': hist[255],
        'nearOpaque245Pixels': sum(hist[245:]),
        'partialAlphaPixels': sum(hist[1:255]),
        'transparentFraction': round(hist[0] / area, 6),
        'alphaBBox': list(alpha.getbbox()) if alpha.getbbox() else None,
        'cornersAlpha': [alpha.getpixel(p) for p in [(0, 0), (image.width-1, 0), (0, image.height-1), (image.width-1, image.height-1)]],
        'borderMaxAlpha': max(max(alpha.crop((0,0,image.width,1)).get_flattened_data()), max(alpha.crop((0,image.height-1,image.width,image.height)).get_flattened_data()), max(alpha.crop((0,0,1,image.height)).get_flattened_data()), max(alpha.crop((image.width-1,0,image.width,image.height)).get_flattened_data())),
    }

def partition(image, polygons, exclude_oak=False):
    mask = Image.new('L', image.size, 0)
    draw = ImageDraw.Draw(mask)  # Draws alpha masks ONLY, never furniture pixels.
    for polygon in polygons:
        draw.polygon([tuple(p) for p in polygon], fill=255)
    if exclude_oak:
        # This only reassigns source oak pixels to BACK. No RGB is changed.
        entries = list(mask.get_flattened_data())
        for i, (r,g,b,a) in enumerate(image.get_flattened_data()):
            if r > g + 18 and g > b + 18:
                entries[i] = 0
        mask.putdata(entries)
    empty = Image.new('RGBA', image.size, (0, 0, 0, 0))
    front = Image.composite(image, empty, mask)
    back = Image.composite(image, empty, ImageChops.invert(mask))
    return back, front, mask

def build(status):
    plan = json.loads((ASSET / 'processing-plan.json').read_text())
    assert plan['sourceCrop'] is None and plan['rotationDegrees'] == 0 and plan['mirrored'] is False
    assert plan['logicalCanvas'] == [192, 192] and plan['resampling'] == 'nearest'
    MEDIA.mkdir(parents=True, exist_ok=True)
    for folder in ['normalized', 'qa']:
        (ASSET / folder).mkdir(exist_ok=True)
    manifest = {
        'schemaVersion': 1, 'status': status, 'logicalCanvas': [192, 192],
        'baseUrl': 'reference-v3/', 'runtimeIntegratedByThisTask': False,
        'generator': 'built-in image_gen.imagegen', 'independentlyGeneratedDirections': list(DIRECTIONS),
        'sourceResolutionPreserved': True, 'staticFurnitureOnly': True, 'actorIncluded': False, 'handsIncluded': False,
        'qa': {'alpha':'assets/company-office-reference-v3/furniture/qa/alpha-qa.json','registration':'assets/company-office-reference-v3/furniture/qa/registration-qa.json','interface':'assets/company-office-reference-v3/furniture/qa/interface-qa.json','browser':'assets/company-office-reference-v3/furniture/qa/browser-qa.json','manualVisual':'assets/company-office-reference-v3/furniture/qa/visual-qa.json'},
        'processing': {'fullCanvasResize': [192, 192], 'resampling': 'nearest', 'alphaDustCutoff': plan['alphaDustCutoff'], 'crop': None, 'trim': False, 'rotate': False, 'mirror': False, 'rgbRepaint': False, 'layerOperation': 'complementary binary alpha masks'},
        'directions': {},
        'notes': ['Only static furniture; no actor, hands, animation or runtime edits.', 'seatAnchor uses the current player lower-body/poseAnchor registration convention, not a face point.', 'UP and sides draw display before actor to respect head occlusion; DOWN rear display forbidden (LED only).', 'LEFT/RIGHT were independent calls, not mirrored or rotated copies.'],
    }
    qa = {'schemaVersion': 1, 'passed': True, 'generatedArtwork': True, 'codePaintedFurniture': False, 'directions': {}}
    for d in DIRECTIONS:
        spec = plan['directions'][d]
        src_path = ASSET / spec['source']
        raw = Image.open(src_path).convert('RGBA')
        assert raw.width == raw.height, f'{d}: source must retain whole square'
        norm = raw.resize((192, 192), Image.Resampling.NEAREST)
        alpha = norm.getchannel('A')
        before_nonzero = sum(1 for a in alpha.get_flattened_data() if a)
        keep = alpha.point(lambda a: 0 if a < plan['alphaDustCutoff'] else 255)
        norm = Image.composite(norm, Image.new('RGBA', norm.size, (0, 0, 0, 0)), keep)
        back, front, mask = partition(norm, spec['frontPolygons'], spec.get('frontExcludeOak',False))
        output = {'full': norm, 'back': back, 'front': front}
        hashes = {}
        for kind, image in output.items():
            name = f'{d}.png' if kind == 'full' else f'{d}-{kind}.png'
            image.save(MEDIA / name)
            image.save(ASSET / 'normalized' / name)
            image.resize((768,768), Image.Resampling.NEAREST).save(ASSET / 'qa' / f'{d}-{kind}-4x.png')
            hashes[kind] = sha(MEDIA / name)
        mask.save(ASSET / 'qa' / f'{d}-front-alpha-mask.png')
        norm.resize((768,768), Image.Resampling.NEAREST).save(ASSET / 'qa' / f'{d}-4x.png')
        reassembled = Image.alpha_composite(back, front)
        norm_pixels, assembled_pixels = list(norm.get_flattened_data()), list(reassembled.get_flattened_data())
        overlap = sum(1 for b,f in zip(back.getchannel('A').get_flattened_data(),front.getchannel('A').get_flattened_data()) if b and f)
        alpha_equal = norm.getchannel('A').tobytes() == reassembled.getchannel('A').tobytes()
        visible_equal = all(n == r for n,r in zip(norm_pixels,assembled_pixels) if n[3])
        stats = alpha_stats(norm)
        led = spec['screen']['led']
        led_pixels = [norm.getpixel((x,y)) for y in range(led[1],led[1]+led[3]) for x in range(led[0],led[0]+led[2])]
        led_solid = all(p[3] >= 245 for p in led_pixels)
        layer_screen_ok = True
        screen_samples = []
        if spec['screen']['visible']:
            vertices = spec['screen']['polygon']
            for i in range(4):
                p=vertices[i]; q=vertices[(i+1)%4]
                screen_samples.append([(p[0]+q[0])/2,(p[1]+q[1])/2])
            screen_samples.append([sum(p[0] for p in vertices)/4,sum(p[1] for p in vertices)/4])
            sample_colors=[]
            for x,y in screen_samples:
                xy=(int(x),int(y)); px=norm.getpixel(xy); sample_colors.append(list(px))
                layer_screen_ok &= px[3]>=245 and px[2]>px[0]+16 and px[2]>px[1]+6 and front.getpixel(xy)[3]==0
        else:
            sample_colors=[]
        direction_passed = stats['borderMaxAlpha']==0 and stats['cornersAlpha']==[0]*4 and 0.3<stats['transparentFraction']<0.95 and alpha_equal and visible_equal and overlap==0 and led_solid and layer_screen_ok and back.getchannel('A').getbbox() is not None and front.getchannel('A').getbbox() is not None
        qa['passed'] &= direction_passed
        qa['directions'][d] = {'passed':direction_passed, 'source':alpha_stats(raw), 'normalized':stats, 'removedAlphaDustPixels':before_nonzero - sum(1 for a in norm.getchannel('A').get_flattened_data() if a), 'back':alpha_stats(back), 'front':alpha_stats(front), 'reassembly':{'alphaIdentical':alpha_equal,'visibleRgbaIdentical':visible_equal,'overlapNonzeroPixels':overlap}, 'screen':{'visible':spec['screen']['visible'],'samples':screen_samples,'sampleRgba':sample_colors,'interiorAndLayerCheckPassed':bool(layer_screen_ok),'ledSampleRgba':[list(p) for p in led_pixels],'ledInsideSolidHousing':led_solid}, 'sha256':{'source':sha(src_path),**hashes}}
        furniture={'size':[192,192], 'seatAnchor':spec['seatAnchor'], 'back':f'media/furniture/{d}-back.png','front':f'media/furniture/{d}-front.png','screen':spec['screen'],'order':spec['order']}
        manifest['directions'][d]={'furniture':furniture,'source':spec['source'],'normalized':f'media/furniture/{d}.png','occlusion':spec['occlusion'],'notes':spec['notes'],'sha256':{'source':sha(src_path),**hashes}}
    left=Image.open(MEDIA/'left.png'); right=Image.open(MEDIA/'right.png')
    qa['independentSideImages']={'differentSourceHashes':sha(ASSET/'sources/left-source.png')!=sha(ASSET/'sources/right-source.png'), 'notExactHorizontalMirror':left.tobytes()!=right.transpose(Image.Transpose.FLIP_LEFT_RIGHT).tobytes(), 'mirrorComparisonOnly':True,'rgbNeverRepainted':True}
    assert qa['independentSideImages']['differentSourceHashes'] and qa['independentSideImages']['notExactHorizontalMirror']
    atomic_json(ASSET/'manifest.json',manifest)
    atomic_json(MEDIA/'manifest.json',manifest)
    atomic_json(ASSET/'qa/alpha-qa.json',qa)
    print(json.dumps({'status':status,'qaPassed':qa['passed'],'directions':{d:qa['directions'][d]['passed'] for d in DIRECTIONS},'runtimeManifest':str(MEDIA/'manifest.json')},ensure_ascii=False,indent=2))
    if not qa['passed']:
        raise SystemExit('Furniture QA failed: inspect qa/alpha-qa.json; do not mark ready.')

if __name__=='__main__':
    parser=argparse.ArgumentParser(); parser.add_argument('--status', default='calibrating-candidate'); args=parser.parse_args(); build(args.status)
