#!/usr/bin/env node
/** Read-only local UI acceptance. Synthetic browser copies only; no credentials,
 * Sub2API calls, config writes, fixture edits or shared state changes. */
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
const root=resolve(new URL('../',import.meta.url).pathname);
const url=process.env.OFFICE_COMPACT_QA_URL||'http://127.0.0.1:19024/';
assert.equal(new URL(url).hostname,'127.0.0.1');
const output=resolve(process.env.OFFICE_COMPACT_QA_OUT||resolve(root,'.local/office-compact-20261005/source-qa'));
await mkdir(output,{recursive:true});
const require=createRequire('/Users/hepingyu/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json');
const {chromium}=require('playwright');
const browser=await chromium.launch({channel:'chrome',headless:true});
const report={target_url:url,scope:'Loopback UI; all modified names/counts are synthetic browser copies, NOT genuine Sub2API telemetry.',checks:[],errors:[],legacy:[],external:[],screenshots:[]};
const names=['测试甲','测试乙','测试丙','测试丁'];
let mode='compact';
const contexts=[];
const closingContexts=new WeakSet();
async function pageFor(viewport,reducedMotion){
 const context=await browser.newContext({viewport,deviceScaleFactor:2,...(reducedMotion?{reducedMotion}:{})});contexts.push(context);
 const p=await context.newPage();
 p.on('pageerror',e=>report.errors.push(e.message));
 const safeRoute=(pattern,handler)=>p.route(pattern,async route=>{try{await handler(route);}catch(error){if(!closingContexts.has(context))report.errors.push(`route failure: ${error.message}`);try{await route.abort('failed');}catch{}}});
 p.on('request',r=>{const u=new URL(r.url());if(!['data:','blob:'].includes(u.protocol)&&u.hostname!=='127.0.0.1')report.external.push(u.origin+u.pathname);if(/^\/(status|agents|set_state|agent-push|join-agent)/.test(u.pathname))report.legacy.push(u.pathname);});
 await safeRoute('**/office/map-loader.mjs',async route=>{
  const response=await route.fetch(),code=await response.text(),marker='readyResolve(); onReady';assert.ok(code.includes(marker));
  await route.fulfill({response,body:code.replace(marker,'window.__officeQA={runtime,adapter}; readyResolve(); onReady')});
 });
 await safeRoute('**/api/office/snapshot',async route=>{
  const response=await route.fetch(),data=await response.json(),stamp=new Date().toISOString();
  if(mode!=='original'){
   data.source={...data.source,status:'ok',last_success_at:stamp,last_attempt_at:stamp};
   const rows=data.stations.filter(s=>s.bound);
   rows.forEach((s,i)=>{s.username=names[i];s.identity_quality='fresh';s.identity_observed_at=stamp;s.observed_at=stamp;s.quality=typeof s.quality==='object'?{...s.quality,concurrency:'fresh'}:'fresh';s.concurrency={...s.concurrency,current:['2','0','1','3'][i]};});
   if(mode==='unknown')for(const s of rows){s.username=null;s.identity_quality='unavailable';s.concurrency.current=null;s.quality=typeof s.quality==='object'?{...s.quality,concurrency:'unavailable'}:'unavailable';}
   if(mode==='long'){rows[0].username='验证超长中文用户名依然贴齐本工位而不是漂移到其他房间';rows[1].username='<img src=x onerror=alert(1)>';}
   if(mode==='big')rows.at(-1).concurrency.current='9007199254740993';
  }
  await route.fulfill({response,body:JSON.stringify(data),headers:{...response.headers(),'cache-control':'no-store'}});
 });
 await p.goto(url);await p.waitForFunction(()=>window.__officeQA?.runtime?.ready&&window.__officeQA?.adapter?.actualSnapshot?.source?.status==='ok',null,{timeout:25000});
 return p;
}
async function geometry(p){return p.evaluate(()=>{const r=window.__officeQA.runtime,c=r.scene.cameras.main,unit=r.renderQuality.density/c.zoom;return {view:r.view,unit,camera:[c.scrollX,c.scrollY,c.zoom],canvas:r.renderQuality.snapshot(),bodyWidth:document.documentElement.scrollWidth,actors:r.stations.filter(s=>s.presentation?.actorVisible).map(s=>({id:s.id,head:s.headAnchor,text:s.bubbleText.text,visible:s.bubbleText.visible,rect:s.bubbleRect?.map(v=>v/unit),rawRect:s.bubbleRect,placement:s.speechPlacement,headCss:s.headAnchor?.map(v=>v/unit),epoch:s.epoch,motionEpoch:window.__officeQA.adapter.bubbleClocks.live.get(s.id)?.motionEpoch}))};});}
const overlap=(a,b)=>a[0]<b[0]+b[2]&&a[0]+a[2]>b[0]&&a[1]<b[1]+b[3]&&a[1]+a[3]>b[1];
async function checkGeometry(p,label,{all=true}={}){
 await p.waitForTimeout(180);const g=await geometry(p),placed=[];
 for(const s of g.actors){
  if(all)assert.equal(s.visible,true,`${label} ${s.id} must remain visible`);
  if(!s.visible)continue;
  assert.equal(s.text.split('\n').length,1);assert.match(s.text,/：[0-9]+$|：—$/);assert.doesNotMatch(s.text,/正在处理|条工作|工位|一号|四号|七号|八号/);
  if(mode==='compact')assert.match(s.text,/^测试[甲乙丙丁]：[0-9]+$/,`${label} short username must not become an ellipsis`);
  assert.ok(s.rect[3]<=28,`${label} ${s.id} height ${s.rect[3]}`);assert.ok(s.rect[2]<=114,`${label} ${s.id} width ${s.rect[2]}`);
  assert.ok(Math.abs(s.rect[0]+s.rect[2]/2-s.headCss[0])<0.1,`${label} ${s.id} horizontal anchor drift`);
  assert.ok(s.headCss[1]-s.rect[1]<105,`${label} ${s.id} not near workstation`);
  assert.equal(placed.some(r=>overlap(r,s.rect)),false,`${label} bubbles overlap`);placed.push(s.rect);
 }
 report.checks.push({name:label,passed:true,geometry:g});return g;
}
async function shot(p,name){const path=resolve(output,name+'.png');await p.screenshot({path,fullPage:true});report.screenshots.push(path);}
let main;
try{
 for(const v of [{name:'reported-1280x720',width:1280,height:720},{name:'reported-1280',width:1280,height:1024},{name:'desktop-1920',width:1920,height:1080},{name:'tablet',width:1024,height:768},{name:'mobile-portrait',width:390,height:844},{name:'mobile-landscape',width:844,height:390}]){
  mode='compact';const p=await pageFor({width:v.width,height:v.height});if(!main)main=p;
  await p.getByTestId('view-overview').click();await checkGeometry(p,v.name+' overview',{all:v.width>900});await shot(p,v.name+'-overview');
  await p.getByTestId('view-east').click();const before=await checkGeometry(p,v.name+' east');await shot(p,v.name+'-east');
  assert.ok(before.bodyWidth<=v.width,'no horizontal document overflow');
  await p.waitForTimeout(2300);const after=await geometry(p);assert.deepEqual(after.camera,before.camera);assert.deepEqual(after.actors.map(a=>a.epoch),before.actors.map(a=>a.epoch));assert.deepEqual(after.actors.map(a=>a.motionEpoch),before.actors.map(a=>a.motionEpoch));
  await p.getByTestId('seat-desk-12').click();await p.getByTestId('focus-seat').click();await checkGeometry(p,v.name+' focused',{all:false});
  if(p!==main){closingContexts.add(p.context());await p.context().close();}
 }
 mode='unknown';await main.reload();await main.waitForFunction(()=>window.__officeQA?.runtime?.ready,{timeout:25000});await main.getByTestId('view-east').click();await main.waitForTimeout(400);const unknown=await geometry(main);for(const s of unknown.actors){assert.ok(s.text.endsWith('：—'));assert.ok(!s.text.endsWith('：0'));}report.checks.push({name:'unknown stays unknown',passed:true});await shot(main,'unknown');
 mode='long';await main.reload();await main.waitForFunction(()=>window.__officeQA?.runtime?.ready,{timeout:25000});await main.getByTestId('view-east').click();await checkGeometry(main,'long literal usernames');assert.equal(await main.locator('img[src="x"]').count(),0);report.checks.push({name:'literal names never become markup',passed:true});await shot(main,'long-names');
 mode='big';await main.reload();await main.waitForFunction(()=>window.__officeQA?.runtime?.ready,{timeout:25000});await main.getByTestId('seat-desk-12').click();await main.getByTestId('focus-seat').click();await main.waitForTimeout(300);const big=await geometry(main);assert.ok(big.actors.find(s=>s.id==='desk-12').text.endsWith('：9007199254740993'));report.checks.push({name:'lossless large count never elides or becomes zero',passed:true});await shot(main,'large-count');
 mode='compact';const reduced=await pageFor({width:1280,height:1024},'reduce');await reduced.getByTestId('view-east').click();const a=await checkGeometry(reduced,'reduced motion');await reduced.waitForTimeout(600);const b=await geometry(reduced);assert.deepEqual(a.actors.map(s=>s.rawRect),b.actors.map(s=>s.rawRect));report.checks.push({name:'reduced motion remains static',passed:true});
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.external,[]);assert.deepEqual(report.legacy,[]);report.passed=true;
}catch(e){report.passed=false;report.failure=e.stack;console.error(e.stack);process.exitCode=1;if(main)try{await shot(main,'failure');}catch{}}
finally{for(const context of contexts)closingContexts.add(context);await browser.close();report.completedAt=new Date().toISOString();await writeFile(resolve(output,'compact-bubble-acceptance.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,report:resolve(output,'compact-bubble-acceptance.json')}));}
