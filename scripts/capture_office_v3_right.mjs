#!/usr/bin/env node
/** Capture the actual runtime compositor, not a re-painted sprite contact sheet. */
import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const out=resolve(root,'assets/company-office-reference-v3/repair-v4-qa');
const require=createRequire(process.env.OFFICE_QA_NODE_PACKAGE||'/Users/hepingyu/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json');
const {chromium}=require('playwright');
const base=process.env.OFFICE_QA_URL||'http://127.0.0.1:19000/';
assert.ok(['localhost','127.0.0.1'].includes(new URL(base).hostname));
await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const context=await browser.newContext({viewport:{width:3840,height:2160},deviceScaleFactor:1});
 const p=await context.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.route('**/__qa/right-v4',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>右向角色对位验收</title><style>*{box-sizing:border-box}body{margin:0;padding:48px;background:#e7dec9;color:#243e38;font-family:"PingFang SC","Microsoft YaHei",system-ui,sans-serif}h1{margin:0 0 16px;font-size:48px}header p{font-size:28px;margin:0 0 42px}section{display:grid;grid-template-columns:180px repeat(12,minmax(0,1fr));gap:12px;margin-bottom:32px;align-items:center}aside{font-size:30px;font-weight:600}aside small{display:block;font-size:20px;font-weight:400;line-height:1.6;margin-top:16px}article{background:#f8f2e4;border:1px solid #bcb39b;padding:8px;text-align:center}canvas{display:block;width:100%;height:auto;image-rendering:pixelated}article span{display:block;font-size:20px;margin-top:6px;color:#57675d}footer{font-size:26px;line-height:1.8;border-top:2px solid #bcb39b;margin-top:44px;padding-top:30px}</style><header><h1>右向坐姿 · 四套表情逐帧对位</h1><p>浏览器实际 192 × 192 合成结果｜4K 原尺寸截屏｜固定身体、头部轮廓和家具，只动局部五官</p></header><main></main><footer>原方案不变：12 帧 / 12 fps · 工作/同步每 5 秒，休息每 3 秒，出错连续循环<br>每行由左至右为帧 01–12。技术核查素材，非实际人员状态；仍待用户确认新右向外观。</footer></html>`}));
 await p.goto(new URL('/__qa/right-v4',base).href);
 const report=await p.evaluate(async()=>{
  const root='/static/company-office/reference-v3/';
  const assets=await (await fetch(root+'assets.json',{cache:'no-store'})).json();
  const {DirectionalSeatedPlayer}=await import(root+'directional-player.mjs');
  const rows=[];
  for(const [state,label,clock]of [['writing','工作',60],['idle','休息',36],['syncing','同步',60],['error','出错',12]]){
   const section=document.createElement('section'),aside=document.createElement('aside');section.id='row-'+state;aside.textContent=label;const small=document.createElement('small');small.textContent=state==='writing'?'写作 / 调研 / 执行共用':'12 帧 · '+(clock/12)+' 秒时钟';aside.append(small);section.append(aside);document.querySelector('main').append(section);
   const signatures=[];
   for(let frame=0;frame<12;frame++){
    const article=document.createElement('article'),canvas=document.createElement('canvas'),caption=document.createElement('span');article.append(canvas,caption);section.append(article);
    const player=new DirectionalSeatedPlayer(canvas,assets,{direction:'right',baseUrl:new URL(root,location.href).href});await player.initialize();player.setState(state);player.setFrame(frame);caption.textContent='帧 '+String(frame+1).padStart(2,'0');signatures.push(canvas.toDataURL());
   }
   rows.push({state,clock,uniqueFrames:new Set(signatures).size});
  }
  await document.fonts.ready;return {right:assets.directions.right.character,rows};
 });
 assert.deepEqual(errors,[]);assert.ok(report.right.base.includes('/repair-v4-aligned/'));assert.ok(report.rows.every(x=>x.uniqueFrames===12),'Every action must have twelve genuinely distinct actual composites');
 await p.screenshot({path:resolve(out,'right-four-actions-12frames-4k.png'),scale:'device'});
 // An additional real-pixel detail screenshot makes face and keyboard alignment
 // inspectable without downscaling the full 3840px image in review tools.
 await p.screenshot({path:resolve(out,'right-four-actions-first-four-detail.png'),clip:{x:225,y:174,width:1215,height:1450},scale:'device'});
 await writeFile(resolve(out,'right-browser-composite-qa.json'),JSON.stringify({capturedAt:new Date().toISOString(),viewport:[3840,2160],source:'Actual DirectionalSeatedPlayer Canvas2D; no bitmap editing or re-sampling after screenshot',errors,...report},null,2)+'\n');
 console.log(JSON.stringify({report:resolve(out,'right-browser-composite-qa.json'),rows:report.rows}));
}finally{await browser.close();}
