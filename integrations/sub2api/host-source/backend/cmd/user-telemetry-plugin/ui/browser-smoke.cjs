// Offline browser QA using a FAKE host and intercepted assets; no HTTP listener,
// admin API or real credentials. The main agent owns native UI-session acceptance.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {chromium} = require('playwright');
const pluginHTML = fs.readFileSync(path.join(__dirname,'index.html'),'utf8');
const hostHTML = `<!doctype html><meta charset="utf-8"><title>Fake telemetry host</title><style>html,body{margin:0}iframe{display:block;width:100%;border:0}</style><iframe id="plugin" sandbox="allow-scripts" src="/api/v1/plugin-ui/fake/index.html#bridge_token=fake-bridge"></iframe><script>
window.fakeConfig={allowed_user_ids:['42'],timezone:'Asia/Shanghai',page_size:100};window.fakeCalls=[];
window.addEventListener('message',event=>{
 const frame=document.getElementById('plugin');const data=event.data;
 if(event.source!==frame.contentWindow||event.origin!=='null'||!data||data.source!=='sub2api-plugin-ui'||data.bridge_token!=='fake-bridge')return;
 window.fakeCalls.push(data.type);
 if(data.type==='ui.resize'){frame.style.height=data.height+'px';return;}
 let payload;
 if(data.type==='config.load')payload={config:window.fakeConfig};
 if(data.type==='config.save'){window.fakeConfig=data.config;payload={config:window.fakeConfig};}
 if(data.type==='config.test')payload={result:{success:true}};
 if(payload)frame.contentWindow.postMessage({source:'sub2api-plugin-host',bridge_token:'fake-bridge',request_id:data.request_id,type:data.type+'.result',ok:true,...payload},'*');
});</script>`;
(async()=>{
 const executablePath = process.env.TELEMETRY_UI_BROWSER || (fs.existsSync("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome") ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : undefined);
 const browser = await chromium.launch({headless:true, ...(executablePath ? {executablePath} : {})});
 try {
  const failures=[];
  for(const viewport of [{width:900,height:900},{width:390,height:844}]){
   const page=await browser.newPage({viewport});page.on('pageerror',error=>failures.push(error.message));
   await page.route('https://telemetry-test.invalid/**',route=>route.fulfill({contentType:'text/html',body:route.request().url().includes('/api/v1/plugin-ui/')?pluginHTML:hostHTML}));
   await page.goto('https://telemetry-test.invalid/admin/plugins');const frame=page.frameLocator('#plugin');
   await frame.locator('#feedback').filter({hasText:'已加载配置。'}).waitFor();
   await frame.locator('#user-ids').fill('42\n43');await frame.locator('#timezone').fill('UTC');await frame.locator('#page-size').fill('25');
   await frame.getByRole('button',{name:'保存配置',exact:true}).click();await frame.locator('#feedback').filter({hasText:'配置已保存。'}).waitFor({timeout:5000}).catch(async error=>{console.error("FAKE QA DEBUG",await frame.locator("#feedback").textContent(),await page.evaluate(()=>({config:window.fakeConfig,calls:window.fakeCalls})));throw error;});
   assert.deepEqual(await page.evaluate(()=>window.fakeConfig),{allowed_user_ids:['42','43'],timezone:'UTC',page_size:25});
   await frame.getByRole('button',{name:'保存并测试'}).click();await frame.locator('#feedback').filter({hasText:'测试通过'}).waitFor();
   const calls=await page.evaluate(()=>window.fakeCalls);assert.ok(calls.indexOf('config.test')>calls.indexOf('config.save'));
   await frame.locator('#user-ids').fill('01');await frame.getByRole('button',{name:'保存配置',exact:true}).click();await frame.locator('#feedback').filter({hasText:'不重复的正整数'}).waitFor();
   await frame.locator('#user-ids').fill('42\n43');await frame.getByRole('button',{name:'重新加载'}).click();await frame.locator('#feedback').filter({hasText:'已加载配置。'}).waitFor();
   const bounds=await frame.locator('body').evaluate(body=>({scroll:body.scrollWidth,width:body.clientWidth}));assert.ok(bounds.scroll<=bounds.width,`horizontal overflow: ${JSON.stringify(bounds)}`);
   if(process.env.TELEMETRY_UI_QA_OUT){fs.mkdirSync(process.env.TELEMETRY_UI_QA_OUT,{recursive:true});await page.screenshot({path:path.join(process.env.TELEMETRY_UI_QA_OUT,`fake-host-${viewport.width}.png`),fullPage:true});}
   console.log(`PASS fake sandbox browser ${viewport.width}x${viewport.height}: load/save/test, raw config object, ID validation, no overflow`);await page.close();
  }
  assert.deepEqual(failures,[]);
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
