#!/usr/bin/env node
/** Isolated local Chromium acceptance using the production map/telemetry path. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {homedir} from 'node:os';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=path.resolve(process.env.OFFICE_ANIMATION_QA_DIR||path.join(root,'.local/qa/animation-repair'));
const require=createRequire(process.env.OFFICE_QA_NODE_PACKAGE||path.join(homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json'));
const {chromium}=require('playwright');
fs.mkdirSync(output,{recursive:true});
const frontend=path.join(root,'frontend');
const mime={'.mjs':'text/javascript','.js':'text/javascript','.json':'application/json','.png':'image/png','.webp':'image/webp','.css':'text/css','.woff2':'font/woff2','.ttf':'font/ttf'};
const server=http.createServer((req,res)=>{
 if(req.method!=='GET'){res.writeHead(405);return res.end();}
 const pathname=new URL(req.url,'http://localhost').pathname;
 if(pathname==='/'){res.setHeader('Content-Type','text/html');return res.end('<!doctype html><meta charset="utf-8"><title>Office animation QA</title><style>body{margin:0;background:#ecebe5;font:16px system-ui}#host{width:1400px;height:900px}canvas{image-rendering:pixelated}</style><div id="host"></div>');}
 const file=path.resolve(frontend,'.'+pathname);
 if(!file.startsWith(frontend+path.sep)){res.writeHead(403);return res.end();}
 try{res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));}catch{res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
let browser;const report={scope:'Local production map-loader and telemetry adapter; no backend writes or deployment.',checks:[],errors:[],responses:[]};
try{
 browser=await chromium.launch({channel:'chrome',headless:true});
 const page=await browser.newPage({viewport:{width:1400,height:900},deviceScaleFactor:1});
 page.on('pageerror',e=>report.errors.push(e.message));
 page.on('response',r=>{if(r.status()>=400)report.responses.push([r.status(),r.url()]);});
 await page.route('**/*',route=>{const r=route.request();return r.method()==='GET'&&new URL(r.url()).origin===origin?route.continue():route.abort();});
 await page.goto(origin);
 await page.evaluate(async()=>{
  const {createOfficeMap}=await import('/office/map-loader.mjs');
  window.qaMap=await createOfficeMap(document.querySelector('#host'),{releasePrefix:new URL('/office/',location).href},{mode:'demo'});
  window.qaMap.runtime.scene.game.loop.stop();
 });
 const room=await page.evaluate(()=>{
  const h=window.qaMap,r=h.runtime,room=r.rockRoomAnimation;
  h.applyDisplaySettings({reduced_motion:'off'});
  const sample=t=>{r.scene.time.now=t;r.adapter.update(t);return room.performers.map(p=>Number(p.sprite.frame.name));};
  const moving=[0,150,275].map(sample);
  h.applyDisplaySettings({reduced_motion:'on'});
  const frozen=[500,750,1000].map(sample);
  h.applyDisplaySettings({reduced_motion:'off'});
  const resumed=[1150,1275].map(sample);
  const paint=()=>{const g=r.scene.game;g.renderer.preRender();g.scene.render(g.renderer);g.renderer.postRender();};paint();
  return {moving,frozen,resumed,ready:r.ready,adapterReady:h.adapterReady};
 });
 assert.ok(room.ready&&room.adapterReady);
 assert.equal(new Set(room.moving.map(JSON.stringify)).size,3,'telemetry updates must advance rock-room frames');
 assert.equal(new Set(room.frozen.map(JSON.stringify)).size,1,'explicit reduced motion freezes room');
 assert.equal(new Set(room.resumed.map(JSON.stringify)).size,2,'disabling reduced motion resumes room');
 report.checks.push({name:'production telemetry room clock and motion preference',...room});
 const profiles=await page.evaluate(async()=>{const c=await(await fetch('/company-office/character-catalog.json')).json();return c.profiles.map(p=>p.id);});
 for(const profile of profiles){
  const states=await page.evaluate(async id=>{
   const h=window.qaMap,r=h.runtime;await h.setDemoCharacterProfile(id);
   const out=[];
   for(const state of ['writing','researching','executing','idle','syncing','error']){
    // Advance the actual telemetry-owned state clock as well as inspecting
    // individual atlas cells; setFrame alone cannot prove runtime playback.
    r.scene.time.now+=6000;
    // A repeated business state intentionally preserves its elapsed clock.
    // Transition first so every seat starts this inspection at the same epoch.
    h.setDemoState(state==='idle'?'writing':'idle');
    h.setDemoState(state);
    const epoch=r.scene.time.now,clockHashes=r.stations.map(()=>[]);
    for(const offset of [10,350,550,750,950]){
     r.scene.time.now=epoch+offset;r.adapter.update(r.scene.time.now);
     r.stations.forEach((s,i)=>clockHashes[i].push(s.player.canvas.toDataURL()));
    }
    const hashes=r.stations.map(()=>[]);
    for(let f=0;f<12;f++)r.stations.forEach((s,i)=>{s.player.setFrame(f);s.texture.refresh();hashes[i].push(s.player.canvas.toDataURL());});
    out.push({state,seats:r.stations.map((s,i)=>({id:s.id,direction:s.direction,profile:s.renderedCharacterProfileId,uniqueSamples:new Set(hashes[i]).size,uniqueClockSamples:new Set(clockHashes[i]).size}))});
   }
   const g=r.scene.game;g.renderer.preRender();g.scene.render(g.renderer);g.renderer.postRender();
   return out;
  },profile);
  for(const s of states)for(const seat of s.seats){assert.equal(seat.profile,profile);if(seat.direction!=='up'){
   assert.ok(seat.uniqueSamples>1,`${profile}/${seat.direction}/${s.state}: rendered expressions are static`);
   assert.ok(seat.uniqueClockSamples>1,`${profile}/${seat.direction}/${s.state}: runtime clock did not animate expressions`);
  }}
  report.checks.push({name:'four directions, six states, sixteen actual seats; all cells and runtime clocks',profile,states});
  if(['british-shorthair-v1','ragdoll-v1'].includes(profile))await page.screenshot({path:path.join(output,`${profile}-map.png`)});
 }
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.responses,[]);
 report.passed=true;
 await page.evaluate(()=>window.qaMap.dispose());
 console.log(JSON.stringify({passed:true,profiles:profiles.length,checks:report.checks.length,output}));
}catch(error){report.passed=false;report.failure=error.stack;console.error(error);process.exitCode=1;}
finally{await browser?.close();await new Promise(resolve=>server.close(resolve));fs.writeFileSync(path.join(output,'browser-report.json'),JSON.stringify(report,null,2)+'\n');}
