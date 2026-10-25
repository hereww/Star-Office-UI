import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {DIRECTIONS,STATES,MODE,ROOT,assertScreenOnly,recordedPlayer} from './connected_v5_qa_helpers.mjs';
import {normalizeBenchManifest,validateBenchManifest,benchTransform,centerForContact,sourceToWorld} from '../frontend/company-office/connected-v5/furniture-contract.mjs';
const layout=JSON.parse(readFileSync(resolve(ROOT,'frontend/company-office/connected-v5/layout.json'),'utf8'));
const records=layout.benches.map(spec=>{
  const source=JSON.parse(readFileSync(resolve(ROOT,'frontend/company-office/connected-v5',spec.manifest),'utf8'));
  const manifest=normalizeBenchManifest(source,spec);return {spec,source,manifest,transform:benchTransform(manifest,spec.fit)};
});

test('16 red/green seats retain static furniture and a one-to-one external display',()=>{
  assert.equal(layout.stations.length,16);assert.deepEqual(layout.openSeatGroups,{west:8,east:8});
  assert.deepEqual(records.map(r=>r.spec.orientation).sort(),['horizontal','vertical']);
  const ids=records.flatMap(r=>r.manifest.seatContacts.map(c=>c.id));assert.equal(new Set(ids).size,16);
  assert.deepEqual(ids.sort(),layout.stations.map(s=>s.id).sort());
  for(const r of records)for(const c of r.manifest.seatContacts)assert.equal(r.manifest.screens.filter(s=>s.seatId===c.id).length,1);
});
for(const direction of DIRECTIONS)test(`${direction}: all 16 seats discard keyboard geometry in every business state`,async()=>{
  const {player,assertBalanced}=await recordedPlayer({direction});
  for(const r of records)for(const c of r.manifest.seatContacts){
    const station=layout.stations.find(s=>s.id===c.id),contact=sourceToWorld(r.transform,c.anchor);
    const center=centerForContact(contact,player.spec.furniture.seatAnchor,station.scale);
    const context={image:{id:r.spec.id},transform:r.transform,center,stationScale:station.scale,
      keyboardBounds:[0,0,192,192],keyboardSourceBounds:c.keyboardBounds??[0,0,1,1],keyboardBoundsConvention:'obsolete'};
    const copy=JSON.stringify(context);player.setBenchContext(context);
    for(const state of STATES){player.setState(state);player.sample(500);assertScreenOnly(player);assertBalanced();}
    assert.equal(JSON.stringify(context),copy,'Caller furniture/keyboard annotations remain read-only');
    assert.deepEqual(player.benchContext.center,center);assert.equal(player.benchContext.image,context.image);
  }
});
test('public V5 contract explicitly enables screen-only and disables keyboard interaction',()=>{
  const a=JSON.parse(readFileSync(resolve(ROOT,'frontend/company-office/connected-v5/assets.json'),'utf8'));
  assert.equal(a.animationMode,MODE);assert.equal(a.screenAnimationContract.mode,'screen-only');
  assert.equal(a.screenAnimationContract.keyboardInteraction,false);assert.equal(a.screenAnimationContract.rearScreens,'led-only');
  assert.equal('workingHands' in a,false);
});

for(const orientation of ['vertical','horizontal'])test(`${orientation}: missing keyboardBounds/keyboardCenter is valid screen-only furniture`,()=>{
  const r=records.find(r=>r.spec.orientation===orientation),source=structuredClone(r.source);
  const strip=value=>{if(!value||typeof value!=='object')return;for(const key of Object.keys(value)){
    if(/^keyboard/.test(key))delete value[key];else strip(value[key]);
  }};
  strip(source);const before=JSON.stringify(source),m=normalizeBenchManifest(source,r.spec);
  assert.deepEqual(validateBenchManifest(m,r.spec),m);assert.equal(m.seatContacts.length,8);assert.equal(m.screens.length,8);
  assert.deepEqual(m.screens,r.manifest.screens.map(s=>{const clone=structuredClone(s);strip(clone);return clone;}));
  for(const c of m.seatContacts)assert.equal('keyboardBounds' in c,false);
  assert.equal(JSON.stringify(source),before,'No synthesized keyboard markers or source mutation');
});
test('active furniture module does not expose the removed keyboard-binding helper',async()=>{
  const module=await import('../frontend/company-office/connected-v5/furniture-contract.mjs');
  assert.equal('keyboardContextForStation' in module,false);
});
