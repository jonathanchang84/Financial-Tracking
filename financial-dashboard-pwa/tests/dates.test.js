import test from 'node:test';
import assert from 'node:assert/strict';

import {
  dayKey,
  addDaysKey,
  dayBefore,
  parseDate,
  isValidDate,
  shiftWeekend,
  dueDateForBill,
  datesThrough,
  daysBetweenInclusive,
  startOfDay
} from '../src/services/dates.js';

// Reference calendar: 2026-03-01 is a Sunday, so 2026-03-07 is Saturday and
// 2026-03-09 is Monday. February 2026 ends on Saturday the 28th.
test('date-only strings stay in the local calendar (no UTC day shift)', () => {
  assert.equal(dayKey('2026-03-01'), '2026-03-01');
  assert.equal(dayKey('2026-01-01'), '2026-01-01');
  assert.equal(dayKey('2026-12-31T23:30:00'), '2026-12-31');
  assert.equal(dayKey(new Date(2026, 2, 1, 12)), '2026-03-01');
});

test('parseDate survives invalid input and validates correctly', () => {
  assert.equal(isValidDate('2026-02-31'), true, 'JS rolls 31 Feb into March rather than failing');
  assert.equal(isValidDate('not-a-date'), false);
  assert.equal(isValidDate(''), false);
  assert.equal(dayKey(parseDate('rubbish')), dayKey(new Date()), 'falls back to today');
});

test('shiftWeekend moves Saturday and Sunday to Monday', () => {
  assert.equal(dayKey(shiftWeekend('2026-03-07')), '2026-03-09', 'Saturday -> Monday');
  assert.equal(dayKey(shiftWeekend('2026-03-08')), '2026-03-09', 'Sunday -> Monday');
  assert.equal(dayKey(shiftWeekend('2026-03-09')), '2026-03-09', 'Monday unchanged');
});

test('bill due dates clamp to month length then shift off the weekend', () => {
  assert.equal(dayKey(dueDateForBill({ dueDay: 8 }, '2026-03-01')), '2026-03-09', 'Sun 8 Mar -> Mon 9 Mar');
  assert.equal(dayKey(dueDateForBill({ dueDay: 31 }, '2026-02-10')), '2026-03-02', '31 Feb -> 28 Feb (Sat) -> Mon 2 Mar');
  assert.equal(dayKey(dueDateForBill({ dueDay: 15 }, '2026-03-01')), '2026-03-16', 'Sun 15 Mar -> Mon 16 Mar');
  assert.equal(dayKey(dueDateForBill({ dueDay: 17 }, '2026-03-01')), '2026-03-17', 'a Tuesday is unchanged');
  assert.equal(dayKey(dueDateForBill({ due_day: 3 }, '2026-03-01')), '2026-03-03', 'snake_case column accepted');
});

test('date arithmetic helpers are timezone safe', () => {
  assert.equal(addDaysKey('2026-03-01', -1), '2026-02-28');
  assert.equal(dayBefore('2026-03-01'), '2026-02-28');
  assert.equal(daysBetweenInclusive('2026-03-01', '2026-03-10'), 10);
  assert.equal(daysBetweenInclusive('2026-03-01', '2026-02-01'), 1, 'never returns zero or negative');
});

test('datesThrough and startOfDay behave inclusively and respect the cap', () => {
  assert.equal(datesThrough('2026-03-01', '2026-03-10').length, 10);
  assert.equal(datesThrough('2026-03-01', '2026-05-01', 45).length, 45);
  assert.equal(datesThrough('2026-03-10', '2026-03-01').length, 0);
  const noon = startOfDay('2026-03-01');
  assert.equal(noon.getHours(), 0);
  assert.equal(noon.getDate(), 1);
});
