import test from 'node:test';
import assert from 'node:assert/strict';

import { shiftToPreviousFriday, shiftWeekend, occurrenceInMonth, dayKey } from '../src/services/dates.js';
import {
  createStream,
  normaliseIncomeDay,
  normaliseIncomeStreams,
  paydayDetail,
  removeStream,
  resolveMainPayday,
  upcomingPaydays,
  upsertStream,
  withMainStream
} from '../src/services/income.js';

test('a weekend payday is brought back to the Friday before, bills still move to Monday', () => {
  // Income and bills shift in opposite directions, so the two helpers must stay
  // independent. Moving one must never alter the other.
  assert.equal(dayKey(shiftToPreviousFriday('2026-03-07')), '2026-03-06', 'Saturday -> Friday');
  assert.equal(dayKey(shiftToPreviousFriday('2026-03-08')), '2026-03-06', 'Sunday -> Friday');
  assert.equal(dayKey(shiftToPreviousFriday('2026-03-09')), '2026-03-09', 'Monday unchanged');
  assert.equal(dayKey(shiftWeekend('2026-03-07')), '2026-03-09', 'a bill Saturday is still Monday');
  assert.equal(dayKey(shiftWeekend('2026-03-08')), '2026-03-09', 'a bill Sunday is still Monday');
});

test('a payday on the 1st that is a weekend uses the same rule, with no special case', () => {
  // The rule is uniform: whatever day it lands on, go back to the Friday.
  assert.equal(dayKey(shiftToPreviousFriday('2026-08-01')), '2026-07-31', 'Saturday 1st -> Friday 31 July');
  assert.equal(dayKey(shiftToPreviousFriday('2026-03-01')), '2026-02-27', 'Sunday 1st -> Friday 27 Feb');
  assert.equal(dayKey(shiftToPreviousFriday('2027-05-01')), '2027-04-30', 'Saturday 1st -> Friday 30 April');
  // A 1st that already is a Friday must not move.
  assert.equal(dayKey(shiftToPreviousFriday('2026-05-01')), '2026-05-01', 'Friday 1st stays put');
});

test('a day of month is clamped into shorter months', () => {
  assert.equal(dayKey(occurrenceInMonth(31, '2026-04-10')), '2026-04-30', 'April has 30 days');
  assert.equal(dayKey(occurrenceInMonth(31, '2026-02-10')), '2026-02-28', 'February 2026 has 28');
  assert.equal(dayKey(occurrenceInMonth(31, '2024-02-10')), '2024-02-29', 'leap February has 29');
  assert.equal(dayKey(occurrenceInMonth(15, '2026-04-10')), '2026-04-15', 'a mid-month day is unaffected');
  assert.equal(dayKey(occurrenceInMonth(1, '2026-04-10')), '2026-04-01');
});

test('the next payday is always today or later, rolling into the next month when needed', () => {
  const detail = paydayDetail({ dayOfMonth: 25 }, '2026-03-26');
  assert.equal(detail.key, '2026-04-24', 'the 25th already passed, so the next one is used');
  assert.ok(detail.key > '2026-03-26');

  const sameDay = paydayDetail({ dayOfMonth: 10 }, '2026-03-10');
  assert.equal(sameDay.key, '2026-03-10', 'a payday landing today counts as today');
});

test('a single stream becomes the main payday automatically', () => {
  // The rule the user asked for: no extra click when there is only one stream.
  const streams = normaliseIncomeStreams([{ name: 'Salary', dayOfMonth: 17 }]);
  assert.equal(streams.length, 1);
  assert.equal(streams[0].isMain, true);
  const main = resolveMainPayday(streams, '2026-03-01');
  assert.equal(main.key, '2026-03-17');
  assert.equal(main.stream.name, 'Salary');
  assert.equal(main.isFallback, false);
});

test('a weekend payday is still the main payday, just moved to the Friday before', () => {
  // The main flag and the weekend adjustment are independent concerns: marking a
  // stream main must not stop it being adjusted onto a Friday.
  const streams = normaliseIncomeStreams([{ name: 'Salary', dayOfMonth: 15, isMain: true }]);
  const main = resolveMainPayday(streams, '2026-03-01');
  assert.equal(main.key, '2026-03-13', '15 March 2026 is a Sunday, so payday is Friday the 13th');
  assert.equal(main.adjusted, true);
});

test('creating the first stream stores it as the main payday', () => {
  const [first] = createStream([]);
  assert.equal(first.isMain, true, 'the first stream is the main one');
  const [salary, side] = createStream(createStream([], { name: 'Salary', dayOfMonth: 15 }));
  assert.equal(salary.isMain, true, 'the existing main keeps the flag');
  assert.equal(side.isMain, false, 'the new stream does not steal it');
});

test('exactly one main survives a list that claims otherwise', () => {
  // A hand-edited backup or a bad import must not be able to produce two mains
  // or none, because the runway needs a single unambiguous payday.
  const twoMains = normaliseIncomeStreams([
    { id: 'a', name: 'A', dayOfMonth: 1, isMain: true },
    { id: 'b', name: 'B', dayOfMonth: 2, isMain: true }
  ]);
  assert.equal(twoMains.filter((s) => s.isMain).length, 1, 'the first marked stream wins');

  const noneMarked = normaliseIncomeStreams([
    { id: 'a', name: 'A', dayOfMonth: 20 },
    { id: 'b', name: 'B', dayOfMonth: 5 }
  ]);
  assert.equal(noneMarked.filter((s) => s.isMain).length, 1, 'one is still chosen');

  const empty = normaliseIncomeStreams([]);
  assert.equal(empty.filter((s) => s.isMain).length, 0, 'an empty list has no main to have');
  assert.equal(resolveMainPayday([], '2026-03-01'), null, 'no streams means no runway payday');
});

test('deleting the main payday promotes another so the runway never loses its anchor', () => {
  const streams = createStream(createStream([], { name: 'Salary', dayOfMonth: 15 }), { name: 'Side work', dayOfMonth: 28 });
  assert.equal(streams[0].isMain, true);
  const remaining = removeStream(streams, streams[0].id);
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].isMain, true, 'the survivor is promoted automatically');
  assert.equal(removeStream(streams, 'does-not-exist').length, 2, 'removing an unknown id changes nothing');
});

test('making a stream main moves the flag without disturbing the others', () => {
  const streams = createStream(createStream([], { name: 'Salary', dayOfMonth: 15 }), { name: 'Side work', dayOfMonth: 28 });
  const side = streams[1];
  const updated = withMainStream(streams, side.id);
  assert.equal(updated.filter((s) => s.isMain).length, 1);
  assert.equal(updated.find((s) => s.id === side.id).isMain, true);
  assert.equal(updated.find((s) => s.name === 'Salary').isMain, false);
});

test('editing a stream keeps the list valid and the day clamped', () => {
  const streams = createStream([], { name: 'Salary', dayOfMonth: 15 });
  const renamed = upsertStream(streams, { id: streams[0].id, name: 'Day job' });
  assert.equal(renamed[0].name, 'Day job');
  assert.equal(renamed[0].isMain, true, 'editing must not drop the main flag');
  const clamped = upsertStream(streams, { id: streams[0].id, dayOfMonth: 99 });
  assert.equal(clamped[0].dayOfMonth, 31, 'a day above 31 is clamped, not rejected');
});

test('malformed or blank stored data is repaired rather than trusted', () => {
  assert.equal(normaliseIncomeDay(''), null);
  assert.equal(normaliseIncomeDay('abc'), null);
  assert.equal(normaliseIncomeDay(0), 1, 'clamped up to the first');
  assert.equal(normaliseIncomeDay(40), 31, 'clamped down to the last');
  assert.equal(normaliseIncomeDay('15'), 15, 'a numeric string from an input box is accepted');

  const repaired = normaliseIncomeStreams([
    { name: '   ', dayOfMonth: 15 },
    { name: 'Broken', dayOfMonth: '' },
    null,
    'nonsense'
  ]);
  assert.equal(repaired.length, 1, 'unusable entries are dropped');
  assert.equal(repaired[0].name, 'Income', 'a blank name falls back');
  assert.deepEqual(normaliseIncomeStreams(null), [], 'a missing list is not an error');
  assert.deepEqual(normaliseIncomeStreams('not a list'), []);
});

test('upcoming paydays are ordered and every stream is still represented', () => {
  const streams = createStream(createStream([], { name: 'Late', dayOfMonth: 28 }), { name: 'Early', dayOfMonth: 5 });
  const upcoming = upcomingPaydays(streams, '2026-03-01');
  assert.equal(upcoming.length, 2);
  assert.ok(upcoming[0].key < upcoming[1].key, 'sorted soonest first');
  assert.deepEqual(upcoming.map((item) => item.stream.name), ['Early', 'Late']);
  assert.equal(upcomingPaydays(streams, '2026-03-01', 1).length, 1, 'the limit is respected');
});

test('the UI is told why a payday moved, so it can explain the adjustment', () => {
  // 2026-03-28 is a Saturday, so a 28th payday is paid on Friday the 27th.
  const detail = paydayDetail({ name: 'Side work', dayOfMonth: 28 }, '2026-03-01');
  assert.equal(detail.key, '2026-03-27');
  assert.equal(detail.adjusted, true);
  assert.match(detail.notes[0], /28th/);
  assert.match(detail.notes[0], /Sat/);

  const plain = paydayDetail({ name: 'Salary', dayOfMonth: 25 }, '2026-03-01');
  assert.equal(plain.key, '2026-03-25', 'a mid-week payday is untouched');
  assert.equal(plain.adjusted, false);
  assert.deepEqual(plain.notes, [], 'no note when nothing changed');
});

test('a single stream resolves to the same date the old scalar produced', () => {
  // The runway maths is unchanged: one stream means one payday, so every
  // pre-existing figure and test keeps working.
  const streams = normaliseIncomeStreams([{ name: 'Income', dayOfMonth: 10, isMain: true }]);
  assert.equal(resolveMainPayday(streams, '2026-03-01').key, '2026-03-10');
});

