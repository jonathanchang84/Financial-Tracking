import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isCurrentVersion,
  seriesKey,
  currentVersions,
  versionsForSeries,
  resolveLogicalId,
  planValuation,
  groupByLogicalId,
  withVersionMeta
} from '../src/services/scd2.js';

const openUsd = {
  id: 'a',
  logicalId: 'a',
  series: 'Savings',
  currencyCode: 'USD',
  date: '2026-01-01',
  validFrom: '2026-01-01',
  validTo: null,
  currentFlag: true,
  value: 100
};

test('a current version is open only when it has no validTo and is flagged current', () => {
  assert.equal(isCurrentVersion(openUsd), true);
  assert.equal(isCurrentVersion({ validTo: null, currentFlag: true }), true);
  assert.equal(isCurrentVersion({ currentFlag: true }), true, 'missing validTo is treated as open');
  assert.equal(isCurrentVersion({ validTo: '2026-01-31', currentFlag: false }), false);
  assert.equal(isCurrentVersion({ validTo: '2026-01-31' }), false);
  assert.equal(isCurrentVersion(null), false);
});

test('a new valuation closes the previous open version the day before', () => {
  const plan = planValuation({
    rows: [openUsd],
    id: 'b',
    series: 'Savings',
    date: '2026-02-01',
    value: 250,
    currency: 'USD'
  });

  assert.deepEqual(plan.close, [{ id: 'a', validTo: '2026-01-31', currentFlag: false }]);
  assert.equal(plan.insert.id, 'b');
  assert.equal(plan.insert.logicalId, 'a', 'stable logical id links the versions');
  assert.equal(plan.insert.validFrom, '2026-02-01');
  assert.equal(plan.insert.validTo, null);
  assert.equal(plan.insert.currentFlag, true);
  assert.equal(plan.insert.value, 250);
  assert.equal(plan.previousValue, 100);
  assert.equal(plan.previousVersionId, 'a');
  assert.equal(plan.logicalIdCreated, false);
});

test('re-keying the same day replaces the open version instead of a zero-length interval', () => {
  const plan = planValuation({
    rows: [openUsd],
    id: 'b',
    series: 'Savings',
    date: '2026-01-01',
    value: 140,
    currency: 'USD'
  });
  assert.equal(plan.close.length, 0);
  assert.equal(plan.replacedSameDayId, 'a');
  assert.equal(plan.insert.id, 'a');
  assert.equal(plan.insert.value, 140);
});

test('back-dated valuations never produce a validTo earlier than validFrom', () => {
  const later = { ...openUsd, validFrom: '2026-05-01', date: '2026-05-01' };
  const plan = planValuation({ rows: [later], id: 'b', series: 'Savings', date: '2026-03-01', value: 90, currency: 'USD' });
  assert.deepEqual(plan.close, [{ id: 'a', validTo: '2026-05-01', currentFlag: false }]);
});

test('series with the same name but different currencies keep separate chains', () => {
  const rows = [
    openUsd,
    { ...openUsd, id: 'g', logicalId: 'g', currencyCode: 'GBP', value: 80 }
  ];
  assert.equal(seriesKey(openUsd), 'Savings::USD');
  assert.equal(seriesKey({ series: 'Savings', currencyCode: 'GBP' }), 'Savings::GBP');
  assert.equal(currentVersions(rows).length, 2, 'name + currency is the series identity');

  const plan = planValuation({ rows, id: 'c', series: 'Savings', date: '2026-03-01', value: 150, currency: 'GBP' });
  assert.deepEqual(plan.close.map((row) => row.id), ['g']);
  assert.equal(plan.logicalId, 'g');
  assert.equal(plan.insert.currencyCode, 'GBP');
});

test('a brand new series creates a chain and reuses the fallback logical id', () => {
  const plan = planValuation({ rows: [], id: 'fresh-id', series: 'New pot', date: '2026-04-01', value: 1000, currency: 'EUR' });
  assert.equal(plan.insert.logicalId, 'fresh-id');
  assert.equal(plan.logicalIdCreated, true);
  assert.equal(plan.previousValue, null);
  assert.deepEqual(plan.close, []);
});

test('resolveLogicalId prefers the open version, then the newest closed one', () => {
  const older = { ...openUsd, id: 'x', logicalId: 'chain-1', validTo: '2026-01-31', currentFlag: false };
  const newer = { ...openUsd, id: 'y', logicalId: 'chain-2', validFrom: '2026-02-01', date: '2026-02-01' };
  assert.equal(resolveLogicalId({ rows: [older, newer], series: 'Savings', currency: 'USD' }), 'chain-2');
  assert.equal(
    resolveLogicalId({ rows: [older], series: 'Savings', currency: 'USD' }),
    'chain-1',
    'falls back to the newest closed version'
  );
  assert.equal(resolveLogicalId({ rows: [], series: 'Nothing', currency: 'USD', fallback: 'fb' }), 'fb');
});

test('versionsForSeries filters by name and currency and sorts by validFrom', () => {
  const rows = [
    { ...openUsd, id: 'b', date: '2026-03-01', validFrom: '2026-03-01', currentFlag: true },
    { ...openUsd, id: 'a', validTo: '2026-02-28', currentFlag: false },
    { ...openUsd, id: 'z', series: 'Other', validFrom: '2026-01-01' }
  ];
  const chain = versionsForSeries(rows, 'Savings', 'USD');
  assert.deepEqual(chain.map((row) => row.id), ['a', 'b']);
});

test('groupByLogicalId groups the audit trail and withVersionMeta stamps new rows', () => {
  const groups = groupByLogicalId([openUsd, { ...openUsd, id: 'b', logicalId: 'a', validFrom: '2026-02-01', date: '2026-02-01' }]);
  assert.equal(groups.size, 1);
  assert.equal(groups.get('a').length, 2);

  const stamped = withVersionMeta({ id: 'n' }, '2026-06-01');
  assert.equal(stamped.validFrom, '2026-06-01');
  assert.equal(stamped.validTo, null);
  assert.equal(stamped.currentFlag, true);
});
