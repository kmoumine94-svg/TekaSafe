import test from 'node:test';
import assert from 'node:assert/strict';
import { createOrder, normalizeCart, OrderError } from '../orders.mjs';

function database(rows, failInsert = false) {
  const writes = [];
  return {
    writes,
    transaction: async operation => operation({ query: async (sql, values) => {
      if (sql.startsWith('SELECT')) return { rows };
      writes.push({ sql, values });
      if (sql.includes('INSERT INTO orders')) {
        if (failInsert) throw new Error('Database unavailable');
        return { rows: [{ order_number: values[0], items: JSON.parse(values[2]), total_cdf: values[3], status: values[5] }] };
      }
      return { rows: [] };
    } })
  };
}
const product = { id: '7', name: 'Article', price_cdf: '25000', stock: 5, vehicle: false };
const request = items => ({ userId: 'buyer', payment: 'À la livraison', items });

test('two units use server price and include delivery once', async () => {
  const db = database([product]);
  const result = await createOrder(request([{ id: 7, qty: 2, price: 1 }]), db.transaction);
  assert.equal(result.total_cdf, 60000);
  assert.deepEqual(result.items, [{ id: 7, name: 'Article', price: 25000, qty: 2 }]);
  assert.deepEqual(db.writes[0].values, [2, 7]);
  assert.ok(result.order_number.length <= 30);
});
test('duplicate rows are combined, not dropped', () => {
  assert.deepEqual(normalizeCart([{ id: 7, qty: 2 }, { id: 7, qty: 3 }]), [{ id: 7, qty: 5 }]);
});
test('invalid quantities and carts are rejected', () => {
  for (const qty of [0, -1, 1.5, '2', 101, NaN, Infinity]) assert.throws(() => normalizeCart([{ id: 7, qty }]), OrderError);
  for (const items of [[], null, {}, [null], [{ id: '7' }], [{ id: -1 }], [{ id: 7, qty: 60 }, { id: 7, qty: 60 }]]) {
    assert.throws(() => normalizeCart(items), OrderError);
  }
});
test('insufficient stock rejects the entire basket before writes', async () => {
  const db = database([product]);
  await assert.rejects(createOrder(request([{ id: 7, qty: 6 }]), db.transaction), { status: 409 });
  assert.equal(db.writes.length, 0);
});
test('missing product rejects the entire basket before writes', async () => {
  const db = database([product]);
  await assert.rejects(createOrder(request([{ id: 7 }, { id: 8 }]), db.transaction), { status: 409 });
  assert.equal(db.writes.length, 0);
});
test('vehicles cannot be purchased by bypassing the interface', async () => {
  const db = database([{ ...product, vehicle: true }]);
  await assert.rejects(createOrder(request([{ id: 7 }]), db.transaction), { status: 400 });
  assert.equal(db.writes.length, 0);
});
test('unsafe amounts and unknown payment methods are rejected', async () => {
  const db = database([{ ...product, price_cdf: String(Number.MAX_SAFE_INTEGER) }]);
  await assert.rejects(createOrder(request([{ id: 7, qty: 2 }]), db.transaction), { status: 400 });
  await assert.rejects(createOrder({ ...request([{ id: 7 }]), payment: 'free' }, db.transaction), { status: 400 });
  assert.equal(db.writes.length, 0);
});
test('failed insert propagates without returning a confirmation', async () => {
  const db = database([product], true);
  await assert.rejects(createOrder(request([{ id: 7 }]), db.transaction), /Database unavailable/);
});
