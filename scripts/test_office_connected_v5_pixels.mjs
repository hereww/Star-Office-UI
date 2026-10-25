#!/usr/bin/env node
/** Independent full-RGBA actor equality + exact source-polygon screen-only acceptance.
 * No allowed actor-difference mask, no handsCanvas, no keyboard interactions.
 * Output is confined to connected-v5/qa; all browser changes are page-local.
 */
import assert from 'node:assert/strict';
import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,relative} from 'node:path';
import {ROOT,QA_DIR,MODE,launchBrowser,openV5,expectClean} from './connected_v5_qa_helpers.mjs';
const output=resolve(QA_DIR,'pixel-qa.json'),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const report={schemaVersion:2,startedAt:new Date().toISOString(),animationMode:MODE,
  scope:'Screen-only independent real Chromium RGBA acceptance. Local demo mutations only; not human visual approval.',
  contract:{actor:'V5 byte-identical to V4 for all states; ZERO pixel exemptions',interaction:'no handsCanvas; handsRendered=false; handsAction=none; keyboardInteraction=false',
    matrix:'4 directions x 16 seats x 6 states x 12 samples',screenClip:'independently rasterized original source polygon/LED; no enlarged mask or rectangle exemption',
    screen:'real rasterized code/search/terminal + controlled brightness/cursor; rear LED-only; thin screens no glyphs',fourK:'3840x2160 browser capture; not native-4K source art'},
  passed:0,failed:0,results:[]};
let browser,session,v4Baseline;
async function check(name,fn){try{const evidence=await fn();report.results.push({name,pass:true,evidence});report.passed++;console.log('PASS',name);return evidence;}
catch(error){report.results.push({name,pass:false,error:error.stack,evidence:error.evidence??null});report.failed++;console.error('FAIL',name,error.message);return null;}}
async function treeHashes(directory){const hashes={};async function walk(dir){for(const e of await readdir(dir,{withFileTypes:true})){const path=resolve(dir,e.name);if(e.isDirectory())await walk(path);else if(e.isFile())hashes[relative(ROOT,path)]=sha(await readFile(path));else throw new Error(`Protected tree contains non-file ${path}`);}}await walk(directory);return hashes;}
async function historicalHashes(){const path=resolve(ROOT,'assets/company-office-connected-v4/qa/protected-baseline.json'),baseline=JSON.parse(await readFile(path,'utf8'));assert.ok(Object.keys(baseline.files).length>=90);const mismatches=[];
for(const [file,expected] of Object.entries(baseline.files)){const actual=sha(await readFile(resolve(ROOT,file)));if(actual!==expected)mismatches.push({file,expected,actual});}assert.deepEqual(mismatches,[]);return {count:Object.keys(baseline.files).length,mismatches};}
try{
  await check('Historical approved map/character/expression SHA-256 before run',historicalHashes);
  await check('Capture independent V4 source/media hashes before run',async()=>{v4Baseline=await treeHashes(resolve(ROOT,'frontend/company-office/connected-v4'));return {files:v4Baseline,note:'Run-start baseline, not historical acceptance'};});
  const boot=await check('Real Chromium boots 16 screen-only seats, no hand Canvas or keyboard binding',async()=>{
    browser=await launchBrowser();session=await openV5(browser);report.url=session.url;
    const evidence=await session.page.evaluate(()=>{const r=window.officeRuntime,q=window.__screenOnlyV5QA;return {scene:r.snapshot().scene,mode:r.snapshot().animationMode,
      players:r.stations.map(s=>({id:s.id,direction:s.direction,canvas:[s.player.canvas.width,s.player.canvas.height]})),violations:r.stations.flatMap(s=>q.noInteraction(s.player).map(i=>({id:s.id,...i})))};});
    assert.equal(evidence.scene,'company-office-connected-v5');assert.equal(evidence.mode,MODE);assert.equal(evidence.players.length,16);
    for(const p of evidence.players)assert.deepEqual(p.canvas,[192,192]);return expectClean(evidence);
  });
  // Continue actor/screen checks even if contract fails, so old hands cannot hide screen failures.
  if(session){const {page}=session;
    await check('384 direction/seat/state combinations: all 4608 actor samples exactly equal V4',async()=>{
      const result=await page.evaluate(async()=>{const q=window.__screenOnlyV5QA,r=window.officeRuntime,rows=[],violations=[];
        for(const s of r.stations)for(const direction of q.directions){const {v4,v5}=await q.pair(s,direction);
          for(const state of q.states){const row={id:s.id,direction,state,samples:0,changedPixels:0};
            for(let n=0;n<12;n++){const sample=q.inspect(v4,v5,state,Math.ceil((n+.01)*1000/12));row.samples++;row.changedPixels+=sample.changedPixels;
              for(const i of sample.issues)if(violations.length<100)violations.push({id:s.id,direction,state,frame:n,...i});}rows.push(row);}}
        return {combinations:rows.length,samples:rows.reduce((n,x)=>n+x.samples,0),changedPixels:rows.reduce((n,x)=>n+x.changedPixels,0),rows,violations};});
      assert.equal(result.combinations,384);assert.equal(result.samples,4608);assert.equal(result.changedPixels,0);return expectClean(result);
    });
    await check('192 work cycles: face held fixed, every actor pixel stays static while screens remain external',async()=>{
      const result=await page.evaluate(async()=>{const q=window.__screenOnlyV5QA,r=window.officeRuntime,rows=[],violations=[];
        for(const s of r.stations)for(const direction of q.directions){const {v4,v5}=await q.pair(s,direction);
          for(const state of ['writing','researching','executing']){const hashes=[];
            for(let n=0;n<12;n++){const sample=q.inspect(v4,v5,state,Math.ceil((n+.01)*1000/12),true);hashes.push(q.hash(sample.after));
              for(const i of sample.issues)if(violations.length<100)violations.push({id:s.id,direction,state,frame:n,...i});}
            if(new Set(hashes).size!==1)violations.push({id:s.id,direction,state,type:'frozen-expression-actor-animated'});
            if(!v5._screen().external||v5._screen().visible)violations.push({id:s.id,type:'screen-painted-into-player'});rows.push({id:s.id,direction,state,uniqueActorFrames:new Set(hashes).size});}}
        return {cycles:rows.length,rows,violations};});assert.equal(result.cycles,192);return expectClean(result);
    });
    await check('Original expression clocks, all 12 atlas cells, reduced motion and presentation modes equal V4',async()=>{
      const result=await page.evaluate(async()=>{const q=window.__screenOnlyV5QA,r=window.officeRuntime,violations=[];let clockSamples=0,faceSamples=0,presentationSamples=0;
        for(const direction of q.directions){const {v4,v5}=await q.pair(r.stations.find(s=>s.direction===direction),direction);
          for(const state of q.states){for(const ms of [0,83,84,999,1000,1084,2999,3000,3084,4999,5000,5084,10000]){const sample=q.inspect(v4,v5,state,ms);clockSamples++;violations.push(...sample.issues.map(i=>({direction,state,ms,...i})));}
            for(let frame=0;frame<12;frame++){v4.setFrame(frame);v5.setFrame(frame);faceSamples++;if(!q.equal(q.pixels(v4.canvas),q.pixels(v5.canvas))||JSON.stringify(q.clocks(v4))!==JSON.stringify(q.clocks(v5)))violations.push({type:'explicit-face-frame-drift',direction,state,frame});}}
          for(const reduced of [false,true])for(const presentation of [{actorVisible:true,neutral:false},{actorVisible:false,neutral:false},{actorVisible:true,neutral:true}]){
            v4.setReducedMotion(reduced);v5.setReducedMotion(reduced);v4.setPresentation(presentation);v5.setPresentation(presentation);
            for(const state of q.states){presentationSamples++;violations.push(...q.inspect(v4,v5,state,500).issues.map(i=>({direction,state,reduced,presentation,...i})));}}
        }return {clockSamples,faceSamples,presentationSamples,violations};});
      assert.equal(result.clockSamples,312);assert.equal(result.faceSamples,288);assert.equal(result.presentationSamples,144);return expectClean(result);
    });
    await check('16 displays x six states: exact polygon/LED raster, real code/search/terminal and time variation',async()=>{
      const result=await page.evaluate(()=>{const q=window.__screenOnlyV5QA,r=window.officeRuntime,rows=[],violations=[];
        for(const o of r.screenOverlays){const row={id:o.screen.seatId,kind:o.screen.kind,thin:o.thin,states:[]};
          for(const c of o.components){const s=o.screen,expected=c.config.visible?(()=>{const xs=s.polygon.map(p=>p[0]),ys=s.polygon.map(p=>p[1]);return[Math.min(...xs),Math.min(...ys),Math.max(...xs)-Math.min(...xs),Math.max(...ys)-Math.min(...ys)];})():(s.led.length===2?[...s.led,2,2]:s.led);
            if(JSON.stringify(c.bounds)!==JSON.stringify(expected))violations.push({id:s.seatId,type:'source-bounds-changed',expected,actual:c.bounds});
            const t=r.benches.find(b=>b.spec.stationIds.includes(s.seatId)).transform,expectedWorld=[t.x+c.bounds[0]*t.scale,t.y+c.bounds[1]*t.scale,c.bounds[2]*t.scale,c.bounds[3]*t.scale];
            if([c.sprite.x,c.sprite.y,c.sprite.displayWidth,c.sprite.displayHeight].some((v,i)=>Math.abs(v-expectedWorld[i])>1e-5))violations.push({id:s.seatId,type:'wrong-world-screen-transform'});
          }
          for(const state of q.states){const sample=q.inspectOverlay(o,state);row.states.push(sample);violations.push(...sample.issues.map(i=>({id:row.id,...i})));}rows.push(row);
        }return {screens:rows.length,rear:rows.filter(r=>r.kind==='back').length,thin:rows.filter(r=>r.thin).length,cycles:rows.length*q.states.length,samples:rows.length*q.states.length*q.times.length,rows,violations};});
      assert.equal(result.screens,16);assert.equal(result.rear,4);assert.equal(result.thin,8);assert.equal(result.cycles,96);assert.equal(result.samples,4608);return expectClean(result);
    });
    await check('All screen states freeze in reduced-motion; idle remains pixel-static with animation enabled',async()=>{
      const result=await page.evaluate(()=>{const q=window.__screenOnlyV5QA,rows=[],violations=[];
        for(const o of window.officeRuntime.screenOverlays)for(const state of q.states){const sample=q.inspectOverlay(o,state,[0,84,500,1250,3917,9999],true);rows.push({id:o.screen.seatId,state,uniqueFrames:sample.uniqueFrames});violations.push(...sample.issues.map(i=>({id:o.screen.seatId,...i})));}
        return {cycles:rows.length,rows,violations};});assert.equal(result.cycles,96);return expectClean(result);
    });
    await check('Four-direction real character/device/server replacement preserves screens without hands or changed actor clocks',async()=>{
      const result=await page.evaluate(async()=>{const q=window.__screenOnlyV5QA,r=window.officeRuntime,rows=[],violations=[];
        for(const direction of q.directions){const s=r.stations.find(s=>s.direction===direction),old=s.player,c=structuredClone(old.spec.character),base=q.make(),ctx=base.getContext('2d');ctx.drawImage(old.images.base,0,0);
          const data=ctx.getImageData(0,0,192,192);let index=-1;for(let i=0;i<data.data.length;i+=4)if(data.data[i+3]===255){data.data[i]=(data.data[i]+17)%256;index=i;break;}if(index<0)throw new Error('No opaque replacement pixel');ctx.putImageData(data,0,0);c.base=base.toDataURL();
          const version=r.characterVersion;await r.replaceCharacter(c,{stationId:s.id});const current=r.getStation(s.id).player;
          if(current===old||r.characterVersion<=version||current.spec.character.base!==c.base)violations.push({id:s.id,type:'character-replacement-not-applied'});
          const assets=structuredClone(current.assets),{v4}=await q.pair(s,direction,assets);
          for(const state of q.states)violations.push(...q.inspect(v4,current,state,500).issues.map(i=>({id:s.id,phase:'character-replacement',state,...i})));
          const b=r.benches.find(b=>b.spec.id===s.benchId),screen=structuredClone(b.manifest.screens.find(x=>x.seatId===s.id)),oldOverlay=r.screenOverlays.find(o=>o.screen.seatId===s.id);
          if(screen.kind==='front')screen.polygon[0][0]+=.25;else screen.led[0]+=.25;
          const sv=r.screenVersion??0;r.replaceScreen(s.id,screen);const overlay=r.screenOverlays.find(o=>o.screen.seatId===s.id);
          if(overlay===oldOverlay||(r.screenVersion??0)<=sv||JSON.stringify(overlay.screen)!==JSON.stringify(screen))violations.push({id:s.id,type:'device-replacement-not-applied'});
          for(const state of ['writing','researching','executing'])violations.push(...q.inspectOverlay(overlay,state).issues.map(i=>({id:s.id,phase:'device-replacement',...i})));
          rows.push({id:s.id,direction,characterVersion:r.characterVersion,screenVersion:r.screenVersion,noHands:q.noInteraction(current).length===0});
        }
        const serverVersion=r.serverVersion;await r.replaceServer('../reference-v3/media/server-rack.png');if(r.serverVersion<=serverVersion)violations.push({type:'server-replacement-not-applied'});
        for(const row of rows){const player=r.getStation(row.id).player;violations.push(...q.noInteraction(player).map(i=>({id:row.id,...i})));const o=r.screenOverlays.find(o=>o.screen.seatId===row.id);violations.push(...q.inspectOverlay(o,'executing').issues.map(i=>({id:row.id,phase:'server-replacement',...i})));}
        return {replacements:rows.length,rows,serverVersion:r.serverVersion,violations};});assert.equal(result.replacements,4);return expectClean(result);
    });
    await check('New no-hand screen-only 4K capture and clean no-write browser execution',async()=>{
      await page.evaluate(()=>{const r=window.officeRuntime;r.stations.forEach(s=>r.setStationState(s.id,'writing',{source:'demo',detail:'屏幕动画验收'}));r.update(r.scene.time.now+1250);const g=r.scene.game;g.renderer.preRender();g.scene.render(g.renderer);g.renderer.postRender();});
      const path=resolve(QA_DIR,'screen-only-pixel-4k.png'),png=await page.screenshot({path});const width=png.readUInt32BE(16),height=png.readUInt32BE(20);
      assert.deepEqual([width,height],[3840,2160]);assert.deepEqual(session.errors,[]);assert.deepEqual(session.failedResponses,[]);assert.deepEqual(session.blockedWrites,[]);
      return {path,width,height,sha256:sha(png),browserErrors:session.errors,failedResponses:session.failedResponses,blockedWrites:session.blockedWrites,note:'New screen-only capture; no historical typing-detail images reused'};
    });
  }else report.notRun=['Actor full-RGBA matrix','screen raster matrix','replacements','4K capture'];
}catch(error){report.results.push({name:'Harness unexpected failure',pass:false,error:error.stack,evidence:error.evidence??null});report.failed++;}
finally{
  if(browser)await browser.close();
  await check('Historical protected assets unchanged after run',historicalHashes);
  if(v4Baseline)await check('Complete V4 source/media hashes unchanged from run-start',async()=>{const current=await treeHashes(resolve(ROOT,'frontend/company-office/connected-v4'));assert.deepEqual(current,v4Baseline);return {files:Object.keys(current).length,unchanged:true};});
  report.finishedAt=new Date().toISOString();report.status=report.failed?'failed':'passed';await mkdir(QA_DIR,{recursive:true});await writeFile(output,`${JSON.stringify(report,null,2)}\n`);
  console.log(JSON.stringify({passed:report.passed,failed:report.failed,report:output},null,2));
}
process.exitCode=report.failed?1:0;
