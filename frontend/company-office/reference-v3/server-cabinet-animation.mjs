/**
 * Visual state machine for the equipment-room rack.
 *
 * The rack artwork remains the approved static prop. This layer supplies the
 * stateful motion around it (LED cadence, activity glints, fault alarm and a
 * darkened stopped cabinet), so state changes never repaint or mutate the
 * source asset. `state` is deliberately independent from a workstation's
 * business state because the Sub2API telemetry source describes the service,
 * not a particular desk.
 */
export const SERVER_CABINET_STATES = Object.freeze([
  'standby',
  'working',
  'syncing',
  'fault',
  'shutdown',
  'unknown',
]);

const LABELS = Object.freeze({
  standby: '设备间 · 待命',
  working: '设备间 · 运行',
  syncing: '设备间 · 同步',
  fault: '设备间 · 异常',
  shutdown: '设备间 · 停机',
  unknown: '设备间 · 状态未知',
});

const COLORS = Object.freeze({
  standby: 0x63818a,
  working: 0x73bc9a,
  syncing: 0xd0a45d,
  fault: 0xbd6658,
  shutdown: 0x4e5a5a,
  unknown: 0xb08c50,
});

function finiteState(value) {
  return SERVER_CABINET_STATES.includes(value) ? value : 'unknown';
}

/** Draws deterministic, seek-safe rack effects; no timers or tweens. */
export class ServerCabinetAnimation {
  constructor(layout, { reducedMotion = false } = {}) {
    this.layout = structuredClone(layout);
    this.state = 'standby';
    this.detail = '';
    this.source = 'local';
    this.frame = 0;
    this.reducedMotion = Boolean(reducedMotion);
    this.ready = false;
    this.scene = null;
    this.overlay = null;
    this.sprite = null;
    this.lights = [];
    this.warning = null;
    this.label = null;
  }

  create(scene, { sprite, lights, warning, label } = {}) {
    this.scene = scene;
    this.sprite = sprite ?? null;
    this.lights = Array.isArray(lights) ? lights : [];
    this.warning = warning ?? null;
    this.label = label ?? null;
    const [x, y, width, height] = this.layout.server.bounds;
    this.overlay = scene?.add?.graphics?.().setDepth?.(3902) ?? null;
    this.overlay?.setData?.('companyOfficeLocked', true);
    this.overlay?.setVisible?.(true);
    this.ready = true;
    this.sample(scene?.time?.now ?? 0);
    return this;
  }

  setState(state, { detail = '', source = 'local' } = {}) {
    const next = finiteState(state);
    const changed = next !== this.state || String(detail) !== this.detail || source !== this.source;
    this.state = next;
    this.detail = String(detail ?? '');
    this.source = String(source ?? 'local');
    if (changed) this.frame = -1;
    if (this.ready) this.sample(this.scene?.time?.now ?? 0);
    return changed;
  }

  setReducedMotion(value) {
    this.reducedMotion = Boolean(value);
    this.frame = -1;
    if (this.ready) this.sample(this.scene?.time?.now ?? 0);
  }

  sample(time = 0) {
    if (!this.ready) return;
    const tick = this.reducedMotion ? 0 : Math.floor(Math.max(0, Number(time) || 0) * 12 / 1000);
    if (tick === this.frame && !this.reducedMotion) return;
    this.frame = tick;
    const phase = tick % 12;
    const color = COLORS[this.state];
    const pulse = this.reducedMotion ? 0.72 : (phase < 4 ? 0.98 : phase < 8 ? 0.58 : 0.28);
    const staticState = this.state === 'shutdown';
    const darkState = staticState || this.state === 'unknown';
    for (const [index, led] of this.lights.entries()) {
      if (!led?.setFillStyle) continue;
      const ledAlpha = staticState ? 0.12 : this.state === 'unknown' ? 0.28 : pulse * (index === phase % 3 ? 1 : 0.72);
      led.setFillStyle(color, ledAlpha);
      led.setVisible?.(true);
    }
    this.sprite?.setAlpha?.(staticState ? 0.62 : darkState ? 0.8 : 1);
    if (this.label?.setText) this.label.setText(LABELS[this.state]);

    const [x, y, width, height] = this.layout.server.bounds;
    const g = this.warning;
    const overlay = this.overlay;
    g?.clear?.();
    overlay?.clear?.();
    if (this.state === 'fault') {
      g?.lineStyle?.(2, color, pulse);
      g?.strokeRoundedRect?.(x, y, width, height, 3);
      // A compact cross reads as a fault marker at the map's small rack scale.
      g?.lineStyle?.(1, color, Math.max(0.45, pulse));
      g?.beginPath?.();g?.moveTo?.(x + width - 11, y + 5);g?.lineTo?.(x + width - 4, y + 12);g?.moveTo?.(x + width - 4, y + 5);g?.lineTo?.(x + width - 11, y + 12);g?.strokePath?.();
    } else if (this.state === 'shutdown') {
      // Keep the rack recognizable while showing that every tray is powered off.
      g?.fillStyle?.(0x172326, 0.34);
      g?.fillRoundedRect?.(x, y, width, height, 3);
      g?.lineStyle?.(1, 0x758080, 0.45);
      g?.strokeRoundedRect?.(x, y, width, height, 3);
    } else if (this.state === 'unknown') {
      g?.lineStyle?.(1, color, 0.62);
      g?.strokeRoundedRect?.(x, y, width, height, 3);
    }
    if (overlay && !staticState && this.state === 'working') {
      // Three short green airflow glints create motion without changing the
      // approved rack pixels or adding a second asset.
      overlay.fillStyle(color, 0.18 + 0.1 * pulse);
      for (let index = 0; index < 3; index += 1) {
        const offset = (phase * 2 + index * 11) % Math.max(12, width - 14);
        overlay.fillRect(x + 7 + offset, y + height - 5 - index * 3, 5, 1);
      }
    } else if (overlay && !staticState && this.state === 'syncing') {
      overlay.fillStyle(color, 0.24);
      const offset = (phase * 3) % Math.max(12, width - 16);
      overlay.fillRect(x + 6 + offset, y + 3, 8, 1);
      overlay.fillRect(x + width - 14 - offset, y + height - 5, 8, 1);
    }
  }

  snapshot() {
    return {
      state: this.state,
      detail: this.detail,
      source: this.source,
      frame: Math.max(0, this.frame),
      fps: 12,
      reducedMotion: this.reducedMotion,
      ready: this.ready,
      labels: LABELS,
    };
  }

  destroy() {
    this.overlay?.destroy?.();
    this.overlay = null;
    this.scene = null;
    this.ready = false;
  }
}

export { LABELS as SERVER_CABINET_LABELS };
