#!/usr/bin/env python3
"""Only crop, uniform nearest-neighbor resize and atlas organization.
Never synthesize, mirror, rotate, erase, recolor or duplicate expression frames.
Run using the bundled Pillow runtime. Original tool outputs stay unchanged.
"""
from pathlib import Path
import argparse, json, shutil
from PIL import Image
ROOT = Path(__file__).resolve().parents[4]
ASSETS = ROOT / 'assets/company-office-reference-v3/character-right'
MEDIA = ROOT / 'frontend/company-office/reference-v3/media/character-right'
FACE_RECT = (86, 60, 90, 58)

def base():
    im = Image.open(ASSETS/'originals/base-right-original.png').convert('RGBA')
    # Choose crop from visible alpha, not stray alpha=1 pixels; retain all alpha inside it.
    bounds = im.getchannel('A').point(lambda a: 255 if a > 8 else 0).getbbox()
    sprite = im.crop(bounds)
    h = 176; w = round(sprite.width*h/sprite.height)
    placement = ((192-w)//2, 8)
    result = Image.new('RGBA', (192,192))
    result.paste(sprite.resize((w,h), Image.Resampling.NEAREST), placement)
    for target in (MEDIA/'base-right-candidate.png', ASSETS/'base-right-candidate.png'):
        result.save(target)
    x,y,fw,fh = FACE_RECT
    face = result.crop((x,y,x+fw,y+fh))
    face.save(ASSETS/'references/face-right-reference.png')
    face.resize((fw*4,fh*4),Image.Resampling.NEAREST).save(ASSETS/'references/face-right-reference-4x.png')
    record = {'sourceSize':list(im.size),'sourceCrop':list(bounds),
              'cropBoundsAlphaThreshold':8,'alphaChannelRetained':True,
              'spritePlacement':[*placement,w,h],'frameSize':[192,192],
              'faceRect':list(FACE_RECT),'candidateOnly':True,
              'issues':['Visible static front paw violates no-hands specification.'],
              'method':'One uniform nearest-neighbor scale. No alpha repair, drawing, rotation or mirroring.'}
    (ASSETS/'qa/base-normalization.json').write_text(json.dumps(record,indent=2)+'\n')
    print(json.dumps(record))

def atlas(action, boxes_file=None):
    im=Image.open(ASSETS/f'originals/face-{action}-original.png').convert('RGBA')
    # One global 4x3 equal grid by default. A checked manual crop map is allowed,
    # only to extract actual generated cells; never align or warp features individually.
    if boxes_file:
        boxes=json.loads(Path(boxes_file).read_text())
    else:
        boxes=[[round(c*im.width/4),round(r*im.height/3),round((c+1)*im.width/4),round((r+1)*im.height/3)] for r in range(3) for c in range(4)]
    if len(boxes)!=12: raise ValueError('Must extract exactly twelve genuine source cells')
    output=Image.new('RGBA',(360,174))
    folder=ASSETS/'frames'/action; folder.mkdir(parents=True,exist_ok=True)
    for i,box in enumerate(boxes):
        frame=im.crop(tuple(box)).resize((90,58),Image.Resampling.NEAREST)
        frame.save(folder/f'{i:02d}.png')
        output.paste(frame,((i%4)*90,(i//4)*58))
    for target in (MEDIA/f'face-{action}-candidate.png',ASSETS/f'face-{action}-candidate.png'):
        output.save(target)
    (ASSETS/'qa'/f'crop-{action}.json').write_text(json.dumps({'sourceSize':list(im.size),'boxes':boxes,'frameSize':[90,58],'grid':[4,3],'method':'source crop and common nearest-neighbor resize only'},indent=2)+'\n')
    print(action, im.size, '->', output.size)

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('operation',choices=['base','working','idle','syncing','error']);p.add_argument('--boxes');a=p.parse_args()
    if a.operation=='base':base()
    else:atlas(a.operation,a.boxes)
