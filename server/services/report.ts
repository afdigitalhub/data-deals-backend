import { one, q } from '../db/pool.js';
import { log } from '../lib/log.js';
import { enqueue, registerJob } from './jobs.js';
import { pushConfigured, queueUserPush, type PushMessage } from './push.js';

/**
 * Daily business report for the owners: yesterday's orders and sales, sent to their phones each morning
 * and shown at the top of the admin dashboard. Ghana is on UTC all year, so a UTC day is a Ghana day.
 */
const PAID_STATUSES = ['paid', 'queued', 'processing', 'needs_review', 'successful', 'failed', 'refund_pending', 'refunded'];

export const isoDay = (d: Date) => d.toISOString().slice(0, 10);

export interface DailyReport {
  day: string;
  orders: number;
  delivered: number;
  salesMinor: number;
  waiting: number;
  review: number;
  failed: number;
  refunded: number;
  topNetwork: string | null;
}

export async function dailyReport(day: string): Promise<DailyReport> {
  const r = await one(`SELECT
      count(*) FILTER (WHERE status = ANY($2::text[]))::int AS orders,
      count(*) FILTER (WHERE status = 'successful')::int AS delivered,
      COALESCE(sum(total_minor) FILTER (WHERE status = 'successful'), 0)::bigint AS sales_minor,
      count(*) FILTER (WHERE status IN ('paid', 'queued', 'processing'))::int AS waiting,
      count(*) FILTER (WHERE status = 'needs_review')::int AS review,
      count(*) FILTER (WHERE status = 'failed')::int AS failed,
      count(*) FILTER (WHERE status IN ('refund_pending', 'refunded'))::int AS refunded
    FROM orders WHERE is_test = false AND created_at >= $1::date AND created_at < $1::date + 1`, [day, PAID_STATUSES]);
  const top = await one(`SELECT network_code FROM orders WHERE is_test = false AND status = 'successful'
      AND created_at >= $1::date AND created_at < $1::date + 1 GROUP BY network_code ORDER BY count(*) DESC, network_code LIMIT 1`, [day]);
  return {
    day,
    orders: Number(r?.orders ?? 0),
    delivered: Number(r?.delivered ?? 0),
    salesMinor: Number(r?.sales_minor ?? 0),
    waiting: Number(r?.waiting ?? 0),
    review: Number(r?.review ?? 0),
    failed: Number(r?.failed ?? 0),
    refunded: Number(r?.refunded ?? 0),
    topNetwork: top?.network_code ?? null,
  };
}

const NETWORK_NAME: Record<string, string> = { MTN: 'MTN', TELECEL: 'Telecel', AT: 'AT' };
const ghs = (minor: number) => `GHS ${(minor / 100).toFixed(2).replace(/\.00$/, '')}`;
const dayLabel = (day: string) => new Date(day + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

export function reportMessage(r: DailyReport): PushMessage {
  const title = `📊 Data Glow report, ${dayLabel(r.day)}`;
  if (!r.orders) return { title, body: 'No paid orders that day. Share your flyer or price list today to bring in customers. 💙', url: '/admin', tag: 'owner-report' };
  const parts = [`${r.orders} order${r.orders === 1 ? '' : 's'}`, `${ghs(r.salesMinor)} delivered sales`, `${r.delivered} delivered`];
  if (r.waiting) parts.push(`${r.waiting} still processing`);
  if (r.review) parts.push(`${r.review} to check`);
  if (r.failed) parts.push(`${r.failed} failed`);
  if (r.refunded) parts.push(`${r.refunded} refunded`);
  let body = parts.join(' · ');
  if (r.topNetwork) body += `. Top network: ${NETWORK_NAME[r.topNetwork] ?? r.topNetwork}.`;
  if (r.failed || r.review) body += ' Open the dashboard to sort them out.';
  return { title, body, url: '/admin', tag: 'owner-report' };
}

async function ownerIds() {
  const rows = await q(`SELECT id FROM users WHERE role IN ('owner', 'admin') AND status = 'active'`);
  return rows.map((u) => Number(u.id));
}

/** Called every few minutes by the worker: from 7am, queue yesterday's report once. */
export async function scheduleOwnerReport(now = new Date()) {
  if (!pushConfigured() || now.getUTCHours() < 7) return;
  const day = isoDay(new Date(now.getTime() - 86_400_000));
  await enqueue('owner_report', { day }, { uniqueKey: `owner-report:${day}`, maxAttempts: 2 });
}

registerJob('owner_report', async (p) => {
  const ids = await ownerIds();
  if (!ids.length) return;
  const msg = reportMessage(await dailyReport(String(p.day)));
  await queueUserPush(ids, msg, `owner-report-push:${p.day}`);
  log.info('owner report queued', { day: p.day, owners: ids.length });
});
