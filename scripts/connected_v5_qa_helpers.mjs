/** Screen-only V5 QA helpers. Read-only browser requests; all mutations page-local. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {ConnectedSeatedPlayer as V5} from '../frontend/company-office/connected-v5/seated-player.mjs';
import {ConnectedSeatedPlayer as V4} from '../frontend/company-office/connected-v4/seated-player.mjs';
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const QA_DIR = resolve(ROOT, 'assets/company-office-connected-v5/qa');
export const DIRECTIONS = ['up', 'down', 'left', 'right'];
export const STATES = ['idle', 'writing', 'researching', 'executing', 'syncing', 'error'];
export const MODE = 'full-frame-plus-screen-effects';
export function assertScreenOnly(player) {
  assert.equal('handsCanvas' in player, false, 'A hand Canvas must not exist, even if hidden');
  assert.equal('handsCtx' in player, false);
  const s = player.snapshot();
  assert.equal(s.animationMode, MODE);
  assert.equal(s.handsRendered, false);
  assert.equal(s.handsAction, 'none');
  assert.equal(s.keyboardInteraction, false);
  for (const key of ['handsBounds','handInkBounds','keyboardBounds','handsFrame','keyboardAnchored'])
    assert.equal(key in s, false, `Removed interaction metadata must not survive: ${key}`);
  if (player.benchContext) for (const key of ['keyboardBounds','keyboardSourceBounds','keyboardBoundsConvention'])
    assert.equal(key in player.benchContext, false, `Keyboard coordinates must not reach player: ${key}`);
}
export async function recordedPlayer({direction='down', reducedMotion=false, Player=V5}={}) {
  const assets = JSON.parse(readFileSync(resolve(ROOT, 'frontend/company-office/reference-v3/assets.json'), 'utf8'));
  const sizes = new Map();
  for (const s of Object.values(assets.directions)) {
    for (const path of [s.furniture.back,s.furniture.front,s.character.base]) sizes.set(new URL(path, 'https://qa.invalid/').href,[192,192]);
    for (const a of Object.values(s.character.actions)) if(a.frames) sizes.set(new URL(a.frames, 'https://qa.invalid/').href,[768,576]);
  }
  const calls = [], stack=[];
  const ctx = {imageSmoothingEnabled:false,globalCompositeOperation:'source-over',globalAlpha:1};
  for (const op of ['clearRect','drawImage','beginPath','moveTo','lineTo','closePath','ellipse','rect','clip'])
    ctx[op]=(...args)=>calls.push([op,...args.map(a=>a && typeof a==='object' ? a.id ?? a : a)]);
  ctx.save=()=>{stack.push([ctx.globalCompositeOperation,ctx.globalAlpha]);calls.push(['save']);};
  ctx.restore=()=>{assert.ok(stack.length);[ctx.globalCompositeOperation,ctx.globalAlpha]=stack.pop();calls.push(['restore']);};
  for(const op of ['fillRect','fillText','rotate','translate','scale','transform','getImageData'])
    ctx[op]=()=>assert.fail(`Actor renderer must not draw screen/hand primitives: ${op}`);
  const canvas = {getContext:()=>ctx};
  const imageLoader=async url=>{assert.ok(sizes.has(url),url);const [width,height]=sizes.get(url);return {id:url,width,height,naturalWidth:width,naturalHeight:height};};
  const player=await new Player(canvas,assets,{direction,reducedMotion,baseUrl:'https://qa.invalid/',imageLoader}).initialize();
  return {player,calls,canvas,ctx,V4,assertBalanced:()=>assert.equal(stack.length,0)};
}
export async function launchBrowser() {
  const require=createRequire(process.env.OFFICE_QA_NODE_PACKAGE || '/Users/hepingyu/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json');
  return require('playwright').chromium.launch({channel:'chrome',headless:true,args:['--disable-background-timer-throttling']});
}
export async function openV5(browser, options={}, configurePage=null) {
  const base=new URL(process.env.OFFICE_QA_URL || 'http://127.0.0.1:19000/');
  assert.ok(['127.0.0.1','localhost'].includes(base.hostname),'QA is local-preview only');
  const context=await browser.newContext({viewport:{width:1920,height:1080},deviceScaleFactor:2,...options});
  const page=await context.newPage(), errors=[], failedResponses=[], blockedWrites=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('response',response=>{if(response.status()>=400)failedResponses.push([response.status(),response.url()]);});
  await page.route('**/*',route=>{
    const request=route.request();
    if(!['GET','HEAD','OPTIONS'].includes(request.method())) {blockedWrites.push([request.method(),request.url()]);return route.abort();}
    return route.continue();
  });
  if(configurePage)await configurePage(page);
  await page.addInitScript(()=>localStorage.setItem('uiLang','zh'));
  await page.goto(new URL('?scene=connected-v5',base).href,{waitUntil:'networkidle',timeout:30000});
  await page.waitForFunction(()=>window.officeRuntime?.ready,{timeout:30000});
  await page.evaluate(async()=>{await document.fonts.ready;window.officeRuntime.setDemoMode(true);window.officeRuntime.scene.game.loop.stop();});
  await page.evaluate(installScreenOnlyQA);
  return {context,page,errors,failedResponses,blockedWrites,url:page.url()};
}
/** Serialized into Chromium. Pixel/mask logic is independent of the screen renderer. */
async function installScreenOnlyQA() {
  const {ConnectedSeatedPlayer:V4}=await import('/static/company-office/connected-v4/seated-player.mjs');
  const {ConnectedSeatedPlayer:V5}=await import('/static/company-office/connected-v5/seated-player.mjs');
  const directions=['up','down','left','right'],states=['idle','writing','researching','executing','syncing','error'];
  const times=Array.from({length:48},(_,n)=>Math.ceil((n+.01)*1000/12));
  const make=()=>{const c=document.createElement('canvas');c.width=c.height=192;c.getContext('2d',{willReadFrequently:true});return c;};
  const pixels=canvas=>canvas.getContext('2d',{willReadFrequently:true}).getImageData(0,0,192,192).data.slice();
  const equal=(a,b)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
  const hash=data=>{let h=2166136261;for(const v of data)h=Math.imul(h^v,16777619);return(h>>>0).toString(16).padStart(8,'0');};
  function diff(a,b) {let changed=0;for(let i=0;i<a.length;i+=4)if(a[i]!==b[i]||a[i+1]!==b[i+1]||a[i+2]!==b[i+2]||a[i+3]!==b[i+3])changed++;return changed;}
  function noInteraction(player) {
    const s=player.snapshot(),issues=[];
    for(const key of ['handsCanvas','handsCtx'])if(key in player)issues.push({type:'removed-hand-layer-present',key});
    if(s.animationMode!=='full-frame-plus-screen-effects'||s.handsRendered!==false||s.handsAction!=='none'||s.keyboardInteraction!==false)
      issues.push({type:'screen-only-contract',mode:s.animationMode,handsRendered:s.handsRendered,handsAction:s.handsAction,keyboardInteraction:s.keyboardInteraction});
    for(const key of ['handsBounds','handInkBounds','keyboardBounds','handsFrame','keyboardAnchored'])if(key in s)issues.push({type:'obsolete-hand-metadata',key});
    if(player.benchContext)for(const key of ['keyboardBounds','keyboardSourceBounds','keyboardBoundsConvention'])if(key in player.benchContext)issues.push({type:'keyboard-binding-survived',key});
    return issues;
  }
  function clocks(player) {const s=player.snapshot();return Object.fromEntries(['direction','state','action','frame','faceFrame','fps','frameCount','clock','faceClockFrames','clockTick','tick','sampleMs','bodyPlacement','seatAnchor','poseAnchor','faceVisible','reducedMotion'].map(k=>[k,s[k]]));}
  async function pair(station,direction,assets=window.officeRuntime.assets) {
    const r=window.officeRuntime,v4=await new V4(make(),assets,{baseUrl:r.baseUrl,direction}).initialize(),v5=await new V5(make(),assets,{baseUrl:r.baseUrl,direction}).initialize();
    const [sx,sy]=v5.spec.furniture.seatAnchor;
    const trial={...station,direction,center:[station.contact[0]-(sx-96)*station.scale,station.contact[1]-(sy-96)*station.scale]};
    r.attachPlayerToBench(trial,v5);v4.setBenchContext(v5.benchContext);return {v4,v5,trial};
  }
  function inspect(v4,v5,state,ms,lockFace=false) {
    v4.setState(state);v5.setState(state);v4.sample(ms);v5.sample(ms);
    if(lockFace){v4.faceFrame=v5.faceFrame=0;v4._drawKey=v5._drawKey=null;v4._render();v5._render();}
    const before=pixels(v4.canvas),after=pixels(v5.canvas),changedPixels=diff(before,after),issues=noInteraction(v5);
    if(changedPixels)issues.push({type:'actor-not-byte-identical-to-V4',changedPixels});
    if(JSON.stringify(clocks(v4))!==JSON.stringify(clocks(v5)))issues.push({type:'expression-clock-drift',v4:clocks(v4),v5:clocks(v5)});
    return {before,after,changedPixels,issues,snapshot:v5.snapshot()};
  }
  function expectedMask(overlay,component) {
    const c=make(),ctx=c.getContext('2d'),s=overlay.screen,[x,y,w,h]=component.bounds;
    if(component.config.visible) {
      const pts=s.polygon.map(([px,py])=>[(px-x)*192/w,(py-y)*192/h]);
      ctx.beginPath();ctx.moveTo(...pts[0]);for(const p of pts.slice(1))ctx.lineTo(...p);ctx.closePath();ctx.clip();ctx.fillRect(0,0,192,192);
    }else if(s.led){const l=s.led.length===2?[...s.led,2,2]:s.led;ctx.fillRect((l[0]-x)/w*192,(l[1]-y)/h*192,l[2]/w*192,l[3]/h*192);}
    return pixels(c);
  }
  function inspectOverlay(overlay,state,sampleTimes=times,reducedMotion=false) {
    const issues=[],hashes=[],texts=[],meanRGB=[],masks=overlay.components.map(c=>expectedMask(overlay,c));
    const old=overlay.components.map(c=>c.ctx.fillText);
    overlay.components.forEach((c,i)=>{c.ctx.fillText=function(text,...args){texts.push({component:i,text:String(text),color:this.fillStyle});return old[i].call(this,text,...args);};});
    try {
      for(const ms of sampleTimes){overlay.sample(state,ms,reducedMotion);hashes.push(overlay.components.map(c=>hash(pixels(c.canvas))));
        overlay.components.forEach((c,i)=>{const data=pixels(c.canvas);let escaped=0,ink=0,lum=0;
          for(let n=0;n<192*192;n++)if(data[n*4+3]){ink++;lum+=(data[n*4]+data[n*4+1]+data[n*4+2])/3;if(!masks[i][n*4+3])escaped++;}
          if(escaped)issues.push({type:'screen-outside-source-polygon-or-LED',state,ms,component:i,escaped});
          if(!ink)issues.push({type:'empty-screen-or-LED',state,ms,component:i});
          if(c.config.visible)meanRGB.push(lum/ink);
        });
      }
    }finally{overlay.components.forEach((c,i)=>{c.ctx.fillText=old[i];});}
    const uniqueFrames=new Set(hashes.map(h=>h.join(':'))).size;
    const textStrings=[...new Set(texts.map(t=>t.text))],textColors=[...new Set(texts.map(t=>t.color))];
    const rear=overlay.screen.kind==='back',thin=overlay.thin;
    if((rear||thin)&&texts.length)issues.push({type:'rear-or-thin-screen-rendered-glyphs',rear,thin});
    if(rear&&(overlay.components.length!==1||overlay.components.some(c=>c.config.visible)))issues.push({type:'rear-not-LED-only'});
    if(state==='idle'||reducedMotion){if(uniqueFrames!==1)issues.push({type:'static-state-or-reduced-motion-changing',uniqueFrames});}
    else if(uniqueFrames<2)issues.push({type:'screen-animation-static',state});
    if(!rear&&!thin&&['writing','researching','executing'].includes(state)) {
      if(!textStrings.some(t=>/^\d+$/.test(t)))issues.push({type:'missing-real-raster-line-numbers'});
      if(textColors.length<3)issues.push({type:'missing-real-raster-syntax-colors'});
      if(!textStrings.includes(state==='researching'?'search: src/*.ts':'src/index.ts'))issues.push({type:'missing-real-editor-or-search-header'});
      if(state==='researching'&&!textStrings.some(t=>t.startsWith('> run')))issues.push({type:'missing-search-query'});
      if(state==='executing'&&!textStrings.some(t=>/\$|test|build|passed|ready|done/i.test(t)))issues.push({type:'missing-terminal-output'});
      if(!reducedMotion&&textStrings.length<10)issues.push({type:'code-screen-insufficient-raster-content'});
    }
    return {state,rear,thin,samples:sampleTimes.length,uniqueFrames,textStrings,textColors,maximumMean:meanRGB.length?Math.max(...meanRGB):null,issues};
  }
  window.__screenOnlyV5QA={directions,states,times,make,pixels,equal,hash,diff,noInteraction,clocks,pair,inspect,expectedMask,inspectOverlay};
}
export function expectClean(result) {
  const issues=result.violations??result.issues??[];
  if(issues.length){const error=new Error(`${issues.length} violation(s): ${JSON.stringify(issues.slice(0,6))}`);error.evidence=result;throw error;}
  return result;
}
