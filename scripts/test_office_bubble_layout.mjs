#!/usr/bin/env node
/** Pure geometry/text regressions against the production adapter exports; no browser or service. */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  layoutSpeechBubbles,
  wrapSpeechBubbleText,
  speechBubbleLines,
  sampleSpeechBubbleMotion,
  SPEECH_BUBBLE_STYLE,
} from '../frontend/company-office/connected-v4/telemetry-adapter.mjs';

const overlap = (a, b) => a[0] < b[0] + b[2] && a[0] + a[2] > b[0]
  && a[1] < b[1] + b[3] && a[1] + a[3] > b[1];
const inside = (rect, viewport) => rect[0] >= viewport[0] && rect[1] >= viewport[1]
  && rect[0] + rect[2] <= viewport[0] + viewport[2]
  && rect[1] + rect[3] <= viewport[1] + viewport[3];
const inflate = (rect, amount) => [rect[0] - amount, rect[1] - amount,
  rect[2] + amount * 2, rect[3] + amount * 2];
const leaderLength = points => points.slice(1).reduce((length, point, index) => length
  + Math.hypot(point[0] - points[index][0], point[1] - points[index][1]), 0);
const scaleRect = (rect, unit) => rect.map(value => value * unit);
const scaleItem = (item, unit) => ({...item, head: item.head.map(value => value * unit),
  width: item.width * unit, height: item.height * unit});

function assertClear(items, viewport, obstacles, placements, unit = 1) {
  const visible = items.filter(item => placements.get(item.id).visible);
  for (const item of visible) {
    const placement = placements.get(item.id);
    assert.ok(inside(placement.reserved, viewport), `${item.id}: motion/pointer reserve within viewport`);
    assert.ok(inside(placement.rect, placement.reserved), `${item.id}: body within reserve`);
    assert.equal(placement.rect[0] + placement.rect[2] / 2, item.head[0], `${item.id}: stays at its workstation`);
    const others = visible.filter(other => other !== item).map(other => placements.get(other.id).reserved);
    for (const blocked of [...obstacles.map(rect => inflate(rect, unit)), ...others]) {
      assert.equal(overlap(placement.reserved, blocked), false, `${item.id}: reserve overlaps screen/head/another bubble`);
    }
    assert.ok(placement.leader.length >= 2 && placement.leader.length <= 3);
    assert.deepEqual(placement.leader[0], placement.tip);
    assert.equal(placement.leader.at(-1)[0], item.head[0]);
    assert.ok(leaderLength(placement.leader) <= 84 * unit, `${item.id}: no distant pointer routing`);
    for (let index = 1; index < placement.leader.length; index++) {
      const start = placement.leader[index - 1], end = placement.leader[index];
      const box = [Math.min(start[0], end[0]) - unit, Math.min(start[1], end[1]) - unit,
        Math.abs(start[0] - end[0]) + 2 * unit, Math.abs(start[1] - end[1]) + 2 * unit];
      if (index === 1) {
        const motion = SPEECH_BUBBLE_STYLE.motionReservePixels * unit;
        box[1] = Math.min(start[1] - motion, end[1]) - unit;
        box[3] = Math.max(start[1] + motion, end[1]) + unit - box[1];
      }
      for (const blocked of [...obstacles.map(rect => inflate(rect, unit)), ...others, inflate(placement.rect, unit)]) {
        assert.equal(overlap(box, blocked), false, `${item.id}: swept leader crosses screen/head/bubble`);
      }
    }
    for (let time = 0; time <= 4000; time += 20) {
      const motion = sampleSpeechBubbleMotion({motionEpoch: 0, feedbackAt: 0, phase: 0.73}, time);
      const moved = [...placement.rect]; moved[1] += motion.offsetCss * unit;
      assert.ok(inside(moved, placement.reserved), `${item.id}: animated body escapes reserve`);
      for (const obstacle of [...obstacles, ...others]) {
        assert.equal(overlap(moved, obstacle), false, `${item.id}: animated body overlaps an obstacle`);
      }
    }
  }
}

const measure = value => Array.from(value).reduce((width, glyph) => width
  + (/[A-Za-z0-9 ]/u.test(glyph) ? 5 : 10), 0);

for (const [name, value, width] of [
  ['Chinese long status', '玩命干活中状态未知未跟踪', 30],
  ['demo marker', '演示·狂暴模式', 30],
  ['mixed glyphs and spaces', '工作中 office A 123 同步中', 35],
  ['astral Unicode', '演示🧑‍💻😀研究𠮷中', 30],
]) {
  test(`wrap: ${name} preserves every code point without ellipsis`, () => {
    const measured = [];
    const lines = wrapSpeechBubbleText(value, candidate => {measured.push(candidate); return measure(candidate);}, width);
    assert.ok(lines.length > 1);
    assert.equal(lines.join(''), value);
    assert.deepEqual(Array.from(lines.join('')), Array.from(value));
    assert.doesNotMatch(lines.join(''), /…|\.\.\./u);
    for (const line of lines) assert.ok(measure(line) <= width);
    assert.ok(measured.length > 0, 'wrapping must consult the provided measure callback');
  });
}

test('wrap: exact-fit, proportional measurement and zero-width glyphs are not character-count truncation', () => {
  assert.deepEqual(wrapSpeechBubbleText('工作中', measure, 30), ['工作中']);
  assert.deepEqual(wrapSpeechBubbleText('工作中', measure, 29), ['工作', '中']);
  assert.deepEqual(wrapSpeechBubbleText('A工B作', measure, 15), ['A工', 'B作']);
  assert.deepEqual(wrapSpeechBubbleText('ABCD', () => 0, 1), ['ABCD']);
});

test('wrap: empty paragraphs and explicit line breaks remain intact', () => {
  for (const value of ['', '\n', '工作中\n\n演示·研究\n']) {
    const lines = wrapSpeechBubbleText(value, measure, 1000);
    assert.equal(lines.join('\n'), value);
    assert.deepEqual(lines, value.split('\n'));
  }
  const value = '玩命干活中\n\n演示·研究\n';
  const lines = wrapSpeechBubbleText(value, measure, 20);
  assert.equal(lines.filter(line => line === '').length, 2);
  assert.equal(lines.join(''), value.replaceAll('\n', ''));
});

test('wrap: a single oversized glyph is preserved even when no legal narrower line exists', () => {
  for (const width of [0, 1, 5]) {
    const lines = wrapSpeechBubbleText('工😀作', measure, width);
    assert.deepEqual(lines, ['工', '😀', '作']);
    assert.equal(lines.join(''), '工😀作');
  }
});

for (const direction of ['up', 'down', 'left', 'right']) {
  test(`layout: ${direction} prefers ${direction === 'up' ? 'below' : 'above'} with a short, clear leader`, () => {
    const item = {id: direction, head: [320, 220], width: 70, height: 22, direction};
    const viewport = [0, 0, 640, 480], head = [306, 216, 28, 28];
    const placements = layoutSpeechBubbles([item], viewport, [head]);
    const placement = placements.get(direction);
    assert.equal(placement.visible, true);
    assert.equal(placement.side, direction === 'up' ? 'below' : 'above');
    assert.ok(leaderLength(placement.leader) <= 12);
    if (direction === 'up') assert.ok(placement.rect[1] > head[1] + head[3]);
    else assert.ok(placement.rect[1] + placement.rect[3] < head[1]);
    assertClear([item], viewport, [head], placements);
  });
}

test('layout: omitted direction retains the above-first contract', () => {
  const item = {id: 'legacy', head: [320, 220], width: 70, height: 22};
  const placements = layoutSpeechBubbles([item], [0, 0, 640, 480]);
  assert.equal(placements.get(item.id).visible, true);
  assert.equal(placements.get(item.id).side, 'above');
});

test('layout: up remains visible below even when its head/above space is covered by a screen', () => {
  const item = {id: 'rear', head: [320, 220], width: 70, height: 22, direction: 'up'};
  const viewport = [0, 0, 640, 480], screen = [282, 156, 76, 66], head = [306, 216, 28, 28];
  assert.ok(inside([item.head[0], item.head[1], 0, 0], screen), 'fixture screen covers head anchor');
  const placements = layoutSpeechBubbles([item], viewport, [screen, head]);
  const placement = placements.get(item.id);
  assert.equal(placement.visible, true);assert.equal(placement.side, 'below');
  assert.ok(placement.rect[1] > Math.max(screen[1] + screen[3], head[1] + head[3]));
  assert.ok(leaderLength(placement.leader) <= 12, 'local pointer must not cross the screen to reach the covered head');
  assertClear([item], viewport, [screen, head], placements);
});

test('layout: blocked preferred side falls back locally in both directions', () => {
  const viewport = [0, 0, 640, 480], head = [306, 216, 28, 28];
  for (const [direction, block, side] of [
    ['up', [100, 250, 440, 225], 'above'],
    ['down', [100, 5, 440, 207], 'below'],
  ]) {
    const item = {id: direction, head: [320, 220], width: 70, height: 22, direction};
    const placements = layoutSpeechBubbles([item], viewport, [head, block]);
    assert.equal(placements.get(item.id).visible, true);
    assert.equal(placements.get(item.id).side, side);
    assert.ok(leaderLength(placements.get(item.id).leader) <= 12);
    assertClear([item], viewport, [head, block], placements);
  }
});

const mixedItems = ['up', 'down', 'left', 'right'].map((direction, index) => ({
  id: `desk-${index}`, direction, head: [140 + index * 130, 220], width: 76, height: 24,
}));
const mixedHeads = mixedItems.map(({head}) => [head[0] - 14, head[1] - 4, 28, 28]);
const mixedScreens = mixedItems.map(({head}, index) => [head[0] - 36,
  index === 0 ? 156 : 268, 72, 38]);

for (const unit of [0.25, 0.5450208486632327, 1, 2, 4]) {
  test(`layout: unit ${unit} preserves above/below geometry, clearance and local pointers`, () => {
    const items = mixedItems.map(item => scaleItem(item, unit));
    const obstacles = [...mixedHeads, ...mixedScreens].map(rect => scaleRect(rect, unit));
    const viewport = scaleRect([0, 0, 700, 480], unit);
    const placements = layoutSpeechBubbles(items, viewport, obstacles, unit);
    for (const item of items) {
      assert.equal(placements.get(item.id).visible, true, item.id);
      assert.equal(placements.get(item.id).side, item.direction === 'up' ? 'below' : 'above');
      assert.ok(leaderLength(placements.get(item.id).leader) <= 12 * unit);
    }
    assertClear(items, viewport, obstacles, placements, unit);
  });
}

test('layout: bubble size changes preserve every text glyph and clearance, including wrapped demo text', () => {
  const viewport = [0, 0, 700, 480], obstacles = [...mixedHeads, ...mixedScreens];
  for (const maxWidth of [20, 30, 50, 80]) {
    const lines = wrapSpeechBubbleText('演示·玩命干活中', measure, maxWidth);
    assert.equal(lines.join(''), '演示·玩命干活中');assert.doesNotMatch(lines.join(''), /…/u);
    const items = mixedItems.map(item => ({...item,
      width: Math.max(...lines.map(measure)) + 10, height: lines.length * 10 + 6}));
    const placements = layoutSpeechBubbles(items, viewport, obstacles);
    for (const item of items) assert.equal(placements.get(item.id).visible, true);
    assertClear(items, viewport, obstacles, placements);
  }
});

test('layout: viewport-packed dimensions are hidden without drawing or distant relocation', () => {
  for (const [viewport, width, height] of [
    [[0, 0, 100, 60], 150, 50], [[0, 0, 100, 60], 60, 55], [[0, 0, 7, 7], 1, 1],
  ]) {
    for (const direction of ['up', 'down']) {
      const item = {id: 'packed', head: [50, 30], width, height, direction};
      const placement = layoutSpeechBubbles([item], viewport).get(item.id);
      assert.equal(placement.visible, false);assert.equal(placement.reason, 'viewport_packed');
      assert.equal(placement.rect, undefined);assert.equal(placement.leader, undefined);
    }
  }
});

test('layout: local obstacles and far-clipped anchors hide conservatively', () => {
  const viewport = [0, 0, 640, 480];
  const item = {id: 'blocked', head: [320, 220], width: 70, height: 22, direction: 'up'};
  const blocked = layoutSpeechBubbles([item], viewport, [[5, 5, 630, 470]]).get(item.id);
  assert.equal(blocked.visible, false);assert.equal(blocked.reason, 'local_anchor_packed');
  assert.equal(blocked.rect, undefined);assert.equal(blocked.leader, undefined);
  const clipped = layoutSpeechBubbles([{...item, head: [-100, 220]}], viewport).get(item.id);
  assert.equal(clipped.visible, false);assert.equal(clipped.reason, 'anchor_clipped');
});

test('layout: overcrowded co-located seats hide extras rather than overlapping or using distant rails', () => {
  const viewport = [0, 0, 640, 480];
  const items = Array.from({length: 12}, (_, index) => ({id: `packed-${index}`, head: [320, 220],
    width: 76, height: 24, direction: index % 2 ? 'down' : 'up'}));
  const placements = layoutSpeechBubbles(items, viewport);
  const visible = items.filter(item => placements.get(item.id).visible);
  assert.ok(visible.length > 0 && visible.length < items.length);
  for (const item of items.filter(item => !placements.get(item.id).visible)) {
    assert.equal(placements.get(item.id).reason, 'local_anchor_packed');
  }
  assertClear(items, viewport, [], placements);
});

test('layout: permutation is deterministic and frozen caller geometry remains unchanged', () => {
  const items = structuredClone(mixedItems), obstacles = structuredClone([...mixedHeads, ...mixedScreens]);
  const viewport = [0, 0, 700, 480], before = structuredClone({items, obstacles, viewport});
  for (const item of items) {Object.freeze(item.head);Object.freeze(item);}
  for (const rect of obstacles) Object.freeze(rect);
  Object.freeze(items);Object.freeze(obstacles);Object.freeze(viewport);
  const first = layoutSpeechBubbles(items, viewport, obstacles);
  assert.deepEqual(layoutSpeechBubbles([...items].reverse(), viewport, obstacles), first);
  assert.deepEqual({items, obstacles, viewport}, before);
});

test('speech lines: demo six states keep their marker through measured wrapping and ignore real counts', () => {
  for (const [state, expected] of [
    ['idle', '演示·待机'], ['writing', '演示·写作'], ['researching', '演示·研究'],
    ['executing', '演示·执行'], ['syncing', '演示·同步'], ['error', '演示·异常'],
  ]) {
    const lines = speechBubbleLines({source: 'demo', bound: true, quality: 'fresh',
      current: '999999999999999999999999', state, username: '不要出现的用户名'});
    assert.deepEqual(lines, [expected]);
    const wrapped = lines.flatMap(value => wrapSpeechBubbleText(value, measure, 20));
    assert.ok(wrapped.length > 1);assert.equal(wrapped.join(''), expected);
    assert.doesNotMatch(wrapped.join(''), /[0-9…]|用户名/u);
  }
});

test('motion: independent clocks remain seek-safe and layout cannot reset epochs or feedback', () => {
  const first = Object.freeze({motionEpoch: 1000, feedbackAt: 1500, phase: 0.73});
  const second = Object.freeze({motionEpoch: 1200, feedbackAt: null, phase: 1.46});
  const before = [sampleSpeechBubbleMotion(first, 1600), sampleSpeechBubbleMotion(second, 1600)];
  assert.ok(before[0].feedback > 0);assert.equal(before[1].feedback, 0);
  assert.notEqual(before[0].offsetCss, before[1].offsetCss);
  layoutSpeechBubbles(mixedItems, [0, 0, 700, 480], [...mixedHeads, ...mixedScreens]);
  sampleSpeechBubbleMotion(first, 9000);
  assert.deepEqual([sampleSpeechBubbleMotion(first, 1600), sampleSpeechBubbleMotion(second, 1600)], before);
  assert.equal(sampleSpeechBubbleMotion(first, 1700).feedback, 0);
  assert.deepEqual(sampleSpeechBubbleMotion(first, 1600, true), {offsetCss: 0, feedback: 0});
  assert.deepEqual(first, {motionEpoch: 1000, feedbackAt: 1500, phase: 0.73});
  assert.deepEqual(second, {motionEpoch: 1200, feedbackAt: null, phase: 1.46});
});
