from pathlib import Path
from PIL import Image,ImageDraw
import numpy as np,json,hashlib
R=Path('/Users/hepingyu/Documents/ChatGPT/Star-Office-UI');O=R/'assets/company-office-reference-v3/character-right/repair-v4-aligned';M=R/'frontend/company-office/reference-v3/media/character-right/repair-v4-aligned'
m=json.loads((M/'manifest.json').read_text());c=m['character'];fx,fy,fw,fh=c['faceRect'];cx,cy,rx,ry=c['faceClipEllipse']
yy,xx=np.mgrid[fy:fy+fh,fx:fx+fw];ellipse=((xx+.5-cx)/rx)**2+((yy+.5-cy)/ry)**2<=1
report={'framesChecked':48,'actions':{},'ellipseClippedFeaturePixels':0,'bodyOutsideFaceChangedPixels':0,'actualDirectionalPlayerUsed':True,'native4K':False};allw=Image.new('RGBA',(2304,768))
base=np.array(Image.open(M/'base.png').convert('RGBA'))
for row,(act,state) in enumerate([('working','writing'),('idle','idle'),('syncing','syncing'),('error','error')]):
 ws=Image.new('RGBA',(768,576));ar={'unique':0,'ellipseClippedFeaturePixels':[],'mouthInkPixels':[],'workstationImages':12};hashes=[]
 for i in range(12):
  feat=Image.open(O/f'frames/{act}/{i:02}.png').convert('RGBA');a=np.array(feat);hashes.append(hashlib.sha256(a.tobytes()).hexdigest());n=int(np.sum((a[:,:,3]>0)&~ellipse));ar['ellipseClippedFeaturePixels'].append(n);report['ellipseClippedFeaturePixels']+=n
  full=np.zeros_like(base);full[fy:fy+fh,fx:fx+fw]=a
  sprite=Image.fromarray(base.copy());sprite.alpha_composite(feat,(fx,fy));sp=np.array(sprite)
  outside=np.ones(base.shape[:2],bool);outside[fy:fy+fh,fx:fx+fw]=False
  report['bodyOutsideFaceChangedPixels']+=int(np.sum(np.any(sp!=base,axis=2)&outside))
  report['silhouetteAlphaOccupancyChangedPixels']=report.get('silhouetteAlphaOccupancyChangedPixels',0)+int(np.sum((sp[:,:,3]>127)!=(base[:,:,3]>127)))
  report['interiorAlphaValueChangedPixels']=report.get('interiorAlphaValueChangedPixels',0)+int(np.sum(sp[:,:,3]!=base[:,:,3]))
  # The mouth ROI is well below eye and nose, so count black cavity independently.
  mouth=full[96:111,140:158];dark=(mouth[:,:,0]<100)&(mouth[:,:,1]<75)&(mouth[:,:,2]<60)&(mouth[:,:,3]>0);ar['mouthInkPixels'].append(int(dark.sum()))
  img=Image.open(O/f'qa/workstation-frames/{state}-{i:02}.png').convert('RGBA');ws.paste(img,(i%4*192,i//4*192));allw.paste(img,(i*192,row*192))
 ar['unique']=len(set(hashes));report['actions'][act]=ar
 ws.save(O/f'qa/workstation-{act}-12.png');ws.resize((1536,1152),Image.Resampling.NEAREST).save(O/f'qa/workstation-{act}-12-2x.png')
allw.save(O/'qa/workstation-four-actions-all-48.png');(O/'qa/technical-report.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))
