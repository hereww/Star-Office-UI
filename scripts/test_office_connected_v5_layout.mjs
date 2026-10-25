/** Regression guard for the existing east-bank / structural-column clearance. */
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {normalizeBenchManifest,benchTransform} from '../frontend/company-office/connected-v5/furniture-contract.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const layout=JSON.parse(await readFile(resolve(root,'frontend/company-office/connected-v5/layout.json'),'utf8'));
const bank=layout.benches.find(b=>b.id==='east-connected');
const require=createRequire(process.env.OFFICE_QA_NODE_PACKAGE||'/Users/hepingyu/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json');
const {createCanvas,loadImage}=require('@napi-rs/canvas');
const pillar=[1158,588,80,110]; // Conservative bounds of the frozen background column and its shadow.

test('green bank keeps its 8-seat spacing, directions and view aligned after a rigid left shift',()=>{
 assert.deepEqual(bank.fit,[712,488,420,200]);
 const expectedX=[754,859,964,1069];
 for(const [offset,y,direction] of [[9,512,'down'],[13,639,'up']]){
  for(let i=0;i<4;i++){
   const station=layout.stations.find(s=>s.id===`desk-${String(offset+i).padStart(2,'0')}`);
   assert.deepEqual(station.center,[expectedX[i],y]);assert.equal(station.direction,direction);
  }
 }
 assert.deepEqual(layout.views.east.center,[915,577]);
 assert.deepEqual(layout.views.east.span,[560,380]);
 assert.deepEqual(layout.benches.find(b=>b.id==='west-connected').fit,[340,105,250,315]);
});

test('all nontransparent furniture pixels clear the existing structural column by at least 24 world units',async()=>{
 const path=resolve(root,'frontend/company-office/connected-v5',bank.manifest);
 const raw=JSON.parse(await readFile(path,'utf8')),manifest=normalizeBenchManifest(raw,bank);
 const transform=benchTransform(manifest,bank.fit);
 const image=await loadImage(resolve(dirname(path),manifest.image));
 const canvas=createCanvas(image.width,image.height),ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);
 const rgba=ctx.getImageData(0,0,image.width,image.height).data;
 let right=-1;
 for(let y=0;y<image.height;y++)for(let x=0;x<image.width;x++)if(rgba[(y*image.width+x)*4+3])right=Math.max(right,x+1);
 assert.ok(right>0);
 const worldRight=transform.x+right*transform.scale;
 assert.ok(pillar[0]-worldRight>=24,`Desk bank encroaches on the column: clearance=${pillar[0]-worldRight}`);
 for(const area of layout.forbidden??[]){
  const a=transform.alphaWorld,b=area.bounds;
  const overlap=a[0]<b[0]+b[2]&&a[0]+a[2]>b[0]&&a[1]<b[1]+b[3]&&a[1]+a[3]>b[1];
  assert.equal(overlap,false,`Green bank overlaps ${area.id}`);
 }
});
