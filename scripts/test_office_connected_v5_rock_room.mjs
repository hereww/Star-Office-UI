#!/usr/bin/env node
/** Static contract and sprite validation for the connected-v5 rock-room band. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {inflateSync} from 'node:zlib';
import {readFile,stat} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateRockRoomAnimation} from '../frontend/company-office/connected-v5/rock-room-animation.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const CONNECTED_V5 = resolve(ROOT, 'frontend/company-office/connected-v5');
const ROCK_ROOM = resolve(CONNECTED_V5, 'media/rock-room');
const ROOM_BOUNDS = [708, 701, 480, 206];
const MAP_BOUNDS = [0, 0, 1584, 993];
const EXPECTED_FORBIDDEN_ROCK_ROOM = {id: 'rock-room', bounds: [700, 694, 491, 220]};
// Snapshot the already-present 16-seat layout; do not normalize/revert the user's east-row edits.
const EXPECTED_STATIONS_SHA256 = '623a58dfc1d8e26dc98d4ca7138a9a4fce9e75432f1b7c67300b15d5d71f4d8e';
const EXPECTED_PERFORMERS = [
  {
    id: 'drummer-orange-tabby',
    role: 'drummer',
    asset: './media/rock-room/drummer-orange-tabby.png',
    anchor: [948, 826],
    scale: 0.72,
    depth: 826,
    phase: 0,
  },
  {
    id: 'guitarist-gray',
    role: 'guitarist',
    asset: './media/rock-room/guitarist-gray.png',
    anchor: [806, 852],
    scale: 0.7,
    depth: 852,
    phase: 3,
  },
  {
    id: 'bassist-tuxedo',
    role: 'bassist',
    asset: './media/rock-room/bassist-tuxedo.png',
    anchor: [1090, 852],
    scale: 0.7,
    depth: 852,
    phase: 6,
  },
  {
    id: 'vocalist-cream',
    role: 'vocalist',
    asset: './media/rock-room/vocalist-cream.png',
    anchor: [948, 888],
    scale: 0.66,
    depth: 888,
    phase: 9,
  },
];
const EXPECTED_ASSETS = {
  'drummer-orange-tabby': 'drummer-orange-tabby.png',
  'guitarist-gray': 'guitarist-gray.png',
  'bassist-tuxedo': 'bassist-tuxedo.png',
  'vocalist-cream': 'vocalist-cream.png',
};
const EXPECTED_OCCLUSION_LAYERS = [
  {id: 'drum-kit-front', asset: './media/rock-room/drum-kit-front.png', depth: 830},
  {id: 'stage-mics-front', asset: './media/rock-room/stage-mics-front.png', depth: 900},
];

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function readUInt32BE(buffer, offset) {
  return buffer.readUInt32BE(offset);
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/** Minimal dependency-free PNG decoder for 8-bit RGBA, non-interlaced sheets. */
function decodePng(buffer) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  assert.deepEqual(buffer.subarray(0, 8), signature, 'PNG signature is invalid');
  let offset = 8;
  let header = null;
  const idat = [];
  let hasEnd = false;
  while (offset + 12 <= buffer.length) {
    const length = readUInt32BE(buffer, offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const start = offset + 8;
    const end = start + length;
    assert.ok(end + 4 <= buffer.length, `PNG chunk ${type} exceeds file length`);
    const data = buffer.subarray(start, end);
    if (type === 'IHDR') {
      assert.equal(length, 13, 'PNG IHDR length must be 13');
      header = {
        width: readUInt32BE(data, 0),
        height: readUInt32BE(data, 4),
        bitDepth: data[8],
        colorType: data[9],
        compression: data[10],
        filter: data[11],
        interlace: data[12],
      };
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      hasEnd = true;
      break;
    }
    offset = end + 4;
  }
  assert.ok(header, 'PNG is missing IHDR');
  assert.ok(idat.length > 0, 'PNG is missing IDAT data');
  assert.ok(hasEnd, 'PNG is missing IEND');
  assert.equal(header.bitDepth, 8, 'Rock-room sheets must use 8-bit channels');
  assert.equal(header.colorType, 6, 'Rock-room sheets must use RGBA color type');
  assert.equal(header.compression, 0, 'PNG compression method must be standard');
  assert.equal(header.filter, 0, 'PNG filter method must be standard');
  assert.equal(header.interlace, 0, 'Rock-room sheets must not be interlaced');

  const bytesPerPixel = 4;
  const stride = header.width * bytesPerPixel;
  const encoded = inflateSync(Buffer.concat(idat));
  assert.equal(encoded.length, header.height * (stride + 1), 'PNG scanline length is invalid');
  const pixels = Buffer.alloc(header.height * stride);
  let sourceOffset = 0;
  for (let y = 0; y < header.height; y += 1) {
    const filter = encoded[sourceOffset++];
    const rowStart = y * stride;
    for (let x = 0; x < stride; x += 1) {
      const raw = encoded[sourceOffset++];
      const left = x >= bytesPerPixel ? pixels[rowStart + x - bytesPerPixel] : 0;
      const above = y > 0 ? pixels[rowStart - stride + x] : 0;
      const aboveLeft = y > 0 && x >= bytesPerPixel ? pixels[rowStart - stride + x - bytesPerPixel] : 0;
      let value;
      switch (filter) {
        case 0: value = raw; break;
        case 1: value = raw + left; break;
        case 2: value = raw + above; break;
        case 3: value = raw + Math.floor((left + above) / 2); break;
        case 4: value = raw + paeth(left, above, aboveLeft); break;
        default: throw new Error(`Unsupported PNG filter type ${filter}`);
      }
      pixels[rowStart + x] = value & 0xff;
    }
  }
  return {...header, pixels};
}

function frameAlphaStats(decoded, frameWidth, frameHeight, columns, rows) {
  const frames = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      let transparent = 0;
      let visible = 0;
      let opaque = 0;
      for (let y = row * frameHeight; y < (row + 1) * frameHeight; y += 1) {
        for (let x = column * frameWidth; x < (column + 1) * frameWidth; x += 1) {
          const alpha = decoded.pixels[(y * decoded.width + x) * 4 + 3];
          if (alpha === 0) transparent += 1;
          if (alpha > 0) visible += 1;
          if (alpha === 255) opaque += 1;
        }
      }
      frames.push({frame: row * columns + column, transparent, visible, opaque});
    }
  }
  return frames;
}

function frameBounds(contract, performer) {
  return [
    performer.anchor[0] - (contract.frameSize[0] * performer.scale) / 2,
    performer.anchor[1] - contract.frameSize[1] * performer.scale,
    contract.frameSize[0] * performer.scale,
    contract.frameSize[1] * performer.scale,
  ];
}

function contains(outer, inner) {
  return inner[0] >= outer[0] && inner[1] >= outer[1] &&
    inner[0] + inner[2] <= outer[0] + outer[2] &&
    inner[1] + inner[3] <= outer[1] + outer[3];
}

const layout = JSON.parse(await readFile(resolve(CONNECTED_V5, 'layout.json'), 'utf8'));
const assets = JSON.parse(await readFile(resolve(CONNECTED_V5, 'assets.json'), 'utf8'));
const spec = layout.roomAnimations?.rock;
const contract = assets.roomAnimationContract;

assert.doesNotThrow(() => validateRockRoomAnimation(layout, assets));
assert.deepEqual(layout.id, 'company-office-connected-v5');
assert.deepEqual(layout.size, MAP_BOUNDS.slice(2));
assert.deepEqual(spec.bounds, ROOM_BOUNDS);
assert.deepEqual(layout.rooms.find((room) => room.id === 'rock')?.bounds, ROOM_BOUNDS);
assert.deepEqual(layout.rooms.find((room) => room.id === 'rock')?.label, spec.labelAnchor);
assert.deepEqual(layout.forbidden.find((area) => area.id === EXPECTED_FORBIDDEN_ROCK_ROOM.id), EXPECTED_FORBIDDEN_ROCK_ROOM);
assert.equal(layout.stations.length, 16);
assert.equal(layout.guestSlots && typeof layout.guestSlots, 'object');
assert.equal('rock' in layout.guestSlots, false, 'Rock-room cats must not enter guestSlots');
assert.equal('rockRoomAnimation' in layout.stations, false, 'Rock-room animation must not enter stations');
assert.equal(sha256(canonical(layout.stations)), EXPECTED_STATIONS_SHA256, 'Existing 16 workstation records changed');

assert.deepEqual(contract, {
  schemaVersion: 1,
  frameSize: [96, 96],
  grid: [4, 3],
  frameCount: 12,
  fps: 12,
  transparent: true,
  loop: true,
  audio: false,
});
assert.deepEqual(spec.performers, EXPECTED_PERFORMERS, 'Performer IDs, roles, anchors, phases, or assets changed');
assert.deepEqual(spec.occlusionLayers, EXPECTED_OCCLUSION_LAYERS, 'Instrument occlusion layers changed');
assert.equal(new Set(spec.performers.map((performer) => performer.id)).size, 4);
assert.equal(new Set(spec.performers.map((performer) => performer.asset)).size, 4);
assert.deepEqual(spec.performers.map((performer) => performer.phase), [0, 3, 6, 9]);

for (const performer of spec.performers) {
  const bounds = frameBounds(contract, performer);
  assert.ok(contains(ROOM_BOUNDS, bounds), `${performer.id} frame leaves rock-room bounds`);
  assert.ok(contains(MAP_BOUNDS, bounds), `${performer.id} frame leaves map bounds`);
  assert.ok(performer.anchor[0] >= ROOM_BOUNDS[0] && performer.anchor[0] <= ROOM_BOUNDS[0] + ROOM_BOUNDS[2]);
  assert.ok(performer.anchor[1] >= ROOM_BOUNDS[1] && performer.anchor[1] <= ROOM_BOUNDS[1] + ROOM_BOUNDS[3]);

  const filename = EXPECTED_ASSETS[performer.id];
  assert.ok(filename, `No expected production asset for ${performer.id}`);
  const assetPath = resolve(ROCK_ROOM, filename);
  const fileInfo = await stat(assetPath);
  assert.ok(fileInfo.size > 0, `${performer.id} asset is empty`);
  const decoded = decodePng(await readFile(assetPath));
  assert.deepEqual([decoded.width, decoded.height], [384, 288], `${performer.id} sheet must be 384x288`);
  const frames = frameAlphaStats(decoded, contract.frameSize[0], contract.frameSize[1], contract.grid[0], contract.grid[1]);
  assert.equal(frames.length, 12);
  assert.ok(frames.every((frame) => frame.transparent > 0), `${performer.id} has no transparent background pixels in every frame`);
  assert.ok(frames.every((frame) => frame.visible > 0), `${performer.id} has an empty frame`);
  assert.ok(frames.every((frame) => frame.opaque > 0), `${performer.id} has no opaque character pixels in every frame`);
  console.log('PASS', `${performer.id}: 384x288 RGBA sheet, 4x3/12 frames, transparent background`);
}

for (const layer of spec.occlusionLayers) {
  const assetPath = resolve(CONNECTED_V5, layer.asset);
  const fileInfo = await stat(assetPath);
  assert.ok(fileInfo.size > 0, `${layer.id} asset is empty`);
  const decoded = decodePng(await readFile(assetPath));
  assert.deepEqual([decoded.width, decoded.height], ROOM_BOUNDS.slice(2), `${layer.id} must match room bounds`);
  const alpha = [];
  for (let offset = 3; offset < decoded.pixels.length; offset += 4) alpha.push(decoded.pixels[offset]);
  assert.ok(alpha.some((value) => value === 0), `${layer.id} must keep transparent room pixels`);
  assert.ok(alpha.some((value) => value > 0), `${layer.id} must contain copied foreground pixels`);
  if (layer.id === 'stage-mics-front') {
    // The centre mic remains behind the vocalist in the flattened room art;
    // only the left/right stands belong to this foreground occlusion layer.
    for (let y = 0; y < decoded.height; y += 1) {
      for (let x = 220; x < 260; x += 1) {
        assert.equal(decoded.pixels[(y * decoded.width + x) * 4 + 3], 0, 'stage-mics-front must not restore the centre mic through the vocalist');
      }
    }
  }
  console.log('PASS', `${layer.id}: ${decoded.width}x${decoded.height} RGBA foreground occlusion layer`);
}

console.log(JSON.stringify({
  status: 'passed',
  scene: layout.id,
  room: {bounds: ROOM_BOUNDS, labelAnchor: spec.labelAnchor},
  contract,
  performers: spec.performers.map(({id, role, asset, anchor, scale, depth, phase}) => ({id, role, asset, anchor, scale, depth, phase})),
  workstationCount: layout.stations.length,
  workstationSha256: EXPECTED_STATIONS_SHA256,
}, null, 2));
