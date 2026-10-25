/** Focused regression checks for the editor patch; no runtime/player imports. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { drawScreenEffects, sampleScreenEffects } from './screen-overlay.mjs';

const front = { kind: 'front', polygon: [[20, 16], [172, 26], [158, 176], [24, 165]] };
const tickTime = frame => Math.ceil(frame * 1000 / 12);
// Deliberately non-uniform glyph widths catch hard-coded caret positions.
const textWidth = text => [...text].reduce((sum, c) => sum + (c === 'i' ? 2 : c === ' ' ? 3 : 5), 0);
function render(state, frame) {
  const calls = [];
  const ctx = { fillStyle: '', globalAlpha: 1,
    save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, clip() {}, rect() {},
    fillRect(...args) { calls.push({ kind: 'rect', color: this.fillStyle, args }); },
    fillText(...args) { calls.push({ kind: 'text', color: this.fillStyle, args }); },
    measureText(text) { return { width: textWidth(text) }; },
  };
  const effect = sampleScreenEffects(front, state, tickTime(frame));
  drawScreenEffects(ctx, effect);
  return { calls, effect };
}
const textCalls = r => r.calls.filter(c => c.kind === 'text');
const numbers = r => textCalls(r).filter(c => c.color === '#667b93' && /^\d+$/.test(c.args[0])).map(c => Number(c.args[0]));
const approx = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);

test('writing displays real source line numbers, colored tokens and indentation', () => {
  const r = render('writing', 47);
  assert.deepEqual(numbers(r), [1, 2, 3, 4, 5, 6, 7, 8]);
  const texts = textCalls(r);
  const declaration = texts.find(c => c.args[0] === 'async function ');
  const indented = texts.find(c => c.args[0] === 'const ');
  assert.equal(declaration.color, '#c792ea');
  assert.ok(indented.args[1] > declaration.args[1]);
  assert.ok(texts.some(c => c.args[0] === 'run' && c.color === '#82aaff'));
  assert.ok(texts.some(c => c.args[0] === '"ready"' && c.color === '#c3e88d'));
  // Each measured line number is right-aligned to the same gutter edge.
  for (const c of texts.filter(c => c.color === '#667b93' && /^\d+$/.test(c.args[0]))) {
    approx(c.args[1] + textWidth(c.args[0]), 20 + 152 * 0.108);
  }
});

test('writing actually adds typed characters and blinks the caret', () => {
  const early = render('writing', 0), later = render('writing', 7);
  const lastRow = r => {
    const y = 16 + 160 * (0.195 + r.effect.activeCodeLine * 0.081);
    return textCalls(r).filter(c => c.args[2] === y && c.color !== '#667b93')
      .map(c => c.args[0]).join('');
  };
  assert.ok(lastRow(later).startsWith(lastRow(early)));
  assert.ok(lastRow(later).length > lastRow(early).length);
  assert.equal(early.calls.filter(c => c.kind === 'rect' && c.color === '#e0e9f5').length, 1);
  assert.equal(render('writing', 4).calls.filter(c => c.kind === 'rect' && c.color === '#e0e9f5').length, 0);
});

test('research and execution scroll contiguous source windows with matching line numbers', () => {
  for (const state of ['researching', 'executing']) {
    const count = state === 'researching' ? 6 : 4;
    for (let frame = 0; frame < 48; frame++) {
      const r = render(state, frame);
      const first = Math.min(r.effect.codeOffset, 8 - count) + 1;
      assert.deepEqual(numbers(r), Array.from({ length: count }, (_, i) => first + i));
    }
  }
});

test('search caret follows the measured query and blink state, not estimated character widths', () => {
  for (const frame of [0, 1, 8, 9, 16, 17]) {
    const r = render('researching', frame);
    const query = textCalls(r).find(c => c.args[0].startsWith('> '));
    const caret = r.calls.find(c => c.kind === 'rect' && c.color === '#d5e3f5');
    assert.ok(query && caret);
    approx(caret.args[0], query.args[1] + textWidth(query.args[0]) + r.effect.bounds[2] * 0.006);
  }
  assert.equal(render('researching', 4).calls.filter(c => c.color === '#d5e3f5').length, 0);
});

test('executing retains code above the separate progressively changing terminal', () => {
  const early = render('executing', 0), later = render('executing', 15);
  assert.ok(textCalls(later).some(c => c.color === '#c792ea'));
  assert.ok(textCalls(later).some(c => c.args[0] === 'PASS parser.test.ts' && c.color === '#c3e88d'));
  assert.notDeepEqual(textCalls(early).map(c => c.args[0]), textCalls(later).map(c => c.args[0]));
  assert.ok(later.calls.some(c => c.kind === 'rect' && c.color === '#091118'));
});
