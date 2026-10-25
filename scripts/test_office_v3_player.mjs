import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { DirectionalSeatedPlayer, BUSINESS_STATES, validateDirectionalAssets } from '../frontend/company-office/reference-v3/directional-player.mjs';
import { drawScreenEffects, sampleScreenEffects, SCREEN_STYLES, validateScreenConfig } from '../frontend/company-office/reference-v3/screen-effects.mjs';
import { SeatedOfficePlayer } from '../frontend/company-office/seated-compositor.mjs';

// No generated v3 media, browser, native canvas, server or third-party package is required.
const root = new URL('../', import.meta.url);
const baseUrl = new URL('../frontend/company-office/reference-v3/', import.meta.url).href;
const legacyBaseUrl = new URL('../frontend/company-office/', import.meta.url).href;
const frozenRoot = new URL('../.agents/skills/star-office-character-animation/assets/approved-office-expressions-v1/', import.meta.url);
const legacy = JSON.parse(readFileSync(new URL('frontend/company-office/office-assets.json', root), 'utf8'));
const manifest = JSON.parse(readFileSync(new URL('template-manifest.json', frozenRoot), 'utf8'));
const clocks = { working: 60, idle: 36, syncing: 60, error: 12 };
const states = Object.keys(BUSINESS_STATES);
const directions = ['down', 'up', 'left', 'right'];
const msAt = tick => tick * 1000 / 12 + 0.00001;

function hash(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function fingerprints(directory, prefix = '') {
  const result = {};
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const name = `${prefix}${entry.name}`;
    if (entry.isDirectory()) Object.assign(result, fingerprints(new URL(`${entry.name}/`, directory), `${name}/`));
    else result[name] = hash(readFileSync(new URL(entry.name, directory)));
  }
  return result;
}

const frozenBefore = fingerprints(frozenRoot);
after(() => assert.deepEqual(fingerprints(frozenRoot), frozenBefore, 'Every frozen file, including the manifest, must remain unchanged'));

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function fixture() {
  const assets = structuredClone(legacy);
  assets.directions = {};
  for (const direction of directions) {
    const character = structuredClone(legacy.character);
    character.id = `fixture-${direction}`;
    character.direction = direction;
    character.faceVisible = direction !== 'up';
    character.headAnchor = [100, 101];
    character.base = direction === 'down' ? '../media/character-base.png' : `media/character-${direction}/character-base.png`;
    if (direction === 'left') {
      character.poseAnchor = [92, 168];
      character.faceRect = [35, 72, 90, 58];
      character.faceClipEllipse = [80, 101, 45, 29];
      character.headAnchor = [80, 101];
    }
    if (direction === 'right') {
      character.poseAnchor = [104, 172];
      character.faceRect = [63, 72, 90, 58];
      character.faceClipEllipse = [108, 101, 45, 29];
      character.headAnchor = [108, 101];
    }
    for (const [action, clock] of Object.entries(clocks)) {
      const original = character.actions[action];
      character.actions[action] = direction === 'up' ? { faceClockFrames: clock } : {
        ...original, faceClockFrames: clock,
        face: direction === 'down' ? `../${original.face}` : `media/character-${direction}/face-${action}.png`,
      };
    }
    if (direction === 'up') {
      delete character.faceRect;
      delete character.faceClipEllipse;
      delete character.faceFrameSize;
    }
    const furniture = {
      id: `fixture-desk-${direction}`, direction, size: [192, 192], seatAnchor: [96, 94],
      back: `media/furniture/${direction}-back.png`, front: `media/furniture/${direction}-front.png`,
      order: ['back', 'actor', 'front', 'screen'],
      screen: {
        visible: direction !== 'up',
        polygon: [[60, 114], [130, 119], [121, 158], [66, 155]],
        led: [128, 160, 3, 2],
      },
    };
    assets.directions[direction] = { character, furniture };
  }
  return assets;
}

function catalogFor(assets, base = baseUrl) {
  const catalog = new Map();
  const specs = { ...assets.directions };
  if (!specs.down && assets.character && (assets.furniture || assets.workstation)) {
    specs.down = { character: assets.character, furniture: assets.furniture ?? assets.workstation };
  }
  for (const [direction, spec] of Object.entries(specs)) {
    const entries = [
      ['back', spec.furniture.back, 192, 192], ['front', spec.furniture.front, 192, 192],
      ['base', spec.character.base, 192, 192],
    ];
    if (spec.character.faceVisible !== false) {
      for (const [action, value] of Object.entries(spec.character.actions)) entries.push([action, value.face, 360, 174]);
    }
    for (const [key, path, width, height] of entries) {
      catalog.set(new URL(path, base).href, Object.freeze({ id: `${direction}:${key}`, width, height, naturalWidth: width, naturalHeight: height }));
    }
  }
  return catalog;
}

function loaderFor(assets = fixture(), base = baseUrl) {
  const catalog = catalogFor(assets, base), calls = [];
  const loader = async url => {
    calls.push(url);
    assert.ok(catalog.has(url), `Unexpected/missing image: ${url}`);
    return catalog.get(url);
  };
  return { loader, calls, catalog };
}

// The recorder models clips/save/restore rather than pretending images have real pixels.
// Screen pixel coverage is checked separately at pixel centers against these recorded masks.
function recordingCanvas() {
  const calls = [], stack = [];
  let state = { fillStyle: '#000000', globalAlpha: 1, clips: [] }, currentPath = [];
  const ctx = {
    calls,
    imageSmoothingEnabled: true,
    get fillStyle() { return state.fillStyle; },
    set fillStyle(value) { state.fillStyle = value; },
    get globalAlpha() { return state.globalAlpha; },
    set globalAlpha(value) { state.globalAlpha = value; },
    clearRect(...args) { calls.push({ op: 'clearRect', args }); },
    drawImage(image, ...args) {
      calls.push({ op: 'drawImage', id: image.id, image, args, clips: structuredClone(state.clips) });
    },
    fillRect(...args) {
      calls.push({ op: 'fillRect', args, fillStyle: state.fillStyle, alpha: state.globalAlpha, clips: structuredClone(state.clips) });
    },
    save() { stack.push(structuredClone(state)); calls.push({ op: 'save' }); },
    restore() {
      assert.ok(stack.length, 'Unbalanced context.restore');
      state = stack.pop();
      calls.push({ op: 'restore' });
    },
    beginPath() { currentPath = []; calls.push({ op: 'beginPath' }); },
    moveTo(...args) { currentPath.push({ op: 'moveTo', args }); calls.push({ op: 'moveTo', args }); },
    lineTo(...args) { currentPath.push({ op: 'lineTo', args }); calls.push({ op: 'lineTo', args }); },
    closePath() { currentPath.push({ op: 'closePath' }); calls.push({ op: 'closePath' }); },
    ellipse(...args) { currentPath.push({ op: 'ellipse', args }); calls.push({ op: 'ellipse', args }); },
    rect(...args) { currentPath.push({ op: 'rect', args }); calls.push({ op: 'rect', args }); },
    clip() {
      assert.ok(currentPath.length, 'Empty clip mask');
      const path = structuredClone(currentPath);
      state.clips.push(path);
      calls.push({ op: 'clip', path });
    },
  };
  for (const op of ['rotate', 'scale', 'translate', 'transform', 'setTransform', 'resetTransform']) {
    ctx[op] = (...args) => assert.fail(`Forbidden body/context transform: ${op}(${args})`);
  }
  const canvas = { width: 999, height: 777, getContext: type => { assert.equal(type, '2d'); return ctx; } };
  return {
    canvas, ctx, calls,
    reset() { calls.length = 0; },
    balanced() {
      assert.equal(stack.length, 0, 'All save/restore pairs must balance');
      assert.deepEqual(state.clips, [], 'Face/screen mask must never escape its layer');
      assert.equal(state.globalAlpha, 1, 'Screen opacity must never leak to furniture/body');
      assert.equal(state.fillStyle, '#000000', 'Screen fillStyle must be restored');
    },
  };
}

async function initialized(assets = fixture(), options = {}) {
  const recorder = recordingCanvas(), images = loaderFor(assets, options.baseUrl ?? baseUrl);
  const player = new DirectionalSeatedPlayer(recorder.canvas, assets, { baseUrl, imageLoader: images.loader, ...options });
  assert.equal(await player.initialize(), player);
  return { player, recorder, ...images };
}

function imageCalls(recorder) {
  return recorder.calls.filter(call => call.op === 'drawImage');
}

function actorSignature(recorder) {
  return recorder.calls.filter(call => call.op === 'ellipse' ||
    (call.op === 'drawImage' && !call.id.endsWith(':back') && !call.id.endsWith(':front')))
    .map(({ op, id, args, clips }) => ({ op, ...(id ? { id } : {}), args, ...(clips ? { clips } : {}) }));
}

function fillSignature(recorder) {
  return recorder.calls.filter(call => call.op === 'fillRect').map(({ args, fillStyle, alpha, clips }) => ({ args, fillStyle, alpha, clips }));
}

function renderFrame(player, recorder, frame) {
  player.setFrame((frame + 11) % 12);
  recorder.reset();
  assert.equal(player.setFrame(frame), true);
  recorder.balanced();
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function pointInPolygon([x, y], points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [ax, ay] = points[i], [bx, by] = points[j];
    if ((ay > y) !== (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax) inside = !inside;
  }
  return inside;
}

function inRect([x, y], [left, top, w, h]) {
  return x >= left && x < left + w && y >= top && y < top + h;
}

function insideClip(point, path) {
  if (path[0].op === 'rect') return inRect(point, path[0].args);
  assert.ok(path[0].op === 'moveTo', 'Screen fills must use a polygon or LED rectangle, never the face ellipse');
  return pointInPolygon(point, path.filter(p => p.op === 'moveTo' || p.op === 'lineTo').map(p => p.args));
}

function screenPixels(recorder) {
  const pixels = new Set();
  for (const call of recorder.calls.filter(c => c.op === 'fillRect')) {
    assert.ok(call.clips.length, 'Every screen/LED fill must be masked');
    const [left, top, w, h] = call.args;
    for (let y = Math.max(0, Math.floor(top)); y < Math.min(192, Math.ceil(top + h)); y++) {
      for (let x = Math.max(0, Math.floor(left)); x < Math.min(192, Math.ceil(left + w)); x++) {
        const point = [x + 0.5, y + 0.5];
        if (inRect(point, call.args) && call.clips.every(clip => insideClip(point, clip))) pixels.add(`${x}:${y}`);
      }
    }
  }
  return pixels;
}

test('fixed six-state mapping and frozen source/copies retain their original SHA-256', () => {
  assert.deepEqual(BUSINESS_STATES, { idle: 'idle', writing: 'working', researching: 'working', executing: 'working', syncing: 'syncing', error: 'error' });
  assert.ok(Object.isFrozen(BUSINESS_STATES));
  assert.equal(manifest.files.length, 19);
  assert.deepEqual([manifest.fps, manifest.frameCount, manifest.grid], [12, 12, [4, 3]]);
  assert.deepEqual([manifest.poseAnchor, manifest.scale, manifest.faceRect, manifest.faceClipEllipse],
    [legacy.character.poseAnchor, legacy.character.scale, legacy.character.faceRect, legacy.character.faceClipEllipse]);
  for (const entry of manifest.files) {
    const content = readFileSync(new URL(entry.path, frozenRoot));
    assert.equal(content.length, entry.bytes, entry.path);
    assert.equal(hash(content), entry.sha256, `Frozen source changed: ${entry.path}`);
  }
  const paths = [legacy.character.base, legacy.workstation.back, legacy.workstation.front, ...Object.values(legacy.character.actions).map(a => a.face)];
  for (const path of paths) {
    assert.deepEqual(readFileSync(new URL(`frontend/company-office/${path}`, root)), readFileSync(new URL(path, frozenRoot)), `Original down asset differs: ${path}`);
  }
});

test('validator is read-only and accepts declared partial sets and legacy-down fallback only', () => {
  const assets = deepFreeze(fixture());
  assert.equal(validateDirectionalAssets(assets), assets);
  assert.equal(validateDirectionalAssets(deepFreeze(structuredClone(legacy))).character.id, legacy.character.id);
  const partial = { fps: 12, frameCount: 12, grid: [4, 3], directions: { up: assets.directions.up } };
  assert.equal(validateDirectionalAssets(partial), partial);
  assert.throws(() => new DirectionalSeatedPlayer(recordingCanvas().canvas, partial), /缺少 down/);
  assert.throws(() => new DirectionalSeatedPlayer(recordingCanvas().canvas, legacy, { direction: 'left' }), /缺少 left/);
  assert.throws(() => new DirectionalSeatedPlayer(recordingCanvas().canvas, legacy, { direction: 'up' }), /缺少 up/);
});

test('validator rejects malformed geometry, state maps, clocks, layers, directions and masks', () => {
  const mutations = [
    a => { a.fps = 24; }, a => { a.frameCount = 1; }, a => { a.grid = [3, 4]; },
    a => { a.grid.push(1); }, a => { a.faceClockFrames = 12; },
    a => { a.businessStateToAction.writing = 'typing'; }, a => { a.businessStateToAction.walking = 'working'; },
    a => { a.directions = null; }, a => { a.directions = []; },
    a => { a.directions.diagonal = a.directions.left; }, a => { a.directions.down = null; },
    a => { a.directions.left.character.direction = 'right'; },
    a => { a.directions.left.furniture.direction = 'right'; },
    a => { a.directions.left.character.frameSize = [96, 96]; },
    a => { a.directions.left.furniture.size = [192, 191]; },
    a => { a.directions.left.character.poseAnchor = [1, NaN]; },
    a => { a.directions.left.furniture.seatAnchor = [1]; },
    a => { a.directions.left.character.scale = -0.6; },
    a => { a.directions.left.character.scale = Infinity; },
    a => { a.directions.left.character.headAnchor = [1, Infinity]; },
    a => { a.directions.left.character.faceRect = [150, 150, 90, 58]; },
    a => { a.directions.left.character.faceRect[2] = 0; },
    a => { a.directions.left.character.faceClipEllipse[2] = 0; },
    a => { a.directions.left.character.faceClipEllipse = [0, 0, 45, 29]; },
    a => { a.directions.left.character.faceFrameSize = [96, 96]; },
    a => { a.directions.left.character.faceVisible = false; },
    a => { a.directions.up.character.faceVisible = true; },
    a => { a.directions.left.character.base = ''; },
    a => { a.directions.left.character.actions.working.face = ''; },
    a => { delete a.directions.left.character.actions.error; },
    a => { a.directions.left.character.actions.hands = { face: 'hands.png' }; },
    a => { a.directions.left.character.actions.idle.faceClockFrames = 60; },
    a => { a.directions.left.character.actions.error.faceClockFrames = 36; },
    a => { delete a.directions.up.character.actions.working.faceClockFrames; },
    a => { a.directions.up.character.actions.syncing.faceClockFrames = 12; },
    a => { a.directions.left.furniture.front = null; },
    a => { delete a.directions.left.furniture.order; },
    a => { a.directions.left.furniture.order = ['back', 'actor', 'front', 'front']; },
    a => { a.directions.left.furniture.order = ['back', 'actor', 'front', 'hands']; },
    a => { a.directions.left.furniture.screen.visible = 1; },
    a => { a.directions.left.furniture.screen.polygon = [[1, 1], [2, 2]]; },
    a => { a.directions.left.furniture.screen.polygon = [[1, 1], [2, 2], [3, 3]]; },
    a => { a.directions.left.furniture.screen.polygon = [[0, 0], [10, 10], [0, 10], [10, 0]]; },
    a => { a.directions.left.furniture.screen.polygon = [[0, 0], [10, 0], [10, 0], [0, 10]]; },
    a => { a.directions.left.furniture.screen.polygon[0][0] = -1; },
    a => { a.directions.left.furniture.screen.polygon[0][0] = 193; },
    a => { a.directions.left.furniture.screen.led = [191, 190, 3, 2]; },
    a => { a.directions.left.furniture.screen.led = [1, 1, 0, 1]; },
  ];
  for (const [i, mutate] of mutations.entries()) {
    const bad = fixture();
    mutate(bad);
    assert.throws(() => validateDirectionalAssets(bad), undefined, `Invalid asset mutation ${i} should fail`);
  }
  for (const bad of [null, [], {}, 42]) assert.throws(() => validateDirectionalAssets(bad));
});

test('initialize is idempotent, preserves pre-ready samples and outputs exactly 192x192', async () => {
  const assets = fixture(), before = structuredClone(assets), recorder = recordingCanvas();
  const { loader, calls } = loaderFor(assets);
  const player = new DirectionalSeatedPlayer(recorder.canvas, assets, { baseUrl, imageLoader: loader });
  assert.deepEqual([recorder.canvas.width, recorder.canvas.height], [192, 192]);
  assert.equal(player.sample(msAt(9)), false);
  assert.equal(recorder.calls.length, 0);
  const [first, second] = await Promise.all([player.initialize(), player.initialize()]);
  assert.equal(first, player);
  assert.equal(second, player);
  assert.equal(calls.length, 7);
  assert.equal(player.snapshot().faceFrame, 9);
  const count = recorder.calls.length;
  await player.initialize();
  assert.equal(recorder.calls.length, count);
  assert.equal(calls.length, 7);
  assert.equal(player.snapshot().ready, true);
  assert.equal(player.snapshot().handsRendered, false);
  assert.equal(player.snapshot().bodyFixed, true);
  assert.equal(recorder.ctx.imageSmoothingEnabled, false);
  assert.deepEqual(assets, before);
  assets.directions.down.character.poseAnchor[0] = -900;
  assert.deepEqual(player.snapshot().poseAnchor, before.directions.down.character.poseAnchor);
  recorder.balanced();
});

test('legacy down preserves the frozen body, ellipse, atlas crop and face draw rule for all 72 state/frame samples', async () => {
  const recorder = recordingCanvas();
  const calls = [];
  const loader = async url => {
    calls.push(url);
    const bytes = readFileSync(new URL(url));
    assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
    return { id: `down:${url.includes('face-') ? Object.entries(legacy.character.actions).find(([, a]) => url.endsWith(a.face))[0] : url.endsWith(legacy.character.base) ? 'base' : url.endsWith(legacy.workstation.back) ? 'back' : 'front'}`,
      width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  };
  const player = new DirectionalSeatedPlayer(recorder.canvas, legacy, { baseUrl: legacyBaseUrl, imageLoader: loader });
  await player.initialize();
  const oldRecorder = recordingCanvas(), old = new SeatedOfficePlayer(oldRecorder.canvas, legacy);
  old.images = player.images;
  for (const state of states) {
    player.setState(state);
    old.setState(state);
    for (let frame = 0; frame < 12; frame++) {
      renderFrame(player, recorder, frame);
      oldRecorder.reset();
      old.setFrame(frame);
      assert.deepEqual(actorSignature(recorder), actorSignature(oldRecorder));
      assert.deepEqual(imageCalls(recorder).map(c => [c.id, c.args]), imageCalls(oldRecorder).map(c => [c.id, c.args]));
      assert.deepEqual(player.bodyPlacement(), old.bodyPlacement());
      assert.equal(recorder.calls.filter(c => c.op === 'fillRect').length, 0, 'Legacy down has no fabricated screen mask');
      oldRecorder.balanced();
    }
  }
  assert.equal(calls.length, 7);
  assert.equal(player.snapshot().directionFallback, true);
});

test('all six states use their immutable 12fps/12-cell and 60/36/12 expression clocks', async () => {
  const { player, recorder } = await initialized();
  for (const state of states) {
    player.setState(state);
    for (const tick of [0, 1, 5, 6, 11, 12, 13, 23, 35, 36, 37, 59, 60, 61, 71, 72, 73, 119, 120]) {
      player.sample(msAt(tick));
      const snap = player.snapshot(), clock = clocks[BUSINESS_STATES[state]], faceTick = tick % clock;
      assert.equal(snap.state, state);
      assert.equal(snap.action, BUSINESS_STATES[state]);
      assert.equal(snap.tick, tick);
      assert.equal(snap.frame, tick % 12);
      assert.equal(snap.faceFrame, faceTick < 12 ? faceTick : 0);
      assert.equal(snap.clock, clock);
      assert.equal(snap.faceClockFrames, clock);
      assert.equal(snap.clockTick, faceTick);
      assert.deepEqual([snap.fps, snap.frameCount], [12, 12]);
      recorder.balanced();
    }
  }
  player.setState('writing'); player.sample(5000); assert.equal(player.snapshot().clockTick, 0);
  player.setState('idle'); player.sample(3000); assert.equal(player.snapshot().clockTick, 0);
  player.setState('error'); player.sample(1000); assert.equal(player.snapshot().clockTick, 0);
});

test('same state is a no-op, while an actual business-state change (even same action) starts at zero', async () => {
  const { player, recorder } = await initialized();
  for (const state of states) {
    player.setState(state);
    player.sample(msAt(61));
    const before = player.snapshot();
    recorder.reset();
    assert.equal(player.setState(state), false);
    assert.deepEqual(player.snapshot(), before);
    assert.equal(recorder.calls.length, 0);
  }
  player.setState('writing'); player.sample(msAt(69));
  player.setState('researching');
  assert.deepEqual([player.snapshot().action, player.snapshot().sampleMs, player.snapshot().tick, player.snapshot().faceFrame], ['working', 0, 0, 0]);
  for (const invalid of ['working', 'walking', '', null, 12, '__proto__', 'toString']) {
    const before = player.snapshot();
    assert.throws(() => player.setState(invalid));
    assert.deepEqual(player.snapshot(), before);
  }
});

test('sample returns a boolean for actual redraws, including face holds, dynamic screens and hidden faces', async () => {
  const { player, recorder } = await initialized();
  recorder.reset();
  assert.equal(player.sample(0), false);
  assert.equal(player.sample(40), false);
  assert.equal(recorder.calls.length, 0);
  assert.equal(player.sample(msAt(1)), true);
  recorder.reset();
  assert.equal(player.sample(msAt(1)), false);
  assert.equal(recorder.calls.length, 0);
  player.setState('idle');
  recorder.reset();
  assert.equal(player.sample(msAt(12)), false);
  assert.equal(player.sample(msAt(35)), false);
  assert.equal(recorder.calls.length, 0);
  assert.equal(player.snapshot().tick, 35, 'Clock still advances when no redraw is needed');
  assert.equal(player.sample(msAt(37)), true);
  player.setState('writing'); player.sample(msAt(14));
  recorder.reset();
  assert.equal(player.sample(msAt(18)), true, 'Document cursor moves during a held face');
  assert.equal(player.snapshot().faceFrame, 0);
  player.setState('researching'); player.sample(msAt(14));
  assert.equal(player.sample(msAt(15)), true, 'Search scan advances during a held face');
  await player.setDirection('up');
  player.setState('writing');
  recorder.reset();
  assert.equal(player.sample(msAt(61)), false, 'No back-face repaint just for a logical tick');
  assert.equal(player.snapshot().faceFrame, 1, 'Invisible back face retains the same state clock');
  assert.equal(recorder.calls.length, 0);
  player.setState('error');
  assert.equal(player.sample(msAt(4)), true, 'Back LED can show the soft error pulse');
  recorder.balanced();
});

test('QA setFrame samples all twelve cells without resetting time, body or screen; invalid input is atomic', async () => {
  const { player, recorder } = await initialized();
  player.setState('syncing'); player.sample(msAt(49));
  const before = player.snapshot();
  for (let frame = 0; frame < 12; frame++) {
    renderFrame(player, recorder, frame);
    const snap = player.snapshot();
    assert.equal(snap.frame, frame);
    assert.equal(snap.faceFrame, frame);
    assert.equal(snap.sampleMs, before.sampleMs);
    assert.equal(snap.tick, before.tick);
    assert.deepEqual(snap.screen, before.screen);
    assert.deepEqual(snap.bodyPlacement, before.bodyPlacement);
  }
  const last = player.snapshot();
  player.setState('syncing');
  assert.deepEqual(player.snapshot(), last, 'Repeated same state does not discard QA frame');
  for (const bad of [-1, 12, 1.5, NaN, Infinity, '2', null]) {
    assert.throws(() => player.setFrame(bad));
    assert.deepEqual(player.snapshot(), last);
  }
  assert.equal(player.sample(before.sampleMs), true);
  assert.equal(player.snapshot().faceFrame, 0);
  for (const bad of [NaN, Infinity, -Infinity, '1', null, Number.MAX_VALUE]) {
    const valid = player.snapshot();
    assert.throws(() => player.sample(bad));
    assert.deepEqual(player.snapshot(), valid);
  }
  player.sample(-1000);
  assert.equal(player.snapshot().tick, 0);
  assert.equal(player.snapshot().sampleMs, 0);
});

test('real directional fixtures are selected without rotate/mirror/body transforms and furniture follows only order', async () => {
  const assets = fixture();
  assets.directions.left.furniture.order = ['front', 'actor', 'back', 'screen'];
  assets.directions.right.furniture.order = ['screen', 'back', 'actor', 'front'];
  const { player, recorder, calls } = await initialized(deepFreeze(assets));
  for (const direction of directions) {
    await player.setDirection(direction);
    const spec = assets.directions[direction], placement = player.bodyPlacement();
    assert.deepEqual(placement, [96 - spec.character.poseAnchor[0] * spec.character.scale,
      94 - spec.character.poseAnchor[1] * spec.character.scale, 192 * spec.character.scale, 192 * spec.character.scale]);
    recorder.reset();
    player.setState(player.state === 'idle' ? 'writing' : 'idle');
    const layerSequence = [];
    for (const call of recorder.calls) {
      if (call.op === 'drawImage' && call.id.endsWith(':base')) layerSequence.push('actor');
      else if (call.op === 'drawImage' && call.id.endsWith(':back')) layerSequence.push('back');
      else if (call.op === 'drawImage' && call.id.endsWith(':front')) layerSequence.push('front');
      else if (call.op === 'fillRect' && !layerSequence.includes('screen')) layerSequence.push('screen');
    }
    assert.deepEqual(layerSequence, spec.furniture.order);
    for (const state of states) {
      if (direction === 'up') {
        if (player.state === state) player.setState(state === 'idle' ? 'writing' : 'idle');
        recorder.reset();
      }
      player.setState(state);
      for (let frame = 0; frame < 12; frame++) {
        if (direction !== 'up') renderFrame(player, recorder, frame);
        else player.setFrame(frame); // Logical QA frame advances; the back-view body remains identical.
        assert.equal(player.state, state);
        assert.equal(player.faceFrame, frame);
        const draws = imageCalls(recorder);
        const body = draws.find(c => c.id === `${direction}:base`);
        assert.ok(body, `Must use ${direction}'s real body image`);
        assert.deepEqual(body.args, placement);
        assert.deepEqual(body.clips, []);
        for (const name of ['back', 'front']) assert.deepEqual(draws.find(c => c.id === `${direction}:${name}`).args, [0, 0]);
        assert.equal(draws.filter(c => c.args.length === 8).length, direction === 'up' ? 0 : 1);
        assert.equal(recorder.calls.filter(c => c.op === 'ellipse').length, direction === 'up' ? 0 : 1);
        assert.equal(player.snapshot().handsRendered, false);
        recorder.balanced();
      }
    }
  }
  assert.equal(calls.filter(url => url.includes('character-up') && url.includes('face')).length, 0);
});

test('up needs no face files/geometry but maintains each state clock and LED-only drawing', async () => {
  const assets = fixture();
  for (const action of Object.values(assets.directions.up.character.actions)) action.face = 'FORBIDDEN-back-face.png';
  const { player, recorder, calls } = await initialized(assets, { direction: 'up' });
  assert.equal(calls.length, 3);
  for (const state of states) {
    player.setState(state);
    player.sample(msAt(61));
    const snap = player.snapshot();
    const clock = clocks[BUSINESS_STATES[state]], faceTick = 61 % clock;
    assert.equal(snap.faceVisible, false);
    assert.equal(snap.clock, clock);
    assert.equal(snap.faceFrame, faceTick < 12 ? faceTick : 0);
    assert.equal(snap.screen.mode, 'led');
    assert.equal(snap.screen.visible, false);
    assert.equal(snap.screen.ledOnly, true);
    assert.deepEqual(snap.screen.polygon, []);
    assert.equal(recorder.calls.some(c => c.op === 'moveTo' || c.op === 'ellipse'), false);
    for (const fill of recorder.calls.filter(c => c.op === 'fillRect')) {
      assert.deepEqual(fill.args, assets.directions.up.furniture.screen.led);
      assert.equal(fill.clips.length, 1);
      assert.equal(fill.clips[0][0].op, 'rect');
    }
    recorder.balanced();
    recorder.reset();
  }
  assert.equal(calls.some(url => url.includes('FORBIDDEN')), false);
  await player.setDirection('down');
  assert.equal(player.snapshot().faceFrame, 1);
  assert.equal(imageCalls(recorder).find(c => c.id === 'down:error').args[0], 90);
});

test('awaited direction changes preserve state, clock, elapsed sample and QA frame', async () => {
  const { player, recorder } = await initialized();
  for (const state of states) {
    player.setState(state);
    player.sample(msAt(69));
    const before = player.snapshot();
    for (const direction of ['left', 'right', 'up', 'down']) {
      assert.equal(await player.setDirection(direction), player);
      const snap = player.snapshot();
      assert.deepEqual([snap.state, snap.action, snap.sampleMs, snap.tick, snap.clock, snap.frame, snap.faceFrame],
        [before.state, before.action, before.sampleMs, before.tick, before.clock, before.frame, before.faceFrame]);
      assert.equal(snap.direction, direction);
      recorder.balanced();
    }
  }
  player.setFrame(11);
  await player.setDirection('left');
  assert.equal(player.snapshot().faceFrame, 11);
  const before = player.snapshot();
  recorder.reset();
  await player.setDirection('left');
  assert.deepEqual(player.snapshot(), before);
  assert.equal(recorder.calls.length, 0);
});

test('unsupported/missing directions fail without a fallback, half-switch, state mutation or repaint', async () => {
  const assets = fixture();
  delete assets.directions.right;
  const { player, recorder, calls } = await initialized(assets);
  player.setState('error'); player.sample(msAt(17));
  const before = player.snapshot(), images = player.images, loaded = calls.length;
  recorder.reset();
  for (const direction of ['right', 'north', 'diagonal', '', null, '__proto__']) {
    await assert.rejects(player.setDirection(direction), /缺少 right|方向只允许/);
    assert.deepEqual(player.snapshot(), before);
    assert.equal(player.images, images);
    assert.equal(recorder.calls.length, 0);
    assert.equal(calls.length, loaded);
  }
  const fallbackAssets = fixture();
  delete fallbackAssets.directions.down;
  const fallback = await initialized(fallbackAssets);
  assert.equal(fallback.player.snapshot().directionFallback, true);
  assert.equal(fallback.player.spec.character.base, legacy.character.base);
});

test('direction load commits atomically at completion, using the latest state/sample rather than a stale snapshot', async () => {
  const assets = fixture(), fake = loaderFor(assets), gate = deferred(), started = deferred();
  const recorder = recordingCanvas();
  const loader = async url => {
    if (url.endsWith('character-left/character-base.png')) { started.resolve(); await gate.promise; }
    return fake.loader(url);
  };
  const player = new DirectionalSeatedPlayer(recorder.canvas, assets, { baseUrl, imageLoader: loader });
  await player.initialize();
  player.sample(msAt(3));
  const before = player.snapshot(), oldImages = player.images;
  recorder.reset();
  const change = player.setDirection('left');
  await started.promise;
  assert.deepEqual(player.snapshot(), before);
  assert.equal(player.images, oldImages);
  assert.equal(recorder.calls.length, 0);
  player.setState('error'); player.sample(msAt(29));
  const latest = player.snapshot();
  gate.resolve();
  await change;
  assert.equal(player.direction, 'left');
  assert.deepEqual([player.state, player.sampleMs, player.tick, player.faceFrame], [latest.state, latest.sampleMs, latest.tick, latest.faceFrame]);
  assert.equal(imageCalls(recorder).at(-2).id, 'left:error');
  recorder.balanced();
});

test('out-of-order direction loads cannot revert the latest direction; current-direction request cancels pending change', async () => {
  const assets = fixture(), fake = loaderFor(assets), recorder = recordingCanvas();
  let leftGate = deferred(), rightGate = deferred(), leftStarted = deferred(), rightStarted = deferred();
  const loader = async url => {
    if (url.endsWith('character-left/character-base.png')) { leftStarted.resolve(); await leftGate.promise; }
    if (url.endsWith('character-right/character-base.png')) { rightStarted.resolve(); await rightGate.promise; }
    return fake.loader(url);
  };
  const player = new DirectionalSeatedPlayer(recorder.canvas, assets, { baseUrl, imageLoader: loader });
  await player.initialize();
  const left = player.setDirection('left'); await leftStarted.promise;
  const right = player.setDirection('right'); await rightStarted.promise;
  player.setState('syncing'); player.sample(msAt(70));
  rightGate.resolve(); await right;
  const before = player.snapshot(), images = player.images;
  recorder.reset();
  leftGate.resolve(); await left;
  assert.equal(player.direction, 'right');
  assert.deepEqual(player.snapshot(), before);
  assert.equal(player.images, images);
  assert.equal(recorder.calls.length, 0);
  // Use a new loader/player: successful textures from the first race are deliberately cached.
  const fresh = loaderFor(assets), newGate = deferred(), newStarted = deferred();
  const nextRecorder = recordingCanvas();
  const another = new DirectionalSeatedPlayer(nextRecorder.canvas, assets, { baseUrl, imageLoader: async url => {
    if (url.endsWith('character-left/character-base.png')) { newStarted.resolve(); await newGate.promise; }
    return fresh.loader(url);
  } });
  await another.initialize();
  const pending = another.setDirection('left'); await newStarted.promise;
  await another.setDirection('down');
  const current = another.snapshot();
  nextRecorder.reset();
  newGate.resolve(); await pending;
  assert.deepEqual(another.snapshot(), current);
  assert.equal(nextRecorder.calls.length, 0);
});

test('failed/incorrect-size direction images never half-switch and can be retried without reloading successful images', async () => {
  const assets = fixture(), fake = loaderFor(assets), recorder = recordingCanvas();
  let failKind = 'reject';
  const attempts = [];
  const loader = async url => {
    attempts.push(url);
    if (url.endsWith('character-right/face-error.png')) {
      if (failKind === 'reject') throw new Error('fixture offline');
      if (failKind === 'size') return { id: 'invalid', width: 360, height: 174, naturalWidth: 384, naturalHeight: 288 };
    }
    return fake.loader(url);
  };
  const player = new DirectionalSeatedPlayer(recorder.canvas, assets, { baseUrl, imageLoader: loader });
  await player.initialize();
  player.setState('idle'); player.sample(msAt(8));
  const before = player.snapshot(), images = player.images;
  for (const kind of ['reject', 'size']) {
    failKind = kind;
    recorder.reset();
    await assert.rejects(player.setDirection('right'), kind === 'reject' ? /fixture offline/ : /360x174/);
    assert.deepEqual(player.snapshot(), before);
    assert.equal(player.images, images);
    assert.equal(recorder.calls.length, 0);
  }
  failKind = null;
  await player.setDirection('right');
  assert.equal(player.direction, 'right');
  assert.equal(player.faceFrame, before.faceFrame);
  assert.equal(attempts.filter(u => u.endsWith('character-right/face-error.png')).length, 3);
  assert.equal(attempts.filter(u => u.endsWith('character-right/character-base.png')).length, 1);
});

test('parallel players share successful/in-flight image loading, never their state, clocks, direction or snapshots', async () => {
  const assets = fixture(), fake = loaderFor(assets), records = [recordingCanvas(), recordingCanvas()];
  const players = records.map(r => new DirectionalSeatedPlayer(r.canvas, assets, { baseUrl, imageLoader: fake.loader }));
  await Promise.all(players.map(p => p.initialize()));
  assert.equal(fake.calls.length, 7);
  assert.equal(players[0].images.base, players[1].images.base);
  assert.notEqual(players[0].images, players[1].images);
  players[0].setState('idle'); players[0].sample(msAt(37));
  const second = players[1].snapshot(), secondCalls = records[1].calls.length;
  players[0].setReducedMotion(true);
  await players[0].setDirection('right');
  assert.deepEqual(players[1].snapshot(), second);
  assert.equal(records[1].calls.length, secondCalls);
  players[1].setState('error'); players[1].sample(msAt(5));
  assert.equal(players[0].state, 'idle');
  assert.equal(players[0].faceFrame, 1);
  assert.equal(players[1].faceFrame, 5);
  const first = players[0].snapshot();
  first.bodyPlacement[0] = -999;
  first.poseAnchor[0] = -999;
  first.seatAnchor[0] = -999;
  first.screen.polygon[0][0] = -999;
  first.screen.led[0] = -999;
  assert.equal(players[0].snapshot().screen.polygon[0][0], assets.directions.right.furniture.screen.polygon[0][0]);
  assert.notEqual(players[0].bodyPlacement()[0], -999);
});

test('failed shared initialization is evicted and retriable, including a synchronously throwing imageLoader', async () => {
  const assets = fixture(), fake = loaderFor(assets), records = [recordingCanvas(), recordingCanvas()];
  let broken = true;
  const attempts = [];
  const loader = url => {
    attempts.push(url);
    if (broken && url.endsWith('character-base.png')) throw new Error('sync loader failure');
    return fake.loader(url);
  };
  const players = records.map(r => new DirectionalSeatedPlayer(r.canvas, assets, { baseUrl, imageLoader: loader }));
  const results = await Promise.allSettled(players.map(p => p.initialize()));
  assert.deepEqual(results.map(r => r.status), ['rejected', 'rejected']);
  assert.equal(attempts.filter(u => u.endsWith('character-base.png')).length, 1);
  assert.ok(players.every(p => !p.ready));
  assert.ok(records.every(r => r.calls.length === 0));
  broken = false;
  await Promise.all(players.map(p => p.initialize()));
  assert.equal(attempts.filter(u => u.endsWith('character-base.png')).length, 2);
  assert.equal(attempts.filter(u => u.endsWith('face-working.png')).length, 1);
  assert.ok(players.every(p => p.ready));
  const other = loaderFor(assets), independent = await initialized(assets, { imageLoader: other.loader });
  assert.equal(other.calls.length, 7, 'Different loader identities do not share foreign fixtures');
  assert.notEqual(independent.player.images.base, players[0].images.base);
});

test('default browser Image/decode path caches successes and retries a rejected decode', async () => {
  const assets = fixture(), catalog = catalogFor(assets), attempts = [], originalImage = globalThis.Image;
  let failBase = true;
  globalThis.Image = class {
    set src(url) {
      attempts.push(url);
      this.url = url;
      const image = catalog.get(url);
      assert.ok(image);
      Object.assign(this, image);
    }
    async decode() {
      if (failBase && this.url.endsWith('character-base.png')) throw new Error('decode not ready');
    }
  };
  try {
    const records = [recordingCanvas(), recordingCanvas()];
    const players = records.map(r => new DirectionalSeatedPlayer(r.canvas, assets, { baseUrl }));
    await assert.rejects(players[0].initialize(), /decode not ready/);
    failBase = false;
    await Promise.all(players.map(p => p.initialize()));
    assert.equal(attempts.filter(u => u.endsWith('character-base.png')).length, 2);
    assert.equal(attempts.filter(u => u.endsWith('face-working.png')).length, 1);
    assert.equal(players[0].images.base, players[1].images.base);
  } finally {
    if (originalImage === undefined) delete globalThis.Image;
    else globalThis.Image = originalImage;
  }
});

test('six screen states have visibly different drawing recipes; idle is dark, effects are deterministic', () => {
  const screen = deepFreeze(fixture().directions.down.furniture.screen), signatures = new Set();
  assert.deepEqual(Object.keys(SCREEN_STYLES), states);
  assert.equal(new Set(Object.values(SCREEN_STYLES)).size, 6);
  for (const state of states) {
    const recorder = recordingCanvas(), effect = sampleScreenEffects(screen, state, msAt(4));
    drawScreenEffects(recorder.ctx, effect);
    signatures.add(JSON.stringify(fillSignature(recorder)));
    const first = fillSignature(recorder);
    recorder.reset();
    drawScreenEffects(recorder.ctx, sampleScreenEffects(screen, state, msAt(4)));
    assert.deepEqual(fillSignature(recorder), first);
    if (state === 'idle') {
      assert.equal(first.length, 2, 'One dark screen and one isolated LED');
      assert.equal(first[0].fillStyle, '#090f14');
      assert.equal(effect.key, sampleScreenEffects(screen, state, msAt(1000)).key);
    }
    recorder.balanced();
  }
  assert.equal(signatures.size, 6, 'Not merely six labels or tint changes: six different primitive sequences');
  assert.throws(() => sampleScreenEffects(screen, 'working', 0));
  assert.throws(() => sampleScreenEffects(screen, 'idle', NaN));
  assert.throws(() => sampleScreenEffects(screen, 'idle', 0, { reducedMotion: 'yes' }));
});

test('screen polygon masks contain every effect pixel for skewed/concave/reversed bounds and never leak to the body', async () => {
  const polygons = [
    fixture().directions.down.furniture.screen.polygon,
    [[24, 24], [120, 28], [140, 50], [74, 68], [88, 110], [26, 100]],
    [[1, 1], [10, 1], [10, 10], [1, 10]].reverse(),
  ];
  let sampledPixels = 0;
  for (const polygon of polygons) {
    const screen = { visible: true, polygon, led: [160, 165, 2, 3] };
    validateScreenConfig(screen);
    for (const state of states) {
      for (const tick of [0, 4, 10, 23]) {
        const recorder = recordingCanvas();
        drawScreenEffects(recorder.ctx, sampleScreenEffects(screen, state, msAt(tick)));
        const pixels = screenPixels(recorder);
        sampledPixels += pixels.size;
        for (const pixel of pixels) {
          const [x, y] = pixel.split(':').map(Number), point = [x + 0.5, y + 0.5];
          assert.ok(pointInPolygon(point, polygon) || inRect(point, screen.led), `${state} lit outside the configured mask: ${pixel}`);
        }
        for (const fill of recorder.calls.filter(c => c.op === 'fillRect')) assert.equal(fill.clips.length, 1);
        recorder.balanced();
      }
    }
  }
  assert.ok(sampledPixels > 10000);
  const { player, recorder } = await initialized();
  for (const state of states) {
    player.setState(state);
    renderFrame(player, recorder, 9);
    for (const draw of imageCalls(recorder)) {
      if (draw.args.length === 8) assert.equal(draw.clips[0][0].op, 'ellipse');
      else assert.deepEqual(draw.clips, [], 'Furniture/body not inside an effect mask');
    }
    assert.ok(recorder.calls.find(c => c.op === 'clearRect' && c.args.join() === '0,0,192,192'));
  }
});

test('rear/hidden monitors draw only a separately masked LED, never a transmitted screen polygon', () => {
  const front = fixture().directions.down.furniture.screen;
  const back = { ...front, visible: false };
  for (const state of states) {
    const recorder = recordingCanvas();
    drawScreenEffects(recorder.ctx, sampleScreenEffects(back, state, msAt(4)));
    const fills = fillSignature(recorder);
    assert.equal(fills.length, 1);
    assert.deepEqual(fills[0].args, back.led);
    assert.equal(fills[0].clips[0][0].op, 'rect');
    assert.equal(recorder.calls.some(c => c.op === 'moveTo' || c.op === 'lineTo'), false);
    for (const pixel of screenPixels(recorder)) {
      const [x, y] = pixel.split(':').map(Number);
      assert.ok(inRect([x + 0.5, y + 0.5], back.led));
    }
    recorder.balanced();
  }
  const recorder = recordingCanvas();
  drawScreenEffects(recorder.ctx, sampleScreenEffects({ visible: false }, 'writing', 0));
  drawScreenEffects(recorder.ctx, sampleScreenEffects(undefined, 'writing', 0));
  assert.equal(recorder.calls.length, 0);
});

test('error screen is a gentle periodic double pulse, with two peaks and no high-opacity flash', () => {
  const screen = fixture().directions.down.furniture.screen;
  const pulses = Array.from({ length: 24 }, (_, tick) => sampleScreenEffects(screen, 'error', msAt(tick)).pulse);
  assert.ok(pulses.every(pulse => pulse >= 0.10 && pulse <= 0.26));
  const peaks = pulses.flatMap((value, i) => value > pulses[(i + 23) % 24] && value > pulses[(i + 1) % 24] ? [i] : []);
  assert.deepEqual(peaks, [4, 10]);
  assert.ok(pulses[4] > pulses[10]);
  assert.equal(pulses[0], pulses[23]);
  assert.equal(sampleScreenEffects(screen, 'error', msAt(28)).pulse, pulses[4]);
  assert.equal(sampleScreenEffects(screen, 'error', msAt(4), { reducedMotion: true }).pulse,
    sampleScreenEffects(screen, 'error', msAt(10), { reducedMotion: true }).pulse);
});

test('reducedMotion changes only screen motion, never facial frame/state/clock/body across all states/directions', async () => {
  const { player, recorder } = await initialized();
  for (const direction of directions) {
    await player.setDirection(direction);
    for (const state of states) {
      player.setState(state); player.sample(msAt(7));
      const before = player.snapshot();
      recorder.reset();
      player.setReducedMotion(true);
      const reduced = player.snapshot();
      for (const key of ['state', 'action', 'direction', 'sampleMs', 'tick', 'clock', 'frame', 'faceFrame', 'bodyPlacement']) {
        assert.deepEqual(reduced[key], before[key], `${direction}/${state}: reducedMotion changed ${key}`);
      }
      const first = fillSignature(recorder);
      recorder.reset();
      player.sample(msAt(19));
      const next = player.snapshot();
      assert.equal(next.faceFrame, 19 % clocks[BUSINESS_STATES[state]] < 12 ? 19 % clocks[BUSINESS_STATES[state]] : 0);
      assert.equal(next.screen.key, reduced.screen.key);
      if (recorder.calls.length) assert.deepEqual(fillSignature(recorder), first);
      recorder.balanced();
      player.reducedMotion = false;
      assert.equal(player.reducedMotion, false);
      assert.equal(player.faceFrame, next.faceFrame);
      player.setReducedMotion(false);
      recorder.reset();
      assert.equal(player.setReducedMotion(false), false);
      assert.equal(recorder.calls.length, 0);
    }
  }
  const before = player.snapshot();
  assert.throws(() => player.setReducedMotion(1));
  assert.throws(() => { player.reducedMotion = 'true'; });
  assert.deepEqual(player.snapshot(), before);
  for (const state of states) {
    const screen = fixture().directions.down.furniture.screen, recorder = recordingCanvas();
    drawScreenEffects(recorder.ctx, sampleScreenEffects(screen, state, msAt(1), { reducedMotion: true }));
    const first = fillSignature(recorder);
    recorder.reset();
    drawScreenEffects(recorder.ctx, sampleScreenEffects(screen, state, msAt(333), { reducedMotion: true }));
    assert.deepEqual(fillSignature(recorder), first);
  }
});

test('context save/restore is balanced even if a face or screen draw throws', async () => {
  const { player, recorder } = await initialized();
  const originalDraw = recorder.ctx.drawImage;
  recorder.ctx.drawImage = (image, ...args) => {
    if (args.length === 8) throw new Error('fixture face draw failure');
    originalDraw(image, ...args);
  };
  assert.throws(() => player.setFrame(9), /face draw failure/);
  recorder.balanced();
  recorder.ctx.drawImage = originalDraw;
  assert.equal(player.setFrame(9), true, 'Failed draw must not mark a frame as already rendered');
  const effectRecorder = recordingCanvas(), originalFill = effectRecorder.ctx.fillRect;
  effectRecorder.ctx.fillRect = () => { throw new Error('fixture screen draw failure'); };
  assert.throws(() => drawScreenEffects(effectRecorder.ctx, sampleScreenEffects(fixture().directions.down.furniture.screen, 'error', 0)), /screen draw failure/);
  effectRecorder.balanced();
  effectRecorder.ctx.fillRect = originalFill;
});

test('initialize does not return an unready player when its initial direction is superseded by another load', async () => {
  const assets = fixture(), fake = loaderFor(assets), recorder = recordingCanvas();
  const downGate = deferred(), leftGate = deferred(), downStarted = deferred(), leftStarted = deferred();
  const loader = async url => {
    if (url.endsWith('/media/character-base.png')) { downStarted.resolve(); await downGate.promise; }
    if (url.endsWith('character-left/character-base.png')) { leftStarted.resolve(); await leftGate.promise; }
    return fake.loader(url);
  };
  const player = new DirectionalSeatedPlayer(recorder.canvas, assets, { baseUrl, imageLoader: loader });
  let initializedAlready = false;
  const init = player.initialize().then(value => { initializedAlready = true; return value; });
  await downStarted.promise;
  const direction = player.setDirection('left'); await leftStarted.promise;
  downGate.resolve();
  // Drain the finite chain of async image/decode/commit continuations without timers.
  for (let i = 0; i < 25; i++) await Promise.resolve();
  assert.equal(player.ready, false);
  const early = initializedAlready;
  leftGate.resolve();
  await direction;
  const result = await init;
  assert.equal(early, false, 'initialize must wait for the superseding direction to finish');
  assert.equal(result, player);
  assert.equal(player.ready, true);
  assert.equal(player.direction, 'left');
  recorder.balanced();
});

test('initialize respects an already pending explicit direction and does not overwrite it with the default down', async () => {
  const assets = fixture(), fake = loaderFor(assets), recorder = recordingCanvas();
  const gate = deferred(), started = deferred();
  const loader = async url => {
    if (url.endsWith('character-left/character-base.png')) { started.resolve(); await gate.promise; }
    return fake.loader(url);
  };
  const player = new DirectionalSeatedPlayer(recorder.canvas, assets, { baseUrl, imageLoader: loader });
  const change = player.setDirection('left'); await started.promise;
  const init = player.initialize();
  player.setState('idle'); player.sample(msAt(37));
  gate.resolve();
  await Promise.all([change, init]);
  assert.equal(player.ready, true);
  assert.equal(player.direction, 'left');
  assert.equal(player.state, 'idle');
  assert.equal(player.faceFrame, 1);
  assert.equal(fake.calls.length, 7, 'Do not load an unrequested fallback during initialization');
});

test('invalid canvas, loader and reduce-motion options fail before loading any textures', () => {
  const assets = fixture();
  for (const canvas of [null, {}, { getContext: () => null }]) {
    assert.throws(() => new DirectionalSeatedPlayer(canvas, assets), /Canvas 2D/);
  }
  assert.throws(() => new DirectionalSeatedPlayer(recordingCanvas().canvas, assets, { imageLoader: null }), /imageLoader/);
  assert.throws(() => new DirectionalSeatedPlayer(recordingCanvas().canvas, assets, { reducedMotion: 1 }), /reducedMotion/);
  assert.throws(() => new DirectionalSeatedPlayer(recordingCanvas().canvas, assets, { direction: 'rotate-down' }), /方向只允许/);
});
