import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const breedRoot = path.join(root, 'frontend/company-office/media/character-breeds');
const profiles = ['orange-cat-v1','ragdoll-v1','british-shorthair-v1','american-shorthair-v1','tabby-v1','tuxedo-cat-v1','white-lion-cat-v1','jianzhou-cat-v1'];
const directions = ['up','down','left','right'];
const actions = ['working','idle','syncing','error'];
function pngSize(file) {
  const b = fs.readFileSync(file);
  assert.equal(b.readUInt32BE(0), 0x89504e47, `${file}: PNG signature`);
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

function decodeRgba(file) {
  const b = fs.readFileSync(file);
  const chunks = [];
  let p = 8;
  let width = 0; let height = 0; let bitDepth = 0; let colorType = 0;
  while (p < b.length) {
    const n = b.readUInt32BE(p); const type = b.toString('ascii', p + 4, p + 8);
    const body = b.subarray(p + 8, p + 8 + n); p += 12 + n;
    if (type === 'IHDR') { width = body.readUInt32BE(0); height = body.readUInt32BE(4); bitDepth = body[8]; colorType = body[9]; }
    if (type === 'IDAT') chunks.push(body);
    if (type === 'IEND') break;
  }
  assert.equal(bitDepth, 8, `${file}: only 8-bit PNGs are supported by the content gate`);
  assert.equal(colorType, 6, `${file}: atlas must be RGBA PNG`);
  const raw = zlib.inflateSync(Buffer.concat(chunks));
  const stride = width * 4; const data = Buffer.alloc(height * stride); let src = 0;
  const paeth = (a, b, c) => { const q = a + b - c; const pa = Math.abs(q - a); const pb = Math.abs(q - b); const pc = Math.abs(q - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
  for (let y = 0; y < height; y++) {
    const filter = raw[src++]; const row = data.subarray(y * stride, (y + 1) * stride); const prev = y ? data.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const left = x >= 4 ? row[x - 4] : 0; const up = prev ? prev[x] : 0; const ul = prev && x >= 4 ? prev[x - 4] : 0;
      const v = raw[src++]; row[x] = filter === 0 ? v : filter === 1 ? (v + left) & 255 : filter === 2 ? (v + up) & 255 : filter === 3 ? (v + Math.floor((left + up) / 2)) & 255 : (v + paeth(left, up, ul)) & 255;
    }
  }
  return { width, height, data };
}

function cellData(decoded, index) {
  const x0 = (index % 4) * 192; const y0 = Math.floor(index / 4) * 192; const out = Buffer.alloc(192 * 192 * 4); let q = 0;
  let minX = 192; let minY = 192; let maxX = -1; let maxY = -1;
  for (let y = 0; y < 192; y++) {
    const row = decoded.data.subarray((y0 + y) * decoded.width * 4 + x0 * 4, (y0 + y + 1) * decoded.width * 4);
    for (let x = 0; x < 192; x++) { out[q++] = row[x * 4]; out[q++] = row[x * 4 + 1]; out[q++] = row[x * 4 + 2]; const a = out[q++] = row[x * 4 + 3]; if (a) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x + 1); maxY = Math.max(maxY, y + 1); } }
  }
  return { bytes: out, bbox: [minX, minY, maxX, maxY] };
}

function faceMask(spec) {
  const [fx, fy, fw, fh] = spec.faceRect;
  const [cx, cy, rx, ry] = spec.faceClipEllipse;
  return Uint8Array.from({length: 192 * 192}, (_, p) => {
    const x = p % 192, y = Math.floor(p / 192);
    return x >= fx && x < fx + fw && y >= fy && y < fy + fh && ((x + .5 - cx) / rx) ** 2 + ((y + .5 - cy) / ry) ** 2 <= 1 ? 1 : 0;
  });
}

function repairedFeatureMask(spec) {
  const contains = ([l,t,r,b], x, y) => x >= l && x < r && y >= t && y < b;
  const regions = [...spec.eyeBounds, spec.mouthBounds];
  for (const region of [...regions, spec.noseBounds]) {
    assert.equal(region.length, 4);
    assert.ok(region.every(Number.isInteger));
    const [l,t,r,b] = region;
    assert.ok(l >= 0 && t >= 0 && r <= 192 && b <= 192 && l < r && t < b, 'facial repair bounds must fit the source cell');
  }
  return Uint8Array.from({length: 192 * 192}, (_, p) => {
    const x = p % 192, y = Math.floor(p / 192);
    return regions.some(region => contains(region, x, y)) && !contains(spec.noseBounds, x, y) ? 1 : 0;
  });
}

function assertFixedFrame(base, frame, mask, label) {
  for (let p = 0; p < mask.length; p++) {
    const i = p * 4;
    if (frame[i + 3] !== base[i + 3]) assert.fail(`${label}: alpha differs from base at ${p % 192},${Math.floor(p / 192)}`);
    if (!mask[p] && (frame[i] !== base[i] || frame[i + 1] !== base[i + 1] || frame[i + 2] !== base[i + 2])) {
      assert.fail(`${label}: body/outline changed outside face at ${p % 192},${Math.floor(p / 192)}`);
    }
  }
}

function visibleMotionPixels(first, next, mask) {
  let changed = 0;
  for (let p = 0; p < mask.length; p++) {
    const i = p * 4, alpha = Math.min(first[i + 3], next[i + 3]);
    // Compare visible, composited colour. Hidden RGB or one-level noise cannot
    // turn twelve repeated stills into a passing animation.
    if (!mask[p] || alpha < 128) continue;
    const delta = Math.max(...[0, 1, 2].map(c => Math.abs(first[i + c] - next[i + c]))) * alpha / 255;
    if (delta >= 16) changed++;
  }
  return changed;
}

function assertVisibleMotion(frames, mask, label) {
  const largestChange = Math.max(...frames.slice(1).map(frame => visibleMotionPixels(frames[0], frame, mask)));
  assert.ok(largestChange >= 8, `${label}: no meaningful expression motion (${largestChange} changed visible pixels)`);
}

test('all profiles expose immutable full-frame atlases', () => {
  for (const profile of profiles) {
    const dir = path.join(breedRoot, profile);
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json')));
    assert.equal(manifest.schemaVersion, 2); assert.equal(manifest.manifestContractVersion, 2); assert.equal(manifest.animationMode, 'full-frame');
    assert.deepEqual(manifest.grid, [4,3]); assert.equal(manifest.frameCount, 12); assert.equal(manifest.fps, 12);
    for (const direction of directions) {
      const c = manifest.directions[direction]; assert.equal(c.animationMode, 'full-frame');
      for (const forbidden of ['faceRect','faceClipEllipse','faceFrameSize','pixelFaceAnimation']) assert.equal(forbidden in c, false, `${profile}/${direction}/${forbidden}`);
      for (const action of actions) {
        const a = c.actions[action]; assert.equal(a.frameCount, 12); assert.equal(a.fps, 12);
        assert.equal(a.frames.startsWith(`./${direction}/frames-${action}.png`), true);
        assert.deepEqual(pngSize(path.join(dir, a.frames.slice(2))), [768,576]);
      }
    }
  }
});

test('all 84 non-orange visible atlases animate only the face and retain base alpha', () => {
  const repairs = JSON.parse(fs.readFileSync(path.join(root,
    'assets/character-animation-repairs/2026-10-30-fixed-body/source/facial-repair-overrides.json')));
  for (const profile of profiles.filter((p) => p !== 'orange-cat-v1')) {
    const dir = path.join(breedRoot, profile);
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json')));
    // Measured eye/mouth areas replace the broad historical face ellipse.
    // Nose, forehead stripes, cheeks and every outside pixel stay immutable.
    for (const direction of directions.filter((d) => manifest.directions[d].faceVisible !== false)) {
      const c = manifest.directions[direction];
      const features = repairs.profiles[profile][direction];
      assert.equal(features.eyeBounds.length, direction === 'down' ? 2 : 1);
      const mask = repairedFeatureMask(features);
      const base = decodeRgba(path.join(dir, c.base.slice(2)));
      assert.deepEqual([base.width, base.height], [192, 192]);
      const firstHashes = {};
      for (const action of actions) {
        const label = `${profile}/${direction}/${action}`;
        const atlas = decodeRgba(path.join(dir, c.actions[action].frames.slice(2)));
        assert.deepEqual([atlas.width, atlas.height], [768, 576], `${label}: atlas dimensions`);
        const frames = Array.from({length: 12}, (_, i) => cellData(atlas, i).bytes);
        frames.forEach((frame, i) => assertFixedFrame(base.data, frame, mask, `${label}/frame${i}`));
        assertVisibleMotion(frames, mask, label);
        firstHashes[action] = crypto.createHash('sha256').update(frames[0]).digest('hex');
      }
      assert.equal(new Set(['idle', 'syncing', 'error'].map(action => firstHashes[action])).size, 3, `${profile}/${direction}: idle/syncing/error frame 0 must differ`);
    }
  }
});

test('all non-orange rear states preserve the same complete base pixels', () => {
  for (const profile of profiles.filter(p => p !== 'orange-cat-v1')) {
    const dir = path.join(breedRoot, profile);
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json')));
    const rear = manifest.directions.up;
    assert.equal(rear.faceVisible, false, `${profile}: rear must not animate a face`);
    const base = decodeRgba(path.join(dir, rear.base.slice(2)));
    for (const action of actions) {
      const atlas = decodeRgba(path.join(dir, rear.actions[action].frames.slice(2)));
      for (let i = 0; i < 12; i++) {
        assert.ok(cellData(atlas, i).bytes.equals(base.data),
          `${profile}/up/${action}/frame${i}: static rear must preserve base RGBA, including translucent edges`);
      }
    }
  }
});

test('content gate rejects ghost alpha, body drift, stills and invisible noise', () => {
  const base = Buffer.alloc(192 * 192 * 4, 120);
  for (let i = 3; i < base.length; i += 4) base[i] = 255;
  const mask = faceMask({faceRect: [45, 54, 102, 58], faceClipEllipse: [96, 83, 51, 29]});
  const ghost = Buffer.from(base);
  for (let i = 3; i < ghost.length; i += 4) ghost[i] = 32;
  assert.throws(() => assertFixedFrame(base, ghost, mask, 'ghost'), /alpha differs/);
  const drift = Buffer.from(base); drift[(140 * 192 + 96) * 4] = 255;
  assert.throws(() => assertFixedFrame(base, drift, mask, 'drift'), /body\/outline changed/);
  assert.throws(() => assertVisibleMotion(Array(12).fill(base), mask, 'stills'), /no meaningful expression motion/);
  const noise = Buffer.from(base);
  for (let p = 0; p < mask.length; p++) if (mask[p]) noise[p * 4]++;
  assert.throws(() => assertVisibleMotion([base, noise], mask, 'noise'), /no meaningful expression motion/);
  const faint = Buffer.from(base), faintNext = Buffer.from(base);
  for (let p = 0; p < mask.length; p++) if (mask[p]) { faint[p * 4 + 3] = faintNext[p * 4 + 3] = 1; faintNext[p * 4] = 255; }
  assert.throws(() => assertVisibleMotion([faint, faintNext], mask, 'hidden'), /no meaningful expression motion/);
  const blink = Buffer.from(base); let changed = 0;
  for (let p = 0; p < mask.length && changed < 8; p++) if (mask[p]) { blink[p * 4] = 20; changed++; }
  assert.doesNotThrow(() => assertFixedFrame(base, blink, mask, 'blink'));
  assert.doesNotThrow(() => assertVisibleMotion([base, blink], mask, 'blink'));
});
