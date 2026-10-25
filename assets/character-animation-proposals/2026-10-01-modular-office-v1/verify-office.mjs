import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {OfficeCompositor,validateCharacter,BUSINESS_STATES} from './office-compositor.mjs';
const require=createRequire(import.meta.url),sharp=require('sharp');
const config=JSON.parse(await readFile(new URL('./office-assets.json',import.meta.url)));
const alpha=[];
for(const filename of ['source/workstation-layers-original.png','source/orange-cat-working-original.png','media/workstation-back.png','media/workstation-front.png',...Array.from({length:12},(_,i)=>`frames/${String(i+1).padStart(2,'0')}.png`)]){
  const file=new URL(filename,import.meta.url);
  const {data,info}=await sharp(fileURLToPath(file)).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  let transparent=0,opaque=0,painted=0;
  for(let p=0;p<data.length;p+=4){if(data[p+3]===0)transparent++;if(data[p+3]===255)opaque++;if(data[p+3]>0)painted++;}
  assert(transparent>info.width*info.height*.05,`${filename}: needs true alpha`);
  assert(painted>30,`${filename}: needs artwork`);
  alpha.push({file:filename,width:info.width,height:info.height,transparentPixels:transparent,opaquePixels:opaque,
    sha256:createHash('sha256').update(await readFile(file)).digest('hex')});
}
assert.equal(new Set(alpha.filter(f=>f.file.startsWith('frames/')).map(f=>f.sha256)).size,12,'not copied stills');
let calls=[];
const context={clearRect(){calls=[];},drawImage(image,...args){calls.push({image:image.key,args});},
  beginPath(){},moveTo(){},lineTo(){},stroke(){},strokeRect(){},save(){},restore(){},rect(){},clip(){}};
const canvas={getContext(){return context;}};
const imageLoader=async url=>{const meta=await sharp(fileURLToPath(url)).metadata();return {width:meta.width,height:meta.height,key:meta.width===768?'actor':url.includes('-front')?'front':'back'}};
const compositor=new OfficeCompositor(canvas,config.workstation,{baseUrl:import.meta.url,imageLoader});
await compositor.initialize();await compositor.registerCharacter(config.characters[0]);compositor.setCharacter('orange-cat');
const furnitureCalls=[];
for(const state of Object.keys(BUSINESS_STATES)){
  compositor.setState(state);
  for(let frame=0;frame<12;frame++){
    compositor.setFrame(frame);
    const furniture=calls.filter(c=>c.image!=='actor');furnitureCalls.push(JSON.stringify(furniture));
    assert.equal(calls.filter(c=>c.image==='actor').length,['writing','researching','executing'].includes(state)?2:0);
  }
}
assert.equal(new Set(furnitureCalls).size,1,'same static furniture at all states/frames');
compositor.setCharacter(null);assert.equal(calls.length,2);
const fixture=structuredClone(config.characters[0]);fixture.id='replacement-contract-fixture';fixture.scale=.45;fixture.poseAnchor=[120,130];
await compositor.registerCharacter(fixture);compositor.setState('writing');compositor.setCharacter(fixture.id);
assert.deepEqual(calls.filter(c=>c.image!=='actor'),JSON.parse(furnitureCalls[0]),'changing actor geometry must not move station');
assert.equal(compositor.snapshot().characterId,fixture.id);
const actorDraw=calls.find(c=>c.image==='actor');assert.equal(actorDraw.args[4],96-120*.45);assert.equal(actorDraw.args[5],94-130*.45);
compositor.sample(500);assert.equal(compositor.frame,6);compositor.sample(1000);assert.equal(compositor.frame,0);
assert.throws(()=>compositor.setState('working'),/六种/);assert.throws(()=>compositor.setFrame(12));
for(const bad of [{direction:'left'},{poseAnchor:[NaN,2]},{scale:0},{actions:{working:{...fixture.actions.working,frameCount:10}}}])
  assert.throws(()=>validateCharacter({...fixture,...bad},config.workstation));
const before=[...compositor.characters.keys()];
await assert.rejects(compositor.registerCharacter({...fixture,id:'broken-dimensions',actions:{working:{...fixture.actions.working,frameSize:[96,96]}}}),/尺寸/);
assert.deepEqual([...compositor.characters.keys()],before,'bad registry entry is atomic');
assert.deepEqual(config.businessStateToAction,BUSINESS_STATES);
const result={passed:true,tested:['true-alpha','12-distinct-frame-files','4x3-grid-size','same-static-furniture-in-72-state-frame-combinations','character-slot-removal','replacement-registration-with-different-pose-anchor-scale','original-six-state-mapping-and-unavailable-action','deterministic-12fps-sampling','direction-frame-geometry-input-validation','invalid-registration-keeps-registry'],
  alpha,visualAcceptance:false,productionReady:false,limitation:'结构测试不证明手部接触键盘或动作视觉合格；替换测试用同一图集的接口fixture，不是第二个真实角色。'};
await writeFile(new URL('./qa-assets.json',import.meta.url),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({passed:result.passed,tested:result.tested,distinctFrames:12},null,2));
