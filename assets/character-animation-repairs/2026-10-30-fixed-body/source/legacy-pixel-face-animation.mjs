/**
 * Deterministic 12-frame facial animation rendered from each breed's own pose.
 *
 * The V5 idle face intentionally follows the approved orange-cat sleep gesture:
 * closed eyelids, a raised nose, a large open mouth and a visible tongue. The
 * expression is shared, but every pixel used to cover the source eyes/mouth is
 * drawn in the selected breed's own muzzle/lid palette. The body, head outline,
 * furniture and screen effects remain immutable.
 */
const ACTIONS = Object.freeze(['working', 'idle', 'syncing', 'error']);
const cache = new WeakMap();
const HEX = /^#[0-9a-f]{6}$/i;
const SLEEP_LINE = '#362522';
const SLEEP_MOUTH = '#2b1718';
const SLEEP_NOSE = '#de6874';
const SLEEP_TONGUE = '#ef7b82';

function defaultCanvas() {
  if (typeof document !== 'undefined') return document.createElement('canvas');
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(1, 1);
  return null;
}

function proceduralActions(animation) {
  const actions = animation.proceduralActions ?? ACTIONS;
  if (!Array.isArray(actions) || actions.length === 0 ||
      new Set(actions).size !== actions.length || actions.some(action => !ACTIONS.includes(action))) {
    throw new Error('Invalid procedural facial actions');
  }
  return actions;
}

/**
 * The crop in a breed manifest is sometimes wider than the logical 90x58
 * atlas cell. The old coordinates were authored in that crop's space. Convert
 * them once at the runtime boundary so validation, drawing and the player all
 * use the same logical face cell. Y remains unchanged for the current V5
 * profiles, but scaling it too keeps the contract correct for future crops.
 */
function logicalFaceAnimation(character, animation) {
  const [,, sourceWidth, sourceHeight] = character.faceRect;
  const [cellWidth, cellHeight] = character.faceFrameSize ?? [sourceWidth, sourceHeight];
  const sx = cellWidth / sourceWidth;
  const sy = cellHeight / sourceHeight;
  return {
    ...animation,
    eyes: animation.eyes.map(([x, y, rx, ry]) => [x * sx, y * sy, rx * sx, ry * sy]),
    mouth: [animation.mouth[0] * sx, animation.mouth[1] * sy],
  };
}

export function validatePixelFaceAnimation(character) {
  const animation = character.pixelFaceAnimation;
  if (!['down', 'left', 'right'].includes(character.direction) || character.faceVisible === false) {
    throw new Error('Rear faces cannot animate');
  }
  if (!animation || Array.isArray(animation) || animation.version !== 1 ||
      ![animation.iris, animation.lid, animation.muzzle].every(value => typeof value === 'string' && HEX.test(value))) {
    throw new Error('Invalid pixel facial palette');
  }
  proceduralActions(animation);
  const rect = character.faceRect;
  if (!Array.isArray(rect) || rect.length !== 4 || !rect.every(Number.isFinite) || rect[2] <= 0 || rect[3] <= 0) {
    throw new Error('Invalid facial rectangle');
  }
  const [frameWidth, frameHeight] = character.faceFrameSize ?? [rect[2], rect[3]];
  const logical = logicalFaceAnimation(character, animation);
  const width = frameWidth;
  const height = frameHeight;
  if (!Array.isArray(logical.eyes) || logical.eyes.length !== (character.direction === 'down' ? 2 : 1)) {
    throw new Error('Invalid directional eye count');
  }
  for (const eye of logical.eyes) {
    if (!Array.isArray(eye) || eye.length !== 4 || !eye.every(Number.isFinite) ||
        eye[2] < 2 || eye[3] < 2 || eye[0] - eye[2] - 2 < 0 || eye[1] - eye[3] - 2 < 0 ||
        eye[0] + eye[2] + 2 >= width || eye[1] + eye[3] + 2 >= height) {
      throw new Error('Invalid facial eye bounds');
    }
  }
  const mouth = logical.mouth;
  if (!Array.isArray(mouth) || mouth.length !== 2 || !mouth.every(Number.isFinite) ||
      mouth[0] < 5 || mouth[1] < 5 || mouth[0] + 5 >= width || mouth[1] + 5 >= height) {
    throw new Error('Invalid facial mouth bounds');
  }
  return animation;
}

function ellipse(ctx, cx, cy, rx, ry, color) {
  if (rx <= 0 || ry <= 0) return;
  ctx.fillStyle = color;
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) ctx.fillRect(x, y, 1, 1);
    }
  }
}

function dot(ctx, x, y, color) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), 1, 1);
}

function pixelArc(ctx, cx, cy, rx, lift, color) {
  const half = Math.max(4, Math.round(rx));
  for (let x = -half; x <= half; x++) {
    const t = x / half;
    const y = cy - lift * (1 - t * t);
    dot(ctx, cx + x, y, color);
    if (lift >= 3 && Math.abs(x) < half - 1) dot(ctx, cx + x, y + 1, color);
  }
}

function rowShape(ctx, cx, top, rows, color) {
  for (const [dy, half] of rows) {
    for (let x = -half; x <= half; x++) dot(ctx, cx + x, top + dy, color);
  }
}

function inpaintMask(ctx, cell, shouldReplace) {
  const image = ctx.getImageData(0, 0, cell.width, cell.height);
  const source = new Uint8ClampedArray(image.data);
  const width = cell.width;
  const height = cell.height;
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) mask[y * width + x] = shouldReplace(x, y) ? 1 : 0;
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!mask[y * width + x]) continue;
      let found = false;
      // Prefer the same scanline to preserve breed stripes and the black/white
      // split of tuxedo faces. Fall back to vertical samples at the mask edge.
      for (let distance = 1; distance <= Math.max(width, height) && !found; distance++) {
        const candidates = [
          [x - distance, y], [x + distance, y],
          [x, y - distance], [x, y + distance],
        ];
        for (const [sx, sy] of candidates) {
          if (sx < 0 || sy < 0 || sx >= width || sy >= height || mask[sy * width + sx]) continue;
          const si = (sy * width + sx) * 4;
          const di = (y * width + x) * 4;
          source.copyWithin(di, si, si + 4);
          found = true;
          break;
        }
      }
    }
  }
  image.data.set(source);
  ctx.putImageData(image, 0, 0);
}

function fillSleepEyeSocket(ctx, cell, [cx, cy, rx, ry]) {
  const expandX = Math.max(3, Math.round(rx * 0.35));
  const expandY = Math.max(3, Math.round(ry * 0.25));
  inpaintMask(ctx, cell, (x, y) => {
    const dx = (x - cx) / (rx + expandX);
    const dy = (y - cy) / (ry + expandY);
    return dx * dx + dy * dy <= 1;
  });
}
function fillSleepSnout(ctx, c, a, mx, my) {
  const side = c.direction !== 'down';
  if (side) {
    // Profile noses sit ahead of the mouth. Clear both original features so
    // neither the old nose nor its tiny smile survives the sleep frame.
    const noseX = mx + (c.direction === 'right' ? 9 : -9);
    ellipse(ctx, mx, my, 7, 6, a.muzzle);
    ellipse(ctx, noseX, my - 4, 6, 6, a.muzzle);
    return;
  }
  // The frontal source nose and smile are one small cluster. Keep this cover
  // narrow and centered; the surrounding tabby/white face must remain visible.
  ellipse(ctx, mx, my + 1, 7, 6, a.muzzle);
}

function sleepNose(ctx, c, mx, my) {
  const side = c.direction !== 'down';
  const nx = side ? mx + (c.direction === 'right' ? 9 : -9) : mx;
  const ny = side ? my - 5 : my - 26;
  if (side) {
    rowShape(ctx, nx, ny, [[0, 2], [1, 3], [2, 2], [3, 1]], SLEEP_NOSE);
    return;
  }
  // Rounded pink nose, matching the orange reference's raised nose rather than
  // the small triangular nose from the open-eye source frame.
  rowShape(ctx, nx, ny, [[0, 3], [1, 5], [2, 5], [3, 4], [4, 2]], SLEEP_NOSE);
}

function sleepMouth(ctx, c, mx, my, frame) {
  const side = c.direction !== 'down';
  if (side) {
    const mouthY = my + 1;
    rowShape(ctx, mx, mouthY, [[0, 1], [1, 2], [2, 3], [3, 4], [4, 4], [5, 3], [6, 2]], SLEEP_MOUTH);
    rowShape(ctx, mx, mouthY + 3, [[0, 2], [1, 3], [2, 2]], SLEEP_TONGUE);
    return;
  }
  // The orange reference is a narrow-top droplet, not a vertical rectangle.
  // Keep the mouth black and animate only the lower opening/tongue subtly.
  const mouthTop = my - 12;
  const breathing = Math.round((1 + Math.sin(frame * Math.PI / 6)) / 2);
  rowShape(ctx, mx, mouthTop, [
    [0, 1], [1, 2], [2, 4], [3, 7], [4, 9], [5, 10],
    [6, 10 + breathing], [7, 9], [8, 7], [9, 5], [10, 4],
  ], SLEEP_MOUTH);
  rowShape(ctx, mx, mouthTop + 6, [[0, 3], [1, 4], [2, 4], [3, 3]], SLEEP_TONGUE);
  // The frontal orange reference has a short nose-to-mouth crease.
  for (let y = my - 21; y < mouthTop; y++) dot(ctx, mx, y, SLEEP_LINE);
}

function sleepFace(ctx, cell, c, rawAnimation, frame) {
  const a = logicalFaceAnimation(c, rawAnimation);
  const [mx, my] = a.mouth;
  for (const eyeSpec of a.eyes) fillSleepEyeSocket(ctx, cell, eyeSpec);
  fillSleepSnout(ctx, c, a, mx, my);

  // The approved orange sleep lids are shallow inverted-U arcs. The old
  // implementation anchored them five pixels too high, leaving the original
  // eye geometry visible underneath; cy-1 aligns the arc with the socket.
  for (const [cx, cy, rx] of a.eyes) {
    pixelArc(ctx, cx, cy - 1, Math.max(7, rx + 1), 4.2, SLEEP_LINE);
  }
  sleepNose(ctx, c, mx, my);
  sleepMouth(ctx, c, mx, my, frame);
}

function eye(ctx, [cx, cy, rx, ry], a, action, f) {
  const phase = f * Math.PI / 6;
  const blink = [1, 1, .93, .78, .5, .22, .06, .22, .5, .78, .93, 1][f];
  const open = action === 'error' ? 1 : blink;
  ellipse(ctx, cx, cy, rx + 1, ry + 1, a.lid);
  if (open < .1) {
    for (let x = -rx; x <= rx; x++) dot(ctx, cx + x, cy + ry * .35 - 1.5 * Math.cos(x / rx * Math.PI / 2), SLEEP_LINE);
    return;
  }
  ellipse(ctx, cx, cy, rx, ry * open, '#261f20');
  const gaze = action === 'syncing' ? Math.sin(phase) * 1.6 : Math.sin(phase) * .65;
  const r = Math.min(rx * .78, ry * .88), clipY = ry * open;
  for (let y = -Math.ceil(ry); y <= Math.ceil(ry); y++) for (let x = -Math.ceil(rx); x <= Math.ceil(rx); x++) {
    if ((x / rx) ** 2 + (y / clipY) ** 2 > 1 || ((x - gaze) / r) ** 2 + (y / r) ** 2 > 1) continue;
    const dist = Math.hypot(x - gaze, y);
    let color = a.iris;
    if (action === 'error') {
      const angle = Math.atan2(y, x - gaze) + phase, spiral = Math.sin(dist * 1.1 - angle * 2);
      color = spiral > .1 ? '#1d1a23' : a.iris;
    } else if (dist < r * .52) color = '#17191e';
    dot(ctx, cx + x, cy + y, color);
  }
  if (open > .65) {
    const t = 224 + f, highlight = `rgb(${t},${Math.min(255, t + 10)},255)`;
    dot(ctx, cx - r * .3 + Math.cos(phase) * .4, cy - r * .4, highlight);
    dot(ctx, cx - r * .3 + 1, cy - r * .4, highlight);
  }
}

function mouth(ctx, [mx, my], a, action, f) {
  ellipse(ctx, mx, my + 1, 5, 4, a.muzzle);
  if (action === 'error') {
    for (let x = -3; x <= 3; x++) dot(ctx, mx + x, my + Math.abs(x) * .45, '#372629');
    dot(ctx, mx + (f % 3) - 1, my + 2, `rgb(${178 + f * 3},100,110)`);
  } else {
    for (let x = -4; x <= 4; x++) {
      const y = Math.abs(Math.abs(x) - 2) * .45;
      dot(ctx, mx + x, my + y, '#38292a');
    }
    dot(ctx, mx + 4, my + 1, `rgb(${190 + f},${165 + f},${150 + f})`);
  }
}

export function createPixelFaceAtlases(base, c, { createCanvas = defaultCanvas } = {}) {
  const rawAnimation = validatePixelFaceAnimation(c);
  let entries = cache.get(base);
  if (!entries) { entries = new Map(); cache.set(base, entries); }
  const actions = proceduralActions(rawAnimation);
  const [fx, fy, fw, fh] = c.faceRect;
  const [cellW, cellH] = c.faceFrameSize ?? [90, 58];
  const key = JSON.stringify([c.faceRect, c.faceFrameSize, c.direction, rawAnimation]);
  if (entries.has(key)) return entries.get(key);
  const cell = createCanvas();
  if (!cell || typeof cell.getContext !== 'function') {
    const result = Object.fromEntries(actions.map(action => [action, { width: cellW * 4, height: cellH * 3 }]));
    entries.set(key, Object.freeze(result));
    return result;
  }
  // Facial coordinates are authored in the manifest crop space. The breed
  // source crop can be 102px wide, but the player consumes a logical 90x58
  // atlas cell; sleepFace/other procedural actions use the converted geometry.
  cell.width = cellW;
  cell.height = cellH;
  const ctx = cell.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Facial animation requires Canvas 2D');
  const result = {};
  for (const action of actions) {
    const sheet = createCanvas();
    sheet.width = cellW * 4;
    sheet.height = cellH * 3;
    const out = sheet.getContext('2d');
    out.imageSmoothingEnabled = false;
    for (let frame = 0; frame < 12; frame++) {
      ctx.clearRect(0, 0, cellW, cellH);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(base, fx, fy, fw, fh, 0, 0, cellW, cellH);
      if (action === 'idle') sleepFace(ctx, cell, c, rawAnimation, frame);
      else {
        const a = logicalFaceAnimation(c, rawAnimation);
        for (const e of a.eyes) eye(ctx, e, a, action, frame);
        mouth(ctx, a.mouth, a, action, frame);
      }
      out.drawImage(cell, 0, 0, cellW, cellH, (frame % 4) * cellW, Math.floor(frame / 4) * cellH, cellW, cellH);
    }
    result[action] = sheet;
  }
  entries.set(key, Object.freeze(result));
  return result;
}
