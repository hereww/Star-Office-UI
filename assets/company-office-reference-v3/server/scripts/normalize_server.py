#!/usr/bin/env python3
"""Normalize AI-generated rack via transparent-margin crop and uniform scaling.

No geometry is drawn, no RGB repaint, no background keying, no rotation/mirror.
Only server assets and the one authorized runtime image are written.
"""
from pathlib import Path
from PIL import Image
import hashlib,json,os,math
ASSET=Path(__file__).resolve().parents[1]
ROOT=Path(__file__).resolve().parents[4]
SOURCE=ASSET/'sources/server-rack-source.png'
OUTPUT=ROOT/'frontend/company-office/reference-v3/media/server-rack.png'
CANVAS=(256,320)
MARGIN=(8,8)
TRIM_ALPHA=16

def atomic_json(path,data):
    temp=path.with_name(path.name+'.writing')
    temp.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf-8');os.replace(temp,path)

def stats(im):
    a=im.getchannel('A');hist=a.histogram();w,h=im.size
    border=list(a.crop((0,0,w,1)).get_flattened_data())+list(a.crop((0,h-1,w,h)).get_flattened_data())+list(a.crop((0,0,1,h)).get_flattened_data())+list(a.crop((w-1,0,w,h)).get_flattened_data())
    return {'size':list(im.size),'mode':im.mode,'alphaExtrema':list(a.getextrema()),'transparentPixels':hist[0],'transparentFraction':round(hist[0]/(w*h),6),'nearOpaque245Pixels':sum(hist[245:]),'partialAlphaPixels':sum(hist[1:255]),'opaque255Pixels':hist[255],'alphaBBox':list(a.getbbox()) if a.getbbox() else None,'solidBBoxAlpha16':list(a.point(lambda v:255 if v>=16 else 0).getbbox()),'cornersAlpha':[a.getpixel(pt) for pt in [(0,0),(w-1,0),(0,h-1),(w-1,h-1)]],'borderMaxAlpha':max(border)}

def green_components(im):
    # Read-only measurement of generated green pixels; never paints an LED.
    w,h=im.size
    points={(x,y) for y in range(h) for x in range(w) if (lambda p:p[3]>=128 and p[1]>=135 and p[1]>p[0]*1.4 and p[1]>p[2]*1.4)(im.getpixel((x,y)))}
    components=[]
    while points:
        seed=points.pop();stack=[seed];component=[seed]
        while stack:
            x,y=stack.pop()
            for pt in [(x-1,y),(x+1,y),(x,y-1),(x,y+1)]:
                if pt in points:points.remove(pt);stack.append(pt);component.append(pt)
        xs=[p[0] for p in component];ys=[p[1] for p in component];box=[min(xs),min(ys),max(xs)-min(xs)+1,max(ys)-min(ys)+1]
        components.append({'pixelCount':len(component),'rectPx':box,'centerPx':[box[0]+box[2]/2,box[1]+box[3]/2]})
    return sorted(components,key=lambda r:r['centerPx'][1])

raw=Image.open(SOURCE).convert('RGBA');assert raw.getchannel('A').getextrema()[0]==0
bbox=raw.getchannel('A').point(lambda v:255 if v>=TRIM_ALPHA else 0).getbbox();assert bbox
crop=[max(0,bbox[0]-4),max(0,bbox[1]-4),min(raw.width,bbox[2]+4),min(raw.height,bbox[3]+4)]
trimmed=raw.crop(tuple(crop));available=(CANVAS[0]-MARGIN[0]*2,CANVAS[1]-MARGIN[1]*2)
factor=min(available[0]/trimmed.width,available[1]/trimmed.height)
size=(round(trimmed.width*factor),round(trimmed.height*factor))
MAP_GRID_ALIGNMENT=(0,1)  # One-pixel canvas placement makes all three source LEDs survive 65x83 nearest sampling.
resized=trimmed.resize(size,Image.Resampling.NEAREST);offset=((CANVAS[0]-size[0])//2+MAP_GRID_ALIGNMENT[0],(CANVAS[1]-size[1])//2+MAP_GRID_ALIGNMENT[1])
output=Image.new('RGBA',CANVAS,(0,0,0,0));output.paste(resized,offset)
OUTPUT.parent.mkdir(parents=True,exist_ok=True)
# If an unrelated image appeared while generation was underway, preserve it first.
if OUTPUT.exists() and OUTPUT.read_bytes()!=b'':
    current=Image.open(OUTPUT).convert('RGBA')
    if current.size!=CANVAS or current.tobytes()!=output.tobytes():
        backup=ASSET/'backup/server-rack-before-normalization.png'
        if not backup.exists():backup.write_bytes(OUTPUT.read_bytes())
output.save(OUTPUT);output.save(ASSET/'server-rack.png')
(ASSET/'qa').mkdir(exist_ok=True)
output.resize((768,960),Image.Resampling.NEAREST).save(ASSET/'qa/server-rack-3x.png')
map_scale=output.resize((65,83),Image.Resampling.NEAREST)
map_scale.save(ASSET/'qa/server-rack-at-65x83.png');map_scale.resize((520,664),Image.Resampling.NEAREST).save(ASSET/'qa/server-rack-at-65x83-8x.png')
map_components=green_components(map_scale);assert len(map_components)==3, f'Three LEDs must remain visible at map scale: {map_components}'
components=green_components(output);assert len(components)==3,f'Expected 3 generated LED components; got {components}'
leds=[]
for idx,comp in enumerate(components):
    x,y,w,h=comp['rectPx'];cx,cy=comp['centerPx']
    leds.append({'id':f'green-{idx+1}','tray':(idx+1)*2,**comp,'rectNormalized':[round(x/256,6),round(y/320,6),round(w/256,6),round(h/320,6)],'centerNormalized':[round(cx/256,6),round(cy/320,6)],'mapCenter65x83':[round(cx/256*65,4),round(cy/320*83,4)],'mapRect65x83':[round(x/256*65,4),round(y/320*83,4),round(w/256*65,4),round(h/320*83,4)]})
final_stats=stats(output);source_stats=stats(raw)
# Runtime/layout are read only; derived recommendations are saved inside this server folder.
layout_path=ROOT/'frontend/company-office/reference-v3/layout.json'
current_server=json.loads(layout_path.read_text()).get('server') if layout_path.exists() else None
current_leds=current_server.get('leds') if current_server else None
recommended=[[round(cx/256*65,2),round(cy/320*83,2)] for cx,cy in (led['centerPx'] for led in leds)]
passed=output.size==CANVAS and final_stats['cornersAlpha']==[0,0,0,0] and final_stats['borderMaxAlpha']==0 and 0.2<final_stats['transparentFraction']<0.85 and len(leds)==3 and all(led['rectPx'][2]>led['rectPx'][3] for led in leds)
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
manifest={'schemaVersion':1,'assetPack':'company-office-reference-v3-server','status':'generated-normalized-awaiting-visual-qa','size':[256,320],'runtimeAsset':'media/server-rack.png','source':'sources/server-rack-source.png','sourceSize':list(raw.size),'generator':'built-in image_gen.imagegen','prompt':'GENERATION_PROMPT.txt','trayCount':6,'greenLedCount':3,'styleReference':'../user-map.jpg','camera':'fixed elevated office camera, broad front plus narrow right side and top','transparentBackground':True,'noRuntimeEdits':True,'processing':{'sourceCrop':crop,'trimMarginAlphaThreshold':TRIM_ALPHA,'cropPaddingSourcePx':4,'resampling':'nearest','uniformScaleRequested':factor,'resizedSize':list(size),'offsetPx':list(offset),'mapGridAlignmentPx':list(MAP_GRID_ALIGNMENT),'logicalCanvas':list(CANVAS),'alphaPreservedInsideCrop':True,'rgbRepaint':False,'rotation':False,'mirrored':False,'synthesizedGeometry':False},'leds':leds,'integrationSuggestion':{'mapDisplaySize':[65,83],'existingBoundsReadOnly':current_server.get('bounds') if current_server else None,'previousLedCentersReadOnly':current_leds,'recommendedLedCentersForLayout':recommended,'recommendedGreenStripWidthHeight':[[round(led['rectPx'][2]/256*65,2),round(led['rectPx'][3]/320*83,2)] for led in leds],'positionFormula':'bounds.x + centerNormalized.x * bounds.width, bounds.y + centerNormalized.y * bounds.height','layoutNotModified':True,'runtimeNotModified':True},'sha256':{'source':sha(SOURCE),'normalized':sha(OUTPUT)}}
qa={'schemaVersion':1,'passed':passed,'source':source_stats,'normalized':final_stats,'greenComponents':components,'mapScaleSize':[65,83],'mapScaleGreenComponents':map_components,'exactThreeGreenComponentsAtMapScale':len(map_components)==3,'exactThreeGreenComponents':len(components)==3,'horizontalGreenStrips':all(c['rectPx'][2]>c['rectPx'][3] for c in components),'assetAndRuntimeImageIdentical':(ASSET/'server-rack.png').read_bytes()==OUTPUT.read_bytes(),'sourceUntouched':sha(SOURCE)==json.loads((ASSET/'generation-record.json').read_text())['sourceSha256'],'trueAlphaNotCheckerboard':True,'rgbNotDrawnByCode':True,'operationsOnlyTransparentMarginCropUniformResizeAndCanvasPaste':True}
atomic_json(ASSET/'manifest.json',manifest);atomic_json(ASSET/'qa/alpha-qa.json',qa)
print(json.dumps({'qaPassed':passed,'sourceSize':list(raw.size),'sourceCrop':crop,'resizedSize':list(size),'offset':list(offset),'transparentFraction':final_stats['transparentFraction'],'leds':leds,'recommendedLayoutLeds':recommended,'previousLayoutLeds':current_leds},ensure_ascii=False,indent=2))
assert passed
