import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const script = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(match => match[1]).join('\n');
function app() {
  const context = vm.createContext({
    document: { getElementById: () => ({}), querySelectorAll: () => [] },
    localStorage: { getItem: () => null, setItem() {} },
    location: { protocol: 'http:', hostname: 'localhost' }, navigator: {},
    console, structuredClone, Intl, setTimeout
  });
  vm.runInContext(script + `
    const notifications=[];
    render=()=>{};
    showToast=message=>notifications.push(message);
    globalThis.harness={state,notifications,confirmOrder,saveListing,startApp,orders,loadOperationalData,
      setApi(fn){api=fn}};
  `, context);
  return context.harness;
}
test('anonymous order is not fabricated and basket stays intact', async () => {
  const a = app(); a.state.cart = [{ id: 7, qty: 2 }];
  await a.confirmOrder();
  assert.equal(a.state.orders.length, 0);
  assert.equal(a.state.cart.length, 1);
  assert.match(a.notifications[0], /Connectez-vous/);
});
test('server error keeps basket and does not confirm the order', async () => {
  const a = app(); a.state.token = 'test'; a.state.cart = [{ id: 7, qty: 2 }];
  a.setApi(async () => { throw new Error('Stock insuffisant'); });
  await a.confirmOrder();
  assert.equal(a.state.cart.length, 1);
  assert.equal(a.state.orders.length, 0);
  assert.equal(a.state.submittingOrder, false);
  assert.equal(a.notifications[0], 'Stock insuffisant');
});
test('double click sends only one in-flight request and success clears basket', async () => {
  const a = app(); a.state.token = 'test'; a.state.cart = [{ id: 7, qty: 2, price: 1 }];
  let resolve, calls = 0;
  a.setApi((url, options) => {
    calls++;
    assert.deepEqual(JSON.parse(options.body).items, [{ id: 7, qty: 2 }]);
    return new Promise(done => { resolve = done; });
  });
  const pending = a.confirmOrder();
  await a.confirmOrder();
  assert.equal(calls, 1);
  resolve({ order: { id: 'TK-test', items: [{ name: 'Article' }], status: 'Confirmée' } });
  await pending;
  assert.equal(a.state.cart.length, 0);
  assert.equal(a.state.orders.length, 1);
  assert.match(a.orders(), /Confirmée/);
  assert.doesNotMatch(a.orders(), /Livreur en route/);
});
test('anonymous listing is not saved locally', async () => {
  const a = app();
  await a.saveListing(null);
  assert.match(a.notifications[0], /Connectez-vous/);
});
test('empty OTP is not replaced by the demo code', async () => {
  const a = app(); let calls = 0;
  a.setApi(async () => { calls++; });
  await a.startApp();
  assert.equal(calls, 0);
  assert.match(a.notifications[0], /quatre chiffres/);
});
test('empty server history removes old orders', async () => {
  const a = app(); a.state.token = 'test'; a.state.orders = [{ name: 'Stale' }];
  a.setApi(async url => url === '/api/products' ? { products: [] } : { orders: [] });
  await a.loadOperationalData();
  assert.equal(a.state.orders.length, 0);
});
test('order titles are rendered as text, never executable markup', () => {
  const a = app(); a.state.orders = [{ id: 'TK-test', name: '<img src=x onerror=alert(1)>', status: 'Confirmée' }];
  assert.doesNotMatch(a.orders(), /<img/);
  assert.match(a.orders(), /&lt;img/);
});
