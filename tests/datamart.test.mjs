// DataMart GH adapter: exercised against a local fake DataMart server that follows the documented contract.
import http from 'node:http';
import test from 'node:test';
import assert from 'node:assert/strict';

const calls = [];
let mode = 'completed';
const fake = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    calls.push({ method: req.method, url: req.url, headers: req.headers, body: body ? JSON.parse(body) : null });
    const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (req.headers['x-api-key'] !== 'dm-test-key') return send(401, { status: 'error', message: 'Invalid API key' });
    if (req.url === '/api/developer/balance') return send(200, { status: 'success', data: { balance: 77.5 } });
    if (req.url !== '/api/developer/purchase') return send(404, { status: 'error', message: 'Not found' });
    if (mode === 'broke') return send(400, { status: 'error', message: 'Insufficient wallet balance', currentBalance: 10, requiredAmount: 23 });
    if (mode === 'boom') return send(502, { status: 'error', message: 'Bad gateway' });
    return send(200, { status: 'success', message: 'Data bundle purchased successfully', data: { purchaseId: 'p1', orderReference: 'GN-TEST' + calls.length, network: 'YELLO', capacity: 2, price: 8.4, orderStatus: mode } });
  });
});
await new Promise((r) => fake.listen(0, '127.0.0.1', r));
process.env.DATAMART_API_KEY = 'dm-test-key';
process.env.DATAMART_API_BASE_URL = `http://127.0.0.1:${fake.address().port}/api/developer/`;

const { mod, start, stop, sql, makeOwner, liveDataProduct, checkout, payOrder, orderStatus, Client } = await import('./helpers.mjs');
let owner;
test.before(async () => { await start(); owner = await makeOwner(); });
test.after(async () => { await stop(); fake.close(); });

test('DataMart supplier is added disabled, and the connection test checks the balance without ordering', async () => {
  const s = (await sql(`SELECT * FROM suppliers WHERE code = 'datamart'`))[0];
  assert.equal(s.is_enabled, false);
  const r = await owner.post(`/api/admin/suppliers/${s.id}/test`);
  assert.equal(r.data.result.ok, true);
  assert.match(r.data.result.message, /GHS 77\.50/);
  assert.equal(calls.filter((c) => c.url.endsWith('/purchase')).length, 0);
  assert.equal((await owner.patch(`/api/admin/suppliers/${s.id}`, { is_enabled: true, notes: null })).status, 200);
});

test('DataMart: paid order is sent with the documented fields, once, and delivered', async () => {
  const s = (await sql(`SELECT * FROM suppliers WHERE code = 'datamart'`))[0];
  const product = await liveDataProduct(owner, { name: '2GB DM', supplier_id: s.id, supplier_product_code: null });
  const o = await checkout(new Client(), product, { recipient_phone: '0241234560' });
  await payOrder(o.data.reference);
  await mod.jobs.drainJobs();
  assert.equal(await orderStatus(o.data.reference), 'successful');
  const p = calls.filter((c) => c.url.endsWith('/purchase'));
  assert.equal(p.length, 1);
  assert.deepEqual(p[0].body, { phoneNumber: '0241234560', network: 'YELLO', capacity: '2', gateway: 'wallet', ref: `${o.data.reference}-A1` });
  assert.equal(p[0].headers['x-idempotency-key'], `${o.data.reference}-A1`);
  const row = (await sql(`SELECT supplier_reference, actual_cost_minor FROM orders WHERE reference = $1`, [o.data.reference]))[0];
  assert.match(row.supplier_reference, /^GN-TEST/);
  assert.equal(Number(row.actual_cost_minor), 840);
});

test('DataMart: refusal = failed (safe to retry); server error = review, never retried', async () => {
  const product = (await sql(`SELECT * FROM products WHERE name = '2GB DM'`))[0];
  mode = 'broke';
  const a = await checkout(new Client(), product, { recipient_phone: '0241234561' });
  await payOrder(a.data.reference);
  await mod.jobs.drainJobs();
  assert.equal(await orderStatus(a.data.reference), 'failed');
  const att = (await sql(`SELECT error_message FROM delivery_attempts a JOIN orders o ON o.id = a.order_id WHERE o.reference = $1`, [a.data.reference]))[0];
  assert.match(att.error_message, /Insufficient wallet balance/);

  mode = 'boom';
  const b = await checkout(new Client(), product, { recipient_phone: '0241234562' });
  await payOrder(b.data.reference);
  const before = calls.length;
  await mod.jobs.drainJobs();
  assert.equal(await orderStatus(b.data.reference), 'needs_review');
  assert.equal(calls.length, before + 1);

  mode = 'processing';
  const c = await checkout(new Client(), product, { recipient_phone: '0241234564' });
  await payOrder(c.data.reference);
  await mod.jobs.drainJobs();
  assert.equal(await orderStatus(c.data.reference), 'processing', 'accepted but unconfirmed stays processing');
  mode = 'completed';
});

test('DataMart: products it cannot deliver fall back to manual without calling DataMart', async () => {
  const s = (await sql(`SELECT * FROM suppliers WHERE code = 'datamart'`))[0];
  const product = await liveDataProduct(owner, { name: '500MB DM', data_mb: 500, supplier_id: s.id, supplier_product_code: null });
  const before = calls.length;
  const o = await checkout(new Client(), product, { recipient_phone: '0241234565' });
  await payOrder(o.data.reference);
  await mod.jobs.drainJobs();
  assert.equal(await orderStatus(o.data.reference), 'queued');
  assert.equal(calls.length, before);
  assert.equal(mod.adapters.datamartCapacity({ productCode: '5GB' }), '5');
  assert.equal(mod.adapters.datamartCapacity({ productCode: 'abc' }), null);
});
