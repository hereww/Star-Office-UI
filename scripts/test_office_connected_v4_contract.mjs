#!/usr/bin/env node
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {normalizeBenchManifest,validateBenchManifest,benchTransform,sourceToWorld,centerForContact,absoluteAssetPaths} from '../frontend/company-office/connected-v4/furniture-contract.mjs';
import {validateConnectedLayout,attachBenchContacts} from '../frontend/company-office/connected-v4/runtime.mjs';
import {screenSafeBubbleLayout} from '../frontend/company-office/connected-v4/bubble-layout.mjs';
const read=relative=>JSON.parse(readFileSync(new URL(relative,import.meta.url),'utf8'));
const layout=read('../frontend/company-office/connected-v4/layout.json');
const assets=read('../frontend/company-office/reference-v3/assets.json');
const records=layout.benches.map(spec=>{const raw=read('../frontend/company-office/connected-v4/'+spec.manifest);const manifest=validateBenchManifest(normalizeBenchManifest(raw,spec),spec);return {spec,raw,manifest,transform:benchTransform(manifest,spec.fit)};});
const fixture=attachBenchContacts(layout,assets,records);

test('both source conventions normalize losslessly without mutating provenance',()=>{
 for(const r of records){assert.ok(r.raw.alphaBoundsConvention.includes('['));assert.deepEqual(r.manifest.normalization.sourceAlphaBounds,r.raw.alphaBounds);assert.equal(r.manifest.alphaBounds[2],r.raw.visibleAlphaBounds[2]-r.raw.visibleAlphaBounds[0]);assert.equal(r.manifest.alphaBounds[3],r.raw.visibleAlphaBounds[3]-r.raw.visibleAlphaBounds[1]);assert.equal(r.manifest.seatContacts.length,8);}
});
test('continuous benches use uniform scale, all 16 sources remain correctly anchored',()=>{
 for(const r of records){const t=r.transform;assert.equal(t.width/r.manifest.actualPixelSize[0],t.scale);assert.equal(t.height/r.manifest.actualPixelSize[1],t.scale);for(const c of r.manifest.seatContacts)assert.ok(sourceToWorld(t,c.anchor).every(Number.isFinite));}
 assert.equal(fixture.stations.length,16);for(const s of fixture.stations)assert.deepEqual(centerForContact(s.contact,assets.directions[s.direction].furniture.seatAnchor,s.scale),s.center);
});
test('final actor envelopes and continuous desks preserve no-walking room bounds',()=>{assert.doesNotThrow(()=>validateConnectedLayout(fixture));assert.equal(fixture.walkIntegrated,false);assert.equal(fixture.furnitureMode,'connected-benches');});
test('eight contacts required and duplicate contact ids rejected',()=>{
 const r=records[0],m=structuredClone(r.manifest);m.seatContacts.pop();assert.throws(()=>validateBenchManifest(m,r.spec));const bad=structuredClone(r.manifest);bad.seatContacts[1].id=bad.seatContacts[0].id;assert.throws(()=>validateBenchManifest(bad,r.spec));
});
test('each side has four seats and must face the desk',()=>{
 const r=records[0],m=structuredClone(r.manifest);m.seatContacts[0].direction='up';assert.throws(()=>validateBenchManifest(m,r.spec));const bad=structuredClone(r.manifest);bad.seatContacts[0].side='right';bad.seatContacts[0].direction='left';assert.throws(()=>validateBenchManifest(bad,r.spec));
});
test('display count and one-display-per-seat ids are validated',()=>{
 const r=records[1],m=structuredClone(r.manifest);m.screens.pop();assert.throws(()=>validateBenchManifest(m,r.spec));const bad=structuredClone(r.manifest);bad.screens[1].seatId=bad.screens[0].seatId;assert.throws(()=>validateBenchManifest(bad,r.spec));
});
test('rear monitors use existing LEDs; proposed nonexistent front LEDs are omitted',()=>{
 const r=records[1];for(const s of r.manifest.screens){if(s.kind==='back')assert.ok(s.led);else assert.equal(s.led,undefined);}const bad=structuredClone(r.manifest);delete bad.screens[0].led;assert.throws(()=>validateBenchManifest(bad,r.spec));
});
test('screen masks must be nondegenerate and inside the actual source image',()=>{
 const r=records[0],bad=structuredClone(r.manifest);bad.screens[0].polygon=[[0,0],[0,0],[0,0]];assert.throws(()=>validateBenchManifest(bad,r.spec));bad.screens[0].polygon=[[0,0],[10000,0],[0,10000]];assert.throws(()=>validateBenchManifest(bad,r.spec));
});
test('benches and actors cannot intersect forbidden rooms',()=>{
 const bad=structuredClone(fixture);bad.benches[0].alphaWorld=[660,100,150,150];assert.throws(()=>validateConnectedLayout(bad));const actor=structuredClone(fixture);actor.stations[0].center=[750,160];assert.throws(()=>validateConnectedLayout(actor));
});
test('asset URL resolution preserves every non-URL value and never modifies original input',()=>{
 const copy=structuredClone(assets),resolved=absoluteAssetPaths(assets,'http://127.0.0.1:19000/static/company-office/reference-v3/');assert.deepEqual(assets,copy);
 for(const dir of ['up','down','left','right']){const p=copy.directions[dir].character,n=resolved.directions[dir].character;for(const k of ['poseAnchor','scale','faceRect','faceClipEllipse','headAnchor','faceVisible'])assert.deepEqual(n[k],p[k]);assert.ok(n.base.startsWith('http://127.0.0.1:19000/'));}
});
test('bubble is lifted above visible screen and never clipped into the face',()=>{
 const station={id:'seat',bubbleVisible:true,bubbleRect:[80,70,40,18],headAnchor:[100,110],scale:.5};
 const result=screenSafeBubbleLayout([station],[[72,70,56,30]],[0,0,300,200],1).get('seat');assert.equal(result.changed,true);assert.equal(result.clear,true);assert.ok(result.rect[1]+result.rect[3]<=70);assert.ok(result.rect[1]+result.rect[3]<110);
});
test('already clear overhead bubble stays in original location',()=>{
 const station={id:'seat',bubbleVisible:true,bubbleRect:[80,20,40,18],headAnchor:[100,60],scale:.5};const result=screenSafeBubbleLayout([station],[[72,90,56,30]],[0,0,300,200],1).get('seat');assert.equal(result.changed,false);assert.deepEqual(result.rect,station.bubbleRect);
});
