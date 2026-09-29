import { config } from '../config.js';
import { one, q, type Queryable } from '../db/pool.js';
import { log } from '../lib/log.js';
import { sendWebPush, type PushResult } from '../lib/webpush.js';
import { accessToken } from '../lib/crypto.js';
import { enqueue, registerJob } from './jobs.js';
import { getSetting } from './settings.js';

export const pushConfigured = () => !!(config.push.publicKey && config.push.privateKey);
const vapid = () => ({ publicKey: config.push.publicKey, privateKey: config.push.privateKey, subject: config.push.subject || config.publicBaseUrl || 'https://datacedi.onrender.com' });

export interface PushMessage { title: string; body: string; url?: string; tag?: string }

/** For tests: every message "sent" when running against the local fake push service is also recorded here. */
export const sentLog: Array<{ subscriptionId: number; msg: PushMessage; result: PushResult }> = [];

async function deliver(sub: any, msg: PushMessage, opts: { urgency?: 'low' | 'normal' | 'high'; ttl?: number } = {}): Promise<boolean> {
  let result: PushResult;
  try {
    result = await sendWebPush({ endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth }, { ...msg, url: msg.url || '/', icon: '/icons/icon-192.png', badge: '/icons/badge-72.png' }, vapid(), { ...opts, topic: msg.tag });
  } catch (e) {
    result = { ok: false, status: 0, gone: false, message: e instanceof Error ? e.message : 'send failed' };
  }
  if (config.isTest) sentLog.push({ subscriptionId: Number(sub.id), msg, result });
  if (result.ok) {
    await q('UPDATE push_subscriptions SET last_sent_at = now(), last_success_at = now(), failure_count = 0, updated_at = now() WHERE id = $1', [sub.id]);
    return true;
  }
  // 404/410: the browser dropped this subscription (app uninstalled, permission revoked). Stop sending to it.
  await q(`UPDATE push_subscriptions SET last_sent_at = now(), failure_count = failure_count + 1,
           disabled_at = CASE WHEN $2 OR failure_count + 1 >= 5 THEN now() ELSE disabled_at END, updated_at = now() WHERE id = $1`, [sub.id, !result.ok && result.gone]);
  if (!result.gone) log.warn('push send failed', { sub: sub.id, status: result.status });
  return false;
}

async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const it = items[i++]; await fn(it); } }));
}

// ---------- Order updates (delivered / failed / refunded) ----------
/** Queue an order update inside the same transaction as the status change; sent after commit by the worker. */
export async function queueOrderPush(orderId: number, msg: PushMessage, db?: Queryable) {
  if (!pushConfigured()) return;
  await enqueue('push_order', { orderId, msg }, { uniqueKey: `push-order:${orderId}:${msg.tag || msg.title}`.slice(0, 200) }, db);
}

registerJob('push_order', async ({ orderId, msg }: { orderId: number; msg: PushMessage }) => {
  const subs = await q(`SELECT DISTINCT s.* FROM push_subscriptions s
      LEFT JOIN orders o ON o.id = $1
      WHERE s.disabled_at IS NULL AND ((o.user_id IS NOT NULL AND s.user_id = o.user_id) OR s.id IN (SELECT subscription_id FROM push_order_watch WHERE order_id = $1))`, [orderId]);
  const o = await one('SELECT reference FROM orders WHERE id = $1', [orderId]);
  const url = o ? `/order/${o.reference}?t=${accessToken('order', o.reference)}` : '/';
  await pool(subs, 5, async (s) => {
    const ok = await deliver(s, { ...msg, url }, { urgency: 'high' });
    await q(`INSERT INTO push_log (subscription_id, kind, order_id, title, ok) VALUES ($1,'order',$2,$3,$4)`, [s.id, orderId, msg.title, ok]);
  });
});

// ---------- Daily message + smart "running low" reminders ----------
export const accraNow = (d = new Date()) => {
  // Ghana is UTC+0 all year (no daylight saving).
  return { hour: d.getUTCHours(), day: d.toISOString().slice(0, 10), dow: d.getUTCDay() };
};
export function greetingFor(hour: number) { return hour < 12 ? 'Maakye' : hour < 16 ? 'Maaha' : 'Maadwo'; }

/** Rough days until a data bundle is used up, by size. Deliberately conservative wording is used in the message ("may be"). */
export function reminderDays(dataMb: number | null) {
  const gb = (dataMb || 0) / 1024;
  if (gb <= 1) return 3;
  if (gb <= 3) return 5;
  if (gb <= 6) return 7;
  if (gb <= 15) return 12;
  return 20;
}

const ghs = (minor: number) => `GHS ${(minor / 100).toFixed(2)}`;
const size = (mb: number | null) => (!mb ? '' : mb % 1024 === 0 ? `${mb / 1024}GB` : `${mb}MB`);
const NET: Record<string, string> = { MTN: 'MTN', TELECEL: 'Telecel', AT: 'AT' };

export async function dailyMessage(now = new Date()): Promise<PushMessage> {
  const s = await getSetting('push');
  const { hour, day } = accraNow(now);
  const g = greetingFor(hour);
  if (s?.custom_message) return { title: s.custom_title || `${g}! 👋`, body: s.custom_message, url: '/?utm_source=push&utm_medium=daily', tag: 'daily' };
  const cheapest = await one(`SELECT min(price_minor + fee_minor)::bigint AS p FROM products WHERE status = 'live' AND kind = 'data'`);
  const from = cheapest?.p ? ` from ${ghs(Number(cheapest.p))}` : '';
  const list: Array<[string, string]> = [
    [`${g}! 📶 Data finish?`, `Top up MTN, Telecel or AT in seconds${from}. Pay with MoMo.`],
    [`${g}! Stay connected today`, `Bundles go straight to your phone. Buy for yourself or someone you love.`],
    [`Wo data te sɛn? 🤔`, `How's your data? Don't get caught without it. MTN, Telecel & AT${from}.`],
    [`Yɛda wo ase! 🙏`, `Thanks for choosing DataCedi. Need data today? It takes less than a minute.`],
    [`${g}! Akwaaba ☀️`, `Your next bundle is a few taps away on DataCedi. Fast, secure, reliable.`],
  ];
  const n = Math.floor(Date.parse(day) / 86_400_000) % list.length;
  const [title, body] = list[n];
  return { title, body, url: '/?utm_source=push&utm_medium=daily', tag: 'daily' };
}

/** Personalised reminder when this device's owner's last data bundle is probably finishing. Null when not due. */
export async function reminderFor(sub: any, now = new Date()): Promise<{ msg: PushMessage; orderId: number } | null> {
  if (!sub.user_id) return null;
  const o = await one(`SELECT o.id, o.reference, o.recipient_phone, o.network_code, o.delivered_at, o.product_id, o.product_snapshot
      FROM orders o WHERE o.user_id = $1 AND o.kind = 'data' AND o.status = 'successful' AND o.is_test = false
      ORDER BY o.delivered_at DESC NULLS LAST LIMIT 1`, [sub.user_id]);
  if (!o?.delivered_at) return null;
  // Skip if they already bought something newer (any status past payment).
  const newer = await one(`SELECT 1 FROM orders WHERE user_id = $1 AND id <> $3 AND created_at > $2 AND status NOT IN ('pending_payment','payment_failed','expired') LIMIT 1`, [sub.user_id, o.delivered_at, o.id]);
  if (newer) return null;
  const mb = o.product_snapshot?.data_mb ?? null;
  const days = (now.getTime() - new Date(o.delivered_at).getTime()) / 86_400_000;
  if (days < reminderDays(mb) || days > 45) return null;
  const p = await one(`SELECT id, price_minor, fee_minor, network_code FROM products WHERE id = $1 AND status = 'live'`, [o.product_id]);
  if (!p) return null;
  const { hour } = accraNow(now);
  const label = `${size(mb)} ${NET[o.network_code] || o.network_code}`.trim();
  const phone = String(o.recipient_phone);
  return {
    orderId: Number(o.id),
    msg: {
      title: `${greetingFor(hour)}! Your ${label} may be running low 📶`,
      body: `Buy it again for ${phone.slice(0, 3)}****${phone.slice(-3)} in one tap: ${ghs(Number(p.price_minor) + Number(p.fee_minor))}.`,
      url: `/checkout?product=${p.id}&network=${p.network_code}&phone=${phone}&utm_source=push&utm_medium=reminder`,
      tag: 'reminder',
    },
  };
}

/** Called every few minutes by the worker; queues today's run once the configured hour has passed. */
export async function scheduleDailyPush(now = new Date()) {
  if (!pushConfigured()) return;
  const s = await getSetting('push');
  if (!s || (!s.daily_enabled && !s.reminders_enabled)) return;
  const { hour, day } = accraNow(now);
  if (hour < s.send_hour || hour > 21) return;
  await enqueue('push_daily', { day }, { uniqueKey: `push-daily:${day}`, maxAttempts: 2 });
}

export async function runDailyPush(now = new Date(), onlySubscriptionIds?: number[]) {
  const s = await getSetting('push');
  if (!s) return { sent: 0 };
  const { day } = accraNow(now);
  const subs = await q(`SELECT * FROM push_subscriptions WHERE disabled_at IS NULL AND marketing = true ${onlySubscriptionIds ? 'AND id = ANY($1)' : ''} ORDER BY id`, onlySubscriptionIds ? [onlySubscriptionIds] : []);
  const generic = s.daily_enabled ? await dailyMessage(now) : null;
  let sent = 0;
  await pool(subs, 8, async (sub) => {
    const rem = s.reminders_enabled ? await reminderFor(sub, now) : null;
    const msg = rem?.msg ?? generic;
    if (!msg) return;
    // Claim today's slot for this device first, so a retry or a second server can never double-send.
    const claimed = await one(`INSERT INTO push_log (subscription_id, kind, day, order_id, title) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING id`,
      [sub.id, rem ? 'reminder' : 'daily', day, rem?.orderId ?? null, msg.title]);
    if (!claimed) return;
    const ok = await deliver(sub, msg, { urgency: 'normal', ttl: 6 * 3600 });
    await q('UPDATE push_log SET ok = $2 WHERE id = $1', [claimed.id, ok]);
    if (ok) sent++;
  });
  log.info('daily push done', { day, devices: subs.length, sent });
  return { sent, devices: subs.length };
}

registerJob('push_daily', async () => { await runDailyPush(); });

export async function sendTest(userId: number) {
  const subs = await q('SELECT * FROM push_subscriptions WHERE user_id = $1 AND disabled_at IS NULL', [userId]);
  let ok = 0;
  for (const s of subs) {
    const good = await deliver(s, { title: 'DataCedi test ✅', body: 'Phone notifications are working on this device.', url: '/account', tag: 'test' }, { urgency: 'high' });
    await q(`INSERT INTO push_log (subscription_id, kind, title, ok) VALUES ($1,'test','test',$2)`, [s.id, good]);
    if (good) ok++;
  }
  return { devices: subs.length, delivered: ok };
}

// ---------- Messages to specific people (live chat replies, team chat) ----------
export async function queueUserPush(userIds: number[], msg: PushMessage, uniqueKey: string) {
  if (!pushConfigured() || !userIds.length) return;
  await enqueue('push_users', { userIds, msg }, { uniqueKey: uniqueKey.slice(0, 200) });
}
registerJob('push_users', async ({ userIds, msg }: { userIds: number[]; msg: PushMessage }) => {
  const subs = await q('SELECT * FROM push_subscriptions WHERE disabled_at IS NULL AND user_id = ANY($1)', [userIds]);
  await pool(subs, 5, async (s) => { await deliver(s, msg, { urgency: 'high', ttl: 3600 }); });
});
