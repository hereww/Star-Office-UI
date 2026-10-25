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

function atlasMetrics(file) {
  const decoded = decodeRgba(file); assert.deepEqual([decoded.width, decoded.height], [768, 576], `${file}: atlas dimensions`);
  return Array.from({ length: 12 }, (_, i) => { const c = cellData(decoded, i); return { hash: crypto.createHash('sha256').update(c.bytes).digest('hex'), bbox: c.bbox }; });
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

test('non-orange visible states are regenerated full-frame animations', () => {
  for (const profile of profiles.filter((p) => p !== 'orange-cat-v1')) {
    const dir = path.join(breedRoot, profile);
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json')));
    for (const direction of directions.filter((d) => manifest.directions[d].faceVisible !== false)) {
      const c = manifest.directions[direction];
      const metrics = {};
      for (const action of ['idle', 'syncing', 'error']) {
        const file = path.join(dir, c.actions[action].frames.slice(2)); metrics[action] = atlasMetrics(file);
        assert.ok(new Set(metrics[action].map((x) => x.hash)).size >= 2, `${profile}/${direction}/${action}: all 12 frames are identical`);
      }
      assert.ok(new Set(['idle', 'syncing', 'error'].map((action) => metrics[action][0].hash)).size >= 3, `${profile}/${direction}: idle/syncing/error frame 0 must differ`);
      const baseFile = path.join(dir, c.base.slice(2)); const base = decodeRgba(baseFile); const alpha = [];
      for (let y = 0; y < base.height; y++) for (let x = 0; x < base.width; x++) if (base.data[(y * base.width + x) * 4 + 3]) alpha.push([x, y]);
      const target = [Math.min(...alpha.map((p) => p[0])), Math.min(...alpha.map((p) => p[1])), Math.max(...alpha.map((p) => p[0])) + 1, Math.max(...alpha.map((p) => p[1])) + 1];
      for (const action of ['idle', 'syncing', 'error']) for (const m of metrics[action]) for (let i = 0; i < 4; i++) assert.ok(Math.abs(m.bbox[i] - target[i]) <= 2, `${profile}/${direction}/${action}: frame bbox drift ${m.bbox} vs ${target}`);
    }
  }
});
