// Shared test harness: boots the real app against a throwaway local Postgres database.
import { createHmac, randomUUID, createHash, randomBytes } from 'node:crypto';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://postgres@localhost:5433/dd_test?host=/tmp';
process.env.FAKE_PAYMENTS = 'true';
process.env.SUPPLIER_SANDBOX = 'true';
process.env.APP_SECRET = 'test-secret-test-secret-test-secret-123';
process.env.PUBLIC_BASE_URL = 'http://localhost:0';
process.env.WORKER_ENABLED = 'false';
process.env.LOG_LEVEL = 'error';

export const mod = {
  app: await import('../dist/server/app.js'),
  pool: await import('../dist/server/db/pool.js'),
  migrate: await import('../dist/server/db/migrate.js'),
  jobs: await import('../dist/server/services/jobs.js'),
  orders: await import('../dist/server/services/orders.js'),
  provider: await import('../dist/server/payments/provider.js'),
  adapters: await import('../dist/server/suppliers/adapters.js'),
  settings: await import('../dist/server/services/settings.js'),
};

export const db = mod.pool.pool;
export const sql = (text, params = []) => db.query(text, params).then((r) => r.rows);

let server; let base;
export async function start() {
  await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await mod.migrate.migrate();
  mod.settings.clearSettingsCache();
  server = mod.app.createApp();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  return base;
}
export async function stop() {
  await new Promise((r) => server.close(r));
  await db.end();
}

export class Client {
  constructor() { this.cookie = ''; }
  async req(method, path, body, headers = {}) {
    const h = { 'X-Requested-With': 'datadeals', ...headers };
    if (body !== undefined) h['Content-Type'] = 'application/json';
    if (this.cookie) h.Cookie = this.cookie;
    const res = await fetch(base + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
    const set = res.headers.getSetCookie?.() || [];
    for (const c of set) {
      const [pair] = c.split(';');
      if (/Max-Age=0/.test(c)) this.cookie = ''; else this.cookie = pair;
    }
    let data = null;
    const text = await res.text();
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data, headers: res.headers };
  }
  get(p, h) { return this.req('GET', p, undefined, h); }
  post(p, b = {}, h) { return this.req('POST', p, b, h); }
  put(p, b = {}) { return this.req('PUT', p, b); }
  patch(p, b = {}) { return this.req('PATCH', p, b); }
  del(p) { return this.req('DELETE', p); }
}

export async function makeOwner(email = 'adonle@example.com') {
  const token = randomBytes(24).toString('base64url');
  await sql(`INSERT INTO admin_invites (token_hash, role, label, expires_at) VALUES ($1,'owner','test', now() + interval '1 day')`, [createHash('sha256').update(token).digest('hex')]);
  const c = new Client();
  const r = await c.post(`/api/auth/invite/${token}`, { full_name: 'Adonle Fameye', email, phone: '0241112223', password: 'Str0ngPassw0rd' });
  if (r.status !== 201) throw new Error('owner setup failed ' + JSON.stringify(r.data));
  return c;
}

export async function liveDataProduct(admin, extra = {}) {
  const r = await admin.post('/api/admin/products', { kind: 'data', network_code: 'MTN', name: '2GB', category: 'weekly', data_mb: 2048, validity_label: '7 days', price_minor: 1000, cost_minor: 850, fee_minor: 0, ...extra });
  if (r.status !== 201) throw new Error('product create failed ' + JSON.stringify(r.data));
  const live = await admin.post(`/api/admin/products/${r.data.product.id}/status`, { status: 'live', confirm_pricing: true });
  if (live.status !== 200) throw new Error('go live failed ' + JSON.stringify(live.data));
  return r.data.product;
}

export function signedWebhook(payload, secret = mod.provider.FAKE_WEBHOOK_SECRET) {
  const raw = JSON.stringify(payload);
  return { raw, sig: createHmac('sha512', secret).update(raw).digest('hex') };
}

export async function postWebhook(payload, sig) {
  const s = sig ?? signedWebhook(payload).sig;
  const res = await fetch(base + '/api/webhooks/paystack', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-paystack-signature': s }, body: JSON.stringify(payload) });
  return { status: res.status, data: await res.json().catch(() => null) };
}

/** Simulates the customer completing payment on the provider page, then Paystack's webhook. */
export async function payOrder(reference, { webhook = true, outcome = 'success' } = {}) {
  const pays = await sql(`SELECT provider_reference FROM payments p JOIN orders o ON o.id = p.order_id WHERE o.reference = $1 ORDER BY p.id DESC`, [reference]);
  const providerRef = pays[0].provider_reference;
  mod.provider.fakeLedger.get(providerRef).status = outcome;
  if (webhook) return postWebhook({ event: outcome === 'success' ? 'charge.success' : 'charge.failed', data: { reference: providerRef, status: outcome } });
  return providerRef;
}

export const newKey = () => randomUUID().replace(/-/g, '');
export async function checkout(client, product, body = {}) {
  return client.post('/api/checkout/orders', { idempotency_key: newKey(), product_id: product.id, network_code: product.network_code, recipient_phone: '0241234560', email: 'buyer@example.com', ...body });
}
export async function orderStatus(reference) {
  return (await sql('SELECT status FROM orders WHERE reference = $1', [reference]))[0]?.status;
}
