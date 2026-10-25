// Browser QA against a real installed .s2plugin asset and native config handlers.
// The parent/login is an isolated Go acceptance shim; no production credentials.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
(async()=>{
 const [url,outDir]=process.argv.slice(2);if(!url||!outDir)throw new Error('acceptance URL and output directory required');
 fs.mkdirSync(outDir,{recursive:true});
 const browser=await chromium.launch({headless:true,executablePath:process.env.TELEMETRY_UI_BROWSER||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 const results=[];
 try{
  for(const viewport of [{width:900,height:900},{width:390,height:844}]){
   const page=await browser.newPage({viewport}),errors=[],external=[];
   page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(!r.url().startsWith(new URL(url).origin))external.push(new URL(r.url()).origin);});
   await page.goto(url);const frame=page.frameLocator('#plugin');
   await frame.locator('#feedback').filter({hasText:'已加载配置。'}).waitFor();
   assert.ok((await frame.locator('#user-ids').inputValue()).includes('9007199254740993'));
   await frame.locator('#page-size').fill('25');await frame.getByRole('button',{name:'保存配置',exact:true}).click();
   await frame.locator('#feedback').filter({hasText:'配置已保存。'}).waitFor();
   await frame.getByRole('button',{name:'保存并测试'}).click();await frame.locator('#feedback').filter({hasText:'测试通过'}).waitFor();
   await frame.getByRole('button',{name:'重新加载'}).click();await frame.locator('#feedback').filter({hasText:'已加载配置。'}).waitFor();
   assert.equal(await frame.locator('#page-size').inputValue(),'25');
   const calls=await page.evaluate(()=>window.acceptanceCalls);assert.ok(calls.indexOf('config.test')>calls.indexOf('config.save'));
   const body=await frame.locator('body').evaluate(b=>({width:b.clientWidth,scroll:b.scrollWidth}));assert.ok(body.scroll<=body.width);
   assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
   await page.screenshot({path:path.join(outDir,`native-sandbox-${viewport.width}.png`),fullPage:true});
   results.push({viewport,passed:true,checks:['native UI load','native config save/readback','real runtime config test','sandbox allow-scripts','no horizontal overflow','no external requests','no page errors']});
   await page.close();console.log(`PASS native sandbox ${viewport.width}x${viewport.height}: persisted config + actual runtime test`);
  }
 }finally{await browser.close();}
 fs.writeFileSync(path.join(outDir,'native-browser-qa.json'),JSON.stringify({passed:results.length===2,parent:'disposable login bridge; native UI/resource/config/runtime real',results},null,2)+'\n');
})().catch(e=>{console.error(e);process.exitCode=1});
