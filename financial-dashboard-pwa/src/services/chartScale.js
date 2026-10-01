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
export function niceScale(values, { tickCount = 5, floorAtZero = false } = {}) {
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
    // Symmetric only when a zero floor is not wanted. With one, an all-positive
    // chart still has to start at zero, so the floor is held and only the head
    // is given room.
    if (!floorAtZero) low -= padding;
    high += padding;
  } else {
    // A little breathing room so the extremes are not clipped by the padding.
    const spread = (high - low) * 0.05;
    // ...but never below zero when a zero floor is wanted. The floor is about to
    // be rounded down to a whole tick step anyway, so padding the bottom only
    // buys room that rounds away: pad -11,400 to a 100k step and the axis starts
    // at -100k for a chart whose lowest value is 0. A chart with no liabilities
    // must still read as starting at zero.
    if (!floorAtZero) low -= spread;
    high += spread;
  }

  const step = niceStep((high - low) / (requested - 1));
  // A bar chart is read as a length, so it has to start at zero. Rounding the
  // floor to a nice step instead puts it at, say, 50k, and every segment below
  // that is drawn off the bottom of the plot - the bars then look far too short
  // and the smallest series vanishes entirely. Negative net worth is the one
  // case where a zero floor is still correct: the axis simply spans both sides.
  const min = floorAtZero ? Math.min(0, Math.floor(low / step) * step) : Math.floor(low / step) * step;
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

/* ---------------------------------------------------------------------------
 * Bucketing and stacking.
 *
 * Buckets come from the shared history pivot, so the chart and the table beneath
 * it always show the same figures.
 * ------------------------------------------------------------------------- */

/**
 * Bucket key for a date at the requested granularity.
 *
 * Strict on purpose. A loose slice turned `2024-13-99` into the bucket "2024",
 * so a malformed date would silently create a real-looking bucket instead of
 * being dropped - which hides a data problem rather than surfacing it. The
 * round-trip check also rejects real-looking but impossible dates like
 * `2024-02-31`, which `Date` would otherwise roll over into March.
 */
export function bucketKey(date, granularity = 'year') {
  const value = String(date || '').slice(0, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return '';
  const [, year, month, day] = match;
  const parsed = new Date(Number(year), Number(month) - 1, Number(day));
  const valid =
    parsed.getFullYear() === Number(year) &&
    parsed.getMonth() === Number(month) - 1 &&
    parsed.getDate() === Number(day);
  if (!valid) return '';
  return granularity === 'month' ? `${year}-${month}` : year;
}

/** Human label for a bucket key. */
export function bucketLabel(key, granularity = 'year') {
  if (granularity !== 'month') return String(key);
  const [year, month] = String(key).split('-').map(Number);
  if (!year || !month) return String(key);
  const when = new Date(year, month - 1, 1);
  return Number.isNaN(when.getTime()) ? String(key) : when.toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
}

/** Every bucket between the first and last, so gaps leave an empty slot. */
export function bucketRange(keys, granularity = 'year') {
  const sorted = [...new Set(keys.filter(Boolean))].sort();
  if (!sorted.length) return [];
  const out = [];
  if (granularity !== 'month') {
    for (let year = Number(sorted[0]); year <= Number(sorted.at(-1)); year += 1) out.push(String(year));
    return out;
  }
  const [startYear, startMonth] = sorted[0].split('-').map(Number);
  const [endYear, endMonth] = sorted.at(-1).split('-').map(Number);
  for (let year = startYear, month = startMonth; year < endYear || (year === endYear && month <= endMonth);) {
    out.push(`${year}-${String(month).padStart(2, '0')}`);
    month += 1;
    if (month > 12) { month = 1; year += 1; }
  }
  return out;
}

/**
 * Cumulative `y0`/`y1` for each visible series within every bucket, stacked
 * around zero: assets climb from zero, liabilities descend from zero.
 *
 * Two independent accumulators, not one. A single running `base` would make a
 * negative value drag the running baseline down, so every segment after a
 * liability would be drawn at the wrong height and the total would land in the
 * wrong place. Net worth has both kinds of value, so the two sides are stacked
 * independently and the bar reads as assets above the line, liabilities below.
 *
 * A null is skipped rather than counted as zero. Treating "we have no figure" as
 * "it was worth nothing" would put a zero-height segment in the stack, which
 * reads as a real value.
 *
 * `from`/`to` stay ascending (from < to) for every segment, including the
 * downward ones, so the renderer can compute `y` and `height` without knowing
 * which side a segment is on.
 *
 * `top`, `bottom` and `net` are what the axis and the label read: `top` is the
 * positive ceiling, `bottom` the negative floor, and `net` is assets minus
 * liabilities. Scaling from `top`/`bottom` rather than `net` is the whole reason
 * this is separate - an axis built from the net alone would clip whichever side
 * is larger, with no error at all.
 */
export function stackSegments({ series = [], buckets = [] } = {}) {
  return buckets.map((bucket) => {
    const segments = [];
    let up = 0;
    let down = 0;
    let net = 0;
    for (const line of series) {
      const cell = line?.values?.get?.(bucket);
      const value = cell?.value;
      // Guarded before Number(), not after. `Number(null)` is 0 and
      // `Number(undefined)` is NaN, so a `Number.isFinite` check alone would
      // read a missing figure as zero and draw a zero-height segment - which
      // says "this was worth nothing" rather than "we have no record".
      if (value === null || value === undefined) continue;
      const amount = Number(value);
      if (!Number.isFinite(amount)) continue;
      net += amount;
      if (amount >= 0) {
        segments.push({ key: line.key, color: line.color, value: amount, from: up, to: up + amount, side: 'asset' });
        up += amount;
      } else {
        // Descending. `down` stays a NEGATIVE running baseline, so the next
        // liability simply starts where the last one ended and `bottom` is
        // already the true negative floor. Tracking it as a positive depth
        // instead leaves `bottom` positive, which puts the axis floor on the
        // wrong side and draws liabilities above the assets.
        const next = down + amount;
        segments.push({ key: line.key, color: line.color, value: amount, from: next, to: down, side: 'liability' });
        down = next;
      }
    }
    return { bucket, segments, total: net, net, top: up, bottom: down };
  });
}

/**
 * The range the y axis has to cover: the highest positive stack and the lowest
 * negative one. Zero is always included by the caller via `floorAtZero`, so the
 * two sides are comparable against a single baseline.
 */
export function stackExtent(stacks) {
  const list = stacks || [];
  return {
    min: list.reduce((lowest, entry) => (Number(entry?.bottom) < lowest ? Number(entry?.bottom) : lowest), 0),
    max: list.reduce((highest, entry) => (Number(entry?.top) > highest ? Number(entry?.top) : highest), 0)
  };
}

/** Largest stacked total, which is what the y axis has to accommodate. */
export function maxStackTotal(stacks) {
  return (stacks || []).reduce((highest, entry) => (Number(entry?.net ?? entry?.total) > highest ? Number(entry?.net ?? entry?.total) : highest), 0);
}

/**
 * How many labels to skip so x-axis text does not collide.
 * Returns the step between labelled buckets; 1 means label everything.
 */
export function labelStride(bucketCount, plotWidth, approxLabelWidth = 44) {
  if (bucketCount <= 1) return 1;
  const fits = Math.max(1, Math.floor(plotWidth / Math.max(8, approxLabelWidth)));
  return Math.max(1, Math.ceil(bucketCount / fits));
}

