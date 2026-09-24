/**
 * Thin command layer for the simple entities (bills, Spend Items, budgets,
 * transactions). Anything with SCD Type 2 history lives in `positions.js`.
 *
 * Writes are IndexedDB-first: the promise resolves as soon as the local write
 * is durable, while the cloud upsert continues in the background.
 */

import { ENTITY_STORES } from '../stores/finance.js';
import { newId } from './recordHelpers.js';
import { showToast, errorToast } from '../stores/ui.js';

export function storeFor(storeName) {
  const store = ENTITY_STORES[storeName];
  if (!store) throw new Error(`Unknown store: ${storeName}`);
  return store;
}

export { newId };

/**
 * Save a record locally and queue the cloud upsert.
 * @param {string} storeName IndexedDB store name.
 * @param {object} record Record to write (an `id` is generated when missing).
 */
export async function saveRecord(storeName, record, { silent = false, message = 'Saved locally' } = {}) {
  try {
    const saved = await storeFor(storeName).save({ ...record, id: record.id || newId() });
    if (!silent) showToast(message);
    return saved;
  } catch (error) {
    if (!silent) errorToast(`Could not save: ${error.message}`);
    throw error;
  }
}

/** Soft-delete a record locally and queue the cloud delete. */
export async function deleteRecord(storeName, id, { silent = false, message = 'Record deleted' } = {}) {
  try {
    const result = await storeFor(storeName).remove(id);
    if (!silent) showToast(message);
    return result;
  } catch (error) {
    if (!silent) errorToast(`Could not delete: ${error.message}`);
    throw error;
  }
}

/** Confirm then delete — the historic click-to-delete behaviour. */
export async function confirmDelete(storeName, id, question = 'Delete this local record?') {
  if (typeof window !== 'undefined' && !window.confirm(question)) return false;
  await deleteRecord(storeName, id);
  return true;
}

/** Validate + save a named, dated Spend Item (historic commitmentModal rules). */
export async function saveCommitment({ id, name, date, amount, currency }) {
  const trimmed = String(name || '').trim();
  if (!trimmed) throw new Error('Give the spend item a name');
  if (!(Number(amount) > 0)) throw new Error('Enter a valid amount');
  return saveRecord(
    'commitments',
    { id: id || newId(), name: trimmed, date, amount: Number(amount), currencyCode: currency },
    { message: id ? 'Spend item updated' : 'Spend item added' }
  );
}

/** Validate + save a recurring bill (historic billModal rules). */
export async function saveBill({ id, name, category, amount, dueDay, currency }) {
  const trimmed = String(name || '').trim();
  if (!trimmed) throw new Error('Give the bill a name');
  if (!(Number(amount) > 0)) throw new Error('Enter a valid amount');
  const due = Math.min(31, Math.max(1, Math.trunc(Number(dueDay)) || 1));
  return saveRecord(
    'bills',
    {
      id: id || newId(),
      name: trimmed,
      category: String(category || '').trim() || 'Bill',
      amount: Number(amount),
      dueDay: due,
      currencyCode: currency
    },
    { message: id ? 'Bill updated' : 'Bill added' }
  );
}

/** Budget rules: a monthly limit plus how much is already spent. */
export async function saveBudget({ id, name, limit, spent, currency }) {
  const trimmed = String(name || '').trim();
  if (!trimmed) throw new Error('Give the budget a name');
  if (!(Number(limit) > 0)) throw new Error('Enter a monthly limit greater than zero');
  return saveRecord(
    'budgets',
    {
      id: id || newId(),
      name: trimmed,
      limit: Number(limit),
      spent: Number(spent) || 0,
      currency: currency || 'USD',
      currencyCode: currency || 'USD'
    },
    { message: id ? 'Budget updated' : 'Budget saved' }
  );
}

/** Record a daily spend entry (historic `addSpendModal`). */
export async function saveSpend({ id, name, date, amount, category, currency }) {
  const trimmed = String(name || '').trim();
  if (!trimmed) throw new Error('Give the spend a name such as Evening groceries');
  return saveRecord(
    'transactions',
    {
      id: id || newId(),
      type: 'expense',
      name: trimmed,
      date,
      amount: Number(amount) || 0,
      category: String(category || '').trim() || 'Spend',
      currency: currency || 'USD',
      currencyCode: currency || 'USD'
    },
    { message: 'Daily spend saved' }
  );
}
