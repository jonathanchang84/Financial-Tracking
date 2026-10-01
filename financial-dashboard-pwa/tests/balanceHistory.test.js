import test from 'node:test';
import assert from 'node:assert/strict';

import {
  anchorForDate,
  balanceRecordId,
  isRecordedDay,
  normaliseBalanceHistory,
  normaliseBalanceRecord,
  recordedDatesIn,
  todayKey
} from '../src/services/balanceHistory.js';

test('a record id is derived from the date, so a re-save replaces rather than appends', () => {
  assert.equal(balanceRecordId('2026-10-01'), 'balance-2026-10-01');
  assert.equal(balanceRecordId('2026-10-01'), balanceRecordId('2026-10-01T09:30:00'));
  assert.equal(balanceRecordId(''), '');
  assert.equal(balanceRecordId('nonsense'), '');
});

test('a record is coerced into the canonical shape', () => {
  assert.deepEqual(normaliseBalanceRecord({ date: '2026-10-01', amount: '1,234.50', currencyCode: 'GBP' }), {
    id: 'balance-2026-10-01',
    date: '2026-10-01',
    amount: 1234.5,
    currencyCode: 'GBP',
    // Absent rather than `undefined`, because a deepEqual against the stored shape
    // is the cheapest guard against silently changing a record's canonical form.
    implicit: false
  });
  // The legacy `currency` key is still read, matching the other record types.
  assert.equal(normaliseBalanceRecord({ date: '2026-10-01', amount: 5, currency: 'USD' }).currencyCode, 'USD');
  // The runway's stand-in record for an undated balance keeps its flag through
  // normalisation, so the day is not badged as one the user recorded.
  assert.equal(normaliseBalanceRecord({ date: '2026-10-01', amount: 5, implicit: true }).implicit, true);
});

test('unusable records are dropped rather than stored as a blank or a zero', () => {
  assert.equal(normaliseBalanceRecord({ date: 'nonsense', amount: 10 }), null);
  assert.equal(normaliseBalanceRecord({ date: '2026-10-01', amount: 'abc' }), null);
  assert.equal(normaliseBalanceRecord({ amount: 10 }), null);
  assert.equal(normaliseBalanceRecord(null), null);
});

test('history is ordered oldest first with one record per date', () => {
  const history = normaliseBalanceHistory([
    { date: '2026-10-03', amount: 300 },
    { date: '2026-10-01', amount: 100 },
    { date: '2026-10-02', amount: 200 },
    { date: '2026-10-02', amount: 250 }
  ]);
  assert.deepEqual(history.map((row) => [row.date, row.amount]), [
    ['2026-10-01', 100],
    ['2026-10-02', 250],
    ['2026-10-03', 300]
  ]);
  assert.deepEqual(normaliseBalanceHistory('not an array'), []);
  assert.deepEqual(normaliseBalanceHistory(), []);
});

test('a day is anchored on the nearest record on or before it', () => {
  const history = [
    { date: '2026-10-01', amount: 100 },
    { date: '2026-10-05', amount: 500 }
  ];
  assert.equal(anchorForDate(history, '2026-10-01').amount, 100, 'the record day itself');
  assert.equal(anchorForDate(history, '2026-10-04').amount, 100, 'between two records');
  assert.equal(anchorForDate(history, '2026-10-05').amount, 500, 'the newer record wins from its own day');
  assert.equal(anchorForDate(history, '2026-10-09').amount, 500, 'carries forward after the last record');
});

test('a day before the first record has no anchor, so it is never given a guessed figure', () => {
  const history = [{ date: '2026-10-05', amount: 500 }];
  assert.equal(anchorForDate(history, '2026-10-04'), null, 'the day before is unknown, not zero');
  assert.equal(anchorForDate(history, '2026-09-30'), null);
  assert.equal(anchorForDate([], '2026-10-04'), null, 'no history at all');
  assert.equal(anchorForDate(history, ''), null);
});

test('recorded days are reported for the update marker', () => {
  const history = [{ date: '2026-10-02', amount: 200 }];
  assert.equal(isRecordedDay(history, '2026-10-02'), true);
  assert.equal(isRecordedDay(history, '2026-10-03'), false);
  assert.equal(isRecordedDay([], '2026-10-02'), false);
});

test('recorded dates within a window are listed oldest first', () => {
  const history = [
    { date: '2026-09-28', amount: 1 },
    { date: '2026-10-02', amount: 2 },
    { date: '2026-10-05', amount: 3 }
  ];
  assert.deepEqual(recordedDatesIn(history, '2026-10-01', '2026-10-31'), ['2026-10-02', '2026-10-05']);
  assert.deepEqual(recordedDatesIn(history, '2026-10-01', '2026-10-01'), [], 'an empty window');
  assert.deepEqual(recordedDatesIn(history, '2026-10-31', '2026-10-01'), [], 'a reversed window');
  assert.deepEqual(recordedDatesIn(history, '', '2026-10-31'), []);
});

test('today is read in the local calendar, not UTC', () => {
  // Constructed as local midnight; a UTC parse would shift this in negative
  // offsets, which is the exact bug `dates.js` exists to prevent.
  const local = new Date(2026, 9, 1, 0, 0, 0);
  assert.equal(todayKey(local), '2026-10-01');
});
