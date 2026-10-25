const fs=require('fs'),path=require('path');
const {chromium}=require('/Users/hepingyu/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const R='/Users/hepingyu/Documents/ChatGPT/Star-Office-UI';const O=R+'/assets/company-office-reference-v3/character-right/repair-v4-aligned';
(async()=>{
 const m=JSON.parse(fs.readFileSync(O+'/manifest.json'));const furniture=JSON.parse(fs.readFileSync(R+'/frontend/company-office/reference-v3/media/furniture/manifest.json')).directions.right.furniture;
 const browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:1100,height:950}});
 await page.goto('http://127.0.0.1:19000/');
 const result=await page.evaluate(async({m,furniture})=>{
  const {DirectionalSeatedPlayer}=await import('/static/company-office/reference-v3/directional-player.mjs');
  document.body.replaceChildren();document.body.style.cssText='background:#1f282c;margin:12px;color:white';
  const qa=document.createElement('div');qa.style.cssText='display:grid;grid-template-columns:repeat(4,192px);gap:8px';document.body.append(qa);
  const assets={...m,directions:{right:{character:m.character,furniture}}};delete assets.character;const report=[];
  for(const state of ['writing','idle','syncing','error']){
   const block=document.createElement('section');block.style.cssText='grid-column:span 4';const label=document.createElement('h2');label.textContent=state;block.append(label);qa.append(block);
   const grid=document.createElement('div');grid.style.cssText='display:grid;grid-template-columns:repeat(4,192px)';block.append(grid);
   const canv=document.createElement('canvas');const player=await new DirectionalSeatedPlayer(canv,assets,{direction:'right',baseUrl:location.origin+'/static/company-office/reference-v3/'}).initialize();player.setState(state);
   for(let i=0;i<12;i++){
    player.setFrame(i);const copy=document.createElement('canvas');copy.width=192;copy.height=192;copy.getContext('2d').drawImage(canv,0,0);grid.append(copy);
    report.push({state,frame:i,data:copy.toDataURL('image/png'),snapshot:player.snapshot()});
   }
  }
  return report;
 },{m,furniture});
 fs.mkdirSync(O+'/qa/workstation-frames',{recursive:true});
 for(const item of result)fs.writeFileSync(O+`/qa/workstation-frames/${item.state}-${String(item.frame).padStart(2,'0')}.png`,Buffer.from(item.data.split(',')[1],'base64'));
 fs.writeFileSync(O+'/qa/browser-render-report.json',JSON.stringify(result.map(({data,...r})=>r),null,2));
 await page.screenshot({path:O+'/qa/real-renderer-all-48.png',fullPage:true});await browser.close();console.log('48 actual DirectionalSeatedPlayer frames saved');
})().catch(e=>{console.error(e);process.exit(1)});
