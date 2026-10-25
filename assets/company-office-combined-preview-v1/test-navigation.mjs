import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { OfficeNavigator, moveAlong, directionBetween, stationDock, stationFootprint } from './navigation.mjs';
const root = new URL('../../', import.meta.url);
const read = path => JSON.parse(readFileSync(new URL(path, root)));
const layout = read('frontend/company-office/map-layout.json');
const config = JSON.parse(readFileSync(new URL('./scene.json', import.meta.url)));
const baseline = JSON.parse(readFileSync(new URL('./baseline-hashes.json', import.meta.url)));
const nav = new OfficeNavigator(layout, config.obstacles, { radius: config.walking.footRadius });
let frozenFiles = 0;
for (const [path, expected] of Object.entries(baseline)) {
  assert.equal(createHash('sha256').update(readFileSync(new URL(path, root))).digest('hex'), expected, `Existing source changed: ${path}`); frozenFiles++;
}
const officeTemplate = read('.agents/skills/star-office-character-animation/assets/approved-office-expressions-v1/template-manifest.json');
for (const file of officeTemplate.files) {
  const path = new URL('.agents/skills/star-office-character-animation/assets/approved-office-expressions-v1/' + file.path, root);
  assert.equal(createHash('sha256').update(readFileSync(path)).digest('hex'), file.sha256);
}
const walkTemplate = read('.agents/skills/star-office-character-animation/assets/approved-walk-directions-v1/template-manifest.json');
for (const [direction, action] of Object.entries(walkTemplate.directions)) {
  assert.equal(action.files.length, 2); assert.equal(config.walking.full12FrameCycle, false);
  for (const file of action.files) assert.equal(createHash('sha256').update(readFileSync(new URL('.agents/skills/star-office-character-animation/assets/approved-walk-directions-v1/' + file.file, root))).digest('hex'), file.sha256);
}
assert.equal(layout.stations.length, 36); assert.equal(nav.radius, 18); assert.equal(nav.step, 16);
assert.throws(() => directionBetween([0,0],[1,1]), /斜向/);
assert.throws(() => moveAlong([0,0], [[100,100]], 10), /斜向/);
assert.equal(nav.isWalkable([0,0]), false); assert.equal(nav.isWalkable([NaN,0]), false);
for (const station of layout.stations) {
  const [x,y,w,h] = stationFootprint(station);
  assert.equal(nav.isWalkable([x+w/2,y+h/2]), false, 'Furniture is blocked');
}
let stationRoutes = 0, checkedSegments = 0, walkSamples = 0, offGridReroutes = 0;
for (const from of layout.stations) for (const to of layout.stations) {
  const start = nav.dock(from), goal = nav.dock(to), route = nav.route(start, goal);
  assert.ok(start && goal && route, `${from.id} -> ${to.id} unreachable`); stationRoutes++;
  assert.deepEqual(route[0], start); assert.deepEqual(route.at(-1), goal);
  for (let i=1; i<route.length; i++) { assert.ok(nav.segmentClear(route[i-1], route[i]), `${from.id} -> ${to.id} crosses obstacle`); checkedSegments++; }
  // Sample the actual locomotion solver with several non-divisor budgets.
  let point=start, remaining=route.slice(1), guard=0;
  while (remaining.length) {
    const before=point, oldPath=remaining;
    const result=moveAlong(point,remaining,[13.37,27.4,16][guard%3]);
    point=result.position;remaining=result.path;
    assert.ok(nav.isWalkable(point));assert.ok(result.traveled<=27.400001);
    assert.ok(result.traveled===0 || ['up','down','left','right'].includes(result.direction)); walkSamples++;
    if (++guard>5000) throw new Error('Route failed to terminate');
    if (guard===2 && (point[0]%16 || point[1]%16)) {
      const reroute=nav.route(point,goal);assert.ok(reroute);assert.deepEqual(reroute[0],point);offGridReroutes++;
    }
  }
  assert.deepEqual(point,goal);
}
const home = nav.dock(layout.stations.find(station => station.id===layout.mainStation));
let destinationRoutes=0;
for (const destination of config.destinations.filter(d=>d.point)) {
  const path=nav.route(home,destination.point);assert.ok(path, destination.id);
  for(let i=1;i<path.length;i++)assert.ok(nav.segmentClear(path[i-1],path[i]));destinationRoutes++;
}
const mappedOffice=read('frontend/company-office/office-assets.json');
assert.equal(mappedOffice.frameCount,12);assert.equal(mappedOffice.fps,12);assert.equal(mappedOffice.animationMode,'expression-only');
const result={passed:true,date:'2026-10-02',mapSize:layout.size,stationCount:36,stationRoutes,checkedSegments,walkSamples,offGridReroutes,destinationRoutes,footRadius:18,gridStep:16,unchangedBaselineFiles:frozenFiles,frozenTemplatesVerified:true,officeFrameCount:12,walkingFramesPerDirection:2,full12FrameWalkAvailable:false,productionModified:false};
writeFileSync(new URL('./navigation-qa.json',import.meta.url),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
