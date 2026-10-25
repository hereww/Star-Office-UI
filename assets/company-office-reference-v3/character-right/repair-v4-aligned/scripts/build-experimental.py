from pathlib import Path
from PIL import Image,ImageDraw
import numpy as np,json,hashlib
R=Path('/Users/hepingyu/Documents/ChatGPT/Star-Office-UI');O=R/'assets/company-office-reference-v3/character-right/repair-v4-aligned';M=R/'frontend/company-office/reference-v3/media/character-right/repair-v4-aligned'
b=Image.open(M/'base.png').convert('RGBA');ba=np.array(b)
# Single common mapping applied to all source cells and all actions; only exact
# generated facial-feature RGBA survive. No code-painted features or rotations.
FX,FY,FW,FH=112,54,60,68
rect=[FX,FY,FW,FH]; records={};ALL=[]
for action in ['working','idle','syncing','error']:
 s=Image.open(O/f'sources/{action}.png').convert('RGBA');atlas=Image.new('RGBA',(FW*4,FH*3));comb=Image.new('RGBA',(768,576));faces=Image.new('RGBA',(FW*8,FH*6));frames=[];featurebounds=[]
 for i in range(12):
  box=[round(i%4*s.width/4),round(i//4*s.height/3),round((i%4+1)*s.width/4),round((i//4+1)*s.height/3)]
  f=s.crop(box).resize((123,109),Image.Resampling.NEAREST) # one global scale .32 across 384x341 cell
  a=np.array(f);rgb=a[:,:,:3].astype(float);xx,yy=np.meshgrid(np.arange(123),np.arange(109))
  dark=(rgb[:,:,0]<100)&(rgb[:,:,1]<75)&(rgb[:,:,2]<60)
  # Remove source's outer contour, not anatomical feature ink. A dark component
  # touching the alpha boundary belongs to generated silhouette and cannot be
  # overlaid onto the different fixed head contour.
  alpha=a[:,:,3]>127;padded=np.pad(alpha,1)
  interior=padded[1:-1,1:-1]&padded[:-2,1:-1]&padded[2:,1:-1]&padded[1:-1,:-2]&padded[1:-1,2:]
  visited=np.zeros_like(dark)
  for sy,sx in zip(*np.where(dark&alpha)):
   if visited[sy,sx]:continue
   todo=[(sy,sx)];visited[sy,sx]=True;component=[];boundary=False
   while todo:
    gy,gx=todo.pop();component.append((gy,gx));boundary |= not interior[gy,gx]
    for dy,dx in [(0,1),(0,-1),(1,0),(-1,0)]:
     ny,nx=gy+dy,gx+dx
     if 0<=ny<109 and 0<=nx<123 and dark[ny,nx] and alpha[ny,nx] and not visited[ny,nx]:visited[ny,nx]=True;todo.append((ny,nx))
   if boundary:
    for gy,gx in component:dark[gy,gx]=False
  pale=(rgb[:,:,0]>165)&(rgb[:,:,1]>140)&(rgb[:,:,2]>110)&((rgb[:,:,0]-rgb[:,:,2])<90)
  pink=(rgb[:,:,0]>150)&(rgb[:,:,1]<175)&(rgb[:,:,2]>60)&(rgb[:,:,2]>rgb[:,:,1]*.82)
  # Generated full eye and brow, not fur stripes: same broad ROIs for every frame.
  eye=(xx>=67)&(xx<=96)&(yy>=41)&(yy<=75)&(dark|pale|((rgb[:,:,0]>120)&(rgb[:,:,1]<150)&(rgb[:,:,2]<75)))
  brow=(xx>=66)&(xx<=95)&(yy>=40)&(yy<=57)&dark
  nose=(xx>=97)&(xx<=110)&(yy>=64)&(yy<=80)&pink
  mouth=(xx>=88)&(xx<=107)&(yy>=76)&(yy<=91)&(dark|pink)
  mask=(eye|brow|nose|mouth)&(a[:,:,3]>127)
  a[:,:,3]=np.where(mask,a[:,:,3],0);a[a[:,:,3]==0]=0
  generated=Image.fromarray(a); full=Image.new('RGBA',(192,192));full.alpha_composite(generated,(57,18))
  fa=np.array(full); fa[:,:,3]=np.minimum(fa[:,:,3],ba[:,:,3]);fa[fa[:,:,3]==0]=0;full=Image.fromarray(fa)
  feat=full.crop((FX,FY,FX+FW,FY+FH));atlas.paste(feat,(i%4*FW,i//4*FH));frames.append(feat)
  c=b.copy();c.alpha_composite(feat,(FX,FY));comb.paste(c,(i%4*192,i//4*192));featurebounds.append(full.getbbox())
  folder=O/f'frames/{action}';folder.mkdir(parents=True,exist_ok=True);feat.save(folder/f'{i:02}.png')
 atlas.save(M/f'face-{action}.png');atlas.save(O/f'face-{action}.png');comb.resize((1536,1152),Image.Resampling.NEAREST).save(O/f'qa/character-{action}-12.png')
 facecomb=Image.new('RGBA',(FW*4,FH*3))
 for i in range(12):
  c=b.copy();c.alpha_composite(frames[i],(FX,FY));facecomb.paste(c.crop((FX,FY,FX+FW,FY+FH)),(i%4*FW,i//4*FH))
 facecomb.resize((FW*16,FH*12),Image.Resampling.NEAREST).save(O/f'qa/face-{action}-12-4x.png')
 records[action]={'uniqueFrames':len(set(hashlib.sha256(f.tobytes()).hexdigest() for f in frames)),'sourceDimensions':list(s.size),'featureBounds':featurebounds};ALL.append(comb)
allc=Image.new('RGBA',(2304,768))
for row,action in enumerate(['working','idle','syncing','error']):
 for i in range(12):
  c=b.copy();c.alpha_composite(Image.open(O/f'frames/{action}/{i:02}.png'),(FX,FY));allc.paste(c,(i*192,row*192))
allc.save(O/'qa/four-actions-12-all.png')
(O/'qa/build.json').write_text(json.dumps({'faceRect':rect,'commonSourceMapping':{'scale':.32,'origin':[57,18],'perFrameTranslation':False},'actions':records},indent=2))
print(json.dumps(records,indent=2))
