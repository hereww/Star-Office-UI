import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { validateLayout, stationBounds, rectanglesOverlap } from '../frontend/company-office/runtime.mjs';
import { SeatedOfficePlayer, BUSINESS_STATES } from '../frontend/company-office/seated-compositor.mjs';

const layout = JSON.parse(readFileSync(new URL('../frontend/company-office/map-layout.json', import.meta.url)));
const config = JSON.parse(readFileSync(new URL('../frontend/company-office/office-assets.json', import.meta.url)));
const integration = JSON.parse(readFileSync(new URL('../frontend/company-office/integration.json', import.meta.url)));
assert.equal(validateLayout(layout), layout);
const historical = JSON.parse(readFileSync(new URL('../frontend/company-office/map-layout-v1.json', import.meta.url)));
assert.equal(validateLayout(historical), historical);
assert.equal(historical.stations.length, 6);
assert.deepEqual(layout.size, [2048,2816]);
assert.equal(layout.stations.length, 36);
assert.equal(layout.stations.filter(s=>s.kind==='open').length, 33);
assert.equal(layout.stations.filter(s=>s.kind==='private').length, 3);
assert.equal(layout.rooms.length, 8);
assert.deepEqual(Object.values(layout.openSeatGroups), [8,8,8,6,3]);
assert.ok(existsSync(new URL('../frontend/company-office/' + layout.background, import.meta.url)));
assert.throws(()=>validateLayout({...layout,size:[NaN,720]}));
assert.throws(()=>validateLayout({...layout,mainStation:'missing'}));
assert.throws(()=>validateLayout({...layout,stations:layout.stations.map((s,i)=>i===0?{...s,center:[1108,400]}:s)}),/叠墙/);
assert.throws(()=>validateLayout({...layout,stations:layout.stations.map((s,i)=>i===0?{...s,center:[940,2000]}:s)}),/主通道/);
assert.throws(()=>validateLayout({...layout,stations:layout.stations.slice(1)}),/工位数/);
assert.throws(()=>validateLayout({...layout,stations:layout.stations.map((s,i)=>i===0?{...s,center:layout.stations[1].center}:s)}),/重叠/);
assert.throws(()=>validateLayout({...layout,stations:layout.stations.map((s,i)=>i===0?{...s,direction:'left'}:s)}));
for (let i=0;i<layout.outline.length;i++) {
  const a=layout.outline[i],b=layout.outline[(i+1)%layout.outline.length];
  assert.ok(a[0]===b[0] || a[1]===b[1], 'Outline only allows cardinal edges');
}
for(const [x1,y1,x2,y2] of layout.walls) assert.ok(x1===x2 || y1===y2);
for(const points of Object.values(layout.guestSlots)) for(const [x,y] of points) for(const station of layout.stations) assert.equal(rectanglesOverlap([x-40,y-80,80,80],stationBounds(station)),false,'Standing visitor must not overlap any 192px desk field');
assert.throws(() => validateLayout({ ...layout, directionRule: 'isometric' }));
assert.throws(() => validateLayout({ ...layout, stations: [...layout.stations, layout.stations[0]] }));
assert.deepEqual(Object.keys(BUSINESS_STATES), ['idle', 'writing', 'researching', 'executing', 'syncing', 'error']);
assert.deepEqual(config.businessStateToAction, BUSINESS_STATES);

for (const [path, expected] of Object.entries(integration.sourceHashes)) {
  const file = new URL(`../${integration.sourceTemplate}/${path}`, import.meta.url);
  assert.equal(createHash('sha256').update(readFileSync(file)).digest('hex'), expected, `Frozen source changed: ${path}`);
}
for (const path of [config.character.base, config.workstation.front, config.workstation.back, ...Object.values(config.character.actions).map(a => a.frames)]) {
  const copiedPath = new URL(`../frontend/company-office/${path}`, import.meta.url);
  assert.ok(existsSync(copiedPath), `Runtime asset missing: ${path}`);
  if (!path.includes('frames-') && !path.includes('character-breeds/')) {
    const copied = readFileSync(copiedPath);
    const approved = readFileSync(new URL(`../${integration.sourceTemplate}/${path}`, import.meta.url));
    assert.equal(Buffer.compare(copied, approved), 0, `Runtime copy differs: ${path}`);
  }
}

// Deterministic draw contract independent of Phaser, with no fake image rendering.
// Actual per-pixel assertions are exercised in the browser QA and saved in qa-report.json.
const calls = [];
const ctx = { clearRect(){}, drawImage(...args){ calls.push(args); }, save(){}, beginPath(){}, ellipse(){}, clip(){}, restore(){} };
const player = new SeatedOfficePlayer({ getContext: () => ctx }, config);
player.images = Object.fromEntries(['back', 'front', 'base', 'working', 'idle', 'syncing', 'error'].map(k => [k, { id: k }]));
player.view = 'character';
let frames = 0;
for (const state of Object.keys(BUSINESS_STATES)) {
  player.setState(state);
  for (let frame = 0; frame < 12; frame++) {
    calls.length = 0;
    player.setFrame(frame);
    assert.equal(calls.length, 1, 'Only one complete actor frame draw, no keyboard hands');
    assert.equal(calls[0][0].id, BUSINESS_STATES[state]);
    assert.equal(player.faceFrame, frame);
    frames++;
  }
}
player.setState('error'); player.sample(1083.34); assert.equal(player.faceFrame, player.frame);
player.setState('idle'); player.sample(1083.34); assert.equal(player.faceFrame, player.frame);
player.sample(3083.34); assert.equal(player.faceFrame, player.frame);
player.setState('writing'); player.sample(2000); assert.equal(player.faceFrame, player.frame);
player.sample(5083.34); assert.equal(player.faceFrame, player.frame);
assert.throws(() => player.setState('new-business-state'));
assert.throws(() => player.setFrame(12));
console.log(JSON.stringify({ result:'pass', states:6, deterministicFrames:frames, frozenFiles:Object.keys(integration.sourceHashes).length, runtimeCopies:'unchanged', cardinalStations:36, openSeats:33, privateSeats:3, fallbackSeats:6, sourceRoomCount:8 }, null, 2));
