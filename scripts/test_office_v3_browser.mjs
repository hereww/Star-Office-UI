#!/usr/bin/env node
/** Real Chrome QA against the loopback-only, isolated Flask preview.
 * Run the preview with --data-dir .local/office-reference-v3-preview first.
 * --allow-isolated-state-write opts into POST /set_state smoke tests; state/detail are restored.
 * Agent tests explicitly use browser-route fixtures, not real joined people.
 */
import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const out=resolve(root,'assets/company-office-reference-v3/integration-qa');
const require=createRequire(process.env.OFFICE_QA_NODE_PACKAGE || '/Users/hepingyu/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json');
const {chromium}=require('playwright');
const base=process.env.OFFICE_QA_URL || 'http://127.0.0.1:19000/';
if(!['127.0.0.1','localhost'].includes(new URL(base).hostname))throw new Error('QA only supports the isolated loopback preview');
const writeAllowed=process.argv.includes('--allow-isolated-state-write');
await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--disable-background-timer-throttling','--disable-renderer-backgrounding']});
const results=[],errors=[],httpFailures=[],posts=[];
let page,context,originalStatus,stateWritten=false;
const snapshot=()=>page.evaluate(()=>window.officeRuntime.snapshot());
async function test(name,fn){try{const evidence=await fn();results.push({name,pass:true,evidence:evidence??null});console.log('PASS',name);}catch(e){results.push({name,pass:false,error:e.message});console.error('FAIL',name,e.message);}}
async function open(ctx,url=base){const p=await ctx.newPage();await p.goto(url,{waitUntil:'networkidle'});await p.waitForFunction(()=>window.officeRuntime?.ready);await p.evaluate(()=>document.fonts.ready);return p;}
function intersect(a,b){return a[0]<b[0]+b[2]&&a[0]+a[2]>b[0]&&a[1]<b[1]+b[3]&&a[1]+a[3]>b[1];}
try{
 context=await browser.newContext({viewport:{width:1440,height:1000}});
 await context.addInitScript(()=>localStorage.setItem('uiLang','zh'));
 page=await context.newPage();
 page.on('pageerror',e=>errors.push(e.message));
 page.on('response',r=>{if(r.status()>=400)httpFailures.push({status:r.status(),url:r.url()});});
 page.on('request',r=>{if(r.method()==='POST')posts.push({url:r.url(),body:r.postData()});});
 await page.goto(base,{waitUntil:'networkidle'});await page.waitForFunction(()=>window.officeRuntime?.ready);await page.evaluate(()=>document.fonts.ready);
 await test('default v3, 16=red8+green8, no walking',async()=>{const s=await snapshot();assert.equal(s.scene,'company-office-reference-v3');assert.equal(s.stations.length,16);assert.equal(s.stations.filter(x=>x.region==='west').length,8);assert.equal(s.stations.filter(x=>x.region==='east').length,8);assert.equal(s.walkIntegrated,false);assert.equal(await page.locator('[data-ocv3-station]').count(),16);return {scene:s.scene,seats:16};});
 await test('actual mode locks local state buttons, unbound not represented as live',async()=>{assert.equal(await page.locator('[data-ocv3-state]:enabled').count(),0);const s=await snapshot();assert.equal(s.demoMode,false);assert.ok(await page.locator('#status-text').isHidden());assert.equal(s.stations.filter(x=>x.source==='live').length,1);assert.ok(s.stations.filter(x=>x.id!==s.mainStation).every(x=>x.source==='unbound'));});
 await test('all four view controls and all 16 real seat selectors',async()=>{for(const view of ['overview','west','east','workstation']){await page.locator(`[data-ocv3-view="${view}"]`).click();assert.equal((await snapshot()).view,view);}for(const s of (await snapshot()).stations){await page.locator(`[data-ocv3-station="${s.id}"]`).click();assert.equal((await snapshot()).activeStation,s.id);}});
 await page.locator('.ocv3-demo').click();
 await test('demo is visibly labelled on all persistent bars',async()=>{const s=await snapshot();assert.equal(s.demoMode,true);assert.ok(s.stations.every(x=>x.source==='demo'));assert.ok(await page.evaluate(()=>window.officeRuntime.stations.every(x=>x.bubbleText.text.includes('演示'))));assert.ok((await page.locator('.ocv3-mode-label').innerText()).includes('非实际工作状态'));});
 await test('bars stay above heads and do not overlap in all views',async()=>{
  for(const view of ['overview','west','east','workstation']){
   await page.locator(`[data-ocv3-view="${view}"]`).click();
   const snapshotValue=await snapshot();
   // Bubbles are now screen-space typography; their 4px tails and 3px gap are
   // measured in CSS pixels, not enlarged map-world pixels. Offscreen labels
   // are culled without affecting the underlying sixteen independent states.
   const unit=(snapshotValue.renderQuality?.density??1)/snapshotValue.camera.zoom;
   const visibleIds=await page.evaluate(()=>window.officeRuntime.stations.filter(s=>s.bubbleText.visible).map(s=>s.id));
   const seats=snapshotValue.stations.filter(s=>visibleIds.includes(s.id));
   for(const s of seats){
    assert.ok(s.bubbleRect[1]+s.bubbleRect[3]+4*unit<=s.headAnchor[1]-2.9*unit+1e-5,`${view} ${s.id} covers the head`);
    assert.notEqual(s.bubblePlacementClear,false,`${view} ${s.id} overlaps another protected head`);
   }
   for(let i=0;i<seats.length;i++)for(let j=i+1;j<seats.length;j++)assert.equal(intersect(seats[i].bubbleRect,seats[j].bubbleRect),false,`${view} bubbles ${seats[i].id}/${seats[j].id}`);
  }
 });
 await page.locator('[data-ocv3-station="desk-12"]').click();await page.locator('[data-ocv3-view="workstation"]').click();
 const directionCases=[];const states=['idle','writing','researching','executing','syncing','error'];const clocks={idle:36,writing:60,researching:60,executing:60,syncing:60,error:12};
 for(const d of ['down','up','left','right']){
  await page.locator('.ocv3-direction').selectOption(d);await page.waitForFunction(d=>window.officeRuntime.getStation('desk-12').direction===d,d);
  for(const state of states)await test(`${d}/${state}: original clock, fixed pose, independent state`,async()=>{
   const before=(await snapshot()).stations.filter(s=>s.id!=='desk-12').map(s=>[s.id,s.state,s.direction]);
   await page.locator(`[data-ocv3-state="${state}"]`).click();const s=await snapshot(),p=s.stations.find(x=>x.id==='desk-12').player;
   assert.equal(p.direction,d);assert.equal(p.directionFallback,false);assert.equal(p.state,state);assert.equal(p.faceClockFrames,clocks[state]);assert.equal(p.bodyFixed,true);assert.equal(p.handsRendered,false);assert.equal(p.faceVisible,d!=='up');assert.equal(p.screen.ledOnly,d==='down');assert.deepEqual(s.stations.filter(x=>x.id!=='desk-12').map(x=>[x.id,x.state,x.direction]),before);
   const png=await page.evaluate(()=>{const p=window.officeRuntime.getStation('desk-12').player;p.sample(500);return p.canvas.toDataURL('image/png');});
   const filename=`composite-${d}-${state}.png`;await writeFile(resolve(out,filename),Buffer.from(png.split(',')[1],'base64'));directionCases.push({direction:d,state,filename,clock:clocks[state],screen:p.screen});return {clock:p.faceClockFrames,faceVisible:p.faceVisible,screenStyle:p.screen.style};
  });
  if(d==='up')await page.screenshot({path:resolve(out,'desktop-back-workstation.png')});
 }
 await test('six distinct monitor descriptors; rear shows LED only',async()=>{const up=directionCases.filter(c=>c.direction==='up');assert.equal(new Set(up.map(c=>c.screen.style)).size,6);assert.ok(up.every(c=>c.screen.polygon.length===4&&c.screen.visible));assert.ok(directionCases.filter(c=>c.direction==='down').every(c=>c.screen.ledOnly&&!c.screen.visible));});
 await test('real Canvas2D pixels: only face ellipse/screen/LED can change across all states and clocks',async()=>{const evidence=await page.evaluate(async()=>{
  const r=window.officeRuntime,{DirectionalSeatedPlayer}=await import('/static/company-office/reference-v3/directional-player.mjs');
  const reports=[];const states=['idle','writing','researching','executing','syncing','error'];
  for(const direction of ['down','up','left','right']){
   const p=await new DirectionalSeatedPlayer(document.createElement('canvas'),r.assets,{baseUrl:r.baseUrl,direction}).initialize();
   const [bx,by]=p.bodyPlacement(),c=p.spec.character,screen=p.spec.furniture.screen;
   const allowance=new Uint8Array(192*192),mask=document.createElement('canvas');mask.width=mask.height=192;const m=mask.getContext('2d');m.fillStyle='#fff';
   if(c.faceVisible!==false){const [x,y,rx,ry]=c.faceClipEllipse;m.beginPath();m.ellipse(bx+x*c.scale,by+y*c.scale,rx*c.scale+1,ry*c.scale+1,0,0,Math.PI*2);m.fill();}
   if(screen.visible&&screen.polygon?.length){m.beginPath();screen.polygon.forEach(([x,y],i)=>i?m.lineTo(x,y):m.moveTo(x,y));m.closePath();m.lineWidth=2;m.stroke();m.fill();}
   if(screen.led){const[x,y,w,h]=screen.led;m.fillRect(x-1,y-1,w+2,h+2);}
   const pixels=m.getImageData(0,0,192,192).data;for(let i=0;i<allowance.length;i++)allowance[i]=pixels[i*4+3]>0?1:0;
   p.setState('idle');p.sample(0);const initial=p.ctx.getImageData(0,0,192,192).data;let outsideChanges=0,samples=0,changedFrames=0;
   for(const state of states)for(const ms of [0,83.34,166.67,250,333.34,416.67,500,583.34,666.67,750,833.34,916.67,1000,3000,5000]){
    p.setState(state);p.sample(ms);const data=p.ctx.getImageData(0,0,192,192).data;let delta=0;
    for(let i=0;i<allowance.length;i++){let changed=false;for(let channel=0;channel<4;channel++)if(data[i*4+channel]!==initial[i*4+channel]){changed=true;break;}if(changed){delta++;if(!allowance[i])outsideChanges++;}}
    samples++;if(delta)changedFrames++;
   }
   reports.push({direction,samples,changedFrames,outsideChanges,allowance:'face ellipse + visible screen polygon + LED; 1px antialias boundary'});
  }return reports;
 });assert.ok(evidence.every(x=>x.outsideChanges===0),JSON.stringify(evidence));assert.ok(evidence.every(x=>x.changedFrames>0));await writeFile(resolve(out,'canvas-pixel-audit.json'),JSON.stringify(evidence,null,2)+'\n');return evidence;});
 await test('clock advances at 12fps in foreground without body movement',async()=>{await page.locator('[data-ocv3-state="error"]').click();const ticks=[];for(let i=0;i<7;i++){ticks.push((await snapshot()).player.tick);await page.waitForTimeout(100);}assert.ok(new Set(ticks).size>=5);return {ticks};});
 await test('local demo controls never POST to the backend',async()=>{assert.equal(posts.length,0);});
 await test('replaceable character/server success is atomic; invalid images preserve texture',async()=>{const result=await page.evaluate(async()=>{
  const r=window.officeRuntime,s=r.getStation('desk-12'),c=structuredClone(r.assets.directions[s.direction].character);
  await r.replaceCharacter(c,{stationId:s.id});const cv=r.characterVersion,key=s.textureKey,state=s.state;
  c.base='data:image/png;base64,invalid';let characterError=false;try{await r.replaceCharacter(c,{stationId:s.id});}catch{characterError=true;}
  const characterStable=r.characterVersion===cv&&s.textureKey===key&&s.state===state;
  await r.replaceServer('media/server-rack.png');const sv=r.serverVersion,serverKey=r.serverSprite.texture.key;
  let serverError=false;try{await r.replaceServer('data:image/png;base64,invalid');}catch{serverError=true;}
  return {characterError,characterStable,serverError,serverStable:r.serverVersion===sv&&r.serverSprite.texture.key===serverKey,cv,sv};
 });assert.ok(result.characterError&&result.characterStable&&result.serverError&&result.serverStable);return result;});
 await page.locator('.ocv3-direction').selectOption('down');await page.waitForFunction(()=>window.officeRuntime.getStation('desk-12').direction==='down');
 await page.locator('.ocv3-return').click();
 await test('return actual restores all latest sources and disables state editing',async()=>{const s=await snapshot();assert.equal(s.demoMode,false);assert.ok(s.stations.every(x=>x.source!=='demo'));assert.equal(s.stations.filter(x=>x.source==='live').length,1);assert.equal(await page.locator('[data-ocv3-state]:enabled').count(),0);});
 if(writeAllowed)await test('real isolated /set_state→/status→main seat, plus pending actual restore',async()=>{
  originalStatus=await (await page.request.get(new URL('/status',base).href)).json();
  for(const state of states){stateWritten=true;const detail=`V3隔离验收/${state}`;const response=await page.request.post(new URL('/set_state',base).href,{data:{state,detail}});assert.ok(response.ok());const readback=await (await page.request.get(new URL('/status',base).href)).json();assert.equal(readback.state,state);assert.equal(readback.detail,detail);await page.waitForFunction(({state,detail})=>{const r=window.officeRuntime,s=r.getStation(r.layout.mainStation);return s.state===state&&s.detail===detail;},{state,detail});assert.ok((await snapshot()).stations.filter(x=>x.id!=='desk-12').every(x=>x.source==='unbound'));}
  await page.locator('.ocv3-demo').click();await page.request.post(new URL('/set_state',base).href,{data:{state:'researching',detail:'演示期间到达的实际状态'}});await page.waitForFunction(()=>window.officeRuntime.getStation('desk-12').actual.detail==='演示期间到达的实际状态');await page.locator('.ocv3-return').click();const s=await snapshot();assert.equal(s.player.state,'researching');assert.equal(s.stations.find(x=>x.id==='desk-12').detail,'演示期间到达的实际状态');return {mode:'real loopback isolated API',states:6};
 });
 else results.push({name:'real isolated API smoke',pass:null,skipped:'requires --allow-isolated-state-write'});
 if(stateWritten&&originalStatus){await page.request.post(new URL('/set_state',base).href,{data:{state:originalStatus.state,detail:originalStatus.detail}});stateWritten=false;await page.waitForFunction(s=>window.officeRuntime.state===s,originalStatus.state);}
 const agents=[{agentId:'qa-ai-1',name:'验收AI甲',state:'writing',detail:'browser fixture',authStatus:'approved'},{agentId:'qa-ai-2',name:'验收AI乙',state:'syncing',detail:'browser fixture',authStatus:'approved'},{agentId:'qa-ai-3',name:'验收AI丙',state:'error',detail:'browser fixture',authStatus:'approved'},{agentId:'qa-ai-4',name:'验收溢出',state:'executing',detail:'browser fixture',authStatus:'approved'}];
 await page.route('**/agents?*',route=>route.fulfill({json:agents}));
 await test('actual client /agents integration fixture binds only 3 auxiliary AI seats',async()=>{await page.waitForFunction(()=>window.officeRuntime.remoteAgents.length===4,{},{timeout:15000});const s=await snapshot();assert.equal(s.stations.find(x=>x.id===s.mainStation).agentId,'main');assert.equal(s.stations.filter(x=>x.agentId?.startsWith('qa-ai')).length,3);assert.equal(s.unplacedAgents.length,1);assert.ok((await page.locator('.ocv3-unplaced').innerText()).includes('验收溢出'));assert.equal(s.stations.filter(x=>x.player.ready).length,16);return {kind:'browser route fixture (not actual joined agents)',mapped:3,unplaced:1};});
 await page.unroute('**/agents?*');await page.waitForFunction(()=>window.officeRuntime.remoteAgents.length===0&&!document.querySelector('#guest-agent-panel')?.textContent.includes('验收AI'),{},{timeout:15000});
 await page.evaluate(()=>{document.querySelector('#office-controls-v3').scrollTop=0;});
 for(const view of ['overview','west','east']){await page.locator(`[data-ocv3-view="${view}"]`).click();await page.screenshot({path:resolve(out,`desktop-${view}.png`),fullPage:true});}
 await test('v3 produces no uncaught JS or failed HTTP resources',async()=>{assert.deepEqual(errors,[]);assert.deepEqual(httpFailures,[]);return {pageErrors:errors,httpFailures};});
 const gallery=await context.newPage();
 const cells=await Promise.all(directionCases.map(async c=>`<article><h2>${({down:'正面',up:'背面',left:'朝左',right:'朝右'})[c.direction]} · ${{idle:'休息',writing:'写作',researching:'研究',executing:'执行',syncing:'同步',error:'异常'}[c.state]}</h2><img src="${'data:image/png;base64,'+Buffer.from(await (await import('node:fs/promises')).readFile(resolve(out,c.filename))).toString('base64')}"><p>时钟 ${c.clock} · ${c.direction==='up'?'无背面五官':c.direction==='down'?'原版表情 / 背壳仅LED':'独立侧向表情'}</p></article>`));
 await gallery.setViewportSize({width:1440,height:1250});await gallery.setContent(`<html lang="zh-CN"><head><style>@font-face{font-family:Ark;src:url('${new URL('/static/fonts/ark-pixel-12px-proportional-zh_cn.ttf.woff2',base).href}')}*{box-sizing:border-box}body{margin:0;padding:22px;background:#233c39;color:#faecd4;font:16px "PingFang SC","Microsoft YaHei",system-ui,sans-serif}h1{margin:0 0 8px;font-size:25px}.note{color:#c5d8c7;margin-bottom:20px}.grid{display:grid;grid-template-columns:repeat(6,1fr);gap:10px}article{background:#dfd3b3;padding:9px;color:#253c37;border:1px solid #b2a080}h2{font-size:15px;margin:0 0 6px}img{width:100%;height:225px;object-fit:contain;image-rendering:pixelated}p{font-size:12px;margin:4px 0}</style></head><body><h1>四向固定坐姿 · 六种工作状态</h1><div class="note">实际播放器取帧 · 原正面表情与节奏不变 · 只动局部表情和屏幕 · 展示内容为本地演示</div><div class="grid">${cells.join('')}</div></body></html>`);await gallery.evaluate(()=>document.fonts.ready);await gallery.screenshot({path:resolve(out,'four-directions-six-states.png'),fullPage:true});await gallery.close();
 for(const device of [{name:'mobile-portrait',width:390,height:844},{name:'mobile-landscape',width:844,height:390}]){
  await test(`${device.name}: actual touch viewport, no horizontal overflow, working controls`,async()=>{const ctx=await browser.newContext({viewport:{width:device.width,height:device.height},isMobile:true,hasTouch:true,deviceScaleFactor:1});await ctx.addInitScript(()=>localStorage.setItem('uiLang','zh'));const p=await open(ctx);assert.equal(await p.evaluate(()=>window.officeRuntime.view),'east');assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));const small=await p.locator('.ocv3 button,.ocv3 select').evaluateAll(nodes=>nodes.filter(x=>!x.disabled).map(x=>({h:x.getBoundingClientRect().height,w:x.getBoundingClientRect().width})).filter(x=>x.h<43.9||x.w<43.9));assert.deepEqual(small,[]);await p.locator('.ocv3-demo').click();await p.locator('[data-ocv3-station="desk-13"]').click();await p.locator('[data-ocv3-state="syncing"]').click();assert.equal(await p.evaluate(()=>window.officeRuntime.getStation('desk-13').state),'syncing');await p.locator('[data-ocv3-view="workstation"]').click();await p.evaluate(()=>scrollTo(0,0));await p.screenshot({path:resolve(out,`${device.name}.png`),fullPage:true});const rect=await p.locator('#game-container').boundingBox();await ctx.close();return {viewport:device,map:rect};});
 }
 await test('reduced motion removes screen flashes but keeps original face clock',async()=>{const ctx=await browser.newContext({reducedMotion:'reduce',viewport:{width:1100,height:800}});const p=await open(ctx);const s=await p.evaluate(()=>window.officeRuntime.snapshot());assert.ok(s.stations.every(x=>x.player.screen.reducedMotion));assert.equal(s.player.faceClockFrames,36);await ctx.close();});
 for(const scene of ['floorplan','v1','legacy'])await test(`fallback ${scene}: usable scene, isolated from new 16-seat map`,async()=>{const ctx=await browser.newContext({viewport:{width:1280,height:900}});const p=await ctx.newPage();const fatal=[];p.on('pageerror',e=>fatal.push(e.message));await p.goto(new URL(`?scene=${scene}`,base).href,{waitUntil:'networkidle'});await p.waitForFunction(()=>document.querySelector('#game-container canvas')&&getComputedStyle(document.querySelector('#loading-overlay')).display==='none');assert.deepEqual(fatal,[]);assert.ok(await p.locator('#office-controls-v3').isHidden());const evidence=await p.evaluate(()=>({scene:window.officeRuntime?.layout?.id??'legacy',canvas:!!document.querySelector('canvas')}));await ctx.close();return evidence;});
}catch(e){results.push({name:'QA runner',pass:false,error:e.stack});console.error(e);}finally{
 if(stateWritten&&originalStatus&&page)await page.request.post(new URL('/set_state',base).href,{data:{state:originalStatus.state,detail:originalStatus.detail}}).catch(e=>results.push({name:'state restore',pass:false,error:e.message}));
 await browser.close();
 const report={capturedAt:new Date().toISOString(),url:base,scope:'Local isolated preview; no remote deployment; original API restored; route fixture agents are not real people',passed:results.filter(r=>r.pass===true).length,failed:results.filter(r=>r.pass===false).length,skipped:results.filter(r=>r.pass===null).length,results};
 await writeFile(resolve(out,'browser-qa.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({passed:report.passed,failed:report.failed,skipped:report.skipped,report:resolve(out,'browser-qa.json')}));
 if(report.failed)process.exitCode=1;
}
