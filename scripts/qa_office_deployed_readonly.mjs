#!/usr/bin/env node
/** Read-only production scene QA. No credentials, admin login or backend mutation.
 * Instrumentation exists only in this test browser's fetched map-loader response.
 */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const require=createRequire('/Users/hepingyu/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json');
const {chromium}=require('playwright');
const base=process.env.OFFICE_QA_BASE || 'http://127.0.0.1:19026/';
const out=resolve(process.env.OFFICE_QA_OUTPUT || '.local/office-deploy-audit-20261006/prestage-browser');
const origin=new URL(base).origin;
assert.ok(['http://127.0.0.1:19026','http://192.168.100.221:19000','https://192.168.100.221:19443'].includes(origin));
await mkdir(out,{recursive:true});
const report={captured_at:new Date().toISOString(),time_zone:'Asia/Shanghai',base,scope:'Actual deployed immutable release and live approved four-user metadata. GET/HEAD only. Browser-only instrumentation; emulated devices, not physical-device certification.',checks:[],page_errors:[],failed_responses:[],external_requests:[],blocked_writes:[],screenshots:[],devices:[]};
function check(name,fn){try{const evidence=fn();report.checks.push({name,pass:true,evidence});console.log('PASS',name);}catch(error){report.checks.push({name,pass:false,error:error.message});console.error('FAIL',name,error.message);}}
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--disable-background-timer-throttling']});
try{
for(const spec of [{name:'desktop',width:1920,height:1080,dpr:2},{name:'tablet',width:768,height:1024,dpr:2,mobile:true},{name:'phone-portrait',width:390,height:844,dpr:3,mobile:true},{name:'phone-landscape',width:844,height:390,dpr:3,mobile:true}]){
 const context=await browser.newContext({viewport:{width:spec.width,height:spec.height},deviceScaleFactor:spec.dpr,isMobile:!!spec.mobile,hasTouch:!!spec.mobile});
 const page=await context.newPage();
 page.on('pageerror',error=>report.page_errors.push({device:spec.name,error:error.message}));
 page.on('response',response=>{if(response.status()>=400)report.failed_responses.push({device:spec.name,status:response.status(),path:new URL(response.url()).pathname});});
 page.on('request',request=>{const url=new URL(request.url());if(!['data:','blob:'].includes(url.protocol)&&url.origin!==origin)report.external_requests.push(url.origin+url.pathname);});
 await page.route('**/*',async route=>{if(!['GET','HEAD'].includes(route.request().method())){report.blocked_writes.push(route.request().method()+' '+new URL(route.request().url()).pathname);await route.abort();}else await route.continue();});
 await page.route('**/office/map-loader.mjs',async route=>{const response=await route.fetch();const text=await response.text();assert.ok(text.includes('readyResolve(); onReady'));await route.fulfill({response,body:text.replace('readyResolve(); onReady','window.__officeQA = { runtime, adapter }; readyResolve(); onReady')});});
 const started=Date.now();
 await page.goto(base,{waitUntil:'domcontentloaded',timeout:60000});
 await page.waitForFunction(()=>window.__officeQA?.runtime?.ready&&window.__officeQA.adapter?.actualSnapshot?.source?.status==='ok',null,{timeout:60000});
 await page.evaluate(()=>document.fonts.ready); await page.waitForTimeout(900);
 const observation=await page.evaluate(()=>{const {runtime:r,adapter:a}=window.__officeQA;return {scene:r.snapshot().scene,animationMode:r.snapshot().animationMode,characterTemplateId:r.snapshot().characterTemplateId,rockRoomAnimation:r.snapshot().rockRoomAnimation,walkIntegrated:r.snapshot().walkIntegrated,stationCount:r.stations.length,boundCount:a.snapshot().stations.filter(s=>s.bound).length,source:a.actualSnapshot.source,publicConcurrent:a.snapshot().stations.filter(s=>s.bound).map(s=>({seat_id:s.id,current:s.current,activity:s.activity,bubble:s.speechBubble.lines})),players:r.stations.map(s=>({direction:s.direction,hasHands:'handsCanvas' in s.player,animationMode:s.player.snapshot().animationMode,keyboardInteraction:s.player.snapshot().keyboardInteraction})),provenance:r.sourceSpriteHashes?.status??'computed',secureContext:window.isSecureContext,overflow:document.documentElement.scrollWidth>innerWidth+1,canvas:[r.scene.game.canvas.width,r.scene.game.canvas.height],fonts:document.fonts.status,buttons:[...document.querySelectorAll('button')].filter(b=>b.offsetWidth&&b.offsetHeight).map(b=>({label:b.getAttribute('aria-label')||b.textContent,width:b.getBoundingClientRect().width,height:b.getBoundingClientRect().height})),unlabelledInputs:[...document.querySelectorAll('input:not([type="hidden"]),select')].filter(i=>i.offsetWidth&&!i.getAttribute('aria-label')&&!i.getAttribute('aria-labelledby')&&!i.labels?.length).map(i=>i.tagName),bodyText:document.body.innerText.slice(0,1500)};});
 report.devices.push({device:spec.name,ready_ms:Date.now()-started,observation});
 check(`${spec.name}: V5, sixteen seats, four approved live users`,()=>{assert.equal(observation.scene,'company-office-connected-v5');assert.equal(observation.stationCount,16);assert.equal(observation.boundCount,4);assert.equal(observation.source.status,'ok');return {scene:observation.scene,seats:16,bound:4};});
 check(`${spec.name}: screen-only expressions; no walking, hands or keyboard layers`,()=>{assert.equal(observation.animationMode,'expression-plus-screen-effects');assert.equal(observation.walkIntegrated,false);for(const p of observation.players){assert.equal(p.hasHands,false);assert.equal(p.animationMode,'expression-plus-screen-effects');assert.equal(p.keyboardInteraction,false);}return {players:16};});
 check(`${spec.name}: no horizontal overflow, CJK fonts loaded and labelled inputs`,()=>{assert.equal(observation.overflow,false);assert.equal(observation.fonts,'loaded');assert.deepEqual(observation.unlabelledInputs,[]);return {canvas:observation.canvas};});
 if(spec.name==='desktop'){
  check('desktop: current V5 template, four rock-room cats and two occlusion layers',()=>{assert.equal(observation.characterTemplateId,'connected-v5-character-template-v1');const rock=observation.rockRoomAnimation;assert.equal(rock.enabled,true);assert.equal(rock.performerCount,4);assert.equal(rock.occlusionLayerCount,2);assert.equal(rock.frameCount,12);assert.equal(rock.fps,12);assert.equal(rock.audio,false);assert.equal(rock.walking,false);return rock;});
  check('desktop: 3840×2160-or-higher physical canvas',()=>{assert.ok(observation.canvas[0]>=3840);assert.ok(observation.canvas[1]>=1900);return observation.canvas;});
  check('HTTP non-secure origin does not call unavailable SubtleCrypto',()=>{if(origin==='http://192.168.100.221:19000'){assert.equal(observation.secureContext,false);assert.equal(observation.provenance,'unavailable-in-insecure-context');}return {secureContext:observation.secureContext,provenance:observation.provenance};});
 }
 const screenshot=resolve(out,`employee-${spec.name}-overview.png`);await page.screenshot({path:screenshot});report.screenshots.push(screenshot);
 await page.evaluate(()=>window.__officeQA.runtime.setView('east'));await page.waitForTimeout(500);
 const focused=await page.evaluate(()=>{const a=window.__officeQA.adapter;return {view:a.runtime.view,bubbles:a.runtime.stations.filter(s=>s.bound).map(s=>({id:s.id,text:s.bubbleText?.text,visible:!!s.bubbleText?.visible,leader:s.speechPlacement?.leader})),buttons:[...document.querySelectorAll('button')].filter(b=>b.offsetWidth).map(b=>b.textContent)};});
 check(`${spec.name}: four compact status bubbles remain visible in green area`,()=>{assert.equal(focused.view,'east');assert.equal(focused.bubbles.length,4);assert.ok(focused.bubbles.every(b=>b.visible&&/^(休息中|工作中|忙碌中|玩命干活中|狂暴模式|数据过期|数据未知|未绑定)$/.test(b.text)));assert.equal(focused.bubbles.find(b=>b.id==='desk-14')?.visible,true);return focused.bubbles;});
 const focusShot=resolve(out,`employee-${spec.name}-green.png`);await page.screenshot({path:focusShot});report.screenshots.push(focusShot);
 await context.close();
}
check('no JavaScript errors, missing runtime assets, external requests or backend writes',()=>{assert.deepEqual(report.page_errors,[]);assert.deepEqual(report.failed_responses,[]);assert.deepEqual(report.external_requests,[]);assert.deepEqual(report.blocked_writes,[]);return {errors:0,assetFailures:0,writes:0};});
}finally{await browser.close();report.passed=report.checks.filter(c=>c.pass).length;report.failed=report.checks.filter(c=>!c.pass).length;await writeFile(resolve(out,'report.json'),JSON.stringify(report,null,2)+'\n');}
if(report.failed)process.exitCode=1;
console.log(JSON.stringify({passed:report.passed,failed:report.failed,report:resolve(out,'report.json')}));
