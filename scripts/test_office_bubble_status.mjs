import assert from 'node:assert/strict';
import test from 'node:test';
import {speechBubbleStatus} from '../frontend/office/bubble-status.mjs';

const telemetry = (current, overrides = {}) => ({
  source: 'telemetry', bound: true, quality: 'fresh', current, state: 'idle',
  ...overrides,
});
const states = ['idle', 'writing', 'researching', 'executing', 'syncing', 'error'];
const levels = [
  ['0', '休息中'],
  ['1', '工作中'], ['2', '工作中'],
  ['3', '忙碌中'], ['4', '忙碌中'],
  ['5', '玩命干活中'], ['6', '玩命干活中'],
  ['7', '玩命干活中'], ['8', '玩命干活中'],
  ['9', '狂暴模式'], ['10', '狂暴模式'],
  ['9007199254740993', '狂暴模式'],
  ['99999999999999999999999999999999999999999999999999', '狂暴模式'],
];

for (const [current, expected] of levels) {
  test(`fresh concurrency ${current} maps strictly to ${expected}`, () => {
    for (const state of states) {
      assert.equal(speechBubbleStatus(telemetry(current, {state})), expected);
    }
  });
}

test('decimal strings retain numeric meaning with leading zeroes, even at huge lengths', () => {
  for (const [current, expected] of levels) {
    assert.equal(speechBubbleStatus(telemetry(`000${current}`)), expected);
    assert.equal(speechBubbleStatus(telemetry(`${'0'.repeat(400)}${current}`)), expected);
  }
  assert.equal(speechBubbleStatus(telemetry('0'.repeat(400))), '休息中');
  assert.equal(speechBubbleStatus(telemetry('9'.repeat(400))), '狂暴模式');
});

test('null or absent concurrency never masquerades as resting', () => {
  assert.equal(speechBubbleStatus(telemetry(null)), '状态未知');
  assert.equal(speechBubbleStatus(telemetry(undefined)), '状态未知');
  const station = telemetry('0');
  delete station.current;
  assert.equal(speechBubbleStatus(station), '状态未知');
});

for (const [quality, expected] of [
  ['untracked', '未跟踪'], ['stale', '已过期'], ['unavailable', '状态未知'],
]) {
  test(`${quality} cannot imply a fresh concurrency level`, () => {
    for (const current of [null, '0', '1', '9', '99999999999999999999', '-1']) {
      assert.equal(speechBubbleStatus(telemetry(current, {quality})), expected);
    }
  });
}

test('unbound sources and explicitly unbound telemetry stay unbound', () => {
  for (const current of [null, '0', '9']) {
    assert.equal(speechBubbleStatus({source: 'unbound', current}), '未绑定');
    for (const quality of ['fresh', 'untracked', 'stale', 'unavailable']) {
      assert.equal(speechBubbleStatus(telemetry(current, {bound: false, quality})), '未绑定');
    }
  }
});

test('fresh concurrency remains usable when username or identity quality is unavailable', () => {
  for (const identity_quality of [undefined, null, 'unavailable', 'stale', 'untracked']) {
    for (const [current, expected] of levels) {
      assert.equal(speechBubbleStatus(telemetry(current, {
        username: null, identity_quality,
      })), expected);
    }
  }
  const station = telemetry('3');
  for (const field of ['username', 'display_name', 'id', 'user_id', 'identity_quality']) {
    Object.defineProperty(station, field, {get() { throw new Error(`Must not read ${field}`); }});
  }
  Object.defineProperty(station, 'state', {get() { throw new Error('Must not read real state'); }});
  assert.equal(speechBubbleStatus(station), '忙碌中');
});

test('malformed counts are unknown without numeric coercion', () => {
  for (const current of [
    '-1', '-0', '1.5', '0.0', '+1', '1e3', '0x10', 'NaN', 'Infinity',
    '', ' ', ' 1', '1 ', '1\n', '1\r\n', '1\t', '1\u0000', '１２', '١',
    0, 1, 1.5, -1, NaN, Infinity, 1n, true, false, [], ['0'], {},
    {toString() { throw new Error('Must not coerce objects'); }},
  ]) {
    assert.equal(speechBubbleStatus(telemetry(current)), '状态未知');
  }
});

test('malformed stations, sources, binding flags and quality are conservative', () => {
  for (const station of [undefined, null, false, 0, 'telemetry', [], {}, () => {}]) {
    assert.equal(speechBubbleStatus(station), '状态未知');
  }
  for (const source of [undefined, null, '', 'unknown', 'Telemetry', 1, {}]) {
    assert.equal(speechBubbleStatus(telemetry('0', {source})), '状态未知');
  }
  for (const bound of [undefined, null, 0, 1, 'true', 'false', {}]) {
    assert.equal(speechBubbleStatus(telemetry('0', {bound})), '状态未知');
  }
  for (const quality of [undefined, null, '', 'unknown', 'Fresh', true, {}]) {
    assert.equal(speechBubbleStatus(telemetry('0', {quality})), '状态未知');
  }
});

const demoStatuses = [
  ['idle', '演示·待机'], ['writing', '演示·写作'], ['researching', '演示·研究'],
  ['executing', '演示·执行'], ['syncing', '演示·同步'], ['error', '演示·异常'],
];
for (const [state, expected] of demoStatuses) {
  test(`demo ${state} remains explicitly illustrative`, () => {
    for (const current of [null, '0', '9', '-1']) {
      for (const bound of [true, false]) {
        assert.equal(speechBubbleStatus(telemetry(current, {
          source: 'demo', state, bound, quality: 'unavailable',
        })), expected);
      }
    }
  });
}

test('unknown demo states retain the demo marker, including inherited property names', () => {
  for (const state of [undefined, null, '', 'unknown', 'constructor', 'toString', '__proto__', {}, ['idle']]) {
    assert.equal(speechBubbleStatus({source: 'demo', state}), '演示·状态未知');
  }
});

test('outputs are single short strings without names, IDs, digits or line breaks', () => {
  const stations = [
    ...levels.map(([current]) => telemetry(current)),
    ...demoStatuses.map(([state]) => ({source: 'demo', state})),
    ...['untracked', 'stale', 'unavailable'].map(quality => telemetry(null, {quality})),
    {source: 'unbound'}, {}, {source: 'demo'},
  ];
  for (const station of stations) {
    const status = speechBubbleStatus({...station,
      username: '不应出现的用户名', display_name: '不应出现的姓名', id: 'desk-123', user_id: '456',
    });
    assert.equal(typeof status, 'string');
    assert.ok(status.length > 0 && status.length <= 8);
    assert.doesNotMatch(status, /[0-9\r\n]|不应出现|desk/u);
  }
});

test('the function is deterministic and leaves frozen input unchanged', () => {
  for (const station of [
    telemetry('0003', {identity_quality: 'unavailable'}),
    telemetry('0', {quality: 'stale'}),
    {source: 'unbound'}, {source: 'demo', state: 'writing'},
  ]) {
    const before = structuredClone(station);
    Object.freeze(station);
    const first = speechBubbleStatus(station);
    assert.equal(speechBubbleStatus(station), first);
    assert.deepEqual(station, before);
  }
});
