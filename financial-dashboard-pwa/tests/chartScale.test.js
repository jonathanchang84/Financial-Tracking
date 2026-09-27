import test from 'node:test';
import assert from 'node:assert/strict';

import {
  bucketKey,
  bucketLabel,
  bucketRange,
  formatAxisValue,
  labelStride,
  maxStackTotal,
  niceScale,
  niceStep,
  stackSegments
} from '../src/services/chartScale.js';
import { buildMonthlyHistoryTable } from '../src/services/monthlyHistory.js';

/**
 * A closing-value map, as the shared pivot hands the chart one per series.
 * Built from real snapshots rather than by hand, so the tests exercise the same
 * path the app does instead of a stand-in.
 */
function closingValues(rows, granularity = 'year') {
  const table = buildMonthlyHistoryTable({ rows, granularity });
  return new Map(
    (table.columns || []).map((column) => [
      column.key,
      new Map(
        table.rows.map((row) => [
          row.bucket,
          { value: row.cells?.[column.key]?.value ?? null, date: row.cells?.[column.key]?.date ?? null }
        ])
      )
    ])
  );
}

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




test('missing and unusable values never become a figure or a zero', () => {
  // The pivot has to drop these rather than coerce them: a null read as 0 would
  // put a zero-height segment in the stack, and an undated row would create a
  // bucket that looks real.
  const table = buildMonthlyHistoryTable({
    rows: [
      { series: 'a', date: '2024-01-01', value: null, currencyCode: 'USD' },
      { series: 'a', date: '2024-02-01', value: undefined, currencyCode: 'USD' },
      { series: 'a', date: '2024-03-01', value: 'nonsense', currencyCode: 'USD' },
      { series: 'a', date: 'not-a-date', value: 99_000, currencyCode: 'USD' },
      { series: 'a', date: '2024-04-01', value: 1200, currencyCode: 'USD' }
    ],
    granularity: 'year'
  });
  assert.equal(table.rows.length, 1, 'only the one usable bucket survives');
  assert.equal(table.rows[0].bucket, '2024');
  assert.equal(table.rows[0].cells['a::USD'].value, 1200, 'not coerced to 0');
  assert.equal(table.rows[0].cells['a::USD'].date, '2024-04-01');

  // No usable rows at all yields an empty pivot rather than throwing.
  const empty = buildMonthlyHistoryTable({
    rows: [{ series: 'a', date: 'nonsense', value: 1, currencyCode: 'USD' }],
    granularity: 'year'
  });
  assert.deepEqual(empty.buckets, []);
  assert.deepEqual(empty.columns, []);
  assert.deepEqual(empty.rows, []);
});

test('bucket keys and labels work at both granularities', () => {
  assert.equal(bucketKey('2024-06-15', 'year'), '2024');
  assert.equal(bucketKey('2024-06-15', 'month'), '2024-06');
  assert.equal(bucketKey('2024-06-15', undefined), '2024', 'year is the default');
  for (const bad of ['', null, 'nonsense', '2024-13-99', '2024-02-31', '2024-00-10']) {
    assert.equal(bucketKey(bad, 'year'), '', `${String(bad)} should not produce a bucket`);
  }
  // A real leap day is still accepted, so the strictness is not overreach.
  assert.equal(bucketKey('2024-02-29', 'year'), '2024');
  assert.equal(bucketKey('2023-02-29', 'year'), '', '2023 was not a leap year');
  assert.equal(bucketLabel('2024', 'year'), '2024');
  assert.match(bucketLabel('2024-06', 'month'), /24$/, 'a month label carries the year');
  assert.equal(bucketLabel('junk', 'year'), 'junk');
  assert.doesNotMatch(String(bucketLabel('junk', 'month')), /Invalid/);
});

test('the bucket range fills the gap so spacing stays even', () => {
  assert.deepEqual(bucketRange(['2022', '2024'], 'year'), ['2022', '2023', '2024']);
  assert.deepEqual(bucketRange(['2024-01', '2024-04'], 'month'), ['2024-01', '2024-02', '2024-03', '2024-04']);
  // Year wrap-around is the case a naive month loop gets wrong.
  assert.deepEqual(bucketRange(['2023-11', '2024-02'], 'month'), ['2023-11', '2023-12', '2024-01', '2024-02']);
  assert.deepEqual(bucketRange(['2024'], 'year'), ['2024']);
  assert.deepEqual(bucketRange([], 'year'), []);
  assert.deepEqual(bucketRange(['2024', '2022', '2024'], 'year'), ['2022', '2023', '2024'], 'unsorted input');
});

test('segments stack upward and a missing series is skipped, not zeroed', () => {
  // "c" has only a 2023 snapshot, so it must contribute no 2024 segment rather
  // than a zero-height one that would read as "it was worth nothing".
  const bySeries = closingValues([
    { series: 'a', date: '2024-01-01', value: 300, currencyCode: 'USD' },
    { series: 'b', date: '2024-02-01', value: 200, currencyCode: 'USD' },
    { series: 'c', date: '2023-01-01', value: 999, currencyCode: 'USD' }
  ]);
  const series = [
    { key: 'a::USD', color: '#1', values: bySeries.get('a::USD') },
    { key: 'b::USD', color: '#2', values: bySeries.get('b::USD') },
    { key: 'c::USD', color: '#3', values: bySeries.get('c::USD') }
  ];
  const [stack] = stackSegments({ series, buckets: ['2024'] });
  assert.equal(stack.total, 500, 'c had no 2024 figure, so it is absent rather than zero');
  assert.equal(stack.segments.length, 2, 'no zero-height segment for the missing series');
  assert.deepEqual(stack.segments.map((s) => [s.from, s.to]), [[0, 300], [300, 500]]);
  let cursor = 0;
  for (const segment of stack.segments) {
    assert.equal(segment.from, cursor, 'segments must be contiguous');
    cursor = segment.to;
  }
  assert.equal(cursor, stack.total);
});

test('a bar axis starts at zero, so no segment is drawn off the plot', () => {
  // The render showed solid single-colour bars: the axis floor rounded up to 50k,
  // so every segment below 50k was drawn below the visible area and the tallest
  // series painted over the lot. A bar is a length, so it has to start at zero.
  const { min, max, ticks } = niceScale([77_800, 97_500, 108_000], { floorAtZero: true });
  assert.equal(min, 0, 'the axis must include zero');
  assert.ok(ticks.some((tick) => tick.value === 0), 'zero should be a labelled tick');
  assert.ok(max >= 108_000);
  // Every stacked total must land inside the plot, not below it.
  for (const total of [77_800, 97_500, 108_000]) {
    const ratio = (total - min) / (max - min || 1);
    assert.ok(ratio > 0 && ratio <= 1, `${total} falls outside the plot (${ratio})`);
  }
  // The default is unchanged, so the line-chart path is untouched.
  assert.ok(niceScale([77_800, 97_500, 108_000]).min > 0, 'a line axis may still pad the floor');

  // Negative values must still be representable rather than clamped away.
  const negative = niceScale([-4000, 20_000], { floorAtZero: true });
  assert.ok(negative.min <= -4000, 'a negative total must not be cut off');
  assert.ok(negative.max >= 20_000);
});

test('the axis is scaled from stacked totals, so a tall stack is not clipped', () => {
  // The trap this whole module exists for: 300 and 200 draw a 500 bar, but a
  // scale built from the largest individual value tops out near 300 and silently
  // cuts the bar in half. Nothing errors; the number is just wrong.
  const bySeries = closingValues([
    { series: 'a', date: '2024-01-01', value: 300, currencyCode: 'USD' },
    { series: 'b', date: '2024-01-01', value: 200, currencyCode: 'USD' }
  ]);
  const series = [
    { key: 'a::USD', values: bySeries.get('a::USD') },
    { key: 'b::USD', values: bySeries.get('b::USD') }
  ];
  const stacks = stackSegments({ series, buckets: ['2024'] });
  const tallest = maxStackTotal(stacks);
  assert.equal(tallest, 500);

  const fromStack = niceScale([tallest]);
  assert.ok(fromStack.max >= 500, `axis must reach the stacked total, got ${fromStack.max}`);

  // The wrong way, for contrast: scaling from individual maxima clips the stack.
  const fromMaxima = niceScale([300, 200]);
  assert.ok(fromMaxima.max < 500, 'scaling from individual maxima would clip the stack');
  assert.ok(fromStack.max > fromMaxima.max, 'the stacked scale is strictly wider');
});

test('a bucket where every series is missing produces no segments at all', () => {
  const bySeries = closingValues([{ series: 'a', date: '2024-01-01', value: 100, currencyCode: 'USD' }]);
  const series = [{ key: 'a::USD', values: bySeries.get('a::USD') }];
  const stacks = stackSegments({ series, buckets: ['2024', '2025'] });
  assert.equal(stacks.length, 2, 'the empty bucket still holds its slot');
  assert.equal(stacks[1].segments.length, 0);
  assert.equal(stacks[1].total, 0);
  assert.ok(niceScale([0]).max > niceScale([0]).min, 'a zero total must not collapse the axis');
});

test('maxStackTotal copes with no data and with an all-zero stack', () => {
  assert.equal(maxStackTotal([]), 0);
  assert.equal(maxStackTotal([{ total: 0 }, { total: 0 }]), 0);
  assert.equal(maxStackTotal([{ total: 5 }, { total: 90 }, { total: 12 }]), 90);
});

test('x-axis labels thin out instead of colliding', () => {
  assert.equal(labelStride(4, 600, 44), 1, 'everything labelled when there is room');
  assert.equal(labelStride(1, 600, 44), 1);
  const stride = labelStride(60, 572, 44);
  assert.ok(stride > 1, 'a dense axis must thin its labels');
  assert.ok(Math.ceil(60 / stride) <= 15, 'too many labels would still collide');
  for (const [count, width] of [[0, 0], [10, 0], [10, -5], [1000, 1]]) {
    assert.ok(Number.isInteger(labelStride(count, width)) && labelStride(count, width) >= 1, `${count}/${width}`);
  }
});

