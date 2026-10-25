#!/usr/bin/env python3
"""Asset-only repair. Generated neutral fur crop + region-alpha-trim of actual v1
features. No code-drawn eyes/nose/mouth, no frame translations or rotations.
All outputs stay under repair-v2 in the two approved character-right roots.
"""
from pathlib import Path
from PIL import Image
import numpy as np
import json, hashlib
ROOT=Path(__file__).resolve().parents[5]
ARCHIVE=ROOT/'assets/company-office-reference-v3/character-right'
SOURCE=ROOT/'frontend/company-office/reference-v3/media/character-right'
OUT=ARCHIVE/'repair-v2'
MEDIA=SOURCE/'repair-v2'
FX,FY,FW,FH=86,60,90,58

def region(mask, box, select):
    x0,y0,x1,y1=box
    mask[y0:y1,x0:x1]|=select[y0:y1,x0:x1]

def run():
    original=Image.open(SOURCE/'base-right-candidate.png').convert('RGBA')
    neutral=Image.open(OUT/'originals/neutral-base-original.png').convert('RGBA')
    alpha_orig=np.asarray(original)[:,:,3]
    origbox=original.getchannel('A').point(lambda x:255 if x>8 else 0).getbbox()
    genbox=neutral.getchannel('A').point(lambda x:255 if x>8 else 0).getbbox()
    # Register whole tool image once to original sprite bounds; shared for all
    # actions. Outside the local face crop the original is retained byte-for-byte.
    x0,y0,x1,y1=origbox
    canvas=Image.new('RGBA',(192,192))
    canvas.paste(neutral.crop(genbox).resize((x1-x0,y1-y0),Image.Resampling.NEAREST),(x0,y0))
    canvas.save(OUT/'qa/neutral-registered.png')
    result=np.asarray(original).copy();generated=np.asarray(canvas)
    padded0=np.pad(alpha_orig>127,1)
    interior0=(padded0[1:-1,1:-1]&padded0[:-2,1:-1]&padded0[2:,1:-1]&padded0[1:-1,:-2]&padded0[1:-1,2:])
    patchcopy=interior0[FY:FY+FH,FX:FX+FW]
    local=result[FY:FY+FH,FX:FX+FW,:3]
    local[patchcopy]=generated[FY:FY+FH,FX:FX+FW,:3][patchcopy]
    # Alpha is the original silhouette. Source is tool-painted neutral fur only.
    result[:,:,3]=alpha_orig
    underlay=Image.fromarray(result)
    for target in [OUT/'base-neutral.png',MEDIA/'base-neutral.png']:underlay.save(target)
    # A common interior geometry mask protects the exact existing head outline.
    head=alpha_orig[FY:FY+FH,FX:FX+FW]>127
    padded=np.pad(alpha_orig>127,1)
    safe=(padded[1:-1,1:-1]&padded[:-2,1:-1]&padded[2:,1:-1]&padded[1:-1,:-2]&padded[1:-1,2:])
    safe=safe[FY:FY+FH,FX:FX+FW]
    # All working surfaces share exactly one rectangle and clipping ellipse.
    xx,yy=np.meshgrid(np.arange(FW)+.5,np.arange(FH)+.5)
    clip=((xx-45)/45)**2+((yy-29)/29)**2<=1
    safe &=clip
    moving_union=np.zeros((FH,FW),bool)
    sources={};report={}
    for action in ['working','idle','syncing','error']:
        src=Image.open(SOURCE/f'face-{action}-candidate.png').convert('RGBA')
        sheet=Image.new('RGBA',(360,174));composites=Image.new('RGBA',(768,576))
        masksheet=Image.new('L',(360,174));featureframes=[];rendered=[]
        for i in range(12):
            cell=src.crop(((i%4)*FW,(i//4)*FH,(i%4+1)*FW,(i//4+1)*FH))
            f=np.asarray(cell).copy();rgb=f[:,:,:3].astype(int)
            dark=(rgb[:,:,0]<175)&(rgb[:,:,1]<130)&(rgb[:,:,2]<105)
            eye_pale=(rgb[:,:,0]>180)&(rgb[:,:,1]>160)&(rgb[:,:,2]>125)&(rgb[:,:,0]-rgb[:,:,2]<70)
            pink=(rgb[:,:,0]>165)&(rgb[:,:,1]>40)&(rgb[:,:,1]<200)&(rgb[:,:,2]>70)&(rgb[:,:,2]>rgb[:,:,1]*.8)&(rgb[:,:,0]>rgb[:,:,1]*1.08)
            # Only eye/lid/brow, nose and mouth source pixels survive. Fur,
            # whiskers, cheek shading and the original patch edge become alpha0.
            mask=np.zeros((FH,FW),bool)
            if action=='idle':
                region(mask,(35,8,53,24),dark)
                region(mask,(55,6,70,23),pink)
                region(mask,(50,17,67,41),dark)
            else:
                region(mask,(38,10,68,40),dark|eye_pale)
                region(mask,(40,4,65,20),dark)
                region(mask,(67,24,85,42),pink)
                region(mask,(62,35,83,48),dark)
            mask &= safe & (f[:,:,3]>0)
            f[:,:,3]=np.where(mask,f[:,:,3],0).astype('uint8')
            # Canonical invisible RGB is for transparent PNG hygiene only.
            f[f[:,:,3]==0]=0
            feature=Image.fromarray(f);featureframes.append(feature)
            moving_union |= mask
            sheet.paste(feature,((i%4)*FW,(i//4)*FH))
            masksheet.paste(Image.fromarray((mask*255).astype('uint8')),((i%4)*FW,(i//4)*FH))
            combo=underlay.copy();combo.alpha_composite(feature,(FX,FY));rendered.append(combo)
            composites.paste(combo,((i%4)*192,(i//4)*192))
        for target in [OUT/f'face-{action}.png',MEDIA/f'face-{action}.png']:sheet.save(target)
        composites.save(OUT/f'qa/contact-{action}-12.png')
        masksheet.save(OUT/f'qa/alpha-trim-{action}.png')
        folder=OUT/f'frames/{action}';folder.mkdir(parents=True,exist_ok=True)
        for i,frame in enumerate(featureframes):frame.save(folder/f'{i:02d}.png')
        clock={'working':60,'syncing':60,'idle':36,'error':12}[action]
        dur=[(round((i+1)*100/12)-round(i*100/12))*10 for i in range(12)];dur[0]+=(clock-12)*1000//12
        view=[c.resize((384,384),Image.Resampling.NEAREST) for c in rendered]
        view[0].save(OUT/f'qa/preview-{action}.gif',save_all=True,append_images=view[1:],duration=dur,loop=0,disposal=2)
        hashes=[hashlib.sha256(np.asarray(f).tobytes()).hexdigest() for f in featureframes]
        ca=np.array([np.asarray(c) for c in rendered])
        ca0=np.asarray(underlay)
        outside=np.ones((192,192),bool);outside[FY:FY+FH,FX:FX+FW]=False
        report[action]={'uniqueTrimmedFrames':len(set(hashes)),'frameHashes':hashes,
                        'nonemptyFrames':sum(bool(f.getchannel('A').getbbox()) for f in featureframes),
                        'bodyOutsideFaceRectChangedPixels':[int(np.count_nonzero(np.any(f!=ca0,axis=2)&outside)) for f in ca],
                        'alphaOccupancyChangedPixels':[int(np.count_nonzero((f[:,:,3]>0)!=(alpha_orig>0))) for f in ca],
                        'opaqueSilhouetteChangedPixels':[int(np.count_nonzero((f[:,:,3]>127)!=(alpha_orig>127))) for f in ca],
                        'headOutlineRgbaChangedPixels':[int(np.count_nonzero(np.any(f!=np.asarray(original),axis=2)&((alpha_orig>0)&~interior0))) for f in ca],
                        'interiorAlphaBlendChangedPixels':[int(np.count_nonzero(f[:,:,3]!=alpha_orig)) for f in ca],
                        'frameClockFrames':clock,'newGeneratedFrames':False,
                        'perFrameTransform':False}
        sources[action]=rendered
    union192=np.zeros((192,192),bool);union192[FY:FY+FH,FX:FX+FW]=moving_union
    Image.fromarray((union192*255).astype('uint8')).save(OUT/'qa/allowed-feature-union.png')
    overview=Image.new('RGBA',(192*5,192));overview.paste(underlay,(0,0))
    for n,action in enumerate(['working','idle','syncing','error'],1):overview.paste(sources[action][6],(n*192,0))
    overview.resize((1920,384),Image.Resampling.NEAREST).save(OUT/'qa/overview.png')
    final=Image.new('RGBA',(192*12,192*4))
    for r,action in enumerate(['working','idle','syncing','error']):
        for c,frame in enumerate(sources[action]):final.paste(frame,(c*192,r*192))
    final.save(OUT/'qa/final-combined-contact-sheet.png')
    # Fixed non-feature fur/background invariant across all 48 actual composites.
    fixed=[]
    for action in sources:
        fixed += [int(np.count_nonzero(np.any(np.asarray(c)!=result,axis=2)&~union192)) for c in sources[action]]
    outsidebase=np.ones((192,192),bool);outsidebase[FY:FY+FH,FX:FX+FW]=False
    base_changes=int(np.count_nonzero(np.any(result!=np.asarray(original),axis=2)&outsidebase))
    data={'date':'2026-10-02','stage':'targeted_repair_v2','faceRect':[FX,FY,FW,FH],
          'faceClipEllipse':[FX+45,FY+29,45,29],'normalization':{'originalBounds':list(origbox),'generatedBounds':list(genbox),
          'method':'Single tool-image crop/scale alignment, then local crop paste of tool fur into the v1 sprite. Original alpha and pixels outside fixed patch retained.'},
          'neutralBaseOutsidePatchChangedPixels':base_changes,'neutralBaseAlphaChangedPixels':int(np.count_nonzero(result[:,:,3]!=alpha_orig)),
          'fixedNonFeatureFurChangedPixelsAll48':fixed,'actions':report,
          'noCodePaintedFeatures':True,'noFrameTransforms':True,'staticFeetAllowed':True,
          'noHandsFinalWorkstationTested':False,'newImageToolCalls':1,'humanApprovalRequired':True}
    (OUT/'qa/numeric-report.json').write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'neutralBaseOutsidePatchChangedPixels':base_changes,'fixedFurChangedPixelsMax':max(fixed),
      'uniqueFrames':{k:v['uniqueTrimmedFrames'] for k,v in report.items()},
      'alphaOccupancyChangedPixelsMax':max(n for v in report.values() for n in v['alphaOccupancyChangedPixels']),
      'headOutlineRgbaChangedPixelsMax':max(n for v in report.values() for n in v['headOutlineRgbaChangedPixels'])},indent=2))
if __name__=='__main__':run()
