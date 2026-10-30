#!/usr/bin/env node
/** Deterministic runtime/contract regressions; optional real Phaser pixels in Chromium.
 * node --test scripts/test_office_telemetry_adapter.mjs
 * OFFICE_TELEMETRY_BROWSER=1 node --test scripts/test_office_telemetry_adapter.mjs
 * Browser fixture uses its own loopback static server; no backend/API writes or QA files.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {ConnectedOfficeRuntime,attachBenchContacts,BUSINESS_STATES} from '../frontend/company-office/connected-v4/runtime.mjs';
import {ConnectedSeatedPlayer} from '../frontend/company-office/connected-v4/seated-player.mjs';
import {CHAIR_CLIPS,normalizeBenchManifest,validateBenchManifest,benchTransform} from '../frontend/company-office/connected-v4/furniture-contract.mjs';
import {OfficeRenderQuality} from '../frontend/company-office/reference-v3/render-quality.mjs';
import {OfficeRuntimeAdapter,normalizeTelemetrySnapshot,speechBubbleLines,sampleSpeechBubbleMotion,SPEECH_BUBBLE_STYLE,layoutSpeechBubbles} from '../frontend/company-office/connected-v4/telemetry-adapter.mjs';
const root=new URL('../',import.meta.url);
const read=path=>JSON.parse(readFileSync(new URL(path,root),'utf8'));
const layout=read('frontend/company-office/connected-v4/layout.json');
const assets=read('frontend/company-office/reference-v3/assets.json');
const records=layout.benches.map(spec=>{
  const manifest=validateBenchManifest(normalizeBenchManifest(read(`frontend/company-office/connected-v4/${spec.manifest}`),spec),spec);
  return {spec,manifest,transform:benchTransform(manifest,spec.fit),image:{}};
});
const attached=attachBenchContacts(layout,assets,records);
const seatIds=attached.stations.map(s=>s.id);
const wall=Date.parse('2026-10-04T08:00:00Z');
function payload(changes={},source={}){
  return {schema_version:1,config_version:1,generated_at:new Date(wall).toISOString(),
    source:{status:'ok',last_success_at:new Date(wall).toISOString(),last_attempt_at:new Date(wall).toISOString(),poll_interval_seconds:5,stale_after_seconds:15,...source},
    stations:seatIds.map(id=>({seat_id:id,display_name:id==='desk-12'?'主工位':'未绑定',bound:id==='desk-12',activity:id==='desk-12'?'idle':'unbound',animation_state:id==='desk-12'?'idle':null,
      concurrency:{current:id==='desk-12'?'0':null,limit:null},quality:id==='desk-12'?'fresh':'unavailable',observed_at:id==='desk-12'?new Date(wall).toISOString():null,data_age_seconds:null,...changes[id]}))};
}
function fourPayload({names=['四号同事','七号同事','八号同事','一号同事'],counts=['1','2','0',null],observedAt=wall}={}){
  const changes={};
  for(const [i,id] of ['desk-09','desk-10','desk-11','desk-12'].entries())changes[id]={
    bound:true,display_name:`配置别名 ${i}`,username:names[i],identity_quality:'fresh',identity_observed_at:new Date(observedAt).toISOString(),
    concurrency:{current:counts[i],limit:'10'},quality:counts[i]===null?'untracked':'fresh',observed_at:new Date(observedAt).toISOString()
  };
  return payload(changes);
}
function context(){
  const calls=[];const ctx={calls,imageSmoothingEnabled:false};
  for(const method of ['clearRect','drawImage','save','restore','beginPath','ellipse','rect','clip'])ctx[method]=(...args)=>calls.push([method,...args]);
  return {getContext:()=>ctx,ctx};
}
const loader=async url=>({url,width:url.includes('frames-')?768:url.includes('face')?360:192,height:url.includes('frames-')?576:url.includes('face')?174:192});
async function fixture(options={}){
  const r=new ConnectedOfficeRuntime(attached,assets,new URL('frontend/company-office/connected-v4/',root).href);r.benches=records;
  for(const s of r.stations){
    s.player=await new ConnectedSeatedPlayer(context(),assets,{direction:s.direction,imageLoader:loader}).initialize();
    r.attachPlayerToBench(s,s.player);s.player.setState('idle');
    s.texture={refresh(){}};
  }
  r.player=r.getStation('desk-12').player;
  let now=wall;const a=new OfficeRuntimeAdapter(r,{now:()=>now,...options});
  return {r,a,advance(ms){now+=ms;if(r.scene)r.scene.time.now+=ms;},scene(ms=1000){r.scene={time:{now:ms},cameras:{main:{zoom:1,worldView:{x:0,y:0,width:1584,height:993}}}};}};
}
function seat(a,id='desk-12'){return a.snapshot().stations.find(s=>s.id===id);}
function resetCalls(r){for(const s of r.stations)s.player.ctx.calls.length=0;}

test('contract: full sixteen-seat public schema, aliases only, unsafe integers rejected atomically',async()=>{
  const {a}=await fixture(),p=payload();p.user_id='SECRET';p.email='SECRET';p.stations[0].api_keys=['SECRET'];p.stations[0].user_id='SECRET';
  a.applyTelemetrySnapshot(p);assert.equal(JSON.stringify(a.actualSnapshot).includes('SECRET'),false);
  const before=a.actualSnapshot;p.stations[0].seat_id='desk-12';assert.throws(()=>a.applyTelemetrySnapshot(p));assert.deepEqual(a.actualSnapshot,before);
  assert.throws(()=>normalizeTelemetrySnapshot({...payload(),stations:[]},seatIds));
  const unsafe=payload({'desk-12':{concurrency:{current:9007199254740992}}});assert.throws(()=>a.applyTelemetrySnapshot(unsafe));assert.deepEqual(a.actualSnapshot,before);
});
test('initial desk-12 bound neutral; fifteen empty actors retain original chairs/occlusion',async()=>{
  const {a,r}=await fixture();assert.equal(seat(a).actorVisible,true);assert.equal(seat(a).neutral,true);assert.equal(seat(a).activity,'unknown');
  for(const s of r.stations.filter(s=>s.id!=='desk-12')){
    assert.equal(s.player.actorVisible,false);s.player.ctx.calls.length=0;s.player._drawKey=null;s.player.sample(1000);
    const draws=s.player.ctx.calls.filter(c=>c[0]==='drawImage');
    assert.equal(draws.some(c=>c[1]===s.player.images.base),false);
    for(const layer of ['back','front']){
      const chair=draws.find(c=>c[1]===s.player.images[layer]),clip=CHAIR_CLIPS[s.direction][layer];
      if(clip)assert.deepEqual(chair.slice(2,6),clip);else assert.equal(chair,undefined);
    }
    assert.equal(s.player.snapshot().benchOcclusion,true);
  }
  resetCalls(r);
});
test('fresh positive → writing/working; zero → idle; decimal string stays lossless',async()=>{
  const {a}=await fixture();a.applyTelemetrySnapshot(payload({'desk-12':{concurrency:{current:'9007199254740993123'}}}));
  assert.equal(seat(a).state,'writing');assert.equal(seat(a).player.action,'working');assert.equal(seat(a).current,'9007199254740993123');assert.deepEqual(seat(a).speechBubble.lines,['狂暴模式']);
  a.applyTelemetrySnapshot(payload());assert.equal(seat(a).activity,'idle');assert.equal(seat(a).player.clock,36);assert.deepEqual(seat(a).speechBubble.lines,['休息中']);
});
for(const status of ['connecting','error','stale'])test(`source ${status} becomes neutral unknown, never business error`,async()=>{
  const {a,r}=await fixture();a.applyTelemetrySnapshot(payload({'desk-12':{concurrency:{current:'8'}}},{status}));
  assert.equal(seat(a).activity,'unknown');assert.equal(seat(a).state,'idle');assert.equal(seat(a).current,null);assert.deepEqual(seat(a).speechBubble.lines,[status==='stale'?'已过期':'状态未知']);
  const p=r.getStation('desk-12').player;p.ctx.calls.length=0;p._drawKey=null;p.sample(1500);
  assert.equal(p.ctx.calls.some(c=>c[0]==='ellipse'),false);assert.equal(p.ctx.calls.some(c=>c[0]==='drawImage'&&c[1]===p.images.base),true);
  const n=p.ctx.calls.length;p.sample(1700);assert.equal(p.ctx.calls.length,n,'neutral pixels remain static');
});
for(const quality of ['unavailable','untracked','stale'])test(`${quality} concurrency stays unknown even with positive current`,async()=>{
  const {a}=await fixture();a.applyTelemetrySnapshot(payload({'desk-12':{quality,concurrency:{current:'3'}}}));assert.equal(seat(a).activity,'unknown');assert.equal(seat(a).current,null);
  assert.deepEqual(seat(a).speechBubble.lines,[{unavailable:'状态未知',untracked:'未跟踪',stale:'已过期'}[quality]]);
});
test('null, absent observed_at, future or old timestamps cannot become idle/busy',async()=>{
  const {a}=await fixture();
  for(const change of [{concurrency:{current:null}},{observed_at:null},{observed_at:new Date(wall-15000).toISOString()},{observed_at:new Date(wall+10000).toISOString()}]){
    a.applyTelemetrySnapshot(payload({'desk-12':change}));assert.equal(seat(a).activity,'unknown');
  }
});
test('expiry without another request, interval changes, failure and recovery; wall age never restarts',async()=>{
  const {a,r,advance,scene}=await fixture();scene();a.applyTelemetrySnapshot(payload({'desk-12':{concurrency:{current:'2'}}}));
  advance(14999);a.update(r.scene.time.now);assert.equal(seat(a).activity,'busy');
  advance(1);a.update(r.scene.time.now);assert.equal(seat(a).activity,'unknown');
  a.applyTelemetrySnapshot(payload({'desk-12':{observed_at:new Date(wall+15000).toISOString(),concurrency:{current:'2'}}}));assert.equal(seat(a).activity,'busy');
  a.markUnavailable();assert.equal(seat(a).activity,'unknown');
  a.applyTelemetrySnapshot(payload({'desk-12':{observed_at:new Date(wall+15000).toISOString(),concurrency:{current:'0'}}}));assert.equal(seat(a).activity,'idle');
  a.applyTelemetrySnapshot(payload({'desk-12':{observed_at:new Date(wall+15000).toISOString()}},{poll_interval_seconds:30}));advance(89999);a.update(r.scene.time.now);assert.equal(seat(a).activity,'idle');advance(1);a.update(r.scene.time.now);assert.equal(seat(a).activity,'unknown');
});
test('repeat snapshots/aliases/current changes do not reset other seat clocks',async()=>{
  const {a,r,scene}=await fixture();scene();
  const p=payload({'desk-01':{bound:true,display_name:'另一同事',quality:'fresh',observed_at:new Date(wall).toISOString(),concurrency:{current:'1'}},'desk-12':{concurrency:{current:'1'}}});
  a.applyTelemetrySnapshot(p);const first=r.getStation('desk-01').epoch;r.scene.time.now=2400;for(const s of r.stations)s.player.sample(2400-s.epoch);a.applyTelemetrySnapshot(p);assert.equal(r.getStation('desk-01').epoch,first);
  p.stations.find(s=>s.seat_id==='desk-12').concurrency.current='0';a.applyTelemetrySnapshot(p);
  assert.equal(r.getStation('desk-01').epoch,first);assert.equal(r.getStation('desk-12').epoch,2400);
  assert.equal(r.getStation('desk-01').player.sampleMs,1400);
});
test('old status/agents writes and live direction/state writes are rejected',async()=>{
  const {a,r}=await fixture();const before=a.actualSnapshot;
  for(const fn of [()=>r.setMainStatus({state:'error'}),()=>r.syncAgents([]),()=>r.setState('error'),()=>a.setStationState('desk-12','error'),()=>a.setStationDirection('desk-12','left')])assert.throws(fn);
  assert.deepEqual(a.actualSnapshot,before);
});
test('preview covers all sixteen/four directions/six states with fixed furniture geometry/clocks',async()=>{
  const {a,r}=await fixture(),positions=structuredClone(r.stations.map(s=>[s.center,s.contact,s.scale,s.occupied]));await a.setDemoMode(true);
  for(const direction of ['up','down','left','right']){
    await a.setPreview(true,{direction});
    for(const state of Object.keys(BUSINESS_STATES))for(const s of r.stations){
      a.setStationState(s.id,state);s.player.sample(500);assert.equal(s.player.state,state);assert.equal(s.player.actorVisible,true);assert.equal(s.direction,direction);
      assert.equal(s.player.snapshot().clock,{idle:36,writing:60,researching:60,executing:60,syncing:60,error:12}[state]);assert.equal(s.player.snapshot().fps,12);
      assert.deepEqual(seat(a,s.id).speechBubble.lines,[{idle:'演示·待机',writing:'演示·写作',researching:'演示·研究',executing:'演示·执行',syncing:'演示·同步',error:'演示·异常'}[state]]);
    }
  }
  assert.deepEqual(r.stations.map(s=>[s.center,s.contact,s.scale,s.occupied]),positions);
  assert.equal(a.snapshot().demo,true);assert.equal(a.actualSnapshot.source.status,'connecting');await a.setDemoMode(false);
  assert.deepEqual(r.stations.map(s=>s.direction),attached.stations.map(s=>s.direction));assert.equal(a.snapshot().stations.filter(s=>s.actorVisible).length,1);
});
test('telemetry arriving during preview does not overwrite preview, exit renders latest actual',async()=>{
  const {a,r,advance,scene}=await fixture();scene();await a.setDemoMode(true);a.setStationState('desk-12','error');
  const p=payload({'desk-12':{concurrency:{current:'3'}}});a.applyTelemetrySnapshot(p);assert.equal(seat(a).state,'error');assert.equal(a.actualSnapshot.stations.find(s=>s.seat_id==='desk-12').concurrency.current,'3');
  advance(400);await a.setDemoMode(false);assert.equal(seat(a).state,'writing');assert.equal(r.getStation('desk-12').epoch,1000);assert.equal(r.getStation('desk-12').player.sampleMs,400);
  await a.setDemoMode(true);advance(16000);await a.setDemoMode(false);assert.equal(seat(a).activity,'unknown');
});
test('mode preview initializes all actors and async direction cannot resurrect a closed preview',async()=>{
  const {a,r}=await fixture({mode:'preview'});assert.equal(r.stations.filter(s=>s.player.actorVisible).length,16);
  const turning=a.setStationDirection('desk-12','left'),exit=a.setDemoMode(false);await Promise.all([turning,exit]);
  assert.equal(r.getStation('desk-12').direction,attached.stations.find(s=>s.id==='desk-12').direction);assert.equal(a.preview,false);
});
test('nested field quality and server data_age cannot freshen cached samples on repeat',async()=>{
  const {a,advance}=await fixture();
  const p=payload({'desk-12':{quality:{concurrency:'fresh'},data_age_seconds:14,concurrency:{current:'2'}}});
  a.applyTelemetrySnapshot(p);assert.equal(seat(a).activity,'busy');advance(1000);a.update(1000);assert.equal(seat(a).activity,'unknown');
  p.stations.find(s=>s.seat_id==='desk-12').observed_at=new Date(wall-16000).toISOString();
  a.applyTelemetrySnapshot(p);assert.equal(seat(a).activity,'unknown');
});
test('v1 settings, snapshot copy and subscribe/unsubscribe are independent of actual',async()=>{
  const {a,r}=await fixture();let n=0;const off=a.subscribe(()=>n++),before=a.actualSnapshot;
  a.applyDisplaySettings({default_view:'east',show_bubbles:false,show_labels:false,details_collapsed:true,reduced_motion:'on'});
  assert.equal(r.reducedMotion,true);assert.equal(r.view,'east');assert.equal(n,2);off();a.applyDisplaySettings({reduced_motion:'off'});assert.equal(n,2);
  assert.deepEqual(a.actualSnapshot,before);a.actualSnapshot.stations[0].display_name='MUTATE';assert.notEqual(a.actualSnapshot.stations[0].display_name,'MUTATE');
  a.applyTelemetrySnapshot({...payload({}, {status:'connecting'}),config_version:0});assert.equal(a.actualSnapshot.config_version,0);
  assert.throws(()=>a.applyDisplaySettings({actorScale:10}));a.destroy();a.destroy();assert.throws(()=>a.applyTelemetrySnapshot(payload()));
});

test('four approved adjacent seats retain public usernames in details, status-only bubbles never backfill aliases',async()=>{
  const {a,r}=await fixture();a.applyTelemetrySnapshot(fourPayload());
  assert.deepEqual(a.snapshot().stations.filter(s=>s.actorVisible).map(s=>s.seat_id),['desk-09','desk-10','desk-11','desk-12']);
  for(const [i,id] of ['desk-09','desk-10','desk-11','desk-12'].entries()){
    const s=seat(a,id);assert.equal(s.username,['四号同事','七号同事','八号同事','一号同事'][i]);
    assert.deepEqual(s.speechBubble.lines,[['工作中','工作中','休息中','未跟踪'][i]]);
    assert.equal(s.current,['1','2','0',null][i]);
    assert.doesNotMatch(s.speechBubble.lines[0],/[0-9：]|同事/u);
  }
  assert.equal(r.getStation('desk-11').state,'idle');assert.equal(r.getStation('desk-12').presentation.neutral,true);
  a.applyTelemetrySnapshot(payload({'desk-12':{display_name:'不能作为用户名',email:'cannot@example.test',user_id:'1'}}));
  assert.equal(seat(a).username,null);assert.deepEqual(seat(a).speechBubble.lines,['休息中']);
  assert.equal(seat(a).display_name,'不能作为用户名');
  assert.equal(JSON.stringify(a.actualSnapshot).includes('cannot@example.test'),false);
  assert.equal(JSON.stringify(a.actualSnapshot).includes('user_id'),false);
});
test('username empty/whitespace, controls and markup stay in public details, never enter status bubbles',async()=>{
  const {a}=await fixture();
  for(const username of ['', '  \t\n ', '橘猫\n同事\t\u202eAB', '<b>同事</b>']){
    a.applyTelemetrySnapshot(payload({'desk-12':{username,identity_quality:'fresh',identity_observed_at:new Date(wall).toISOString()}}));
    assert.equal(a.actualSnapshot.stations.find(s=>s.seat_id==='desk-12').username,username);
    assert.equal(seat(a).username,username,'details retain the exact fresh public username, including empty strings');
    assert.equal(seat(a).identity_quality,'fresh');
    assert.equal(seat(a).speechBubble.lines[0],'休息中');
    assert.deepEqual(seat(a).speechBubble.renderedLines,['休息中']);
    assert.doesNotMatch(seat(a).speechBubble.lines[0],/[<>\r\n\t\u202e]|橘猫|同事|AB/u);
    assert.equal(seat(a).speechBubble.lines.length,1);
  }
  for(const fields of [{username:123},{identity_quality:'untracked'},{identity_observed_at:123},{identity_observed_at:'yesterday'}]){
    assert.throws(()=>a.applyTelemetrySnapshot(payload({'desk-12':fields})));
  }
});
for(const status of ['connecting','error','stale'])test(`identity failclosed at normalize/runtime/public snapshot for source ${status}`,async()=>{
  const {a}=await fixture(),p=fourPayload();p.source.status=status;
  const normalized=normalizeTelemetrySnapshot(p,seatIds,{now:wall});
  for(const row of normalized.stations){assert.equal(row.username,null);assert.notEqual(row.identity_quality,'fresh');}
  a.applyTelemetrySnapshot(p);for(const row of a.snapshot().stations){assert.equal(row.username,null);assert.notEqual(row.identity_quality,'fresh');}
});
test('markUnavailable and natural expiry redact actualSnapshot and snapshot including cached bubble lines',async()=>{
  const {a,advance}=await fixture();a.applyTelemetrySnapshot(fourPayload());
  a.markUnavailable();assert.equal(a.actualSnapshot.stations.filter(s=>s.username!==null).length,0);
  for(const row of a.snapshot().stations.filter(s=>s.bound)){assert.equal(row.username,null);assert.deepEqual(row.speechBubble.lines,['状态未知']);
    assert.deepEqual(row.speechBubble.renderedLines,['状态未知']);}
  a.applyTelemetrySnapshot(fourPayload());assert.equal(seat(a,'desk-09').username,'四号同事');
  advance(15000); // Even a caller who hasn't run update() cannot read stale identity.
  assert.equal(a.actualSnapshot.stations.filter(s=>s.username!==null).length,0);
  for(const row of a.snapshot().stations.filter(s=>s.bound)){
    assert.equal(row.username,null);assert.notEqual(row.identity_quality,'fresh');
    const expected=row.seat_id==='desk-12'?'未跟踪':'已过期';
    assert.equal(row.speechBubble.lines[0],expected);assert.equal(row.speechBubble.renderedLines[0],expected);
    assert.doesNotMatch(row.speechBubble.lines[0],/同事|[0-9]/u);
  }
  a.update(15000);assert.equal(seat(a,'desk-09').speechBubble.lines[0],'已过期');
});
test('identity and concurrency freshness are independent and source observation cannot revive old identity',async()=>{
  const {a,advance}=await fixture();const p=fourPayload();p.stations.find(s=>s.seat_id==='desk-09').identity_observed_at=new Date(wall-14000).toISOString();
  a.applyTelemetrySnapshot(p);advance(1000);a.update(1000);
  const s=seat(a,'desk-09');assert.equal(s.identity_quality,'stale');assert.equal(s.username,null);assert.equal(s.activity,'busy');assert.equal(s.current,'1');assert.equal(s.speechBubble.lines[0],'工作中');
  p.source.last_success_at=new Date(wall+1000).toISOString();a.applyTelemetrySnapshot(p);assert.equal(seat(a,'desk-09').username,null);
  p.stations.find(s=>s.seat_id==='desk-09').identity_observed_at=new Date(wall+1000).toISOString();a.applyTelemetrySnapshot(p);assert.equal(seat(a,'desk-09').username,'四号同事');
});
test('same 5s payload/source observation, layout and names do not restart per-seat float/feedback or actor clocks',async()=>{
  const {a,r,scene,advance}=await fixture();scene(1000);a.applyTelemetrySnapshot(fourPayload());
  const clocks=structuredClone([...a.bubbleClocks.live]),actorEpoch=r.getStation('desk-09').epoch;
  advance(5000);const p=fourPayload({observedAt:wall+5000});p.source.last_success_at=new Date(wall+5000).toISOString();a.applyTelemetrySnapshot(p);
  assert.deepEqual([...a.bubbleClocks.live],clocks);assert.equal(r.getStation('desk-09').epoch,actorEpoch);
  p.stations.find(s=>s.seat_id==='desk-09').concurrency.current='3';a.applyTelemetrySnapshot(p);
  assert.equal(a.bubbleClocks.live.get('desk-09').feedbackAt,6000);assert.equal(a.bubbleClocks.live.get('desk-10').feedbackAt,1000);
  assert.equal(a.bubbleClocks.live.get('desk-09').motionEpoch,clocks.find(([id])=>id==='desk-09')[1].motionEpoch);
  const clock=a.bubbleClocks.live.get('desk-09');
  assert.ok(sampleSpeechBubbleMotion(clock,6100).feedback>0);assert.equal(sampleSpeechBubbleMotion(clock,6200).feedback,0);
  assert.deepEqual(sampleSpeechBubbleMotion(clock,6100,true),{offsetCss:0,feedback:0});
  for(let t=6000;t<10000;t+=20)assert.ok(Math.abs(sampleSpeechBubbleMotion(clock,t).offsetCss)<SPEECH_BUBBLE_STYLE.motionReservePixels);
});
test('preview has independent demo identities/bubble clocks, leaving latest actual untouched',async()=>{
  const {a,r}=await fixture();a.applyTelemetrySnapshot(fourPayload());const actual=a.actualSnapshot,live=structuredClone([...a.bubbleClocks.live]);
  await a.setDemoMode(true);a.setStationState('desk-09','error');await a.setStationDirection('desk-09','left');
  assert.equal(seat(a,'desk-09').speechBubble.lines[0],'演示·异常');assert.equal(seat(a,'desk-09').username,null);
  assert.deepEqual(a.actualSnapshot,actual);assert.deepEqual([...a.bubbleClocks.live],live);
  await a.setDemoMode(false);assert.equal(seat(a,'desk-09').speechBubble.lines[0],'工作中');assert.equal(seat(a,'desk-09').username,'四号同事');assert.equal(r.getStation('desk-09').player.snapshot().fps,12);
});
test('speech layout reserves pointer/float/update extents, routes around screens and packs four without edge clipping',()=>{
  const viewport=[0,0,800,600],items=[1,2,3,4].map((id,i)=>({id:String(id),head:[260+i*90,420],width:160,height:52}));
  const obstacles=[[200,435,480,100],...items.map(i=>[i.head[0]-15,i.head[1],30,45])];
  const result=layoutSpeechBubbles(items,viewport,obstacles,1),rects=[];
  const overlap=(a,b)=>a[0]<b[0]+b[2]&&a[0]+a[2]>b[0]&&a[1]<b[1]+b[3]&&a[1]+a[3]>b[1];
  for(const entry of result.values()){
    assert.equal(entry.visible,true);assert.ok(entry.reserved[0]>=4&&entry.reserved[1]>=4&&entry.reserved[0]+entry.reserved[2]<=796&&entry.reserved[1]+entry.reserved[3]<=596);
    assert.equal(obstacles.some(r=>overlap(entry.reserved,r)),false);assert.equal(rects.some(r=>overlap(entry.reserved,r)),false);rects.push(entry.reserved);assert.ok(entry.leader.length>=2);
  }
  const edge=layoutSpeechBubbles([{id:'edge',head:[15,18],width:150,height:50}],viewport,[],1).get('edge');
  assert.equal(edge.visible,true);assert.equal(edge.side,'below','top-clipped callout uses local below fallback');
  assert.ok(edge.rect[1]-18<30);assert.ok(edge.rect[0]>=4);
  assert.ok(edge.leader.reduce((length,p,i,points)=>length+(i?Math.hypot(p[0]-points[i-1][0],p[1]-points[i-1][1]):0),0)<80,'fallback remains local, not a distant annotation');
  const offMap=layoutSpeechBubbles([{id:'outside',head:[-100,18],width:150,height:50}],viewport,[],1).get('outside');
  assert.equal(offMap.visible,false);assert.equal(offMap.reason,'anchor_clipped');
  const packed=layoutSpeechBubbles([{id:'tiny',head:[15,18],width:150,height:50}],[0,0,100,60],[],1).get('tiny');assert.equal(packed.visible,false);assert.equal(packed.reason,'viewport_packed');
});

test('compact callouts stay horizontally aligned and never search distant map rails',()=>{
  const items=[0,1,2,3].map(i=>({id:String(i),head:[200+i*55,200],width:76,height:20}));
  const viewport=[0,0,600,400];
  const placements=layoutSpeechBubbles(items,viewport,[],1);
  for(const item of items){const p=placements.get(item.id);assert.equal(p.visible,true);assert.equal(p.rect[0]+p.rect[2]/2,item.head[0]);assert.ok(item.head[1]-p.rect[1]<100);}
  const upperBlock=[100,70,300,128];
  const fallback=layoutSpeechBubbles([items[0]],viewport,[upperBlock],1).get('0');
  assert.equal(fallback.visible,true);assert.equal(fallback.side,'below');assert.ok(fallback.rect[1]-200<30);
  const blocked=layoutSpeechBubbles([items[0]],viewport,[upperBlock,[100,205,300,190]],1).get('0');
  assert.equal(blocked.visible,false);assert.equal(blocked.reason,'local_anchor_packed');
});

test('19024 east/DPR2 regression: a world-sized own head must not block its leader endpoint',()=>{
  const unit=0.5450208486632327,viewport=[551,387,822.9814814814815,380];
  const items=[821.7769723756905,921.2981510128914,1020.5615027624309,1121.8874696132598]
    .map((x,i)=>({id:`desk-${String(9+i).padStart(2,'0')}`,head:[x,479.69414364640886],width:76.30291881285258,height:26.36047898185642}));
  const heads=items.map(({head})=>[head[0]-16.8,head[1]-1.12,33.6,31.36]);
  const screens=items.map(({head})=>[head[0]-35,549.0681399631676,72,18.56353591160223]);
  const labels=[[1011.1091243561442,388.63096073013855,45.78175128771155,11.594774145713938]];
  const overlap=(a,b)=>a[0]<b[0]+b[2]&&a[0]+a[2]>b[0]&&a[1]<b[1]+b[3]&&a[1]+a[3]>b[1];
  const placements=layoutSpeechBubbles(items,viewport,[...heads,...screens,...labels],unit);
  for(const [id,p] of placements){
    assert.equal(p.visible,true,id);const head=heads[items.findIndex(i=>i.id===id)];
    const end=p.leader.at(-1);assert.ok(end[1]+unit<head[1]-unit,'endpoint stroke clears inflated own head');
    for(let i=1;i<p.leader.length;i++){
      const a=p.leader[i-1],b=p.leader[i],box=[Math.min(a[0],b[0])-unit,Math.min(a[1],b[1])-unit,Math.abs(a[0]-b[0])+2*unit,Math.abs(a[1]-b[1])+2*unit];
      assert.equal([...heads,...screens,...labels].some(o=>overlap(box,o)),false,`${id} leader crosses head/screen/label`);
    }
  }
});

test('integrated short status tiers preserve lossless detail counts even without a usable username',async()=>{
  const {a}=await fixture();
  for(const [current,expected] of [['0','休息中'],['1','工作中'],['2','工作中'],['3','忙碌中'],['4','忙碌中'],['5','玩命干活中'],['8','玩命干活中'],['9','狂暴模式'],['9007199254740993123456789','狂暴模式']]){
    for(const identity_quality of ['unavailable','stale']){
      a.applyTelemetrySnapshot(payload({'desk-12':{username:'不可展示',identity_quality,identity_observed_at:new Date(wall).toISOString(),concurrency:{current,limit:'9007199254740993123456790'}}}));
      const s=seat(a),actual=a.actualSnapshot.stations.find(row=>row.seat_id==='desk-12');
      assert.equal(s.username,null);assert.equal(s.identity_quality,identity_quality);assert.equal(s.current,current);
      assert.equal(actual.concurrency.current,current);assert.equal(actual.concurrency.limit,'9007199254740993123456790');
      assert.deepEqual(s.speechBubble.lines,[expected]);assert.deepEqual(s.speechBubble.renderedLines,[expected]);
      assert.doesNotMatch(s.speechBubble.lines[0],/[0-9：…]|不可展示/u);
    }
  }
  for(const current of [0,2,Number.MAX_SAFE_INTEGER]){
    a.applyTelemetrySnapshot(payload({'desk-12':{concurrency:{current}}}));
    assert.equal(seat(a).current,String(current));
    assert.deepEqual(seat(a).speechBubble.lines,[current===0?'休息中':current===2?'工作中':'狂暴模式']);
  }
  const before=a.actualSnapshot;
  for(const current of [-1,1.5,Number.MAX_SAFE_INTEGER+1,'-1','1.5','1e3','1\n']){
    assert.throws(()=>a.applyTelemetrySnapshot(payload({'desk-12':{concurrency:{current}}})));
    assert.deepEqual(a.actualSnapshot,before,'invalid counts must be rejected atomically, not degrade the last valid sample');
  }
});

test('identity/name and within-tier count updates do not reset bubble clocks; threshold feedback stays per-seat',async()=>{
  const {a,r,scene,advance}=await fixture();scene(1000);a.applyTelemetrySnapshot(fourPayload());
  const before=structuredClone([...a.bubbleClocks.live]),epochs=r.stations.map(s=>[s.id,s.epoch]);
  advance(400);
  const p=fourPayload({names:['换名同事','七号同事','八号同事','一号同事'],counts:['2','2','0',null]});
  p.stations.find(row=>row.seat_id==='desk-09').display_name='别名也改变';
  a.applyTelemetrySnapshot(p);
  assert.equal(seat(a,'desk-09').username,'换名同事');assert.equal(seat(a,'desk-09').current,'2');
  assert.deepEqual([...a.bubbleClocks.live],before,'same status has no visual feedback even when identity and raw count change');
  assert.deepEqual(r.stations.map(s=>[s.id,s.epoch]),epochs,'names and positive-to-positive count changes cannot restart actors');
  advance(200);p.stations.find(row=>row.seat_id==='desk-09').concurrency.current='3';a.applyTelemetrySnapshot(p);
  for(const [id,clock] of before){
    const after=a.bubbleClocks.live.get(id);
    assert.equal(after.motionEpoch,clock.motionEpoch);assert.equal(after.phase,clock.phase);
    if(id==='desk-09'){assert.equal(after.feedbackAt,1600);assert.deepEqual(after.lines,['忙碌中']);}
    else assert.deepEqual(after,clock,'one seat status change leaves every other bubble clock unchanged');
  }
  assert.deepEqual(r.stations.map(s=>[s.id,s.epoch]),epochs);
  const otherClock=a.bubbleClocks.live.get('desk-10'),otherBefore=sampleSpeechBubbleMotion(otherClock,1700);
  assert.ok(sampleSpeechBubbleMotion(a.bubbleClocks.live.get('desk-09'),1700).feedback>0);
  assert.deepEqual(sampleSpeechBubbleMotion(otherClock,1700),otherBefore);assert.equal(otherBefore.feedback,0);
});

// Minimal Phaser Text/Canvas measurement seam. The real adapter wrapping/cache and
// OfficeRenderQuality.styleText implementation run unchanged; this is not browser glyph QA.
function measuredText(){
  const text={text:'',style:{},scaleX:1,scaleY:1,measurements:0,
    setStyle(style){Object.assign(this.style,style);return this;},setLineSpacing(){return this;},setOrigin(){return this;},
    setFontSize(fontSize){this.style.fontSize=fontSize;return this;},
    setScale(scale){this.scaleX=scale;this.scaleY=scale;return this;},
    setResolution(resolution){this.style.resolution=resolution;return this;},setText(value){this.text=value;return this;}};
  const width=value=>Array.from(value).length*Number.parseFloat(text.style.fontSize);
  text.context={measureText(value){text.measurements++;return {width:width(value)};}};
  Object.defineProperties(text,{
    displayWidth:{get(){return Math.max(...this.text.split('\n').map(width))*this.scaleX;}},
    displayHeight:{get(){return this.text.split('\n').length*Number.parseFloat(this.style.fontSize)*this.scaleY;}}
  });
  return text;
}

test('real adapter text preparation rewraps on density/zoom/pitch/viewport changes without truncation or clock resets',async()=>{
  const {a,r,scene}=await fixture();scene(1000);a.applyTelemetrySnapshot(payload({'desk-12':{concurrency:{current:'5'}}}));
  const station=r.getStation('desk-12');station.headAnchor=[320,220];station.bubbleText=measuredText();
  const clock=a.bubbleClocks.live.get(station.id),before={motionEpoch:clock.motionEpoch,feedbackAt:clock.feedbackAt,phase:clock.phase};
  let density=1;
  r.scene.sys={game:{renderer:{gl:null},canvas:{get width(){return density*640;},get height(){return density*480;},getBoundingClientRect(){return {width:640,height:480};}}}};
  // Use real styleText/getters without installing ResizeObserver or browser events.
  r.renderQuality=Object.create(OfficeRenderQuality.prototype);r.renderQuality.scene=r.scene;
  const metrics=new Set();
  for(const dpr of [1,2,2.5,4])for(const zoom of [0.5,1,2])for(const [cssWidth,cssPitch] of [[640,Infinity],[640,42],[64,Infinity],[64,42]]){
    density=dpr;r.scene.cameras.main.zoom=zoom;const unit=density/zoom;
    const item=a._prepareBubble(station,unit,cssWidth*unit,cssPitch*unit);
    assert.equal(item.direction,station.direction);assert.deepEqual(item.head,station.headAnchor);
    assert.equal(station.bubbleText.scaleX,unit);assert.equal(station.bubbleText.style.resolution,Math.ceil(density));
    assert.equal(clock.renderedLines.join(''),'玩命干活中');assert.equal(station.bubbleText.text.replaceAll('\n',''),'玩命干活中');
    assert.equal(clock.renderedLines.length,cssWidth===640&&cssPitch===Infinity?1:2,'changed available width actually rewraps all glyphs');
    assert.doesNotMatch(station.bubbleText.text,/…|[0-9]/u);
    const maxBodyCss=Math.min(84,cssWidth-16,Math.max(40,cssPitch-8));
    assert.ok(item.width<=maxBodyCss*unit+1e-8,'body remains bounded by viewport and workstation pitch');
    assert.equal(item.height,station.bubbleText.displayHeight+6*unit);
    const measured=station.bubbleText.measurements,key=clock.metricsKey;
    assert.deepEqual(a._prepareBubble(station,unit,cssWidth*unit,cssPitch*unit),item);
    assert.equal(station.bubbleText.measurements,measured,'unchanged metrics reuse measured wrapping');assert.equal(clock.metricsKey,key);
    metrics.add(key);
    assert.deepEqual({motionEpoch:clock.motionEpoch,feedbackAt:clock.feedbackAt,phase:clock.phase},before);
  }
  assert.ok(metrics.size>12,'density/zoom/pitch/viewport variation must invalidate layout metrics');
  assert.deepEqual(seat(a).speechBubble.lines,['玩命干活中']);
  assert.equal(seat(a).speechBubble.renderedLines.join(''),'玩命干活中');
});

// Real Canvas/Phaser pixel checks have no server/application dependency.
test('Chromium: post-create ctor, chair pixels, neutral pixels, HD canvas, selection, screens and cleanup',
  {skip:process.env.OFFICE_TELEMETRY_BROWSER!=='1',timeout:120000},async()=>{
  const {createRequire}=await import('node:module'),{createServer}=await import('node:http');
  const {readFile}=await import('node:fs/promises'),{resolve,sep}=await import('node:path'),{fileURLToPath}=await import('node:url');
  const require=createRequire(process.env.OFFICE_QA_NODE_PACKAGE||'/Users/hepingyu/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json');
  const {chromium}=require('playwright'),diskRoot=fileURLToPath(root);
  const html=`<!doctype html><style>body{margin:0}#canvas canvas{width:100%!important;height:100%!important;display:block}</style><div id="canvas" style="width:1920px;height:1080px"></div><script src="/static/vendor/phaser-3.80.1.min.js"></script><script type="module">
    import {ConnectedOfficeRuntime} from '/static/company-office/connected-v4/runtime.mjs';
    import {OfficeRuntimeAdapter} from '/static/company-office/connected-v4/telemetry-adapter.mjs';
    import {prepareOfficeRendering} from '/static/company-office/reference-v3/render-quality.mjs';
    const r=await ConnectedOfficeRuntime.load('/static/company-office/connected-v4/');window.r=r;
    const config={type:Phaser.CANVAS,parent:'canvas',scene:{preload(){r.preload(this)},create(){r.create(this);
      for(const s of r.stations){s.sprite.setVisible(false);s.bubbleText.setVisible(false);}
      for(const o of r.screenOverlays)for(const c of o.components)c.sprite.setVisible(false);
      for(const led of r.serverLights)led.setVisible(false);
      window.a=new OfficeRuntimeAdapter(r);},update(t,d){window.a?.update(t,d)}}};
    prepareOfficeRendering(config,document.getElementById('canvas'),Phaser);window.game=new Phaser.Game(config);
  </script>`;
  const server=createServer(async(req,res)=>{
    try{
      if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end(html);return;}
      const url=new URL(req.url,'http://localhost'),path=resolve(diskRoot,'frontend','.'+decodeURIComponent(url.pathname.replace(/^\/static/,'')));
      if(!path.startsWith(resolve(diskRoot,'frontend')+sep))throw new Error('bad path');
      res.setHeader('Content-Type',path.endsWith('.mjs')?'text/javascript':path.endsWith('.json')?'application/json':path.endsWith('.png')?'image/png':path.endsWith('.webp')?'image/webp':'text/javascript');
      res.end(await readFile(path));
    }catch{res.statusCode=404;res.end();}
  });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser;
  try{
    browser=await chromium.launch({channel:process.env.OFFICE_QA_BROWSER_CHANNEL||'chrome',headless:true});const page=await browser.newPage({viewport:{width:1920,height:1080},deviceScaleFactor:2});const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.waitForFunction(()=>window.a?.runtime.ready);assert.deepEqual(errors,[]);
    assert.equal(await page.evaluate(()=>window.r.getStation('desk-12').bubbleText.text),'状态未知');
    // Targeted real-Phaser regression for the four-user speech callouts. The
    // fixture owns its clock, never reads/writes collector/backend configuration.
    const fourBrowser=await page.evaluate(p=>{
      const a=window.a,r=window.r,initial=a.actualSnapshot,oldNow=a.now;let now=Date.now();a.now=()=>now;
      const fresh=()=>{const iso=new Date(now).toISOString();p.generated_at=iso;p.source.last_success_at=iso;p.source.last_attempt_at=iso;
        for(const row of p.stations.filter(s=>s.bound)){row.observed_at=iso;row.identity_observed_at=iso;}return p;};
      const bound=()=>r.stations.filter(s=>s.presentation.actorVisible);
      const cam=()=>{const c=r.scene.cameras.main;return [c.scrollX,c.scrollY,c.zoom];};
      const clocks=()=>bound().map(s=>({id:s.id,epoch:s.epoch,motionEpoch:a.bubbleClocks.live.get(s.id).motionEpoch,feedbackAt:a.bubbleClocks.live.get(s.id).feedbackAt}));
      const same=(x,y)=>JSON.stringify(x)===JSON.stringify(y);
      a.applyTelemetrySnapshot(fresh());a.setView('east');a.update(r.scene.time.now);
      const camera=cam(),before=clocks();
      const east=bound().map(s=>({id:s.id,visible:s.bubbleText.visible,text:s.bubbleText.text,placement:s.speechPlacement}));
      now+=5000;a.applyTelemetrySnapshot(fresh());a.selectStation('desk-09',{focus:false});
      const noJump=same(cam(),camera),afterPoll=clocks();
      a.setView('overview');a.setView('east');const afterViews=clocks();
      a.applyDisplaySettings({reduced_motion:'on'});a.update(r.scene.time.now+100);
      const staticBefore=bound().map(s=>[s.bubbleText.x,s.bubbleText.y]);a.update(r.scene.time.now+600);
      const reducedStatic=same(staticBefore,bound().map(s=>[s.bubbleText.x,s.bubbleText.y]));
      a.applyDisplaySettings({show_bubbles:false});const hidden=bound().every(s=>!s.bubbleText.visible&&!s.bubbleBackground.visible);
      a.applyDisplaySettings({show_bubbles:true,reduced_motion:'off'});const restored=bound().every(s=>s.bubbleText.visible);
      a.markUnavailable();const failed={actual:a.actualSnapshot.stations.filter(s=>s.bound),exposed:a.snapshot().stations.filter(s=>s.bound),text:bound().map(s=>s.bubbleText.text)};
      const long='中文超长用户名应完整保留在详情而不能出现在状态气泡'.repeat(3);p.stations.find(s=>s.seat_id==='desk-09').username=long;
      p.stations.find(s=>s.seat_id==='desk-11').concurrency.current=null;p.stations.find(s=>s.seat_id==='desk-11').quality='untracked';
      a.applyTelemetrySnapshot(fresh());const recovered=bound().map(s=>({id:s.id,visible:s.bubbleText.visible,text:s.bubbleText.text,neutral:s.presentation.neutral,username:a.snapshot().stations.find(row=>row.id===s.id).username,current:s.current}));
      now+=15000;const expired=a.actualSnapshot.stations.filter(s=>s.bound).every(s=>s.username===null&&s.identity_quality!=='fresh');
      const expiredExposed=a.snapshot().stations.filter(s=>s.bound).every(s=>s.username===null&&s.speechBubble.lines[0]===(s.seat_id==='desk-11'?'未跟踪':'已过期')&&s.speechBubble.renderedLines.join('')===(s.seat_id==='desk-11'?'未跟踪':'已过期'));
      a.now=oldNow;a.applyTelemetrySnapshot(initial);a.setView('overview');
      return {east,noJump,pollClocksStable:same(before,afterPoll),viewClocksStable:same(before,afterViews),reducedStatic,hidden,restored,failed,recovered,expired,expiredExposed};
    },fourPayload({counts:['2','0','1','3']}));
    assert.equal(fourBrowser.east.length,4);
    for(const s of fourBrowser.east){assert.equal(s.visible,true,`${s.id} east callout hidden`);assert.equal(s.placement.visible,true);assert.equal(s.text.replaceAll('\n',''),{'desk-09':'工作中','desk-10':'休息中','desk-11':'工作中','desk-12':'忙碌中'}[s.id]);assert.doesNotMatch(s.text,/[0-9：…]|同事/u);}
    assert.equal(fourBrowser.east.find(s=>s.id==='desk-10').text.replaceAll('\n',''),'休息中');
    for(const flag of ['noJump','pollClocksStable','viewClocksStable','reducedStatic','hidden','restored','expired','expiredExposed'])assert.equal(fourBrowser[flag],true,flag);
    for(const row of [...fourBrowser.failed.actual,...fourBrowser.failed.exposed]){assert.equal(row.username,null);assert.notEqual(row.identity_quality,'fresh');}
    assert.ok(fourBrowser.failed.text.every(text=>text==='状态未知'));
    for(const s of fourBrowser.recovered){assert.equal(s.visible,true);assert.doesNotMatch(s.text,/[0-9：…]|用户名|同事/u);}
    const recoveredLong=fourBrowser.recovered.find(s=>s.id==='desk-09');
    assert.equal(recoveredLong.text.replaceAll('\n',''),'工作中');assert.equal(recoveredLong.current,'2');
    assert.equal(recoveredLong.username,'中文超长用户名应完整保留在详情而不能出现在状态气泡'.repeat(3));
    assert.equal(fourBrowser.recovered.find(s=>s.id==='desk-11').text.replaceAll('\n',''),'未跟踪');
    assert.equal(fourBrowser.recovered.find(s=>s.id==='desk-11').username,'八号同事');
    assert.equal(fourBrowser.recovered.find(s=>s.id==='desk-11').neutral,true);
    console.log('FOUR_BUBBLE_BROWSER_EVIDENCE',JSON.stringify({...fourBrowser,failed:{redacted:true},east:fourBrowser.east.map(({id,visible,text})=>({id,visible,text}))}));
    if(process.env.OFFICE_TELEMETRY_SCREENSHOT)await page.screenshot({path:process.env.OFFICE_TELEMETRY_SCREENSHOT});
    const result=await page.evaluate(async p=>{
      const a=window.a,r=window.r,canvas=r.scene.sys.game.canvas;
      function pixels(s){return Array.from(s.player.ctx.getImageData(0,0,192,192).data);}
      const empty=r.getStation('desk-01'),unknown=r.getStation('desk-12');const chair=pixels(empty),neutral=pixels(unknown);
      const visibleAfterMask=r.stations.every(s=>s.sprite.visible)&&r.screenOverlays.every(o=>o.components.every(c=>c.sprite.visible))&&r.serverLights.every(s=>s.visible);
      let selectedEvents=0;const selected=()=>selectedEvents++;window.addEventListener('office-runtime-change',selected);
      a.applyTelemetrySnapshot(p);const clock=unknown.epoch;r.scene.time.now+=500;a.update(r.scene.time.now);
      const cameraBefore=[r.scene.cameras.main.scrollX,r.scene.cameras.main.scrollY,r.scene.cameras.main.zoom];
      empty.sprite.emit('pointerdown');const cameraAfter=[r.scene.cameras.main.scrollX,r.scene.cameras.main.scrollY,r.scene.cameras.main.zoom];
      a.setView('east');a.applyTelemetrySnapshot(p);const epochPreserved=unknown.epoch===clock;
      a.markUnavailable();r.scene.time.now+=1000;a.update(r.scene.time.now);const neutralAfter=pixels(unknown);r.scene.time.now+=400;a.update(r.scene.time.now);const staticPixels=JSON.stringify(neutralAfter)===JSON.stringify(pixels(unknown));
      const emptyRetained=JSON.stringify(chair)===JSON.stringify(pixels(empty));
      const opaqueChair=chair.filter((_,i)=>i%4===3&&chair[i]>0).length;
      const opaqueNeutral=neutral.filter((_,i)=>i%4===3&&neutral[i]>0).length;
      const overlay=r.screenOverlays.find(o=>o.screen.seatId==='desk-12'),staticScreen=overlay.lastKey;
      r.scene.time.now+=500;a.update(r.scene.time.now);const screenStatic=overlay.lastKey===staticScreen;
      const mixed=structuredClone(p),other=mixed.stations.find(s=>s.seat_id==='desk-01');other.bound=true;other.display_name='另一同事';other.quality='fresh';other.observed_at=new Date().toISOString();other.concurrency.current='2';
      mixed.stations.find(s=>s.seat_id==='desk-12').quality='untracked';
      a.applyTelemetrySnapshot(mixed);const otherStation=r.getStation('desk-01'),otherEpoch=otherStation.epoch;
      const otherOverlay=r.screenOverlays.find(o=>o.screen.seatId==='desk-01');a.update(otherEpoch+10);const screenBefore=otherOverlay.lastKey;a.update(otherEpoch+600);
      const otherStillUpdating=otherOverlay.lastKey!==screenBefore&&otherStation.epoch===otherEpoch&&otherStation.player.tick>0;
      const bubbleText=unknown.bubbleText.text;
      const countBefore=r.scene.children.list.length,quality=r.renderQuality.snapshot();a.destroy();const remaining=r.scene.children.list.length;window.removeEventListener('office-runtime-change',selected);
      return {visibleAfterMask,selectedEvents,otherStillUpdating,bubbleText,cameraBefore,cameraAfter,epochPreserved,staticPixels,emptyRetained,opaqueChair,opaqueNeutral,screenStatic,
        density:canvas.width/canvas.getBoundingClientRect().width,quality,countBefore,remaining,disposed:r.renderQuality.disposed};
    },payload({'desk-12':{observed_at:new Date().toISOString(),concurrency:{current:'2'}}}));
    console.log('BROWSER_EVIDENCE',JSON.stringify(result));
    assert.equal(result.otherStillUpdating,true);assert.equal(result.bubbleText.replaceAll('\n',''),'未跟踪');assert.equal(result.visibleAfterMask,true);assert.ok(result.selectedEvents>0);assert.deepEqual(result.cameraBefore,result.cameraAfter);assert.equal(result.epochPreserved,true);assert.equal(result.staticPixels,true);assert.equal(result.emptyRetained,true);assert.ok(result.opaqueChair>0);assert.ok(result.opaqueNeutral>result.opaqueChair);
    assert.equal(result.screenStatic,true);assert.ok(result.density>=2);assert.equal(result.quality.canvasBacking[0],3840);assert.equal(result.disposed,true);assert.equal(result.remaining,0);
    assert.deepEqual(errors,[]);
    // Resize independent fresh scenes; no production backend, no old DOM buttons.
    for(const viewport of [{width:768,height:1024},{width:390,height:844},{width:844,height:390}]){
      const mobilePage=await browser.newPage({viewport,deviceScaleFactor:2});
      await mobilePage.goto(`http://127.0.0.1:${server.address().port}/`);await mobilePage.waitForFunction(()=>window.a?.runtime.ready);
      const resize=await mobilePage.evaluate(async size=>{
        const host=document.getElementById('canvas');host.style.width=`${size.width}px`;host.style.height=`${size.height}px`;
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        const a=window.a,r=window.r,epoch=r.getStation('desk-12').epoch;
        a.selectStation('desk-12',{focus:true});const s=r.getStation('desk-12');
        const evidence={size:r.renderQuality.snapshot(),epochUnchanged:s.epoch===epoch,visible:s.bubbleVisible,screenClear:s.bubbleScreenClear,text:s.bubbleText.text};
        a.destroy();return evidence;
      },viewport);
      assert.equal(resize.epochUnchanged,true);assert.equal(resize.screenClear,true);assert.equal(resize.text.replaceAll('\n',''),'状态未知');
      assert.deepEqual(resize.size.canvasBacking,[viewport.width*2,viewport.height*2]);
      console.log('DEVICE_EVIDENCE',JSON.stringify({viewport,...resize}));await mobilePage.close();
    }
  }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
});
