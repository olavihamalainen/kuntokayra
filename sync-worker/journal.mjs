import '../sync-core.js';

const Sync = globalThis.KuntokayraSync;
const pageSize = 8;

function json(payload, status = 200) {
  return Response.json(payload, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}

export async function readBody(request, maxBytes) {
  if (!request.body || Number(request.headers.get('Content-Length')) > maxBytes) throw Error('Invalid size');
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw Error('Invalid size');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body));
}

async function pull(db, account, after) {
  const [head, page] = await db.batch([
    db.prepare('SELECT revision FROM journal_sync_commits WHERE account = ? ORDER BY revision DESC LIMIT 1').bind(account),
    db.prepare('SELECT revision, changes FROM journal_sync_commits WHERE account = ? AND revision > ? ORDER BY revision LIMIT ?').bind(account, after, pageSize + 1),
  ]);
  if (after > (head.results[0]?.revision ?? 0)) return json({ error: 'HISTORY_CHANGED' }, 409);
  return json({ account, commits: page.results.slice(0, pageSize).map(row => ({ revision: row.revision, changes: JSON.parse(row.changes) })), more: page.results.length > pageSize });
}

async function push(db, account, after, changes) {
  // One statement compares the account's latest revision and appends a batch.
  // Deleted records are tombstones. Earlier values remain in the journal.
  const row = await db.prepare(`
    INSERT INTO journal_sync_commits (account, changes)
    SELECT ?, ? WHERE ? = COALESCE((
      SELECT revision FROM journal_sync_commits WHERE account = ? ORDER BY revision DESC LIMIT 1
    ), 0)
    RETURNING revision
  `).bind(account, JSON.stringify(changes), after, account).first();
  if (!row) return json({ error: 'RETRY_WITH_LATEST' }, 409);
  return json({ account, revision: row.revision });
}

export async function syncJournal(request, db, visitor) {
  if (request.method !== 'POST') return json({ error: 'METHOD' }, 405);
  if (!Sync.validAccount(visitor)) return json({ error: 'SIGN_IN' }, 401);
  if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return json({ error: 'CONTENT_TYPE' }, 415);

  let body, changes;
  try {
    body = await readBody(request, Sync.maxBatchBytes);
    if (!body || !Sync.validCursor(body.after) || !['pull', 'push'].includes(body.action)) return json({ error: 'INPUT' }, 400);
    if (body.action === 'push') changes = Sync.normalizeChanges(body.changes);
  } catch {
    return json({ error: 'INPUT' }, 400);
  }

  const account = await Sync.hash(`kuntokayra-journal\n${visitor}`);
  if ((body.action === 'push' || body.account !== undefined) && body.account !== account) return json({ error: 'ACCOUNT_CHANGED' }, 403);
  return body.action === 'pull' ? pull(db, account, body.after) : push(db, account, body.after, changes);
}
