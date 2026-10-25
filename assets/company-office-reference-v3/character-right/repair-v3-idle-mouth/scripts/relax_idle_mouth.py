#!/usr/bin/env python3
"""Only relax the idle mouth alpha mask from existing v1 generated pixels.
No image generation, code drawing, recoloring, frame transform, new base,
outline change, or changes to working/syncing/error/v1/v2.
"""
from pathlib import Path
from PIL import Image
import numpy as np
import json, hashlib
ROOT=Path(__file__).resolve().parents[5]
FRONT=ROOT/'frontend/company-office/reference-v3/media/character-right'
ARCH=ROOT/'assets/company-office-reference-v3/character-right'
OUT=ARCH/'repair-v3-idle-mouth';MEDIA=FRONT/'repair-v3-idle-mouth'
FRAME=(90,58);FACE=(86,60,90,58)
# One shared ROI for all 12 frames; original closed eyes/nose are preserved.
MOUTH_ROI=(50,12,74,54)

def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def main():
    source=Image.open(FRONT/'face-idle-candidate.png').convert('RGBA')
    old=Image.open(FRONT/'repair-v2/face-idle.png').convert('RGBA')
    base=Image.open(FRONT/'repair-v2/base-neutral.png').convert('RGBA')
    original=Image.open(FRONT/'base-right-candidate.png').convert('RGBA')
    ba=np.asarray(base);orig=np.asarray(original);alpha=orig[:,:,3]
    occupied=alpha>127;pad=np.pad(occupied,1)
    inside=(pad[1:-1,1:-1]&pad[:-2,1:-1]&pad[2:,1:-1]&pad[1:-1,:-2]&pad[1:-1,2:])
    perimeter=(alpha>0)&~inside
    safe=inside[60:118,86:176].copy()
    xx,yy=np.meshgrid(np.arange(90)+.5,np.arange(58)+.5)
    safe &= ((xx-45)/45)**2+((yy-29)/29)**2<=1
    roi=np.zeros((58,90),bool);x0,y0,x1,y1=MOUTH_ROI;roi[y0:y1,x0:x1]=True
    new=Image.new('RGBA',(360,174));contact=Image.new('RGBA',(768,576))
    facecontact=Image.new('RGBA',(360,174));mouthcontact=Image.new('RGBA',(32*4,44*3))
    comparison=Image.new('RGBA',(90*3,58*3));rows=[];rendered=[];unique=[]
    outside=np.ones((192,192),bool);outside[60:118,86:176]=False
    for i in range(12):
        box=((i%4)*90,(i//4)*58,(i%4+1)*90,(i//4+1)*58)
        s=np.asarray(source.crop(box)).copy();o=np.asarray(old.crop(box)).copy();rgb=s[:,:,:3].astype(int)
        dark=(rgb[:,:,0]<175)&(rgb[:,:,1]<130)&(rgb[:,:,2]<105)
        pale=(rgb[:,:,0]>185)&(rgb[:,:,1]>150)&(rgb[:,:,2]>115)&(rgb[:,:,0]-rgb[:,:,2]<85)
        extra=roi&safe&(s[:,:,3]>0)&(dark|pale)
        keep=(o[:,:,3]>0)|extra
        n=s.copy();n[:,:,3]=np.where(keep,s[:,:,3],0).astype('uint8');n[n[:,:,3]==0]=0
        oldkeep=o[:,:,3]>127;newkeep=n[:,:,3]>127
        darksource=roi&dark&(s[:,:,3]>127);palesource=roi&pale&(s[:,:,3]>127)
        assert np.array_equal(n[~roi],o[~roi]),'Changed idle pixels outside shared mouth ROI'
        assert np.all(n[n[:,:,3]>0,:3]==s[n[:,:,3]>0,:3]),'Changed source RGB'
        feature=Image.fromarray(n);new.paste(feature,((i%4)*90,(i//4)*58))
        combo=base.copy();combo.alpha_composite(feature,(86,60));rendered.append(combo);ca=np.asarray(combo)
        face=combo.crop((86,60,176,118));facecontact.paste(face,((i%4)*90,(i//4)*58))
        mouth=face.crop((46,10,78,54));mouthcontact.paste(mouth,((i%4)*32,(i//4)*44))
        contact.paste(combo,((i%4)*192,(i//4)*192))
        if i in [0,5,11]:
            row=[0,5,11].index(i);prev=base.copy();prev.alpha_composite(Image.fromarray(o),(86,60))
            comparison.paste(source.crop(box),(0,row*58));comparison.paste(prev.crop((86,60,176,118)),(90,row*58));comparison.paste(face,(180,row*58))
        unique.append(hashlib.sha256(n.tobytes()).hexdigest())
        rows.append({'frame':i,'sourceMouthDarkPixels':int(darksource.sum()),
                     'v2DarkRetained':int((darksource&oldkeep).sum()),'v3DarkRetained':int((darksource&newkeep).sum()),
                     'sourceMuzzlePalePixels':int(palesource.sum()),'v2MuzzlePaleRetained':int((palesource&oldkeep).sum()),
                     'v3MuzzlePaleRetained':int((palesource&newkeep).sum()),
                     'changedFramePixelsOutsideMouthRoi':int(np.count_nonzero(np.any(n!=o,axis=2)&~roi)),
                     'compositeBodyOutsideFaceRectChangedPixels':int(np.count_nonzero(np.any(ca!=ba,axis=2)&outside)),
                     'compositeOriginalOutlineRgbaChangedPixels':int(np.count_nonzero(np.any(ca!=orig,axis=2)&perimeter)),
                     'compositeAlphaOccupancyChangedPixels':int(np.count_nonzero((ca[:,:,3]>0)!=(alpha>0)))})
        folder=OUT/'frames';folder.mkdir(parents=True,exist_ok=True);feature.save(folder/f'{i:02d}.png')
    for dst in [MEDIA/'face-idle.png',OUT/'face-idle.png']:new.save(dst)
    contact.save(OUT/'qa/contact-idle-12.png')
    contact.resize((1536,1152),Image.Resampling.NEAREST).save(OUT/'qa/contact-idle-12-2x.png')
    facecontact.resize((1440,696),Image.Resampling.NEAREST).save(OUT/'qa/face-idle-12-4x.png')
    mouthcontact.resize((1536,1584),Image.Resampling.NEAREST).save(OUT/'qa/mouth-idle-12-12x.png')
    comparison.resize((1620,1044),Image.Resampling.NEAREST).save(OUT/'qa/source-v2-v3-comparison-6x.png')
    # Mouth-visible viewing loop and the actual 36-frame clock preview.
    dur=[(round((i+1)*100/12)-round(i*100/12))*10 for i in range(12)]
    view=[c.resize((384,384),Image.Resampling.NEAREST) for c in rendered]
    view[0].save(OUT/'qa/idle-all-phases.gif',save_all=True,append_images=view[1:],duration=dur,loop=0,disposal=2)
    durations=dur.copy();durations[0]+=2000
    view[0].save(OUT/'qa/idle-clock-36.gif',save_all=True,append_images=view[1:],duration=durations,loop=0,disposal=2)
    protected=json.loads((OUT/'qa/protected-before.json').read_text())
    changed=[name for name,h in protected.items() if not (ROOT/name).is_file() or digest(ROOT/name)!=h]
    assert not changed,changed
    assert len(set(unique))==12
    data={'createdOn':'2026-10-02','repair':'idle_mouth_only_shared_alpha_mask_relaxation',
          'sourceHasClearlyOpenMouth':True,'newImageGenerationCalls':0,
          'diagnosis':'v2 retained much of the dark mouth but truncated its right/lower pixels and removed almost all pale muzzle support; the retained mouth was left on neutral orange fur, losing readable upturned open-mouth framing.',
          'oldMouthDarkRoi':[50,17,17,24],'sharedNewMouthRoi':[50,12,24,42],
          'onlyChange':'Union v2 mask with existing generated dark mouth and pale muzzle pixels in one shared ROI. Retained source RGB/alpha and coordinates unchanged.',
          'faceRect':[86,60,90,58],'faceClipEllipse':[131,89,45,29],'frameSize':[90,58],
          'uniqueFrames':12,'frameHashes':unique,'fps':12,'faceClockFrames':36,
          'rows':rows,'protectedPriorAndFrozenFilesChecked':len(protected),'protectedChangedFiles':changed,
          'unchanged':['neutral base','working atlas','syncing atlas','error atlas','all v1/v2 manifests and candidates','outline','per-frame coordinates','runtime/UI'],
          'visualApproval':False,'finalHumanReviewRequired':True,
          'reportLimits':'Numeric dark-pixel counts demonstrate source retention, not automatic proof of sleeping semantics. Enlarged mouth and full composites must be inspected.'}
    (OUT/'qa/report.json').write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'uniqueIdleFrames':12,'otherPriorFilesUnchanged':len(protected),
      'mouthDarkRetainedOld':[x['v2DarkRetained'] for x in rows],
      'mouthDarkRetainedNew':[x['v3DarkRetained'] for x in rows],
      'muzzlePaleRetainedNew':[x['v3MuzzlePaleRetained'] for x in rows],
      'bodyOutsideChangedPixelsMax':max(x['compositeBodyOutsideFaceRectChangedPixels'] for x in rows),
      'outlineChangedPixelsMax':max(x['compositeOriginalOutlineRgbaChangedPixels'] for x in rows)},indent=2))
if __name__=='__main__':main()
