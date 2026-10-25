#!/usr/bin/env node
/** Executable API + actual Canvas pixel tests. No page/runtime/backend mutations. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import {
  SCREEN_STYLES, validateScreenConfig, sampleScreenEffects,
  drawScreenEffects, BenchScreenOverlay,
} from '../frontend/company-office/connected-v5/screen-overlay.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let require = createRequire(import.meta.url);
try { require.resolve('@napi-rs/canvas'); } catch {
  require = createRequire(process.env.OFFICE_QA_NODE_PACKAGE || resolve(homedir(),
    '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/__screen_qa__.cjs'));
}
const { createCanvas } = require('@napi-rs/canvas');
const states = Object.keys(SCREEN_STYLES);
const front = { kind: 'front', seatId: 'front', polygon: [[20, 16], [172, 26], [158, 176], [24, 165]] };
const concave = { kind: 'front', seatId: 'concave', polygon: [[16, 16], [176, 16], [176, 78], [84, 78], [84, 176], [16, 176]] };
const thin = { kind: 'front', seatId: 'thin', polygon: [[90, 0], [96, 0], [96, 192], [90, 192]] };
const rear = { kind: 'back', seatId: 'rear', led: [64, 84, 2, 2], polygon: front.polygon };
const source = { kind: 'front', seatId: 'source', polygon: [[840, 500], [1090, 515], [1070, 735], [850, 715]], led: [1080, 748, 3, 2] };
const tickTime = frame => Math.ceil(frame * 1000 / 12);
const pixels = canvas => canvas.getContext('2d').getImageData(0, 0, 192, 192).data;
const hash = canvas => createHash('sha256').update(pixels(canvas)).digest('hex');
const render = (config, state, ms = 0, options = {}) => {
  const canvas = createCanvas(192, 192);
  drawScreenEffects(canvas.getContext('2d'), sampleScreenEffects(config, state, ms, options), options);
  return canvas;
};
function allowedMask(config) {
  const canvas = createCanvas(192, 192), ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  if (config.kind === 'front') {
    ctx.beginPath(); ctx.moveTo(...config.polygon[0]);
    for (const point of config.polygon.slice(1)) ctx.lineTo(...point);
    ctx.closePath(); ctx.save(); ctx.clip(); ctx.fillRect(0, 0, 192, 192); ctx.restore();
  }
  if (config.led) ctx.fillRect(...(config.led.length === 2 ? [...config.led, 2, 2] : config.led));
  return pixels(canvas);
}
function assertClipped(canvas, config) {
  const actual = pixels(canvas), allowed = allowedMask(config);
  let lit = 0;
  for (let i = 3; i < actual.length; i += 4) {
    if (actual[i]) {
      lit++;
      assert.ok(allowed[i], `escaped pixel ${((i - 3) / 4) % 192},${Math.floor((i - 3) / 4 / 192)}`);
    }
  }
  assert.ok(lit > 0, 'a metadata-only or empty renderer is not sufficient');
  return lit;
}
function recorder() {
  const ctx = createCanvas(192, 192).getContext('2d'), calls = [];
  const proxy = new Proxy(ctx, {
    get(target, prop) {
      const value = target[prop];
      if (typeof value !== 'function') return value;
      return (...args) => { calls.push([prop, ...args]); return value.apply(target, args); };
    },
    set(target, prop, value) { target[prop] = value; return true; },
  });
  return { ctx: proxy, calls };
}
function fixture(screen = source) {
  const previous = globalThis.document, allocations = [], sprites = [];
  globalThis.document = { createElement() {
    const canvas = createCanvas(192, 192);
    canvas.dataset = {}; canvas.setAttribute = () => {};
    return canvas;
  } };
  const scene = {
    textures: { addCanvas(key, canvas) {
      const texture = { key, canvas, refreshes: 0, refresh() { this.refreshes++; } };
      allocations.push(texture); return texture;
    } },
    add: { image(x, y, key) {
      const sprite = { x, y, key,
        setOrigin(value) { this.origin = value; return this; },
        setDisplaySize(w, h) { this.size = [w, h]; return this; },
        setDepth(value) { this.depth = value; return this; },
      };
      sprites.push(sprite); return sprite;
    } },
  };
  const transform = { x: 10, y: 20, scale: 0.5 };
  return { allocations, sprites, transform, screen,
    create: () => new BenchScreenOverlay(scene, screen, transform, 'screen-test'),
    cleanup() { if (previous === undefined) delete globalThis.document; else globalThis.document = previous; },
  };
}

await test('six states preserved; normalized validation copies and does not mutate', () => {
  assert.deepEqual(states, ['idle', 'writing', 'researching', 'executing', 'syncing', 'error']);
  const copy = structuredClone(front), valid = validateScreenConfig(front);
  assert.deepEqual(front, copy); assert.notEqual(valid.polygon, front.polygon);
  assert.deepEqual(validateScreenConfig(valid), valid);
  assert.equal(sampleScreenEffects(rear, 'writing', 0).ledOnly, true);
  assert.throws(() => validateScreenConfig(source), /192x192/);
});

await test('invalid normalized polygons, LEDs, states, clocks and options fail closed', () => {
  for (const polygon of [null, [], [[1, 1], [2, 2], [3, 3]], [[0, 0], [192, 0], [0, 193]],
    [[0, 0], [192, 192], [192, 0], [0, 192]],
    [[0, 0], [100, 100], [0, 100], [100, 0], [120, 50]],
    [[0, 0], [100, 0], [100, 100], [100, 0], [0, 100]],
    [[NaN, 0], [100, 0], [100, 100]], [[-1, 0], [100, 0], [100, 100]]]) {
    assert.throws(() => sampleScreenEffects({ ...front, polygon }, 'writing', 0));
  }
  for (const led of [[0, 0, 0, 2], [-1, 0], [191, 191, 2, 2], [Infinity, 0], 'LED', {}]) {
    assert.throws(() => validateScreenConfig({ ...rear, led }));
  }
  assert.throws(() => sampleScreenEffects(front, 'working', 0), /unsupported/);
  for (const ms of [NaN, Infinity, '0', Number.MAX_VALUE]) assert.throws(() => sampleScreenEffects(front, 'writing', ms));
  assert.throws(() => sampleScreenEffects(front, 'writing', 0, { reducedMotion: 'false' }));
  assert.equal(sampleScreenEffects(front, 'writing', -1).key, sampleScreenEffects(front, 'writing', 0).key);
});

await test('12fps determinism, cursor blink and progressive code-line addition', () => {
  const first = sampleScreenEffects(front, 'writing', 0);
  assert.equal(first.key, sampleScreenEffects(front, 'writing', 70).key);
  assert.equal(first.cursorVisible, true);
  assert.equal(sampleScreenEffects(front, 'writing', tickTime(4)).cursorVisible, false);
  const grown = sampleScreenEffects(front, 'writing', tickTime(7));
  assert.equal(grown.activeCodeLine, first.activeCodeLine);
  assert.ok(grown.typingProgress > first.typingProgress);
  assert.equal(sampleScreenEffects(front, 'writing', tickTime(8)).activeCodeLine, first.activeCodeLine + 1);
  assert.equal(sampleScreenEffects(front, 'writing', 4000).key, first.key);
  assert.notEqual(first.key, sampleScreenEffects(concave, 'writing', 0).key);
});

for (const state of ['writing', 'researching', 'executing']) {
  await test(`${state}: 48 actual raster frames vary, remain dark and contain syntax token colors`, () => {
    const hashes = new Set(); let maximumMean = 0;
    for (let frame = 0; frame < 48; frame++) {
      const canvas = render(front, state, tickTime(frame));
      hashes.add(hash(canvas)); assertClipped(canvas, front);
      const data = pixels(canvas); let sum = 0, count = 0;
      for (let i = 0; i < data.length; i += 4) if (data[i + 3]) {
        sum += (data[i] + data[i + 1] + data[i + 2]) / 3; count++;
      }
      maximumMean = Math.max(maximumMean, sum / count);
    }
    assert.equal(hashes.size, 48, 'not just varying sampler metadata');
    assert.ok(maximumMean < 65, `dark editor expected, got ${maximumMean}`);
    const data = pixels(render(front, state, 1250));
    let purple = 0, blue = 0, green = 0;
    for (let i = 0; i < data.length; i += 4) {
      const [r, g, b, a] = data.slice(i, i + 4);
      if (a > 200 && r > 100 && b > 110 && r > g * 1.12 && b > g * 1.1) purple++;
      if (a > 200 && b > 130 && b > r * 1.15) blue++;
      if (a > 200 && g > 130 && g > b * 1.12) green++;
    }
    assert.ok(purple > 2 && blue > 2, `expected colored keyword/identifier glyphs: ${purple}/${blue}`);
    if (state === 'executing') assert.ok(green > 2, 'terminal needs green output');
  });
}

await test('draw API emits real code strings, indentation, search query and terminal output', () => {
  const a = recorder(), b = recorder(), c = recorder();
  drawScreenEffects(a.ctx, sampleScreenEffects(front, 'writing', tickTime(47)));
  drawScreenEffects(b.ctx, sampleScreenEffects(front, 'researching', tickTime(6)));
  drawScreenEffects(c.ctx, sampleScreenEffects(front, 'executing', tickTime(15)));
  const texts = r => r.calls.filter(x => x[0] === 'fillText').map(x => x[1]);
  assert.ok(texts(a).includes('async function '));
  assert.ok(texts(a).includes('"ready"'));
  assert.ok(texts(b).some(x => x.startsWith('> run')));
  assert.ok(texts(c).some(x => x.startsWith('PASS ')));
  const run = a.calls.find(x => x[0] === 'fillText' && x[1] === 'async function ');
  const indented = a.calls.find(x => x[0] === 'fillText' && x[1] === 'const ');
  assert.ok(indented[2] > run[2], 'code row should actually be indented');
});

await test('every state is clipped in actual pixels, including concave polygon and front LED', () => {
  for (const config of [front, concave, { ...front, led: [180, 180, 3, 2] }]) {
    for (const state of states) for (const ms of [0, 334, 1250, 3917]) assertClipped(render(config, state, ms), config);
  }
  assert.equal(new Set(states.map(s => hash(render(front, s, 500)))).size, 6);
});

await test('clip restores caller state and preserves every pixel outside its real polygon', () => {
  const canvas = createCanvas(192, 192), ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ee4488'; ctx.fillRect(0, 0, 192, 192);
  const before = pixels(canvas).slice(), mask = allowedMask(front);
  ctx.globalAlpha = 0.37; const originalAlpha = ctx.globalAlpha; ctx.font = '17px serif'; ctx.textBaseline = 'bottom'; ctx.fillStyle = '#123456';
  drawScreenEffects(ctx, sampleScreenEffects(front, 'writing', 800));
  const after = pixels(canvas);
  for (let i = 3; i < mask.length; i += 4) if (!mask[i]) assert.deepEqual(after.slice(i - 3, i + 1), before.slice(i - 3, i + 1));
  assert.equal(ctx.globalAlpha, originalAlpha);
  assert.equal(ctx.font, '17px serif'); assert.equal(ctx.textBaseline, 'bottom');
  ctx.fillStyle = '#ffffff'; ctx.globalAlpha = 1; ctx.fillRect(0, 0, 1, 1);
  assert.deepEqual(Array.from(pixels(canvas).slice(0, 4)), [255, 255, 255, 255], 'clip must not escape its save/restore scope');
});

await test('narrow sides are low brightness, animated and have NO text/line primitives', () => {
  for (const state of states) {
    const r = recorder(); drawScreenEffects(r.ctx, sampleScreenEffects(thin, state, 500), { thin: true });
    assert.equal(r.calls.filter(c => c[0] === 'fillText' || c[0] === 'strokeText' || c[0] === 'stroke').length, 0);
    assert.equal(r.calls.filter(c => c[0] === 'fillRect').length, 2, 'only flat palette and soft glow');
    const canvas = render(thin, state, 500, { thin: true }); assertClipped(canvas, thin);
    const data = pixels(canvas); let maximum = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i + 3]) maximum = Math.max(maximum, (data[i] + data[i + 1] + data[i + 2]) / 3);
    assert.ok(maximum < 65, `${state} side display too bright: ${maximum}`);
  }
  assert.notEqual(hash(render(thin, 'writing', 0, { thin: true })), hash(render(thin, 'writing', 500, { thin: true })));
});

await test('rear casing polygon is ignored: only the isolated LED pixels are painted', () => {
  for (const state of states) for (const ms of [0, 500, 1250]) {
    const canvas = render(rear, state, ms);
    assert.equal(assertClipped(canvas, rear), 4);
    const r = recorder(); drawScreenEffects(r.ctx, sampleScreenEffects(rear, state, ms));
    assert.equal(r.calls.filter(c => c[0] === 'fillText' || c[0] === 'moveTo').length, 0);
    assert.equal(r.calls.filter(c => c[0] === 'fillRect').length, 1);
  }
});

await test('reducedMotion output is pixel-identical at all times for all modes/states', () => {
  for (const config of [front, rear, thin]) for (const state of states) {
    const options = { reducedMotion: true, thin: config === thin };
    const start = hash(render(config, state, 0, options));
    for (const ms of [84, 500, 1250, 3917, 9999]) assert.equal(hash(render(config, state, ms, options)), start);
  }
});

await test('source>192 constructor normalizes only drawing, preserves source snapshot and world geometry', () => {
  const f = fixture();
  try {
    const copy = structuredClone(source), overlay = f.create();
    assert.equal(overlay.components.length, 2);
    assert.deepEqual(overlay.components[0].bounds, [840, 500, 250, 235]);
    assert.deepEqual([f.sprites[0].x, f.sprites[0].y, ...f.sprites[0].size], [430, 270, 125, 117.5]);
    assert.deepEqual(overlay.components[1].bounds, source.led);
    assert.deepEqual([f.sprites[1].x, f.sprites[1].y, ...f.sprites[1].size], [550, 394, 1.5, 1]);
    assert.deepEqual(overlay.snapshot().polygon, source.polygon);
    assert.deepEqual(overlay.snapshot().led, source.led);
    assert.deepEqual(source, copy);
    overlay.snapshot().polygon[0][0] = -1;
    assert.deepEqual(overlay.snapshot().polygon, source.polygon);
    assert.equal(overlay.sample('writing', 0), true);
    const start = hash(overlay.components[0].canvas);
    assert.equal(overlay.sample('writing', 70), false);
    assert.equal(overlay.sample('writing', 500), true);
    assert.notEqual(hash(overlay.components[0].canvas), start);
    for (const c of overlay.components) assertClipped(c.canvas, c.config);
    assert.equal(f.allocations[0].refreshes, 2);
  } finally { f.cleanup(); }
});

await test('point-shaped source LED keeps source snapshot and defaults to a 2x2 world rectangle', () => {
  const f = fixture({ ...source, led: [1080, 748] });
  try {
    const overlay = f.create();
    assert.deepEqual(overlay.snapshot().led, [1080, 748]);
    assert.deepEqual(overlay.components[1].bounds, [1080, 748, 2, 2]);
    assert.ok(overlay.sample('executing', 500));
    assertClipped(overlay.components[1].canvas, overlay.components[1].config);
  } finally { f.cleanup(); }
});

await test('illegal source LEDs fail before ANY texture/sprite allocation (front AND back)', () => {
  const invalid = [null, false, {}, 'led', [], [300], [300, 400, 2], [300, 400, 2, 2, 2],
    [-1, 400], [300, -1], [300, 400, 0, 2], [300, 400, 2, -1], [NaN, 400],
    [300, Infinity], [300, 400, NaN, 2], [Number.MAX_VALUE, 400, Number.MAX_VALUE, 2], new Array(4)];
  for (const kind of ['front', 'back']) for (const led of invalid) {
    const f = fixture({ ...source, kind, led });
    try {
      assert.throws(f.create, /invalid source LED/, `${kind}: ${JSON.stringify(led)}`);
      assert.equal(f.allocations.length, 0); assert.equal(f.sprites.length, 0);
    } finally { f.cleanup(); }
  }
});

await test('rear source constructor paints LED only; narrow source constructor never draws glyphs', () => {
  for (const config of [{ ...source, kind: 'back' }, { ...source, polygon: [[900, 400], [903, 400], [903, 530], [900, 530]] }]) {
    const f = fixture(config);
    try {
      const overlay = f.create(); overlay.sample('writing', 500);
      assert.equal(overlay.snapshot().thinSideScreen, config.kind === 'front');
      assert.equal(overlay.components.length, config.kind === 'back' ? 1 : 2);
      if (config.kind === 'back') assert.deepEqual(overlay.snapshot().polygon, []);
      for (const c of overlay.components) assertClipped(c.canvas, c.config);
    } finally { f.cleanup(); }
  }
});

await test('all 16 current bench manifest masks render six states without coordinate leakage', async () => {
  let count = 0, rearCount = 0, thinCount = 0;
  for (const orientation of ['vertical', 'horizontal']) {
    const manifest = JSON.parse(await readFile(resolve(root, `frontend/company-office/connected-v4/media/${orientation}/manifest.json`), 'utf8'));
    for (const original of manifest.screens) {
      let led = original.led;
      if (led && !Array.isArray(led)) {
        const [x, y] = led.position, radius = led.radius ?? 1;
        led = [x - radius, y - radius, 2 * radius, 2 * radius];
      }
      const config = { ...original, seatId: original.seatId ?? original.id,
        kind: original.kind ?? (original.visible === false ? 'back' : 'front'), led };
      const f = fixture(config);
      try {
        const overlay = f.create(); count++;
        if (config.kind === 'back') rearCount++;
        if (overlay.thin) thinCount++;
        for (const state of states) for (const ms of [0, 500]) {
          overlay.sample(state, ms);
          for (const c of overlay.components) assertClipped(c.canvas, c.config);
        }
      } finally { f.cleanup(); }
    }
  }
  assert.deepEqual([count, rearCount, thinCount], [16, 4, 8]);
});

await test('real Chromium Canvas: dark code raster evolves, polygon clips, source constructor works', async () => {
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    const moduleSource = await readFile(resolve(root, 'frontend/company-office/connected-v5/screen-overlay.mjs'), 'utf8');
    const report = await page.evaluate(async ({ moduleSource, front, source }) => {
      const { sampleScreenEffects, drawScreenEffects, BenchScreenOverlay } =
        await import(`data:text/javascript;base64,${btoa(moduleSource)}`);
      const reports = [];
      for (const state of ['writing', 'researching', 'executing']) {
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 192;
        const ctx = canvas.getContext('2d', { willReadFrequently: true }), hashes = new Set();
        const mask = document.createElement('canvas'); mask.width = mask.height = 192;
        const m = mask.getContext('2d');
        let escaped = 0, solidEscaped = 0, maximumMean = 0;
        const texts = [], colors = new Set(), cursorStates = new Set(), rasterGlyphCounts = [];
        const nativeFillText = ctx.fillText;
        ctx.fillText = function(text, ...args) {
          texts.push(String(text)); colors.add(this.fillStyle);
          return nativeFillText.call(this, text, ...args);
        };
        for (let f = 0; f < 48; f++) {
          ctx.clearRect(0, 0, 192, 192);
          const effect = sampleScreenEffects(front, state, Math.ceil(f * 1000 / 12));
          const beforeGlyphs = texts.length;
          cursorStates.add(effect.cursorVisible);
          m.clearRect(0, 0, 192, 192); m.beginPath(); m.moveTo(...effect.polygon[0]);
          for (const p of effect.polygon.slice(1)) m.lineTo(...p);
          m.closePath(); m.save(); m.clip(); m.fillStyle = '#ffffff'; m.fillRect(0, 0, 192, 192); m.restore();
          const allowed = m.getImageData(0, 0, 192, 192).data;
          drawScreenEffects(ctx, effect);
          rasterGlyphCounts.push(texts.length - beforeGlyphs);
          const bytes = ctx.getImageData(0, 0, 192, 192).data;
          let h = 2166136261, lit = 0, luminance = 0;
          for (let i = 0; i < bytes.length; i++) { h ^= bytes[i]; h = Math.imul(h, 16777619); }
          for (let i = 3; i < bytes.length; i += 4) if (bytes[i]) {
            if (!allowed[i]) { escaped++; if (bytes[i] >= 240) solidEscaped++; }
            lit++; luminance += (bytes[i - 3] + bytes[i - 2] + bytes[i - 1]) / 3;
          }
          hashes.add(h >>> 0); maximumMean = Math.max(maximumMean, luminance / lit);
        }
        reports.push({ state, uniqueFrames: hashes.size, escaped, solidEscaped, maximumMean, textStrings: [...new Set(texts)], textColors: [...colors], cursorStates: [...cursorStates], minimumGlyphs: Math.min(...rasterGlyphCounts) });
      }
      const scene = { textures: { addCanvas() { return { refresh() {} }; } }, add: { image() {
        return { setOrigin() { return this; }, setDisplaySize() { return this; }, setDepth() { return this; } };
      } } };
      const overlay = new BenchScreenOverlay(scene, source, { x: 0, y: 0, scale: 1 }, 'chrome-test');
      overlay.sample('writing', 500);
      return { reports, sourcePolygon: overlay.snapshot().polygon, componentCount: overlay.components.length };
    }, { moduleSource, front, source });
    console.log('Chromium raster evidence:', JSON.stringify(report));
    for (const r of report.reports) {
      assert.equal(r.uniqueFrames, 48); assert.equal(r.solidEscaped, 0); assert.ok(r.maximumMean < 65);
      assert.ok(r.minimumGlyphs >= 10); assert.ok(r.textColors.length >= 3);
      assert.deepEqual(r.cursorStates.sort(), [false, true]);
      assert.ok(r.textStrings.some(text => /^\d+$/.test(text)), 'Actual Canvas line-number glyphs');
      assert.ok(r.textStrings.includes(r.state === 'researching' ? 'search: src/*.ts' : 'src/index.ts'));
      if (r.state === 'researching') assert.ok(r.textStrings.some(text => text.startsWith('> run')));
      if (r.state === 'executing') assert.ok(r.textStrings.some(text => /test|build|passed|ready/i.test(text)));
    }
    assert.deepEqual(report.sourcePolygon, source.polygon); assert.equal(report.componentCount, 2);
  } finally { await browser.close(); }
});
