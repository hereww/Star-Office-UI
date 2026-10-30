import assert from 'node:assert/strict';
import test from 'node:test';
import { safeActiveModels, activeModelsLabel, activeModelsDescription } from '../frontend/office/active-models.mjs';
import { decodeSnapshot, toRuntimeSnapshot } from '../frontend/office/codec.mjs';
import { publicSnapshot, failedSnapshot } from '../frontend/office/model.mjs';
import { wireSnapshot } from './fixtures/office_wire.mjs';

const now = Date.parse('2026-10-22T00:00:00Z');
const stamp = new Date(now).toISOString();
const row = (requested_model = 'gpt-6.1-sol', upstream_model = requested_model, requests = '1') => ({ requested_model, upstream_model, requests });
const models = (entries = [row()], quality = 'partial', observed_at = stamp) => ({ models: entries, quality, observed_at });
const options = { now, bound: true, sourceOK: true, sourceStatus: 'ok' };
const station = (value = models(), concurrency = '1') => ({ bound: true, quality: 'fresh', concurrency, activeModels: safeActiveModels(value, options) });

test('multiple live models, mappings and model request counts remain distinct', () => {
  const s = station(models([row('gpt-6.1-sol', 'gpt-6.1-sol', '2'), row('friendly', 'actual'), row('pending', null)]));
  assert.equal(activeModelsLabel(s), 'gpt-6.1-sol × 2\nfriendly → actual\npending');
  assert.match(activeModelsDescription(s), /覆盖部分请求链路/);
});

test('only confirmed zero concurrency with an observed empty list implies no active model', () => {
  assert.equal(activeModelsLabel(station(models([]), '0')), '暂无活跃模型');
  assert.equal(activeModelsLabel(station(models([]), '3')), '暂未识别');
  assert.equal(activeModelsLabel(station(models([]), null)), '暂未识别');
  assert.equal(activeModelsLabel({ bound: true, concurrency: '0' }), '未知');
});

test('missing, unknown, stale, source failure and unbound states clear all models', () => {
  for (const sourceStatus of ['error', 'connecting', 'stale']) {
    const value = safeActiveModels(models(), { ...options, sourceOK: false, sourceStatus });
    assert.deepEqual(value.models, []);
    assert.equal(value.quality, sourceStatus === 'stale' ? 'stale' : 'unavailable');
  }
  assert.equal(safeActiveModels(models(), { ...options, bound: false }).quality, 'unbound');
  assert.equal(activeModelsLabel({ bound: false }), '未绑定');
  assert.equal(activeModelsLabel(station(models([], 'stale'))), '已过期');
  assert.equal(safeActiveModels(null, options).quality, 'unavailable');
});

test('model observation expires independently and cannot be renewed by re-projection', () => {
  const original = safeActiveModels(models(), options);
  assert.equal(safeActiveModels(original, { ...options, now: now + 14_999 }).quality, 'partial');
  const expired = safeActiveModels(original, { ...options, now: now + 15_000 });
  assert.equal(expired.quality, 'stale');
  assert.deepEqual(expired.models, []);
  assert.equal(safeActiveModels(models([], 'partial', new Date(now + 1).toISOString()), options).quality, 'stale');
});

test('malformed optional model data cannot introduce objects, control characters or unsafe counts', () => {
  const invalid = [models({}, 'partial'), models([null]), models([row('', null)]), models([row('a'.repeat(201))]), models([row('bad\nname')]), models([row('bad\u202ename')]), models([row(' padded')]), models([row('ok', {})])];
  for (const count of [0, -1, false, null, {}, '0', '1e3', '1.5', '9223372036854775808', Number.MAX_SAFE_INTEGER + 1]) invalid.push(models([row('ok', null, count)]));
  for (const value of invalid) assert.equal(safeActiveModels(value, options).quality, 'unavailable');
  const injected = models([{ ...row(), api_key: 'PRIVATE_SENTINEL', prompt: 'PRIVATE_SENTINEL' }]);
  injected.secret = 'PRIVATE_SENTINEL';
  assert.ok(!JSON.stringify(safeActiveModels(injected, options)).includes('PRIVATE_SENTINEL'));
  assert.equal(safeActiveModels(models([row('model', null, '9223372036854775807')]), options).models[0].requests, '9223372036854775807');
});

test('wire decoder, employee polling and failure path carry only safe models', () => {
  const wire = wireSnapshot({ now });
  const bound = wire.stations.find(s => s.bound);
  bound.active_models = models([row('gpt-6.1-sol', null, '2')]);
  const initial = decodeSnapshot(wire, { now });
  const s = initial.stations.find(s => s.bound);
  assert.equal(s.activeModels.models[0].requested_model, 'gpt-6.1-sol');
  assert.deepEqual(publicSnapshot(initial, { now }).stations.find(s => s.bound).activeModels, s.activeModels);
  const failure = failedSnapshot(initial, now);
  assert.ok(failure.stations.every(s => s.activeModels.models.length === 0));
  assert.ok(!JSON.stringify(toRuntimeSnapshot(initial, { now })).includes('active_models'));
});
