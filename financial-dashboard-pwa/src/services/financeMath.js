/**
 * Compatibility shim.
 *
 * The prototype shipped this module with a *second*, slightly different copy of
 * the runway math (it omitted the "safe to spend" subtraction and dropped
 * weekend-shifted bills). The canonical implementation now lives in
 * `src/services/runway.js` / `src/services/dates.js`; these aliases keep the
 * historic names importable so no caller can silently diverge again.
 */

export {
  buildDailyRunway,
  buildDailyRunway as buildRunway,
  runwayPlanner,
  monthGrowth,
  growthPercent,
  latestBySeries,
  num,
  currencyOf,
  seriesNameOf,
  MAX_RUNWAY_DAYS
} from './runway.js';

export {
  shiftWeekend as shiftedWeekendDate,
  dueDateForBill as billDueDate,
  datesThrough as datesFromThrough,
  dayKey as isoDate,
  startOfDay
} from './dates.js';
