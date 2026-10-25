import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { ServerCabinetAnimation } from '../frontend/company-office/reference-v3/server-cabinet-animation.mjs';
import { serverCabinetStateFromTelemetry } from '../frontend/company-office/connected-v4/telemetry-adapter.mjs';

const layout = JSON.parse(readFileSync(new URL('../frontend/company-office/reference-v3/layout.json', import.meta.url), 'utf8'));

function graphics() {
  const calls = [];
  const g = { calls };
  for (const name of ['clear', 'fillStyle', 'lineStyle', 'fillRoundedRect', 'strokeRoundedRect', 'fillRect', 'beginPath', 'moveTo', 'lineTo', 'strokePath', 'setDepth', 'setVisible', 'setData']) {
    g[name] = (...args) => { calls.push({ name, args }); return g; };
  }
  return g;
}

function scene() {
  const created = graphics();
  return { time: { now: 0 }, add: { graphics: () => created }, created };
}

test('rack working animation emits deterministic airflow glints', () => {
  const s = scene();
  const lights = [0, 1, 2].map(() => ({ calls: [], setFillStyle(...args) { this.calls.push(args); } }));
  const sprite = { alphas: [], setAlpha(value) { this.alphas.push(value); } };
  const label = { texts: [], setText(value) { this.texts.push(value); } };
  const monitor = new ServerCabinetAnimation(layout);
  monitor.create(s, { sprite, lights, warning: graphics(), label });
  monitor.setState('working', { source: 'sub2api' });
  monitor.sample(500);
  assert.equal(monitor.state, 'working');
  assert.equal(label.texts.at(-1), '设备间 · 运行');
  assert.ok(s.created.calls.some(call => call.name === 'fillRect'));
  assert.ok(lights.every(light => light.calls.length > 0));
  assert.equal(monitor.snapshot().source, 'sub2api');
});

test('rack fault and shutdown states have separate visual treatment', () => {
  const s = scene();
  const warning = graphics();
  const sprite = { alphas: [], setAlpha(value) { this.alphas.push(value); } };
  const label = { texts: [], setText(value) { this.texts.push(value); } };
  const lights = [0, 1, 2].map(() => ({ calls: [], setFillStyle(...args) { this.calls.push(args); } }));
  const monitor = new ServerCabinetAnimation(layout);
  monitor.create(s, { sprite, lights, warning, label });
  monitor.setState('fault', { detail: '遥测异常', source: 'sub2api' });
  assert.equal(label.texts.at(-1), '设备间 · 异常');
  assert.ok(warning.calls.some(call => call.name === 'strokeRoundedRect'));
  assert.ok(warning.calls.some(call => call.name === 'lineTo'));
  monitor.setState('shutdown', { source: 'sub2api' });
  assert.equal(label.texts.at(-1), '设备间 · 停机');
  assert.ok(warning.calls.some(call => call.name === 'fillRoundedRect'));
  assert.equal(sprite.alphas.at(-1), 0.62);
});

test('telemetry source maps to working, fault, and shutdown without fabricating idle', () => {
  assert.equal(serverCabinetStateFromTelemetry({ source: { status: 'ok' } }), 'working');
  assert.equal(serverCabinetStateFromTelemetry({ source: { status: 'ok', rack_state: 'idle' } }), 'standby');
  assert.equal(serverCabinetStateFromTelemetry({ source: { status: 'stale' } }), 'unknown');
  assert.equal(serverCabinetStateFromTelemetry({ source: { status: 'connecting' } }), 'shutdown');
  assert.equal(serverCabinetStateFromTelemetry({ source: { status: 'error', error_code: 'not_configured' } }), 'shutdown');
  assert.equal(serverCabinetStateFromTelemetry({ source: { status: 'error', error_code: 'upstream_unavailable' } }), 'fault');
  assert.equal(serverCabinetStateFromTelemetry({ source: { status: 'future' } }), 'unknown');
});
