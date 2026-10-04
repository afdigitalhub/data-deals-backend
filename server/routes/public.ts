import { z } from 'zod';
import { paymentsMode } from '../config.js';
import { one, q, isUniqueViolation } from '../db/pool.js';
import { accessToken, getDummyHash, hashPassword, humanCode, randomToken, safeEqual, sha256, verifyPassword } from '../lib/crypto.js';
import { log } from '../lib/log.js';
import { maskPhone, page, zEmail, zId, zName, zNetwork, zPassword, zPhone, zText } from '../lib/util.js';
import { HttpError, conflict, notFound, type Ctx, type Router } from '../http/core.js';
import { hit, rateLimit } from '../http/security.js';
import { createSession, destroySession, permissionsFor, requireUser, revokeAllSessions, type SessionUser } from '../auth/sessions.js';
import { paymentProvider } from '../payments/provider.js';
import { audit } from '../services/audit.js';
import { emailConfigured, sendEmail } from '../services/notify.js';
import { confirmPayment, createOrder, quote, retryPayment, STATUS_LABEL, type OrderStatus } from '../services/orders.js';
import { getSetting, getSettings, foundersOf } from '../services/settings.js';
import { config } from '../config.js';
import { tx } from '../db/pool.js';

const publicUser = (u: SessionUser) => ({ id: u.id, email: u.email, fullName: u.full_name, phone: u.phone, role: u.role, permissions: permissionsFor(u) });

function publicProduct(p: any) {
  return {
    id: p.id, kind: p.kind, network: p.network_code, name: p.name, category: p.category, dataMb: p.data_mb, validity: p.validity_label,
    priceMinor: p.price_minor, feeMinor: p.fee_minor, currency: p.currency,
    airtimeMinMinor: p.airtime_min_minor, airtimeMaxMinor: p.airtime_max_minor, airtimeFeeBps: p.airtime_fee_bps,
  };
}

/** Customer-safe view of an order (no internal costs, no admin notes). */
export async function publicOrder(o: any) {
  const events = await q(`SELECT event_type, to_status, created_at FROM order_events WHERE order_id = $1 AND to_status IS NOT NULL ORDER BY id`, [o.id]);
  const payment = await one(`SELECT channel, status, paid_at FROM payments WHERE order_id = $1 AND status = 'success' ORDER BY id LIMIT 1`, [o.id]);
  const refund = await one(`SELECT status, amount_minor, created_at FROM refunds WHERE order_id = $1 ORDER BY id DESC LIMIT 1`, [o.id]);
  return {
    reference: o.reference, status: o.status, statusLabel: STATUS_LABEL[o.status as OrderStatus], kind: o.kind, network: o.network_code,
    product: o.product_snapshot, recipientPhone: o.recipient_phone, faceValueMinor: o.face_value_minor,
    priceMinor: o.price_minor, feeMinor: o.fee_minor, totalMinor: o.total_minor, currency: o.currency,
    isTest: o.is_test, createdAt: o.created_at, paidAt: o.paid_at, deliveredAt: o.delivered_at,
    paymentChannel: payment?.channel ?? null, contactEmail: o.contact_email,
    timeline: events.map((e) => ({ status: e.to_status, label: STATUS_LABEL[e.to_status as OrderStatus], at: e.created_at })),
    refund: refund ? { status: refund.status, amountMinor: refund.amount_minor, requestedAt: refund.created_at } : null,
  };
}

/** Guest access: the order link carries an HMAC token. Signed-in owners and staff don't need it. */
export async function loadOrderForViewer(ctx: Ctx, reference: string) {
  const o = await one('SELECT * FROM orders WHERE reference = $1', [String(reference).toUpperCase()]);
  if (!o) throw notFound('Order not found');
  const token = ctx.query.get('t') || String(ctx.req.headers['x-order-token'] || '');
  const owner = ctx.user && o.user_id === ctx.user.id;
  const staff = ctx.user && ctx.user.role !== 'customer' && ctx.user.status === 'active';
  if (!owner && !staff && !(token && safeEqual(sha256(token), o.access_token_hash))) throw notFound('Order not found');
  return o;
}

const checkoutSchema = z.object({
  idempotency_key: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/, 'Invalid checkout session'),
  product_id: zId,
  network_code: zNetwork,
  recipient_phone: zPhone,
  amount_minor: z.number().int().positive().optional(),
  email: zEmail.optional(),
  contact_phone: zPhone.optional(),
  referral_code: z.string().trim().max(20).optional(),
  payment_method: z.enum(['mobile_money', 'card']).optional(),
});

export function registerPublicRoutes(r: Router) {
  r.get('/api/health', async () => {
    await q('SELECT 1');
    return { ok: true };
  });

  r.get('/api/public/config', async (ctx) => {
    const s = await getSettings();
    const networks = await q('SELECT code, name, prefixes FROM networks WHERE is_active ORDER BY sort_order');
    const mode = paymentsMode();
    ctx.json(200, {
      business: { name: s.business.name, tagline: s.business.tagline, supportEmail: s.business.support_email, supportPhone: s.business.support_phone, whatsappNumber: s.business.whatsapp_number, address: s.business.address, showFounders: s.business.show_founders, founders: s.business.show_founders ? foundersOf(s.business) : [] },
      maintenance: s.maintenance,
      notice: s.notice?.enabled && s.notice.message ? { enabled: true, message: s.notice.message } : { enabled: false, message: '' },
      networks,
      payments: { enabled: mode !== 'not_configured', testMode: mode !== 'live' },
      agentsEnabled: !!s.agents?.enabled,
      refundWindowDays: s.policies.refund_window_days,
    }, { 'Cache-Control': 'public, max-age=30' });
  });

  r.get('/api/public/products', async (ctx) => {
    const kind = ctx.query.get('kind');
    const network = ctx.query.get('network');
    const rows = await q(`SELECT p.* FROM products p JOIN networks n ON n.code = p.network_code AND n.is_active
       WHERE p.status = 'live' AND ($1::text IS NULL OR p.kind = $1) AND ($2::text IS NULL OR p.network_code = $2)
       ORDER BY n.sort_order, p.kind, p.sort_order, p.price_minor NULLS LAST, p.id`, [kind || null, network || null]);
    ctx.json(200, { products: rows.map(publicProduct) }, { 'Cache-Control': 'public, max-age=60' });
  });

  // ---------- Checkout ----------
  r.post('/api/checkout/quote', rateLimit('quote', 120, 60_000), async (ctx) => {
    const b = z.object({ product_id: zId, amount_minor: z.number().int().positive().optional() }).parse(ctx.body);
    const { quote: qt } = await quote(b.product_id, b.amount_minor);
    return { quote: { productId: qt.productId, kind: qt.kind, network: qt.network, name: qt.name, faceValueMinor: qt.faceValueMinor, priceMinor: qt.priceMinor, feeMinor: qt.feeMinor, totalMinor: qt.totalMinor, currency: qt.currency } };
  });

  r.post('/api/checkout/orders', rateLimit('checkout', 20, 10 * 60_000), async (ctx) => {
    const b = checkoutSchema.parse(ctx.body);
    if (ctx.user && ctx.user.status !== 'active') throw new HttpError(403, 'Your account is restricted. Please contact support.', 'restricted');
    return createOrder(ctx, {
      idempotencyKey: b.idempotency_key, productId: b.product_id, networkCode: b.network_code, recipientPhone: b.recipient_phone,
      amountMinor: b.amount_minor, email: b.email, contactPhone: b.contact_phone, referralCode: b.referral_code, paymentMethod: b.payment_method,
    });
  });

  r.get('/api/orders/:ref', rateLimit('order-view', 120, 60_000), async (ctx) => {
    let o = await loadOrderForViewer(ctx, ctx.params.ref);
    // While waiting for payment, check with Paystack directly (throttled), in case the webhook is delayed.
    if (['pending_payment', 'payment_failed'].includes(o.status)) {
      const pay = await one(`SELECT provider_reference, verified_at FROM payments WHERE order_id = $1 AND status = 'initialized' ORDER BY id DESC LIMIT 1`, [o.id]);
      if (pay && (!pay.verified_at || Date.now() - new Date(pay.verified_at).getTime() > 8_000)) {
        try { await confirmPayment(pay.provider_reference, 'verify'); } catch (e) { log.warn('verify on view failed', { err: e }); }
        o = (await one('SELECT * FROM orders WHERE id = $1', [o.id]))!;
      }
    }
    return { order: await publicOrder(o) };
  });

  // Guest order tracking: the order number plus the phone number used on the order (recipient or contact).
  r.post('/api/orders/track', rateLimit('track', 15, 10 * 60_000), async (ctx) => {
    const b = z.object({ reference: z.string().trim().min(6).max(20), phone: zPhone }).parse(ctx.body);
    const reference = b.reference.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!(config.isTest && process.env.RATE_LIMITS !== 'on')) hit(`track-ref:${reference}`, 10, 60 * 60_000);
    const o = await one(`SELECT reference FROM orders WHERE reference = $1 AND (recipient_phone = $2 OR contact_phone = $2)`, [reference, b.phone]);
    if (!o) throw notFound('We could not find an order with that order number and phone number. Check both and try again.');
    return { reference: o.reference, accessToken: accessToken('order', o.reference) };
  });

  r.post('/api/orders/:ref/pay', rateLimit('pay-again', 10, 10 * 60_000), async (ctx) => {
    const o = await loadOrderForViewer(ctx, ctx.params.ref);
    if (!['pending_payment', 'payment_failed'].includes(o.status)) throw conflict('This order no longer needs payment');
    const m = z.object({ payment_method: z.enum(['mobile_money', 'card']).optional() }).parse(ctx.body || {});
    return retryPayment(o, m.payment_method);
  });

  // ---------- Auth ----------
  r.post('/api/auth/register', rateLimit('register', 10, 60 * 60_000), async (ctx) => {
    const b = z.object({ full_name: zName, email: zEmail, phone: zPhone, password: zPassword }).parse(ctx.body);
    const hash = await hashPassword(b.password);
    let user: SessionUser | undefined;
    try {
      user = await one(`INSERT INTO users (email, phone, full_name, password_hash) VALUES ($1,$2,$3,$4) RETURNING id, email, full_name, phone, role, status`, [b.email, b.phone, b.full_name, hash]);
    } catch (e) {
      if (isUniqueViolation(e)) throw conflict('An account with this email already exists. Try logging in.', 'email_taken');
      throw e;
    }
    await createSession(ctx, user!);
    ctx.json(201, { user: publicUser(user!) });
  });

  r.post('/api/auth/login', rateLimit('login-ip', 20, 15 * 60_000), async (ctx) => {
    const b = z.object({ email: zEmail, password: z.string().min(1).max(200) }).parse(ctx.body);
    if (!(config.isTest && process.env.RATE_LIMITS !== 'on')) hit(`login-email:${b.email}`, 8, 15 * 60_000);
    const row = await one(`SELECT id, email, full_name, phone, role, status, password_hash FROM users WHERE lower(email) = $1`, [b.email]);
    const ok = row ? await verifyPassword(b.password, row.password_hash) : (await verifyPassword(b.password, await getDummyHash()), false);
    if (!row || !ok) throw new HttpError(401, 'Email or password is incorrect', 'bad_credentials');
    if (row.status !== 'active') throw new HttpError(403, 'Your account is restricted. Please contact support.', 'restricted');
    const { password_hash, ...user } = row;
    await createSession(ctx, user);
    await q('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);
    if (user.role !== 'customer') await audit({ ...ctx, user } as Ctx, 'admin.login', 'user', user.id, null, { ip: ctx.ip });
    return { user: publicUser(user) };
  });

  r.post('/api/auth/logout', async (ctx) => { await destroySession(ctx); return { ok: true }; });

  r.get('/api/auth/me', async (ctx) => ({ user: ctx.user ? publicUser(ctx.user) : null }));

  r.post('/api/auth/forgot', rateLimit('forgot', 5, 60 * 60_000), async (ctx) => {
    const b = z.object({ email: zEmail }).parse(ctx.body);
    const u = await one(`SELECT id, email FROM users WHERE lower(email) = $1 AND status = 'active'`, [b.email]);
    if (u && emailConfigured()) {
      const token = randomToken(32);
      await q(`INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1,$2, now() + interval '1 hour')`, [u.id, sha256(token)]);
      await sendEmail(u.email, 'Reset your Data Glow password', `Use this link within 1 hour to choose a new password:\n\n${config.publicBaseUrl}/reset-password?token=${token}\n\nIf you didn't ask for this, ignore this email.`);
    }
    // Same answer whether or not the account exists (prevents account discovery).
    return { ok: true, emailAvailable: emailConfigured() };
  });

  r.post('/api/auth/reset', rateLimit('reset', 10, 60 * 60_000), async (ctx) => {
    const b = z.object({ token: z.string().min(20).max(100), password: zPassword }).parse(ctx.body);
    const hash = await hashPassword(b.password);
    await tx(async (db) => {
      const t = await one(`SELECT * FROM password_reset_tokens WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now() FOR UPDATE`, [sha256(b.token)], db);
      if (!t) throw new HttpError(400, 'This reset link is invalid or has expired. Please request a new one.', 'bad_token');
      await db.query('UPDATE password_reset_tokens SET used_at = now() WHERE id = $1', [t.id]);
      await db.query('UPDATE users SET password_hash = $2, password_changed_at = now(), updated_at = now() WHERE id = $1', [t.user_id, hash]);
      await revokeAllSessions(t.user_id, null, db);
    });
    return { ok: true };
  });

  r.get('/api/auth/invite/:token', rateLimit('invite', 20, 60 * 60_000), async (ctx) => {
    const inv = await one(`SELECT role, label, expires_at FROM admin_invites WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()`, [sha256(ctx.params.token)]);
    if (!inv) throw notFound('This invite link is invalid, expired or already used.');
    return { invite: { role: inv.role, label: inv.label, expiresAt: inv.expires_at } };
  });

  r.post('/api/auth/invite/:token', rateLimit('invite', 20, 60 * 60_000), async (ctx) => {
    const b = z.object({ full_name: zName, email: zEmail, phone: zPhone, password: zPassword }).parse(ctx.body);
    const hash = await hashPassword(b.password);
    const user = await tx(async (db) => {
      const inv = await one(`SELECT * FROM admin_invites WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now() FOR UPDATE`, [sha256(ctx.params.token)], db);
      if (!inv) throw notFound('This invite link is invalid, expired or already used.');
      const existing = await one(`SELECT id FROM users WHERE lower(email) = $1`, [b.email], db);
      if (existing) throw conflict('An account with this email already exists. Ask the owner to change that account\'s role instead.', 'email_taken');
      const u = await one(`INSERT INTO users (email, phone, full_name, password_hash, role) VALUES ($1,$2,$3,$4,$5) RETURNING id, email, full_name, phone, role, status`, [b.email, b.phone, b.full_name, hash, inv.role], db);
      await db.query('UPDATE admin_invites SET used_at = now(), used_by_user_id = $2 WHERE id = $1', [inv.id, u.id]);
      await audit({ ...ctx, user: u } as Ctx, 'team.invite_accepted', 'user', u.id, null, { role: inv.role, label: inv.label }, db);
      return u as SessionUser;
    });
    await createSession(ctx, user);
    ctx.json(201, { user: publicUser(user) });
  });

  // ---------- Support (guests and customers) ----------
  r.post('/api/support/tickets', rateLimit('ticket', 8, 60 * 60_000), async (ctx) => {
    const b = z.object({
      name: zName.optional(), email: zEmail.optional(), phone: zPhone.optional(),
      category: z.enum(['general', 'order', 'failed_transaction', 'refund', 'account']),
      subject: zText(150, 3), message: zText(4000, 10),
      order_reference: z.string().trim().max(20).optional(), order_token: z.string().max(64).optional(),
    }).parse(ctx.body);
    const email = ctx.user?.email ?? b.email;
    if (!email) throw new HttpError(400, 'Enter your email so we can reply', 'email_required');
    let orderId: number | null = null;
    let order: any = null;
    if (b.order_reference) {
      order = await one('SELECT * FROM orders WHERE reference = $1', [b.order_reference.toUpperCase()]);
      const allowed = order && ((ctx.user && order.user_id === ctx.user.id) || (b.order_token && safeEqual(sha256(b.order_token), order.access_token_hash)) || order.contact_email === email.toLowerCase());
      if (!allowed) throw new HttpError(400, 'We could not find that order for your email. Check the reference.', 'order_not_found');
      orderId = order.id;
    }
    if (['refund', 'failed_transaction'].includes(b.category) && !orderId) throw new HttpError(400, 'Add the order reference for refund or failed-transaction reports', 'order_required');
    const ticket = await tx(async (db) => {
      let t: any;
      for (let i = 0; i < 5 && !t; i++) {
        const reference = `T${humanCode(7)}`;
        try {
          t = await one(`INSERT INTO support_tickets (reference, access_token_hash, user_id, name, email, phone, order_id, category, subject) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
            [reference, sha256(accessToken('ticket', reference)), ctx.user?.id ?? null, b.name ?? ctx.user?.full_name ?? null, email, b.phone ?? ctx.user?.phone ?? null, orderId, b.category, b.subject], db);
        } catch (e) { if (!isUniqueViolation(e, 'support_tickets_reference_key')) throw e; }
      }
      await db.query(`INSERT INTO support_messages (ticket_id, author_type, author_user_id, body) VALUES ($1,'customer',$2,$3)`, [t.id, ctx.user?.id ?? null, b.message]);
      // A refund request on a failed delivery is recorded for admin review (never auto-refunded).
      if (b.category === 'refund' && order && order.status === 'failed') {
        const pay = await one(`SELECT id, amount_minor FROM payments WHERE order_id = $1 AND status = 'success' ORDER BY id LIMIT 1`, [order.id], db);
        if (pay) await db.query(`INSERT INTO refunds (order_id, payment_id, amount_minor, reason, status, requested_by_type, requested_by_user_id) VALUES ($1,$2,$3,$4,'requested','customer',$5) ON CONFLICT DO NOTHING`,
          [order.id, pay.id, pay.amount_minor, `Customer request (ticket ${t.reference}): ${b.subject}`, ctx.user?.id ?? null]);
      }
      return t;
    });
    ctx.json(201, { ticket: { reference: ticket.reference, accessToken: accessToken('ticket', ticket.reference), status: ticket.status } });
  });

  r.get('/api/support/tickets/:ref', rateLimit('ticket-view', 60, 60_000), async (ctx) => {
    const t = await loadTicketForViewer(ctx, ctx.params.ref);
    const messages = await q(`SELECT author_type, body, created_at FROM support_messages WHERE ticket_id = $1 ORDER BY id`, [t.id]);
    const order = t.order_id ? await one('SELECT reference FROM orders WHERE id = $1', [t.order_id]) : null;
    return { ticket: { reference: t.reference, subject: t.subject, category: t.category, status: t.status, createdAt: t.created_at, orderReference: order?.reference ?? null, messages } };
  });

  r.post('/api/support/tickets/:ref/messages', rateLimit('ticket-reply', 20, 60 * 60_000), async (ctx) => {
    const t = await loadTicketForViewer(ctx, ctx.params.ref);
    const b = z.object({ message: zText(4000, 2) }).parse(ctx.body);
    if (t.status === 'closed') throw conflict('This ticket is closed. Please open a new one.');
    await q(`INSERT INTO support_messages (ticket_id, author_type, author_user_id, body) VALUES ($1,'customer',$2,$3)`, [t.id, ctx.user?.id ?? null, b.message]);
    await q(`UPDATE support_tickets SET status = 'open', updated_at = now() WHERE id = $1`, [t.id]);
    return { ok: true };
  });
}

async function loadTicketForViewer(ctx: Ctx, reference: string) {
  const t = await one('SELECT * FROM support_tickets WHERE reference = $1', [String(reference).toUpperCase()]);
  if (!t) throw notFound('Ticket not found');
  const token = ctx.query.get('t') || String(ctx.req.headers['x-ticket-token'] || '');
  const owner = ctx.user && t.user_id === ctx.user.id;
  if (!owner && !(token && safeEqual(sha256(token), t.access_token_hash))) throw notFound('Ticket not found');
  return t;
}

export { publicProduct };
