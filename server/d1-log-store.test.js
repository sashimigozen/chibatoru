const { test } = require('node:test');
const assert = require('node:assert/strict');
let DatabaseSync;
try { ({ DatabaseSync } = require('node:sqlite')); } catch { /* Node 20 has no built-in SQLite; queue tests still run. */ }
const { createD1LogStore, createArchiveQueue } = require('./d1-log-store.js');
const env = { CHIBATORU_D1_ACCOUNT_ID: 'a'.repeat(32), CHIBATORU_D1_DATABASE_ID: 'b'.repeat(8) + '-bbbb-bbbb-bbbb-' + 'b'.repeat(12), CHIBATORU_D1_API_TOKEN: 'private-test-token' };
function fakeD1() {
  const db = new DatabaseSync(':memory:');
  let failing = false;
  const request = async (url, options) => {
    assert.ok(url.startsWith('https://api.cloudflare.com/client/v4/accounts/'));
    assert.equal(options.headers.authorization, 'Bearer private-test-token');
    if (failing) return { ok: false, status: 429, json: async () => ({ success: false, errors: [{ message: 'private-test-token' }] }) };
    const body = JSON.parse(options.body);
    const result = (body.batch || [body]).map(({ sql, params = [] }) => {
      const query = db.prepare(sql);
      return { success: true, results: query.columns().length ? query.all(...params) : (query.run(...params), []) };
    });
    return { ok: true, status: 200, json: async () => ({ success: true, result }) };
  };
  return { store: createD1LogStore(env, request), db, fail(value) { failing = value; } };
}
test('D1 compression, chunking, exact restore, upsert and pagination', { skip: !DatabaseSync }, async () => {
  const d = fakeD1();
  try {
    const crypto = require('node:crypto');
    const log = { gameId: 'g2', final: true, trace: { secret: crypto.randomBytes(220000).toString('base64') } };
    await d.store.put(log);
    assert.ok(d.db.prepare('SELECT COUNT(*) AS n FROM battle_log_parts').get().n > 1);
    assert.deepEqual(await d.store.get('g2'), log);
    await d.store.put({ ...log, final: false, trace: {} });
    assert.equal((await d.store.get('g2')).final, false);
    assert.equal(d.db.prepare('SELECT COUNT(*) AS n FROM battle_log_manifest').get().n, 1);
    await d.store.put({ gameId: 'g1' });
    assert.equal((await d.store.list('', 1)).nextCursor, 'g2');
    assert.deepEqual((await d.store.list('g2', 1)).logs.map(log => log.gameId), ['g1']);
  } finally { d.db.close(); }
});
test('free quota/API failure never leaks tokens and does not replace the last saved game', { skip: !DatabaseSync }, async () => {
  const d = fakeD1();
  try {
    await d.store.put({ gameId: 'g', trace: { n: 1 } });
    d.fail(true);
    await assert.rejects(d.store.put({ gameId: 'g', trace: { n: 2 } }), error => !error.message.includes(env.CHIBATORU_D1_API_TOKEN));
    d.fail(false);
    assert.equal((await d.store.get('g')).trace.n, 1);
  } finally { d.db.close(); }
});
test('archive queue excludes CPU logs, retries failures, and coalesces repeated game updates', async () => {
  const saved = []; let failing = true;
  const q = createArchiveQueue({ put: async log => { if (failing) throw Error('test'); saved.push(log); } }, { intervalMs: 60000, finalDelayMs: 60000 });
  try {
    q.enqueue({ gameId: 'cpu', source: 'solo', serverVerifiedHumanMatch: false });
    q.enqueue({ gameId: 'human', source: 'online-human-v1', serverVerifiedHumanMatch: true, n: 1 });
    await q.flush(); assert.equal(q.status.pending, 1); assert.ok(q.status.error);
    q.enqueue({ gameId: 'human', source: 'online-human-v1', serverVerifiedHumanMatch: true, n: 2, final: true });
    failing = false; await q.flush();
    assert.deepEqual(saved.map(log => [log.gameId, log.n]), [['human', 2]]);
    assert.equal(q.status.pending, 0); assert.equal(q.status.error, '');
  } finally { q.close(); }
});
test('D1 is disabled without credentials; malformed IDs cannot change the API destination', () => {
  assert.equal(createD1LogStore({}), null);
  assert.throws(() => createD1LogStore({ ...env, CHIBATORU_D1_ACCOUNT_ID: '../example' }));
});
