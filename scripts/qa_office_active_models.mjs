import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { decodeSnapshot } from '../frontend/office/codec.mjs';
import { activeModelsLabel } from '../frontend/office/active-models.mjs';
import { wireSnapshot } from '../frontend/office/.local/tests/fixtures.mjs';
const require = createRequire('/Users/hepingyu/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json');
const { chromium } = require('playwright');
const origin = process.env.OFFICE_MODEL_QA_ORIGIN || 'http://127.0.0.1:19026';
const live = process.env.OFFICE_MODEL_QA_LIVE === '1';
const output = resolve(process.env.OFFICE_MODEL_QA_OUTPUT || '.local/model-status-20261022/browser');
await mkdir(output, { recursive: true });
const report = { live, devices: [], errors: [], unexpectedResponses: [], writes: [] };
const browser = await chromium.launch({ channel: 'chrome', headless: true });
function fixture(phase) {
  const now = Date.now(), stamp = new Date(now).toISOString(), snapshot = wireSnapshot({ now });
  const rows = new Map(snapshot.stations.map(s => [s.seat_id, s]));
  for (const s of snapshot.stations) {
    const bound = ['desk-09', 'desk-10', 'desk-11', 'desk-14'].includes(s.seat_id);
    Object.assign(s, { bound, username: bound ? `模型验收 ${s.seat_id.slice(-2)}` : null, identity_quality: bound ? 'fresh' : 'unbound', identity_observed_at: bound ? stamp : null,
      activity: bound ? ['desk-09', 'desk-14'].includes(s.seat_id) ? 'busy' : 'idle' : 'unbound', quality: bound ? 'fresh' : 'unavailable', observed_at: bound ? stamp : null,
      concurrency: { current: bound ? ['desk-09', 'desk-14'].includes(s.seat_id) ? 3 : 0 : null, limit: bound ? 20 : null },
      today_usage: { total: '1234567890', date: new Date(now + 8 * 3600000).toISOString().slice(0, 10), timezone: 'Asia/Shanghai', quality: bound ? 'fresh' : 'unbound', observed_at: stamp, window_end: stamp },
      active_models: { models: [], quality: bound ? 'partial' : 'unbound', observed_at: bound ? stamp : null } });
  }
  const m = (requested_model, upstream_model = requested_model, requests = '1') => ({ requested_model, upstream_model, requests });
  rows.get('desk-09').active_models.models = phase === 'changed' ? [m('gpt-6-luna')] : [m('gpt-6.1-sol', undefined, '2'), m('friendly-model', 'actual-upstream')];
  delete rows.get('desk-11').active_models;
  rows.get('desk-14').active_models.models = [m('Qwen/' + 'very-long-model-'.repeat(10))];
  if (phase === 'stale') rows.get('desk-09').active_models.observed_at = new Date(now - 16_000).toISOString();
  if (phase === 'empty-busy') rows.get('desk-09').active_models.models = [];
  return snapshot;
}
try {
  for (const spec of [
    { name: 'desktop', width: 1920, height: 1080, dpr: 1 },
    { name: 'phone', width: 390, height: 844, dpr: 2, mobile: true },
  ]) {
    const context = await browser.newContext({ viewport: { width: spec.width, height: spec.height }, deviceScaleFactor: spec.dpr, isMobile: !!spec.mobile, hasTouch: !!spec.mobile });
    const page = await context.newPage();
    let phase = 'normal';
    const received = [];
    await page.addInitScript(() => window.addEventListener('office-runtime-ready', event => { window.__modelQA = event.detail; }));
    page.on('response', async response => {
      if (live && new URL(response.url()).pathname === '/api/office/snapshot' && response.ok()) {
        try { received.push(await response.json()); } catch {}
      }
    });
    page.on('pageerror', error => report.errors.push(error.message));
    page.on('response', response => { if (response.status() >= 400 && new URL(response.url()).pathname !== '/api/office/snapshot') report.unexpectedResponses.push([response.status(), response.url()]); });
    page.on('request', request => { if (!['GET', 'HEAD'].includes(request.method())) report.writes.push(request.method()); });
    if (!live) await page.route('**/api/office/snapshot', route => phase === 'failure'
      ? route.fulfill({ status: 503, contentType: 'application/json', body: '{}' })
      : route.fulfill({ contentType: 'application/json', body: JSON.stringify(fixture(phase)) }));
    await page.goto(live ? origin : origin + '/static/releases/office-v5-current-models-20261022-01/office/index.html', { waitUntil: 'domcontentloaded' });
    await page.getByTestId('map-fullscreen').waitFor();
    await page.waitForFunction(() => !document.querySelector('[data-testid="map-fullscreen"]').disabled && document.querySelectorAll('.hud-card').length === 4);
    const seat = live ? 'desk-14' : 'desk-09';
    await page.getByTestId(`seat-${seat}`).click();
    await page.getByTestId('employee-models').waitFor({ state: 'visible' });
    if (!live) assert.match(await page.getByTestId('employee-models').textContent(), /gpt-6\.1-sol/);
    if (spec.mobile && await page.getByTestId('details-toggle').getAttribute('aria-expanded') === 'true') await page.getByTestId('details-toggle').click();
    await page.getByTestId('map-fullscreen').click();
    await page.waitForFunction(() => !!document.fullscreenElement);
    const startingFrame = await page.evaluate(() => window.__modelQA.scene.sys.game.loop.frame);
    await page.waitForFunction(frame => {
      const runtime = window.__modelQA, viewport = document.querySelector('.map-viewport').getBoundingClientRect();
      const size = runtime?.renderQuality?.measurement?.cssSize;
      return runtime?.ready && runtime.scene.sys.game.loop.frame > frame + 5
        && size && Math.abs(size[0] - viewport.width) < 2 && Math.abs(size[1] - viewport.height) < 2;
    }, startingFrame);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(350);
    const target = page.locator('.hud-card[data-seat-id="desk-09"] [data-testid="hud-models"]');
    if (!live) {
      assert.equal(await target.textContent(), 'gpt-6.1-sol × 2\nfriendly-model → actual-upstream');
      assert.equal(await page.locator('.hud-card[data-seat-id="desk-10"] [data-testid="hud-models"]').textContent(), '暂无活跃模型');
      assert.equal(await page.locator('.hud-card[data-seat-id="desk-11"] [data-testid="hud-models"]').textContent(), '未知');
    }
    const ui = await page.evaluate(() => {
      const root = document.fullscreenElement;
      const cards = [...root.querySelectorAll('.hud-card')];
      return { cards: cards.map(c => ({ seat: c.dataset.seatId, model: c.querySelector('[data-testid="hud-models"]').textContent, quality: c.querySelector('[data-testid="hud-models"]').dataset.quality,
        modelOverflow: c.querySelector('[data-testid="hud-models"]').scrollWidth > c.querySelector('[data-testid="hud-models"]').clientWidth + 1 })),
        pageOverflow: document.documentElement.scrollWidth > innerWidth + 1, children: [...root.children].map(n => n.className), controls: root.querySelectorAll('button').length };
    });
    assert.equal(ui.cards.length, 4); assert.equal(ui.pageOverflow, false); assert.ok(ui.cards.every(c => !c.modelOverflow));
    assert.deepEqual(ui.children, ['map-viewport', 'fullscreen-hud']); assert.equal(ui.controls, 0);
    let liveEvidence = null;
    if (live) {
      assert.ok(received.length > 0, 'live API response was observed');
      const latest = received.at(-1);
      const expected = decodeSnapshot(latest).stations.filter(s => s.bound).map(s => ({ seat: s.stationId, model: activeModelsLabel(s), quality: s.activeModels.quality }));
      assert.deepEqual(ui.cards.map(({ seat, model, quality }) => ({ seat, model, quality })), expected);
      for (const station of latest.stations.filter(s => s.bound)) for (const model of station.active_models.models) {
        assert.equal(typeof model.requests, 'string'); assert.match(model.requests, /^[1-9]\d*$/);
      }
      liveEvidence = { source: latest.source, configVersion: latest.config_version, models: expected, exactAPIMatch: true };
    }
    const render = await page.evaluate(() => ({ ready: window.__modelQA.ready, frames: window.__modelQA.scene.sys.game.loop.frame, geometry: window.__modelQA.renderQuality.snapshot(), scene: window.__modelQA.snapshot().scene }));
    if (spec.mobile) await page.locator(`.hud-card[data-seat-id="${seat}"]`).scrollIntoViewIfNeeded();
    const screenshot = resolve(output, `${spec.name}-fullscreen.png`);
    await page.screenshot({ path: screenshot });
    if (!live) {
      await page.evaluate(() => { window.__modelCard = document.querySelector('.hud-card[data-seat-id="desk-09"]'); });
      phase = 'changed'; await page.waitForFunction(() => document.querySelector('.hud-card[data-seat-id="desk-09"] [data-testid="hud-models"]').textContent === 'gpt-6-luna');
      assert.ok(await page.evaluate(() => window.__modelCard === document.querySelector('.hud-card[data-seat-id="desk-09"]')));
      phase = 'stale'; await page.waitForFunction(() => document.querySelector('.hud-card[data-seat-id="desk-09"] [data-testid="hud-models"]').textContent === '已过期');
      phase = 'empty-busy'; await page.waitForFunction(() => document.querySelector('.hud-card[data-seat-id="desk-09"] [data-testid="hud-models"]').textContent === '暂未识别');
      phase = 'failure'; await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="hud-models"]')].every(n => n.textContent === '未知'));
      phase = 'normal'; await page.waitForFunction(() => document.querySelector('.hud-card[data-seat-id="desk-09"] [data-testid="hud-models"]').textContent.includes('gpt-6.1-sol'));
    }
    await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.fullscreenElement);
    report.devices.push({ name: spec.name, passed: true, screenshot, ui, render, liveEvidence, pollingAndFailureChecks: !live, fullscreenExit: true });
    await context.close();
  }
  assert.deepEqual(report.errors, []); assert.deepEqual(report.unexpectedResponses, []); assert.deepEqual(report.writes, []);
} finally {
  await browser.close();
  await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify({ passed: report.devices.length, report: resolve(output, 'report.json') }));
