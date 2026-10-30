import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {ConnectedOfficeRuntime,attachBenchContacts} from '../frontend/company-office/connected-v5/runtime.mjs';
import {ConnectedSeatedPlayer} from '../frontend/company-office/connected-v5/seated-player.mjs';
import {benchTransform,normalizeBenchManifest,validateBenchManifest} from '../frontend/company-office/connected-v5/furniture-contract.mjs';
import {OfficeRuntimeAdapter,createOfficeRuntimeAdapter} from '../frontend/company-office/connected-v5/telemetry-adapter.mjs';
import {OFFICE_RUNTIME_DEFAULTS} from '../frontend/office/map-loader.mjs';
import {RockRoomAnimation} from '../frontend/company-office/connected-v5/rock-room-animation.mjs';
import {ServerCabinetAnimation} from '../frontend/company-office/reference-v3/server-cabinet-animation.mjs';
const root=new URL('../',import.meta.url);
const read=path=>JSON.parse(readFileSync(new URL(path,root),'utf8'));
const assets=read('frontend/company-office/reference-v3/assets.json');
const layout=read('frontend/company-office/connected-v5/layout.json');
const records=layout.benches.map(spec=>{const manifest=validateBenchManifest(normalizeBenchManifest(read(`frontend/company-office/connected-v5/${spec.manifest}`),spec),spec);return {spec,manifest,transform:benchTransform(manifest,spec.fit),image:{}};});
function canvas(){const ctx={imageSmoothingEnabled:false};for(const key of ['clearRect','drawImage','save','restore','beginPath','ellipse','rect','clip'])ctx[key]=()=>{};return {getContext:()=>ctx};}
const now=Date.parse('2026-10-06T12:00:00Z');
async function fixture(){const r=new ConnectedOfficeRuntime(attachBenchContacts(layout,assets,records),assets,new URL('frontend/company-office/connected-v5/',root).href);r.benches=records;for(const s of r.stations){s.player=await new ConnectedSeatedPlayer(canvas(),assets,{direction:s.direction,imageLoader:async url=>({width:url.includes('frames-')?768:192,height:url.includes('frames-')?576:192})}).initialize();r.attachPlayerToBench(s,s.player);s.texture={refresh(){}};}r.player=r.getStation('desk-12').player;return {r,a:new OfficeRuntimeAdapter(r,{now:()=>now})};}
function payload(){return {schema_version:1,source:{status:'ok',poll_interval_seconds:5,last_success_at:new Date(now).toISOString(),last_attempt_at:new Date(now).toISOString()},stations:layout.stations.map(s=>({seat_id:s.id,bound:['desk-09','desk-10','desk-11','desk-12'].includes(s.id),display_name:'未绑定',username:'同事',identity_quality:'fresh',identity_observed_at:new Date(now).toISOString(),quality:'fresh',concurrency:{current:'2',limit:'10'},observed_at:new Date(now).toISOString()}))};}
test('production loader selects V5 scene, V5 assets and V5 adapter',()=>{const code=readFileSync(new URL('frontend/office/map-loader.mjs',root),'utf8');for(const path of ['connected-v5/runtime.mjs','connected-v5/telemetry-adapter.mjs','connected-v5/'])assert.ok(code.includes(path));});
test('production loader keeps one explicit runtime path table',()=>{assert.deepEqual(OFFICE_RUNTIME_DEFAULTS,{runtime:'../company-office/connected-v5/runtime.mjs',assets:'../company-office/connected-v5/',adapter:'../company-office/connected-v5/telemetry-adapter.mjs',quality:'../company-office/reference-v3/render-quality.mjs',phaser:'../vendor/phaser-3.80.1.min.js'});});
test('factory rejects unrelated runtime classes',()=>{assert.throws(()=>createOfficeRuntimeAdapter(class {}));});
test('V5 bridge preserves runtime type, all four live users and no hand/keyboard layers',async()=>{const {r,a}=await fixture();assert.ok(r instanceof ConnectedOfficeRuntime);a.applyTelemetrySnapshot(payload());const actual=a.snapshot();assert.equal(actual.stations.filter(s=>s.bound).length,4);for(const station of r.stations){assert.ok(station.player instanceof ConnectedSeatedPlayer);assert.equal('handsCanvas' in station.player,false);const s=station.player.snapshot();assert.equal(s.animationMode,'full-frame-plus-screen-effects');assert.equal(s.keyboardInteraction,false);}assert.equal(r.snapshot().scene,'company-office-connected-v5');});
test('V5 bridge retains unknown concurrency rather than fabricated zero',async()=>{const {a}=await fixture();const p=payload();p.source.status='error';a.applyTelemetrySnapshot(p);for(const s of a.snapshot().stations.filter(s=>s.bound)){assert.equal(s.current,null);assert.equal(s.activity,'unknown');}});
test('HTTP/LAN runtime provenance is explicitly optional, never fake WebCrypto success',()=>{for(const version of ['v4','v5']){const s=readFileSync(new URL(`frontend/company-office/connected-${version}/runtime.mjs`,root),'utf8');assert.ok(s.includes("if(!globalThis.crypto?.subtle)"));assert.ok(s.includes("status:'unavailable-in-insecure-context'"));}});

test('employee/admin copy agrees with the selected V5 release',()=>{for(const name of ['employee.mjs','admin.mjs']){const code=readFileSync(new URL('frontend/office/'+name,root),'utf8');assert.ok(code.includes('V5'));assert.equal(code.includes('V4'),false);}});

async function animatedFixture(){
 const {r,a}=await fixture();
 a.applyTelemetrySnapshot(payload());
 const room=new RockRoomAnimation(layout,read('frontend/company-office/connected-v5/assets.json'),new URL('frontend/company-office/connected-v5/',root).href);
 room.performers=room.spec.performers.map(spec=>({...spec,sprite:{frame:{name:spec.phase},setFrame(frame){this.frame.name=frame;},setVisible(){}}}));
 room.ready=true;room.scene={time:{now:0}};room.reducedMotion=false;
 r.rockRoomAnimation=room;
 r.serverCabinetAnimation=new ServerCabinetAnimation(layout);r.serverCabinetAnimation.ready=true;
 r.ready=true;
 return {r,a,room};
}

test('live adapter advances room frames once per update while unknown screens stay frozen',async()=>{
 const {r,a,room}=await animatedFixture(),ticks=[],screens=[];
 const advance=room.update.bind(room);
 room.update=time=>{ticks.push(time);advance(time);};
 r.screenOverlays=['desk-09','desk-01'].map(seatId=>({screen:{seatId},sample:(...args)=>screens.push({seatId,args})}));
 const frames=[];
 for(const time of [125,250,375]){a.update(time);frames.push(room.performers.map(p=>p.sprite.frame.name));}
 assert.deepEqual(ticks,[125,250,375]);
 assert.deepEqual(frames,[[1,4,7,10],[2,5,8,11],[3,6,9,0]]);
 assert.equal(screens.length,6,'each independent screen sampled once per update');
 assert.deepEqual(screens.filter(s=>s.seatId==='desk-01').map(s=>s.args.slice(1)),[[0,true],[0,true],[0,true]]);
 assert.deepEqual(screens.filter(s=>s.seatId==='desk-09').map(s=>s.args.slice(1)),[[125,false],[250,false],[375,false]]);
 room.applyVisibility({rock:{enabled:false}});
 a.update(625);assert.equal(room.frame,3,'hidden room keeps its previous frame');
 room.applyVisibility({rock:{enabled:true}});
 a.update(750);assert.equal(room.frame,6,'restored room resumes the current clock');
});

test('live display motion on/off/system controls the room together with seats and rack',async()=>{
 const {r,a,room}=await animatedFixture();
 a.systemMotionQuery={matches:false};
 a.applyDisplaySettings({reduced_motion:'on'});
 a.update(250);a.update(625);
 assert.equal(room.frame,0);assert.equal(room.reducedMotion,true);
 assert.equal(room.motionManaged,true);
 assert.equal(r.serverCabinetAnimation.reducedMotion,true);
 assert.ok(r.stations.every(s=>s.player.reducedMotion));
 a.systemMotionQuery.matches=true;
 a.applyDisplaySettings({reduced_motion:'off'});
 a.update(750);assert.equal(room.frame,6,'off overrides a reduced-motion OS preference');
 a.systemMotionHandler();a.update(875);assert.equal(room.frame,7,'OS changes cannot override explicit off');
 a.applyDisplaySettings({reduced_motion:'system'});
 a.update(1000);assert.equal(room.frame,0,'system follows the current OS preference');
 a.systemMotionQuery.matches=false;a.systemMotionHandler();
 a.update(1125);assert.equal(room.frame,9,'system resumes on OS preference change');
 assert.equal(r.serverCabinetAnimation.reducedMotion,false);
 assert.ok(r.stations.every(s=>!s.player.reducedMotion));
});
