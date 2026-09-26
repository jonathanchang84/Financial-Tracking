import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FALLBACK_RATES,
  buildSnapshot,
  convertWithRates,
  describeRates,
  fetchLiveRates,
  isStale,
  normaliseSnapshot,
  parseRates,
  pickRates,
  usableRate
} from '../src/services/rates.js';

test('the provider response is folded into a lookup, not trusted as an object', () => {
  // Frankfurter answers with an array of { quote, rate } rows, not a keyed object.
  const rates = parseRates([{ quote: 'EUR', rate: 0.877 }, { quote: 'GBP', rate: 0.754 }]);
  assert.equal(rates.EUR, 0.877);
  assert.equal(rates.GBP, 0.754);
  // A keyed object is accepted too, so a provider change degrades rather than breaks.
  assert.equal(parseRates({ JPY: 158.34 }).JPY, 158.34);
});

test('a nonsense rate is rejected rather than poisoning a conversion', () => {
  assert.equal(usableRate(0.754), 0.754);
  assert.equal(usableRate('0.754'), 0.754, 'a numeric string is accepted');
  for (const bad of [0, -1, NaN, Infinity, 'abc', null, undefined, {}]) {
    assert.equal(usableRate(bad), null, `${String(bad)} should be rejected`);
  }
  const rates = parseRates([{ quote: 'EUR', rate: -1 }, { quote: 'GBP', rate: 0.754 }]);
  assert.equal(rates.EUR, undefined, 'a negative rate is dropped, not stored');
  assert.equal(rates.GBP, 0.754, 'valid rates alongside it are kept');
});

test('an empty or malformed response yields no snapshot, so good rates survive', () => {
  // The dangerous failure is replacing a working table with an empty object.
  assert.equal(buildSnapshot([]), null);
  assert.equal(buildSnapshot({}), null);
  assert.equal(buildSnapshot([{ quote: 'EUR', rate: 0 }]), null);
  const snapshot = buildSnapshot([{ quote: 'EUR', rate: 0.877 }], { base: 'USD' });
  assert.equal(snapshot.base, 'USD');
  assert.equal(snapshot.rates.USD, 1, 'the base is always available at 1');
  assert.deepEqual(snapshot.quotes, ['EUR']);
});

test('rates fall back live, then stored, then the hand-written table', () => {
  const live = normaliseSnapshot({ base: 'USD', rates: { EUR: 0.877 }, asOf: '2026-09-26', source: 'live' });
  const stored = normaliseSnapshot({ base: 'USD', rates: { EUR: 0.90 }, source: 'stored' });

  assert.equal(pickRates({ live, stored }).rates.EUR, 0.877, 'live wins');
  assert.equal(pickRates({ live: null, stored }).rates.EUR, 0.90, 'stored is used when there is no live one');
  assert.equal(pickRates({}).rates.EUR, FALLBACK_RATES.EUR, 'the floor is the hand-written table');
  assert.equal(pickRates().source, 'fallback');
  // A corrupt live snapshot must not shadow a good stored one.
  assert.equal(pickRates({ live: normaliseSnapshot({ rates: {} }), stored }).rates.EUR, 0.90);
});

test('a snapshot is only stale once it is actually old', () => {
  const now = Date.now();
  assert.equal(isStale({ base: 'USD', rates: { EUR: 0.9 }, fetchedAt: now }, now), false);
  assert.equal(isStale({ base: 'USD', rates: { EUR: 0.9 }, fetchedAt: now - 11 * 3600_000 }, now), false);
  assert.equal(isStale({ base: 'USD', rates: { EUR: 0.9 }, fetchedAt: now - 13 * 3600_000 }, now), true);
  assert.equal(isStale({ base: 'USD', rates: { EUR: 0.9 } }, now), true, 'no timestamp means never fetched');
  assert.equal(isStale(null, now), true);
});

test('fetching rates survives every way the network can fail', async () => {
  // None of these may throw: a failure has to leave the app exactly as it was.
  let requestedUrl = '';
  assert.equal(await fetchLiveRates({ fetchImpl: null }), null, 'no fetch available');
  assert.equal(await fetchLiveRates({ fetchImpl: async () => { throw new Error('offline'); } }), null);
  assert.equal(await fetchLiveRates({ fetchImpl: async () => ({ ok: false, status: 429 }) }), null, 'rate limited');
  assert.equal(await fetchLiveRates({ fetchImpl: async () => ({ ok: true, json: async () => { throw new Error('bad json'); } }) }), null);
  assert.equal(await fetchLiveRates({ fetchImpl: async () => ({ ok: true, json: async () => ({}) }) }), null, 'empty payload');

  const snapshot = await fetchLiveRates({
    base: 'USD',
    quotes: ['EUR', 'GBP'],
    fetchImpl: async (url) => {
      // Asserted outside the stub on purpose: `fetchLiveRates` catches everything,
      // so a failing assertion inside here would look like a network failure.
      requestedUrl = url;
      return { ok: true, json: async () => [{ quote: 'EUR', rate: 0.877 }] };
    }
  });
  assert.match(requestedUrl, /base=usd/);
  assert.match(requestedUrl, /quotes=eur,gbp/, 'quotes are encoded individually, so the comma stays literal');
  assert.equal(snapshot.rates.EUR, 0.877, 'a good response still works');
});

test('conversion stays the same maths, and stays pure', () => {
  // The important property: a rate change alters what is *displayed*, never what
  // is stored, because nothing here writes anywhere.
  const table = { USD: 1, GBP: 0.754, EUR: 0.877 };
  assert.equal(convertWithRates(1000, 'USD', 'GBP', table), (1000 / 1) * 0.754);
  assert.equal(convertWithRates(754, 'GBP', 'USD', table), 1000);
  assert.equal(convertWithRates(500, 'USD', 'USD', table), 500, 'same currency is a no-op');
  assert.equal(convertWithRates('nonsense', 'USD', 'GBP', table), 0, 'garbage becomes zero, not NaN');
  // An unknown currency falls back to 1 rather than producing Infinity.
  assert.ok(Number.isFinite(convertWithRates(100, 'XYZ', 'GBP', table)));
});

test('the label says when the rates were last refreshed', () => {
  assert.equal(describeRates(null).tone, 'warn', 'no snapshot is an estimate');
  assert.equal(describeRates({ base: 'USD', rates: {}, source: 'fallback' }).tone, 'warn');
  const fresh = describeRates({ base: 'USD', rates: { EUR: 0.9 }, asOf: new Date().toISOString(), source: 'live' });
  assert.equal(fresh.label, 'Rates today');
  const old = describeRates({ base: 'USD', rates: { EUR: 0.9 }, asOf: '2020-01-01T00:00:00.000Z', source: 'live' });
  assert.match(old.label, /^Rates /);
  assert.equal(old.tone, 'ok');
});
