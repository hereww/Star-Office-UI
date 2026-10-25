#!/usr/bin/env python3
"""Read-only asset checks, plus atlas/compositor QA previews in the allowed QA dir.
No source or normalized sprite is repaired or rewritten. No runtime/UI edits.
"""
import hashlib, json
from pathlib import Path
import numpy as np
from PIL import Image
ROOT=Path(__file__).resolve().parents[4]
ASSETS=ROOT/'assets/company-office-reference-v3/character-right'
MEDIA=ROOT/'frontend/company-office/reference-v3/media/character-right'
V3=ROOT/'frontend/company-office/reference-v3'
QA=ASSETS/'qa'

def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def img_info(path):
    im=Image.open(path)
    pixels=np.asarray(im.convert('RGBA'));alpha=pixels[:,:,3]
    return {'path':str(path.relative_to(ROOT)),'size':list(im.size),'mode':im.mode,
            'alphaMin':int(alpha.min()),'alphaMax':int(alpha.max()),
            'zeroAlphaPixels':int(np.count_nonzero(alpha==0)),
            'transparentFraction':round(float(np.mean(alpha==0)),6),'sha256':sha(path)}
def canonical_hash(arr):
    a=arr.copy();a[a[:,:,3]==0]=0
    return hashlib.sha256(a.tobytes()).hexdigest()
def visible_diff(a,b):
    opaque=(a[:,:,3]>127)|(b[:,:,3]>127)
    color=np.max(np.abs(a[:,:,:3].astype(int)-b[:,:,:3].astype(int)),axis=2)>24
    alpha=(a[:,:,3]>127)!=(b[:,:,3]>127)
    return opaque&(color|alpha)

def main():
    config=json.loads((ASSETS/'manifest.json').read_text());c=config['character']
    base=Image.open(V3/c['base']).convert('RGBA');basea=np.asarray(base)
    fx,fy,fw,fh=c['faceRect'];cx,cy,rx,ry=c['faceClipEllipse']
    xx,yy=np.meshgrid(np.arange(fw)+fx+.5,np.arange(fh)+fy+.5)
    ellipse=((xx-cx)/rx)**2+((yy-cy)/ry)**2<=1
    allout=np.ones((192,192),bool);allout[fy:fy+fh,fx:fx+fw]=~ellipse
    report={'status':'candidate_not_accepted','approved':False,'productionReady':False,
            'schemaDimensionsPassed':True,'genuineAlphaPassed':True,'twelveUniqueFramesPassed':True,
            'bodyOutsideFixedFaceEllipseUnchanged':True,
            'configuredFaceRectangleStable':True,'generatedNonFeaturePixelsStable':True,
            'frozenFilesUnchanged':True,'noHandsPassed':False,
            'base':img_info(V3/c['base']),'baseVisual':{'rightProfile':True,'visibleEyes':1,'furniture':False,
            'originalIdentityRecognizable':True,'noHands':False,
            'issue':'A visible static forepaw was generated at the bottom-right; candidate only.'},
            'faceRect':c['faceRect'],'faceClipEllipse':c['faceClipEllipse'],'actions':{},
            'notes':['Unique frame hashes are not proof of correct expression motion.',
                     'Compositor preview always uses one static base; face-only overlays cannot change body pixels outside its fixed clip.',
                     'No real runtime or UI integration is performed by this QA script.']}
    base_patch=Image.new('RGBA',(192,192));base_patch.paste(base.crop((fx,fy,fx+fw,fy+fh)),(fx,fy))
    base_patch.save(QA/'fixed-face-placement.png')
    composed={}
    for action,ac in c['actions'].items():
        path=(V3/ac['face']).resolve()
        if not path.is_relative_to(MEDIA.resolve()):raise ValueError('URL escapes permitted media directory')
        atlas=Image.open(path).convert('RGBA');arr=np.asarray(atlas)
        if atlas.size!=(360,174):raise ValueError('Atlas dimensions are not 360x174')
        frames=[arr[r*58:(r+1)*58,col*90:(col+1)*90].copy() for r in range(3) for col in range(4)]
        hashes=[canonical_hash(f) for f in frames]
        unique=len(set(hashes));nonempty=[bool(np.any(f[:,:,3]>127)) for f in frames]
        statics=np.ones((58,90),bool)
        # Broad visible-eye/lid/brow area only; mouth can animate for idle only.
        statics[5:38,37:69]=False
        if action=='idle':statics[19:55,47:76]=False
        outside_counts=[int(np.count_nonzero(visible_diff(frames[0],f)&statics)) for f in frames]
        boxes=[];bodydiff=[];comp=[];nose=[]
        contacts=Image.new('RGBA',(768,576));eyes=Image.new('RGBA',(120,99))
        for i,f in enumerate(frames):
            fim=Image.fromarray(f)
            visible=fim.getchannel('A').point(lambda a:255 if a>127 else 0)
            boxes.append(list(visible.getbbox()) if visible.getbbox() else None)
            # Actual fixed-ellipse compositor; preview only, never an asset repair.
            overlay=f.copy();overlay[:,:,3]=overlay[:,:,3]*ellipse
            composed_frame=base.copy();composed_frame.alpha_composite(Image.fromarray(overlay),(fx,fy))
            ca=np.asarray(composed_frame)
            bodydiff.append(int(np.count_nonzero(np.any(ca!=basea,axis=2)&allout)))
            contacts.paste(composed_frame,((i%4)*192,(i//4)*192));comp.append(composed_frame)
            eye=fim.crop((37,5,67,38));eyes.paste(eye,((i%4)*30,(i//4)*33))
            region=f[4:45,54:86];rgb=region[:,:,:3].astype(int)
            # Find high-confidence pink nose pixels, not orange fur.
            pink=(rgb[:,:,0]>170)&(rgb[:,:,1]>50)&(rgb[:,:,1]<185)&(rgb[:,:,2]>70)&(rgb[:,:,2]<210)&(rgb[:,:,2]>rgb[:,:,1]*.85)&(region[:,:,3]>127)
            ys,xs=np.where(pink)
            nose.append([round(float(xs.mean()+54),2),round(float(ys.mean()+4),2)] if len(xs) else None)
        contacts.save(QA/f'composite-{action}-12.png')
        eyes.resize((480,396),Image.Resampling.NEAREST).save(QA/f'eye-{action}-12-4x.png')
        # Playback QA uses the real 12 distinct frames; frame 0's dwell implements
        # the requested 60/36/12 frame clock. These are not atlas duplicate frames.
        clocks=ac['faceClockFrames']
        durations=[(round((i+1)*100/12)-round(i*100/12))*10 for i in range(12)]
        durations[0]+=(clocks-12)*1000//12
        previews=[im.resize((384,384),Image.Resampling.NEAREST) for im in comp]
        # GIF is only a viewing aid. PNG originals remain the alpha source of truth.
        previews[0].save(QA/f'preview-{action}.gif',save_all=True,append_images=previews[1:],
                         duration=durations,loop=0,disposal=2)
        adjacent=[int(np.count_nonzero(visible_diff(frames[i],frames[(i+1)%12]))) for i in range(12)]
        info=img_info(path)
        passed=unique==12 and all(nonempty)
        stable=max(outside_counts)==0
        record={'asset':info,'source':img_info(ASSETS/f'originals/face-{action}-original.png'),
                'grid':[4,3],'frameCount':12,'frameSize':[90,58],'frameClockFrames':clocks,
                'nonemptyFrames':sum(nonempty),'uniqueVisibleRgbaFrames':unique,'frameHashes':hashes,
                'frameBoxesOpaque127':boxes,'eyeRegionUniqueFrames':len({canonical_hash(f[5:38,37:67]) for f in frames}),
                'adjacentVisibleChangedPixelsIncludingLoopSeam':adjacent,
                'fixedRegionVisibleChangesVsFrame0':outside_counts,'fixedRegionPixelStable':stable,
                'noseCentroidByFrameApproximate':nose,'compositeBodyOutsideClipChangedPixels':bodydiff,
                'candidateOnly':True,'accepted':False,
                'visualNotes':[]}
        if action=='working':record['visualNotes']=['Right-facing focused blink is visible.','Frame-to-frame cheek/whisker and row crop alignment shift; not a stable accepted face atlas.']
        if action=='idle':record['visualNotes']=['Upturned nose/chin, closed eye and open snoring mouth are visible in the standalone atlas.','Raised nose is retracted horizontally from the base profile, so transparent overlay can reveal the old base muzzle/nose.','Mouth changes are generated, but fixed cheek/row crop alignment is not stable.']
        if action=='syncing':record['visualNotes']=['Waiting glance/blink is visible, one side-profile eye.','Pupil shifts are larger than requested at frame 10; cheek/row crop alignment also drifts.']
        if action=='error':record['visualNotes']=['Spiral replaces the single visible eye in all twelve frames.','Different generated internal eye shapes are present.','Strict equal 30-degree clockwise phase and smooth seam are not certified; surrounding fur drifts as well.']
        report['actions'][action]=record;composed[action]=comp
        report['twelveUniqueFramesPassed'] &= passed
        report['schemaDimensionsPassed'] &= info['size']==[360,174] and info['mode']=='RGBA'
        report['genuineAlphaPassed'] &= info['alphaMin']==0 and info['alphaMax']==255 and info['zeroAlphaPixels']>0
        report['generatedNonFeaturePixelsStable'] &= stable
        report['bodyOutsideFixedFaceEllipseUnchanged'] &= max(bodydiff)==0
    preview=Image.new('RGBA',(192*5,192))
    preview.paste(base,(0,0))
    for n,action in enumerate(['working','idle','syncing','error'],1):preview.paste(composed[action][6],(n*192,0))
    preview.resize((1920,384),Image.Resampling.NEAREST).save(QA/'candidate-overview.png')
    baseline=json.loads((QA/'protected-inputs-before.json').read_text())
    changes=[name for name,digest in baseline.items() if not (ROOT/name).is_file() or sha(ROOT/name)!=digest]
    report['protectedInputFilesChecked']=len(baseline);report['protectedInputChangedFiles']=changes
    report['frozenFilesUnchanged']=not changes
    report['baseSource']=img_info(ASSETS/'originals/base-right-original.png')
    report['blockers']=['Visible front paw on static base violates no-hands.',
                        'Generated non-feature face pixels and silhouette registration vary across frames.',
                        'Idle raised/retracted muzzle does not cleanly replace the fixed base nose within the shared transparent patch.',
                        'Strict uniform clockwise spiral phase has not been accepted.']
    (QA/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({k:report[k] for k in ['status','schemaDimensionsPassed','genuineAlphaPassed','twelveUniqueFramesPassed',
          'bodyOutsideFixedFaceEllipseUnchanged','configuredFaceRectangleStable','generatedNonFeaturePixelsStable',
          'frozenFilesUnchanged','noHandsPassed','protectedInputFilesChecked']},ensure_ascii=False,indent=2))
    for action,r in report['actions'].items():print(action,'unique',r['uniqueVisibleRgbaFrames'],'static region changes',r['fixedRegionVisibleChangesVsFrame0'])
if __name__=='__main__':main()
