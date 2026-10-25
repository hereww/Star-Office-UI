/**
 * connected-v5 display renderer.
 *
 * This module is intentionally self-contained: it does not alter the v4 or
 * reference-v3 renderer and can be adopted by a future v5 runtime without
 * changing player integration.  All visual animation is sampled from `ms`
 * at 12fps, independently from the character/expression clock.
 */

export const SCREEN_STYLES = Object.freeze({
  idle: 'sleep-dark',
  writing: 'code-editor-typing',
  researching: 'code-search-reading',
  executing: 'code-terminal-output',
  syncing: 'sync-blocks',
  error: 'soft-double-pulse',
});

const STATES = Object.freeze(Object.keys(SCREEN_STYLES));
const LED_COLORS = Object.freeze({
  idle: '#354b42',
  writing: '#8ebf88',
  researching: '#7aafbe',
  executing: '#a5bd77',
  syncing: '#aaa6cf',
  error: '#ce977e',
});
const SCREEN_COLORS = Object.freeze({
  idle: '#091217',
  writing: '#111923',
  researching: '#121c29',
  executing: '#101b22',
  syncing: '#28283c',
  error: '#34282b',
});

const TICK_RATE = 12;
const PHASE_LENGTH = 48;
const CANVAS_SIZE = 192;

function fail(message) {
  throw new Error(`connected-v5 screen: ${message}`);
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function validPoint(point, limit) {
  return Array.isArray(point) && point.length === 2 &&
    Array.from(point).every(value => finiteNumber(value) && value >= 0 && value <= limit);
}

function polygonArea(polygon) {
  let area = 0;
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    area += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(area / 2);
}

function cross(a, b, c) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function onSegment(a, b, c) {
  return cross(a, b, c) === 0 && c[0] >= Math.min(a[0], b[0]) &&
    c[0] <= Math.max(a[0], b[0]) && c[1] >= Math.min(a[1], b[1]) &&
    c[1] <= Math.max(a[1], b[1]);
}

function intersects(a, b, c, d) {
  const ac = cross(a, b, c), ad = cross(a, b, d);
  const ca = cross(c, d, a), cb = cross(c, d, b);
  return (ac * ad < 0 && ca * cb < 0) || onSegment(a, b, c) ||
    onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b);
}

function rectFromValue(value) {
  if (!Array.isArray(value) || ![2, 4].includes(value.length) ||
      !Array.from(value).every(finiteNumber)) return null;
  const rect = value.length === 2 ? [...value, 2, 2] : [...value];
  if (rect[0] < 0 || rect[1] < 0 || rect[2] <= 0 || rect[3] <= 0 ||
      !Number.isFinite(rect[0] + rect[2]) || !Number.isFinite(rect[1] + rect[3])) return null;
  return rect;
}

function rectInsideCanvas(rect) {
  return rect && rect[0] + rect[2] <= CANVAS_SIZE && rect[1] + rect[3] <= CANVAS_SIZE;
}

function validatePolygon(polygon, limit = CANVAS_SIZE) {
  if (!Array.isArray(polygon) || polygon.length < 3 ||
      !Array.from(polygon).every(point => validPoint(point, limit))) {
    fail(limit === CANVAS_SIZE ? 'front screen polygon must contain at least three points inside 192x192' :
      'front screen polygon must contain at least three non-negative finite source points');
  }
  if (polygonArea(polygon) < 1 || !Number.isFinite(polygonArea(polygon))) fail('front screen polygon is degenerate');
  const seen = new Set();
  for (let i = 0; i < polygon.length; i += 1) {
    const key = polygon[i].join(',');
    if (seen.has(key)) fail('polygon has repeated vertices');
    seen.add(key);
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    for (let j = i + 1; j < polygon.length; j += 1) {
      if (j === i + 1 || (i === 0 && j === polygon.length - 1)) continue;
      if (intersects(a, b, polygon[j], polygon[(j + 1) % polygon.length])) fail('polygon is self-intersecting');
    }
  }
  return polygon.map(point => [...point]);
}

/** Normalized effect API only. Source-image coordinates belong to the constructor. */
export function validateScreenConfig(screen) {
  if (!screen || typeof screen !== 'object' || Array.isArray(screen)) fail('screen config is invalid');
  if (!['front', 'back'].includes(screen.kind)) fail('kind must be front or back');
  const visible = screen.kind === 'front';
  const polygon = visible ? validatePolygon(screen.polygon) : [];
  const led = screen.led == null ? null : rectFromValue(screen.led);
  if (screen.led != null && !rectInsideCanvas(led)) fail('LED rectangle must be inside 192x192');
  if (!visible && !led) fail('rear-facing monitor requires an LED and never renders content');
  return { ...screen, visible, polygon, led };
}

function sourceScreenConfig(screen) {
  if (!screen || typeof screen !== 'object' || Array.isArray(screen)) fail('screen config is invalid');
  if (!['front', 'back'].includes(screen.kind)) fail('kind must be front or back');
  // Validate every source LED before allocating any texture, even on a front
  // monitor. No upper 192 limit here: a bench manifest uses source-image pixels.
  const led = screen.led === undefined ? null : rectFromValue(screen.led);
  if (screen.led !== undefined && !led) fail('invalid source LED rectangle');
  if (screen.kind === 'front') {
    const polygon = validatePolygon(screen.polygon, Infinity);
    const [x, y, width, height] = boundsOf(polygon);
    const normalized = polygon.map(([px, py]) => [
      ((px - x) * CANVAS_SIZE) / width, ((py - y) * CANVAS_SIZE) / height,
    ]);
    validatePolygon(normalized);
    return { visible: true, polygon: normalized, sourceLed: led };
  }
  if (!led) fail('rear-facing monitor requires an LED and never renders content');
  return { visible: false, polygon: [], sourceLed: led };
}

function boundsOf(polygon) {
  const xs = polygon.map(point => point[0]);
  const ys = polygon.map(point => point[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function bump(distance, center, width = 4) {
  const d = Math.abs(distance - center);
  return d < width ? (1 + Math.cos(Math.PI * d / width)) / 2 : 0;
}

/**
 * Pure, deterministic 12fps sample.  `ms` deliberately affects cursor,
 * code typing, reading position and brightness so a working screen
 * visibly changes while a character is typing.
 */
export function sampleScreenEffects(screen, state, ms, { reducedMotion = false } = {}) {
  const config = validateScreenConfig(screen);
  if (!STATES.includes(state)) fail(`unsupported state: ${state}`);
  if (!finiteNumber(ms)) fail('sample time must be finite');
  if (typeof reducedMotion !== 'boolean') fail('reducedMotion must be boolean');

  const tick = Math.floor(Math.max(0, ms) * TICK_RATE / 1000);
  if (!Number.isSafeInteger(tick)) fail('sample time exceeds safe frame range');
  const phase = reducedMotion ? 0 : tick % PHASE_LENGTH;
  const visible = config.visible;
  const cursorVisible = reducedMotion || Math.floor(phase / 4) % 2 === 0;
  const scanStep = reducedMotion ? 20 : (phase * 2) % 44;
  const documentOffset = reducedMotion ? 0 : Math.floor(phase / 3) % 6;
  const codeOffset = reducedMotion ? 0 : Math.floor(phase / 2) % 6;
  const activeBlock = reducedMotion ? 3 : Math.floor(phase / 3) % 8;
  const pulse = reducedMotion ? 0.14 : 0.10 + 0.18 * (bump(phase, 5, 5) + 0.75 * bump(phase, 23, 5));
  const brightness = state === 'idle' ? 0.78 : reducedMotion ? 0.82 :
    clamp(0.82 + 0.035 * Math.sin((phase / PHASE_LENGTH) * Math.PI * 2), 0.78, 0.86);
  const activeCodeLine = reducedMotion ? 6 : 2 + Math.floor(phase / 8);
  const typingProgress = reducedMotion ? 1 : ((phase % 8) + 1) / 8;
  const searchRow = reducedMotion ? 2 : Math.floor(phase / 6) % 6;
  const terminalOffset = reducedMotion ? 2 : Math.floor(phase / 4);
  const queryCharacters = reducedMotion ? 8 : 2 + (phase % 7);
  const terminalProgress = reducedMotion ? 1 : ((phase % 4) + 1) / 4;
  const ledAlpha = state === 'idle' ? 0.45 : state === 'error' ? 0.54 + pulse : 0.78 + pulse * 0.35;
  const visual = visible ? {
    idle: 0,
    writing: `${Number(cursorVisible)}:${activeCodeLine}:${typingProgress}`,
    researching: `${searchRow}:${queryCharacters}:${codeOffset}:${Number(cursorVisible)}`,
    executing: `${codeOffset}:${terminalOffset}:${terminalProgress}:${Number(cursorVisible)}`,
    syncing: activeBlock,
    error: pulse.toFixed(4),
  }[state] : `led:${ledAlpha.toFixed(4)}`;

  return Object.freeze({
    state,
    style: SCREEN_STYLES[state],
    visible,
    ledOnly: !visible && config.led !== null,
    mode: visible ? 'screen' : config.led ? 'led' : 'hidden',
    polygon: visible ? config.polygon.map(point => [...point]) : [],
    led: config.led ? [...config.led] : null,
    bounds: visible ? boundsOf(config.polygon) : null,
    reducedMotion,
    phase,
    cursorVisible,
    scanStep,
    documentOffset,
    codeOffset,
    activeCodeLine,
    typingProgress,
    searchRow,
    queryCharacters,
    terminalOffset,
    terminalProgress,
    activeBlock,
    pulse,
    brightness,
    ledColor: LED_COLORS[state],
    ledAlpha,
    // The key contains only drawable state. It avoids a 4K redraw on every
    // millisecond while preserving the intended 12fps animation cadence.
    key: `${state}:${visible}:${reducedMotion}:${visual}:${visible ? brightness.toFixed(4) : 0}:${config.led ? ledAlpha.toFixed(4) : 0}:${JSON.stringify([config.polygon, config.led])}`,
  });
}

function fill(ctx, color, x, y, width, height, alpha = 1) {
  ctx.fillStyle = color;
  ctx.globalAlpha = alpha;
  ctx.fillRect(x, y, width, height);
}

const SYNTAX = Object.freeze({
  keyword: '#c792ea', identifier: '#82aaff', plain: '#b8c7dc',
  string: '#c3e88d', number: '#f7c777', comment: '#607d8b',
});
// Real code tokens, not pale document bars. Each row has explicit indentation.
const CODE_LINES = Object.freeze([
  [0, [['keyword', 'async function '], ['identifier', 'run'], ['plain', '(input) {']]],
  [1, [['keyword', 'const '], ['identifier', 'items'], ['plain', ' = input.map(']]],
  [2, [['identifier', 'item'], ['plain', ' => item.value);']]],
  [1, [['keyword', 'const '], ['identifier', 'result'], ['plain', ' = '], ['keyword', 'await ']]],
  [2, [['identifier', 'build'], ['plain', '(items, '], ['number', '16'], ['plain', ');']]],
  [1, [['identifier', 'console'], ['plain', '.log('], ['string', '"ready"'], ['plain', ');']]],
  [1, [['keyword', 'return '], ['identifier', 'result'], ['plain', ';']]],
  [0, [['plain', '}'], ['comment', ' // tests passed']]],
]);
const TERMINAL_LINES = Object.freeze([
  ['comment', '$ npm run test'], ['identifier', '> build src/index.ts'],
  ['plain', 'compile...'], ['string', 'PASS parser.test.ts'],
  ['string', 'PASS worker.test.ts'], ['number', '16 tests passed'],
  ['identifier', '> node dist/index.js'], ['string', 'ready: server online'],
]);

function drawCodeRow(ctx, rect, bounds, x, y, line, budget = Infinity, highlight = false, lineNumber = 1) {
  const [indent, tokens] = line;
  let u = x + indent * 0.055;
  let remaining = budget;
  // Real source line numbers, not document-like bars. Align the gutter using
  // measured glyph widths without changing the caller's text alignment.
  const [bx, by, width, height] = bounds;
  const number = String(lineNumber);
  ctx.fillStyle = '#667b93';
  ctx.globalAlpha = 0.8;
  ctx.fillText(number, bx + width * 0.108 - ctx.measureText(number).width, by + y * height);
  for (let level = 0; level < indent; level += 1) {
    rect('#28374a', x + level * 0.055 - 0.016, y, 0.004, 0.062, 0.8);
  }
  for (const [type, text] of tokens) {
    const shown = text.slice(0, remaining);
    if (!shown) break;
    const tokenWidth = ctx.measureText(shown).width / width;
    if (highlight && type === 'identifier') rect('#b58b37', u - 0.004, y - 0.004, tokenWidth + 0.008, 0.065, 0.36);
    ctx.fillStyle = SYNTAX[type];
    ctx.globalAlpha = 0.94;
    ctx.fillText(shown, bx + u * width, by + y * height);
    u += tokenWidth;
    remaining -= shown.length;
  }
  return u;
}

function drawEditor(ctx, effect, rect) {
  const [, , width, height] = effect.bounds;
  const fontSize = Math.min(width * 0.043, height * 0.055);
  ctx.font = `${fontSize}px monospace`;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  // Pass geometry locally rather than mutating the caller's context object.
  const row = (x, y, lineIndex, budget = Infinity, highlight = false) =>
    drawCodeRow(ctx, rect, effect.bounds, x, y, CODE_LINES[lineIndex], budget, highlight, lineIndex + 1);

  rect('#1e2a3a', 0.04, 0.04, 0.92, 0.10);
  rect('#82aaff', 0.065, 0.065, 0.015, 0.035, 0.8);
  ctx.fillStyle = '#8da8c9';
  ctx.globalAlpha = 0.9;
  ctx.fillText(effect.state === 'researching' ? 'search: src/*.ts' : 'src/index.ts',
    effect.bounds[0] + width * 0.105, effect.bounds[1] + height * 0.055);
  rect('#243144', 0.12, 0.16, 0.005, 0.73);
  if (effect.state === 'writing') {
    let cursorU = 0.16;
    for (let i = 0; i <= effect.activeCodeLine; i += 1) {
      const line = CODE_LINES[i];
      const characters = line[1].reduce((n, token) => n + token[1].length, 0);
      const budget = i === effect.activeCodeLine ? Math.ceil(characters * effect.typingProgress) : Infinity;
      if (i === effect.activeCodeLine) rect('#21314a', 0.14, 0.185 + i * 0.081, 0.80, 0.077, 0.7);
      cursorU = row(0.16, 0.195 + i * 0.081, i, budget);
    }
    if (effect.cursorVisible) rect('#e0e9f5', Math.min(cursorU + 0.006, 0.94),
      0.192 + effect.activeCodeLine * 0.081, 0.009, 0.058, 0.9);
  } else if (effect.state === 'researching') {
    rect('#253952', 0.15, 0.17, 0.79, 0.085);
    ctx.fillStyle = SYNTAX.identifier;
    ctx.globalAlpha = 0.95;
    const query = '> run(input)'.slice(0, effect.queryCharacters + 2);
    ctx.fillText(query, effect.bounds[0] + width * 0.19, effect.bounds[1] + height * 0.184);
    if (effect.cursorVisible) rect('#d5e3f5', 0.19 + ctx.measureText(query).width / width + 0.006,
      0.181, 0.008, 0.055, 0.9);
    // Scroll a contiguous source window; wrapping individual lines used to
    // put the closing brace ahead of the function declaration.
    const firstLine = Math.min(effect.codeOffset, CODE_LINES.length - 6);
    for (let i = 0; i < 6; i += 1) {
      if (i === effect.searchRow) rect('#223e56', 0.14, 0.285 + i * 0.088, 0.80, 0.081, 0.75);
      row(0.16, 0.295 + i * 0.088, firstLine + i, Infinity, i === effect.searchRow);
    }
  } else {
    const firstLine = Math.min(effect.codeOffset, CODE_LINES.length - 4);
    for (let i = 0; i < 4; i += 1) row(0.16, 0.19 + i * 0.085, firstLine + i);
    // A separate terminal panel has output that appears and then scrolls.
    rect('#091118', 0.04, 0.60, 0.92, 0.34);
    rect('#3b5971', 0.04, 0.60, 0.92, 0.008, 0.65);
    ctx.font = `${fontSize * 0.88}px monospace`;
    const count = Math.min(4, effect.terminalOffset + 1);
    for (let i = 0; i < count; i += 1) {
      const [type, text] = TERMINAL_LINES[(Math.max(0, effect.terminalOffset - 3) + i) % TERMINAL_LINES.length];
      ctx.fillStyle = SYNTAX[type];
      ctx.globalAlpha = 0.92;
      const output = i === count - 1 ? text.slice(0, Math.ceil(text.length * effect.terminalProgress)) : text;
      ctx.fillText(output, effect.bounds[0] + width * 0.09, effect.bounds[1] + height * (0.63 + i * 0.059));
    }
    if (effect.cursorVisible) rect('#9dd8a5', 0.09, 0.885, 0.03, 0.008, 0.9);
  }
  // Soft brightness variation rather than a full-screen white flash.
  rect('#7395be', 0, 0, 1, 1, (effect.brightness - 0.78) * 0.22);
}

function drawScreenPixels(ctx, effect) {
  const [x, y, width, height] = effect.bounds;
  const rect = (color, u, v, w, h, alpha = 1) =>
    fill(ctx, color, x + width * u, y + height * v, width * w, height * h, alpha);
  rect(SCREEN_COLORS[effect.state], 0, 0, 1, 1);
  if (['writing', 'researching', 'executing'].includes(effect.state)) {
    drawEditor(ctx, effect, rect);
    return;
  }
  switch (effect.state) {
    case 'idle':
      rect('#16252a', 0.12, 0.15, 0.76, 0.04, 0.35);
      break;
    case 'syncing':
      for (let i = 0; i < 8; i += 1) {
        rect(i <= effect.activeBlock ? '#a3adc7' : '#50576e',
          0.12 + (i % 4) * 0.2, 0.22 + Math.floor(i / 4) * 0.33, 0.14, 0.21, 0.86);
      }
      break;
    case 'error':
      rect('#d69b85', 0, 0, 1, 1, effect.pulse);
      rect('#d0af9c', 0.46, 0.23, 0.08, 0.33, 0.8);
      rect('#d0af9c', 0.46, 0.69, 0.08, 0.08, 0.8);
      break;
    default:
      break;
  }
}

function drawNarrowScreen(ctx, effect) {
  // Deliberately low luminance: no glyphs/lines on a narrow side display.
  fill(ctx, SCREEN_COLORS[effect.state], 0, 0, CANVAS_SIZE, CANVAS_SIZE, 0.46 + effect.brightness * 0.06);
  fill(ctx, LED_COLORS[effect.state], 0, 0, CANVAS_SIZE, CANVAS_SIZE, 0.025 + effect.pulse * 0.045);
}

function clipPolygon(ctx, polygon) {
  const [first, ...rest] = polygon;
  ctx.beginPath();
  ctx.moveTo(...first);
  for (const point of rest) ctx.lineTo(...point);
  ctx.closePath();
  ctx.clip();
}

/** Draw a sampled effect. Every content/pulse pixel is clipped to its polygon. */
export function drawScreenEffects(ctx, effect, { thin = false } = {}) {
  if (effect.visible) {
    ctx.save();
    try {
      clipPolygon(ctx, effect.polygon);
      if (thin) drawNarrowScreen(ctx, effect);
      else drawScreenPixels(ctx, effect);
    } finally {
      ctx.restore();
    }
  }
  // Rear-facing monitors never draw screen content. Their LED is separately
  // clipped, so a full-canvas glow cannot leak into the monitor shell.
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

function sourceToWorld(transform, point) {
  return [transform.x + point[0] * transform.scale, transform.y + point[1] * transform.scale];
}

function canvasFor(key) {
  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_SIZE;
  canvas.height = CANVAS_SIZE;
  canvas.setAttribute('aria-hidden', 'true');
  canvas.dataset.screenOverlay = key;
  return canvas;
}

/** v4-compatible adapter for a future v5 runtime; no runtime/player wiring here. */
export class BenchScreenOverlay {
  constructor(scene, screen, transform, key) {
    // Manifest polygons/LEDs are in the source bench image coordinate space,
    // while the effect sampler deliberately works in a normalized 192x192
    // canvas. Keep the source screen for runtime identity/snapshots and use a
    // validated normalized copy for drawing.
    this.screen = structuredClone(screen);
    const normalized = sourceScreenConfig(screen);
    this.key = key;
    this.components = [];
    this.lastKey = null;
    this.thin = false;

    if (normalized.visible) {
      const [x, y, width, height] = boundsOf(screen.polygon);
      this.thin = width / height < 0.08;
      this.add(scene, transform, `${key}-display`, [x, y, width, height], {
        kind: 'front',
        visible: true,
        polygon: normalized.polygon,
      });
    }
    if (normalized.sourceLed) {
      const led = normalized.sourceLed;
      this.add(scene, transform, `${key}-led`, [led[0], led[1], led[2], led[3]], {
        kind: 'back',
        visible: false,
        led: [0, 0, CANVAS_SIZE, CANVAS_SIZE],
      });
    }
  }

  add(scene, transform, key, bounds, config) {
    const canvas = canvasFor(key);
    const ctx = canvas.getContext('2d');
    const texture = scene.textures.addCanvas(key, canvas);
    const [x, y] = sourceToWorld(transform, bounds.slice(0, 2));
    const sprite = scene.add.image(x, y, key)
      .setOrigin(0)
      .setDisplaySize(bounds[2] * transform.scale, bounds[3] * transform.scale)
      .setDepth(-8);
    this.components.push({ canvas, ctx, texture, sprite, config, bounds });
  }

  sample(state, ms, reducedMotion = false) {
    const effects = this.components.map(component => sampleScreenEffects(component.config, state, ms, { reducedMotion }));
    const key = effects.map(effect => effect.key).join('|');
    if (key === this.lastKey) return false;
    for (const [index, component] of this.components.entries()) {
      component.ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
      drawScreenEffects(component.ctx, effects[index], { thin: this.thin && component.config.visible });
      component.texture.refresh();
    }
    this.lastKey = key;
    this.lastEffects = effects;
    return true;
  }

  snapshot() {
    return {
      seatId: this.screen.seatId,
      kind: this.screen.kind,
      thinSideScreen: this.thin,
      polygon: this.screen.kind === 'front' && Array.isArray(this.screen.polygon) ? this.screen.polygon.map(point => [...point]) : [],
      led: this.screen.led ? [...this.screen.led] : null,
      key: this.lastKey,
      styles: this.lastEffects?.map(effect => effect.style) ?? [],
      screenAnimation: 'code-editor-search-terminal',
      rearContent: false,
      clippedToPolygon: true,
    };
  }
}
