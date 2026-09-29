import { z } from 'zod';
import { config } from '../config.js';
import { one, q } from '../db/pool.js';
import { notFound, HttpError, type Router } from '../http/core.js';
import { rateLimit } from '../http/security.js';
import { requirePerm } from '../auth/sessions.js';
import { isAllowedPushEndpoint } from '../lib/webpush.js';
import { audit } from '../services/audit.js';
import { enqueue } from '../services/jobs.js';
import { accraNow, pushConfigured, runDailyPush, sendTest } from '../services/push.js';
import { loadOrderForViewer } from './public.js';

const zSub = z.object({
  endpoint: z.string().url().max(1000),
  keys: z.object({ p256dh: z.string().regex(/^[A-Za-z0-9_-]{80,100}$/), auth: z.string().regex(/^[A-Za-z0-9_-]{16,40}$/) }),
});

export function registerPushRoutes(r: Router) {
  r.get('/api/push/config', async () => ({ enabled: pushConfigured(), publicKey: pushConfigured() ? config.push.publicKey : null }));

  // Save (or refresh) this device's subscription. Linked to the account when logged in.
  r.post('/api/push/subscribe', rateLimit('push-sub', 30, 10 * 60_000), async (ctx) => {
    if (!pushConfigured()) throw new HttpError(503, 'Phone notifications are not switched on yet', 'push_disabled');
    const b = z.object({ subscription: zSub, marketing: z.boolean().default(true), order_reference: z.string().max(20).optional() }).parse(ctx.body);
    if (!isAllowedPushEndpoint(b.subscription.endpoint, config.push.allowAnyHost)) throw new HttpError(400, 'This browser push service is not supported', 'bad_endpoint');
    const ua = String(ctx.req.headers['user-agent'] || '').slice(0, 300);
    const row = await one(`INSERT INTO push_subscriptions (endpoint, p256dh, auth, user_id, marketing, user_agent)
        VALUES ($1,$2,$3,$4,$5,$6)
        ON CONFLICT (endpoint) DO UPDATE SET p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, user_id = COALESCE(EXCLUDED.user_id, push_subscriptions.user_id),
          marketing = EXCLUDED.marketing, user_agent = EXCLUDED.user_agent, disabled_at = NULL, failure_count = 0, updated_at = now()
        RETURNING id, marketing`, [b.subscription.endpoint, b.subscription.keys.p256dh, b.subscription.keys.auth, ctx.user?.id ?? null, b.marketing, ua]);
    if (b.order_reference) {
      const o = await loadOrderForViewer(ctx, b.order_reference);
      await q('INSERT INTO push_order_watch (subscription_id, order_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [row.id, o.id]);
    }
    return { ok: true, marketing: row.marketing };
  });

  r.post('/api/push/status', rateLimit('push-status', 60, 10 * 60_000), async (ctx) => {
    const b = z.object({ endpoint: z.string().url().max(1000) }).parse(ctx.body);
    const s = await one('SELECT marketing, disabled_at FROM push_subscriptions WHERE endpoint = $1', [b.endpoint]);
    return { subscribed: !!s && !s.disabled_at, marketing: !!s?.marketing };
  });

  // Customers can turn daily messages off (and back on) at any time; order updates keep working.
  r.post('/api/push/preferences', rateLimit('push-pref', 30, 10 * 60_000), async (ctx) => {
    const b = z.object({ endpoint: z.string().url().max(1000), marketing: z.boolean() }).parse(ctx.body);
    const s = await one('UPDATE push_subscriptions SET marketing = $2, updated_at = now() WHERE endpoint = $1 RETURNING id', [b.endpoint, b.marketing]);
    if (!s) throw notFound('This device is not subscribed');
    return { ok: true, marketing: b.marketing };
  });

  r.post('/api/push/unsubscribe', rateLimit('push-unsub', 30, 10 * 60_000), async (ctx) => {
    const b = z.object({ endpoint: z.string().url().max(1000) }).parse(ctx.body);
    await q('UPDATE push_subscriptions SET disabled_at = now(), updated_at = now() WHERE endpoint = $1', [b.endpoint]);
    return { ok: true };
  });

  // ---------- Admin ----------
  r.get('/api/admin/push', requirePerm('orders.view'), async (ctx) => {
    const st = await one(`SELECT count(*) FILTER (WHERE disabled_at IS NULL)::int AS active,
        count(*) FILTER (WHERE disabled_at IS NULL AND marketing)::int AS marketing,
        count(*) FILTER (WHERE disabled_at IS NULL AND user_id IS NOT NULL)::int AS logged_in,
        count(*) FILTER (WHERE disabled_at IS NULL AND user_id = $1)::int AS mine FROM push_subscriptions`, [ctx.user!.id]);
    const { day } = accraNow();
    const today = await one(`SELECT count(*) FILTER (WHERE kind = 'daily' AND ok)::int AS daily, count(*) FILTER (WHERE kind = 'reminder' AND ok)::int AS reminders,
        count(*) FILTER (WHERE kind = 'order' AND ok)::int AS orders FROM push_log WHERE day = $1`, [day]);
    const lastRun = await one(`SELECT max(created_at) AS at FROM push_log WHERE kind IN ('daily','reminder')`);
    return { configured: pushConfigured(), stats: st, today, lastRunAt: lastRun?.at ?? null };
  });

  r.post('/api/admin/push/test', requirePerm('settings.manage'), rateLimit('push-test', 10, 10 * 60_000), async (ctx) => {
    const res = await sendTest(ctx.user!.id);
    await audit(ctx, 'push.test', 'setting', 'push', null, res);
    return res;
  });

  // Send today's message now instead of waiting for the scheduled hour. Still at most one per device per day.
  r.post('/api/admin/push/send-today', requirePerm('settings.manage'), rateLimit('push-now', 5, 60 * 60_000), async (ctx) => {
    const { day } = accraNow();
    await enqueue('push_daily', { day, manual: true }, { uniqueKey: `push-daily:${day}`, maxAttempts: 2 });
    // If today's scheduled job already ran, run again: devices already messaged today are skipped automatically.
    const res = await runDailyPush();
    await audit(ctx, 'push.send_today', 'setting', 'push', null, res);
    return res;
  });
}
