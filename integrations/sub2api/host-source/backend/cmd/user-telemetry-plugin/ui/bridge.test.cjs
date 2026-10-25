// Isolated bridge tests with a fake host. No admin API, real identities or data.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(`${__dirname}/index.html`,'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const flush = () => new Promise(resolve => setImmediate(resolve));
function setup(options = {}) {
 const elements = new Map();
 for (const id of ['user-ids','timezone','page-size','save','test','load','feedback','config-form']) elements.set(id,{value:id==='timezone'?'Asia/Shanghai':'',textContent:'',dataset:{},disabled:true,handlers:new Map(),addEventListener(type,handler){this.handlers.set(type,handler);}});
 const sent=[],handlers=new Map(),timers=new Map();let timerID=0,uuid=0;
 const parent = {postMessage(message,target){sent.push({message,target});}};
 const window = {parent,location:{href:'https://host.example/api/v1/plugin-ui/asset/index.html#bridge_token=fake-bridge',hash:options.noToken?'':'#bridge_token=fake-bridge'},addEventListener(type,handler){handlers.set(type,handler);},removeEventListener(type){handlers.delete(type);}};
 const context = {window,document:{referrer:options.referrer??'https://host.example/admin/plugins',getElementById:id=>elements.get(id),documentElement:{scrollHeight:620}},URL,URLSearchParams,crypto:{randomUUID:()=>`fake-${++uuid}`},Intl,BigInt,setTimeout(callback){const id=++timerID;timers.set(id,callback);return id;},clearTimeout(id){timers.delete(id);}};
 vm.runInNewContext(script,context);
 const requests = type => sent.filter(s=>s.message.type===type).map(s=>s.message);
 function reply(req,payload={},override={}) { const event={source:parent,origin:'https://host.example',data:{source:'sub2api-plugin-host',bridge_token:'fake-bridge',request_id:req.request_id,type:`${req.type}.result`,ok:true,...payload}};Object.assign(event,override);handlers.get('message')?.(event); }
 async function click(id){elements.get(id).handlers.get('click')?.();await flush();}
 async function submit(){elements.get('save').handlers.get('click')?.();await flush();}
 return {elements,sent,handlers,timers,requests,reply,click,submit,parent};
}
const config={allowed_user_ids:['42'],timezone:'Asia/Shanghai',page_size:100};
test('exact-origin bridge, load and save normalized configuration',async()=>{
 const s=setup();assert.equal(s.requests('sub2api.plugin.ready').length,1);assert.ok(s.sent.every(item=>item.target==='https://host.example'));
 s.reply(s.requests('config.load')[0],{config});await flush();assert.equal(s.elements.get('user-ids').value,'42');assert.equal(s.elements.get('save').disabled,false);
 s.elements.get('user-ids').value='42\n43';await s.submit();const save=s.requests('config.save')[0];assert.deepEqual(JSON.parse(JSON.stringify(save.config)),{allowed_user_ids:['42','43'],timezone:'Asia/Shanghai',page_size:100});s.reply(save,{config:{...config,allowed_user_ids:['42','43']}});await flush();assert.equal(s.elements.get('feedback').textContent,'配置已保存。');assert.equal(s.requests('ui.notify').length,1);
});
test('forged origins, source, token, IDs and response types cannot consume pending request',async()=>{
 const s=setup(),req=s.requests('config.load')[0];
 for (const override of [{origin:'https://evil.example'},{origin:'null'},{source:{}},{data:{source:'sub2api-plugin-host',bridge_token:'wrong',request_id:req.request_id,type:'config.load.result',ok:true,config}},{data:{source:'sub2api-plugin-host',bridge_token:'fake-bridge',request_id:'unknown',type:'config.load.result',ok:true,config}},{data:{source:'sub2api-plugin-host',bridge_token:'fake-bridge',request_id:req.request_id,type:'config.save.result',ok:true,config}}]) {s.reply(req,{config},override);await flush();assert.equal(s.elements.get('user-ids').value,'');assert.equal(s.timers.size,1);}
 s.reply(req,{config});await flush();assert.equal(s.elements.get('user-ids').value,'42');assert.equal(s.timers.size,0);
});
test('test saves first and sends no inline config to config.test',async()=>{
 const s=setup();s.reply(s.requests('config.load')[0],{config});await flush();await s.click('test');assert.equal(s.requests('config.test').length,0);
 s.reply(s.requests('config.save')[0],{config});await flush();const req=s.requests('config.test')[0];assert.ok(req);assert.equal(req.config,undefined);s.reply(req,{result:{success:true}});await flush();assert.match(s.elements.get('feedback').textContent,/测试通过/);
});
test('default empty scope, ID precision, duplicate IDs and invalid page do not save',async()=>{
 const s=setup();s.reply(s.requests('config.load')[0],{config:{}});await flush();
 for (const id of ['', '01', '+42','42\n42','9223372036854775808','x@example.test']) {s.elements.get('user-ids').value=id;await s.submit();assert.equal(s.requests('config.save').length,0);}
 s.elements.get('user-ids').value='9223372036854775807';s.elements.get('page-size').value='501';await s.submit();assert.equal(s.requests('config.save').length,0);s.elements.get('page-size').value='';await s.submit();assert.equal(s.requests('config.save')[0].config.allowed_user_ids[0],'9223372036854775807');
});
test('save failure, ambiguous timeout and test failure have distinct feedback',async()=>{
 const s=setup();s.reply(s.requests('config.load')[0],{config});await flush();await s.submit();const req=s.requests('config.save')[0];s.reply(req,{ok:false,error:'SECRET_HOST_DATA'});await flush();assert.match(s.elements.get('feedback').textContent,/未确认保存成功/);assert.doesNotMatch(s.elements.get('feedback').textContent,/SECRET/);
 await s.click('test');s.reply(s.requests('config.save')[1],{config});await flush();const tested=s.requests('config.test')[0];s.reply(tested,{ok:false,result:{success:false,message:'SECRET'}});await flush();assert.match(s.elements.get('feedback').textContent,/配置已保存，但测试未通过/);
 await s.click('load');for(const callback of [...s.timers.values()])callback();await flush();assert.match(s.elements.get('feedback').textContent,/超时/);
});
test('unknown config fields are rejected without displaying secret values',async()=>{
 const s=setup();s.reply(s.requests('config.load')[0],{config:{...config,admin_token:'SECRET'}});await flush();assert.equal(s.elements.get('user-ids').value,'');assert.match(s.elements.get('feedback').textContent,/加载失败/);assert.doesNotMatch(s.elements.get('feedback').textContent,/SECRET/);
});
test('missing token and cross-origin parent referrer fail closed; unload cleans requests',async()=>{
 assert.equal(setup({noToken:true}).sent.length,0);assert.equal(setup({referrer:'https://evil.example/'}).sent.length,0);
 const s=setup();assert.equal(s.timers.size,1);s.handlers.get('pagehide')();await flush();assert.equal(s.timers.size,0);assert.equal(s.handlers.has('message'),false);assert.equal(s.elements.get('save').disabled,true);
});
test('UI uses no external resources, host credentials or broad-origin messaging',()=>{
 assert.doesNotMatch(html,/<(?:script|link|img)[^>]+(?:src|href)=["']https?:/i);assert.doesNotMatch(script,/fetch\(|XMLHttpRequest|document\.cookie|localStorage|sessionStorage|parent\.document|postMessage\([^;]*["']\*["']/);assert.ok(html.includes('aria-live="polite"'));
});
