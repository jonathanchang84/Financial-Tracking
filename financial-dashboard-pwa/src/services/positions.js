/**
 * Position / holding / pension business rules.
 *
 * Mirrors the native app's use cases and the historic browser modal flow:
 *  - adding an account, holding or pot also opens its first dated snapshot
 *  - updating a value closes the open SCD Type 2 version and appends a new one
 *  - a series name + currency pair is the unit that keeps series separate, so
 *    two accounts called "Savings" in different currencies never merge
 */

import { getAll } from './indexedDB.js';
import { newId } from './recordHelpers.js';
import { dayKey } from './dates.js';
import { num, currencyOf, seriesNameOf } from './runway.js';
import { planValuation, versionsForSeries, currentVersions, seriesKey } from './scd2.js';
import { ENTITY_STORES } from '../stores/finance.js';

/** Entity registry shared by the screens, the modal and the sync engine. */
export const POSITION_ENTITIES = {
  netWorth: {
    store: 'netWorthEntries',
    history: 'netWorthHistory',
    label: 'Account',
    plural: 'Accounts',
    seriesLabel: 'Account name',
    valueLabel: 'Current value',
    kind: 'value'
  },
  holdings: {
    store: 'holdings',
    history: 'portfolioHistory',
    label: 'Holding',
    plural: 'Investments',
    seriesLabel: 'Series name',
    valueLabel: 'Unit price',
    kind: 'holding'
  },
  pensions: {
    store: 'pensions',
    history: 'pensionHistory',
    label: 'Pension pot',
    plural: 'Pensions',
    seriesLabel: 'Pot name',
    valueLabel: 'Current value',
    kind: 'value'
  }
};

export function entityConfig(key) {
  const config = POSITION_ENTITIES[key];
  if (!config) throw new Error(`Unknown position entity: ${key}`);
  return config;
}

/** Value of one dated snapshot for an entity (holdings snapshots track market value). */
export function snapshotValue(entityKey, { value, price, quantity }) {
  if (entityKey === 'holdings') return num(quantity) * num(price ?? value);
  return num(value);
}

/** Series names already in use, optionally limited to one currency. */
export async function seriesOptions(entityKey, currency = null) {
  const config = entityConfig(entityKey);
  const [historyRows, entryRows] = await Promise.all([getAll(config.history), getAll(config.store)]);
  const names = new Set();
  historyRows.forEach((row) => {
    if (currency && currencyOf(row) !== currency) return;
    names.add(seriesNameOf(row));
  });
  entryRows.forEach((row) => {
    if (currency && currencyOf(row) !== currency) return;
    names.add(seriesNameOf(row));
  });
  return Array.from(names).sort((a, b) => a.localeCompare(b));
}

/** Every version chain for one entity, newest first (drives the History list). */
export async function historyFor(entityKey) {
  const config = entityConfig(entityKey);
  const rows = await getAll(config.history);
  return rows.sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

/** Apply an SCD Type 2 plan: close superseded versions, then insert the new one. */
async function applyPlan(config, plan) {
  const historyStore = ENTITY_STORES[config.history];
  for (const closed of plan.close) {
    await historyStore.patch(closed.id, { validTo: closed.validTo, currentFlag: closed.currentFlag });
  }
  const version = await historyStore.save(plan.insert);
  return version;
}

/**
 * Create a current entry and open its first snapshot version.
 * `logicalId` of every version equals the entry id, so a chain is traceable.
 */
export async function addPosition(entityKey, values = {}) {
  const config = entityConfig(entityKey);
  const date = dayKey(values.date) || dayKey(new Date());
  const currency = values.currencyCode || values.currency || 'USD';

  const base = {
    id: newId(),
    name: String(values.name || '').trim(),
    currencyCode: currency,
    validFrom: date,
    validTo: null,
    currentFlag: true
  };

  if (!base.name) throw new Error(`${config.label} name is required`);

  let entry = base;
  if (config.kind === 'holding') {
    entry = {
      ...base,
      symbol: String(values.symbol || '').trim(),
      type: String(values.type || '').trim() || 'Fund',
      quantity: num(values.quantity),
      price: num(values.price)
    };
  } else if (entityKey === 'netWorth') {
    entry = {
      ...base,
      institution: String(values.institution || '').trim(),
      kind: String(values.kind || 'Asset'),
      value: num(values.value)
    };
  } else {
    entry = {
      ...base,
      provider: String(values.provider || '').trim(),
      value: num(values.value)
    };
  }

  const saved = await ENTITY_STORES[config.store].save(entry);

  const historyRows = await getAll(config.history);
  const plan = planValuation({
    rows: historyRows,
    id: newId(),
    series: seriesNameOf(saved),
    date,
    value: snapshotValue(entityKey, { value: entry.value, price: entry.price, quantity: entry.quantity }),
    currency,
    logicalId: saved.id
  });
  const version = await applyPlan(config, plan);

  return { entry: saved, version, plan };
}

/** Edit a current entry's descriptive fields (no snapshot is created). */
export async function updatePosition(entityKey, record, values = {}) {
  const config = entityConfig(entityKey);
  const name = String(values.name ?? seriesNameOf(record)).trim();
  if (!name) throw new Error(`${config.label} name is required`);
  const currencyCode = values.currencyCode || values.currency || currencyOf(record);

  const changes = { name, currencyCode };
  if (config.kind === 'holding') {
    Object.assign(changes, {
      symbol: String(values.symbol ?? record.symbol ?? '').trim(),
      type: String(values.type ?? record.type ?? '').trim() || 'Fund',
      quantity: num(values.quantity ?? record.quantity),
      price: num(values.price ?? record.price)
    });
  } else if (entityKey === 'netWorth') {
    Object.assign(changes, {
      institution: String(values.institution ?? record.institution ?? '').trim(),
      kind: values.kind || record.kind || 'Asset',
      value: num(values.value ?? record.value)
    });
  } else {
    Object.assign(changes, {
      provider: String(values.provider ?? record.provider ?? '').trim(),
      value: num(values.value ?? record.value)
    });
  }

  return ENTITY_STORES[config.store].patch(record.id, changes);
}

/**
 * Update a current entry's value: patch the entry in place (stable id = logical
 * id) and append a dated SCD Type 2 version instead of overwriting history.
 */
export async function updateCurrentValue(entityKey, record, { date, value, price, currency } = {}) {
  const config = entityConfig(entityKey);
  const effectiveDate = dayKey(date) || dayKey(new Date());
  const currencyCode = currency || currencyOf(record);
  const amount = num(value ?? price);

  const entryChanges =
    config.kind === 'holding'
      ? { price: amount, currencyCode, validFrom: effectiveDate, validTo: null, currentFlag: true }
      : { value: amount, currencyCode, validFrom: effectiveDate, validTo: null, currentFlag: true };

  const entry = await ENTITY_STORES[config.store].patch(record.id, entryChanges);

  const historyRows = await getAll(config.history);
  const plan = planValuation({
    rows: historyRows,
    id: newId(),
    series: seriesNameOf(record),
    date: effectiveDate,
    value: snapshotValue(entityKey, {
      value: amount,
      price: amount,
      quantity: record.quantity
    }),
    currency: currencyCode,
    logicalId: record.id
  });
  const version = await applyPlan(config, plan);

  return { entry, version, plan, snapshotValue: plan.insert.value };
}

/**
 * Append a dated snapshot for a series without touching the current entry
 * (the historic "Save snapshot" forms on the Position, Investments and Pensions
 * screens). Choosing an existing name attaches to that series' version chain.
 */
export async function recordSnapshot(entityKey, { series, date, value, currency = 'USD', logicalId = null } = {}) {
  const config = entityConfig(entityKey);
  const name = String(series || '').trim();
  if (!name) throw new Error(`${config.seriesLabel} is required`);

  const effectiveDate = dayKey(date) || dayKey(new Date());
  const historyRows = await getAll(config.history);
  const plan = planValuation({
    rows: historyRows,
    id: newId(),
    series: name,
    date: effectiveDate,
    value: num(value),
    currency,
    logicalId
  });
  const version = await applyPlan(config, plan);
  return { version, plan };
}

/** Edit one existing snapshot row (series, date, value, currency). */
export async function saveVersion(entityKey, record, changes = {}) {
  const config = entityConfig(entityKey);
  const next = {
    ...record,
    series: String(changes.series ?? record.series ?? seriesNameOf(record)).trim(),
    date: dayKey(changes.date ?? record.date),
    value: num(changes.value ?? record.value),
    currencyCode: changes.currency ?? record.currencyCode ?? record.currency ?? 'USD'
  };
  const version = await ENTITY_STORES[config.history].save(next);
  return version;
}

/**
 * Remove a current entry. Its snapshot chain stays in the history store as an
 * audit trail, with the open version closed on the removal date.
 */
export async function removePosition(entityKey, record) {
  const config = entityConfig(entityKey);
  const historyRows = await getAll(config.history);
  const chain = versionsForSeries(historyRows, seriesNameOf(record), currencyOf(record));
  const open = chain.filter((row) => row.validTo === null || row.validTo === undefined || row.currentFlag !== false).at(-1);
  const removalDate = dayKey(new Date());

  if (open && open.currentFlag !== false && !open.validTo) {
    const closedOn = open.validFrom && open.validFrom > removalDate ? open.validFrom : removalDate;
    await ENTITY_STORES[config.history].patch(open.id, { validTo: closedOn, currentFlag: false });
  }

  return ENTITY_STORES[config.store].remove(record.id);
}

/** Delete one snapshot version, reopening the previous version when needed. */
export async function removeVersion(entityKey, record) {
  const config = entityConfig(entityKey);
  const historyRows = await getAll(config.history);
  const chain = versionsForSeries(historyRows, seriesNameOf(record), currencyOf(record));
  const wasOpen = !record.validTo && record.currentFlag !== false;
  const index = chain.findIndex((row) => row.id === record.id);
  const previous = index > 0 ? chain[index - 1] : null;

  await ENTITY_STORES[config.history].remove(record.id);

  if (wasOpen && previous) {
    await ENTITY_STORES[config.history].patch(previous.id, { validTo: null, currentFlag: true });
  }
  return true;
}

/** One row per open series, newest first — the "current values" list. */
export async function currentSeries(entityKey, currency = null) {
  const config = entityConfig(entityKey);
  const rows = await getAll(config.history);
  return currentVersions(rows)
    .filter((row) => (currency ? currencyOf(row) === currency : true))
    .sort((a, b) => seriesNameOf(a).localeCompare(seriesNameOf(b)));
}

/** Currencies actually used by an entity (drives the per-screen currency select). */
export async function currenciesUsed(entityKey) {
  const config = entityConfig(entityKey);
  const [historyRows, entryRows] = await Promise.all([getAll(config.history), getAll(config.store)]);
  const codes = new Set();
  [...historyRows, ...entryRows].forEach((row) => codes.add(currencyOf(row)));
  return Array.from(codes).sort();
}

export { seriesKey, versionsForSeries, currentVersions };

