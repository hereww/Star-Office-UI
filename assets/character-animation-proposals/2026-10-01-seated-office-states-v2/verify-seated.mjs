// Small asset/renderer contract check. Visual acceptance still belongs to the user.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {SeatedOfficePlayer,BUSINESS_STATES} from './seated-compositor.mjs';
const sharp=createRequire(import.meta.url)('sharp');
const root=path.dirname(fileURLToPath(import.meta.url));
const config=JSON.parse(await fs.readFile(path.join(root,'office-assets.json')));
assert.equal(config.animationMode,'expression-only');
assert.equal(config.fps,12);assert.equal(config.faceClockFrames,60);
assert.equal(config.character.hands,undefined);
const images={},assets=[];
for(const name of [config.character.base,config.workstation.back,config.workstation.front,...Object.values(config.character.actions).map(a=>a.face)]){
  const file=path.join(root,name),meta=await sharp(file).metadata();
  const {data,info}=await sharp(file).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const isFace=name.includes('/face-'),expected=isFace?[360,174]:[192,192];
  assert.deepEqual([meta.width,meta.height],expected,name);assert(meta.hasAlpha,name);
  let empty=0,visible=0;
  for(let i=3;i<data.length;i+=4){if(data[i]===0)empty++;else visible++;}
  assert(visible>0,name+' must contain artwork');
  let sourceAlpha;
  if(isFace){
    // Local face patches can be opaque after a tight crop; the renderer clips their
    // outer boundary. Verify genuine transparency on the retained generation source.
    const source=path.join(root,'source',path.basename(name,'.png')+'-original.png');
    const original=await sharp(source).metadata();
    const {data:raw}=await sharp(source).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    let transparent=0,artwork=0;for(let i=3;i<raw.length;i+=4){if(raw[i]===0)transparent++;else artwork++;}
    assert(original.hasAlpha&&transparent>0&&artwork>0,'generated original must have genuine alpha');
    sourceAlpha={size:[original.width,original.height],transparentPixels:transparent,visiblePixels:artwork};
  }else assert(empty>0,name+' must contain transparent background');
  if(isFace)for(let frame=0;frame<12;frame++){
    let count=0;for(let y=Math.floor(frame/4)*58;y<(Math.floor(frame/4)+1)*58;y++)for(let x=frame%4*90;x<(frame%4+1)*90;x++)if(data[(y*info.width+x)*4+3])count++;
    assert(count>0,`${name} frame ${frame} empty`);
  }
  images[name]={width:meta.width,height:meta.height,name};
  assets.push({name,size:expected,transparentPixels:empty,visiblePixels:visible,sourceAlpha,boundary:isFace?'fixed runtime ellipse clip':'PNG alpha',sha256:createHash('sha256').update(await fs.readFile(file)).digest('hex')});
}
let calls=[];
const context={clearRect(){calls=[]},drawImage(image,...args){calls.push({name:image.name,args})},save(){},beginPath(){},ellipse(){},clip(){},restore(){}};
const canvas={getContext(){return context}};
const player=await new SeatedOfficePlayer(canvas,config,{baseUrl:import.meta.url,imageLoader:async url=>images[path.relative(root,fileURLToPath(url))]}).initialize();
assert.equal(Object.keys(player.images).length,7,'only body, two furniture layers, four expressions loaded');
let fixedDraws,checkedFrames=0;
for(const [state,action] of Object.entries(BUSINESS_STATES)){
  player.setState(state);assert.equal(player.action(),action);
  for(let frame=0;frame<12;frame++){
    player.setFrame(frame);
    const stable=calls.filter(c=>!c.name.includes('/face-'));
    fixedDraws??=stable;assert.deepEqual(stable,fixedDraws,`${state}:${frame} moved fixed assets`);
    assert.equal(calls.length,4);assert(!calls.some(c=>c.name.includes('hands')));
    assert.equal(player.snapshot().handsRendered,false);checkedFrames++;
  }
}
player.setState('idle');player.sample(1500);assert.equal(player.faceFrame,0);player.sample(3000+5*1000/12+.1);assert.equal(player.faceFrame,5);
player.setState('writing');player.sample(1250);assert.equal(player.faceFrame,0);
player.setState('error');player.sample(1250);assert.equal(player.faceFrame,3);
player.sample(1000);assert.equal(player.faceFrame,0);player.sample(5000);assert.equal(player.faceFrame,0);player.sample(5000+5*1000/12+.1);assert.equal(player.faceFrame,5);
player.faceEnabled=false;player.setFrame(0);const unchanged=structuredClone(calls);player.setFrame(5);assert.deepEqual(calls,unchanged);
assert.throws(()=>player.setState('working'));assert.throws(()=>player.setFrame(12));
const old=path.join(root,'../2026-10-01-modular-office-v1');
const reused=[['media/character-base.png','frames/01.png'],['media/workstation-back.png','media/workstation-back.png'],['media/workstation-front.png','media/workstation-front.png']];
for(const [next,previous] of reused)assert.deepEqual(await fs.readFile(path.join(root,next)),await fs.readFile(path.join(old,previous)),next+' changed');
const report={checkedAt:new Date().toISOString(),passed:true,animationMode:'expression-only',assets,checkedFrames,fixedDraws,staticBaseAndFurnitureByteIdenticalToV1:true,handsLoaded:false,handsDrawn:false,expressionDisabledDrawsIdentical:true,stateMap:BUSINESS_STATES,productionReady:false,visualAcceptance:config.visualApproved?'approved_by_user':'pending user review',visualApproved:config.visualApproved??false,secondCharacterSwapTested:false,expressionClockFrames:{working:60,idle:36,syncing:60,error:12}};
await fs.writeFile(path.join(root,'qa-assets.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({passed:true,checkedFrames,loadedImages:7,noHands:true,fixedBodyAndFurniture:true}));
