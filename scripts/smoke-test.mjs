// Explicitly opt in only against a disposable preproduction database.
// Usage: RUN_PREPRODUCTION_SMOKE=true node --env-file-if-exists=.env scripts/smoke-test.mjs
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

async function main() {
if (process.env.RUN_PREPRODUCTION_SMOKE !== 'true') {
  console.error('Smoke test refused: set RUN_PREPRODUCTION_SMOKE=true for preproduction only.');
  process.exit(1);
}
if (!process.env.DATABASE_URL || !process.env.OTP_SECRET) {
  console.error('Smoke test requires DATABASE_URL and OTP_SECRET; no values were printed.');
  process.exit(1);
}

const port = Number(process.env.SMOKE_PORT || 4174);
if (!Number.isInteger(port) || port < 1024 || port > 65535 || port === Number(process.env.PORT)) {
  console.error('SMOKE_PORT must be a separate unprivileged test port.');
  process.exit(1);
}
let query, closeDatabase;
try {
  ({ query, closeDatabase } = await import('../db.mjs'));
} catch {
  console.error('Smoke test database configuration is invalid; details suppressed to protect credentials.');
  process.exit(1);
}
const root = fileURLToPath(new URL('../', import.meta.url));
const base = `http://127.0.0.1:${port}`;
const run = randomUUID();
const users = [randomUUID(), randomUUID()];
const tokens = [randomUUID(), randomUUID()];
const hashes = tokens.map(token => createHash('sha256').update(token).digest('hex'));
const products = [];
let child;
let childStopped;
let stage = 'initialization';
let interrupted = false;
const onSignal = () => { interrupted = true; child?.kill('SIGTERM'); };
process.on('SIGINT', onSignal);
process.on('SIGTERM', onSignal);

async function request(route, { user, body } = {}) {
  if (interrupted) throw new Error('Interrupted');
  const response = await fetch(base + route, {
    method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json', ...(user === undefined ? {} : { authorization: `Bearer ${tokens[user]}` }) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(3000)
  });
  return { status: response.status, data: await response.json() };
}
const order = (id, qty, user = 0) => request('/api/orders', {
  user, body: { items: [{ id, qty }], payment: 'À la livraison' }
});
async function stock(id) {
  return Number((await query('SELECT stock FROM products WHERE id = $1', [id])).rows[0].stock);
}
async function orderCount() {
  return Number((await query('SELECT COUNT(*) AS count FROM orders WHERE user_id = ANY($1::uuid[])', [users])).rows[0].count);
}

try {
  stage = 'test port availability';
  // Refuse an occupied port rather than accidentally testing another server.
  const probe = createServer();
  await new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(port, '0.0.0.0', () => probe.close(resolve));
  });

  stage = 'temporary database fixtures';
  for (let i = 0; i < users.length; i++) {
    await query('INSERT INTO users (id, phone, name, roles) VALUES ($1, $2, $3, $4::text[])',
      [users[i], `smoke-${users[i].replaceAll('-', '').slice(0, 19)}`, `Smoke ${run}`, ['buyer']]);
    await query("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, NOW() + INTERVAL '10 minutes')", [hashes[i], users[i]]);
  }
  for (const quantity of [3, 2]) {
    const result = await query(
      `INSERT INTO products (name, price_cdf, area, delivery, seller, category, stock, tag, owner_user_id)
       VALUES ($1, 20000, 'Smoke test', 'Test only', 'Smoke test', 'Test', $2, 'smoke-test', $3) RETURNING id`,
      [`Smoke ${run} stock ${quantity}`, quantity, users[0]]
    );
    products.push(Number(result.rows[0].id));
  }

  stage = 'server startup';
  child = spawn(process.execPath, ['server.mjs'], {
    cwd: root,
    env: { ...process.env, PORT: String(port), NODE_ENV: 'production', DEMO_MODE: 'false' },
    stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true
  });
  // Discard application diagnostics: database failures must never print credentials here.
  child.stderr.resume();
  let stopped = false;
  childStopped = new Promise(resolve => {
    child.once('error', () => { stopped = true; resolve(); });
    child.once('exit', () => { stopped = true; resolve(); });
  });
  const deadline = Date.now() + 30000;
  let healthy = false;
  while (Date.now() < deadline && !stopped && !interrupted) {
    try {
      const health = await request('/api/health');
      healthy = health.status === 200 && health.data.ok === true && health.data.mode === 'production';
      if (healthy) break;
    } catch { /* startup can take a moment */ }
    await delay(250);
  }
  assert.ok(healthy);

  stage = 'catalog and unauthorized access';
  const catalog = await request('/api/products');
  assert.equal(catalog.status, 200);
  assert.ok(products.every(id => catalog.data.products.some(product => product.id === id)));
  assert.equal((await request('/api/orders')).status, 401);
  assert.equal((await request('/api/orders', { body: { items: [{ id: products[0], qty: 1 }], payment: 'À la livraison' } })).status, 401);
  assert.equal(await stock(products[0]), 3);
  assert.equal(await orderCount(), 0);

  stage = 'quantity, total and stock';
  const created = await order(products[0], 2);
  assert.equal(created.status, 201);
  assert.equal(created.data.order.total, 50000);
  assert.equal(created.data.order.items[0].qty, 2);
  assert.equal(created.data.order.items[0].price, 20000);
  assert.equal(await stock(products[0]), 1);
  const saved = await query('SELECT total_cdf, items FROM orders WHERE order_number = $1 AND user_id = $2', [created.data.order.id, users[0]]);
  assert.equal(saved.rowCount, 1);
  assert.equal(Number(saved.rows[0].total_cdf), 50000);
  assert.equal(saved.rows[0].items[0].qty, 2);

  stage = 'insufficient stock rollback';
  assert.equal((await order(products[0], 2)).status, 409);
  assert.equal(await stock(products[0]), 1);
  assert.equal(await orderCount(), 1);

  stage = 'persistent history and buyer isolation';
  const history = await request('/api/orders', { user: 0 });
  assert.equal(history.status, 200);
  assert.equal(history.data.orders.length, 1);
  assert.equal(history.data.orders[0].id, created.data.order.id);
  const other = await request('/api/orders', { user: 1 });
  assert.equal(other.status, 200);
  assert.deepEqual(other.data.orders, []);

  stage = 'concurrent purchases cannot oversell';
  const concurrent = await Promise.all([order(products[1], 2, 0), order(products[1], 2, 1)]);
  assert.deepEqual(concurrent.map(result => result.status).sort(), [201, 409]);
  assert.equal(await stock(products[1]), 0);
  assert.equal(await orderCount(), 2);
  console.log('Smoke test passed: health, catalog, access, quantities, rollback, history, isolation and concurrent stock.');
} catch {
  console.error(`Smoke test failed during ${stage}. Error details suppressed to protect credentials.`);
  process.exitCode = 1;
} finally {
  if (child && child.exitCode === null && child.signalCode === null) {
    child.kill('SIGTERM');
    await Promise.race([childStopped, delay(3000)]);
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await Promise.race([childStopped, delay(1000)]);
    }
  }
  try {
    // Only this run's randomized fixture identities and returned product IDs are removed.
    await query('DELETE FROM orders WHERE user_id = ANY($1::uuid[])', [users]);
    await query('DELETE FROM sessions WHERE token_hash = ANY($1::text[])', [hashes]);
    await query('DELETE FROM products WHERE id = ANY($1::bigint[])', [products]);
    await query('DELETE FROM users WHERE id = ANY($1::uuid[])', [users]);
    console.log('Smoke test fixtures removed.');
  } catch {
    console.error('Smoke test cleanup failed; inspect rows tagged smoke-test before rerunning.');
    process.exitCode = 1;
  }
  try { await closeDatabase(); } catch {
    console.error('Smoke test database shutdown failed; details suppressed.');
    process.exitCode = 1;
  }
  process.off('SIGINT', onSignal);
  process.off('SIGTERM', onSignal);
  if (interrupted) process.exitCode = 1;
}
}

// Node discovers *-test.mjs automatically. Never touch a real database during unit tests.
if (process.env.NODE_TEST_CONTEXT) {
  const { test } = await import('node:test');
  await test('preproduction database smoke test', { skip: 'Run standalone with RUN_PREPRODUCTION_SMOKE=true.' }, () => {});
} else {
  await main();
}
