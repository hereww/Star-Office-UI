#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { validateDirectionalAssets } from '../frontend/company-office/reference-v3/directional-player.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const base=resolve(root,'frontend/company-office/reference-v3');
const read=p=>JSON.parse(readFileSync(p,'utf8'));
const old=read(resolve(base,'../office-assets.json'));
const furniture=read(resolve(base,'media/furniture/manifest.json'));
const up=read(resolve(base,'media/character-up/manifest.json')).character;
const down=structuredClone(old.character);
down.base='../'+down.base;down.faceVisible=true;down.headAnchor=[100,30];
for(const [name,a]of Object.entries(down.actions)){a.face='../'+a.face;a.faceClockFrames={working:60,idle:36,syncing:60,error:12}[name];}
const directions={};
for(const d of ['up','down','left','right']){
 let character;
 if(d==='down')character=down;
 else if(d==='up')character=up;
 else{
  const repaired=resolve(base,`media/character-${d}/${d==='right'?'repair-v4-aligned':'repair-v2'}/manifest.json`);
  if(!existsSync(repaired))throw new Error(`等待 ${d} 修复资源，不允许自动接入被拒候选`);
  const manifest=read(repaired);
  if(manifest.integrationAllowed===false||manifest.doNotIntegrate===true||manifest.status?.includes('reject'))throw new Error(`${d}资源尚未通过技术及视觉组合验收`);
  character=manifest.character;
 }
 if(d==='left')character.headAnchor=[96,16];
 // The rebuilt right pack carries its own calibrated anchors; never overwrite
 // them with the rejected v2/v3 head offset. Geometry is part of the asset pack.
 if(d==='right'&&(!Array.isArray(character.headAnchor)||character.headAnchor.length!==2||!character.headAnchor.every(Number.isFinite)))throw new Error('新右向资源缺少校准的headAnchor');
 directions[d]={character,furniture:furniture.directions[d].furniture};
}
const assets={schemaVersion:3,animationMode:'expression-only',status:'integrated-reference-v3',fps:12,frameCount:12,grid:[4,3],faceClockFrames:60,businessStateToAction:old.businessStateToAction,sourceTemplate:old.sourceTemplate,character:down,directions,freeze:old.freeze,walking:false};
validateDirectionalAssets(assets);
writeFileSync(resolve(base,'assets.json'),JSON.stringify(assets,null,2)+'\n');
console.log('Built four-direction assets configuration with preserved frontal source.');
