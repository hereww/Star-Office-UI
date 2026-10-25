#!/usr/bin/env node
// Browser QA draws GENERATED BITMAPS only; the existing screen-effects module owns screen pixels.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {chromium}=require('playwright');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../../..');
const asset=path.join(root,'assets/company-office-reference-v3/furniture');
const media=path.join(root,'frontend/company-office/reference-v3/media/furniture');
const manifest=JSON.parse(await fs.readFile(path.join(media,'manifest.json'),'utf8'));
const source=(await fs.readFile(path.join(root,'frontend/company-office/reference-v3/screen-effects.mjs'),'utf8')).replace(/\bexport\s+/g,'');
const imageData={};
for(const d of ['up','down','left','right']){
 imageData[d]={};
 for(const layer of ['back','front'])imageData[d][layer]='data:image/png;base64,'+(await fs.readFile(path.join(media,`${d}-${layer}.png`))).toString('base64');
}
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1390},deviceScaleFactor:1});
 await page.setContent(`<html lang="zh"><head><meta charset="utf-8"><style>body{margin:0;background:#f2efe7;color:#263634;font:16px system-ui}h1{margin:24px 26px 4px;font-size:23px}p{margin:0 26px 18px;font-size:13px}.grid{display:grid;grid-template-columns:104px repeat(4,308px);gap:12px;margin:0 24px 24px}.label{padding-top:20px}figure{margin:0}figcaption{height:24px}canvas{width:288px;height:288px;background:#e8e6df;image-rendering:pixelated;display:block;border:1px solid #d7d3c7}.col{font-weight:650}</style></head><body><h1>V3 · generated furniture / alpha layers / calibrated screen masks</h1><p>Full 192×192 logical canvases. No actors in this preview. Browser draws supplied bitmaps + existing screen-effects only.</p><div class="grid" id="grid"><div></div><div class="col">UP · front glass</div><div class="col">DOWN · rear LED only</div><div class="col">LEFT · chair right</div><div class="col">RIGHT · chair left</div></div></body></html>`);
 const results=await page.evaluate(async ({manifest,imageData,source})=>{
  const api=new Function(source+'\nreturn {validateScreenConfig,sampleScreenEffects,drawScreenEffects};')();
  const directions=['up','down','left','right'];
  const loaded={};
  for(const d of directions){loaded[d]={};for(const layer of ['back','front']){const image=new Image();image.src=imageData[d][layer];await image.decode();loaded[d][layer]=image;}}
  const report={passed:true,states:{},screenEffectsModule:'current read-only reference-v3/screen-effects.mjs',outsideMaskChangedPixels:0};
  for(const state of ['static','writing','syncing','error']){
   const title=document.createElement('div');title.className='label';title.textContent=state;document.getElementById('grid').append(title);
   report.states[state]={};
   for(const d of directions){
    const f=manifest.directions[d].furniture;const figure=document.createElement('figure');const c=document.createElement('canvas');c.width=c.height=192;figure.append(c);document.getElementById('grid').append(figure);
    const ctx=c.getContext('2d',{willReadFrequently:true});ctx.imageSmoothingEnabled=false;
    const drawStatic=()=>{ctx.clearRect(0,0,192,192);ctx.drawImage(loaded[d].back,0,0);ctx.drawImage(loaded[d].front,0,0)};
    drawStatic();const before=ctx.getImageData(0,0,192,192).data.slice();
    if(state!=='static'){
     ctx.clearRect(0,0,192,192);
     for(const layer of f.order){if(layer==='actor')continue;if(layer==='screen')api.drawScreenEffects(ctx,api.sampleScreenEffects(f.screen,state,1000/3));else ctx.drawImage(loaded[d][layer],0,0);}
    }
    const after=ctx.getImageData(0,0,192,192).data;
    const mask=new Path2D();const polygon=f.screen.polygon;mask.moveTo(...polygon[0]);for(const point of polygon.slice(1))mask.lineTo(...point);mask.closePath();
    let changed=0,outside=0;
    for(let y=0;y<192;y++)for(let x=0;x<192;x++){
     const i=(y*192+x)*4;const delta=[0,1,2,3].some(ch=>before[i+ch]!==after[i+ch]);
     if(!delta)continue;changed++;
     const [lx,ly,lw,lh]=f.screen.led;
     // One-pixel boundary tolerance covers Canvas anti-aliasing of fractional mask corners.
     const inLed=x>=lx-1&&x<=lx+lw&&y>=ly-1&&y<=ly+lh;
     const inGlass=f.screen.visible&&[[-1,-1],[0,0],[1,1],[-1,1],[1,-1]].some(([dx,dy])=>ctx.isPointInPath(mask,x+0.5+dx,y+0.5+dy));
     if(!inLed&&!inGlass)outside++;
    }
    report.outsideMaskChangedPixels+=outside;report.passed&&=outside===0;
    if(d==='down'&&state!=='static')report.passed&&=changed<=8;
    report.states[state][d]={changedPixels:changed,outsideMaskChangedPixels:outside,rearLedOnly:d==='down',visible:f.screen.visible};
   }
  }
  return report;
 },{manifest,imageData,source});
 await page.screenshot({path:path.join(asset,'qa/browser-furniture-screen-qa.png'),fullPage:true});
 await fs.writeFile(path.join(asset,'qa/browser-qa.json'),JSON.stringify(results,null,2)+'\n');
 assert.equal(results.passed,true,'Screen effects escaped the calibrated masks');
 console.log(JSON.stringify({passed:results.passed,outsideMaskChangedPixels:results.outsideMaskChangedPixels,states:results.states},null,2));
}finally{await browser.close()}
