from pathlib import Path
from PIL import Image
import shutil,json,hashlib
R=Path('/Users/hepingyu/Documents/ChatGPT/Star-Office-UI')
O=R/'assets/company-office-reference-v3/character-right/repair-v4-aligned'
M=R/'frontend/company-office/reference-v3/media/character-right/repair-v4-aligned'
b=Image.open(R/'frontend/company-office/reference-v3/media/character-right/repair-v2/base-neutral.png').convert('RGBA')
# Numerical crop and common nearest enlargement for imagegen reference only.
b.save(O/'references/base-neutral.png');b.save(M/'base.png')
b.resize((1152,1152),Image.Resampling.NEAREST).save(O/'references/base-neutral-6x.png')
# Full head INCLUDING the whole muzzle; previous 90x58 cropped at y118.
rect=(62,28,110,98)
x,y,w,h=rect
f=b.crop((x,y,x+w,y+h));f.resize((880,784),Image.Resampling.NEAREST).save(O/'references/head-reference-8x.png')
a=Image.new('RGBA',(w*4,h*3))
for i in range(12):a.paste(f,(i%4*w,i//4*h))
a.resize((1760,1176),Image.Resampling.NEAREST).save(O/'references/head-grid-template.png')
(O/'qa/reference.json').write_text(json.dumps({'rect':rect,'baseSha256':hashlib.sha256((M/'base.png').read_bytes()).hexdigest()},indent=2))
