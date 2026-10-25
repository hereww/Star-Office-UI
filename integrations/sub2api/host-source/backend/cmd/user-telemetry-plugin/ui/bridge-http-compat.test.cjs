// Independent local HTTP bridge regression: synthetic messages only, no service access.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {randomFillSync} = require('node:crypto');
const html = fs.readFileSync(`${__dirname}/index.html`, 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const origin = 'http://192.0.2.10:8080'; // RFC documentation-only address, never contacted.
const marker = 'TEST_ONLY_BRIDGE_MARKER';
const config = {allowed_user_ids:['42'], timezone:'UTC', page_size:2};
const flush = () => new Promise(resolve => setImmediate(resolve));

function setup(options = {}) {
 const elements = new Map();
 for (const id of ['user-ids','timezone','page-size','save','test','load','feedback','config-form']) {
  elements.set(id, {value:id==='timezone'?'Asia/Shanghai':'', textContent:'', dataset:{}, disabled:true, handlers:new Map(), addEventListener(type,handler){this.handlers.set(type,handler);}});
 }
 const sent=[], handlers=new Map(), timers=new Map(); let timerID=0, draws=0;
 const parent = {postMessage(message,target){sent.push({message,target});}};
 const window = {parent, isSecureContext:false, location:{href:`${origin}/api/v1/plugin-ui/fixture/index.html#bridge_token=${marker}`, hash:`#bridge_token=${marker}`}, addEventListener(type,handler){handlers.set(type,handler);}, removeEventListener(type){handlers.delete(type);}};
 const fallbackCrypto = {getRandomValues(bytes){draws++; return randomFillSync(bytes);}};
 const safeMath = Object.create(Math);
 safeMath.random = () => {throw new Error('Math.random must not be used');};
 const context = {window, document:{referrer:options.referrer??`${origin}/admin/plugins`, getElementById:id=>elements.get(id), documentElement:{scrollHeight:620}}, URL, URLSearchParams, Intl, BigInt, Math:safeMath, crypto:options.noCrypto?undefined:(options.crypto??fallbackCrypto), console:{log(){throw new Error('No UI logging allowed');},error(){throw new Error('No UI logging allowed');},warn(){throw new Error('No UI logging allowed');}}, setTimeout(callback){const id=++timerID;timers.set(id,callback);return id;}, clearTimeout(id){timers.delete(id);}};
 vm.runInNewContext(script, context);
 const requests = type => sent.filter(item=>item.message.type===type).map(item=>item.message);
 function reply(req,payload={},override={}) {
  const event = {source:parent, origin, data:{source:'sub2api-plugin-host', bridge_token:marker, request_id:req.request_id, type:`${req.type}.result`, ok:true, ...payload}};
  Object.assign(event,override); handlers.get('message')?.(event);
 }
 async function click(id){elements.get(id).handlers.get('click')?.();await flush();}
 return {elements,sent,handlers,timers,requests,reply,click,parent,draws:()=>draws};
}

function assertNoDOMMarker(s) {
 for (const element of s.elements.values()) {
  assert.ok(!JSON.stringify({value:element.value,textContent:element.textContent,dataset:element.dataset}).includes(marker));
 }
}
async function rejectForgeries(s,req,payload) {
 const valid={source:'sub2api-plugin-host',bridge_token:marker,request_id:req.request_id,type:`${req.type}.result`,ok:true,...payload};
 const originals={ids:s.elements.get('user-ids').value, feedback:s.elements.get('feedback').textContent};
 for (const override of [
  {origin:'http://192.0.2.11:8080'}, {origin:'https://192.0.2.10:8080'}, {origin:'null'}, {source:{}},
  {data:{...valid,source:'other-source'}}, {data:{...valid,bridge_token:'UNRELATED_TEST_MARKER'}},
  {data:{...valid,request_id:'unrequested-id'}}, {data:{...valid,type:'unexpected.result'}},
  {data:{...valid,ok:'true'}},
 ]) {
  s.reply(req,payload,override);await flush();assert.equal(s.timers.size,1);
  assert.equal(s.elements.get('user-ids').value,originals.ids);assert.equal(s.elements.get('feedback').textContent,originals.feedback);
 }
}

test('HTTP without randomUUID securely bridges load, save and saved-config test',async()=>{
 const s=setup();assert.equal(s.draws(),1);const load=s.requests('config.load')[0];assert.match(load.request_id,/^[0-9a-f]{32}-1$/);
 s.reply(load,{config});await flush();assert.equal(s.elements.get('user-ids').value,'42');assert.equal(s.elements.get('save').disabled,false);
 s.elements.get('user-ids').value='42\n43';await s.click('save');const save=s.requests('config.save')[0];assert.match(save.request_id,/^[0-9a-f]{32}-2$/);
 const saved={...config,allowed_user_ids:['42','43']};assert.deepEqual(JSON.parse(JSON.stringify(save.config)),saved);s.reply(save,{config:saved});await flush();assert.match(s.elements.get('feedback').textContent,/配置已保存/);
 await s.click('test');const beforeTest=s.requests('config.save')[1];s.reply(beforeTest,{config:saved});await flush();const probe=s.requests('config.test')[0];assert.ok(probe);assert.equal(probe.config,undefined);
 s.reply(probe,{result:{success:true}});await flush();assert.match(s.elements.get('feedback').textContent,/测试通过/);assert.equal(s.draws(),4);
 assert.equal(new Set([load,save,beforeTest,probe].map(req=>req.request_id)).size,4);assert.equal(s.timers.size,0);assert.ok(s.sent.every(item=>item.target===origin));assertNoDOMMarker(s);
});

test('HTTP fallback preserves origin, parent source, marker, request ID and result-type checks for every operation',async()=>{
 const s=setup();const load=s.requests('config.load')[0];await rejectForgeries(s,load,{config});s.reply(load,{config});await flush();
 await s.click('save');const save=s.requests('config.save')[0];await rejectForgeries(s,save,{config});s.reply(save,{config});await flush();
 await s.click('test');const beforeTest=s.requests('config.save')[1];await rejectForgeries(s,beforeTest,{config});s.reply(beforeTest,{config});await flush();
 const probe=s.requests('config.test')[0];await rejectForgeries(s,probe,{result:{success:true}});s.reply(probe,{result:{success:true}});await flush();assert.match(s.elements.get('feedback').textContent,/测试通过/);assert.equal(s.timers.size,0);assertNoDOMMarker(s);
});

test('randomUUID remains preferred and a throwing UUID falls back to getRandomValues',async()=>{
 const preferred=setup({crypto:{randomUUID(){return 'preferred-uuid';},getRandomValues(){throw new Error('fallback must not run');}}});
 assert.equal(preferred.requests('config.load')[0].request_id,'preferred-uuid-1');preferred.reply(preferred.requests('config.load')[0],{config});await flush();assert.equal(preferred.elements.get('save').disabled,false);
 let draws=0;const fallback=setup({crypto:{randomUUID(){throw new Error('unavailable');},getRandomValues(bytes){draws++;return randomFillSync(bytes);}}});
 assert.equal(draws,1);assert.match(fallback.requests('config.load')[0].request_id,/^[0-9a-f]{32}-1$/);fallback.reply(fallback.requests('config.load')[0],{config});await flush();assert.equal(fallback.elements.get('save').disabled,false);
});

test('monotonic sequence prevents request ID reuse even for repeated random bytes',async()=>{
 const s=setup({crypto:{getRandomValues(bytes){bytes.fill(0x7c);return bytes;}}});const first=s.requests('config.load')[0];s.reply(first,{config});await flush();await s.click('load');const second=s.requests('config.load')[1];
 assert.equal(first.request_id,'7c'.repeat(16)+'-1');assert.equal(second.request_id,'7c'.repeat(16)+'-2');s.reply(first,{config:{...config,allowed_user_ids:['43']}});await flush();assert.equal(s.timers.size,1);s.reply(second,{config});await flush();assert.equal(s.timers.size,0);
});

test('missing crypto or unavailable/throwing secure randomness fails closed without config requests',async()=>{
 for (const options of [{noCrypto:true},{crypto:{}},{crypto:{getRandomValues(){throw new Error('fixture entropy unavailable');}}}]) {
  const s=setup(options);await flush();assert.equal(s.requests('config.load').length,0);assert.equal(s.requests('config.save').length,0);assert.equal(s.requests('config.test').length,0);assert.equal(s.timers.size,0);assert.equal(s.handlers.has('message'),false);
  for (const id of ['save','test','load']) assert.equal(s.elements.get(id).disabled,true);
  assert.match(s.elements.get('feedback').textContent,/缺少安全随机数能力/);assertNoDOMMarker(s);
  await s.click('save');await s.click('test');await s.click('load');assert.equal(s.requests('config.save').length,0);assert.equal(s.requests('config.test').length,0);assert.equal(s.requests('config.load').length,0);
 }
});

test('HTTP cross-origin referrer fails closed and UI release version is 0.1.1',()=>{
 const s=setup({referrer:'http://192.0.2.11:8080/admin/plugins'});assert.equal(s.sent.length,0);assert.equal(s.elements.get('save').disabled,true);
 assert.match(html,/READ-ONLY TELEMETRY \/ 0\.1\.1/);assert.doesNotMatch(script,/Math\.random\s*\(/);assert.doesNotMatch(script,/console\.(log|warn|error)\s*\(/);
});
