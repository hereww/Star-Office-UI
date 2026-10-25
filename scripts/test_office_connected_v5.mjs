#!/usr/bin/env node
/** Screen-effects-only V5 browser acceptance; generates NEW no-hand captures. */
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {MODE,ROOT,QA_DIR,launchBrowser,openV5,expectClean} from './connected_v5_qa_helpers.mjs';
await mkdir(QA_DIR,{recursive:true});
const report={schemaVersion:2,capturedAt:new Date().toISOString(),animationMode:MODE,
  scope:'Screen-only local Chromium preview. No backend mutation; emulated devices, not physical-device approval.',
  passed:0,failed:0,results:[],observations:[],screenshots:[]};
async function check(name,fn){try{const evidence=await fn();report.results.push({name,pass:true,evidence});report.passed++;console.log('PASS',name);}
catch(error){report.results.push({name,pass:false,error:error.stack,evidence:error.evidence??null});report.failed++;console.error('FAIL',name,error.message);}}
async function capture(page,name){
  // Paint the CURRENT scene without advancing any test/state clock.
  await page.evaluate(()=>{const r=window.officeRuntime,g=r.scene.game;g.renderer.preRender();g.scene.render(g.renderer);g.renderer.postRender();});
  const path=resolve(QA_DIR,name),png=await page.screenshot({path});const record={path,width:png.readUInt32BE(16),height:png.readUInt32BE(20),animationMode:MODE,current:true};report.screenshots.push(record);return record;
}
const browser=await launchBrowser();
try{
  for(const device of [{name:'desktop-4k',width:1920,height:1080,dpr:2,mobile:false},{name:'phone-portrait',width:390,height:844,dpr:3,mobile:true},{name:'phone-landscape',width:844,height:390,dpr:3,mobile:true}]){
    const session=await openV5(browser,{viewport:{width:device.width,height:device.height},deviceScaleFactor:device.dpr,isMobile:device.mobile,hasTouch:device.mobile}),{page}=session;report.url=session.url;
    await page.evaluate(()=>{const r=window.officeRuntime,states=window.__screenOnlyV5QA.states;r.stations.forEach((s,n)=>r.setStationState(s.id,states[n%states.length],{source:'demo',detail:'屏幕动画验收'}));r.update(r.scene.time.now+500);});
    const observation=await page.evaluate(()=>{const r=window.officeRuntime;return {snapshot:r.snapshot(),quality:window.officeRenderQuality?.snapshot(),variant:document.body.dataset.officeVariant,
      title:document.querySelector('#office-viewbar h1')?.textContent,players:r.stations.map(s=>({id:s.id,issues:window.__screenOnlyV5QA.noInteraction(s.player)})),fontsLoaded:document.fonts.status};});report.observations.push({device:device.name,observation});
    await check(`${device.name}: 16 red/green seats, four directions, no walking, uniform screen-effects naming`,()=>{
      const s=observation.snapshot;assert.equal(s.scene,'company-office-connected-v5');assert.equal(observation.variant,'connected-v5');assert.equal(s.animationMode,MODE);assert.equal(s.walkIntegrated,false);
      assert.equal(s.stations.length,16);for(const region of ['west','east'])assert.equal(s.stations.filter(x=>x.region===region).length,8);
      for(const d of ['up','down','left','right'])assert.equal(s.stations.filter(x=>x.direction===d).length,4);assert.equal('handsContract' in s,false);
      return {scene:s.scene,title:observation.title,animationMode:s.animationMode,seats:16};
    });
    await check(`${device.name}: every direction/state has no handsCanvas, no keyboard interaction`,()=>expectClean({players:observation.players.length,violations:observation.players.flatMap(p=>p.issues.map(i=>({id:p.id,...i})))}));
    await check(`${device.name}: 4K/high-DPI backing, loaded CJK fonts and clear text layer contract`,()=>{
      const q=observation.quality;if(!device.mobile){assert.equal(q.fourKBacking,true);assert.ok(q.drawingBuffer[0]>=3840&&q.drawingBuffer[1]>=2160);}
      assert.ok(q.textResolution>=2);assert.ok(q.textFont.includes('PingFang SC'));assert.equal(observation.fontsLoaded,'loaded');return q;
    });
    await check(`${device.name}: independent code/search/terminal styles; four rear LED-only displays`,()=>{
      const screens=observation.snapshot.screens;assert.equal(screens.length,16);assert.equal(screens.filter(s=>s.kind==='back').length,4);
      assert.ok(screens.filter(s=>s.kind==='back').every(s=>s.rearContent===false&&s.polygon.length===0));assert.ok(screens.every(s=>s.clippedToPolygon&&s.screenAnimation==='code-editor-search-terminal'));
      const styles=[...new Set(screens.flatMap(s=>s.styles))];for(const style of ['code-editor-typing','code-search-reading','code-terminal-output'])assert.ok(styles.includes(style));return {styles,rear:4};
    });
    await check(`${device.name}: browser errors, resource errors and attempted backend writes are zero`,()=>{
      assert.deepEqual(session.errors,[]);assert.deepEqual(session.failedResponses,[]);assert.deepEqual(session.blockedWrites,[]);return {errors:session.errors,failedResponses:session.failedResponses,blockedWrites:session.blockedWrites};
    });
    const shot=await capture(page,`screen-only-${device.name}-states.png`);if(!device.mobile)assert.deepEqual([shot.width,shot.height],[3840,2160]);
    if(!device.mobile){await page.evaluate(()=>window.officeRuntime.setView('overview'));await capture(page,'screen-only-desktop-4k-overview.png');
      for(const direction of ['right','left','down','up']){await page.evaluate(d=>{const r=window.officeRuntime,s=r.stations.find(s=>s.direction===d);r.selectStation(s.id);r.setView('workstation');r.setStationState(s.id,'writing',{source:'demo',detail:'屏幕代码演示'});r.update(r.scene.time.now+1250);},direction);
        await capture(page,`screen-only-${direction}-workstation.png`);}
    }
    await session.context.close();
  }
  const session=await openV5(browser),{page}=session;
  await check('Runtime update uses each seat state/time: code/search/terminal + LED animate without actor animation',async()=>{
    const result=await page.evaluate(()=>{const r=window.officeRuntime,q=window.__screenOnlyV5QA,rows=[],violations=[];
      for(const state of ['writing','researching','executing']){r.stations.forEach(s=>r.setStationState(s.id,state,{source:'demo'}));
        const screens=r.screenOverlays.map(o=>({id:o.screen.seatId,hashes:[]})),actors=r.stations.map(s=>({id:s.id,hashes:[]}));
        // 1200-3999ms is after the first expression burst, before the 5-second burst.
        // Original faces stay still here; only SCREEN pixels should change.
        for(const ms of [1250,1500,1750,2000,2250,2500,2750,3000,3250,3500,3750]){
          r.update(r.scene.time.now+ms);r.screenOverlays.forEach((o,i)=>screens[i].hashes.push(o.components.map(c=>q.hash(q.pixels(c.canvas))).join(':')));
          r.stations.forEach((s,i)=>{actors[i].hashes.push(q.hash(q.pixels(s.player.canvas)));violations.push(...q.noInteraction(s.player).map(x=>({id:s.id,...x})));});
        }
        for(const s of screens)if(new Set(s.hashes).size<2)violations.push({id:s.id,state,type:'runtime-screen-not-animated'});
        for(const a of actors)if(new Set(a.hashes).size!==1)violations.push({id:a.id,state,type:'actor-moved-outside-original-expression-burst'});
        rows.push({state,screens:screens.map(s=>({id:s.id,uniqueFrames:new Set(s.hashes).size})),actors:actors.map(a=>({id:a.id,uniqueFrames:new Set(a.hashes).size}))});
      }return {states:rows.length,rows,violations};});return expectClean(result);
  });
  await check('Real Chromium full-size code, search and terminal glyphs rasterize, blink and remain in polygon',async()=>{
    const result=await page.evaluate(()=>{const r=window.officeRuntime,q=window.__screenOnlyV5QA,rows=[],violations=[];
      for(const o of r.screenOverlays)for(const state of ['writing','researching','executing']){const sample=q.inspectOverlay(o,state);rows.push({id:o.screen.seatId,...sample});violations.push(...sample.issues.map(i=>({id:o.screen.seatId,...i})));}
      return {cycles:rows.length,rows,violations};});assert.equal(result.cycles,48);return expectClean(result);
  });
  await check('Page-local role/device/server replacements retain each direction and screen-only runtime integration',async()=>{
    const result=await page.evaluate(async()=>{const r=window.officeRuntime,q=window.__screenOnlyV5QA,rows=[],violations=[];
      for(const direction of q.directions){const s=r.stations.find(s=>s.direction===direction),old=s.player;
        const version=r.characterVersion;await r.replaceCharacter(structuredClone(old.spec.character),{stationId:s.id});
        if(s.player===old||r.characterVersion<=version||s.player.direction!==direction)violations.push({id:s.id,type:'role-replacement-failed'});
        const b=r.benches.find(b=>b.spec.id===s.benchId),screen=structuredClone(b.manifest.screens.find(x=>x.seatId===s.id));
        if(screen.kind==='front')screen.polygon[0][0]+=.25;else screen.led[0]+=.25;
        const oldOverlay=r.screenOverlays.find(o=>o.screen.seatId===s.id);r.replaceScreen(s.id,screen);const o=r.screenOverlays.find(o=>o.screen.seatId===s.id);
        if(o===oldOverlay)violations.push({id:s.id,type:'device-replacement-failed'});
        rows.push({id:s.id,direction});violations.push(...q.noInteraction(s.player));violations.push(...q.inspectOverlay(o,'executing').issues);
      }
      const v=r.serverVersion;await r.replaceServer('../reference-v3/media/server-rack.png');if(r.serverVersion<=v)violations.push({type:'server-replacement-failed'});
      rows.forEach(row=>violations.push(...q.noInteraction(r.getStation(row.id).player)));return {rows,serverVersion:r.serverVersion,violations};});
    assert.equal(result.rows.length,4);return expectClean(result);
  });
  await session.context.close();
  await check('Real browser loads both benches without ANY keyboardBounds/keyboardCenter manifest annotations',async()=>{
    const delivered=[];
    const stripped=await openV5(browser,{},async page=>{
      await page.route(/\/company-office\/connected-v4\/media\/(vertical|horizontal)\/manifest\.json(?:\?.*)?$/,async route=>{
        const orientation=new URL(route.request().url()).pathname.includes('/vertical/')?'vertical':'horizontal';
        const source=JSON.parse(await readFile(resolve(ROOT,`frontend/company-office/connected-v4/media/${orientation}/manifest.json`),'utf8'));
        const strip=value=>{if(!value||typeof value!=='object')return;for(const k of Object.keys(value))if(/^keyboard/.test(k))delete value[k];else strip(value[k]);};
        strip(source);delivered.push(orientation);await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(source)});
      });
    });
    try{
      assert.deepEqual(delivered.sort(),['horizontal','vertical']);
      const result=await stripped.page.evaluate(()=>{const r=window.officeRuntime,q=window.__screenOnlyV5QA,violations=[];
        for(const b of r.benches){for(const c of b.manifest.seatContacts)if('keyboardBounds' in c||'keyboardCenter' in c)violations.push({type:'keyboard-fields-synthesized',id:c.id});}
        for(const state of q.states){r.stations.forEach(s=>r.setStationState(s.id,state,{source:'demo'}));r.update(r.scene.time.now+500);
          for(const s of r.stations)violations.push(...q.noInteraction(s.player).map(i=>({id:s.id,state,...i})));}
        return {seats:r.stations.length,screens:r.screenOverlays.length,benches:r.benches.length,mode:r.snapshot().animationMode,violations};});
      assert.equal(result.seats,16);assert.equal(result.screens,16);assert.equal(result.benches,2);assert.equal(result.mode,MODE);
      assert.deepEqual(stripped.errors,[]);assert.deepEqual(stripped.failedResponses,[]);assert.deepEqual(stripped.blockedWrites,[]);return expectClean(result);
    }finally{await stripped.context.close();}
  });
}catch(error){report.results.push({name:'Browser harness failure',pass:false,error:error.stack});report.failed++;}
finally{await browser.close();report.finishedAt=new Date().toISOString();report.status=report.failed?'failed':'passed';await writeFile(resolve(QA_DIR,'browser-qa.json'),`${JSON.stringify(report,null,2)}\n`);}
console.log(JSON.stringify({passed:report.passed,failed:report.failed,report:resolve(QA_DIR,'browser-qa.json')},null,2));process.exitCode=report.failed?1:0;
