/**
 * Live exchange rates, fetched from the browser.
 *
 * Why the browser and not the Worker: a request from here goes to the provider
 * and never touches this app's Worker, so refreshing costs nothing against the
 * Worker's daily request allowance. Proxying through the Worker would add an
 * invocation per refresh for no benefit. The trade is one request a day per
 * device, which is nothing.
 *
 * Why live at all: the previous hand-written table had drifted about 5% from the
 * market (GBP 0.79 against 0.754, JPY 149.5 against 158.34). Nothing errored, so a
 * mixed-currency net worth was quietly wrong.
 *
 * Rates are display-only. Records store their native amount and currency, and
 * conversion is a pure function, so no stored value is ever amended by a rate
 * change. What moves is what a figure is *worth* in the display currency.
 *
 * Dependency-free and injectable, so it is testable under `node --test` with no
 * browser, network, or `import.meta.env`.
 */

/** Frankfurter: no key, no quotas, free for commercial use, 200+ currencies. */
export const RATE_ENDPOINT = 'https://api.frankfurter.dev/v2/rates';

/** Frankfurter publishes daily, so refreshing more often would be wasted calls. */
export const RATES_MAX_AGE_MS = 12 * 60 * 60 * 1000;

/**
 * The hand-written table, kept as a last resort. It is never used while a fetched
 * or stored snapshot exists; it is here so a first-ever offline launch still has
 * figures to show.
 */
export const FALLBACK_RATES = {
  USD: 1,
  EUR: 0.92,
  GBP: 0.79,
  CAD: 1.36,
  AUD: 1.53,
  JPY: 149.5,
  CHF: 0.88,
  CNY: 7.24,
  INR: 83.12,
  PLN: 4.0
};

/** A positive, finite number, or null. Guards against a nonsense rate. */
export function usableRate(value) {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

/**
 * Frankfurter answers with a JSON array of `{ quote, rate }` rows rather than an
 * object keyed by currency, so it is folded into a lookup here.
 */
export function parseRates(payload) {
  const rows = Array.isArray(payload)
    ? payload
    : Object.entries(payload || {}).map(([quote, rate]) => ({ quote, rate }));
  const rates = {};
  for (const row of rows) {
    const rate = usableRate(row?.rate);
    if (row?.quote && rate !== null) rates[String(row.quote).toUpperCase()] = rate;
  }
  return rates;
}

/**
 * Build a snapshot from a response. Returns null when nothing usable came back,
 * so a malformed answer falls through to the stored or hand-written table rather
 * than replacing good rates with an empty object.
 */
export function buildSnapshot(payload, { base = 'USD', asOf = '', source = 'live' } = {}) {
  const rates = parseRates(payload);
  const baseCode = String(base).toUpperCase();
  rates[baseCode] = usableRate(rates[baseCode]) || 1;
  const quotes = Object.keys(rates).filter((code) => code !== baseCode);
  if (!quotes.length) return null;
  return { base: baseCode, rates, asOf, source, quotes, fetchedAt: Date.now() };
}

/** Normalise anything read back from storage into a usable snapshot, or null. */
export function normaliseSnapshot(value) {
  if (!value || typeof value !== 'object' || !value.rates) return null;
  const rates = parseRates(value.rates);
  const base = String(value.base || 'USD').toUpperCase();
  if (!Object.keys(rates).length) return null;
  rates[base] = usableRate(rates[base]) || 1;
  return {
    base,
    rates,
    asOf: String(value.asOf || ''),
    source: String(value.source || 'stored'),
    quotes: Object.keys(rates).filter((code) => code !== base),
    fetchedAt: Number(value.fetchedAt) || 0
  };
}

/** A snapshot older than `RATES_MAX_AGE_MS`, or with no timestamp, is due a refresh. */
export function isStale(snapshot, now = Date.now()) {
  const at = normaliseSnapshot(snapshot)?.fetchedAt || 0;
  if (!at) return true;
  return now - at > RATES_MAX_AGE_MS;
}

/** Which table to use: live, then stored, then the hand-written fallback. */
export function pickRates({ live, stored } = {}) {
  for (const candidate of [normaliseSnapshot(live), normaliseSnapshot(stored)]) {
    if (candidate && Object.keys(candidate.rates).length) return candidate;
  }
  return {
    base: 'USD',
    rates: { ...FALLBACK_RATES },
    asOf: '',
    source: 'fallback',
    quotes: Object.keys(FALLBACK_RATES),
    fetchedAt: 0
  };
}

/**
 * Fetch the latest rates. Every failure returns null rather than throwing: the
 * caller must never fail boot, and the app has to keep working offline.
 */
export async function fetchLiveRates({
  base = 'USD',
  quotes = [],
  fetchImpl = typeof fetch === 'function' ? fetch.bind(globalThis) : null,
  timeoutMs = 10_000
} = {}) {
  if (!fetchImpl) return null;
  const from = encodeURIComponent(String(base).toLowerCase());
  const query = quotes.length
    ? `?base=${from}&quotes=${quotes.map((code) => encodeURIComponent(String(code).toLowerCase())).join(',')}`
    : `?base=${from}`;
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetchImpl(`${RATE_ENDPOINT}${query}`, {
      headers: { Accept: 'application/json' },
      signal: controller?.signal
    });
    if (!response?.ok) return null;
    return buildSnapshot(await response.json(), { base, asOf: responseDate(response) });
  } catch {
    // Offline, CSP-blocked, provider rate limited, malformed JSON: all survivable,
    // so none of it propagates.
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** The provider dates its rows, which is a better "as of" than the clock. */
function responseDate(response) {
  const header = String(response?.headers?.get?.('date') || '');
  const parsed = header ? new Date(header) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : '';
}

/** Label for when the rates were last refreshed, for the status line. */
export function describeRates(snapshot) {
  const current = normaliseSnapshot(snapshot);
  if (!current || current.source === 'fallback') return { label: 'Estimated rates', tone: 'warn' };
  if (!current.asOf) return { label: 'Rates updated', tone: 'ok' };
  const when = new Date(current.asOf);
  const sameDay = !Number.isNaN(when.getTime()) && when.toDateString() === new Date().toDateString();
  return { label: sameDay ? 'Rates today' : `Rates ${when.toLocaleDateString()}`, tone: 'ok' };
}

/** Convert between currencies using a rate table. Pure, as it always was. */
export function convertWithRates(amount, from = 'USD', to = 'USD', table = FALLBACK_RATES) {
  const value = Number(amount);
  if (!Number.isFinite(value)) return 0;
  if (from === to) return value;
  const fromRate = usableRate(table?.[from]) || 1;
  const toRate = usableRate(table?.[to]) || 1;
  return (value / fromRate) * toRate;
}
