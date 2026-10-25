#!/usr/bin/env node
/** Read-only browser quality regression for the local 16-seat office.
 * Screenshots are captured at the actual device resolution, never resized.
 * UI demo mutations stay in this browser; no server/agent writes are permitted.
 */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const out=resolve(root,'assets/company-office-reference-v3/repair-v4-qa');
const require=createRequire(process.env.OFFICE_QA_NODE_PACKAGE || '/Users/hepingyu/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json');
const {chromium}=require('playwright');
const base=process.env.OFFICE_QA_URL || 'http://127.0.0.1:19000/';
assert.ok(['127.0.0.1','localhost'].includes(new URL(base).hostname),'Only the isolated loopback preview may be tested');
await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--disable-background-timer-throttling','--disable-renderer-backgrounding']});
const results=[],observations=[],posts=[];
async function test(name,fn){try{const evidence=await fn();results.push({name,pass:true,evidence:evidence??null});console.log('PASS',name);}catch(e){results.push({name,pass:false,error:e.stack});console.error('FAIL',name,e.message);}}
const cases=[
 {name:'desktop-1440-dpr1',width:1440,height:1000,dpr:1,mobile:false},
 {name:'desktop-retina-1920-dpr2',width:1920,height:1080,dpr:2,mobile:false,fourK:true},
 {name:'desktop-4k-3840-dpr1',width:3840,height:2160,dpr:1,mobile:false,fourK:true},
 {name:'mobile-portrait-dpr3',width:390,height:844,dpr:3,mobile:true},
 {name:'mobile-landscape-dpr3',width:844,height:390,dpr:3,mobile:true},
];
async function settle(p){await p.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));}
async function inspect(p){return p.evaluate(()=>{
 const r=window.officeRuntime,s=r.snapshot(),cam=r.scene.cameras.main,quality=s.renderQuality;
 const density=quality?.density||1;
 const labels=[...r.stations.map(x=>({kind:'bubble',id:x.id,node:x.bubbleText})),...(r.roomLabels||[]).map((node,i)=>({kind:'room',id:String(i),node})),{kind:'server',id:'server',node:r.serverLabel},{kind:'entry',id:'entry',node:r.entryLabel}].filter(x=>x.node).map(({kind,id,node})=>({kind,id,text:node.text,font:node.style.fontFamily,resolution:node.style.resolution,effectiveCssFontSize:parseFloat(node.style.fontSize)*node.scaleX*cam.zoom/density,visible:node.visible}));
 const legacyVisibleText=[...document.querySelectorAll('body *')].filter(el=>[...el.childNodes].some(n=>n.nodeType===Node.TEXT_NODE&&n.textContent.trim())).map(el=>({el,rect:el.getBoundingClientRect(),style:getComputedStyle(el)})).filter(({el,rect,style})=>rect.width>0&&rect.height>0&&rect.bottom>0&&rect.top<innerHeight&&style.visibility!=='hidden'&&style.display!=='none'&&/ArkPixel/i.test(style.fontFamily)).map(({el,style})=>({id:el.id,tag:el.tagName,text:el.textContent.trim().slice(0,80),font:style.fontFamily}));
 return {snapshot:s,quality,labels,legacyVisibleText,overflow:document.documentElement.scrollWidth>innerWidth+1,viewport:[innerWidth,innerHeight,devicePixelRatio],gameCanvas:[r.scene.sys.game.canvas.width,r.scene.sys.game.canvas.height],playerCanvases:r.stations.map(x=>[x.player.canvas.width,x.player.canvas.height])};
});}
try{
 await test('preview serves current HTML and uncached relative modules',async()=>{
  const response=await fetch(base);const html=await response.text();assert.ok(html.includes('prepareOfficeRendering'));assert.ok(html.includes('--office-font'));
  const module=await fetch(new URL('/static/company-office/reference-v3/render-quality.mjs',base));assert.equal(module.status,200);assert.ok(module.headers.get('cache-control').includes('no-store'));
  return {htmlStatus:response.status,moduleStatus:module.status,moduleCacheControl:module.headers.get('cache-control')};
 });
 for(const c of cases){
  const context=await browser.newContext({viewport:{width:c.width,height:c.height},deviceScaleFactor:c.dpr,isMobile:c.mobile,hasTouch:c.mobile});
  await context.addInitScript(()=>localStorage.setItem('uiLang','zh'));
  const p=await context.newPage(),errors=[],failed=[];
  p.on('pageerror',e=>errors.push(e.message));
  p.on('response',r=>{if(r.status()>=400)failed.push({status:r.status(),url:r.url()});});
  p.on('request',r=>{if(r.method()==='POST')posts.push({case:c.name,url:r.url()});});
  await p.goto(base,{waitUntil:'networkidle'});await p.waitForFunction(()=>window.officeRuntime?.ready);await p.evaluate(()=>document.fonts.ready);await settle(p);
  await test(`${c.name}: actual backing store and readable fonts`,async()=>{
   const v=await inspect(p);observations.push({case:c.name,...v});
   assert.ok(v.quality,'Render measurement API missing');
   assert.deepEqual(v.quality.canvasBacking,v.gameCanvas);
   assert.deepEqual(v.quality.drawingBuffer,v.gameCanvas,'WebGL drawing buffer must really match the canvas');
   assert.ok(!v.overflow,'Page has horizontal overflow');
   assert.ok(v.quality.density>=c.dpr-0.02||v.quality.capped,'DPR was silently dropped');
   if(c.fourK){assert.ok(v.gameCanvas[0]>=3840&&v.gameCanvas[1]>=2160,`Not a real 4K backing: ${v.gameCanvas}`);assert.equal(v.quality.fourKBacking,true);}
   assert.deepEqual(v.legacyVisibleText,[],'Pixel font still used for visible UI text');
   for(const label of v.labels){assert.ok(!/ArkPixel/i.test(label.font),`${label.kind}/${label.id}: pixel font`);assert.ok(label.resolution>=Math.ceil(v.quality.density-0.001),`${label.kind}/${label.id}: low-res text texture`);if(label.visible)assert.ok(label.effectiveCssFontSize>=12.8,`${label.kind}/${label.id}: too small (${label.effectiveCssFontSize}px)`);}
   assert.equal(v.snapshot.stations.length,16);assert.equal(v.snapshot.walkIntegrated,false);
   assert.ok(v.playerCanvases.every(size=>size[0]===192&&size[1]===192),'Do not destructively rescale frozen character bitmaps');
   return {viewport:v.viewport,canvas:v.gameCanvas,css:v.quality.canvasCss,density:v.quality.density,textResolution:v.quality.textResolution,font:v.quality.textFont};
  });
  for(const view of c.mobile?['east','west','workstation']:['overview','west','east','workstation']){
   await p.evaluate(view=>{const r=window.officeRuntime;r.selectStation('desk-01');r.setView(view);},view);await settle(p);
   await test(`${c.name}/${view}: persistent bubbles, stable text and layout`,async()=>{
    const v=await inspect(p);assert.ok(!v.overflow);
    const visible=v.snapshot.stations.filter(s=>s.bubblePlacementClear===false);assert.deepEqual(visible.map(s=>s.id),[],'A visible bubble overlaps a protected head or another bubble');
    assert.ok(v.labels.filter(x=>x.kind==='bubble').every(x=>x.effectiveCssFontSize>=12.8));
    assert.ok(v.labels.filter(x=>x.kind==='bubble').every(x=>x.effectiveCssFontSize<=21));
    return {view,bubbles:v.snapshot.stations.length,textPixels:[...new Set(v.labels.filter(x=>x.kind==='bubble').map(x=>Math.round(x.effectiveCssFontSize*100)/100))],relocated:v.snapshot.stations.filter(s=>s.bubbleRelocated).map(s=>s.id)};
   });
   if((c.fourK&&['overview','west'].includes(view))||(c.name==='desktop-1440-dpr1'&&view==='west')||(c.mobile&&view==='east'))await p.screenshot({path:resolve(out,`${c.name}-${view}.png`),fullPage:false,scale:'device'});
  }
  await test(`${c.name}: high-DPI canvas hit testing selects the displayed seat`,async()=>{
   await p.evaluate(()=>window.officeRuntime.setView('west'));await settle(p);
   const point=await p.evaluate(()=>{const r=window.officeRuntime,s=r.getStation('desk-05'),cam=r.scene.cameras.main,canvas=r.scene.sys.game.canvas,b=canvas.getBoundingClientRect(),d=canvas.width/b.width;return{x:b.left+(s.center[0]-cam.worldView.x)*cam.zoom/d,y:b.top+(s.center[1]-cam.worldView.y)*cam.zoom/d};});
   await p.mouse.click(point.x,point.y);assert.equal(await p.evaluate(()=>window.officeRuntime.activeStation),'desk-05');return point;
  });
  await test(`${c.name}: ${c.mobile?'native emulated-touch':'pointer'} pan uses correct DPI and refreshes visible bubbles`,async()=>{
   await p.evaluate(()=>{scrollTo(0,0);window.officeRuntime.setView('west');});await settle(p);
   if(await p.locator('#pan-toggle').getAttribute('data-on')!=='1')await p.locator('#pan-toggle').click();
   await p.evaluate(()=>scrollTo(0,0));await settle(p);
   const before=await p.evaluate(()=>{const r=window.officeRuntime,cam=r.scene.cameras.main,b=r.scene.sys.game.canvas.getBoundingClientRect();return {left:cam.worldView.x,worldWidth:cam.worldView.width,mapWidth:r.layout.size[0],zoom:cam.zoom,density:r.renderQuality.density,box:{x:b.x,y:b.y,width:b.width,height:b.height},viewportHeight:innerHeight};});
   const x=before.box.x+before.box.width*.22,y=before.box.y+Math.min(before.box.height*.3,(before.viewportHeight-before.box.y)*.55),dx=60;
   if(c.mobile){
    const cdp=await context.newCDPSession(p);
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
    for(let i=1;i<=5;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x-dx*i/5,y}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();
   }else{await p.mouse.move(x,y);await p.mouse.down();await p.mouse.move(x-dx,y,{steps:5});await p.mouse.up();}
   await settle(p);
   const after=await p.evaluate(()=>{const r=window.officeRuntime,cam=r.scene.cameras.main;return{left:cam.worldView.x,width:cam.worldView.width,top:cam.worldView.y,height:cam.worldView.height,labels:r.stations.map(s=>({id:s.id,head:s.headAnchor,visible:s.bubbleText.visible,clear:s.bubblePlacementClear}))};});
   const requestedDelta=dx*before.density/before.zoom;
   // The wide phone viewport can leave only ~43 map pixels to the right. A
   // correctly clamped camera must not scroll past the map to satisfy a drag.
   const padding=Math.max(0,(before.worldWidth-before.mapWidth)/2);
   const expected=Math.min(requestedDelta,Math.max(0,before.mapWidth+padding-before.worldWidth-before.left)),actual=after.left-before.left;
   assert.ok(Math.abs(actual-expected)<Math.max(.5,expected*.025),`Pan world delta ${actual}, expected ${expected}; input DPI mismatch or duplicate touch processing`);
   for(const label of after.labels){
    const [hx,hy]=label.head,inside=hx>=after.left+2&&hx<=after.left+after.width-2&&hy>=after.top+2&&hy<=after.top+after.height-2;
    if(inside)assert.equal(label.visible,true,`${label.id} has an in-view head but stale hidden bubble`);
   }
   await p.locator('#pan-toggle').click();return{requestedWorldDelta:requestedDelta,expectedWorldDelta:expected,actualWorldDelta:actual,visibleBubbles:after.labels.filter(x=>x.visible).length};
  });
  if(!c.mobile){
   await test(`${c.name}: resize preserves demo direction/state and updates density`,async()=>{
    await p.evaluate(async()=>{const r=window.officeRuntime;r.setDemoMode(true);r.selectStation('desk-01');await r.setStationDirection('desk-01','right');r.setStationState('desk-01','error');r.setView('workstation');});
    await p.setViewportSize({width:1280,height:900});await p.waitForFunction(()=>Math.abs(window.officeRuntime.snapshot().renderQuality.canvasCss[0]-document.querySelector('#game-container').getBoundingClientRect().width)<1);await settle(p);
    const v=await inspect(p),s=v.snapshot.stations.find(s=>s.id==='desk-01');assert.equal(s.direction,'right');assert.equal(s.state,'error');assert.equal(s.player.faceClockFrames,12);assert.equal(v.snapshot.view,'workstation');assert.ok(!v.overflow);
    assert.ok(v.quality.density>=c.dpr-0.02||v.quality.capped);return {canvas:v.gameCanvas,density:v.quality.density,state:s.state,direction:s.direction};
   });
  }
  await test(`${c.name}: no JS errors or failed asset requests`,()=>{assert.deepEqual(errors,[]);assert.deepEqual(failed,[]);return {errors,failed};});
  await context.close();
 }
 await test('right-facing asset selection uses the new aligned version',async()=>{
  const assets=JSON.parse(await readFile(resolve(root,'frontend/company-office/reference-v3/assets.json'),'utf8'));
  const c=assets.directions.right.character;assert.ok(c.base.includes('/repair-v4-aligned/'));
  for(const [action,spec]of Object.entries(c.actions)){assert.ok(spec.face.includes('/repair-v4-aligned/'),action);assert.equal(spec.faceClockFrames,{working:60,idle:36,syncing:60,error:12}[action]);}
  return {base:c.base,faceRect:c.faceRect,faceClipEllipse:c.faceClipEllipse,actions:Object.fromEntries(Object.entries(c.actions).map(([k,v])=>[k,{face:v.face,clock:v.faceClockFrames}]))};
 });
 await test('frozen expression template, original map, left/up and furniture stay byte-identical',async()=>{
  const before=JSON.parse(await readFile(resolve(root,'assets/company-office-reference-v3/repair-v4-qa/protected-baseline.json'),'utf8'));
  const changed=[];for(const [p,hash]of Object.entries(before.hashes)){const current=createHash('sha256').update(await readFile(resolve(root,p))).digest('hex');if(current!==hash)changed.push(p);}
  assert.deepEqual(changed,[]);assert.deepEqual(JSON.parse(await readFile(resolve(root,'frontend/company-office/reference-v3/layout.json'),'utf8')),before.layout);return {protectedFiles:Object.keys(before.hashes).length,changed,layoutUnchanged:true};
 });
 await test('quality/demo tests never POST any state or personnel changes',()=>{assert.deepEqual(posts,[]);});
}finally{
 await browser.close();
 const report={capturedAt:new Date().toISOString(),scope:'Actual installed Chrome; isolated local preview; device-resolution screenshots; no remote deployment. This validates render resolution, not invented native detail in the preserved 1584x993 map raster.',passed:results.filter(x=>x.pass).length,failed:results.filter(x=>!x.pass).length,results,observations};
 await writeFile(resolve(out,'4k-browser-qa.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({passed:report.passed,failed:report.failed,report:resolve(out,'4k-browser-qa.json')}));
 if(report.failed)process.exitCode=1;
}
