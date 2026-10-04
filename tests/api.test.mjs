import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { start, stop, sql, Client, makeOwner, liveDataProduct, checkout, payOrder, postWebhook, signedWebhook, orderStatus, newKey, mod } from './helpers.mjs';

let owner;
before(async () => { await start(); owner = await makeOwner(); });
after(async () => { await stop(); });

test('health, config and an empty public catalogue (imported/seeded products are drafts)', async () => {
  const c = new Client();
  assert.equal((await c.get('/api/health')).status, 200);
  const cfg = await c.get('/api/public/config');
  assert.equal(cfg.data.business.name, 'Data Deals');
  assert.equal(cfg.data.networks.length, 3);
  assert.equal(cfg.data.payments.testMode, true);
  const p = await c.get('/api/public/products');
  assert.equal(p.data.products.length, 0, 'draft products must never be for sale');
});

test('CSRF protection rejects requests without the app header or from other sites', async () => {
  const c = new Client();
  const noHeader = await c.req('POST', '/api/auth/login', { email: 'a@b.co', password: 'x' }, { 'X-Requested-With': '' });
  assert.equal(noHeader.status, 403);
  const badOrigin = await c.req('POST', '/api/auth/login', { email: 'a@b.co', password: 'x' }, { Origin: 'https://evil.example' });
  assert.equal(badOrigin.status, 403);
});

test('registration, login, logout and password rules', async () => {
  const c = new Client();
  const weak = await c.post('/api/auth/register', { full_name: 'Ama', email: 'ama@example.com', phone: '0241234567', password: 'short' });
  assert.equal(weak.status, 400);
  const reg = await c.post('/api/auth/register', { full_name: 'Ama Mensah', email: 'Ama@Example.com', phone: '+233 24 123 4567', password: 'Passw0rd123' });
  assert.equal(reg.status, 201);
  assert.equal(reg.data.user.email, 'ama@example.com');
  assert.equal(reg.data.user.phone, '0241234567');
  assert.equal((await c.get('/api/auth/me')).data.user.role, 'customer');
  const dup = await new Client().post('/api/auth/register', { full_name: 'Ama 2', email: 'ama@example.com', phone: '0241234567', password: 'Passw0rd123' });
  assert.equal(dup.status, 409);
  const hash = (await sql(`SELECT password_hash FROM users WHERE email = 'ama@example.com'`))[0].password_hash;
  assert.match(hash, /^scrypt\$/);
  assert.ok(!hash.includes('Passw0rd123'));
  await c.post('/api/auth/logout');
  assert.equal((await c.get('/api/auth/me')).data.user, null);
  const bad = await c.post('/api/auth/login', { email: 'ama@example.com', password: 'wrong-password1' });
  assert.equal(bad.status, 401);
  const good = await c.post('/api/auth/login', { email: 'AMA@example.com', password: 'Passw0rd123' });
  assert.equal(good.status, 200);
});

test('admin area is locked to staff; customers and guests are refused', async () => {
  const guest = new Client();
  assert.equal((await guest.get('/api/admin/overview')).status, 401);
  const cust = new Client();
  await cust.post('/api/auth/register', { full_name: 'Kofi', email: 'kofi@example.com', phone: '0551234567', password: 'Passw0rd123' });
  assert.equal((await cust.get('/api/admin/orders')).status, 403);
  assert.equal((await owner.get('/api/admin/overview')).status, 200);
});

test('products: validation, draft by default, go-live requires explicit price confirmation, audit history', async () => {
  const bad = await owner.post('/api/admin/products', { kind: 'data', network_code: 'MTN', name: 'X', category: 'weekly' });
  assert.equal(bad.status, 400);
  const created = await owner.post('/api/admin/products', { kind: 'data', network_code: 'TELECEL', name: '1GB', category: 'daily', data_mb: 1024, validity_label: '1 day', price_minor: 500, cost_minor: 420 });
  assert.equal(created.status, 201);
  assert.equal(created.data.product.status, 'draft');
  const noConfirm = await owner.post(`/api/admin/products/${created.data.product.id}/status`, { status: 'live' });
  assert.equal(noConfirm.status, 409);
  const live = await owner.post(`/api/admin/products/${created.data.product.id}/status`, { status: 'live', confirm_pricing: true });
  assert.equal(live.status, 200);
  const pub = await new Client().get('/api/public/products?network=TELECEL');
  assert.equal(pub.data.products.length, 1);
  assert.equal(pub.data.products[0].priceMinor, 500);
  assert.equal(pub.data.products[0].costMinor, undefined, 'supplier cost must not be public');
  const hist = await owner.get(`/api/admin/products/${created.data.product.id}/history`);
  assert.ok(hist.data.history.length >= 2);
  await owner.post(`/api/admin/products/${created.data.product.id}/status`, { status: 'paused' });
  assert.equal((await new Client().get('/api/public/products?network=TELECEL')).data.products.length, 0);
});

test('checkout: server-side price, phone validation, idempotent replays, no double orders', async () => {
  const product = await liveDataProduct(owner);
  const c = new Client();
  const badPhone = await checkout(c, product, { recipient_phone: '12345' });
  assert.equal(badPhone.status, 400);
  const wrongNet = await checkout(c, product, { network_code: 'AT' });
  assert.equal(wrongNet.status, 400);
  const key = newKey();
  const first = await checkout(c, product, { idempotency_key: key, price_minor: 1, total_minor: 1 });
  assert.equal(first.status, 200);
  assert.equal(first.data.totalMinor, 1000, 'browser-sent prices are ignored');
  assert.ok(first.data.authorizationUrl);
  const again = await checkout(c, product, { idempotency_key: key });
  assert.equal(again.data.reference, first.data.reference, 'double-tap returns the same order');
  assert.equal(again.data.authorizationUrl, first.data.authorizationUrl);
  const clash = await checkout(c, product, { idempotency_key: key, recipient_phone: '0209999999' });
  assert.equal(clash.status, 409);
  const count = await sql('SELECT count(*)::int AS n FROM orders WHERE idempotency_key = $1', [key]);
  assert.equal(count[0].n, 1);
  // Guests can only see the order with its secret link token
  assert.equal((await new Client().get(`/api/orders/${first.data.reference}`)).status, 404);
  const view = await new Client().get(`/api/orders/${first.data.reference}?t=${first.data.accessToken}`);
  assert.equal(view.data.order.status, 'pending_payment');
  assert.equal(view.data.order.expected_cost_minor, undefined);
});

test('payments: forged webhooks rejected; verified webhook marks paid once; duplicates ignored; manual queue', async () => {
  const product = (await sql(`SELECT * FROM products WHERE status = 'live' AND network_code = 'MTN' LIMIT 1`))[0];
  const c = new Client();
  const o = await checkout(c, product);
  const ref = o.data.reference;
  const providerRef = (await sql('SELECT provider_reference FROM payments p JOIN orders o ON o.id = p.order_id WHERE o.reference = $1', [ref]))[0].provider_reference;

  // Forged: not signed with the secret
  const forged = await postWebhook({ event: 'charge.success', data: { reference: providerRef } }, 'deadbeef');
  assert.equal(forged.status, 401);
  assert.equal(await orderStatus(ref), 'pending_payment');

  // Signed but Paystack verification says not paid yet -> stays pending (webhook alone is never trusted)
  const early = await postWebhook({ event: 'charge.success', data: { reference: providerRef, n: 1 } });
  assert.equal(early.status, 200);
  assert.equal(await orderStatus(ref), 'pending_payment');

  // Real payment
  mod.provider.fakeLedger.get(providerRef).status = 'success';
  const payload = { event: 'charge.success', data: { reference: providerRef, n: 2 } };
  assert.equal((await postWebhook(payload)).status, 200);
  assert.equal(await orderStatus(ref), 'paid');
  const dup = await postWebhook(payload);
  assert.equal(dup.data.duplicate, true);
  const jobs = await sql(`SELECT count(*)::int AS n FROM jobs WHERE type = 'fulfil' AND payload->>'orderId' = (SELECT id::text FROM orders WHERE reference = $1)`, [ref]);
  assert.equal(jobs[0].n, 1, 'exactly one fulfilment job');
  await mod.jobs.drainJobs();
  assert.equal(await orderStatus(ref), 'queued', 'no supplier connected -> manual queue');
  const evts = await sql(`SELECT event_type FROM order_events e JOIN orders o ON o.id = e.order_id WHERE o.reference = $1 ORDER BY e.id`, [ref]);
  assert.deepEqual(evts.map((e) => e.event_type), ['created', 'payment_confirmed', 'awaiting_manual']);
  const logged = await sql(`SELECT signature_valid, processing_result FROM payment_events ORDER BY id`);
  assert.equal(logged[0].signature_valid, false);
});

test('manual fulfilment requires explicit confirmation, is audited, and history is immutable', async () => {
  const [o] = await sql(`SELECT reference FROM orders WHERE status = 'queued' LIMIT 1`);
  const noConfirm = await owner.post(`/api/admin/orders/${o.reference}/record-delivery`, { note: 'Sent via MTN portal' });
  assert.equal(noConfirm.status, 400);
  const ok = await owner.post(`/api/admin/orders/${o.reference}/record-delivery`, { note: 'Sent via MTN portal', confirmation_reference: 'MTN-12345', confirm: true });
  assert.equal(ok.status, 200);
  assert.equal(await orderStatus(o.reference), 'successful');
  const again = await owner.post(`/api/admin/orders/${o.reference}/mark-failed`, { reason: 'try to undo it' });
  assert.equal(again.status, 409, 'delivered orders cannot be flipped');
  const audit = await sql(`SELECT action FROM audit_logs WHERE entity_id = $1`, [o.reference]);
  assert.ok(audit.some((a) => a.action === 'order.record_delivery'));
  await assert.rejects(sql(`UPDATE order_events SET message = 'x'`), /immutable/);
  await assert.rejects(sql(`DELETE FROM audit_logs`), /immutable/);
});

test('automated supplier: success, definitive failure + retry, unknown outcome goes to review and blocks refund', async () => {
  await sql(`INSERT INTO suppliers (code, name, adapter, is_enabled, networks) VALUES ('sandbox','Sandbox (TEST)','sandbox',true,ARRAY['MTN','TELECEL','AT'])`);
  const sup = (await sql(`SELECT id FROM suppliers WHERE code = 'sandbox'`))[0];
  const product = await liveDataProduct(owner, { name: '5GB', price_minor: 2000, cost_minor: 1700, supplier_id: sup.id, supplier_product_code: 'MTN_5GB' });
  const c = new Client();

  // success
  const ok = await checkout(c, product, { recipient_phone: '0241234560' });
  await payOrder(ok.data.reference);
  await mod.jobs.drainJobs();
  assert.equal(await orderStatus(ok.data.reference), 'successful');
  const attempt = (await sql(`SELECT a.* FROM delivery_attempts a JOIN orders o ON o.id = a.order_id WHERE o.reference = $1`, [ok.data.reference]))[0];
  assert.equal(attempt.request_id, `${ok.data.reference}-A1`);

  // definitive failure -> retry allowed
  const fail = await checkout(c, product, { recipient_phone: '0241234561' });
  await payOrder(fail.data.reference);
  await mod.jobs.drainJobs();
  assert.equal(await orderStatus(fail.data.reference), 'failed');
  assert.equal((await owner.post(`/api/admin/orders/${fail.data.reference}/retry`)).status, 200);
  await mod.jobs.drainJobs();
  assert.equal((await sql(`SELECT count(*)::int AS n FROM delivery_attempts a JOIN orders o ON o.id = a.order_id WHERE o.reference = $1`, [fail.data.reference]))[0].n, 2);

  // unknown -> needs_review, never auto-retried, refund blocked until resolved
  const unk = await checkout(c, product, { recipient_phone: '0241234562' });
  await payOrder(unk.data.reference);
  const before = mod.adapters.sandboxCalls.length;
  await mod.jobs.drainJobs();
  // the status check job confirms success in the sandbox, so run fulfilment only and inspect before checks
  const st = await orderStatus(unk.data.reference);
  assert.ok(['needs_review'].includes(st), 'unknown result goes to review, got ' + st);
  assert.equal(mod.adapters.sandboxCalls.length, before + 1, 'only one supplier request was sent');
  const refundTry = await owner.post(`/api/admin/orders/${unk.data.reference}/refund`, { reason: 'customer wants money back' });
  assert.equal(refundTry.status, 409);
  const failNoCheck = await owner.post(`/api/admin/orders/${unk.data.reference}/mark-failed`, { reason: 'supplier says no' });
  assert.equal(failNoCheck.status, 409);
  const failChecked = await owner.post(`/api/admin/orders/${unk.data.reference}/mark-failed`, { reason: 'Supplier portal shows not delivered', supplier_checked: true });
  assert.equal(failChecked.status, 200);

  // refund flow on the confirmed failure
  const refund = await owner.post(`/api/admin/orders/${unk.data.reference}/refund`, { reason: 'Not delivered, refunding customer' });
  assert.equal(refund.status, 200, JSON.stringify(refund.data));
  assert.equal(await orderStatus(unk.data.reference), 'refund_pending');
  const rf = (await sql(`SELECT * FROM refunds r JOIN orders o ON o.id = r.order_id WHERE o.reference = $1`, [unk.data.reference]))[0];
  mod.provider.fakeRefunds.set(rf.provider_refund_id, 'processed');
  await mod.orders.reconcileRefunds();
  assert.equal(await orderStatus(unk.data.reference), 'refunded');
  // cannot refund twice
  assert.equal((await owner.post(`/api/admin/orders/${unk.data.reference}/refund`, { reason: 'again please' })).status, 409);
});

test('pending supplier result is confirmed by status checks', async () => {
  const product = (await sql(`SELECT * FROM products WHERE name = '5GB' LIMIT 1`))[0];
  const o = await checkout(new Client(), product, { recipient_phone: '0241234563' });
  await payOrder(o.data.reference);
  await mod.jobs.runOneJob(); // fulfil -> pending
  assert.equal(await orderStatus(o.data.reference), 'processing');
  await sql(`UPDATE jobs SET run_at = now() WHERE type = 'check_delivery'`);
  await mod.jobs.drainJobs();
  assert.equal(await orderStatus(o.data.reference), 'successful');
});

test('amount mismatch and duplicate payments are caught for review', async () => {
  const product = (await sql(`SELECT * FROM products WHERE name = '2GB' AND status = 'live' LIMIT 1`))[0];
  const c = new Client();
  const o = await checkout(c, product, { recipient_phone: '0209876543' });
  const providerRef = await payOrder(o.data.reference, { webhook: false });
  mod.provider.fakeLedger.get(providerRef).amountMinor = 1; // provider says a different amount was paid
  await postWebhook({ event: 'charge.success', data: { reference: providerRef } });
  assert.equal(await orderStatus(o.data.reference), 'needs_review');

  // duplicate payment: pay again on a second attempt after the order was already paid
  const o2 = await checkout(c, product, { recipient_phone: '0209876544' });
  const ref1 = await payOrder(o2.data.reference, { webhook: false });
  const retry = await c.post(`/api/orders/${o2.data.reference}/pay?t=${o2.data.accessToken}`);
  assert.equal(retry.data.status, 'paid', 'retrying payment first verifies the earlier attempt, so no second charge is started');
  void ref1;
  const pays = await sql(`SELECT count(*)::int AS n FROM payments p JOIN orders o ON o.id = p.order_id WHERE o.reference = $1`, [o2.data.reference]);
  assert.equal(pays[0].n, 1);
  // Simulate a genuinely duplicated charge arriving on a new attempt
  const order2 = (await sql('SELECT * FROM orders WHERE reference = $1', [o2.data.reference]))[0];
  await sql(`INSERT INTO payments (order_id, provider, provider_reference, amount_minor, is_test) VALUES ($1,'fake',$2,$3,true)`, [order2.id, `${order2.reference}-9`, order2.total_minor]);
  mod.provider.fakeLedger.set(`${order2.reference}-9`, { amountMinor: order2.total_minor, status: 'success' });
  await postWebhook({ event: 'charge.success', data: { reference: `${order2.reference}-9` } });
  const refunds = await sql(`SELECT reason, status FROM refunds WHERE order_id = $1`, [order2.id]);
  assert.equal(refunds.length, 1);
  assert.match(refunds[0].reason, /Duplicate payment/);
});

test('failed and abandoned payments; expiry and reconciliation', async () => {
  const product = (await sql(`SELECT * FROM products WHERE name = '2GB' AND status = 'live' LIMIT 1`))[0];
  const o = await checkout(new Client(), product, { recipient_phone: '0501112223' });
  await payOrder(o.data.reference, { outcome: 'failed', webhook: false });
  // Paystack has no failure webhook; the order page asks Paystack directly and sees the decline
  const seen = await new Client().get(`/api/orders/${o.data.reference}?t=${o.data.accessToken}`);
  assert.equal(seen.data.order.status, 'payment_failed');
  // customer can try again, getting a fresh attempt
  const again = await new Client().post(`/api/orders/${o.data.reference}/pay?t=${o.data.accessToken}`);
  assert.equal(again.status, 200);
  assert.ok(again.data.authorizationUrl);
  assert.equal(await orderStatus(o.data.reference), 'pending_payment');

  // missed webhook: reconciliation picks it up
  const o2 = await checkout(new Client(), product, { recipient_phone: '0501112224' });
  await payOrder(o2.data.reference, { webhook: false });
  await sql(`UPDATE payments SET created_at = now() - interval '10 minutes'`);
  await mod.orders.periodicTasks();
  assert.equal(await orderStatus(o2.data.reference), 'paid');

  // expiry of never-paid orders
  const o3 = await checkout(new Client(), product, { recipient_phone: '0501112225' });
  await sql(`UPDATE orders SET created_at = now() - interval '5 hours' WHERE reference = $1`, [o3.data.reference]);
  await sql(`UPDATE payments SET created_at = now() - interval '5 hours' WHERE order_id = (SELECT id FROM orders WHERE reference = $1)`, [o3.data.reference]);
  await mod.orders.periodicTasks();
  assert.equal(await orderStatus(o3.data.reference), 'expired');
});

test('airtime pricing with limits and fees', async () => {
  const [air] = await sql(`SELECT * FROM products WHERE kind = 'airtime' AND network_code = 'AT'`);
  const put = await owner.put(`/api/admin/products/${air.id}`, { kind: 'airtime', network_code: 'AT', name: 'AT Airtime', category: 'airtime', airtime_min_minor: 100, airtime_max_minor: 20000, airtime_fee_bps: 200, airtime_cost_bps: 9700, manual_fulfilment_allowed: true });
  assert.equal(put.status, 200, JSON.stringify(put.data));
  await owner.post(`/api/admin/products/${air.id}/status`, { status: 'live', confirm_pricing: true });
  const c = new Client();
  const q1 = await c.post('/api/checkout/quote', { product_id: air.id, amount_minor: 1000 });
  assert.deepEqual([q1.data.quote.priceMinor, q1.data.quote.feeMinor, q1.data.quote.totalMinor], [1000, 20, 1020]);
  assert.equal((await c.post('/api/checkout/quote', { product_id: air.id, amount_minor: 50 })).status, 400);
  assert.equal((await c.post('/api/checkout/quote', { product_id: air.id, amount_minor: 30000 })).status, 400);
  const o = await c.post('/api/checkout/orders', { idempotency_key: newKey(), product_id: air.id, network_code: 'AT', recipient_phone: '0561234567', amount_minor: 1000, email: 'x@example.com' });
  assert.equal(o.data.totalMinor, 1020);
  const row = (await sql('SELECT expected_cost_minor FROM orders WHERE reference = $1', [o.data.reference]))[0];
  assert.equal(row.expected_cost_minor, 970);
});

test('support tickets: guest create/view/reply, admin reply, refund request recorded for review', async () => {
  const g = new Client();
  const noOrder = await g.post('/api/support/tickets', { email: 'g@example.com', category: 'refund', subject: 'Money back', message: 'I want my money back please' });
  assert.equal(noOrder.status, 400);
  const t = await g.post('/api/support/tickets', { name: 'Esi', email: 'g@example.com', category: 'general', subject: 'Question', message: 'Do you sell AT bundles?' });
  assert.equal(t.status, 201);
  const ref = t.data.ticket.reference;
  assert.equal((await new Client().get(`/api/support/tickets/${ref}`)).status, 404);
  const view = await g.get(`/api/support/tickets/${ref}?t=${t.data.ticket.accessToken}`);
  assert.equal(view.data.ticket.messages.length, 1);
  assert.equal((await owner.post(`/api/admin/tickets/${ref}/reply`, { message: 'Yes we do!' })).status, 200);
  const v2 = await g.get(`/api/support/tickets/${ref}?t=${t.data.ticket.accessToken}`);
  assert.equal(v2.data.ticket.status, 'awaiting_customer');
  assert.equal(v2.data.ticket.messages[1].author_type, 'admin');

  const [failed] = await sql(`SELECT reference, contact_email FROM orders WHERE status = 'failed' LIMIT 1`);
  if (failed) {
    const rt = await g.post('/api/support/tickets', { email: failed.contact_email, category: 'refund', subject: 'Not delivered', message: 'My bundle never arrived', order_reference: failed.reference });
    assert.equal(rt.status, 201);
    const rr = await sql(`SELECT r.status, r.requested_by_type FROM refunds r JOIN orders o ON o.id = r.order_id WHERE o.reference = $1`, [failed.reference]);
    assert.equal(rr[0]?.status, 'requested');
  }
});

test('analytics use real numbers only and exclude test orders by default', async () => {
  const live = await owner.get('/api/admin/overview');
  assert.equal(live.data.totals.orders, 0, 'all orders so far are TEST orders');
  const withTest = await owner.get('/api/admin/overview?test=1');
  const expected = await sql(`SELECT COALESCE(sum(total_minor),0)::bigint AS s FROM orders WHERE status IN ('paid','queued','processing','successful','failed','needs_review','refund_pending','refunded')`);
  assert.equal(withTest.data.totals.gross_sales, expected[0].s);
  assert.ok(withTest.data.totals.successful >= 3);
});

test('team invites, roles and restrictions', async () => {
  const inv = await owner.post('/api/admin/team/invites', { label: 'Ben K', role: 'owner' });
  assert.equal(inv.status, 200);
  const token = inv.data.link.split('/').pop();
  const ben = new Client();
  const acc = await ben.post(`/api/auth/invite/${token}`, { full_name: 'Ben K', email: 'ben@example.com', phone: '0209998887', password: 'An0therStrong1' });
  assert.equal(acc.status, 201);
  assert.equal(acc.data.user.role, 'owner');
  assert.equal((await new Client().post(`/api/auth/invite/${token}`, { full_name: 'Xavier', email: 'x2@example.com', phone: '0209998886', password: 'An0therStrong1' })).status, 404, 'invite links are single-use');
  const [cust] = await sql(`SELECT id FROM users WHERE email = 'kofi@example.com'`);
  const kofi = new Client();
  await kofi.post('/api/auth/login', { email: 'kofi@example.com', password: 'Passw0rd123' });
  assert.equal((await ben.post(`/api/admin/customers/${cust.id}/restrict`, { reason: 'Suspicious chargebacks' })).status, 200);
  assert.equal((await kofi.get('/api/account/orders')).status, 401, 'restricted user sessions are revoked');
  assert.equal((await kofi.post('/api/auth/login', { email: 'kofi@example.com', password: 'Passw0rd123' })).status, 403);
  assert.equal((await ben.post(`/api/admin/customers/${cust.id}/restore`)).status, 200);
});

test('maintenance mode pauses checkout', async () => {
  await owner.put('/api/admin/settings/maintenance', { enabled: true, message: 'Back in 10 minutes' });
  mod.settings.clearSettingsCache();
  const product = (await sql(`SELECT * FROM products WHERE name = '2GB' AND status = 'live' LIMIT 1`))[0];
  const r = await checkout(new Client(), product);
  assert.equal(r.status, 503);
  assert.equal(r.data.error.message, 'Back in 10 minutes');
  await owner.put('/api/admin/settings/maintenance', { enabled: false, message: 'x' });
  mod.settings.clearSettingsCache();
});

test('website pages are served with SEO tags; private pages are noindex', async () => {
  // Requires a web build; skipped when only the server was built.
  const c = new Client();
  const r = await c.get('/robots.txt');
  assert.match(r.data, /Disallow: \/admin/);
  const sm = await c.get('/sitemap.xml');
  assert.match(sm.data, /\/data-bundles/);
});

test('web pages: per-page titles, canonical, noindex on private pages, 404 status, security headers', async () => {
  const c = new Client();
  const home = await c.get('/');
  if (typeof home.data !== 'string' || !home.data.includes('<div id="root">')) return; // web not built
  assert.match(home.data, /<title>Data Deals — Airtime/);
  assert.match(home.data, /application\/ld\+json/);
  assert.match(home.headers.get('content-security-policy'), /default-src 'self'/);
  const bundles = await c.get('/data-bundles');
  assert.match(bundles.data, /rel="canonical" href="[^"]+\/data-bundles"/);
  const admin = await c.get('/admin');
  assert.match(admin.data, /noindex/);
  const missing = await c.get('/no-such-page');
  assert.equal(missing.status, 404);
  const trav = await c.get('/assets/../../package.json');
  assert.notEqual(trav.status, 200);
});

test('checkout passes the chosen payment method to the provider', async () => {
  const product = (await sql(`SELECT * FROM products WHERE name = '2GB' AND status = 'live' LIMIT 1`))[0];
  const r = await checkout(new Client(), product, { recipient_phone: '0241230000', payment_method: 'card' });
  assert.equal(r.status, 200);
  const bad = await checkout(new Client(), product, { recipient_phone: '0241230001', payment_method: 'bitcoin' });
  assert.equal(bad.status, 400);
});

test('guests can track an order with order number + phone, nothing else', async () => {
  const product = (await sql(`SELECT * FROM products WHERE name = '2GB' AND status = 'live' LIMIT 1`))[0];
  const o = await checkout(new Client(), product, { recipient_phone: '0244445556', contact_phone: '0501234999' });
  const c = new Client();
  const ok = await c.post('/api/orders/track', { reference: o.data.reference.toLowerCase(), phone: '+233 24 444 5556' });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.reference, o.data.reference);
  const view = await c.get(`/api/orders/${ok.data.reference}?t=${ok.data.accessToken}`);
  assert.equal(view.status, 200);
  const byContact = await c.post('/api/orders/track', { reference: o.data.reference, phone: '0501234999' });
  assert.equal(byContact.status, 200);
  const wrong = await c.post('/api/orders/track', { reference: o.data.reference, phone: '0209999999' });
  assert.equal(wrong.status, 404);
  const bad = await c.post('/api/orders/track', { reference: 'DDNOPE123', phone: '0244445556' });
  assert.equal(bad.status, 404);
});

test('recipient check flags numbers that have never received a bundle', async () => {
  const c = new Client();
  const fresh = await c.post('/api/checkout/recipient-check', { phone: '0249990001' });
  assert.equal(fresh.status, 200, JSON.stringify(fresh.data));
  assert.equal(fresh.data.firstTime, true);
  const [done] = await sql(`SELECT recipient_phone FROM orders WHERE status = 'successful' LIMIT 1`);
  if (done) assert.equal((await c.post('/api/checkout/recipient-check', { phone: done.recipient_phone })).data.firstTime, false);
  assert.equal((await c.post('/api/checkout/recipient-check', { phone: '123' })).status, 400);
});
