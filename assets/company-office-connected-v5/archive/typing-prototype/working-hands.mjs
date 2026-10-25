/**
 * Connected-v5 working-state overlay.
 *
 * This module deliberately owns only a transparent hand/forearm layer. It does
 * not redraw, move, mirror, or mutate the character, face atlas, chair, tail,
 * desk, monitor, or bubble layer. The host can composite this 192x192 overlay
 * above the seated player and below any foreground furniture occlusion.
 */

export const DIRECTIONS = Object.freeze(['up', 'down', 'left', 'right']);
export const BUSINESS_STATES = Object.freeze([
  'idle', 'writing', 'researching', 'executing', 'syncing', 'error',
]);
export const WORKING_STATES = Object.freeze(['writing', 'researching', 'executing']);
export const FPS = 12;
export const FRAME_COUNT = 12;
export const CANVAS_SIZE = Object.freeze([192, 192]);

const WORKING_STATE_SET = new Set(WORKING_STATES);
const STATE_SET = new Set(BUSINESS_STATES);

// These are intentionally small pixel-art primitives. They are not a second
// character: each profile stays inside the keyboard/forearm envelope for that
// seated direction and leaves the original body, head, chair, and tail intact.
const HAND_PROFILES = Object.freeze({
  down: Object.freeze({
    axis: 'vertical',
    keyboard: Object.freeze([73, 142, 48, 18]),
    hands: Object.freeze([
      Object.freeze({ x: 77, y: 128, direction: 1 }),
      Object.freeze({ x: 111, y: 128, direction: 1 }),
    ]),
  }),
  up: Object.freeze({
    // Back-facing forearms reach across the keyboard key lanes. The original
    // back/head projection remains in front and may occlude the far paw;
    // never expose it by painting across the head or shifting it off the keys.
    axis: 'back',
    keyboard: Object.freeze([73, 139, 48, 18]),
    hands: Object.freeze([
      Object.freeze({ x: 0, y: 0, side: -1 }),
      Object.freeze({ x: 0, y: 0, side: 1 }),
    ]),
  }),
  left: Object.freeze({
    axis: 'horizontal',
    keyboard: Object.freeze([55, 127, 42, 19]),
    hands: Object.freeze([
      Object.freeze({ x: 76, y: 128, direction: -1 }),
      Object.freeze({ x: 88, y: 138, direction: -1 }),
    ]),
  }),
  right: Object.freeze({
    axis: 'horizontal',
    keyboard: Object.freeze([95, 127, 42, 19]),
    hands: Object.freeze([
      Object.freeze({ x: 113, y: 128, direction: 1 }),
      Object.freeze({ x: 101, y: 138, direction: 1 }),
    ]),
  }),
});

const PALETTE = Object.freeze({
  outline: '#3a1714',
  shadow: '#8b3519',
  fur: '#d86120',
  light: '#f28a35',
  paw: '#ffd09a',
  pawShadow: '#c05b27',
});

function fail(message) {
  throw new Error(`WorkingHandsLayer: ${message}`);
}

function assertDirection(direction) {
  if (!DIRECTIONS.includes(direction)) fail('方向只允许 up/down/left/right');
}

function assertState(state) {
  if (!STATE_SET.has(state)) fail('只接受原六业务状态');
}

function assertFrame(frame) {
  if (!Number.isInteger(frame) || frame < 0 || frame >= FRAME_COUNT) {
    fail('帧索引应为 0..11');
  }
}

function assertFinite(value, name) {
  if (!Number.isFinite(value)) fail(`${name} 必须为有限数字`);
}

function isWorkingState(state) {
  return WORKING_STATE_SET.has(state);
}

function actionPhase(state, frame) {
  // The hands alternate in every active business state, while each state has a
  // slightly different rhythm so three work modes do not look mechanically
  // identical. All three still render as keyboard typing.
  if (state === 'researching') return Math.floor(frame / 3) % 2;
  if (state === 'executing') return Math.floor(frame / 2) % 2;
  return Math.floor(frame / 2) % 2;
}

function motionOffset(state, frame, handIndex) {
  const phase = actionPhase(state, frame);
  const activeHand = phase === handIndex ? 1 : 0;
  const lift = activeHand ? -2 : 0;
  const reach = activeHand ? (state === 'executing' ? 2 : 1) : 0;
  // Add a restrained second rhythm on the non-active hand. This produces a
  // visible 12-frame animation without moving the actor's base silhouette.
  const counter = frame % 4 === 1 && handIndex !== phase ? 1 : 0;
  const pulse = frame % 3 === 2 ? -1 : 0;
  return Object.freeze({ activeHand, lift, reach, counter, pulse });
}

function rect(ctx, x, y, width, height, color, scale, offsetX, offsetY) {
  ctx.fillStyle = color;
  ctx.fillRect(
    Math.round(offsetX + x * scale),
    Math.round(offsetY + y * scale),
    Math.max(1, Math.round(width * scale)),
    Math.max(1, Math.round(height * scale)),
  );
}

function drawVerticalHand(ctx, anchor, movement, scale, offsetX, offsetY) {
  const x = anchor.x + movement.reach;
  const y = anchor.y + movement.lift + movement.counter + movement.pulse;
  // Short outlined forearm, warm fur core, and a compact paw resting on the
  // keyboard row. Every shape is pixel-aligned and transparent outside it.
  rect(ctx, x - 2, y - 1, 8, 12, PALETTE.outline, scale, offsetX, offsetY);
  rect(ctx, x - 1, y, 6, 9, PALETTE.shadow, scale, offsetX, offsetY);
  rect(ctx, x, y + 1, 4, 7, PALETTE.fur, scale, offsetX, offsetY);
  rect(ctx, x + 1, y + 2, 3, 2, PALETTE.light, scale, offsetX, offsetY);
  rect(ctx, x - 2, y + 9, 8, 5, PALETTE.outline, scale, offsetX, offsetY);
  rect(ctx, x - 1, y + 10, 6, 3, PALETTE.pawShadow, scale, offsetX, offsetY);
  rect(ctx, x, y + 10, 4, 2, PALETTE.paw, scale, offsetX, offsetY);
  rect(ctx, x + 4, y + 11, 1, 1, PALETTE.paw, scale, offsetX, offsetY);
}

function drawBackHand(ctx, anchor, movement, side, scale, offsetX, offsetY) {
  // A compact back-view forearm and paw. Both the movement envelope and
  // key-field placement are measured before rasterizing; actor alpha then
  // supplies the natural occlusion without changing any original actor pixel.
  const x = anchor.x + movement.reach * side;
  const y = anchor.y + movement.lift + movement.counter + movement.pulse;
  const outer = side < 0 ? x : x + 16;
  const arm = side < 0 ? x + 7 : x + 1;
  rect(ctx, x, y + 2, 26, 11, PALETTE.outline, scale, offsetX, offsetY);
  rect(ctx, arm, y + 3, 18, 7, PALETTE.shadow, scale, offsetX, offsetY);
  rect(ctx, side < 0 ? arm + 1 : arm + 5, y + 4, 9, 4, PALETTE.fur, scale, offsetX, offsetY);
  rect(ctx, side < 0 ? arm + 2 : arm + 6, y + 5, 5, 2, PALETTE.light, scale, offsetX, offsetY);
  rect(ctx, outer, y, 10, 15, PALETTE.outline, scale, offsetX, offsetY);
  rect(ctx, outer + 1, y + 2, 8, 11, PALETTE.pawShadow, scale, offsetX, offsetY);
  rect(ctx, outer + 2, y + 3, 5, 5, PALETTE.paw, scale, offsetX, offsetY);
  rect(ctx, outer + 3, y + 8, 4, 3, PALETTE.paw, scale, offsetX, offsetY);
}

function drawHorizontalHand(ctx, anchor, movement, facing, scale, offsetX, offsetY) {
  const x = anchor.x + facing * movement.reach;
  const y = anchor.y + movement.lift + movement.counter + movement.pulse;
  const direction = facing < 0 ? -1 : 1;
  const armX = direction < 0 ? x - 11 : x - 1;
  // Side-facing forearms are horizontal so the hand follows the keyboard in
  // front of the seated character instead of appearing as a floating vertical
  // mark beside the torso.
  rect(ctx, armX - 1, y - 2, 13, 8, PALETTE.outline, scale, offsetX, offsetY);
  rect(ctx, armX, y - 1, 11, 6, PALETTE.shadow, scale, offsetX, offsetY);
  rect(ctx, direction < 0 ? armX + 1 : armX + 5, y, 5, 4, PALETTE.fur, scale, offsetX, offsetY);
  rect(ctx, direction < 0 ? armX + 2 : armX + 6, y + 1, 3, 2, PALETTE.light, scale, offsetX, offsetY);
  const pawX = direction < 0 ? armX - 4 : armX + 10;
  rect(ctx, pawX - 1, y - 1, 6, 7, PALETTE.outline, scale, offsetX, offsetY);
  rect(ctx, pawX, y, 4, 5, PALETTE.pawShadow, scale, offsetX, offsetY);
  rect(ctx, pawX + (direction < 0 ? 1 : 0), y + 1, 3, 2, PALETTE.paw, scale, offsetX, offsetY);
}

// Fit the complete motion envelope, rather than one pose, into the keyboard.
// Derive it from the same primitives so profile bounds cannot silently drift
// when a hand shape or typing rhythm changes.
const ENVELOPES = new Map();
function handEnvelope(direction, handIndex) {
  const key = `${direction}:${handIndex}`;
  if (ENVELOPES.has(key)) return ENVELOPES.get(key);
  const profile = HAND_PROFILES[direction];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const collector = {fillRect(x, y, w, h) {
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + w); maxY = Math.max(maxY, y + h);
  }};
  for (const state of WORKING_STATES) for (let frame = 0; frame < FRAME_COUNT; frame++) {
    profile.hands.forEach((hand, index) => {
      if (index !== handIndex) return;
      const movement = motionOffset(state, frame, index);
      if (profile.axis === 'horizontal') drawHorizontalHand(collector, hand, movement, hand.direction, 1, 0, 0);
      else if (profile.axis === 'back') drawBackHand(collector, hand, movement, hand.side, 1, 0, 0);
      else drawVerticalHand(collector, hand, movement, 1, 0, 0);
    });
  }
  const bounds = Object.freeze([minX, minY, maxX - minX, maxY - minY]);
  ENVELOPES.set(key, bounds);
  return bounds;
}

function keyboardPlacement(direction, keyboardBounds) {
  const profile = HAND_PROFILES[direction];
  const envelopes = profile.hands.map((_, index) => handEnvelope(direction, index));
  if (keyboardBounds == null) {
    // Keep the public no-context helper inside the 192px canvas as well. The
    // real player always supplies keyboardBounds, but unit callers render the
    // profile without a bench context.
    if (direction === 'up') return keyboardPlacement(direction, profile.keyboard);
    return {keyboard: profile.keyboard,
      hands: envelopes.map(envelope => ({envelope, scale: 1, x: 0, y: 0}))};
  }
  if (!Array.isArray(keyboardBounds) || keyboardBounds.length !== 4 ||
      !keyboardBounds.every(Number.isFinite) || keyboardBounds[2] <= 0 || keyboardBounds[3] <= 0) {
    fail('keyboardBounds 必须为 player-local [x,y,width,height] 正尺寸区域');
  }
  const [x, y, width, height] = keyboardBounds;
  // Fit the COMPLETE back-view motion envelopes inside the real key field.
  // Paws may disappear naturally behind the unchanged head projection; never
  // move them onto the mouse/table or paint over the original back to expose them.
  if (direction === 'up') {
    const margin = Math.min(2, width * .08, height * .1);
    return {keyboard: keyboardBounds, hands: envelopes.map((envelope, index) => {
      const [ex, ey, ew, eh] = envelope;
      const scale = Math.min(.85, (width - 2*margin) * .45 / ew, (height - 2*margin) / eh);
      const left = index === 0 ? x + margin : x + width - margin - ew * scale;
      const top = y + (height - eh * scale) / 2;
      return {envelope, scale, x: left - ex * scale, y: top - ey * scale};
    })};
  }
  // Follow the real key-field orientation, including a direction replacement
  // at a bench of the other orientation. The arm primitives still retain the
  // actor's direction. Use the outer key lanes so a seated head can occlude the
  // centre naturally without hiding both hands behind it.
  const vertical = width >= height;
  return {keyboard: keyboardBounds, hands: envelopes.map((envelope, index) => {
    const [ex, ey, ew, eh] = envelope;
    const scale = Math.min(width * (vertical ? .425 : .9) / ew,
      height * (vertical ? .9 : .425) / eh);
    const left = vertical
      ? (index === 0 ? x + width * .01 : x + width * .99 - ew * scale)
      : x + (width - ew * scale) / 2;
    const top = vertical
      ? y + (height - eh * scale) / 2
      : (index === 0 ? y + height * .01 : y + height * .99 - eh * scale);
    return {envelope, scale, x: left - ex * scale, y: top - ey * scale};
  })};
}

/**
 * Draw only the active typing hands into an existing 2D context.
 *
 * The function does not clear the context and does not alter canvas dimensions.
 * keyboardBounds, when supplied, is a player-local key-field rectangle;
 * all hand primitives are uniformly fitted to it, never the old static seat.
 * It returns true only when a working-state overlay was drawn. Hosts that use
 * a dedicated overlay canvas should clear it before calling this function.
 */
export function drawWorkingHands(ctx, {
  direction = 'down', state = 'writing', frame = 0,
  scale = 1, offsetX = 0, offsetY = 0, keyboardBounds = null,
} = {}) {
  if (!ctx || typeof ctx.fillRect !== 'function') fail('需要 Canvas 2D context');
  assertDirection(direction);
  assertState(state);
  assertFrame(frame);
  assertFinite(scale, 'scale');
  assertFinite(offsetX, 'offsetX');
  assertFinite(offsetY, 'offsetY');
  if (scale <= 0) fail('scale 必须大于 0');
  if (!isWorkingState(state)) return false;

  const profile = HAND_PROFILES[direction];
  const placement = keyboardPlacement(direction, keyboardBounds);
  const previousSmoothing = ctx.imageSmoothingEnabled;
  if ('imageSmoothingEnabled' in ctx) ctx.imageSmoothingEnabled = false;
  if (typeof ctx.save === 'function') ctx.save();
  try {
    profile.hands.forEach((hand, index) => {
      const movement = motionOffset(state, frame, index), p = placement.hands[index];
      const handScale = scale * p.scale, handX = offsetX + p.x * scale, handY = offsetY + p.y * scale;
      if (profile.axis === 'horizontal') {
        drawHorizontalHand(ctx, hand, movement, hand.direction, handScale, handX, handY);
      } else if (profile.axis === 'back') {
        drawBackHand(ctx, hand, movement, hand.side, handScale, handX, handY);
      } else {
        drawVerticalHand(ctx, hand, movement, handScale, handX, handY);
      }
    });
  } finally {
    if (typeof ctx.restore === 'function') ctx.restore();
    if ('imageSmoothingEnabled' in ctx) ctx.imageSmoothingEnabled = previousSmoothing;
  }
  return true;
}

/** Metadata for host-side keyboard clipping/QA. No pixels are drawn by this API. */
export function getWorkingHandsProfile(direction = 'down', {keyboardBounds = null} = {}) {
  assertDirection(direction);
  const profile = HAND_PROFILES[direction];
  const placement = keyboardPlacement(direction, keyboardBounds);
  const boxes = placement.hands.map(({envelope: [ex, ey, ew, eh], scale: s, x, y}) =>
    [Math.floor(x + ex * s), Math.floor(y + ey * s), Math.ceil(x + (ex + ew) * s) + 1, Math.ceil(y + (ey + eh) * s) + 1]);
  const left = Math.min(...boxes.map(b => b[0])), top = Math.min(...boxes.map(b => b[1]));
  const right = Math.max(...boxes.map(b => b[2])), bottom = Math.max(...boxes.map(b => b[3]));
  return {
    direction,
    keyboard: [...placement.keyboard],
    axis: profile.axis,
    handAnchors: profile.hands.map(({ x, y, direction: facing, side }, index) => {
      const p = placement.hands[index];
      return [p.x + x * p.scale, p.y + y * p.scale, facing ?? side];
    }),
    handsBounds: [left, top, right - left, bottom - top],
    keyboardAnchored: keyboardBounds != null,
    overlayOnly: true,
  };
}

export class WorkingHandsLayer {
  constructor(canvas, { direction = 'down', state = 'writing', reducedMotion = false, keyboardBounds = null } = {}) {
    assertDirection(direction);
    assertState(state);
    getWorkingHandsProfile(direction, {keyboardBounds});
    if (typeof reducedMotion !== 'boolean') fail('reducedMotion 必须为 boolean');
    this.canvas = canvas;
    this.ctx = canvas?.getContext?.('2d');
    if (!this.ctx) fail('需要 Canvas 2D context');
    this.canvas.width = CANVAS_SIZE[0];
    this.canvas.height = CANVAS_SIZE[1];
    this.direction = direction;
    this.state = state;
    this.frame = 0;
    this.tick = 0;
    this.sampleMs = 0;
    this.reducedMotion = reducedMotion;
    this.keyboardBounds = keyboardBounds == null ? null : [...keyboardBounds];
    this._drawKey = null;
    this.render();
  }

  setDirection(direction) {
    assertDirection(direction);
    if (direction === this.direction) return false;
    this.direction = direction;
    this._drawKey = null;
    return this.render();
  }

  /** Geometry updates are presentation-only and never reset the state clock. */
  setKeyboardBounds(keyboardBounds = null) {
    getWorkingHandsProfile(this.direction, {keyboardBounds});
    const next = keyboardBounds == null ? null : [...keyboardBounds];
    if (JSON.stringify(next) === JSON.stringify(this.keyboardBounds)) return false;
    this.keyboardBounds = next;
    this._drawKey = null;
    return this.render();
  }

  setState(state) {
    assertState(state);
    if (state === this.state) return false;
    this.state = state;
    this.sampleMs = 0;
    this.tick = 0;
    this.frame = 0;
    this._drawKey = null;
    return this.render();
  }

  /** ms is elapsed time since the current state began. */
  sample(ms) {
    assertFinite(ms, '采样时间');
    const elapsed = Math.max(0, ms);
    const tick = Math.floor(elapsed * FPS / 1000);
    if (!Number.isSafeInteger(tick)) fail('采样时间超出安全帧范围');
    this.sampleMs = elapsed;
    this.tick = tick;
    this.frame = tick % FRAME_COUNT;
    return this.render();
  }

  /** QA helper: render an exact cell from the 12-frame working cycle. */
  setFrame(frame) {
    assertFrame(frame);
    this.frame = frame;
    this._drawKey = null;
    return this.render();
  }

  clear() {
    this.ctx.clearRect(0, 0, CANVAS_SIZE[0], CANVAS_SIZE[1]);
    this._drawKey = null;
    return true;
  }

  render() {
    const key = `${this.direction}:${this.state}:${this.frame}:${this.reducedMotion}:${JSON.stringify(this.keyboardBounds)}`;
    if (key === this._drawKey) return false;
    this.ctx.clearRect(0, 0, CANVAS_SIZE[0], CANVAS_SIZE[1]);
    this._drawKey = key;
    if (this.reducedMotion || !isWorkingState(this.state)) return false;
    return drawWorkingHands(this.ctx, { direction: this.direction, state: this.state, frame: this.frame, keyboardBounds: this.keyboardBounds });
  }

  snapshot() {
    const active = !this.reducedMotion && isWorkingState(this.state);
    return {
      direction: this.direction,
      state: this.state,
      action: active ? 'working' : 'none',
      frame: this.frame,
      frameCount: FRAME_COUNT,
      fps: FPS,
      animationMode: 'expression-plus-working-hands',
      handsRendered: active,
      handsAction: active ? 'typing' : 'none',
      keyboardInteraction: active,
      overlayOnly: true,
      bodyFixed: true,
      headFixed: true,
      chairFixed: true,
      tailFixed: true,
      keyboardBounds: getWorkingHandsProfile(this.direction, {keyboardBounds: this.keyboardBounds}).keyboard,
    };
  }
}

export const workingHandsContract = Object.freeze({
  version: 'connected-v5',
  directions: DIRECTIONS,
  fps: FPS,
  frameCount: FRAME_COUNT,
  activeStates: WORKING_STATES,
  inactiveStates: Object.freeze(['idle', 'syncing', 'error']),
  animationMode: 'expression-plus-working-hands',
  overlayOnly: true,
  bodyFixed: true,
});
