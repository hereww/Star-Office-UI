#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {validateDirectionalAssets} from '../../../../frontend/company-office/reference-v3/directional-player.mjs';
import {validateScreenConfig,sampleScreenEffects} from '../../../../frontend/company-office/reference-v3/screen-effects.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../../..');
const folder=path.join(root,'assets/company-office-reference-v3/furniture');
const media=path.join(root,'frontend/company-office/reference-v3/media/furniture');
const v3=path.dirname(path.dirname(media));
const manifest=JSON.parse(await fs.readFile(path.join(media,'manifest.json'),'utf8'));
const directions=['up','down','left','right'];
assert.deepEqual(Object.keys(manifest.directions),directions);
const legacy=JSON.parse(await fs.readFile(path.join(root,'frontend/company-office/office-assets.json'),'utf8'));
const clocks={working:60,idle:36,syncing:60,error:12};
const schemaProbe={fps:12,frameCount:12,grid:[4,3],faceClockFrames:60,directions:{}};
const result={passed:true,scope:'Furniture-only interface/geometry/effect-sampling checks. Character declarations are schema probes, not actor acceptance or integration.',directions:{}};
for(const d of directions){
  const {furniture:f}=manifest.directions[d];
  assert.deepEqual(f.size,[192,192]);assert.equal(f.seatAnchor.length,2);
  assert.equal(f.screen.polygon.length,4);validateScreenConfig(f.screen);
  for(const layer of ['back','front']){
    assert.equal(f[layer],`media/furniture/${d}-${layer}.png`);
    await fs.access(path.resolve(v3,f[layer]));
  }
  assert.deepEqual([...f.order].sort(),['actor','back','front','screen']);
  assert.equal(f.order.indexOf('back')<f.order.indexOf('actor'),true);
  assert.equal(f.order.indexOf('actor')<f.order.indexOf('front'),true);
  const c=structuredClone(legacy.character);c.direction=d;c.faceVisible=d!=='up';c.id=`schema-probe-${d}`;
  for(const action of Object.keys(clocks))c.actions[action].faceClockFrames=clocks[action];
  schemaProbe.directions[d]={character:c,furniture:f};
  let samples=0;
  for(const state of ['idle','writing','researching','executing','syncing','error']){
    for(const reducedMotion of [false,true]){
      for(const ms of [0,83.333,333.34,916.67,2000,4916.67]){
        const e=sampleScreenEffects(f.screen,state,ms,{reducedMotion});
        assert.equal(e.visible,d!=='down');
        if(d==='down')assert.deepEqual(e.polygon,[]);
        if(reducedMotion){assert.equal(e.phase,0);assert.equal(e.reducedMotion,true);}
        samples++;
      }
    }
  }
  result.directions[d]={passed:true,samplesChecked:samples,size:f.size,seatAnchor:f.seatAnchor,order:f.order,screenVisible:f.screen.visible,pathsResolvedFromV3:true};
}
validateDirectionalAssets(schemaProbe);
result.currentPlayerSchemaAccepted=true;
result.totalScreenSamples=Object.values(result.directions).reduce((n,r)=>n+r.samplesChecked,0);
result.alphaQa=JSON.parse(await fs.readFile(path.join(folder,'qa/alpha-qa.json'),'utf8')).passed;
assert.equal(result.alphaQa,true);
await fs.writeFile(path.join(folder,'qa/interface-qa.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
