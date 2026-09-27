import test from 'node:test';
import assert from 'node:assert/strict';

import { formatAxisValue, niceScale, niceStep, splitIntoRuns } from '../src/services/chartScale.js';

test('tick steps round up to 1, 2, 5 or 10 times a power of ten', () => {
  // This is what makes an axis read 10k / 20k / 30k rather than 10,237 / 20,473.
  assert.equal(niceStep(1), 1);
  assert.equal(niceStep(1.4), 2);
  assert.equal(niceStep(3), 5);
  assert.equal(niceStep(7), 10);
  assert.equal(niceStep(2300), 5000);
  assert.equal(niceStep(47), 50);
  // Nonsense must not produce a zero or NaN step, which would divide by zero.
  for (const bad of [0, -5, NaN, Infinity, undefined]) {
    assert.equal(niceStep(bad), 1, `${String(bad)} should fall back to 1`);
  }
});

test('an axis covers every value with readable ticks', () => {
  const values = [0, 12_400, 27_900, 31_000];
  const { min, max, ticks } = niceScale(values);
  assert.ok(min <= 0, 'the axis floor should sit at or below the lowest value');
  assert.ok(max >= 31_000, 'the axis ceiling should sit at or above the highest value');
  assert.ok(ticks.length >= 3 && ticks.length <= 8, `got ${ticks.length} ticks`);
  // Ascending, and ratios track the values.
  for (let index = 1; index < ticks.length; index += 1) {
    assert.ok(ticks[index].value > ticks[index - 1].value, 'ticks must ascend');
  }
  assert.equal(ticks[0].ratio, 0);
  assert.equal(ticks.at(-1).ratio, 1);
  for (const tick of ticks) {
    assert.ok(tick.value >= min && tick.value <= max, `${tick.value} outside the domain`);
  }
});

test('a flat series gets a readable axis instead of dividing by zero', () => {
  // Real case: a savings pot nobody has touched. min === max, so every
  // divide-by-range in the component is 0/0 unless the scale widens first.
  for (const flat of [[500, 500, 500], [0, 0, 0], [-20, -20]]) {
    const { min, max, ticks } = niceScale(flat);
    assert.ok(max > min, `flat series ${flat} produced a zero-height axis`);
    assert.ok(ticks.every((tick) => Number.isFinite(tick.value)), 'ticks must be finite');
    assert.ok(ticks.every((tick) => Number.isFinite(tick.ratio)), 'ratios must be finite');
  }
  // The line should sit inside the band, not on an edge.
  const { min, max } = niceScale([500, 500]);
  assert.ok(500 > min && 500 < max, 'the flat value should sit inside the axis');
});

test('a single value and an empty series are both handled', () => {
  const single = niceScale([42]);
  assert.ok(single.max > single.min);
  assert.ok(single.ticks.length >= 2);

  const empty = niceScale([]);
  assert.equal(empty.min, 0);
  assert.equal(empty.max, 1);
  assert.deepEqual(empty.ticks.map((tick) => tick.value), [0, 1]);

  // Non-numeric junk is discarded rather than becoming NaN.
  const junk = niceScale([1, 'abc', null, undefined, NaN, 3]);
  assert.ok(junk.ticks.every((tick) => Number.isFinite(tick.value)));
});

test('negative values keep zero on the axis', () => {
  // Net worth can legitimately be negative, and a zero line matters there.
  const { min, max, ticks } = niceScale([-5000, 2000]);
  assert.ok(min <= -5000, 'the floor must include the negative extreme');
  assert.ok(max >= 2000);
  assert.ok(ticks.some((tick) => tick.value === 0), 'zero should be a tick');
});

test('axis labels are compact and drop a pointless decimal', () => {
  assert.equal(formatAxisValue(12_400), '12.4k');
  assert.equal(formatAxisValue(200_000), '200k', 'a trailing .0 is noise on an axis');
  assert.equal(formatAxisValue(1_500_000), '1.5m');
  assert.equal(formatAxisValue(2_100_000_000), '2.1bn');
  assert.equal(formatAxisValue(0), '0');
  assert.equal(formatAxisValue(-12_400), '-12.4k', 'a negative value keeps its sign');
  assert.equal(formatAxisValue(999), '999');
  assert.equal(formatAxisValue(NaN), '', 'an unusable value must not print NaN');
  // Non-compact is available for tooltips that want the exact figure.
  assert.equal(formatAxisValue(12_400, { compact: false }), '12400');
});

test('a missing month breaks the line rather than dropping to zero', () => {
  // The monthly table fills unrecorded months with null. Joining across one
  // would assert a pension was worth nothing, which is a different statement.
  const points = [
    { month: '2024-01', value: 100 },
    { month: '2024-02', value: 110 },
    { month: '2024-03', value: null },
    { month: '2024-04', value: null },
    { month: '2024-05', value: 130 }
  ];
  const runs = splitIntoRuns(points);
  assert.equal(runs.length, 2, 'the gap should split the series in two');
  assert.deepEqual(runs[0].map((point) => point.month), ['2024-01', '2024-02']);
  assert.deepEqual(runs[1].map((point) => point.month), ['2024-05']);
  // No run may contain the gap, and no value may be coerced to 0.
  for (const run of runs) {
    for (const point of run) {
      assert.ok(Number.isFinite(point.value) && point.value > 0, 'a gap became a number');
    }
  }
});

test('a series with no gaps is one run, and leading and trailing gaps are handled', () => {
  assert.equal(splitIntoRuns([{ value: 1 }, { value: 2 }]).length, 1);
  const trailing = splitIntoRuns([{ value: 1 }, { value: null }]);
  assert.equal(trailing.length, 1, 'a trailing gap must not create an empty run');
  const leading = splitIntoRuns([{ value: null }, { value: 1 }]);
  assert.equal(leading.length, 1);
  assert.deepEqual(splitIntoRuns([]), []);
  assert.deepEqual(splitIntoRuns([{ value: null }]), [], 'all-gap input draws nothing');
});
