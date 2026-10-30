import { decodeSnapshot, toRuntimeSnapshot } from './codec.mjs';

export const DRAG_THRESHOLD_PX = 8;
export function stationIdFromObjects(objects){
  for(const object of objects??[]){
    const id=object?.getData?.('companyOfficeStationId');
    if(typeof id==='string'&&id)return id;
  }
  return null;
}
/** Phaser positions use the backing canvas, while the drag threshold is CSS pixels. */
export function pointerCssPosition(pointer, canvas){
  const rect=canvas?.getBoundingClientRect?.();
  return {x:pointer.x*(rect?.width&&canvas.width?rect.width/canvas.width:1),
    y:pointer.y*(rect?.height&&canvas.height?rect.height/canvas.height:1)};
}
export function exceededDragThreshold(origin, point, threshold=DRAG_THRESHOLD_PX){
  if(!origin||!point)return false;
  return Math.hypot(point.x-origin.x,point.y-origin.y)>threshold;
}
/**
 * Zoom is a separate interaction from map panning.  Keep the existing
 * annotation hit-test here, but let the employee surface disable wheel zoom
 * without disabling workstation clicks or dragging.
 */
export function shouldIgnoreWheelZoom({ zoomLocked = false, objects = [] } = {}) {
  return Boolean(zoomLocked) || objects?.some(o => o?.getData?.('companyOfficeLocked')) === true;
}

/** Revalidate the anonymous allowlist at the runtime boundary, including elapsed identity. */
export function runtimeEnvelope(wire, { now = Date.now() } = {}) { return toRuntimeSnapshot(decodeSnapshot(wire, { now }), { now }); }

/** Sole bridge to the existing Phaser/ES-module scene. No legacy page imports. */
export function sameOriginAsset(path, base, origin = globalThis.location.origin) {
  const url = new URL(path, base);
  if (url.origin !== origin || !['http:', 'https:'].includes(url.protocol)) throw new Error('资源必须同源');
  return url.href;
}
export async function loadPhaser(url) {
  if (globalThis.Phaser) return globalThis.Phaser;
  await new Promise((resolve, reject) => {
    const script = document.createElement('script'); script.src = url; script.onload = resolve;
    script.onerror = () => { script.remove(); reject(new Error('Phaser 加载失败')); }; document.head.append(script);
  });
  if (!globalThis.Phaser) throw new Error('Phaser 不可用'); return globalThis.Phaser;
}
function maskPendingRuntime(runtime) {
  // The old runtime defaults all sixteen actors to idle. Never show that as live data.
  for (const station of runtime.stations) {
    station.sprite?.setVisible(false); station.bubbleText?.setVisible(false); station.bubbleBackground?.clear();
  }
  for (const overlay of runtime.screenOverlays ?? []) for (const part of overlay.components) part.sprite?.setVisible(false);
  runtime.selection?.clear(); runtime.serverLabel?.setText('设备间'); runtime.serverWarning?.clear();
  // The rack animation is telemetry-driven; keep its overlay dark until the
  // adapter applies the first validated snapshot.
  runtime.serverCabinetAnimation?.overlay?.setVisible(false);
  for (const led of runtime.serverLights ?? []) led.setVisible(false);
}
export async function createOfficeMap(host, config, { mode = 'employee', onSelect = () => {}, onUserSelect = () => {}, onReady = () => {} } = {}) {
  const base = config.releasePrefix;
  const paths = { runtime: sameOriginAsset(config.runtimeModule || config.v4RuntimeModule || '../company-office/connected-v5/runtime.mjs', base), assets: sameOriginAsset(config.assetBase || config.v4AssetBase || '../company-office/connected-v5/', base), quality: sameOriginAsset(config.renderQualityModule || '../company-office/reference-v3/render-quality.mjs', base), phaser: sameOriginAsset(config.phaserScript || '../vendor/phaser-3.80.1.min.js', base) };
  const [Phaser, runtimeModule, qualityModule] = await Promise.all([loadPhaser(paths.phaser), import(paths.runtime), import(paths.quality)]);
  const runtime = await runtimeModule.ConnectedOfficeRuntime.load(paths.assets);
  let adapterModule = null;
  adapterModule = await import(sameOriginAsset(config.runtimeAdapterModule || '../company-office/connected-v5/telemetry-adapter.mjs', base));
  let game, adapter, scene, disposed = false, latest = null, display = null;
  // Every V5 map starts locked so a wheel gesture cannot accidentally zoom
  // the office while the user is panning or inspecting it. The employee and
  // admin surfaces can explicitly unlock this local interaction when needed.
  let zoomLocked = true;
  let readyResolve, readyReject;
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  const change = event => { if (event.detail === runtime && !disposed) onSelect(runtime.activeStation); };
  window.addEventListener('office-runtime-change', change);
  const gameConfig = { type: Phaser.AUTO, parent: host, pixelArt: true, roundPixels: true, backgroundColor: '#e9ede5', render: { antialias: false }, input: { activePointers: 3 }, scene: {
    preload() { runtime.preload(this); this.load.on('loaderror', () => readyReject(new Error('地图素材加载失败'))); },
    create() {
      scene = this;
      try {
        runtime.managedPointerInteractions = true;
        runtime.create(this);
        {
          if (adapterModule) {
            adapter = new adapterModule.OfficeRuntimeAdapter(runtime, { mode: mode === 'demo' ? 'preview' : 'live' });
            if (mode === 'demo') adapter.setDemoMode(true);
            if (typeof adapter?.applyTelemetrySnapshot !== 'function') throw new Error('运行时适配器缺少 applyTelemetrySnapshot');
          }
        }
        this.input.on('wheel', (_pointer, objects, _dx, dy) => {
          if (shouldIgnoreWheelZoom({ zoomLocked, objects })) return;
          const camera = this.cameras.main; camera.setZoom(Math.max(0.3, Math.min(8, camera.zoom * (dy > 0 ? 0.94 : 1.06))));
        });
        let drag = null;
        this.input.on('pointerdown', (pointer, objects) => {
          const stationId=stationIdFromObjects(objects);
          // Station hit areas are candidates for a click, but not blockers for
          // map panning. Other locked annotations retain their old behavior.
          if (objects?.some(o => o.getData?.('companyOfficeLocked')) && !stationId) return;
          drag = { pointerId:pointer.id, css:pointerCssPosition(pointer, this.sys.game.canvas), x:pointer.x, y:pointer.y, sx:this.cameras.main.scrollX, sy:this.cameras.main.scrollY, stationId, moved:false };
        });
        this.input.on('pointermove', pointer => {
          if (!drag || drag.pointerId!==pointer.id) return;
          if (!drag.moved && exceededDragThreshold(drag.css, pointerCssPosition(pointer, this.sys.game.canvas))) {
            drag.moved=true;
            runtime.pointerDragging=true;
            runtime.setHoverStation?.(null);
          }
          if (!drag.moved) return;
          this.cameras.main.setScroll(drag.sx - (pointer.x - drag.x) / this.cameras.main.zoom, drag.sy - (pointer.y - drag.y) / this.cameras.main.zoom);
        });
        this.input.on('pointerup', pointer => {
          if (!drag || drag.pointerId!==pointer.id) return;
          const completed=drag;drag=null;runtime.pointerDragging=false;
          const moved=completed.moved||exceededDragThreshold(completed.css,pointerCssPosition(pointer,this.sys.game.canvas));
          if(completed.stationId&&!moved){runtime.selectStation(completed.stationId,{focus:false});onUserSelect(completed.stationId);}
        });
        const cancelDrag=()=>{drag=null;runtime.pointerDragging=false;runtime.setHoverStation?.(null);};
        this.input.on('gameout', cancelDrag);
        this.input.on('pointerupoutside', cancelDrag);
        if (latest && adapter) adapter.applyTelemetrySnapshot(runtimeEnvelope(latest));
        if (display && adapter?.applyDisplaySettings) adapter.applyDisplaySettings(display);
        readyResolve(); onReady({ adapterReady: Boolean(adapter), renderQuality: runtime.renderQuality?.snapshot() });
      } catch (error) { readyReject(error); }
    },
    update(time, delta) { if (!disposed) { if (adapter) adapter.update(time, delta); else runtime.update(time); if (mode !== 'demo' && !adapter) maskPendingRuntime(runtime); } },
  } };
  qualityModule.prepareOfficeRendering(gameConfig, host, Phaser);
  const timeout = setTimeout(() => readyReject(new Error('地图加载超时')), 30_000);
  try { game = new Phaser.Game(gameConfig); await ready; }
  catch (error) { disposed = true; game?.destroy(true); window.removeEventListener('office-runtime-change', change); throw error; }
  finally { clearTimeout(timeout); }
  const handle = {
    runtime, get adapterReady() { return Boolean(adapter); },
    applyTelemetrySnapshot(snapshot) { latest = runtimeEnvelope(snapshot); if (adapter) adapter.applyTelemetrySnapshot(latest); else maskPendingRuntime(runtime); },
    applyDisplaySettings(settings) { display = settings; if (adapter?.applyDisplaySettings) adapter.applyDisplaySettings(settings); },
    setZoomLocked(locked = true) { zoomLocked = Boolean(locked); return zoomLocked; },
    get zoomLocked() { return zoomLocked; },
    selectStation(id, { focus = false } = {}) { if (adapter?.selectStation) adapter.selectStation(id, { focus }); else { runtime.selectStation(id, { focus }); if (mode !== 'demo') maskPendingRuntime(runtime); } },
    setView(view) { if (adapter?.setView) adapter.setView(view); else { runtime.setView(view); if (mode !== 'demo') maskPendingRuntime(runtime); } },
    async setDemoCharacterProfile(profileId) { if (mode !== 'demo') throw new Error('演示不可修改真实办公室'); await Promise.all(runtime.stations.map(station => runtime.setStationCharacterProfile(station.id, profileId))); },
    setDemoState(state) { if (mode !== 'demo') throw new Error('演示不可修改真实办公室'); for (const station of runtime.stations) adapter.setStationState(station.id, state); },
    dispose() { disposed = true; adapter?.destroy?.(); window.removeEventListener('office-runtime-change', change); game.destroy(true); if (window.officeRuntime === runtime) delete window.officeRuntime; },
  };
  return handle;
}
