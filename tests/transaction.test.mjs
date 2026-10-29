import test from 'node:test';
import assert from 'node:assert/strict';

// No real connection: exercise transaction lifecycle independently of credentials.
process.env.DATABASE_URL = 'postgresql://test:test@127.0.0.1:1/test';
const { pool, withTransaction } = await import('../db.mjs');

test('transaction commits and releases the same connection', async () => {
  const calls = [];
  const client = { query: async sql => { calls.push(sql); }, release: () => calls.push('RELEASE') };
  pool.connect = async () => client;
  assert.equal(await withTransaction(async connection => { assert.equal(connection, client); await connection.query('WORK'); return 42; }), 42);
  assert.deepEqual(calls, ['BEGIN', 'WORK', 'COMMIT', 'RELEASE']);
});
test('failed work rolls back and releases connection', async () => {
  const calls = [];
  pool.connect = async () => ({ query: async sql => { calls.push(sql); }, release: () => calls.push('RELEASE') });
  await assert.rejects(withTransaction(async client => { await client.query('WORK'); throw new Error('insert failed'); }), /insert failed/);
  assert.deepEqual(calls, ['BEGIN', 'WORK', 'ROLLBACK', 'RELEASE']);
});
test('failed commit rolls back instead of returning success', async () => {
  const calls = [];
  pool.connect = async () => ({
    query: async sql => { calls.push(sql); if (sql === 'COMMIT') throw new Error('commit failed'); },
    release: () => calls.push('RELEASE')
  });
  await assert.rejects(withTransaction(async () => 42), /commit failed/);
  assert.deepEqual(calls, ['BEGIN', 'COMMIT', 'ROLLBACK', 'RELEASE']);
});
