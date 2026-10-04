import { config } from '../config.js';
import { q, type Queryable } from '../db/pool.js';
import { log } from '../lib/log.js';
import { getSetting } from './settings.js';
import { queueOrderPush, queueUserPush } from './push.js';

export function emailConfigured() {
  return !!(config.email.resendApiKey && config.email.from);
}

/** Sends an email through Resend when configured. Returns false (never throws) when email is unavailable. */
export async function sendEmail(to: string, subject: string, text: string): Promise<boolean> {
  if (!emailConfigured() || config.isTest) return false;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.email.resendApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: config.email.from, to: [to], subject, text }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) { log.warn('email send failed', { status: res.status }); return false; }
    return true;
  } catch (e) {
    log.warn('email send error', { err: e });
    return false;
  }
}

/** Records an in-app notification and, when enabled, also emails it. */
export async function notify(opts: { userId: number | null; email?: string | null; orderId?: number | null; type: string; title: string; body: string }, db?: Queryable) {
  if (opts.userId) {
    await q('INSERT INTO notifications (user_id, order_id, type, title, body, channel, status) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [opts.userId, opts.orderId ?? null, opts.type, opts.title, opts.body, 'in_app', 'sent'], db);
  }
  // Phone notification to the customer's devices (and guests watching this order), sent after the transaction commits.
  if (opts.orderId && opts.type.startsWith('order_')) {
    const emoji = opts.type === 'order_delivered' ? '✅ ' : opts.type === 'order_failed' ? '⚠️ ' : opts.type === 'order_refunded' ? '💸 ' : '';
    await queueOrderPush(opts.orderId, { title: emoji + opts.title, body: opts.body, tag: opts.type }, db);
  }
  if (opts.email) {
    const n = await getSetting('notifications');
    if (n?.email_enabled && emailConfigured()) {
      // Fire and forget: email delivery must never block order processing.
      sendEmail(opts.email, opts.title, opts.body).catch(() => {});
    }
  }
}

export async function alertAdmins(subject: string, body: string) {
  const n = await getSetting('notifications');
  if (n?.admin_alert_email) sendEmail(n.admin_alert_email, `[Data Glow] ${subject}`, body).catch(() => {});
  log.warn('admin alert', { subject });
  try {
    const staff = await q<{ id: number }>(`SELECT id FROM users WHERE role <> 'customer' AND status = 'active'`);
    if (staff.length) {
      // One phone alert per subject every 10 minutes, so a run of failures does not spam the team.
      await queueUserPush(staff.map((u) => Number(u.id)), { title: `⚠️ ${subject}`, body: body.slice(0, 160), url: '/admin', tag: 'admin-alert' }, `admin-alert:${subject}:${Math.floor(Date.now() / 600_000)}`);
    }
  } catch (e) { log.warn('admin alert push failed', { error: e instanceof Error ? e.message : String(e) }); }
}
