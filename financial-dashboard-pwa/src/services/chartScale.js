/**
 * Axis scale for the hand-rolled SVG charts.
 *
 * Kept pure and dependency-free so it can be tested under `node --test`, which
 * `node:test` cannot do for a Svelte component. Same reason `income.js` and
 * `commitQueue.js` are separate modules.
 *
 * Two things this has to get right, both of which have bitten before:
 *
 *   - A flat series (a savings pot nobody has touched) has `min === max`, so any
 *     divide by the range is 0/0. Every function here degrades to a readable
 *     axis instead of NaN coordinates.
 *   - Tick values are "nice" (1, 2, 5 x 10^n) so the axis reads 10k / 20k / 30k
 *     rather than 10,237 / 20,473. Raw min/max produce unreadable labels.
 */

/** One tick, and where it sits vertically. `ratio` is 0 at the axis floor. */
function buildTick(value, ratio) {
  return { value, ratio };
}

/**
 * Round a raw step up to the nearest 1, 2, 5 or 10 x 10^n.
 * Returns 1 for a non-positive or non-finite input so a caller cannot divide by 0.
 */
export function niceStep(rawStep) {
  if (!Number.isFinite(rawStep) || rawStep <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalised = rawStep / magnitude;
  const step = normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 5 ? 5 : 10;
  return step * magnitude;
}

/**
 * Axis domain and ticks covering every value.
 *
 * The domain is padded outward to whole tick steps so the first and last points
 * are never drawn on the frame edge, and a single-value series still gets a
 * sensible band rather than a zero-height axis.
 *
 * Returns `{ min, max, ticks }` where `ticks` ascend from `min` to `max`.
 */
export function niceScale(values, { tickCount = 5 } = {}) {
  const finite = (values || []).map(Number).filter((value) => Number.isFinite(value));
  const requested = Math.max(2, Math.min(10, Math.trunc(tickCount) || 5));

  if (!finite.length) {
    // No data at all: a zero-to-one axis is the least confusing placeholder.
    return { min: 0, max: 1, ticks: [buildTick(0, 0), buildTick(1, 1)] };
  }

  let low = Math.min(...finite);
  let high = Math.max(...finite);
  if (low === high) {
    // Flat series. Widen by half the value (or 1 when the value is 0) so the
    // line sits in the middle of the plot instead of on an edge.
    const padding = low === 0 ? 1 : Math.abs(low) / 2;
    low -= padding;
    high += padding;
  } else {
    // A little breathing room so the extremes are not clipped by the padding.
    const spread = (high - low) * 0.05;
    low -= spread;
    high += spread;
  }

  const step = niceStep((high - low) / (requested - 1));
  const min = Math.floor(low / step) * step;
  const max = Math.ceil(high / step) * step;

  const ticks = [];
  // Accumulated with a rounded index to avoid 0.1-style drift from repeated adds.
  const count = Math.round((max - min) / step);
  for (let index = 0; index <= count; index += 1) {
    const value = Number((min + index * step).toPrecision(12));
    ticks.push(buildTick(value, (value - min) / (max - min || 1)));
  }
  return { min, max, ticks };
}

/**
 * Compact currency for an axis label: 12,400 becomes "12.4k".
 *
 * Deliberately not `toLocaleString`, which renders "£12,400" and is far too wide
 * for a gutter. The exact value is still available on hover and in the table
 * beneath the chart, so this only has to be scannable.
 */
export function formatAxisValue(value, { compact = true, fractionDigits = 1 } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '';
  const abs = Math.abs(number);
  if (!compact || abs < 1000) {
    // Whole numbers under a thousand read better without a decimal point.
    return Math.abs(number) < 10 && !Number.isInteger(number)
      ? number.toFixed(fractionDigits)
      : String(Math.round(number));
  }
  const units = [
    { limit: 1e12, suffix: 'tn' },
    { limit: 1e9, suffix: 'bn' },
    { limit: 1e6, suffix: 'm' },
    { limit: 1e3, suffix: 'k' }
  ];
  const unit = units.find((entry) => abs >= entry.limit);
  if (!unit) return String(Math.round(number));
  const scaled = number / unit.limit;
  // Drop the decimal once it adds nothing, so 200k does not read "200.0k".
  const digits = Math.abs(scaled) >= 100 ? 0 : fractionDigits;
  return `${Number(scaled.toFixed(digits))}${unit.suffix}`;
}

/**
 * Split a series into contiguous runs so a missing value breaks the line.
 *
 * The monthly history table deliberately fills gaps between recorded months with
 * `null`. Drawing a line through those would show a value of zero for a pension
 * that did not exist yet, which is not a rounding difference but a false
 * statement about the data. Each run is drawn as its own polyline.
 */
export function splitIntoRuns(points) {
  const runs = [];
  let current = [];
  for (const point of points || []) {
    const value = point?.value;
    if (value === null || value === undefined || !Number.isFinite(Number(value))) {
      if (current.length) runs.push(current);
      current = [];
      continue;
    }
    current.push({ ...point, value: Number(value) });
  }
  if (current.length) runs.push(current);
  return runs;
}
