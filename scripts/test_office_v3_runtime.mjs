import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { ReferenceOfficeRuntime, validateReferenceLayout, occupiedBounds, overlaps, STATE_LABELS } from '../frontend/company-office/reference-v3/runtime.mjs';
import { BUSINESS_STATES, validateDirectionalAssets } from '../frontend/company-office/reference-v3/directional-player.mjs';

// Independent, read-only runtime contract tests. No Phaser create/load, browser, real
// Image, fetch, generated v3 assets or third-party packages are used. Failures are
// deliberately not marked TODO: report contract defects to the main owner, do not
// patch runtime/player/UI/JSON from this sidecar.
const root = new URL('../', import.meta.url);
const baseUrl = new URL('../frontend/company-office/reference-v3/', import.meta.url).href;
const runtimePath = new URL('frontend/company-office/reference-v3/runtime.mjs', root);
const layoutPath = new URL('frontend/company-office/reference-v3/layout.json', root);
const layout = JSON.parse(readFileSync(layoutPath, 'utf8'));
const originalAssets = JSON.parse(readFileSync(new URL('frontend/company-office/office-assets.json', root), 'utf8'));
const STATES = Object.keys(BUSINESS_STATES);
const DIRECTIONS = ['up', 'down', 'left', 'right'];
const CLOCKS = { working: 60, idle: 36, syncing: 60, error: 12 };
const sourceHashes = {
  runtime: createHash('sha256').update(readFileSync(runtimePath)).digest('hex'),
  layout: createHash('sha256').update(readFileSync(layoutPath)).digest('hex'),
};
const copy = value => structuredClone(value);

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

// Keep this local rather than importing a node:test entry point and accidentally
// executing the separate player suite. Same four-direction fixture contract.
function assetFixture() {
  const assets = copy(originalAssets);
  assets.directions = {};
  for (const direction of DIRECTIONS) {
    const character = copy(originalAssets.character);
    character.id = `runtime-fixture-${direction}`;
    character.direction = direction;
    character.base = direction === 'down' ? '../media/character-base.png' : `fixture/${direction}/body.png`;
    character.faceVisible = direction !== 'up';
    character.headAnchor = [100, 101];
    if (direction === 'left') {
      character.poseAnchor = [92, 168];
      character.headAnchor = [80, 101];
    } else if (direction === 'right') {
      character.poseAnchor = [104, 172];
      character.headAnchor = [108, 101];
    }
    character.actions = Object.fromEntries(Object.entries(CLOCKS).map(([action, clock]) => [action,
      { ...character.actions[action], frames: `fixture/${direction}/frames-${action}.png`, frameCount: 12, fps: 12, clockFrames: clock },
    ]));
    delete character.faceRect;
    delete character.faceClipEllipse;
    delete character.faceFrameSize;
    delete character.pixelFaceAnimation;
    character.animationMode = 'full-frame';
    assets.directions[direction] = {
      character,
      furniture: {
        direction, size: [192, 192], seatAnchor: [96, 94],
        back: `fixture/${direction}/back.png`, front: `fixture/${direction}/front.png`,
        order: ['back', 'actor', 'front', 'screen'],
        screen: { visible: direction !== 'up', polygon: [[60, 114], [130, 119], [121, 158], [66, 155]], led: [128, 160, 3, 2] },
      },
    };
  }
  validateDirectionalAssets(assets);
  return assets;
}

function recordedGraphics() {
  const graphics = { calls: [] };
  for (const name of ['clear', 'fillStyle', 'lineStyle', 'fillRoundedRect', 'fillTriangle', 'strokeRoundedRect', 'setDepth']) {
    graphics[name] = (...args) => { graphics.calls.push({ name, args }); return graphics; };
  }
  return graphics;
}

function recordedText() {
  return {
    text: '', width: 0, height: 11, x: 0, y: 0, calls: [],
    setText(text) {
      assert.equal(typeof text, 'string');
      this.text = text;
      const lines = text.split('\n');
      this.width = Math.max(...lines.map(line => line.length)) * 6;
      this.height = lines.length * 11;
      this.calls.push({ name: 'setText', args: [text] });
      return this;
    },
    setFontSize(value) { this.calls.push({ name: 'setFontSize', args: [value] }); return this; },
    setPosition(x, y) { this.x = x; this.y = y; this.calls.push({ name: 'setPosition', args: [x, y] }); return this; },
  };
}

function recordedCanvas(id) {
  const calls = [], ctx = {
    clearRect: (...args) => calls.push({ name: 'clearRect', args }),
    drawImage: (image, ...args) => calls.push({ name: 'drawImage', id: image.id, args }),
  };
  for (const method of ['rotate', 'scale', 'transform', 'setTransform', 'translate']) {
    ctx[method] = () => assert.fail(`No runtime body/canvas transform allowed: ${method}`);
  }
  return { id, width: 192, height: 192, calls, getContext: type => { assert.equal(type, '2d'); return ctx; } };
}

class FakePlayer {
  constructor(id, assets, direction) {
    this.id = id;
    this.assets = assets;
    this.direction = direction;
    this.spec = assets.directions[direction];
    this.state = 'idle';
    this.elapsed = 0;
    this.tick = 0;
    this.frame = 0;
    this.faceFrame = 0;
    this.reducedMotion = false;
    this.stateCalls = [];
    this.directionCalls = [];
    this.sampleCalls = [];
    this.canvas = recordedCanvas(id);
    this._drawKey = null;
    this._directionRequest = 0;
  }
  setState(state) {
    assert.ok(Object.hasOwn(BUSINESS_STATES, state));
    this.stateCalls.push(state);
    if (state === this.state) return false;
    this.state = state;
    this.elapsed = this.tick = this.frame = this.faceFrame = 0;
    this._drawKey = null;
    return true;
  }
  async setDirection(direction) {
    this.directionCalls.push(direction);
    assert.ok(this.assets.directions[direction], `Missing fake assets: ${direction}`);
    const request = ++this._directionRequest;
    if (this.failDirection) throw new Error('fixture direction image missing');
    if (this.directionGate) await this.directionGate.promise;
    if (request !== this._directionRequest) return this;
    this.direction = direction;
    this.spec = this.assets.directions[direction];
    this._drawKey = null;
    return this;
  }
  bodyPlacement() {
    const c = this.spec.character, [sx, sy] = this.spec.furniture.seatAnchor;
    return [sx - c.poseAnchor[0] * c.scale, sy - c.poseAnchor[1] * c.scale, 192 * c.scale, 192 * c.scale];
  }
  sample(ms) {
    assert.ok(Number.isFinite(ms) && ms >= 0);
    this.sampleCalls.push(ms);
    this.elapsed = ms;
    this.tick = Math.floor(ms * 12 / 1000);
    this.frame = this.tick % 12;
    const faceTick = this.tick % CLOCKS[BUSINESS_STATES[this.state]];
    this.faceFrame = faceTick < 12 ? faceTick : 0;
    const key = `${this.state}:${this.direction}:${this.faceFrame}`;
    if (key === this._drawKey || this.holdRedraw) return false;
    this._drawKey = key;
    const ctx = this.canvas.getContext('2d');
    ctx.clearRect(0, 0, 192, 192);
    ctx.drawImage({ id: `${this.id}:${this.direction}:body` }, ...this.bodyPlacement());
    return true;
  }
  snapshot() {
    return {
      direction: this.direction, state: this.state, action: BUSINESS_STATES[this.state],
      frame: this.frame, faceFrame: this.faceFrame, clock: CLOCKS[BUSINESS_STATES[this.state]],
      sampleMs: this.elapsed, tick: this.tick, bodyPlacement: this.bodyPlacement(),
      bodyFixed: true, handsRendered: false, reducedMotion: this.reducedMotion,
    };
  }
}

function recordedCamera() {
  return {
    width: 1024, height: 768, zoom: 1, center: [512, 384],
    worldView: { x: 0, y: 0, width: 1024, height: 768 }, calls: [],
    setBackgroundColor(color) { this.calls.push({ name: 'setBackgroundColor', args: [color] }); return this; },
    setBounds(...bounds) { this.bounds = bounds; this.calls.push({ name: 'setBounds', args: bounds }); return this; },
    setZoom(zoom) { this.zoom = zoom; this.calls.push({ name: 'setZoom', args: [zoom] }); return this; },
    centerOn(x, y) {
      this.center = [x, y];
      this.worldView = { x: x - this.width / this.zoom / 2, y: y - this.height / this.zoom / 2,
        width: this.width / this.zoom, height: this.height / this.zoom };
      this.calls.push({ name: 'centerOn', args: [x, y] });
      return this;
    },
  };
}

function installEnvironment(t, reducedMotion = false) {
  const original = new Map();
  const nodes = new Map(['overview', 'workstation'].map(view => [`office-view-${view}`, {
    attributes: {}, setAttribute(name, value) { this.attributes[name] = value; },
  }]));
  class MockCustomEvent extends Event {
    constructor(type, options = {}) { super(type); this.detail = options.detail; }
  }
  class MockWindow extends EventTarget {
    events = [];
    dispatchEvent(event) {
      assert.ok(event instanceof MockCustomEvent);
      this.events.push({ type: event.type, detail: event.detail });
      return super.dispatchEvent(event);
    }
  }
  const window = new MockWindow(), query = { matches: reducedMotion, addEventListener() {}, removeEventListener() {} };
  const replacement = {
    window, CustomEvent: MockCustomEvent,
    matchMedia: value => { assert.equal(value, '(prefers-reduced-motion: reduce)'); return query; },
    document: {
      getElementById: id => nodes.get(id) ?? null,
      createElement: type => { assert.equal(type, 'canvas'); return recordedCanvas('document'); },
    },
    Image: class { constructor() { assert.fail('Runtime sidecar must not load real/generated image resources'); } },
    fetch: () => assert.fail('Runtime sidecar must not fetch from a service'),
  };
  for (const [key, value] of Object.entries(replacement)) {
    original.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  }
  t.after(() => {
    for (const [key, descriptor] of original) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  return { window, nodes, query };
}

function setup(t, { now = 1000, reducedMotion = false, layoutSpec = layout } = {}) {
  const env = installEnvironment(t, reducedMotion);
  const assets = deepFreeze(assetFixture()), inputLayout = deepFreeze(copy(layoutSpec));
  const runtime = new ReferenceOfficeRuntime(inputLayout, assets, baseUrl);
  const camera = recordedCamera();
  // No scene.add, scene.load or textures.addCanvas exists: accidentally calling
  // Phaser create/preload/load would fail instead of silently being simulated.
  runtime.scene = { time: { now }, cameras: { main: camera } };
  runtime.selection = recordedGraphics();
  runtime.serverWarning = recordedGraphics();
  runtime.serverLabel = recordedText().setText('设备间 · 待命');
  runtime.serverLights = [0, 1, 2].map(() => ({ calls: [], setFillStyle(...args) { this.calls.push(args); return this; } }));
  for (const station of runtime.stations) {
    station.player = new FakePlayer(station.id, assets, station.direction);
    station.player.reducedMotion = reducedMotion;
    station.texture = { refreshes: 0, refresh() { this.refreshes++; return this; } };
    station.sprite = { x: station.center[0] - 96 * station.scale, y: station.center[1] - 96 * station.scale,
      rotation: 0, flipX: false, flipY: false, scaleX: station.scale, scaleY: station.scale };
    for (const method of ['setRotation', 'setAngle', 'setFlipX', 'setFlipY']) {
      station.sprite[method] = () => assert.fail(`Directions must not transform the existing sprite: ${method}`);
    }
    station.bubbleText = recordedText();
    station.bubbleBackground = recordedGraphics();
    runtime.refreshAnchor(station);
    runtime.refreshBubble(station);
  }
  runtime.ready = true;
  runtime.refreshMain();
  runtime.applyView();
  env.window.events.length = 0;
  return { runtime, camera, assets, inputLayout, ...env };
}

function stationData(station) {
  return copy({
    id: station.id, name: station.name, role: station.role, region: station.region,
    state: station.state, detail: station.detail, source: station.source, bound: station.bound,
    agentId: station.agentId, actual: station.actual, epoch: station.epoch, direction: station.direction,
    center: station.center, scale: station.scale, headAnchor: station.headAnchor, bubbleAnchor: station.bubbleAnchor,
    player: station.player.snapshot(), stateCalls: station.player.stateCalls,
    textureRefreshes: station.texture.refreshes,
  });
}

function otherSeats(runtime, except) {
  return runtime.stations.filter(s => s.id !== except).map(stationData);
}

// Binding invariants unrelated to reserving the main AI seat use a second valid
// layout fixture with a colleague main. This isolates those regressions instead
// of letting a main-slot-allocation defect contaminate every remote-agent test.
function colleagueMainLayout() {
  const value = copy(layout);
  value.mainStation = value.stations.find(s => s.role === 'colleague' && s.direction === 'down')?.id ??
    value.stations.find(s => s.role === 'colleague').id;
  validateReferenceLayout(value);
  return value;
}

function remoteAiSlotIds(runtime) {
  return runtime.stations.filter(s => s.role === 'ai' && s.id !== runtime.layout.mainStation).map(s => s.id);
}

function bindingMap(runtime) {
  return Object.fromEntries(runtime.stations.filter(s => s.actual.bound).map(s => [s.actual.agentId, s.id]));
}

function assertBound(station, id, state) {
  assert.equal(station.actual.agentId, id);
  assert.equal(station.actual.bound, true);
  assert.equal(station.actual.source, 'live');
  assert.equal(station.actual.state, state);
  assert.equal(station.agentId, id);
  assert.equal(station.bound, true);
  assert.equal(station.source, 'live');
  assert.equal(station.state, state);
  assert.equal(station.player.state, state);
}

function assertUnbound(runtime, id) {
  const station = runtime.getStation(id), spec = runtime.layout.stations.find(s => s.id === id);
  assert.equal(station.name, spec.name);
  assert.equal(station.state, 'idle');
  assert.equal(station.source, 'unbound');
  assert.equal(station.bound, false);
  assert.equal(station.agentId, null);
  assert.equal(station.actual.agentId, null);
  assert.equal(station.actual.state, 'idle');
  assert.equal(station.actual.source, 'unbound');
  assert.match(station.bubbleText.text, /未绑定/);
}

function assertChangeEvents(window, runtime, count) {
  assert.equal(window.events.length, count);
  for (const event of window.events) {
    assert.equal(event.type, 'office-runtime-change');
    assert.equal(event.detail, runtime);
  }
}

function agent(agentId, state = 'writing', extra = {}) {
  return { agentId, name: `真实-${agentId}`, state, detail: `实际任务-${agentId}`, authStatus: 'approved', ...extra };
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function layoutRejected(title, mutate) {
  test(title, () => {
    const invalid = copy(layout);
    mutate(invalid);
    assert.throws(() => validateReferenceLayout(invalid), undefined, `${title}: invalid configuration must be rejected`);
  });
}

test('source provenance and layout validation are read-only; assets fixture is complete in all four directions', t => {
  t.diagnostic(`Read-only source SHA-256: ${JSON.stringify(sourceHashes)}`);
  const frozen = deepFreeze(copy(layout));
  assert.equal(validateReferenceLayout(frozen), frozen);
  const assets = deepFreeze(assetFixture());
  assert.equal(validateDirectionalAssets(assets), assets);
  assert.deepEqual(Object.keys(assets.directions).sort(), [...DIRECTIONS].sort());
  for (const direction of DIRECTIONS) assert.equal(assets.directions[direction].character.direction, direction);
  assert.equal(assets.directions.up.character.faceVisible, false);
});

test('constructor and snapshot expose exactly sixteen independent seats, red 8 + green 8, six colleagues + two AI each', t => {
  const { runtime, inputLayout, assets, window } = setup(t);
  assert.equal(runtime.stations.length, 16);
  assert.deepEqual(Object.fromEntries(['west', 'east'].map(region => [region, runtime.stations.filter(s => s.region === region).length])), { west: 8, east: 8 });
  for (const region of ['west', 'east']) {
    assert.equal(runtime.stations.filter(s => s.region === region && s.role === 'ai').length, 2);
    assert.equal(runtime.stations.filter(s => s.region === region && s.role === 'colleague').length, 6);
  }
  assert.deepEqual([...new Set(runtime.stations.map(s => s.direction))].sort(), [...DIRECTIONS].sort());
  assert.equal(new Set(runtime.stations.map(s => s.player)).size, 16);
  assert.equal(new Set(runtime.stations.map(s => s.player.canvas)).size, 16);
  assert.equal(new Set(runtime.stations.map(s => s.bubbleText)).size, 16);
  assert.equal(new Set(runtime.stations.map(s => s.actual)).size, 16);
  const main = runtime.getStation(runtime.layout.mainStation), snapshot = runtime.snapshot();
  assert.equal(snapshot.player.state, main.state);
  assert.equal(runtime.player, main.player);
  assert.equal(snapshot.stations.length, 16);
  assert.equal(snapshot.stations.filter(s => s.selected).length, 1);
  assert.equal(snapshot.activeStation, snapshot.mainStation);
  assert.equal(snapshot.walkIntegrated, false);
  assert.equal(snapshot.openSeatCount, 16);
  assert.equal(snapshot.privateSeatCount, 0);
  assert.equal(snapshot.demoMode, false);
  assert.equal(snapshot.animationMode, 'full-frame');
  assert.deepEqual(snapshot.mapSize, layout.size);
  assert.equal(main.actual.agentId, 'main');
  assert.equal(main.bound, true);
  assert.equal(main.source, 'live');
  for (const station of runtime.stations) {
    assert.equal(station.state, 'idle');
    assert.equal(station.player.snapshot().bodyFixed, true);
    assert.equal(station.player.snapshot().handsRendered, false);
    if (station.id !== main.id) assertUnbound(runtime, station.id);
  }
  assert.notEqual(runtime.layout, inputLayout);
  assert.notEqual(runtime.assets, assets);
  runtime.layout.views.overview.center[0]++;
  runtime.assets.directions.down.character.poseAnchor[0]++;
  assert.deepEqual(inputLayout, layout);
  assert.deepEqual(assets.directions.down.character.poseAnchor, originalAssets.character.poseAnchor);
  assertChangeEvents(window, runtime, 0);
});

layoutRejected('layout rejects a seventeenth seat (no extra row by the meeting wall)', l => l.stations.push({ ...copy(l.stations[0]), id: 'desk-17' }));
layoutRejected('layout rejects missing seats rather than silently showing fewer than sixteen', l => l.stations.pop());
layoutRejected('layout rejects duplicate seat IDs', l => { l.stations[1].id = l.stations[0].id; });
layoutRejected('layout rejects a missing main station', l => { l.mainStation = 'absent-main'; });
layoutRejected('layout rejects a 9/7 split even if the total is still sixteen', l => { l.stations.find(s => s.region === 'west').region = 'east'; });
layoutRejected('layout rejects noncardinal directions', l => { l.stations[0].direction = 'down-right'; });
layoutRejected('layout rejects integrated walking', l => { l.walkIntegrated = true; });
layoutRejected('layout rejects invalid dimensions', l => { l.size[0] = NaN; });
layoutRejected('layout rejects two overlapping furniture envelopes', l => { l.stations[1].center = [...l.stations[0].center]; });
layoutRejected('layout rejects station furniture beyond the map', l => { l.stations[0].center = [-500, -500]; });
layoutRejected('layout rejects station furniture in a forbidden room/doorway', l => {
  const [x, y, w, h] = l.forbidden[0].bounds;
  l.stations[0].center = [x + w / 2, y + h / 2];
});

// Bounds must be checked against the map, not just finiteRect(). These cases use
// a non-equipment room so a server containment error cannot hide the room defect.
for (const edge of ['left', 'top', 'right', 'bottom']) {
  layoutRejected(`layout rejects a room beyond the map ${edge} edge`, l => {
    const room = l.rooms.find(r => r.id !== 'equipment');
    if (edge === 'left') room.bounds[0] = -10;
    if (edge === 'top') room.bounds[1] = -10;
    if (edge === 'right') room.bounds[0] = l.size[0] - room.bounds[2] + 1;
    if (edge === 'bottom') room.bounds[1] = l.size[1] - room.bounds[3] + 1;
  });
}
layoutRejected('layout rejects nonfinite room rectangles', l => { l.rooms[0].bounds[2] = NaN; });
layoutRejected('layout rejects a server outside the equipment room', l => { l.server.bounds[0] = 0; });
layoutRejected('layout rejects invalid server rectangle size', l => { l.server.bounds[2] = 0; });
layoutRejected('layout rejects a server without an equipment room', l => { l.rooms = l.rooms.filter(r => r.id !== 'equipment'); });
layoutRejected('layout rejects a server beyond the map even if its equipment room also moved there', l => {
  const equipment = l.rooms.find(r => r.id === 'equipment');
  equipment.bounds[0] += l.size[0];
  l.server.bounds[0] += l.size[0];
});
for (const edge of ['left', 'right', 'top', 'bottom']) {
  layoutRejected(`layout rejects a server indicator beyond the map ${edge} edge`, l => {
    l.server.indicator = [...l.server.indicator];
    const index = edge === 'left' || edge === 'right' ? 0 : 1;
    l.server.indicator[index] = edge === 'left' || edge === 'top' ? -1 : l.size[index] + 1;
  });
}

test('occupiedBounds applies fixed scale/anchors, and touching boundaries are not furniture overlap', () => {
  const station = { center: [100, 150], scale: 0.5, occupied: [28, 30, 146, 144] };
  assert.deepEqual(occupiedBounds(station), [66, 117, 73, 72]);
  assert.equal(overlaps([0, 0, 10, 10], [10, 0, 10, 10]), false);
  assert.equal(overlaps([0, 0, 10, 10], [9.99, 0, 10, 10]), true);
  for (let i = 0; i < layout.stations.length; i++) {
    for (let j = i + 1; j < layout.stations.length; j++) {
      assert.equal(overlaps(occupiedBounds(layout.stations[i]), occupiedBounds(layout.stations[j])), false);
    }
  }
});

test('non-demo refuses every manual station-state mutation including source=live/unbound bypass attempts', t => {
  const { runtime, window } = setup(t), before = runtime.stations.map(stationData);
  for (const station of runtime.stations) {
    for (const state of STATES) {
      assert.throws(() => runtime.setStationState(station.id, state), /演示/);
      assert.throws(() => runtime.setStationState(station.id, state, { source: 'live' }), /演示/);
      assert.throws(() => runtime.setStationState(station.id, state, { source: 'unbound' }), /演示/);
    }
  }
  assert.deepEqual(runtime.stations.map(stationData), before);
  assertChangeEvents(window, runtime, 0);
});

test('demo explicitly labels all sixteen seats and allows independent manual states without altering actual bindings', t => {
  const { runtime, window } = setup(t), actual = runtime.stations.map(s => copy(s.actual));
  runtime.setDemoMode(true);
  assert.equal(runtime.demoMode, true);
  for (const [index, station] of runtime.stations.entries()) {
    assert.equal(station.source, 'demo');
    assert.equal(station.bound, false);
    assert.equal(station.agentId, null);
    assert.equal(station.state, STATES[index % STATES.length]);
    assert.match(station.bubbleText.text, /演示·/);
    assert.equal(station.detail, '本地演示，不提交后端');
  }
  assert.deepEqual(runtime.stations.map(s => s.actual), actual);
  assertChangeEvents(window, runtime, 1);
  for (const station of runtime.stations) {
    for (const state of STATES) {
      runtime.scene.time.now += 19;
      const others = otherSeats(runtime, station.id);
      runtime.setStationState(station.id, state, { detail: `演示:${station.id}/${state}` });
      assert.equal(station.state, state);
      assert.equal(station.player.state, state);
      assert.equal(station.source, 'demo');
      assert.deepEqual(otherSeats(runtime, station.id), others, `Manual demo state leaked from ${station.id}`);
    }
  }
  assert.deepEqual(runtime.stations.map(s => s.actual), actual);
  assert.equal(runtime.snapshot().stations.filter(s => s.selected).length, 1);
  const before = runtime.stations.map(stationData), eventCount = window.events.length;
  assert.throws(() => runtime.setStationState(runtime.layout.mainStation, 'working'));
  assert.throws(() => runtime.setStationState(runtime.layout.mainStation, 'writing', { source: 'live' }));
  assert.deepEqual(runtime.stations.map(stationData), before);
  assert.equal(window.events.length, eventCount);
});

test('demo toggle is idempotent; leaving demo restores live main and genuinely unbound other seats', t => {
  const { runtime, window } = setup(t);
  runtime.setMainStatus({ state: 'executing', detail: 'API实际任务' });
  runtime.setDemoMode(true);
  runtime.update(4500);
  const demo = runtime.stations.map(stationData), events = window.events.length;
  runtime.setDemoMode(true);
  assert.deepEqual(runtime.stations.map(stationData), demo);
  assert.equal(window.events.length, events);
  runtime.setDemoMode(false);
  const main = runtime.getStation(runtime.layout.mainStation);
  assert.equal(main.state, 'executing');
  assert.equal(main.detail, 'API实际任务');
  assert.equal(main.source, 'live');
  assert.equal(main.bound, true);
  for (const station of runtime.stations.filter(s => s !== main)) assertUnbound(runtime, station.id);
  const actual = runtime.stations.map(stationData), after = window.events.length;
  runtime.setDemoMode(false);
  assert.deepEqual(runtime.stations.map(stationData), actual);
  assert.equal(window.events.length, after);
  for (const invalid of ['true', 0, 1, null, undefined]) assert.throws(() => runtime.setDemoMode(invalid));
  assert.equal(runtime.demoMode, false);
});

test('API setState/setMainStatus affect only mainStation, not the selected seat or the other fifteen', t => {
  const { runtime, window } = setup(t);
  const main = runtime.getStation(runtime.layout.mainStation), selected = runtime.stations.find(s => s !== main);
  runtime.selectStation(selected.id, { focus: true });
  const rest = otherSeats(runtime, main.id);
  window.events.length = 0;
  for (const state of STATES) {
    runtime.scene.time.now += 130;
    runtime.setState(state);
    assert.equal(main.state, state);
    assert.equal(runtime.state, state);
    assert.equal(runtime.player, main.player);
    assert.equal(runtime.activeStation, selected.id);
    assert.equal(runtime.view, 'workstation');
    assert.deepEqual(otherSeats(runtime, main.id), rest);
    runtime.setMainStatus({ state, detail: `后端:${state}` });
    assert.equal(main.detail, `后端:${state}`);
    assert.equal(main.actual.detail, main.detail);
    assert.deepEqual(otherSeats(runtime, main.id), rest);
  }
  runtime.setMainStatus({ state: 'unknown', detail: 123 });
  assert.equal(main.state, 'idle');
  assert.equal(main.detail, '');
  runtime.setState('working');
  assert.equal(main.state, 'idle', 'working is an action, not a seventh business state');
  assert.deepEqual(otherSeats(runtime, main.id), rest);
  assert.ok(window.events.length > 0);
  for (const event of window.events) assert.equal(event.detail, runtime);
});

test('API continues updating actual during demo and leaving demo shows the latest state/detail, not the entry snapshot', t => {
  const { runtime, window } = setup(t);
  const main = runtime.getStation(runtime.layout.mainStation);
  runtime.setMainStatus({ state: 'writing', detail: '进入演示前' });
  runtime.setDemoMode(true);
  runtime.setStationState(main.id, 'idle', { detail: '人类选择的演示睡觉' });
  const displayed = runtime.stations.map(stationData);
  const events = window.events.length;
  runtime.setMainStatus({ state: 'error', detail: '演示中真实失败' });
  runtime.setState('syncing');
  runtime.setMainStatus({ state: 'executing', detail: '演示中最新实际任务' });
  assert.equal(main.actual.state, 'executing');
  assert.equal(main.actual.detail, '演示中最新实际任务');
  for (const [index, station] of runtime.stations.entries()) {
    const current = stationData(station), old = displayed[index];
    delete current.actual; delete old.actual;
    assert.deepEqual(current, old, 'Actual API data must not overwrite a displayed demo');
  }
  assert.equal(window.events.length, events, 'Invisible actual changes must not reset demo UI/players');
  runtime.scene.time.now = 9000;
  runtime.setDemoMode(false);
  assert.equal(main.state, 'executing');
  assert.equal(main.detail, '演示中最新实际任务');
  assert.equal(main.actual.state, main.state);
  assert.equal(main.source, 'live');
  assert.equal(main.bound, true);
  assert.equal(runtime.stateEpoch, 9000);
  assert.equal(runtime.state, 'executing');
  for (const station of runtime.stations.filter(s => s !== main)) assertUnbound(runtime, station.id);
});

test('same API business state, force flag and detail-only updates never restart a player or its station epoch', t => {
  const { runtime, window } = setup(t);
  const main = runtime.getStation(runtime.layout.mainStation);
  runtime.scene.time.now = 1200;
  runtime.setMainStatus({ state: 'writing', detail: 'first' });
  runtime.update(3900);
  const epoch = main.epoch, clock = main.player.snapshot(), calls = [...main.player.stateCalls], refreshes = main.texture.refreshes;
  window.events.length = 0;
  runtime.scene.time.now = 7000;
  runtime.setState('writing');
  runtime.setState('writing', true);
  runtime.setMainStatus({ state: 'writing', detail: 'first' });
  assert.equal(main.epoch, epoch);
  assert.equal(runtime.stateEpoch, epoch);
  assert.deepEqual(main.player.snapshot(), clock);
  assert.deepEqual(main.player.stateCalls, calls);
  assert.equal(main.texture.refreshes, refreshes);
  assertChangeEvents(window, runtime, 0);
  runtime.setMainStatus({ state: 'writing', detail: 'updated detail, same state' });
  assert.equal(main.epoch, epoch);
  assert.deepEqual(main.player.snapshot(), clock);
  assert.deepEqual(main.player.stateCalls, calls);
  assert.equal(main.texture.refreshes, refreshes);
  assertChangeEvents(window, runtime, 1);
});

test('same demo state (including changed detail) keeps clock/epoch, while writing->researching is a new business state', t => {
  const { runtime, window } = setup(t);
  runtime.setDemoMode(true);
  const target = runtime.stations[0];
  runtime.setStationState(target.id, 'writing', { detail: 'same' });
  runtime.update(2800);
  const before = stationData(target);
  window.events.length = 0;
  runtime.scene.time.now = 8000;
  runtime.setStationState(target.id, 'writing', { detail: 'same' });
  assert.deepEqual(stationData(target), before);
  assertChangeEvents(window, runtime, 0);
  runtime.setStationState(target.id, 'writing', { detail: 'new metadata' });
  assert.equal(target.epoch, before.epoch);
  assert.deepEqual(target.player.snapshot(), before.player);
  assert.deepEqual(target.player.stateCalls, before.stateCalls);
  const others = otherSeats(runtime, target.id);
  runtime.setStationState(target.id, 'researching');
  assert.equal(target.epoch, 8000);
  assert.equal(target.player.snapshot().action, 'working');
  assert.equal(target.player.snapshot().sampleMs, 0);
  assert.deepEqual(otherSeats(runtime, target.id), others);
});

test('update feeds sixteen independent elapsed clocks, refreshes only redrawn textures and emits no per-frame UI events', t => {
  const { runtime, window } = setup(t);
  runtime.setDemoMode(true);
  const first = runtime.stations[0], second = runtime.stations[1];
  runtime.scene.time.now = 1800; runtime.setStationState(first.id, 'error');
  runtime.scene.time.now = 2200; runtime.setStationState(second.id, 'syncing');
  window.events.length = 0;
  const refreshes = runtime.stations.map(s => s.texture.refreshes);
  runtime.update(5000);
  for (const [index, station] of runtime.stations.entries()) {
    assert.equal(station.player.sampleCalls.at(-1), Math.max(0, 5000 - station.epoch));
    assert.equal(station.player.elapsed, Math.max(0, 5000 - station.epoch));
    assert.equal(station.texture.refreshes, refreshes[index] + 1);
  }
  assert.notEqual(first.player.elapsed, second.player.elapsed);
  const firstPass = runtime.stations.map(s => s.texture.refreshes);
  runtime.update(5000);
  assert.deepEqual(runtime.stations.map(s => s.texture.refreshes), firstPass);
  runtime.stations.forEach(s => { s.player.holdRedraw = true; });
  runtime.update(9000);
  assert.deepEqual(runtime.stations.map(s => s.texture.refreshes), firstPass);
  assertChangeEvents(window, runtime, 0);
  runtime.ready = false;
  const samples = runtime.stations.map(s => s.player.sampleCalls.length);
  runtime.update(12000);
  assert.deepEqual(runtime.stations.map(s => s.player.sampleCalls.length), samples);
});

test('runtime can change any fixed seat through all four real player directions without changing state/clock/position', async t => {
  const { runtime, window } = setup(t);
  const target = runtime.stations.find(s => s.id !== runtime.layout.mainStation);
  runtime.setDemoMode(true);
  runtime.setStationState(target.id, 'error');
  runtime.update(4400);
  const center = [...target.center], epoch = target.epoch, sample = target.player.snapshot(), sprite = copy({
    x: target.sprite.x, y: target.sprite.y, scaleX: target.sprite.scaleX, scaleY: target.sprite.scaleY,
    rotation: target.sprite.rotation, flipX: target.sprite.flipX, flipY: target.sprite.flipY,
  });
  for (const direction of DIRECTIONS) {
    const others = otherSeats(runtime, target.id), resets = [...target.player.stateCalls];
    await runtime.setStationDirection(target.id, direction);
    assert.equal(target.direction, direction);
    assert.equal(target.player.direction, direction);
    assert.equal(target.player.spec.character.direction, direction);
    assert.equal(target.state, 'error');
    assert.equal(target.epoch, epoch);
    assert.equal(target.player.elapsed, sample.sampleMs);
    assert.equal(target.player.tick, sample.tick);
    assert.equal(target.player.faceFrame, sample.faceFrame);
    assert.deepEqual(target.player.stateCalls, resets);
    assert.deepEqual(target.center, center);
    assert.deepEqual({ x: target.sprite.x, y: target.sprite.y, scaleX: target.sprite.scaleX, scaleY: target.sprite.scaleY,
      rotation: target.sprite.rotation, flipX: target.sprite.flipX, flipY: target.sprite.flipY }, sprite);
    assert.deepEqual(otherSeats(runtime, target.id), others);
    const c = target.player.spec.character, [x, y] = target.player.bodyPlacement();
    assert.deepEqual(target.headAnchor, [center[0] - 96 * target.scale + (x + c.headAnchor[0] * c.scale) * target.scale,
      center[1] - 96 * target.scale + (y + c.headAnchor[1] * c.scale) * target.scale]);
    assert.deepEqual(target.bubbleAnchor, [target.headAnchor[0], target.headAnchor[1] - (target.bubbleText.height + 5) / 2 - 7]);
  }
  const before = stationData(target), count = window.events.length;
  target.player.failDirection = true;
  await assert.rejects(runtime.setStationDirection(target.id, 'down'), /fixture direction image missing/);
  assert.deepEqual(stationData(target), before);
  await assert.rejects(runtime.setStationDirection(target.id, 'diagonal'), /四方向/);
  await assert.rejects(runtime.setStationDirection('missing', 'up'), /工位不存在/);
  assert.equal(window.events.length, count);
});

test('runtime direction API waits for the fake load and does not half-change an active seat', async t => {
  const { runtime, window } = setup(t), target = runtime.stations[0];
  const before = stationData(target), gate = deferred(), events = window.events.length;
  target.player.directionGate = gate;
  const pending = runtime.setStationDirection(target.id, 'up');
  await Promise.resolve();
  assert.deepEqual(stationData(target), before);
  assert.equal(window.events.length, events);
  gate.resolve(); await pending;
  assert.equal(target.direction, 'up');
  assert.equal(target.player.direction, 'up');
  assert.equal(target.epoch, before.epoch);
});

test('syncAgents binds only approved non-main/non-demo agents, uses fixed AI slots, and never changes main', t => {
  const { runtime } = setup(t), main = runtime.getStation(runtime.layout.mainStation), before = stationData(main);
  const accepted = remoteAiSlotIds(runtime).map((_, i) => agent(String.fromCharCode(65 + i), ['writing', 'syncing', 'error', 'researching'][i]));
  const rejected = [null, {}, { agentId: 42, authStatus: 'approved' }, agent('main', 'error', { isMain: true }),
    agent('demo', 'error', { isDemo: true }), agent('pending', 'error', { authStatus: 'pending' })];
  runtime.syncAgents([...rejected, ...accepted]);
  assert.deepEqual(stationData(main), before);
  const mapping = bindingMap(runtime);
  assert.deepEqual(Object.values(mapping).filter(id => id !== main.id).sort(), remoteAiSlotIds(runtime).sort());
  for (const input of accepted) assertBound(runtime.getStation(mapping[input.agentId]), input.agentId, input.state);
  assert.deepEqual(runtime.unplacedAgents, []);
  assert.equal(runtime.remoteAgents.length, accepted.length);
  assert.deepEqual(runtime.remoteAgents.map(a => a.agentId), accepted.map(a => a.agentId));
  for (const station of runtime.stations.filter(s => s !== main && s.role !== 'ai')) assertUnbound(runtime, station.id);
});

test('syncAgents preserves an existing fixed binding under reordered polls and changed assignment hints', t => {
  const { runtime } = setup(t, { layoutSpec: colleagueMainLayout() });
  runtime.syncAgents([agent('A'), agent('B', 'syncing'), agent('C'), agent('D')]);
  const before = bindingMap(runtime), geometry = runtime.stations.map(s => [s.id, [...s.center], s.direction, [...s.bubbleAnchor]]);
  const next = [agent('D', 'error'), agent('B', 'executing'), agent('A', 'researching', { stationId: before.C }), agent('C', 'idle')];
  runtime.scene.time.now = 6000;
  runtime.syncAgents(next);
  assert.deepEqual(bindingMap(runtime), before, 'An already bound agent must not migrate with poll ordering or a new hint');
  for (const input of next) assertBound(runtime.getStation(before[input.agentId]), input.agentId, input.state);
  assert.deepEqual(runtime.stations.map(s => [s.id, [...s.center], s.direction, [...s.bubbleAnchor]]), geometry);
});

test('syncAgents same-state name/detail updates preserve that agent player clock and epoch', t => {
  const { runtime } = setup(t);
  runtime.syncAgents([agent('A', 'writing')]);
  const id = bindingMap(runtime).A, target = runtime.getStation(id);
  runtime.update(3600);
  const before = stationData(target);
  runtime.scene.time.now = 7100;
  runtime.syncAgents([agent('A', 'writing', { name: '新显示名', detail: '新任务描述' })]);
  assert.equal(target.name, '新显示名');
  assert.equal(target.detail, '新任务描述');
  assert.equal(target.epoch, before.epoch);
  assert.deepEqual(target.player.snapshot(), before.player);
  assert.deepEqual(target.player.stateCalls, before.stateCalls);
  assert.equal(target.texture.refreshes, before.textureRefreshes);
});

test('disappeared remote agents become unbound idle with their original seat names; surviving bindings do not move', t => {
  const { runtime } = setup(t, { layoutSpec: colleagueMainLayout() }), main = runtime.getStation(runtime.layout.mainStation);
  runtime.setMainStatus({ state: 'error', detail: '真实主任务' });
  runtime.syncAgents([agent('A'), agent('B', 'error'), agent('C', 'syncing'), agent('D', 'executing')]);
  const before = bindingMap(runtime), mainBefore = stationData(main);
  runtime.syncAgents([agent('C', 'syncing'), agent('A')]);
  assert.equal(bindingMap(runtime).A, before.A);
  assert.equal(bindingMap(runtime).C, before.C);
  assertUnbound(runtime, before.B);
  assertUnbound(runtime, before.D);
  assert.deepEqual(stationData(main), mainBefore);
  runtime.syncAgents([]);
  for (const id of remoteAiSlotIds(runtime)) assertUnbound(runtime, id);
  assert.deepEqual(stationData(main), mainBefore);
});

test('more unpinned agents than free seats are reported unplaced without covering existing occupied seats', t => {
  const { runtime } = setup(t, { layoutSpec: colleagueMainLayout() });
  runtime.syncAgents([agent('A'), agent('B'), agent('C'), agent('D')]);
  const fixed = bindingMap(runtime);
  runtime.syncAgents([agent('E', 'error'), agent('F', 'syncing'), agent('D'), agent('C'), agent('B'), agent('A')]);
  assert.deepEqual(bindingMap(runtime), fixed);
  assert.deepEqual(runtime.unplacedAgents.map(a => a.id).sort(), ['E', 'F']);
  runtime.syncAgents([agent('E'), agent('F'), agent('C'), agent('B'), agent('A')]);
  const next = bindingMap(runtime);
  assert.equal(next.A, fixed.A);
  assert.equal(next.B, fixed.B);
  assert.equal(next.C, fixed.C);
  assert.equal(next.E, fixed.D, 'Only the disappeared agent seat may be reused');
  assert.deepEqual(runtime.unplacedAgents.map(a => a.id), ['F']);
  assert.equal(runtime.stations.length, 16);
});

test('new hinted agent arriving first cannot evict a still-present fixed-seat agent when all AI slots are occupied', t => {
  const { runtime } = setup(t, { layoutSpec: colleagueMainLayout() });
  runtime.syncAgents([agent('A'), agent('B'), agent('C'), agent('D')]);
  const before = bindingMap(runtime);
  runtime.syncAgents([agent('intruder', 'error', { stationId: before.A }), agent('A'), agent('B'), agent('C'), agent('D')]);
  assert.equal(bindingMap(runtime).A, before.A, 'Existing A binding was evicted by a new stationId hint');
  assert.deepEqual(bindingMap(runtime), before, 'Overflow must not replace any currently bound agent');
  assert.deepEqual(runtime.unplacedAgents.map(a => a.id), ['intruder']);
});

test('an explicitly accepted colleague-seat binding persists when the next poll has no stationId hint', t => {
  const { runtime } = setup(t);
  const explicit = runtime.stations.find(s => s.id !== runtime.layout.mainStation && s.role === 'colleague').id;
  runtime.syncAgents([agent('fixed-person', 'writing', { stationId: explicit })]);
  assertBound(runtime.getStation(explicit), 'fixed-person', 'writing');
  runtime.syncAgents([agent('fixed-person', 'syncing')]);
  assert.equal(bindingMap(runtime)['fixed-person'], explicit, 'Accepted fixed seat moved when an optional stationId was omitted');
  assertBound(runtime.getStation(explicit), 'fixed-person', 'syncing');
});

test('syncAgents during demo updates only actual; returning shows latest live assignments and clears disappeared seats', t => {
  const { runtime } = setup(t, { layoutSpec: colleagueMainLayout() });
  runtime.syncAgents([agent('A'), agent('B', 'executing')]);
  const seats = bindingMap(runtime);
  runtime.setDemoMode(true);
  runtime.setStationState(seats.A, 'idle', { detail: '独立演示睡觉' });
  const visible = runtime.stations.map(s => {
    const value = stationData(s); delete value.actual; return value;
  });
  runtime.syncAgents([agent('A', 'error', { detail: '演示期间最新实际错误' }), agent('C', 'syncing')]);
  assert.equal(runtime.getStation(seats.A).actual.state, 'error');
  assert.equal(runtime.getStation(seats.B).actual.agentId, 'C');
  assert.deepEqual(runtime.stations.map(s => { const value = stationData(s); delete value.actual; return value; }), visible);
  runtime.setDemoMode(false);
  assertBound(runtime.getStation(seats.A), 'A', 'error');
  assert.equal(runtime.getStation(seats.A).detail, '演示期间最新实际错误');
  assertBound(runtime.getStation(seats.B), 'C', 'syncing');
  assert.equal(runtime.stations.some(s => s.agentId === 'B'), false);
  assert.equal(runtime.stations.some(s => s.source === 'demo'), false);
});

test('selection and overview/west/east/workstation views relayout only the camera and bubbles, never moving heads or rebinding/resetting seats', t => {
  const { runtime, camera, nodes, window } = setup(t);
  runtime.syncAgents([agent('A', 'syncing')]);
  runtime.update(3500);
  const target = runtime.stations.at(-1), baseline = runtime.stations.map(stationData);
  // View-dependent bubble anchors must reflow; every head, binding and clock stays fixed.
  const assertViewInvariant = () => {
    const expected = baseline.map((data, i) => ({ ...data, bubbleAnchor: [data.headAnchor[0],
      data.headAnchor[1] - (runtime.stations[i].bubbleText.height + 5) / 2 - 7] }));
    assert.deepEqual(runtime.stations.map(stationData), expected);
  };
  runtime.selectStation(target.id);
  assert.equal(runtime.activeStation, target.id);
  assert.equal(runtime.view, 'overview');
  for (const view of ['west', 'east', 'overview', 'workstation']) {
    runtime.setView(view);
    const spec = runtime.layout.views[view], center = view === 'workstation' ? target.center : spec.center;
    assert.deepEqual(camera.center, center);
    assert.equal(camera.zoom, Math.min(camera.width / spec.span[0], camera.height / spec.span[1]));
    assert.ok(camera.bounds.every(Number.isFinite));
    assert.equal(nodes.get('office-view-overview').attributes['aria-pressed'], String(view === 'overview'));
    assert.equal(nodes.get('office-view-workstation').attributes['aria-pressed'], String(view === 'workstation'));
    assertViewInvariant();
    const snapshot = runtime.snapshot();
    assert.equal(snapshot.activeStation, target.id);
    assert.equal(snapshot.stations.filter(s => s.selected).length, 1);
    assert.equal(snapshot.stations.find(s => s.selected).id, target.id);
    assert.deepEqual(snapshot.camera.worldView, [camera.worldView.x, camera.worldView.y, camera.worldView.width, camera.worldView.height]);
  }
  runtime.setView('east');
  runtime.selectStation(target.id, { focus: false });
  assert.equal(runtime.view, 'east');
  runtime.selectStation(target.id, { focus: true });
  assert.equal(runtime.view, 'workstation');
  const oldView = runtime.view, oldActive = runtime.activeStation, eventCount = window.events.length;
  assert.throws(() => runtime.selectStation('missing'), /工位不存在/);
  assert.throws(() => runtime.setView('diagonal'), /未知地图视图/);
  assert.equal(runtime.view, oldView);
  assert.equal(runtime.activeStation, oldActive);
  assert.equal(window.events.length, eventCount);
  assertViewInvariant();
});

test('bubble selection bounds and source labels are explicit, state labels retain exactly six API states', t => {
  const { runtime } = setup(t), unbound = runtime.stations.find(s => !s.bound);
  assert.deepEqual(Object.keys(STATE_LABELS), STATES);
  runtime.setView('workstation');
  runtime.selectStation(unbound.id);
  assert.match(unbound.bubbleText.text, /未绑定/);
  assert.match(unbound.bubbleText.text, new RegExp(unbound.name));
  assert.equal(unbound.bubbleText.x, unbound.bubbleAnchor[0]);
  assert.equal(unbound.bubbleText.y, unbound.bubbleAnchor[1]);
  const bounds = occupiedBounds(unbound);
  const selection = runtime.selection.calls.filter(call => call.name === 'strokeRoundedRect').at(-1);
  assert.deepEqual(selection.args, [bounds[0] - 4, bounds[1] - 4, bounds[2] + 8, bounds[3] + 8, 5]);
  runtime.setDemoMode(true);
  runtime.setStationState(unbound.id, 'syncing');
  assert.match(unbound.bubbleText.text, /演示·同步中/);
});

test('server indicators follow displayed main state, not the selected station or an unrelated agent', t => {
  const { runtime } = setup(t), main = runtime.getStation(runtime.layout.mainStation);
  runtime.setMainStatus({ state: 'writing', detail: '正常主任务' });
  runtime.syncAgents([agent('A', 'error')]);
  runtime.selectStation(bindingMap(runtime).A, { focus: true });
  runtime.update(7000);
  assert.equal(main.state, 'writing');
  assert.equal(runtime.serverLabel.text, '设备间 · 运行');
  assert.equal(runtime.serverWarning.calls.some(c => c.name === 'strokeRoundedRect'), false);
  runtime.setMainStatus({ state: 'error', detail: '主任务异常' });
  runtime.update(8000);
  assert.equal(runtime.serverLabel.text, '设备间 · 异常');
  assert.equal(runtime.snapshot().server.status, 'error');
  assert.equal(runtime.snapshot().serverWarning, true);
  assert.deepEqual(runtime.serverWarning.calls.filter(c => c.name === 'strokeRoundedRect').at(-1).args, [...layout.server.bounds, 3]);
  runtime.setMainStatus({ state: 'syncing' }); runtime.update(9000);
  assert.equal(runtime.serverLabel.text, '设备间 · 同步');
});

test('constructor reads reduced-motion preference, and guestPoint wraps only the configured guest slots', t => {
  const { runtime } = setup(t, { reducedMotion: true });
  assert.equal(runtime.reducedMotion, true);
  assert.ok(runtime.stations.every(s => s.player.reducedMotion === true));
  for (const [area, slots] of Object.entries(runtime.layout.guestSlots)) {
    for (let i = 0; i < slots.length * 3; i++) {
      const [x, y] = slots[i % slots.length];
      assert.deepEqual(runtime.guestPoint(area, i), { x, y });
    }
  }
  const [x, y] = runtime.layout.guestSlots.breakroom[0];
  assert.deepEqual(runtime.guestPoint('missing-area', 0), { x, y });
});

test('a main AI seat is always reserved from automatic syncAgents allocation, regardless of its order in stations', t => {
  const mainAiLayout = copy(layout);
  mainAiLayout.mainStation = mainAiLayout.stations.find(s => s.role === 'ai').id;
  const { runtime } = setup(t, { layoutSpec: mainAiLayout });
  const main = runtime.getStation(runtime.layout.mainStation), before = stationData(main);
  runtime.syncAgents([agent('remote', 'error')]);
  assert.deepEqual(stationData(main), before, 'Automatic allocation overwrote the reserved main AI actual data');
  const id = bindingMap(runtime).remote;
  assert.ok(id && id !== main.id);
  assertBound(runtime.getStation(id), 'remote', 'error');
});


test('single/two-line bubbles and their drawn tails remain 3px above unchanged heads in every view', t => {
  const { runtime } = setup(t), heads = runtime.stations.map(s => [...s.headAnchor]);
  // Model actual font metrics: a two-line text height of 27.67 gives a 32.67px bubble.
  let lineHeight = 13.835;
  for (const station of runtime.stations) {
    const text = station.bubbleText, setText = text.setText.bind(text);
    text.setText = value => {
      setText(value);
      text.height = value.split('\n').length * lineHeight;
      return text;
    };
  }
  const assertClearance = view => {
    for (const [index, station] of runtime.stations.entries()) {
      const [headX, headY] = heads[index], [x, y, width, height] = station.bubbleRect;
      const lines = view === 'overview' ? 1 : 2;
      assert.deepEqual(station.headAnchor, heads[index], 'Bubble reflow must not move a head');
      assert.equal(height, lines * lineHeight + 5, 'Use measured text height plus background padding');
      assert.deepEqual(station.bubbleAnchor, [headX, headY - height / 2 - 7]);
      assert.deepEqual([station.bubbleText.x, station.bubbleText.y], station.bubbleAnchor);
      assert.ok(Math.abs(x + width / 2 - headX) < 1e-9);
      assert.ok(Math.abs(y + height + 4 - (headY - 3)) < 1e-9, 'Background plus tail must end 3px above head');
      const background = station.bubbleBackground.calls.filter(call => call.name === 'fillRoundedRect').at(-1);
      const tail = station.bubbleBackground.calls.filter(call => call.name === 'fillTriangle').at(-1);
      assert.deepEqual(background.args, [x, y, width, height, 4]);
      assert.equal(tail.args[4], headX);
      assert.ok(Math.abs(tail.args[5] - (headY - 3)) < 1e-9, 'The actual drawn tail must not cover the ears');
      assert.ok(Math.max(tail.args[1], tail.args[3], tail.args[5]) <= headY - 3 + 1e-9);
    }
  };
  for (const view of ['overview', 'west', 'east', 'workstation', 'overview']) {
    runtime.setView(view);
    assertClearance(view);
  }
  // Remeasure rather than retaining a cached offset when font metrics change.
  lineHeight = 18.25;
  runtime.setView('workstation');
  assertClearance('workstation');
  runtime.setView('overview');
  assertClearance('overview');
});
