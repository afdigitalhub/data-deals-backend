import { z } from 'zod';
import { one, q, tx, isUniqueViolation } from '../db/pool.js';
import { hashPassword, humanCode, verifyPassword } from '../lib/crypto.js';
import { page, zEmail, zId, zName, zNetwork, zPassword, zPhone, zText } from '../lib/util.js';
import { HttpError, conflict, notFound, type Router } from '../http/core.js';
import { rateLimit } from '../http/security.js';
import { requireUser, revokeAllSessions } from '../auth/sessions.js';
import { getSetting } from '../services/settings.js';
import { publicOrder } from './public.js';
import { STATUS_LABEL, type OrderStatus } from '../services/orders.js';

export function registerAccountRoutes(r: Router) {
  r.get('/api/account/profile', requireUser, async (ctx) => {
    const u = await one('SELECT id, email, phone, full_name, role, created_at, last_login_at FROM users WHERE id = $1', [ctx.user!.id]);
    return { profile: { id: u.id, email: u.email, phone: u.phone, fullName: u.full_name, role: u.role, createdAt: u.created_at, lastLoginAt: u.last_login_at } };
  });

  r.patch('/api/account/profile', requireUser, async (ctx) => {
    const b = z.object({ full_name: zName, phone: zPhone, email: zEmail, current_password: z.string().max(200).optional() }).parse(ctx.body);
    const u = await one('SELECT email, password_hash FROM users WHERE id = $1', [ctx.user!.id]);
    if (b.email !== u.email.toLowerCase()) {
      if (!b.current_password || !(await verifyPassword(b.current_password, u.password_hash))) throw new HttpError(400, 'Enter your current password to change your email', 'password_required');
    }
    try {
      await q('UPDATE users SET full_name = $2, phone = $3, email = $4, updated_at = now() WHERE id = $1', [ctx.user!.id, b.full_name, b.phone, b.email]);
    } catch (e) {
      if (isUniqueViolation(e)) throw conflict('That email is already used by another account', 'email_taken');
      throw e;
    }
    return { ok: true };
  });

  r.post('/api/account/password', requireUser, rateLimit('pw-change', 10, 60 * 60_000), async (ctx) => {
    const b = z.object({ current_password: z.string().min(1).max(200), new_password: zPassword }).parse(ctx.body);
    const u = await one('SELECT password_hash FROM users WHERE id = $1', [ctx.user!.id]);
    if (!(await verifyPassword(b.current_password, u.password_hash))) throw new HttpError(400, 'Current password is incorrect', 'bad_password');
    const hash = await hashPassword(b.new_password);
    await q('UPDATE users SET password_hash = $2, password_changed_at = now(), updated_at = now() WHERE id = $1', [ctx.user!.id, hash]);
    await revokeAllSessions(ctx.user!.id, ctx.sessionId);
    return { ok: true };
  });

  r.get('/api/account/sessions', requireUser, async (ctx) => {
    const rows = await q(`SELECT id, ip, user_agent, created_at, last_seen_at FROM sessions WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now() ORDER BY last_seen_at DESC`, [ctx.user!.id]);
    return { sessions: rows.map((s) => ({ ...s, current: s.id === ctx.sessionId })) };
  });

  r.post('/api/account/sessions/revoke-others', requireUser, async (ctx) => {
    await revokeAllSessions(ctx.user!.id, ctx.sessionId);
    return { ok: true };
  });

  r.get('/api/account/orders', requireUser, async (ctx) => {
    const { limit, offset, page: p, pageSize } = page(ctx.query, 20);
    const rows = await q(`SELECT reference, status, kind, network_code, product_snapshot, recipient_phone, total_minor, face_value_minor, created_at, is_test,
        count(*) OVER()::int AS total FROM orders WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`, [ctx.user!.id, limit, offset]);
    return {
      orders: rows.map((o) => ({ reference: o.reference, status: o.status, statusLabel: STATUS_LABEL[o.status as OrderStatus], kind: o.kind, network: o.network_code, product: o.product_snapshot, recipientPhone: o.recipient_phone, totalMinor: o.total_minor, faceValueMinor: o.face_value_minor, createdAt: o.created_at, isTest: o.is_test })),
      page: p, pageSize, total: rows[0]?.total ?? 0,
    };
  });

  // Dashboard numbers — real figures from this customer's own orders only.
  r.get('/api/account/summary', requireUser, async (ctx) => {
    const s = await one(`SELECT
        count(*) FILTER (WHERE status = 'successful')::int AS delivered,
        count(*) FILTER (WHERE created_at >= date_trunc('day', now()))::int AS orders_today,
        count(*) FILTER (WHERE status = 'successful' AND delivered_at >= date_trunc('month', now()))::int AS delivered_month,
        COALESCE(sum(total_minor) FILTER (WHERE status = 'successful' AND delivered_at >= date_trunc('month', now())), 0)::bigint AS spent_month_minor,
        COALESCE(sum((product_snapshot->>'data_mb')::int) FILTER (WHERE kind = 'data' AND status = 'successful' AND delivered_at >= date_trunc('month', now())), 0)::bigint AS data_month_mb,
        count(*) FILTER (WHERE status IN ('paid','queued','processing','needs_review'))::int AS in_progress,
        count(*)::int AS total_orders
      FROM orders WHERE user_id = $1 AND is_test = false`, [ctx.user!.id]);
    const saved = await one('SELECT count(*)::int AS n FROM saved_recipients WHERE user_id = $1', [ctx.user!.id]);
    return { summary: {
      delivered: s.delivered, ordersToday: s.orders_today, deliveredThisMonth: s.delivered_month,
      spentThisMonthMinor: Number(s.spent_month_minor), dataThisMonthMb: Number(s.data_month_mb),
      inProgress: s.in_progress, totalOrders: s.total_orders, savedNumbers: saved.n,
    } };
  });

  r.get('/api/account/orders/:ref', requireUser, async (ctx) => {
    const o = await one('SELECT * FROM orders WHERE reference = $1 AND user_id = $2', [ctx.params.ref.toUpperCase(), ctx.user!.id]);
    if (!o) throw notFound('Order not found');
    return { order: await publicOrder(o) };
  });

  // Saved recipients
  r.get('/api/account/recipients', requireUser, async (ctx) => ({ recipients: await q('SELECT id, label, phone, network_code AS network FROM saved_recipients WHERE user_id = $1 ORDER BY label', [ctx.user!.id]) }));
  r.post('/api/account/recipients', requireUser, async (ctx) => {
    const b = z.object({ label: zText(40), phone: zPhone, network: zNetwork.nullable().optional() }).parse(ctx.body);
    const count = await one<{ n: number }>('SELECT count(*)::int AS n FROM saved_recipients WHERE user_id = $1', [ctx.user!.id]);
    if (count!.n >= 50) throw conflict('You can save up to 50 numbers');
    try {
      const row = await one('INSERT INTO saved_recipients (user_id, label, phone, network_code) VALUES ($1,$2,$3,$4) RETURNING id, label, phone, network_code AS network', [ctx.user!.id, b.label, b.phone, b.network ?? null]);
      ctx.json(201, { recipient: row });
    } catch (e) {
      if (isUniqueViolation(e)) throw conflict('This number is already saved');
      throw e;
    }
  });
  r.delete('/api/account/recipients/:id', requireUser, async (ctx) => {
    await q('DELETE FROM saved_recipients WHERE id = $1 AND user_id = $2', [zId.parse(ctx.params.id), ctx.user!.id]);
    return { ok: true };
  });

  // Notifications
  r.get('/api/account/notifications', requireUser, async (ctx) => ({
    notifications: await q(`SELECT n.id, n.type, n.title, n.body, n.read_at, n.created_at, o.reference AS order_reference FROM notifications n LEFT JOIN orders o ON o.id = n.order_id
      WHERE n.user_id = $1 AND n.channel = 'in_app' ORDER BY n.id DESC LIMIT 50`, [ctx.user!.id]),
  }));
  r.post('/api/account/notifications/read', requireUser, async (ctx) => {
    await q('UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL', [ctx.user!.id]);
    return { ok: true };
  });

  // Support tickets
  r.get('/api/account/tickets', requireUser, async (ctx) => ({
    tickets: await q(`SELECT t.reference, t.subject, t.category, t.status, t.created_at, t.updated_at,
        (SELECT author_type FROM support_messages m WHERE m.ticket_id = t.id ORDER BY m.id DESC LIMIT 1) AS last_author
      FROM support_tickets t WHERE t.user_id = $1 ORDER BY t.updated_at DESC LIMIT 100`, [ctx.user!.id]),
  }));

  // Agent programme
  r.get('/api/account/agent', requireUser, async (ctx) => {
    const s = await getSetting('agents');
    const agent = await one('SELECT * FROM agents WHERE user_id = $1', [ctx.user!.id]);
    if (!agent) return { enabled: !!s.enabled, agent: null };
    const bal = await one<{ balance: number; earned: number; sales: number }>(`SELECT COALESCE(sum(amount_minor),0)::bigint AS balance,
        COALESCE(sum(amount_minor) FILTER (WHERE type = 'commission'),0)::bigint AS earned, count(*) FILTER (WHERE type = 'commission')::int AS sales
      FROM agent_ledger WHERE agent_id = $1`, [agent.id]);
    const withdrawals = await q('SELECT id, amount_minor, momo_number, status, created_at, processed_at FROM agent_withdrawals WHERE agent_id = $1 ORDER BY id DESC LIMIT 20', [agent.id]);
    return { enabled: !!s.enabled, agent: { referralCode: agent.referral_code, status: agent.status, commissionBps: agent.commission_bps ?? s.default_commission_bps, balanceMinor: bal!.balance, earnedMinor: bal!.earned, sales: bal!.sales, minWithdrawalMinor: s.min_withdrawal_minor, withdrawals } };
  });

  r.post('/api/account/agent', requireUser, async (ctx) => {
    const s = await getSetting('agents');
    if (!s.enabled) throw conflict('The agent programme is not open yet');
    const existing = await one('SELECT id FROM agents WHERE user_id = $1', [ctx.user!.id]);
    if (existing) return { ok: true };
    for (let i = 0; i < 5; i++) {
      try {
        await q('INSERT INTO agents (user_id, name, phone, referral_code) VALUES ($1,$2,$3,$4)', [ctx.user!.id, ctx.user!.full_name, ctx.user!.phone || '', `AG${humanCode(6)}`]);
        return { ok: true };
      } catch (e) { if (!isUniqueViolation(e, 'agents_referral_code_key')) throw e; }
    }
    throw new HttpError(500, 'Could not create agent code, try again');
  });

  r.post('/api/account/agent/withdraw', requireUser, rateLimit('withdraw', 5, 60 * 60_000), async (ctx) => {
    const b = z.object({ amount_minor: z.number().int().positive(), momo_number: zPhone }).parse(ctx.body);
    const s = await getSetting('agents');
    if (b.amount_minor < s.min_withdrawal_minor) throw new HttpError(400, 'Amount is below the minimum withdrawal');
    await tx(async (db) => {
      const agent = await one(`SELECT * FROM agents WHERE user_id = $1 AND status = 'active' FOR UPDATE`, [ctx.user!.id], db);
      if (!agent) throw notFound('Agent account not found');
      const bal = await one<{ b: number }>('SELECT COALESCE(sum(amount_minor),0)::bigint AS b FROM agent_ledger WHERE agent_id = $1', [agent.id], db);
      if (bal!.b < b.amount_minor) throw conflict('Insufficient balance');
      const w = await one('INSERT INTO agent_withdrawals (agent_id, amount_minor, momo_number) VALUES ($1,$2,$3) RETURNING id', [agent.id, b.amount_minor, b.momo_number], db);
      await db.query(`INSERT INTO agent_ledger (agent_id, withdrawal_id, type, amount_minor, note) VALUES ($1,$2,'withdrawal',$3,'Withdrawal request')`, [agent.id, w.id, -b.amount_minor]);
    });
    return { ok: true };
  });
}
