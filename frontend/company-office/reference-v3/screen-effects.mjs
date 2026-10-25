// Screen-only Canvas 2D effects. Coordinates are in the unscaled 192px seat canvas.
export const SCREEN_STYLES = Object.freeze({
  idle: 'sleep-dark',
  writing: 'document-cursor',
  researching: 'search-scan',
  executing: 'terminal-lines',
  syncing: 'sync-blocks',
  error: 'soft-double-pulse',
});

const LED_COLORS = Object.freeze({
  idle: '#354b42',
  writing: '#8ebf88',
  researching: '#7aafbe',
  executing: '#a5bd77',
  syncing: '#aaa6cf',
  error: '#ce977e',
});

function fail(message) {
  throw new Error(`screen: ${message}`);
}

function cross(a, b, c) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function onSegment(a, b, p) {
  return cross(a, b, p) === 0 && p[0] >= Math.min(a[0], b[0]) &&
    p[0] <= Math.max(a[0], b[0]) && p[1] >= Math.min(a[1], b[1]) &&
    p[1] <= Math.max(a[1], b[1]);
}

function intersects(a, b, c, d) {
  const abC = cross(a, b, c), abD = cross(a, b, d);
  const cdA = cross(c, d, a), cdB = cross(c, d, b);
  return (abC * abD < 0 && cdA * cdB < 0) || onSegment(a, b, c) ||
    onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b);
}

/** Validate without normalizing or mutating the asset configuration. */
export function validateScreenConfig(screen) {
  if (screen === undefined) return screen; // The original down workstation has no screen mask.
  if (!screen || typeof screen !== 'object' || Array.isArray(screen)) fail('配置无效');
  if (typeof screen.visible !== 'boolean') fail('visible 必须为 boolean');
  const polygon = screen.polygon;
  if (screen.visible || polygon !== undefined) {
    if (!Array.isArray(polygon) || polygon.length < 3) fail('polygon 至少需要三个顶点');
    for (const point of polygon) {
      if (!Array.isArray(point) || point.length !== 2 ||
          point.some(n => !Number.isFinite(n) || n < 0 || n > 192)) {
        fail('polygon 顶点必须位于 192x192 画布内');
      }
    }
    let area = 0;
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i], b = polygon[(i + 1) % polygon.length];
      if (a[0] === b[0] && a[1] === b[1]) fail('polygon 不允许重复相邻顶点');
      area += a[0] * b[1] - b[0] * a[1];
      for (let j = i + 1; j < polygon.length; j++) {
        if (j === i + 1 || (i === 0 && j === polygon.length - 1)) continue;
        if (intersects(a, b, polygon[j], polygon[(j + 1) % polygon.length])) {
          fail('polygon 不允许自交');
        }
      }
    }
    if (Math.abs(area) < 1e-8) fail('polygon 面积必须大于零');
  }
  if (screen.led !== undefined) {
    const led = screen.led;
    if (!Array.isArray(led) || led.length !== 4 || led.some(n => !Number.isFinite(n)) ||
        led[0] < 0 || led[1] < 0 || led[2] <= 0 || led[3] <= 0 ||
        led[0] + led[2] > 192 || led[1] + led[3] > 192) {
      fail('led 必须是画布内的 [x,y,w,h]');
    }
  }
  return screen;
}

function boundsOf(polygon) {
  const xs = polygon.map(p => p[0]), ys = polygon.map(p => p[1]);
  const x = Math.min(...xs), y = Math.min(...ys);
  return [x, y, Math.max(...xs) - x, Math.max(...ys) - y];
}

// Two broad, low-amplitude pulses in two seconds; no flash, glow, or body effect.
function bump(tick, center) {
  const distance = Math.abs(tick - center);
  return distance < 3 ? (1 + Math.cos(Math.PI * distance / 3)) / 2 : 0;
}

/** Pure, tick-quantized sampling, independent of the character expression clock. */
export function sampleScreenEffects(screen, state, ms, { reducedMotion = false } = {}) {
  validateScreenConfig(screen);
  if (!Object.hasOwn(SCREEN_STYLES, state)) fail('只接受原六业务状态');
  if (!Number.isFinite(ms)) fail('采样时间必须有限');
  if (typeof reducedMotion !== 'boolean') fail('reducedMotion 必须为 boolean');
  const tick = Math.floor(Math.max(0, ms) * 12 / 1000);
  if (!Number.isSafeInteger(tick)) fail('采样时间超出安全帧范围');
  const phase = reducedMotion ? 0 : tick % 24;
  const visible = screen?.visible === true;
  const led = screen?.led ? [...screen.led] : null;
  const polygon = visible ? screen.polygon.map(p => [...p]) : [];
  const cursorVisible = reducedMotion || Math.floor(phase / 6) % 2 === 0;
  const scanStep = reducedMotion ? 11 : phase;
  const lineOffset = reducedMotion ? 0 : Math.floor(phase / 3) % 4;
  const activeBlock = reducedMotion ? 3 : Math.floor(phase / 3) % 8;
  const pulse = reducedMotion ? 0.16 : 0.10 + 0.16 * (bump(phase, 4) + 0.75 * bump(phase, 10));
  const ledAlpha = state === 'idle' ? 0.45 : state === 'error' ? 0.55 + pulse : 0.8;
  const visual = visible ? {
    idle: 0,
    writing: Number(cursorVisible),
    researching: scanStep,
    executing: `${lineOffset}:${Number(cursorVisible)}`,
    syncing: activeBlock,
    error: pulse,
  }[state] : 0;
  return {
    state, style: SCREEN_STYLES[state], visible, ledOnly: !visible && led !== null,
    mode: visible ? 'screen' : led ? 'led' : 'hidden', polygon, led,
    bounds: visible ? boundsOf(polygon) : null,
    reducedMotion, phase, cursorVisible, scanStep, lineOffset, activeBlock, pulse,
    ledColor: LED_COLORS[state], ledAlpha,
    // Only actual visible changes invalidate the canvas, not the raw sampling time.
    key: `${state}:${visible}:${reducedMotion}:${visual}:${led ? ledAlpha : 0}`,
  };
}

function fill(ctx, color, x, y, w, h, alpha = 1) {
  ctx.fillStyle = color;
  ctx.globalAlpha = alpha;
  ctx.fillRect(x, y, w, h);
}

function drawPixels(ctx, effect) {
  const [x, y, w, h] = effect.bounds;
  const rect = (color, u, v, width, height, alpha = 1) =>
    fill(ctx, color, x + w * u, y + h * v, w * width, h * height, alpha);
  switch (effect.state) {
    case 'idle':
      rect('#090f14', 0, 0, 1, 1);
      break;
    case 'writing': {
      rect('#1b3036', 0, 0, 1, 1);
      rect('#d4dfcf', 0.16, 0.12, 0.68, 0.78);
      for (let i = 0; i < 4; i++) {
        rect('#6f8880', 0.23, 0.24 + i * 0.14, i === 3 ? 0.25 : 0.52, 0.035);
      }
      if (effect.cursorVisible) rect('#294b43', 0.5, 0.64, 0.025, 0.13);
      break;
    }
    case 'researching': {
      rect('#18313e', 0, 0, 1, 1);
      for (let i = 1; i < 5; i++) {
        rect('#36505b', i * 0.2, 0.08, 0.012, 0.84);
        rect('#36505b', 0.08, i * 0.2, 0.84, 0.018);
      }
      rect('#8bb7c2', 0.57, 0.38, 0.18, 0.035);
      rect('#8bb7c2', 0.57, 0.38, 0.02, 0.25);
      rect('#8bb7c2', 0.57, 0.61, 0.18, 0.035);
      rect('#8bb7c2', 0.73, 0.38, 0.02, 0.25);
      rect('#a9d0ce', 0, effect.scanStep / 23 * 0.94, 1, 0.06, 0.55);
      break;
    }
    case 'executing': {
      rect('#0d1d1c', 0, 0, 1, 1);
      const lengths = [0.48, 0.67, 0.34, 0.57];
      for (let i = 0; i < 4; i++) {
        rect('#9ab878', 0.1, 0.14 + i * 0.16, 0.04, 0.055);
        rect('#7d9e72', 0.19, 0.14 + i * 0.16, lengths[(i + effect.lineOffset) % 4], 0.035);
      }
      if (effect.cursorVisible) rect('#c2d3a6', 0.19, 0.83, 0.07, 0.045);
      break;
    }
    case 'syncing':
      rect('#28283c', 0, 0, 1, 1);
      for (let i = 0; i < 8; i++) {
        rect(i <= effect.activeBlock ? '#a3adc7' : '#50576e',
          0.12 + (i % 4) * 0.2, 0.22 + Math.floor(i / 4) * 0.33, 0.14, 0.21);
      }
      break;
    case 'error':
      rect('#34282b', 0, 0, 1, 1);
      rect('#d69b85', 0, 0, 1, 1, effect.pulse);
      rect('#d0af9c', 0.46, 0.23, 0.08, 0.33, 0.8);
      rect('#d0af9c', 0.46, 0.69, 0.08, 0.08, 0.8);
      break;
  }
}

/** Draw a sample returned by sampleScreenEffects; never transform the shared context. */
export function drawScreenEffects(ctx, effect) {
  if (effect.visible) {
    ctx.save();
    try {
      ctx.beginPath();
      const [first, ...rest] = effect.polygon;
      ctx.moveTo(...first);
      for (const point of rest) ctx.lineTo(...point);
      ctx.closePath();
      ctx.clip(); // Every lit pixel, including the scan and error pulse, stays inside this mask.
      drawPixels(ctx, effect);
    } finally {
      ctx.restore();
    }
  }
  // A rear-facing monitor never draws its polygon/content, only this isolated LED.
  if (effect.led) {
    ctx.save();
    try {
      ctx.beginPath();
      ctx.rect(...effect.led);
      ctx.clip();
      fill(ctx, effect.ledColor, ...effect.led, effect.ledAlpha);
    } finally {
      ctx.restore();
    }
  }
}
