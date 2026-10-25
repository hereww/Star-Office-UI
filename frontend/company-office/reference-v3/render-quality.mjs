/** Render geometry is physical-pixel based; map coordinates and sprite canvases stay unchanged.
 * Phaser 3.80 does not consume a global `resolution` option. Scale.NONE plus an
 * explicit physical game size is used instead; ScaleManager still maps input
 * from the actual CSS canvas bounds, so pointer/drag coordinates remain correct.
 */
export const OFFICE_TEXT_FONT = '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", system-ui, sans-serif';
const MAX_PIXELS = 7680 * 4320;
const MAX_AXIS = 8192;
export function measureOfficeRendering(container, { dpr = globalThis.devicePixelRatio || 1, mobile = false } = {}) {
  const rect = container.getBoundingClientRect();
  const width = Math.max(1, rect.width), height = Math.max(1, rect.height);
  const fourKTarget = !mobile && ((globalThis.innerWidth || width) * dpr >= 3840 && (globalThis.innerHeight || height) * dpr >= 2160);
  const requestedDensity = Math.max(dpr, fourKTarget ? 3840 / width : 1, fourKTarget ? 2160 / height : 1);
  const density = Math.min(requestedDensity, MAX_AXIS / width, MAX_AXIS / height, Math.sqrt(MAX_PIXELS / (width * height)));
  const backingWidth = Math.min(MAX_AXIS, Math.round(width * density));
  const backingHeight = Math.min(MAX_AXIS, Math.round(height * density), Math.floor(MAX_PIXELS / backingWidth));
  return { cssSize: [width, height], backingSize: [backingWidth, backingHeight],
    density, requestedDensity, devicePixelRatio: dpr, mobile, fourKTarget, capped: density < requestedDensity - 0.001 };
}
function isMobile() { return globalThis.matchMedia?.('(max-width: 900px), (pointer: coarse)').matches ?? false; }
/** Called before Phaser.Game construction. Do not use Scale.RESIZE: it resets
 * the backing store to CSS pixels on each refresh, losing high-DPI rendering. */
export function prepareOfficeRendering(config, container, Phaser) {
  const size = measureOfficeRendering(container, { mobile: isMobile() });
  [config.width, config.height] = size.backingSize;
  config.scale = { mode: Phaser.Scale.NONE, autoCenter: Phaser.Scale.NO_CENTER,
    width: config.width, height: config.height, autoRound: false };
  return size;
}
export class OfficeRenderQuality {
  constructor(scene, container, onChange) {
    this.scene = scene; this.container = container; this.onChange = onChange; this.disposed = false;
    this.schedule = () => {
      if (this.disposed || this.pending) return;
      this.pending = requestAnimationFrame(() => { this.pending = null; this.refresh(); });
    };
    this.observer = new ResizeObserver(this.schedule); this.observer.observe(container);
    globalThis.addEventListener('resize', this.schedule);
    globalThis.visualViewport?.addEventListener('resize', this.schedule);
    this.watchDpr(); this.refresh();
  }
  watchDpr() {
    this.dprQuery?.removeEventListener('change', this.dprChanged);
    this.dprQuery = globalThis.matchMedia?.(`(resolution: ${globalThis.devicePixelRatio || 1}dppx)`);
    this.dprChanged = () => { this.watchDpr(); this.schedule(); };
    this.dprQuery?.addEventListener('change', this.dprChanged);
  }
  refresh() {
    if (this.disposed) return;
    const size = measureOfficeRendering(this.container, { mobile: isMobile() });
    const previous = this.measurement; this.measurement = size;
    const game = this.scene.sys.game, [w, h] = size.backingSize;
    if (game.canvas.width !== w || game.canvas.height !== h) game.scale.resize(w, h);
    // Also refresh pointer mapping after CSS-only resize/zoom/monitor changes.
    game.scale.refresh();
    if (!previous || previous.density !== size.density || previous.cssSize.some((v, i) => v !== size.cssSize[i])) this.onChange?.();
  }
  get density() {
    const canvas = this.scene.sys.game.canvas, rect = canvas.getBoundingClientRect();
    return canvas.width / Math.max(1, rect.width);
  }
  get textScale() {
    // Wider displays get a modest screen-space type increase, never world-zoomed text.
    return Math.min(1.4, Math.max(1, (globalThis.innerWidth || 1440) / 2400));
  }
  styleText(text, cssFontSize = 14) {
    const density = this.density, zoom = this.scene.cameras.main.zoom;
    const fontSize = Math.round(cssFontSize * this.textScale);
    if (text.style.fontSize !== `${fontSize}px`) text.setFontSize(`${fontSize}px`);
    const scale = density / Math.max(0.01, zoom);
    if (text.scaleX !== scale || text.scaleY !== scale) text.setScale(scale);
    const resolution = Math.ceil(density);
    if (text.style.resolution !== resolution) text.setResolution(resolution);
    text._officeCssFontSize = fontSize;
    return text;
  }
  snapshot() {
    const canvas = this.scene.sys.game.canvas, rect = canvas.getBoundingClientRect(), gl = this.scene.sys.game.renderer.gl;
    return { strategy: 'physical-game-size + screen-space-system-text',
      canvasBacking: [canvas.width, canvas.height], canvasCss: [rect.width, rect.height],
      density: this.density, devicePixelRatio: globalThis.devicePixelRatio || 1,
      fourKBacking: canvas.width >= 3840 && canvas.height >= 2160,
      mobile: this.measurement?.mobile, fourKTarget:this.measurement?.fourKTarget, capped: this.measurement?.capped,
      maxBackingPixels:MAX_PIXELS, maxBackingAxis:MAX_AXIS,
      textFont: OFFICE_TEXT_FONT, textResolution: Math.ceil(this.density),
      drawingBuffer: gl ? [gl.drawingBufferWidth, gl.drawingBufferHeight] : [canvas.width, canvas.height] };
  }
  destroy() {
    this.disposed = true; this.observer.disconnect(); if (this.pending) cancelAnimationFrame(this.pending);
    globalThis.removeEventListener('resize', this.schedule);
    globalThis.visualViewport?.removeEventListener('resize', this.schedule);
    this.dprQuery?.removeEventListener('change', this.dprChanged);
  }
}
