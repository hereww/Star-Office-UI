#!/usr/bin/env python3
"""Read-only actor placement smoke QA. Only composites supplied bitmaps for QA.
Does not edit, paint, synthesize, mirror or integrate a character asset.
"""
from pathlib import Path
from PIL import Image, ImageChops
import json, hashlib
ASSET=Path(__file__).resolve().parents[1]
ROOT=Path(__file__).resolve().parents[4]
MEDIA=ROOT/'frontend/company-office/reference-v3/media/furniture'
V3=MEDIA.parents[1]
manifest=json.loads((MEDIA/'manifest.json').read_text())
plans={
 'up':{'source':'assets/company-office-reference-v3/seated-back-source.png','poseAnchor':[96,170],'scale':0.6,'headBox':[44,31,104,88],'status':'registration-only full-source resize; main chooses final back body'},
 'down':{'source':'frontend/company-office/media/character-base.png','poseAnchor':[98,170],'scale':0.6,'faceClipEllipse':[100,101,45,29],'status':'original approved down body reused read-only'},
 'left':{'source':'frontend/company-office/reference-v3/media/character-left/character-base.png','poseAnchor':[96,174],'scale':0.6,'faceClipEllipse':[78,94,28,21],'status':'current independent left base read-only; expressions out of this furniture task'},
 'right':{'source':'frontend/company-office/reference-v3/media/character-right/base-right-candidate.png','poseAnchor':[112,174],'scale':0.6,'faceClipEllipse':[131,89,45,29],'status':'registration-only rejected right actor candidate; do NOT treat as actor acceptance'}
}
report={'scope':'Furniture geometry/occlusion only, not actor expression acceptance or runtime integration','directions':{},'passed':True}
empty_sheet=Image.new('RGBA',(768,192),(0,0,0,0))
registered_sheet=Image.new('RGBA',(768,192),(0,0,0,0))
for col,(d,actor) in enumerate(plans.items()):
 furniture=manifest['directions'][d]['furniture']; seat=furniture['seatAnchor']; pose=actor['poseAnchor']; scale=actor['scale']
 src=ROOT/actor['source']; raw=Image.open(src).convert('RGBA')
 normalized=raw if raw.size==(192,192) else raw.resize((192,192),Image.Resampling.NEAREST)
 w=h=round(192*scale);x=round(seat[0]-pose[0]*scale);y=round(seat[1]-pose[1]*scale)
 body=normalized.resize((w,h),Image.Resampling.NEAREST)
 actor_layer=Image.new('RGBA',(192,192),(0,0,0,0));actor_layer.alpha_composite(body,dest=(x,y))
 back=Image.open(MEDIA/f'{d}-back.png').convert('RGBA');front=Image.open(MEDIA/f'{d}-front.png').convert('RGBA')
 composed=Image.alpha_composite(Image.alpha_composite(back,actor_layer),front)
 composed.save(ASSET/f'qa/{d}-registration.png')
 composed.resize((768,768),Image.Resampling.NEAREST).save(ASSET/f'qa/{d}-registration-4x.png')
 empty_sheet.alpha_composite(Image.open(MEDIA/f'{d}.png').convert('RGBA'),dest=(col*192,0))
 registered_sheet.alpha_composite(composed,dest=(col*192,0))
 face_blocked=0;face_samples=0
 if 'faceClipEllipse' in actor:
  cx,cy,rx,ry=actor['faceClipEllipse'];cx=x+cx*scale;cy=y+cy*scale;rx*=scale;ry*=scale
  for py in range(192):
   for px in range(192):
    # No ellipse is drawn; this is a numerical occlusion query only.
    if ((px+0.5-cx)/rx)**2+((py+0.5-cy)/ry)**2 <= 1:
     face_samples+=1
     if front.getpixel((px,py))[3]>0:face_blocked+=1
  visible=face_blocked==0;report['passed'] &= visible
 else:cx=cy=None;visible=None
 report['directions'][d]={'actorReadOnlySource':actor['source'],'actorStatus':actor['status'],'actorSourceSha256':hashlib.sha256(src.read_bytes()).hexdigest(),'scale':scale,'poseAnchor':pose,'seatAnchor':seat,'bodyPlacementRounded':[x,y,w,h],'faceCenter':[cx,cy] if cx is not None else None,'faceSamples':face_samples,'frontOccludedFacePixels':face_blocked,'faceUnobscured':visible,'image':f'qa/{d}-registration-4x.png'}
empty_sheet.resize((1536,384),Image.Resampling.NEAREST).save(ASSET/'qa/furniture-contact-sheet.png')
registered_sheet.resize((1536,384),Image.Resampling.NEAREST).save(ASSET/'qa/registration-contact-sheet.png')
# Frozen template comparison is against its recorded user-approved manifest, not a newly invented baseline.
frozen=ROOT/'.agents/skills/star-office-character-animation/assets/approved-office-expressions-v1'
frozen_manifest=json.loads((frozen/'template-manifest.json').read_text())
checks=[]
for item in frozen_manifest['files']:
 path=frozen/item['path']; actual=hashlib.sha256(path.read_bytes()).hexdigest()
 checks.append({'path':item['path'],'expectedSha256':item['sha256'],'actualSha256':actual,'unchanged':actual==item['sha256']})
report['frozenTemplate']={'checkedFiles':len(checks),'unchanged':all(c['unchanged'] for c in checks),'checks':checks}
report['passed'] &= report['frozenTemplate']['unchanged']
(ASSET/'qa/registration-qa.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'passed':report['passed'],'faceUnobscured':{d:r['faceUnobscured'] for d,r in report['directions'].items()},'frozenTemplateFiles':len(checks),'frozenUnchanged':report['frozenTemplate']['unchanged']},ensure_ascii=False,indent=2))
