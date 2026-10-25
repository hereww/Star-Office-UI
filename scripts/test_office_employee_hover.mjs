#!/usr/bin/env node
/** Current V5 employee-page acceptance only; never opens the legacy index page. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';

const base = new URL(process.env.OFFICE_QA_URL || 'http://127.0.0.1:19025/');
assert.ok(['127.0.0.1', 'localhost'].includes(base.hostname), 'Only an isolated loopback preview is allowed');
const output = resolve(process.env.OFFICE_HOVER_QA_DIR || 'docs/office-production/qa/hover-v5-20261012');
await mkdir(output, {recursive:true});
const require = createRequire(process.env.OFFICE_QA_NODE_PACKAGE || '/Users/hepingyu/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json');
const browser = await require('playwright').chromium.launch({channel:'chrome', headless:true, args:['--disable-background-timer-throttling']});
const report = {url:base.href, surface:'V5 employee page', data:'isolated synthetic browser fixture', checks:[], screenshots:[], errors:[], badResponses:[], writes:[], legacyRequests:[]};

function fixture(allSeats = false) {
  const stamp = new Date().toISOString();
  const today = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const boundSeats = ['desk-09','desk-10','desk-11','desk-12'];
  const counts = ['1','3','5','9'];
  const profiles = [['orange-cat-v1','橘猫'],['american-shorthair-v1','美短'],['ragdoll-v1','布偶猫'],['british-shorthair-v1','英短']];
  return {schema_version:1, config_version:1, generated_at:stamp,
    source:{status:'ok',last_success_at:stamp,last_attempt_at:stamp,poll_interval_seconds:5,stale_after_seconds:15,error_code:null},
    display:{default_view:'overview',show_bubbles:true,show_labels:true,show_details:true,reduced_motion:'system'},
    stations:Array.from({length:16}, (_,i) => {
      const id = `desk-${String(i+1).padStart(2,'0')}`, bound = allSeats || boundSeats.includes(id);
      const current = bound ? counts[i % 4] : null;
      const [character_profile_id, character_label] = bound ? profiles[i % profiles.length] : [null, null];
      return {seat_id:id,bound,display_name:bound?'验收角色':'未绑定',username:bound?'验收角色':null,
        identity_quality:bound?'fresh':'unbound',identity_observed_at:bound?stamp:null,
        activity:bound?'busy':'unbound',animation_state:bound?'writing':null,quality:bound?'fresh':'unbound',
        concurrency:{current,limit:null},observed_at:bound?stamp:null,data_age_seconds:bound?0:null,
        character_profile_id,character_label,character_status:bound?'ready':null,
        today_usage:bound?{total:String(1200 + i),date:today,timezone:'Asia/Shanghai',quality:'fresh',observed_at:stamp,window_end:stamp}:{total:null,date:today,timezone:'Asia/Shanghai',quality:'unbound',observed_at:null,window_end:null}};
    })};
}
async function open(options = {}, allSeats = false, live = false) {
  const context = await browser.newContext({viewport:{width:1920,height:1080},deviceScaleFactor:2,...options});
  const page = await context.newPage();
  page.on('pageerror', e => report.errors.push(e.message));
  page.on('response', r => {if(r.status() >= 400) report.badResponses.push([r.status(),r.url()]);});
  await page.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    if(!['GET','HEAD','OPTIONS'].includes(req.method())) {report.writes.push(req.method()+' '+url.pathname); return route.abort();}
    if(['/status','/agents'].includes(url.pathname) || url.searchParams.has('scene')) report.legacyRequests.push(req.url());
    if(!live && url.pathname === '/api/office/snapshot') return route.fulfill({json:fixture(allSeats)});
    if(!live && url.pathname === '/') {
      const response = await route.fetch();
      const body = (await response.text()).replace('"mode": "employee"','"preview_fixture": true, "mode": "employee"')
        .replace('仅只读获取内网办公室快照', '本浏览器使用隔离模拟数据');
      return route.fulfill({response,body});
    }
    if(url.pathname.endsWith('/office/map-loader.mjs')) {
      const response = await route.fetch();
      const body = (await response.text()).replace('readyResolve(); onReady', 'window.__officeQA={runtime,adapter}; readyResolve(); onReady');
      return route.fulfill({response,body});
    }
    return route.continue();
  });
  await page.goto(base.href, {waitUntil:'networkidle'});
  try {await page.waitForFunction(() => window.__officeQA?.runtime?.ready);} catch(error) {console.error('SETUP BODY',await page.locator('body').innerText());await page.screenshot({path:resolve(output,'setup-failure.png')});throw error;}
  await page.evaluate(async () => {await document.fonts.ready;});
  return page;
}
async function state(page) {
  return page.evaluate(() => {
    const r = window.__officeQA.runtime, cam = r.scene.cameras.main;
    return {active:r.activeStation,view:r.view,hover:r.hoveredStation,camera:[cam.scrollX,cam.scrollY,cam.zoom],
      epochs:r.stations.map(s=>s.epoch),cursor:r.scene.sys.game.canvas.style.cursor,
      hoverCommands:r.hoverSelection.commandBuffer.length};
  });
}
async function point(page, id) {
  return page.evaluate(id => {
    const r = window.__officeQA.runtime, s = r.getStation(id), cam = r.scene.cameras.main;
    const canvas = r.scene.sys.game.canvas, box = canvas.getBoundingClientRect();
    const [bx,by,bw,bh] = s.occupied;
    const x = s.center[0]+(bx+bw/2-96)*s.scale, y = s.center[1]+(by+bh/2-96)*s.scale;
    return {x:box.left+(x-cam.worldView.x)*cam.zoom*box.width/canvas.width,
      y:box.top+(y-cam.worldView.y)*cam.zoom*box.height/canvas.height};
  },id);
}
async function photo(page, name, mapOnly = false) {
  const path = resolve(output,name+'.png');
  if(mapOnly) await page.getByTestId('office-map').screenshot({path});
  else await page.screenshot({path});
  report.screenshots.push(path);
}
async function check(name, fn) {
  try {const evidence = await fn();report.checks.push({name,pass:true,evidence});console.log('PASS',name);}
  catch(error) {report.checks.push({name,pass:false,error:error.stack});console.error('FAIL',name,error.message);}
}
let page;
try {
  page = await open();
  await check('uses the current V5 employee shell and 16 screen-only seats', async () => {
    const evidence = await page.evaluate(() => ({mode:document.documentElement.dataset.officeMode,
      scene:window.__officeQA.runtime.layout.id,
      seats:window.__officeQA.runtime.stations.length,
      modes:[...new Set(window.__officeQA.runtime.stations.map(s=>s.player.snapshot().animationMode))],
      entry:performance.getEntriesByType('resource').map(r=>r.name).filter(n=>n.endsWith('/connected-v5/runtime.mjs'))}));
    assert.equal(evidence.mode,'employee');assert.equal(evidence.scene,'company-office-connected-v5');
    assert.equal(evidence.seats,16);assert.deepEqual(evidence.modes,['full-frame-plus-screen-effects']);
    assert.equal(evidence.entry.length,1);return evidence;
  });
  await check('hover highlights the exact desk, with a pointer cursor, without changing camera or animation clocks', async () => {
    await page.getByRole('button',{name:'绿区',exact:true}).click();await page.waitForTimeout(150);
    const p = await point(page,'desk-09'), before = await state(page);
    await page.mouse.move(p.x,p.y);await page.waitForTimeout(140);
    const after = await state(page);
    await photo(page,'v5-employee-hover-green');await photo(page,'v5-employee-hover-green-detail',true);
    assert.equal(after.hover,'desk-09');assert.deepEqual(after.camera,before.camera);assert.deepEqual(after.epochs,before.epochs);
    assert.ok(after.hoverCommands>0);assert.equal(after.cursor,'pointer');return after;
  });
  await check('leaving a desk clears the hover', async () => {
    await page.mouse.move(12,12);await page.waitForTimeout(100);
    const s = await state(page);assert.equal(s.hover,null);assert.equal(s.hoverCommands,0);return s;
  });
  await check('small 3 CSS-pixel hand movement at DPR2 is still a click, not a drag', async () => {
    const p = await point(page,'desk-10'), before = await state(page);
    await page.mouse.move(p.x,p.y);await page.mouse.down();await page.mouse.move(p.x+3,p.y);await page.mouse.up();
    await page.waitForTimeout(100);const after = await state(page);
    assert.equal(after.active,'desk-10');assert.deepEqual(after.camera,before.camera);return after;
  });
  await check('dragging from a zoomed desk pans without selecting, focusing or retaining hover', async () => {
    const p = await point(page,'desk-11'), before = await state(page);
    await page.mouse.move(p.x,p.y);await page.mouse.down();await page.mouse.move(p.x-65,p.y-24,{steps:8});
    const during = await state(page);await page.mouse.up();await page.waitForTimeout(120);
    const after = await state(page);
    assert.equal(during.hover,null);assert.equal(after.active,before.active);assert.equal(after.view,before.view);
    assert.notDeepEqual(after.camera,before.camera);await photo(page,'v5-employee-after-drag');return {before,after};
  });
  await check('stationary click after panning selects but preserves the exact custom camera', async () => {
    const p = await point(page,'desk-11'), before = await state(page);
    await page.mouse.click(p.x,p.y);await page.waitForTimeout(120);
    const after = await state(page);assert.equal(after.active,'desk-11');assert.deepEqual(after.camera,before.camera);return after;
  });
  await check('explicit focus button still focuses the selected desk', async () => {
    await page.getByTestId('focus-seat').click();await page.waitForTimeout(120);
    const s = await state(page);assert.equal(s.view,'workstation');assert.equal(s.active,'desk-11');return s;
  });
  await check('fullscreen shows the map plus a read-only party HUD without operation UI and restores the page on exit', async () => {
    await page.getByRole('button',{name:'绿区',exact:true}).click();await page.waitForTimeout(150);
    await page.getByTestId('map-fullscreen').click();
    await page.waitForFunction(()=>document.fullscreenElement===document.querySelector('[data-testid="office-map"]'));
    await page.waitForTimeout(200);
    const layout = await page.evaluate(()=>{
      const fs=document.fullscreenElement, rect=fs.getBoundingClientRect(), canvas=fs.querySelector('canvas');
      const visibleAt=(x,y)=>fs.contains(document.elementFromPoint(x,y));
      const hud=fs.querySelector('[data-testid=fullscreen-hud]');
      return {target:fs.dataset.testid,children:[...fs.children].map(n=>n.dataset.testid || n.tagName),hudVisible:!!hud && getComputedStyle(hud).display !== 'none',cards:hud?.querySelectorAll('[data-seat-id]').length ?? 0,
        portraits:[...hud.querySelectorAll('.hud-card')].map(card=>({seat:card.dataset.seatId,profile:card.querySelector('.hud-portrait img')?.dataset.characterProfileId||null,src:card.querySelector('.hud-portrait img')?.getAttribute('src')||null})),
        controls:fs.querySelectorAll('button,aside,.office-header,.office-toolbar,.seat-strip,.map-caption').length,
        rect:[rect.x,rect.y,rect.width,rect.height],viewport:[innerWidth,innerHeight],
        canvas:[canvas.width,canvas.height],css:[canvas.clientWidth,canvas.clientHeight],
        corners:[[1,1],[innerWidth-2,1],[1,innerHeight-2],[innerWidth-2,innerHeight-2]].map(([x,y])=>visibleAt(x,y))};
    });
    assert.equal(layout.target,'office-map');assert.deepEqual(layout.children,['map-viewport','fullscreen-hud']);assert.equal(layout.hudVisible,true);assert.equal(layout.cards,4);assert.equal(layout.controls,0);
    assert.deepEqual(layout.portraits.map(item=>item.profile),['orange-cat-v1','american-shorthair-v1','ragdoll-v1','british-shorthair-v1']);
    assert.ok(layout.portraits.every(item=>item.src));assert.equal(new Set(layout.portraits.map(item=>item.src)).size,4);
    assert.deepEqual(layout.rect,[0,0,...layout.viewport]);assert.ok(layout.corners.every(Boolean));
    assert.ok(layout.canvas[0]>=layout.css[0]*2-2);assert.ok(layout.canvas[1]>=layout.css[1]*2-2);
    assert.equal(await page.getByTestId('hud-tokens').first().textContent(), '1,208');
    assert.equal(await page.getByTestId('hud-conversations').first().textContent(), '1');
    const p = await point(page,'desk-09'), before = await state(page);
    await page.mouse.move(p.x,p.y);await page.waitForTimeout(100);
    const after = await state(page);assert.equal(after.hover,'desk-09');assert.deepEqual(after.camera,before.camera);
    await photo(page,'v5-employee-fullscreen-hover');
    await page.mouse.down();await page.mouse.move(p.x-45,p.y-20,{steps:5});await page.mouse.up();await page.waitForTimeout(100);
    const dragged=await state(page);assert.equal(dragged.active,after.active);assert.notDeepEqual(dragged.camera,after.camera);
    await page.keyboard.press('Escape');
    await page.waitForFunction(()=>!document.fullscreenElement);await page.waitForTimeout(200);
    assert.equal(await page.getByTestId('map-fullscreen').getAttribute('aria-pressed'),'false');
    assert.equal(await page.getByTestId('focus-seat').isVisible(),true);
    assert.equal(await page.getByRole('button',{name:'绿区',exact:true}).isVisible(),true);
    await photo(page,'v5-employee-fullscreen-exited');return layout;
  });
  await check('red and green V5 regions each have 8 independently hittable desks', async () => {
    const p = await open({},true), results = [];
    try {
      for(const [label,ids] of [['红区',[1,2,3,4,5,6,7,8]],['绿区',[9,10,11,12,13,14,15,16]]]) {
        await p.getByRole('button',{name:label,exact:true}).click();await p.waitForTimeout(100);
        for(const i of ids) {
          const id = `desk-${String(i).padStart(2,'0')}`, at = await point(p,id);
          await p.mouse.move(at.x,at.y);await p.waitForTimeout(60);
          assert.equal((await state(p)).hover,id);results.push(id);
        }
      }
      return results;
    } finally {await p.context().close();}
  });
  await check('reduced motion retains a static hover outline', async () => {
    const p = await open({reducedMotion:'reduce'});
    try {
      await p.getByRole('button',{name:'绿区',exact:true}).click();await p.waitForTimeout(100);
      const at = await point(p,'desk-09');await p.mouse.move(at.x,at.y);await p.waitForTimeout(100);
      const read = () => p.evaluate(()=>({reduced:window.__officeQA.runtime.reducedMotion,
        hover:window.__officeQA.runtime.hoveredStation,commands:[...window.__officeQA.runtime.hoverSelection.commandBuffer]}));
      const before = await read();await p.waitForTimeout(320);const after = await read();
      assert.equal(after.reduced,true);assert.equal(after.hover,'desk-09');assert.ok(after.commands.length);assert.deepEqual(after.commands,before.commands);
      return {static:true};
    } finally {await p.context().close();}
  });
  await check('current V5 preview also renders the existing read-only LAN snapshot', async () => {
    const p = await open({},false,true);
    try {
      await p.getByRole('button',{name:'绿区',exact:true}).click();await p.waitForTimeout(160);
      const at = await point(p,'desk-09');await p.mouse.move(at.x,at.y);await p.waitForTimeout(120);
      const evidence = await p.evaluate(()=>({scene:window.__officeQA.runtime.layout.id,
        fixture:window.__OFFICE_BOOT__.preview_fixture===true,
        bound:window.__officeQA.runtime.stations.filter(s=>s.bound).length,
        hover:window.__officeQA.runtime.hoveredStation,
        notice:document.querySelector('[data-testid="v5-preview-banner"]').textContent}));
      assert.equal(evidence.scene,'company-office-connected-v5');assert.equal(evidence.fixture,false);
      assert.equal(evidence.hover,'desk-09');await photo(p,'v5-employee-live-hover-green');return evidence;
    } finally {await p.context().close();}
  });
  await check('phone fullscreen keeps bubbles and HUD clear of room labels; close view restores labels', async () => {
    const p = await open({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
    try {
      await p.getByTestId('map-fullscreen').click();
      await p.waitForFunction(()=>!!document.fullscreenElement);
      const overview = await p.evaluate(()=>{const r=window.__officeQA.runtime;return {
        hidden:r.roomLabels.every(label=>!label.visible)&&!r.entryLabel.visible&&!r.serverLabel.visible,
        bubbles:r.stations.filter(station=>station.bound&&station.bubbleVisible).length,
        cards:document.querySelectorAll('[data-testid="fullscreen-hud"] .hud-card').length};});
      assert.equal(overview.hidden,true);assert.ok(overview.bubbles>=3);assert.equal(overview.cards,4);
      await p.keyboard.press('Escape');
      await p.getByRole('button',{name:'绿区',exact:true}).click();
      const close = await p.evaluate(()=>{const r=window.__officeQA.runtime;return {
        view:r.view,visible:r.roomLabels.filter(label=>label.visible).length,
        size:r.roomLabels[0]._officeCssFontSize};});
      assert.equal(close.view,'east');assert.ok(close.visible>0);assert.equal(close.size,14);
      return {overview,close};
    } finally {await p.context().close();}
  });
  for(const viewport of [{width:1024,height:768},{width:390,height:844},{width:844,height:390}]) {
    await check(`V5 responsive employee shell ${viewport.width}x${viewport.height}`, async () => {
      const p = await open({viewport,hasTouch:viewport.width<900});
      try {
        await p.getByRole('button',{name:'绿区',exact:true}).click();await p.waitForTimeout(150);
        const dimensions = await p.evaluate(()=>{
          const c = document.querySelector('[data-testid="office-map"] canvas'), r = c.getBoundingClientRect();
          return {documentWidth:document.documentElement.scrollWidth, viewportWidth:innerWidth,canvas:[c.width,c.height],css:[r.width,r.height]};
        });
        assert.ok(dimensions.documentWidth<=viewport.width);assert.ok(dimensions.canvas[0]>=dimensions.css[0]*2-2);
        if(viewport.width>=900) {
          const at = await point(p,'desk-09');await p.mouse.move(at.x,at.y);await p.waitForTimeout(100);
          assert.equal((await state(p)).hover,'desk-09');
        }
        await photo(p,`v5-employee-${viewport.width}x${viewport.height}`);return dimensions;
      } finally {await p.context().close();}
    });
  }
} catch(error) {report.checks.push({name:'setup',pass:false,error:error.stack});}
finally {
  report.completedAt = new Date().toISOString();
  report.passed = report.checks.filter(c=>c.pass).length;report.failed = report.checks.filter(c=>!c.pass).length;
  if(report.errors.length || report.badResponses.length || report.writes.length || report.legacyRequests.length) report.failed++;
  await writeFile(resolve(output,'acceptance.json'),JSON.stringify(report,null,2)+'\n');
  await browser.close();console.log(JSON.stringify({passed:report.passed,failed:report.failed,errors:report.errors,badResponses:report.badResponses,writes:report.writes,legacyRequests:report.legacyRequests,report:resolve(output,'acceptance.json')},null,2));
  process.exitCode=report.failed?1:0;
}
