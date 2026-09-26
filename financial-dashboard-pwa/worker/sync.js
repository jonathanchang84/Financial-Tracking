import {
  AppError,
  STORES,
  cleanSyncData,
  json,
  readJson,
  requireUser
} from './support.js';

const MAX_PUSH_ROWS = 100;
const MAX_PULL_ROWS = 200;

export function normalizeTimestamp(value, label = 'updated_at') {
  const timestamp = String(value || '');
  if (!timestamp || timestamp.length > 64 || !Number.isFinite(Date.parse(timestamp))) {
    throw new AppError(`${label} must be a valid timestamp.`, 400, 'invalid_record');
  }
  return new Date(timestamp).toISOString();
}

function normalizedRow(store, record) {
  if (!STORES.has(store)) throw new AppError('That sync store is not supported.', 400, 'invalid_store');
  if (!record || typeof record !== 'object' || Array.isArray(record)) throw new AppError('Each sync row must be an object.', 400, 'invalid_record');
  const id = String(record.id || '').trim();
  if (!id || id.length > 200) throw new AppError('Each sync row needs a valid id.', 400, 'invalid_record');
  const data = cleanSyncData(record.data && typeof record.data === 'object' && !Array.isArray(record.data) ? record.data : record);
  return {
    store,
    id,
    updatedAt: normalizeTimestamp(record.updated_at),
    deleted: record.deleted === true,
    data
  };
}

async function pushRows(request, env) {
  const { user } = await requireUser(request, env);
  const body = await readJson(request);
  if (!Array.isArray(body.rows) || body.rows.length > MAX_PUSH_ROWS) {
    throw new AppError(`Send at most ${MAX_PUSH_ROWS} sync rows per request.`, 400, 'invalid_batch');
  }
  const serverTime = new Date().toISOString();
  const results = [];
  for (const item of body.rows) {
    const row = normalizedRow(String(item?.store || ''), item);
    const before = await env.DB.prepare(
      'SELECT data_json, updated_at, deleted FROM finance_records WHERE owner_id = ? AND store = ? AND record_id = ?'
    ).bind(user.id, row.store, row.id).first();
    if (before && String(before.updated_at) >= row.updatedAt) {
      // The server already holds a newer or equally new version. Report it back
      // so the client can adopt the server row instead of retrying forever.
      let data = {};
      try { data = JSON.parse(before.data_json || '{}'); } catch { data = {}; }
      results.push({
        store: row.store,
        id: row.id,
        accepted: true,
        superseded: true,
        current: {
          store: row.store,
          id: row.id,
          data,
          updated_at: before.updated_at,
          deleted: Number(before.deleted) === 1
        }
      });
      continue;
    }
    const result = await env.DB.prepare(
      `INSERT INTO finance_records
         (owner_id, store, record_id, data_json, updated_at, deleted, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(owner_id, store, record_id) DO UPDATE SET
         data_json = excluded.data_json,
         updated_at = excluded.updated_at,
         deleted = excluded.deleted
       WHERE excluded.updated_at > finance_records.updated_at`
    ).bind(user.id, row.store, row.id, JSON.stringify(row.data), row.updatedAt, row.deleted ? 1 : 0, serverTime).run();
    results.push({ store: row.store, id: row.id, accepted: Number(result.meta?.changes || 0) > 0 });
  }
  return json({ results, serverTime, accepted: results.filter((row) => row.accepted).length, ignored: results.filter((row) => !row.accepted).length });
}

async function pullRows(request, env, url) {
  const { user } = await requireUser(request, env);
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit')) || MAX_PULL_ROWS));
  const afterRaw = String(url.searchParams.get('after') || '').trim();
  const afterStore = String(url.searchParams.get('afterStore') || '').trim();
  const afterId = String(url.searchParams.get('afterId') || '').trim();
  const hasCursor = Boolean(afterRaw);
  if (hasCursor) {
    if (!STORES.has(afterStore) || !afterId || afterId.length > 200) {
      throw new AppError('The sync cursor is invalid — pull again from scratch.', 400, 'invalid_cursor');
    }
    if (!Number.isFinite(Date.parse(afterRaw))) {
      throw new AppError('The sync cursor timestamp is invalid.', 400, 'invalid_cursor');
    }
  }
  const until = normalizeTimestamp(url.searchParams.get('until') || new Date().toISOString(), 'until');
  const where = hasCursor
    ? `owner_id = ? AND (updated_at > ? OR (updated_at = ? AND (store > ? OR (store = ? AND record_id > ?)))) AND updated_at <= ?`
    : 'owner_id = ? AND updated_at <= ?';
  const binds = hasCursor
    ? [user.id, afterRaw, afterRaw, afterStore, afterStore, afterId, until]
    : [user.id, until];
  const result = await env.DB.prepare(
    `SELECT store, record_id, data_json, updated_at, deleted
       FROM finance_records
      WHERE ${where}
      ORDER BY updated_at ASC, store ASC, record_id ASC
      LIMIT ?`
  ).bind(...binds, limit).all();
  const rows = (result.results || []).map((row) => {
    let data = {};
    try { data = JSON.parse(row.data_json || '{}'); } catch { data = {}; }
    return { store: row.store, id: row.record_id, data, updated_at: row.updated_at, deleted: Number(row.deleted) === 1 };
  });
  const last = rows[rows.length - 1];
  return json({
    rows,
    hasMore: rows.length === limit,
    nextCursor: last ? { updatedAt: last.updated_at, store: last.store, id: last.id } : null,
    serverTime: until
  });
}

export async function handleSync(request, env, path) {
  if (path === 'push' && request.method === 'POST') return pushRows(request, env);
  if (path === 'pull' && request.method === 'GET') return pullRows(request, env, new URL(request.url));
  throw new AppError('Sync route not found.', 404, 'not_found');
}
