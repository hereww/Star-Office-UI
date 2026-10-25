#!/usr/bin/env node
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),out=resolve(root,'assets/company-office-connected-v4/qa');
const require=createRequire('/Users/hepingyu/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json'),{chromium}=require('playwright');
const browser=await chromium.launch({channel:'chrome',headless:true});
const report={capturedAt:new Date().toISOString(),passed:0,failed:0,checks:[],scope:'Actual browser Canvas2D/WebGL candidate. All mutations page-local.'};
async function test(name,fn){try{const evidence=await fn();report.checks.push({name,pass:true,evidence});report.passed++;console.log('PASS',name);}catch(e){report.checks.push({name,pass:false,error:e.stack});report.failed++;console.error('FAIL',name,e.message);}}
try{
 const p=await browser.newPage({viewport:{width:1920,height:1080},deviceScaleFactor:2});
 await p.goto('http://127.0.0.1:19000/?scene=connected');await p.waitForFunction(()=>window.officeRuntime?.ready);
 await test('360 actual character samples change only the original facial region',async()=>{
  const results=await p.evaluate(async()=>{
   const {ConnectedSeatedPlayer}=await import('/static/company-office/connected-v4/seated-player.mjs');
   const r=window.officeRuntime;r.setDemoMode(true);const states=['idle','writing','researching','executing','syncing','error'],times=[0,84,167,250,334,417,500,584,667,750,834,917,1000,3000,5000],rows=[];
   for(const id of ['desk-01','desk-02','desk-09','desk-13']){
    const s=r.getStation(id),canvas=document.createElement('canvas');canvas.getContext('2d',{willReadFrequently:true});
    const player=await new ConnectedSeatedPlayer(canvas,r.assets,{baseUrl:r.baseUrl,direction:s.direction}).initialize();r.attachPlayerToBench(s,player);
    const c=player.spec.character,[x,y]=player.bodyPlacement(),scale=c.scale;
    player.setState('idle');player.sample(0);const reference=player.ctx.getImageData(0,0,192,192).data.slice();let outside=0,samples=0,max=0;
    const face=c.faceVisible===false?null:[x+c.faceRect[0]*scale-2,y+c.faceRect[1]*scale-2,c.faceRect[2]*scale+4,c.faceRect[3]*scale+4];
    for(const state of states)for(const t of times){player.setState(state);player.sample(t);samples++;let changes=0;const data=player.ctx.getImageData(0,0,192,192).data;for(let i=0;i<data.length;i+=4){const px=(i/4)%192,py=Math.floor(i/4/192);if(face&&px>=face[0]&&py>=face[1]&&px<=face[0]+face[2]&&py<=face[1]+face[3])continue;if(data[i]!==reference[i]||data[i+1]!==reference[i+1]||data[i+2]!==reference[i+2]||data[i+3]!==reference[i+3])changes++;}outside+=changes;max=Math.max(max,changes);}
    rows.push({id,direction:s.direction,samples,outsideFaceChanges:outside,maxPerSample:max,bodyPlacement:player.bodyPlacement(),faceVisible:c.faceVisible});
   }
   return rows;
  });
  assert.equal(results.reduce((n,r)=>n+r.samples,0),360);for(const row of results)assert.equal(row.outsideFaceChanges,0,row.id);return results;
 });
 await test('16 screen mappings: four rear LED-only displays and twelve visible fronts',async()=>{
  const x=await p.evaluate(()=>{const r=window.officeRuntime;return r.screenOverlays.map(s=>({snapshot:s.snapshot(),components:s.components.map(c=>({visible:c.config.visible,led:!!c.config.led,bounds:c.bounds}))}));});
  assert.equal(x.length,16);const back=x.filter(x=>x.snapshot.kind==='back');assert.equal(back.length,4);for(const b of back){assert.equal(b.components.length,1);assert.equal(b.components[0].visible,false);assert.equal(b.components[0].led,true);assert.deepEqual(b.snapshot.polygon,[]);}assert.equal(x.filter(s=>s.snapshot.thinSideScreen).length,8);return x;
 });
 await test('Each screen displays six different business-state patterns, all clipped to glass/LED',async()=>{
  const rows=await p.evaluate(()=>{
   const states=['idle','writing','researching','executing','syncing','error'],r=window.officeRuntime,out=[];
   function hash(data){let n=2166136261;for(const v of data){n^=v;n=Math.imul(n,16777619);}return (n>>>0).toString(16);}
   for(const overlay of r.screenOverlays){const images=[];let escaped=0;for(const state of states){overlay.sample(state,500,false);images.push(hash(Uint8Array.from(overlay.components.flatMap(c=>Array.from(c.ctx.getImageData(0,0,192,192).data)))));for(const c of overlay.components){const bytes=c.ctx.getImageData(0,0,192,192).data;if(!c.config.visible)continue;const path=new Path2D();path.moveTo(...c.config.polygon[0]);for(const point of c.config.polygon.slice(1))path.lineTo(...point);path.closePath();for(let py=1;py<191;py++)for(let px=1;px<191;px++){if(bytes[(py*192+px)*4+3]&& !c.ctx.isPointInPath(path,px+.5,py+.5)&& !c.ctx.isPointInPath(path,px,py)&& !c.ctx.isPointInPath(path,px+1,py+1))escaped++;}}}out.push({id:overlay.screen.seatId,kind:overlay.screen.kind,distinct:new Set(images).size,escaped});}
   return out;
  });
  for(const row of rows){assert.equal(row.distinct,6,row.id);assert.equal(row.escaped,0,row.id);}return rows;
 });
 await test('Character replacement and screen configuration failure are atomic and keep chair-only composition',async()=>{
  const x=await p.evaluate(async()=>{
   const r=window.officeRuntime,id='desk-01',s=r.getStation(id),c=structuredClone(s.player.spec.character),body=s.player.bodyPlacement();await r.replaceCharacter(c,{stationId:id});const same=s.player.snapshot();
   const before=r.snapshot().screens.find(s=>s.seatId===id),v=s.version;let rejected=false;try{r.replaceScreen(id,{kind:'front',polygon:[[0,0],[0,0],[0,0]]});}catch(e){rejected=true;}
   return {before,after:r.snapshot().screens.find(s=>s.seatId===id),rejected,same,body,bodyAfter:s.player.bodyPlacement(),playerType:s.player.constructor.name};
  });
  assert.equal(x.playerType,'ConnectedSeatedPlayer');assert.equal(x.same.furnitureMode,'chair-only');assert.deepEqual(x.bodyAfter,x.body);assert.equal(x.rejected,true);assert.deepEqual(x.after,x.before);return {playerType:x.playerType,rejectedInvalidScreen:true,bodyUnchanged:true};
 });
 await test('All 16 seats accept all four cardinal directions and six states without adding old desks',async()=>{
  const x=await p.evaluate(async()=>{
   const r=window.officeRuntime; r.setDemoMode(true);const checks=[];
   for(const station of r.stations){const original=station.direction;
    for(const direction of ['up','down','left','right']){
     await r.setStationDirection(station.id,direction);
     for(const state of ['idle','writing','researching','executing','syncing','error']){
      r.setStationState(station.id,state);station.player.sample(500);const p=station.player.snapshot();checks.push({id:station.id,direction:station.direction,expected:direction,state,actual:p.state,mode:p.furnitureMode,faceVisible:p.faceVisible});
     }
    }
    await r.setStationDirection(station.id,original);
   }
   return checks;
  });
  assert.equal(x.length,384);for(const row of x){assert.equal(row.direction,row.expected);assert.equal(row.actual,row.state);assert.equal(row.mode,'chair-only');assert.equal(row.faceVisible,row.direction!=='up');}return {combinations:x.length,allFourDirections:true,oldDesksAdded:false};
 });
 await test('Every original role, ID, room and server remains unchanged',async()=>{
  const x=await p.evaluate(async()=>{const old=await (await fetch('/static/company-office/reference-v3/layout.json')).json(),r=window.officeRuntime;return{old,current:r.layout};});
  for(const k of ['size','mainStation','rooms','server','forbidden','binding','guestSlots','reserved']){
   if(k==='server'){const old={...x.old.server},current={...x.current.server};delete old.asset;delete current.asset;assert.deepEqual(current,old);}
   else assert.deepEqual(x.current[k],x.old[k],k);
  }
  for(const s of x.old.stations){const n=x.current.stations.find(x=>x.id===s.id);for(const k of ['id','name','role','region','group'])assert.equal(n[k],s[k],`${s.id}.${k}`);}
  return {seats:16,rooms:x.old.rooms.length,unchanged:true};
 });
}finally{await browser.close();await mkdir(out,{recursive:true});await writeFile(resolve(out,'pixel-qa.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:report.passed,failed:report.failed}));}
process.exitCode=report.failed?1:0;
