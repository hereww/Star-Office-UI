#!/usr/bin/env node
/** Read-only acceptance for the separate connected-bench candidate. Never writes the backend. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const out=resolve(root,'assets/company-office-connected-v4/qa');
const base=process.env.OFFICE_QA_URL||'http://127.0.0.1:19000/';
assert.ok(['127.0.0.1','localhost'].includes(new URL(base).hostname));
const candidate=new URL('?scene=connected',base).href;
const require=createRequire(process.env.OFFICE_QA_NODE_PACKAGE||'/Users/hepingyu/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json');
const {chromium}=require('playwright');
await mkdir(out,{recursive:true});
const report={capturedAt:new Date().toISOString(),url:candidate,scope:'Local candidate. No backend mutation. Browser-emulated devices, not physical-device approval.',passed:0,failed:0,results:[],observations:[]};
async function check(name,fn){try{const evidence=await fn();report.results.push({name,pass:true,evidence:evidence??null});report.passed++;console.log('PASS',name);}catch(error){report.results.push({name,pass:false,error:error.stack});report.failed++;console.error('FAIL',name,error.message);}}
async function settle(p){await p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));}
const before=await (await fetch(new URL('/status',base))).json();
await check('Old map, four-direction characters, and approved expression files are byte-identical',async()=>{
 const baseline=JSON.parse(await readFile(resolve(out,'protected-baseline.json'),'utf8'));
 for(const [file,hash]of Object.entries(baseline.files))assert.equal(createHash('sha256').update(await readFile(resolve(root,file))).digest('hex'),hash,file);
 return {protectedFiles:Object.keys(baseline.files).length};
});
await check('Two independently generated connected benches, eight equipment sets each',async()=>{
 const evidence=[];
 for(const kind of ['vertical','horizontal']){
  const p=resolve(root,'frontend/company-office/connected-v4/media',kind);
  const m=JSON.parse(await readFile(resolve(p,'manifest.json'),'utf8'));
  assert.equal(m.seatCount,8);assert.equal(m.seatContacts.length,8);assert.equal(m.screens.length,8);assert.equal(m.humanApproved,false);assert.equal(m.integrationAllowed,true);
  assert.equal(new Set(m.seatContacts.map(x=>x.id)).size,8);assert.ok((await readFile(resolve(p,m.image))).length>10000);
  if(kind==='horizontal')assert.equal(m.screens.filter(x=>x.visible===false).length,4);
  evidence.push({kind,size:m.actualPixelSize,source:m.image,seatCount:m.seatCount});
 }
 return evidence;
});
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--disable-background-timer-throttling']});
try{
 for(const d of [{name:'desktop-4k',width:1920,height:1080,dpr:2,mobile:false},{name:'phone-portrait',width:390,height:844,dpr:3,mobile:true},{name:'phone-landscape',width:844,height:390,dpr:3,mobile:true}]){
  const ctx=await browser.newContext({viewport:{width:d.width,height:d.height},deviceScaleFactor:d.dpr,isMobile:d.mobile,hasTouch:d.mobile});
  const p=await ctx.newPage(),errors=[],failed=[],writes=[];
  p.on('pageerror',e=>errors.push(e.message));p.on('response',r=>{if(r.status()>=400)failed.push([r.status(),r.url()]);});
  await p.route('**/*',route=>{const req=route.request();if(!['GET','HEAD','OPTIONS'].includes(req.method())){writes.push([req.method(),req.url()]);return route.abort();}return route.continue();});
  await p.addInitScript(()=>localStorage.setItem('uiLang','zh'));
  await p.goto(candidate,{waitUntil:'networkidle'});await p.waitForFunction(()=>window.officeRuntime?.ready,{timeout:30000});await p.evaluate(()=>document.fonts.ready);await settle(p);
  await check(`${d.name}: load, 16 seats, four preserved directions, actual render pixels`,async()=>{
   const x=await p.evaluate(()=>{const r=window.officeRuntime,s=r.snapshot();return{s,overflow:document.documentElement.scrollWidth>innerWidth+1,variant:document.body.dataset.officeVariant,labels:r.stations.map(x=>({font:x.bubbleText.style.fontFamily,resolution:x.bubbleText.style.resolution}))};});
   const s=x.s;report.observations.push({device:d.name,initial:s});assert.equal(s.scene,'company-office-connected-v4');assert.equal(x.variant,'connected-v4');assert.equal(s.walkIntegrated,false);assert.equal(s.animationMode,'full-frame');assert.equal(s.stations.length,16);assert.equal(s.stations.filter(s=>s.region==='west').length,8);assert.equal(s.stations.filter(s=>s.region==='east').length,8);
   for(const dir of ['up','down','left','right'])assert.equal(s.stations.filter(s=>s.direction===dir).length,4);
   assert.equal(x.overflow,false);assert.deepEqual(s.renderQuality.canvasBacking,s.renderQuality.drawingBuffer);if(!d.mobile)assert.equal(s.renderQuality.fourKBacking,true);
   for(const l of x.labels){assert.ok(!/ArkPixel/i.test(l.font));assert.ok(l.resolution>=Math.ceil(s.renderQuality.density-0.01));}
   return {backing:s.renderQuality.canvasBacking,css:s.renderQuality.canvasCss,textFont:s.renderQuality.textFont};
  });
  await check(`${d.name}: exact original character configuration and sprite URLs`,async()=>{
   const x=await p.evaluate(async()=>{const oldUrl=new URL('/static/company-office/reference-v3/',location.href).href,old=await (await fetch(new URL('assets.json',oldUrl))).json(),r=window.officeRuntime;return {old,oldUrl,current:r.assets,base:r.baseUrl};});
   for(const dir of ['up','down','left','right']){
    const prev=structuredClone(x.old.directions[dir].character),next=structuredClone(x.current.directions[dir].character);
    prev.base=new URL(prev.base,x.oldUrl).href;next.base=new URL(next.base,x.base).href;
    for(const a of Object.keys(prev.actions)){if(prev.actions[a].face)prev.actions[a].face=new URL(prev.actions[a].face,x.oldUrl).href;if(next.actions[a].face)next.actions[a].face=new URL(next.actions[a].face,x.base).href;}
    assert.deepEqual(next,prev,dir+' character settings changed');
   }
   assert.deepEqual(x.current.businessStateToAction,x.old.businessStateToAction);return {directions:4,characterChanged:false};
  });
  for(const view of ['overview','west','east','workstation']){
   await p.evaluate(v=>{const r=window.officeRuntime;r.selectStation(v==='east'?'desk-13':'desk-01');r.setView(v);},view);await settle(p);
   await check(`${d.name}/${view}: bubbles and heads remain separately readable`,async()=>{
    const s=await p.evaluate(()=>window.officeRuntime.snapshot());const bad=s.stations.filter(s=>s.bubbleVisible&&s.bubblePlacementClear===false);assert.deepEqual(bad.map(s=>s.id),[]);assert.equal(s.view,view);assert.ok(s.stations.every(s=>s.headAnchor?.every(Number.isFinite)));
    const overlap=(a,b)=>a[0]<b[0]+b[2]&&a[0]+a[2]>b[0]&&a[1]<b[1]+b[3]&&a[1]+a[3]>b[1];
    for(const station of s.stations.filter(s=>s.bubbleVisible)){assert.equal(station.bubbleScreenClear,true,station.id+' covers a monitor');assert.ok(!(s.screenProtectionRects||[]).some(rect=>overlap(station.bubbleRect,rect)),station.id+' actual bounds overlap monitor');}
    return {visibleBubbles:s.stations.filter(x=>x.bubbleVisible).length,screenObstructions:0};
   });
   if(view!=='workstation')await p.screenshot({path:resolve(out,`${d.name}-${view}.png`),animations:'disabled'});
  }
  await check(`${d.name}: each business state, independent clocks, fixed body and original face actions`,async()=>{
   const x=await p.evaluate(()=>{
    const r=window.officeRuntime;r.setDemoMode(true);const states=['idle','writing','researching','executing','syncing','error'],expected={idle:'idle',writing:'working',researching:'working',executing:'working',syncing:'syncing',error:'error'},rows=[];
    for(const id of ['desk-01','desk-02','desk-09','desk-13'])for(const state of states){const s=r.getStation(id);r.setStationState(id,state);s.player.sample(250);const snap=s.player.snapshot();rows.push({id,state,expected:expected[state],snapshot:snap});}
    const before=r.getStation('desk-02').state;r.setStationState('desk-01','writing');return {rows,independent:r.getStation('desk-02').state===before};
   });
   for(const row of x.rows){assert.equal(row.snapshot.state,row.state);assert.equal(row.snapshot.action,row.expected);assert.equal(row.snapshot.bodyFixed,true);assert.equal(row.snapshot.handsRendered,false);assert.equal(row.snapshot.clock,{idle:36,working:60,syncing:60,error:12}[row.expected]);}
   assert.equal(x.independent,true);return {combinations:x.rows.length};
  });
  await p.evaluate(()=>{const r=window.officeRuntime;r.setDemoMode(true);for(const [i,s]of r.stations.entries())r.setStationState(s.id,['writing','syncing','researching','error','executing','idle'][i%6]);r.setView('east');});await settle(p);
  await p.screenshot({path:resolve(out,`${d.name}-east-states.png`),animations:'disabled'});
  if(!d.mobile){await p.evaluate(()=>window.officeRuntime.setView('west'));await settle(p);await p.screenshot({path:resolve(out,'desktop-4k-west-states.png'),animations:'disabled'});}
  await check(`${d.name}: chair/head hit testing selects expected seat`,async()=>{
   await p.evaluate(()=>{const r=window.officeRuntime;r.selectStation('desk-01');r.setView('west');});await settle(p);
   const point=await p.evaluate(()=>{const r=window.officeRuntime,s=r.getStation('desk-04'),cam=r.scene.cameras.main,canvas=r.scene.sys.game.canvas,b=canvas.getBoundingClientRect();const [x,y]=s.headAnchor;return {x:b.left+(x-cam.worldView.x)*cam.zoom*b.width/canvas.width,y:b.top+(y-cam.worldView.y+12*s.scale)*cam.zoom*b.height/canvas.height};});
   await p.mouse.click(point.x,point.y);await settle(p);assert.equal(await p.evaluate(()=>window.officeRuntime.activeStation),'desk-04');return point;
  });
  await check(`${d.name}: camera pan keeps readable bubbles away from displays`,async()=>{
   await p.evaluate(()=>{const r=window.officeRuntime,c=r.scene.cameras.main;r.setView('east');c.scrollX+=30;c.scrollY+=10;});
   await p.waitForTimeout(80);await settle(p);
   const x=await p.evaluate(()=>{const r=window.officeRuntime,s=r.snapshot();return{bad:s.stations.filter(x=>x.bubbleVisible&&(!x.bubbleScreenClear||!x.bubblePlacementClear)).map(x=>x.id),reflows:s.annotationReflows};});
   assert.deepEqual(x.bad,[]);assert.ok(x.reflows>0);return x;
  });
  await check(`${d.name}: no failed assets, browser exceptions or backend writes`,async()=>{assert.deepEqual(errors,[]);assert.deepEqual(failed,[]);assert.deepEqual(writes,[]);return {errors:0,failedAssets:0,backendWrites:0};});
  await p.evaluate(()=>window.officeRuntime.setDemoMode(false));await ctx.close();
 }
 await check('Reduced-motion removes screen flicker without changing approved expression clocks',async()=>{
  const context=await browser.newContext({reducedMotion:'reduce'}),page=await context.newPage();try{await page.goto(candidate);await page.waitForFunction(()=>window.officeRuntime?.ready);const x=await page.evaluate(()=>{const r=window.officeRuntime;r.setDemoMode(true);const overlay=r.screenOverlays.find(o=>o.screen.seatId==='desk-13');overlay.sample('syncing',0,true);const key=overlay.lastKey;overlay.sample('syncing',10000,true);const s=r.getStation('desk-01');s.player.setState('error');s.player.sample(0);const face=s.player.snapshot().faceFrame;s.player.sample(250);return {reduced:r.reducedMotion,screenUnchanged:key===overlay.lastKey,face0:face,faceLater:s.player.snapshot().faceFrame};});assert.equal(x.reduced,true);assert.equal(x.screenUnchanged,true);assert.equal(x.face0,0);assert.equal(x.faceLater,3);return x;}finally{await context.close();}
 });
 await check('Original default route remains available and has 16 original seats',async()=>{
  const context=await browser.newContext(),page=await context.newPage();try{await page.goto(base);await page.waitForFunction(()=>window.officeRuntime?.ready);const x=await page.evaluate(()=>window.officeRuntime.snapshot());assert.equal(x.scene,'company-office-reference-v3');assert.equal(x.stations.length,16);assert.equal(await page.locator('#office-variant-link').getAttribute('href'),'/?scene=connected');return {scene:x.scene};}finally{await context.close();}
 });
}finally{
 await browser.close();
 const after=await (await fetch(new URL('/status',base))).json();
 await check('Actual API state was not changed by candidate preview or demos',async()=>{assert.equal(after.state,before.state);assert.equal(after.detail,before.detail);return {state:after.state,unchanged:true};});
 await writeFile(resolve(out,'browser-qa.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:report.passed,failed:report.failed}));
}
process.exitCode=report.failed?1:0;
