const {chromium}=require('/Users/hepingyu/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
(async()=>{
const out=__dirname,url=process.argv[2];
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows']});
try{
const page=await browser.newPage({viewport:{width:1440,height:1050}});const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('requestfailed',r=>errors.push(r.url()+': '+r.failure().errorText));
await page.goto(url);await page.waitForFunction(()=>window.previewState?.().ready);await page.bringToFront();
assert.equal(await page.locator('canvas').count(),5);
assert.deepEqual((await page.evaluate(()=>previewState())).players.map(p=>p.count),[2,2,2,2,12]);
await page.selectOption('#down-source','walk-down-12');
await page.evaluate(()=>{window.seen={working:[],down:[]};for(const id of ['working','down'])new MutationObserver(()=>seen[id].push(document.getElementById('frame-'+id).textContent)).observe(document.getElementById('frame-'+id),{childList:true});});
await page.waitForTimeout(2300);await page.locator('#play').click();
const seen=await page.evaluate(()=>seen);assert.equal(new Set(seen.working).size,12);assert.equal(new Set(seen.down).size,12);
const stopped=await page.evaluate(()=>previewState().players.map(p=>p.frame));await page.waitForTimeout(200);assert.deepEqual(await page.evaluate(()=>previewState().players.map(p=>p.frame)),stopped);
await page.locator('#reset').click();assert.equal((await page.evaluate(()=>previewState())).players.every(p=>p.frame===0),true);
await page.locator('#prev').click();assert.equal((await page.evaluate(()=>previewState())).players.find(p=>p.id==='working').frame,11);
await page.locator('#next').click();assert.equal((await page.evaluate(()=>previewState())).players.find(p=>p.id==='working').frame,0);
await page.selectOption('#business-state','researching');assert.match(await page.locator('#work-state-note').textContent(),/搜索信息/);assert.equal((await page.evaluate(()=>previewState())).players.find(p=>p.id==='working').assetKey,'working-v2');
await page.selectOption('#business-state','executing');assert.match(await page.locator('#work-state-note').textContent(),/执行任务/);
await page.selectOption('#background','checker');assert.equal(await page.locator('body').getAttribute('data-bg'),'checker');
await page.selectOption('#size','native');assert.equal(await page.locator('#canvas-working').evaluate(e=>e.getBoundingClientRect().width),96);
await page.selectOption('#background','office');await page.selectOption('#size','normal');await page.selectOption('#business-state','writing');
await page.screenshot({path:path.join(out,'preview-desktop.png'),fullPage:true});
await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:path.join(out,'preview-mobile.png'),fullPage:true});
await page.selectOption('#down-source','walk-down-pair');assert.equal((await page.evaluate(()=>previewState())).players.find(p=>p.id==='down').count,2);
await page.selectOption('#speed','0.5');assert.equal((await page.evaluate(()=>previewState())).speed,.5);
await page.emulateMedia({reducedMotion:'reduce'});await page.reload();await page.waitForFunction(()=>previewState().ready);assert.equal((await page.evaluate(()=>previewState())).playing,false);
assert.deepEqual(errors,[]);
const report={verified:true,url,canvases:5,defaultActualFrameCounts:[2,2,2,2,12],observedWorkFrames:new Set(seen.working).size,observedDown12Frames:new Set(seen.down).size,playbackObservedMilliseconds:2300,pauseVerified:true,firstLastNavigationVerified:true,sharedBusinessStateVerified:true,native96pxVerified:true,mobile390NoOverflow:true,reducedMotionDefaultPaused:true,errors,productionModified:false,newArtworkGenerated:false};
fs.writeFileSync(path.join(out,'browser-qa.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
