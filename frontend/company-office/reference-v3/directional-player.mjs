import { BUSINESS_STATES, loadImage } from '../seated-compositor.mjs';
import { validateScreenConfig, sampleScreenEffects, drawScreenEffects } from './screen-effects.mjs';

export { BUSINESS_STATES };

const DIRECTIONS = Object.freeze(['up', 'down', 'left', 'right']);
const ACTION_CLOCKS = Object.freeze({ working: 60, idle: 36, syncing: 60, error: 12 });
const DRAW_ORDER = Object.freeze(['back', 'actor', 'front', 'screen']);
// Cache textures only, never player state. Separate injected loaders cannot contaminate each other.
const imageCaches = new WeakMap();

function fail(message) {
  throw new Error(`DirectionalSeatedPlayer: ${message}`);
}

function tuple(value, length, name) {
  if (!Array.isArray(value) || value.length !== length || value.some(n => !Number.isFinite(n))) {
    fail(`${name} 无效`);
  }
}

function path(value, name) {
  if (typeof value !== 'string' || value.trim().length === 0) fail(`${name} 缺少资源路径`);
}

function assertDirection(direction) {
  if (!DIRECTIONS.includes(direction)) fail('方向只允许 up/down/left/right');
}

function directionSpec(assets, direction) {
  if (assets.directions && Object.hasOwn(assets.directions, direction)) {
    return { ...assets.directions[direction], fallback: false };
  }
  // Only the original frontal character/workstation can be used as a legacy fallback.
  // Missing profiles/back views never silently substitute, rotate, or mirror the down asset.
  if (direction === 'down' && assets.character && (assets.furniture || assets.workstation)) {
    return { character: assets.character, furniture: assets.furniture || assets.workstation, fallback: true };
  }
  fail(`缺少 ${direction} 方向资源`);
}

function validateSpec(assets, direction, spec) {
  const c = spec.character, furniture = spec.furniture;
  if (!c || typeof c !== 'object' || c.direction !== direction) fail(`${direction}.character.direction 不匹配`);
  if (!furniture || typeof furniture !== 'object') fail(`${direction}.furniture 缺失`);
  if (furniture.direction !== undefined && furniture.direction !== direction) fail(`${direction}.furniture.direction 不匹配`);
  path(c.base, `${direction}.character.base`);
  for (const [value, name] of [[c.frameSize, 'frameSize'], [furniture.size, 'furniture.size']]) {
    tuple(value, 2, `${direction}.${name}`);
    if (value[0] !== 192 || value[1] !== 192) fail(`${direction}.${name} 必须为 192x192`);
  }
  tuple(c.poseAnchor, 2, `${direction}.poseAnchor`);
  tuple(furniture.seatAnchor, 2, `${direction}.seatAnchor`);
  if (!Number.isFinite(c.scale) || c.scale <= 0 || c.scale > 4) fail(`${direction}.scale 无效`);
  if (c.headAnchor !== undefined) tuple(c.headAnchor, 2, `${direction}.headAnchor`);
  if (c.faceVisible !== undefined && typeof c.faceVisible !== 'boolean') fail(`${direction}.faceVisible 无效`);
  if (direction === 'up' && c.faceVisible !== false) fail('up 必须为真正背面，faceVisible:false');
  if (direction !== 'up' && c.faceVisible === false) fail(`${direction} 必须提供可见表情`);
  const faceVisible = c.faceVisible !== false;
  const fullFrame = c.animationMode === 'full-frame';
  if (!fullFrame || c.pixelFaceAnimation || c.faceRect || c.faceClipEllipse || c.faceFrameSize) fail(`${direction} 必须使用整帧资源合同`);
  if (!c.actions || typeof c.actions !== 'object' || Array.isArray(c.actions) ||
      Object.keys(c.actions).length !== 4) fail(`${direction} 必须保留四套表情动作，无手部动作`);
  for (const [action, clock] of Object.entries(ACTION_CLOCKS)) {
    const config = c.actions[action];
    if (!Object.hasOwn(c.actions, action) || !config || typeof config !== 'object') fail(`${direction}.${action} 缺失`);
    if (config.faceClockFrames !== undefined && config.faceClockFrames !== clock) {
      fail(`${direction}.${action}.faceClockFrames 必须为 ${clock}`);
    }
    if (fullFrame) {
      path(config.frames, `${direction}.${action}.frames`);
      if (config.frameCount !== 12 || config.fps !== 12 || config.clockFrames !== clock) fail(`${direction}.${action} 整帧元数据无效`);
    }
  }
  for (const layer of ['back', 'front']) path(furniture[layer], `${direction}.furniture.${layer}`);
  const order = furniture.order ?? (spec.fallback ? DRAW_ORDER : null);
  if (!Array.isArray(order) || order.length !== 4 || new Set(order).size !== 4 ||
      order.some(layer => !DRAW_ORDER.includes(layer))) fail(`${direction}.order 必须包含 back/actor/front/screen 各一次`);
  validateScreenConfig(furniture.screen);
}

/** Validate the declared directions (partial asset sets are allowed), without editing assets. */
export function validateDirectionalAssets(assets) {
  if (!assets || typeof assets !== 'object' || Array.isArray(assets)) fail('assets 无效');
  if (assets.fps !== 12 || assets.frameCount !== 12 || assets.grid?.length !== 2 ||
      assets.grid[0] !== 4 || assets.grid[1] !== 3) fail('局部表情必须为 4x3 的 12 帧、12fps');
  if (assets.faceClockFrames !== undefined && assets.faceClockFrames !== 60) fail('默认 faceClockFrames 必须为 60');
  if (assets.businessStateToAction !== undefined) {
    const map = assets.businessStateToAction;
    if (!map || Object.keys(map).length !== 6 ||
        Object.entries(BUSINESS_STATES).some(([state, action]) => !Object.hasOwn(map, state) || map[state] !== action)) {
      fail('businessStateToAction 必须保持原六状态固定映射');
    }
  }
  const directions = assets.directions;
  if (directions !== undefined && (!directions || typeof directions !== 'object' || Array.isArray(directions))) {
    fail('directions 必须为方向配置对象');
  }
  const declared = Object.keys(directions ?? {});
  for (const direction of declared) {
    assertDirection(direction);
    if (!directions[direction] || typeof directions[direction] !== 'object' || Array.isArray(directions[direction])) {
      fail(`${direction} 方向配置无效`);
    }
    validateSpec(assets, direction, directionSpec(assets, direction));
  }
  if (!declared.includes('down') && (assets.character || assets.furniture || assets.workstation)) {
    validateSpec(assets, 'down', directionSpec(assets, 'down'));
  } else if (declared.length === 0) {
    fail('缺少可播放的方向资源');
  }
  return assets;
}

function freeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

function assertImageSize(image, width, height, label) {
  const actualWidth = image?.naturalWidth || image?.width;
  const actualHeight = image?.naturalHeight || image?.height;
  if (actualWidth !== width || actualHeight !== height) fail(`${label} 图片尺寸必须为 ${width}x${height}`);
}

async function cachedImage(loader, url, width, height, label) {
  let cache = imageCaches.get(loader);
  if (!cache) {
    cache = { images: new Map(), pending: new Map() };
    imageCaches.set(loader, cache);
  }
  if (cache.images.has(url)) {
    const image = cache.images.get(url);
    assertImageSize(image, width, height, label);
    return image;
  }
  let pending = cache.pending.get(url);
  if (!pending) {
    pending = Promise.resolve().then(() => loader(url));
    cache.pending.set(url, pending);
  }
  try {
    const image = await pending;
    // An invalid/half-written image is a failed load too: never poison the success cache.
    assertImageSize(image, width, height, label);
    cache.images.set(url, image);
    return image;
  } catch (error) {
    throw new Error(`无法加载 ${label}: ${error?.message ?? error}`, { cause: error });
  } finally {
    if (cache.pending.get(url) === pending) cache.pending.delete(url);
  }
}

function placementOf({ character: c, furniture }) {
  const [sx, sy] = furniture.seatAnchor;
  return Object.freeze([
    sx - c.poseAnchor[0] * c.scale, sy - c.poseAnchor[1] * c.scale,
    c.frameSize[0] * c.scale, c.frameSize[1] * c.scale,
  ]);
}

/** No scheduler, DOM, Phaser, or external dependencies; time is supplied by the runtime. */
export class DirectionalSeatedPlayer {
  constructor(canvas, assets, {
    baseUrl = import.meta.url, direction = 'down', imageLoader = loadImage, reducedMotion = false,
  } = {}) {
    validateDirectionalAssets(assets);
    assertDirection(direction);
    if (typeof imageLoader !== 'function') fail('imageLoader 必须为函数');
    if (typeof reducedMotion !== 'boolean') fail('reducedMotion 必须为 boolean');
    this.assets = freeze(structuredClone(assets));
    this.spec = directionSpec(this.assets, direction);
    this.canvas = canvas;
    this.ctx = canvas?.getContext?.('2d');
    if (!this.ctx) fail('需要 Canvas 2D context');
    this.canvas.width = 192;
    this.canvas.height = 192;
    this.baseUrl = new URL(baseUrl, import.meta.url).href;
    this.loader = imageLoader;
    this.direction = direction;
    this.state = 'writing';
    this.frame = 0;
    this.faceFrame = 0;
    this.tick = 0;
    this.sampleMs = 0;
    this.images = Object.freeze({});
    this.ready = false;
    this._placement = placementOf(this.spec);
    this._reducedMotion = reducedMotion;
    this._drawKey = null;
    this._directionRequest = 0;
    this._initializing = null;
    this._directionLoading = null;
  }

  async initialize() {
    if (this.ready) return this;
    if (!this._initializing) {
      const starting = this._directionLoading ?? this.setDirection(this.direction);
      this._initializing = (async () => {
        await starting;
        // A superseded load may resolve before its successor. Ready means an actual
        // complete direction was committed, not merely that the first promise settled.
        while (!this.ready && this._directionLoading) await this._directionLoading;
        if (!this.ready) fail('初始化未完成，请重试');
        return this;
      })();
    }
    const pending = this._initializing;
    try {
      return await pending;
    } finally {
      if (this._initializing === pending) this._initializing = null;
    }
  }

  async _load(spec, direction) {
    const { character: c, furniture } = spec;
    const resources = [
      ['back', furniture.back, 192, 192], ['front', furniture.front, 192, 192], ['base', c.base, 192, 192],
    ];
    for (const action of Object.keys(ACTION_CLOCKS)) resources.push([action, c.actions[action].frames, 768, 576]);
    const entries = await Promise.all(resources.map(async ([key, url, w, h]) => {
      const image = await cachedImage(this.loader, new URL(url, this.baseUrl).href, w, h, `${direction}.${key}`);
      return [key, image];
    }));
    const images=Object.fromEntries(entries);
    return Object.freeze(images);
  }

  async setDirection(direction) {
    assertDirection(direction);
    const spec = directionSpec(this.assets, direction);
    const request = ++this._directionRequest;
    if (this.ready && direction === this.direction) return this; // Also cancels an older pending turn.
    const pending = this._prepareDirection(direction, spec, request);
    this._directionLoading = pending;
    try {
      return await pending;
    } finally {
      if (this._directionLoading === pending) this._directionLoading = null;
    }
  }

  async _prepareDirection(direction, spec, request) {
    const images = await this._load(spec, direction);
    if (request !== this._directionRequest) return this; // Last direction request wins, never a stale load.
    // Atomic commit: do not touch the active scene until every image and dimension is valid.
    this.spec = spec;
    this.images = images;
    this.direction = direction;
    this._placement = placementOf(spec);
    this.ready = true;
    // State, elapsed time, tick and any QA face frame survive the asynchronous load unchanged.
    this._drawKey = null;
    this._render();
    return this;
  }

  action() {
    return BUSINESS_STATES[this.state];
  }

  setState(state) {
    if (!Object.hasOwn(BUSINESS_STATES, state)) fail('只接受原六业务状态');
    if (state === this.state) return false;
    this.state = state;
    this.sampleMs = 0;
    this.tick = 0;
    this.frame = 0;
    this.faceFrame = 0;
    return this._render();
  }

  /** ms is elapsed time since the CURRENT state began, not an absolute wall clock. */
  sample(ms) {
    if (!Number.isFinite(ms)) fail('采样时间必须有限');
    const elapsed = Math.max(0, ms), tick = Math.floor(elapsed * 12 / 1000);
    if (!Number.isSafeInteger(tick)) fail('采样时间超出安全帧范围');
    this.sampleMs = elapsed;
    this.tick = tick;
    const clock = ACTION_CLOCKS[this.action()];
    const faceTick = tick % clock;
    // Preserve the established state clocks: working/syncing animate their
    // 12-frame atlas once, then hold frame 0 until the 60-frame cycle resets;
    // idle does the same over 36 frames, while error loops every 12 frames.
    this.frame = faceTick < 12 ? faceTick : 0;
    this.faceFrame = this.spec?.character?.animationMode === 'full-frame' ? this.frame : (faceTick < 12 ? faceTick : 0);
    return this._render();
  }

  /** QA samples all 12 atlas cells; it does not advance/reset the elapsed-state clock. */
  setFrame(frame) {
    if (!Number.isInteger(frame) || frame < 0 || frame > 11) fail('帧索引应为 0..11');
    this.frame = frame;
    this.faceFrame = frame;
    return this._render();
  }

  get reducedMotion() {
    return this._reducedMotion;
  }

  set reducedMotion(value) {
    this.setReducedMotion(value);
  }

  setReducedMotion(value) {
    if (typeof value !== 'boolean') fail('reducedMotion 必须为 boolean');
    if (value === this._reducedMotion) return false;
    this._reducedMotion = value;
    return this._render();
  }

  bodyPlacement() {
    return [...this._placement];
  }

  _screen() {
    return sampleScreenEffects(this.spec.furniture.screen, this.state, this.sampleMs, { reducedMotion: this.reducedMotion });
  }

  _drawActor() {
    const ctx = this.ctx, c = this.spec.character;
    const [x, y, w, h] = this._placement;
    const atlas = this.images[this.action()];
    ctx.drawImage(atlas, (this.frame % 4) * 192, Math.floor(this.frame / 4) * 192, 192, 192, x, y, w, h);
  }

  _render() {
    if (!this.ready) return false;
    const screen = this._screen();
    const face = this.spec.character.animationMode === 'full-frame' ? this.frame : (this.spec.character.faceVisible === false ? '-' : this.faceFrame);
    const key = `${this.direction}:${this.state}:${face}:${screen.key}`;
    if (key === this._drawKey) return false;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, 192, 192);
    ctx.imageSmoothingEnabled = false;
    for (const layer of this.spec.furniture.order ?? DRAW_ORDER) {
      if (layer === 'actor') this._drawActor();
      else if (layer === 'screen') drawScreenEffects(ctx, screen);
      else ctx.drawImage(this.images[layer], 0, 0);
    }
    this._drawKey = key;
    return true;
  }

  snapshot() {
    const clock = ACTION_CLOCKS[this.action()];
    return {
      ready: this.ready, direction: this.direction, directionFallback: this.spec.fallback,
      state: this.state, action: this.action(), frame: this.frame, faceFrame: this.faceFrame,
      fps: 12, frameCount: 12, clock, faceClockFrames: clock, clockTick: this.tick % clock,
      tick: this.tick, sampleMs: this.sampleMs, animationMode: this.spec.character.animationMode === 'full-frame' ? 'full-frame' : 'expression-only',
      bodyPlacement: this.bodyPlacement(), bodyFixed: true, handsRendered: false,
      seatAnchor: [...this.spec.furniture.seatAnchor], poseAnchor: [...this.spec.character.poseAnchor],
      faceVisible: this.spec.character.faceVisible !== false,
      reducedMotion: this.reducedMotion, screen: this._screen(),
    };
  }
}
