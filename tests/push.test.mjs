// Phone notifications: real RFC 8291 encryption verified by decrypting on a fake push service.
import http from 'node:http';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createECDH, createHmac, createDecipheriv, randomBytes, createPublicKey, verify } from 'node:crypto';

// A fake browser: its own key pair + auth secret, and a push service that decrypts incoming messages.
const ua = createECDH('prime256v1'); ua.generateKeys();
const auth = randomBytes(16);
const received = [];
let respond = 201; // status for the device at /push/gone only
const hmac = (k, d) => createHmac('sha256', k).update(d).digest();
function decrypt(buf) {
  const salt = buf.subarray(0, 16); const idlen = buf[20]; const asPub = buf.subarray(21, 21 + idlen); const ct = buf.subarray(21 + idlen);
  const secret = ua.computeSecret(asPub);
  const prkKey = hmac(auth, secret);
  const ikm = hmac(prkKey, Buffer.concat([Buffer.from('WebPush: info\0'), ua.getPublicKey(), asPub, Buffer.from([1])])).subarray(0, 32);
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01')).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01')).subarray(0, 12);
  const d = createDecipheriv('aes-128-gcm', cek, nonce); d.setAuthTag(ct.subarray(ct.length - 16));
  const pt = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
  return JSON.parse(pt.subarray(0, pt.lastIndexOf(2)).toString());
}
const svc = http.createServer((req, res) => {
  const chunks = []; req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const code = req.url === '/push/gone' ? respond : 201;
    received.push({ path: req.url, headers: req.headers, payload: code < 300 ? decrypt(Buffer.concat(chunks)) : null });
    res.writeHead(code); res.end();
  });
});
await new Promise((r) => svc.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${svc.address().port}`;

const { generateVapidKeys } = await import('../dist/server/lib/webpush.js');
const keys = generateVapidKeys();
process.env.VAPID_PUBLIC_KEY = keys.publicKey; process.env.VAPID_PRIVATE_KEY = keys.privateKey; process.env.PUSH_ALLOW_ANY_HOST = 'true';
const { mod, start, stop, sql, makeOwner, liveDataProduct, checkout, payOrder, Client } = await import('./helpers.mjs');
const push = await import('../dist/server/services/push.js');
let owner;
const sub = (path) => ({ endpoint: `${base}/push/${path}`, keys: { p256dh: ua.getPublicKey().toString('base64url'), auth: auth.toString('base64url') } });
test.before(async () => { await start(); owner = await makeOwner(); });
test.after(async () => { await stop(); svc.close(); });

test('subscribe: config exposes only the public key; unknown push hosts are refused in production mode', async () => {
  const c = new Client();
  const cfg = await c.get('/api/push/config');
  assert.equal(cfg.data.enabled, true); assert.equal(cfg.data.publicKey, keys.publicKey);
  assert.equal(JSON.stringify(cfg.data).includes(keys.privateKey), false);
  const { isAllowedPushEndpoint } = await import('../dist/server/lib/webpush.js');
  assert.equal(isAllowedPushEndpoint('https://fcm.googleapis.com/fcm/send/abc'), true);
  assert.equal(isAllowedPushEndpoint('https://evil.example.com/x'), false);
  assert.equal(isAllowedPushEndpoint('http://169.254.169.254/latest'), false);
  assert.equal((await c.post('/api/push/subscribe', { subscription: { endpoint: 'not a url', keys: {} } })).status, 400);
});

test('test message is encrypted, signed with VAPID and decrypts correctly on the device', async () => {
  const r = await owner.post('/api/push/subscribe', { subscription: sub('owner') });
  assert.equal(r.status, 200);
  const t = await owner.post('/api/admin/push/test');
  assert.equal(t.data.delivered, 1);
  const m = received.at(-1);
  assert.equal(m.payload.title, 'DataCedi test ✅');
  assert.equal(m.headers['content-encoding'], 'aes128gcm');
  // VAPID JWT is a valid ES256 signature by our public key
  const [, jwt, k] = m.headers.authorization.match(/^vapid t=([^,]+), k=(.+)$/);
  assert.equal(k, keys.publicKey);
  const [h, p, s] = jwt.split('.');
  const pub = Buffer.from(keys.publicKey, 'base64url');
  const key = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: pub.subarray(1, 33).toString('base64url'), y: pub.subarray(33).toString('base64url') }, format: 'jwk' });
  assert.ok(verify('sha256', Buffer.from(`${h}.${p}`), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url')));
  assert.equal(JSON.parse(Buffer.from(p, 'base64url')).aud, base);
});

test('delivery alert reaches the buyer and a guest watching the order', async () => {
  await sql(`INSERT INTO suppliers (code, name, adapter, is_enabled, networks) VALUES ('sandbox','Sandbox','sandbox',true,ARRAY['MTN','TELECEL','AT'])`);
  const sup = (await sql(`SELECT id FROM suppliers WHERE code='sandbox'`))[0];
  const product = await liveDataProduct(owner, { name: '1GB', data_mb: 1024, price_minor: 500, cost_minor: 400, supplier_id: sup.id, supplier_product_code: 'X' });
  const guest = new Client();
  const o = await checkout(guest, product, { recipient_phone: '0241234560' });
  const w = await guest.post('/api/push/subscribe', { subscription: sub('guest'), order_reference: o.data.reference }, { 'X-Order-Token': o.data.accessToken });
  assert.equal(w.status, 200, JSON.stringify(w.data));
  await payOrder(o.data.reference);
  await mod.jobs.drainJobs();
  const alert = received.find((x) => x.path === '/push/guest' && x.payload.title.startsWith('✅'));
  assert.ok(alert, 'guest got the delivered alert');
  assert.match(alert.payload.url, new RegExp(`/order/${o.data.reference}\\?t=`));
});

test('daily message: once per device per day, opt-out respected, Twi greeting, real starting price', async () => {
  const c = new Client();
  await c.post('/api/push/subscribe', { subscription: sub('fan') });
  await c.post('/api/push/subscribe', { subscription: sub('quiet'), marketing: false });
  const morning = new Date(Date.UTC(2026, 9, 1, 10, 5));
  received.length = 0;
  await push.runDailyPush(morning);
  await push.runDailyPush(morning); // retry/second server: nothing extra
  const fan = received.filter((x) => x.path === '/push/fan');
  assert.equal(fan.length, 1, 'exactly one daily message');
  assert.equal(received.filter((x) => x.path === '/push/quiet').length, 0, 'opted-out device gets nothing');
  const msgs = [];
  for (let d = 0; d < 5; d++) msgs.push(await push.dailyMessage(new Date(Date.UTC(2026, 9, 1 + d, 10))));
  assert.ok(msgs.some((m) => m.title.startsWith('Maakye')));
  assert.ok(msgs.some((m) => /from GHS 5\.00/.test(m.body)), 'uses the real cheapest live price');
  // turn daily messages off for this device via preferences
  assert.equal((await c.post('/api/push/preferences', { endpoint: sub('fan').endpoint, marketing: false })).status, 200);
  received.length = 0;
  await push.runDailyPush(new Date(Date.UTC(2026, 9, 2, 10, 5)));
  assert.equal(received.filter((x) => x.path === '/push/fan').length, 0);
});

test('smart reminder replaces the daily message when the last bundle is probably finishing', async () => {
  // A logged-in customer bought 1GB and it was delivered 4 days ago.
  const cust = new Client();
  await cust.post('/api/auth/register', { full_name: 'Ama Owusu', email: 'ama@example.com', phone: '0241110000', password: 'Str0ngPassw0rd' });
  await cust.post('/api/push/subscribe', { subscription: sub('ama') });
  const product = (await sql(`SELECT * FROM products WHERE name = '1GB'`))[0];
  const o = await checkout(cust, product, { recipient_phone: '0241110000' });
  await payOrder(o.data.reference);
  await mod.jobs.drainJobs();
  await sql(`UPDATE orders SET is_test = false, delivered_at = now() - interval '4 days', created_at = now() - interval '4 days' WHERE reference = $1`, [o.data.reference]);
  received.length = 0;
  await push.runDailyPush(new Date());
  const got = received.filter((x) => x.path === '/push/ama');
  assert.equal(got.length, 1);
  assert.match(got[0].payload.title, /Your 1GB MTN may be running low/);
  assert.match(got[0].payload.url, new RegExp(`/checkout\\?product=${product.id}&network=MTN&phone=0241110000`));
  assert.match(got[0].payload.body, /024\*\*\*\*000/);
  assert.equal(push.reminderDays(1024), 3); assert.equal(push.reminderDays(10240), 12);
});

test('a device the browser has dropped (410) is disabled and not messaged again', async () => {
  const c = new Client();
  await c.post('/api/push/subscribe', { subscription: sub('gone') });
  respond = 410;
  await push.runDailyPush(new Date(Date.UTC(2026, 9, 3, 11)));
  respond = 201;
  const row = (await sql(`SELECT disabled_at FROM push_subscriptions WHERE endpoint LIKE '%/push/gone'`))[0];
  assert.ok(row.disabled_at);
  const st = await c.post('/api/push/status', { endpoint: sub('gone').endpoint });
  assert.equal(st.data.subscribed, false);
});

test('admin stats show real counts', async () => {
  const s = await owner.get('/api/admin/push');
  assert.equal(s.status, 200);
  assert.ok(s.data.stats.active >= 3);
  assert.equal(s.data.configured, true);
});
