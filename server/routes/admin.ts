import { z } from 'zod';
import { config, paymentsMode } from '../config.js';
import { one, q, tx } from '../db/pool.js';
import { randomToken, sha256 } from '../lib/crypto.js';
import { dateRange, maskEmail, maskPhone, page, zId, zNetwork, zText } from '../lib/util.js';
import { HttpError, conflict, forbidden, notFound, type Ctx, type Router } from '../http/core.js';
import { can, requirePerm, requireStaff, revokeAllSessions } from '../auth/sessions.js';
import { adapterFor } from '../suppliers/adapters.js';
import { audit } from '../services/audit.js';
import { emailConfigured } from '../services/notify.js';
import { dailyReport, isoDay } from '../services/report.js';
import {
  STATUS_LABEL, adminEscalate, adminMarkFailed, adminReconcile, adminRecordDelivery, adminRefund, adminRetry, type OrderStatus,
} from '../services/orders.js';
import { getSettings, putSetting, settingSchemas, type SettingKey } from '../services/settings.js';

const MONEY_IN = `('paid','queued','processing','successful','failed','needs_review','refund_pending','refunded')`;

const productSchema = z.object({
  kind: z.enum(['data', 'airtime']),
  network_code: zNetwork,
  name: zText(80, 2),
  category: z.enum(['daily', 'weekly', 'monthly', 'non_expiry', 'other', 'airtime']),
  data_mb: z.number().int().positive().max(10_000_000).nullable().optional(),
  validity_label: z.string().trim().max(40).nullable().optional(),
  price_minor: z.number().int().positive().max(10_000_000).nullable().optional(),
  fee_minor: z.number().int().min(0).max(1_000_000).default(0),
  cost_minor: z.number().int().min(0).max(10_000_000).nullable().optional(),
  airtime_min_minor: z.number().int().positive().nullable().optional(),
  airtime_max_minor: z.number().int().positive().max(10_000_000).nullable().optional(),
  airtime_fee_bps: z.number().int().min(0).max(5000).default(0),
  airtime_cost_bps: z.number().int().min(0).max(20000).nullable().optional(),
  manual_fulfilment_allowed: z.boolean().default(true),
  supplier_id: z.number().int().positive().nullable().optional(),
  supplier_product_code: z.string().trim().max(80).nullable().optional(),
  sort_order: z.number().int().min(0).max(100000).default(0),
  admin_note: z.string().trim().max(500).nullable().optional(),
}).superRefine((p, c) => {
  if (p.kind === 'data' && !p.price_minor) c.addIssue({ code: 'custom', path: ['price_minor'], message: 'Selling price is required for data bundles' });
  if (p.kind === 'airtime') {
    if (!p.airtime_min_minor || !p.airtime_max_minor) c.addIssue({ code: 'custom', path: ['airtime_min_minor'], message: 'Set minimum and maximum airtime amounts' });
    else if (p.airtime_max_minor < p.airtime_min_minor) c.addIssue({ code: 'custom', path: ['airtime_max_minor'], message: 'Maximum must be at least the minimum' });
  }
});

const PRODUCT_COLS = ['kind', 'network_code', 'name', 'category', 'data_mb', 'validity_label', 'price_minor', 'fee_minor', 'cost_minor', 'airtime_min_minor', 'airtime_max_minor',
  'airtime_fee_bps', 'airtime_cost_bps', 'manual_fulfilment_allowed', 'supplier_id', 'supplier_product_code', 'sort_order', 'admin_note'] as const;

function adminOrderRow(o: any, ctx: Ctx) {
  const full = can(ctx.user, 'orders.fulfil');
  return {
    reference: o.reference, status: o.status, statusLabel: STATUS_LABEL[o.status as OrderStatus], kind: o.kind, network: o.network_code,
    product: o.product_snapshot?.name, recipientPhone: full ? o.recipient_phone : maskPhone(o.recipient_phone),
    customer: o.customer_name ? `${o.customer_name}` : 'Guest', customerEmail: full ? o.contact_email : maskEmail(o.contact_email),
    totalMinor: o.total_minor, paymentStatus: o.payment_status || 'none', supplierReference: o.supplier_reference, fulfilmentMode: o.fulfilment_mode,
    escalated: o.escalated, isTest: o.is_test, createdAt: o.created_at, updatedAt: o.updated_at,
  };
}

export function registerAdminRoutes(r: Router) {
  // ---------- Overview & analytics ----------
  r.get('/api/admin/daily-report', requirePerm('analytics.view'), async () => {
    const now = new Date();
    const [today, yesterday] = await Promise.all([dailyReport(isoDay(now)), dailyReport(isoDay(new Date(now.getTime() - 86_400_000)))]);
    return { today, yesterday };
  });
  r.get('/api/admin/overview', requirePerm('analytics.view'), async (ctx) => {
    const { from, to } = dateRange(ctx.query, 30);
    const includeTest = ctx.query.get('test') === '1';
    const p = [from, to, includeTest];
    const base = `created_at BETWEEN $1 AND $2 AND ($3 OR NOT is_test)`;
    const totals = await one(`SELECT count(*)::int AS orders,
        count(*) FILTER (WHERE status = 'successful')::int AS successful,
        count(*) FILTER (WHERE status IN ('paid','queued','processing'))::int AS pending_delivery,
        count(*) FILTER (WHERE status = 'needs_review')::int AS needs_review,
        count(*) FILTER (WHERE status = 'failed')::int AS failed,
        count(*) FILTER (WHERE status IN ('pending_payment'))::int AS awaiting_payment,
        COALESCE(sum(total_minor) FILTER (WHERE status IN ${MONEY_IN}),0)::bigint AS gross_sales,
        COALESCE(sum(total_minor) FILTER (WHERE status = 'successful'),0)::bigint AS delivered_sales,
        COALESCE(sum(COALESCE(actual_cost_minor, expected_cost_minor)) FILTER (WHERE status = 'successful'),0)::bigint AS supplier_cost,
        count(*) FILTER (WHERE status = 'successful' AND COALESCE(actual_cost_minor, expected_cost_minor) IS NULL)::int AS successful_without_cost,
        COALESCE(sum(total_minor - COALESCE(actual_cost_minor, expected_cost_minor)) FILTER (WHERE status = 'successful' AND COALESCE(actual_cost_minor, expected_cost_minor) IS NOT NULL),0)::bigint AS gross_margin
      FROM orders WHERE ${base}`, p);
    const refunds = await one(`SELECT COALESCE(sum(r.amount_minor) FILTER (WHERE r.status = 'processed'),0)::bigint AS refunded,
        count(*) FILTER (WHERE r.status IN ('requested','approved','processing'))::int AS open_refunds
      FROM refunds r JOIN orders o ON o.id = r.order_id WHERE r.created_at BETWEEN $1 AND $2 AND ($3 OR NOT o.is_test)`, p);
    const fees = await one(`SELECT COALESCE(sum(py.provider_fees_minor),0)::bigint AS payment_fees FROM payments py JOIN orders o ON o.id = py.order_id
      WHERE py.status = 'success' AND py.paid_at BETWEEN $1 AND $2 AND ($3 OR NOT py.is_test)`, p);
    const trend = await q(`SELECT to_char(date_trunc('day', created_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day,
        COALESCE(sum(total_minor) FILTER (WHERE status IN ${MONEY_IN}),0)::bigint AS sales, count(*) FILTER (WHERE status = 'successful')::int AS delivered
      FROM orders WHERE ${base} GROUP BY 1 ORDER BY 1`, p);
    const byNetwork = await q(`SELECT network_code AS network, count(*)::int AS orders, COALESCE(sum(total_minor),0)::bigint AS sales
      FROM orders WHERE ${base} AND status IN ${MONEY_IN} GROUP BY 1 ORDER BY sales DESC`, p);
    const byProduct = await q(`SELECT product_snapshot->>'name' AS product, network_code AS network, count(*)::int AS orders, COALESCE(sum(total_minor),0)::bigint AS sales
      FROM orders WHERE ${base} AND status IN ${MONEY_IN} GROUP BY 1, 2 ORDER BY sales DESC LIMIT 10`, p);
    const recent = await q(`SELECT o.*, u.full_name AS customer_name, (SELECT status FROM payments py WHERE py.order_id = o.id ORDER BY (py.status='success') DESC, py.id DESC LIMIT 1) AS payment_status
      FROM orders o LEFT JOIN users u ON u.id = o.user_id WHERE ($1 OR NOT o.is_test) ORDER BY o.created_at DESC LIMIT 8`, [includeTest]);
    const queue = await one(`SELECT count(*) FILTER (WHERE status = 'queued' AND fulfilment_mode = 'manual')::int AS manual_queue,
        count(*) FILTER (WHERE status = 'needs_review')::int AS reviews, count(*) FILTER (WHERE escalated AND status NOT IN ('successful','refunded'))::int AS escalated
      FROM orders WHERE ($1 OR NOT is_test)`, [includeTest]);
    const tickets = await one(`SELECT count(*)::int AS open FROM support_tickets WHERE status = 'open'`);
    return { range: { from, to }, totals, refunds, fees, trend, byNetwork, byProduct, recent: recent.map((o) => adminOrderRow(o, ctx)), queue, openTickets: tickets!.open };
  });

  // ---------- Products ----------
  r.get('/api/admin/products', requirePerm('orders.view'), async () => ({
    products: await q(`SELECT p.*, s.name AS supplier_name FROM products p LEFT JOIN suppliers s ON s.id = p.supplier_id ORDER BY p.network_code, p.kind, p.sort_order, p.id`),
  }));

  r.post('/api/admin/products', requirePerm('products.manage'), async (ctx) => {
    const b = productSchema.parse(ctx.body);
    const cols = PRODUCT_COLS.filter((c) => (b as any)[c] !== undefined);
    const row = await tx(async (db) => {
      const created = await one(`INSERT INTO products (${cols.join(',')}, status, created_by, updated_by) VALUES (${cols.map((_, i) => '$' + (i + 1)).join(',')}, 'draft', $${cols.length + 1}, $${cols.length + 1}) RETURNING *`,
        [...cols.map((c) => (b as any)[c]), ctx.user!.id], db);
      await audit(ctx, 'product.create', 'product', created.id, null, created, db);
      return created;
    });
    ctx.json(201, { product: row });
  });

  r.put('/api/admin/products/:id', requirePerm('products.manage'), async (ctx) => {
    const id = zId.parse(ctx.params.id);
    const b = productSchema.parse(ctx.body);
    const row = await tx(async (db) => {
      const before = await one('SELECT * FROM products WHERE id = $1 FOR UPDATE', [id], db);
      if (!before) throw notFound('Product not found');
      if (before.kind !== b.kind) throw conflict('Product type cannot be changed. Create a new product instead.');
      const vals = PRODUCT_COLS.map((c) => ((b as any)[c] === undefined ? null : (b as any)[c]));
      const after = await one(`UPDATE products SET ${PRODUCT_COLS.map((c, i) => `${c} = $${i + 2}`).join(', ')}, updated_by = $${PRODUCT_COLS.length + 2}, updated_at = now() WHERE id = $1 RETURNING *`,
        [id, ...vals, ctx.user!.id], db);
      await audit(ctx, 'product.update', 'product', id, before, after, db);
      return after;
    });
    return { product: row };
  });

  r.post('/api/admin/products/:id/status', requirePerm('products.manage'), async (ctx) => {
    const id = zId.parse(ctx.params.id);
    const { status, confirm_pricing } = z.object({ status: z.enum(['draft', 'live', 'paused']), confirm_pricing: z.boolean().optional() }).parse(ctx.body);
    const row = await tx(async (db) => {
      const before = await one('SELECT * FROM products WHERE id = $1 FOR UPDATE', [id], db);
      if (!before) throw notFound('Product not found');
      if (status === 'live') {
        if (!confirm_pricing) throw conflict('Confirm that the price is correct and approved for live sale', 'confirm_required');
        const sup = before.supplier_id ? await one('SELECT * FROM suppliers WHERE id = $1', [before.supplier_id], db) : null;
        const auto = sup && sup.is_enabled && adapterFor(sup.adapter)?.automated;
        if (!auto && !before.manual_fulfilment_allowed) throw conflict('This product has no connected supplier and manual delivery is off, so orders could not be delivered.');
      }
      const after = await one('UPDATE products SET status = $2, updated_by = $3, updated_at = now() WHERE id = $1 RETURNING *', [id, status, ctx.user!.id], db);
      await audit(ctx, `product.${status === 'live' ? 'go_live' : status === 'paused' ? 'pause' : 'draft'}`, 'product', id, { status: before.status }, { status }, db);
      return after;
    });
    return { product: row };
  });

  r.get('/api/admin/products/:id/history', requirePerm('orders.view'), async (ctx) => ({
    history: await q(`SELECT a.id, a.action, a.before_data, a.after_data, a.created_at, u.full_name AS actor FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_user_id
      WHERE a.entity_type = 'product' AND a.entity_id = $1 ORDER BY a.id DESC LIMIT 100`, [String(zId.parse(ctx.params.id))]),
  }));

  // ---------- Orders ----------
  r.get('/api/admin/orders', requirePerm('orders.view'), async (ctx) => {
    const { limit, offset, page: pg, pageSize } = page(ctx.query, 25);
    const status = ctx.query.get('status') || null;
    const network = ctx.query.get('network') || null;
    const search = (ctx.query.get('q') || '').trim() || null;
    const queue = ctx.query.get('queue');
    const includeTest = ctx.query.get('test') !== '0';
    const { from, to } = dateRange(ctx.query, 3650);
    const rows = await q(`SELECT o.*, u.full_name AS customer_name,
        (SELECT status FROM payments py WHERE py.order_id = o.id ORDER BY (py.status='success') DESC, py.id DESC LIMIT 1) AS payment_status,
        count(*) OVER()::int AS total
      FROM orders o LEFT JOIN users u ON u.id = o.user_id
      WHERE ($1::text IS NULL OR o.status = $1) AND ($2::text IS NULL OR o.network_code = $2)
        AND ($3::text IS NULL OR o.reference ILIKE '%' || $3 || '%' OR o.recipient_phone LIKE '%' || $3 || '%' OR o.contact_email ILIKE '%' || $3 || '%' OR o.supplier_reference ILIKE '%' || $3 || '%')
        AND ($4::text IS NULL OR ($4 = 'manual' AND o.status = 'queued' AND o.fulfilment_mode = 'manual') OR ($4 = 'review' AND o.status = 'needs_review') OR ($4 = 'escalated' AND o.escalated AND o.status NOT IN ('successful','refunded')))
        AND o.created_at BETWEEN $5 AND $6 AND ($7 OR NOT o.is_test)
      ORDER BY o.created_at ${queue ? 'ASC' : 'DESC'} LIMIT $8 OFFSET $9`, [status, network, search, queue || null, from, to, includeTest, limit, offset]);
    return { orders: rows.map((o) => adminOrderRow(o, ctx)), page: pg, pageSize, total: rows[0]?.total ?? 0 };
  });

  r.get('/api/admin/orders/:ref', requirePerm('orders.view'), async (ctx) => {
    const o = await one(`SELECT o.*, u.full_name AS customer_name, u.email AS customer_email, u.id AS customer_id, a.referral_code AS agent_code
      FROM orders o LEFT JOIN users u ON u.id = o.user_id LEFT JOIN agents a ON a.id = o.agent_id WHERE o.reference = $1`, [ctx.params.ref.toUpperCase()]);
    if (!o) throw notFound('Order not found');
    const full = can(ctx.user, 'orders.fulfil');
    const [events, payments, attempts, refunds, tickets, product] = await Promise.all([
      q(`SELECT e.*, u.full_name AS actor_name FROM order_events e LEFT JOIN users u ON u.id = e.actor_user_id WHERE e.order_id = $1 ORDER BY e.id`, [o.id]),
      q(`SELECT id, provider, provider_reference, amount_minor, currency, status, channel, gateway_response, provider_fees_minor, is_test, verified_at, paid_at, created_at FROM payments WHERE order_id = $1 ORDER BY id`, [o.id]),
      q(`SELECT a.*, s.name AS supplier_name FROM delivery_attempts a JOIN suppliers s ON s.id = a.supplier_id WHERE a.order_id = $1 ORDER BY a.attempt_no`, [o.id]),
      q(`SELECT r.*, u.full_name AS reviewed_by FROM refunds r LEFT JOIN users u ON u.id = r.reviewed_by_user_id WHERE r.order_id = $1 ORDER BY r.id`, [o.id]),
      q(`SELECT reference, subject, status, created_at FROM support_tickets WHERE order_id = $1 ORDER BY id`, [o.id]),
      one(`SELECT id, name, manual_fulfilment_allowed, supplier_id, supplier_product_code FROM products WHERE id = $1`, [o.product_id]),
    ]);
    const last = attempts[attempts.length - 1];
    const actions = {
      recordDelivery: full && (['queued', 'needs_review', 'failed'].includes(o.status)) && !(last && ['sending', 'pending'].includes(last.status)) && (product!.manual_fulfilment_allowed || last?.status === 'unknown'),
      markFailed: full && ['queued', 'needs_review'].includes(o.status) && !(last && ['sending', 'pending'].includes(last.status)),
      retry: full && o.status === 'failed' && (!last || last.status === 'failed') && !refunds.some((x: any) => ['requested', 'approved', 'processing', 'processed'].includes(x.status) && !x.reason.startsWith('Duplicate')),
      refund: can(ctx.user, 'refunds.manage') && o.status === 'failed' && !attempts.some((a: any) => ['sending', 'pending', 'unknown'].includes(a.status)),
      reconcile: full,
      escalate: true,
      supplierCheckRequired: last?.status === 'unknown',
    };
    return {
      order: {
        ...o, recipient_phone: full ? o.recipient_phone : maskPhone(o.recipient_phone), contact_email: full ? o.contact_email : maskEmail(o.contact_email),
        access_token_hash: undefined, idempotency_key: undefined, statusLabel: STATUS_LABEL[o.status as OrderStatus],
      },
      product, events, payments, attempts, refunds, tickets, actions,
    };
  });

  const note = zText(500, 5);
  r.post('/api/admin/orders/:ref/record-delivery', requirePerm('orders.fulfil'), async (ctx) => {
    const b = z.object({ confirmation_reference: z.string().trim().max(100).nullable().optional(), note, confirm: z.literal(true, { errorMap: () => ({ message: 'Tick the box to confirm the recipient actually received it' }) }) }).parse(ctx.body);
    await adminRecordDelivery(ctx, ctx.params.ref.toUpperCase(), { confirmationReference: b.confirmation_reference, note: b.note });
    return { ok: true };
  });
  r.post('/api/admin/orders/:ref/mark-failed', requirePerm('orders.fulfil'), async (ctx) => {
    const b = z.object({ reason: note, supplier_checked: z.boolean().optional() }).parse(ctx.body);
    await adminMarkFailed(ctx, ctx.params.ref.toUpperCase(), { reason: b.reason, supplierChecked: b.supplier_checked });
    return { ok: true };
  });
  r.post('/api/admin/orders/:ref/retry', requirePerm('orders.fulfil'), async (ctx) => { await adminRetry(ctx, ctx.params.ref.toUpperCase()); return { ok: true }; });
  r.post('/api/admin/orders/:ref/escalate', requirePerm('orders.view'), async (ctx) => {
    const b = z.object({ note }).parse(ctx.body);
    await adminEscalate(ctx, ctx.params.ref.toUpperCase(), b.note);
    return { ok: true };
  });
  r.post('/api/admin/orders/:ref/reconcile', requirePerm('orders.fulfil'), async (ctx) => ({ results: await adminReconcile(ctx, ctx.params.ref.toUpperCase()) }));
  r.post('/api/admin/orders/:ref/refund', requirePerm('refunds.manage'), async (ctx) => {
    const b = z.object({ reason: note, refund_id: z.number().int().positive().optional() }).parse(ctx.body);
    return adminRefund(ctx, ctx.params.ref.toUpperCase(), { reason: b.reason, refundId: b.refund_id });
  });

  // ---------- Payments, webhooks, refunds ----------
  r.get('/api/admin/payments', requirePerm('payments.view'), async (ctx) => {
    const { limit, offset, page: pg, pageSize } = page(ctx.query, 30);
    const status = ctx.query.get('status') || null;
    const search = (ctx.query.get('q') || '').trim() || null;
    const rows = await q(`SELECT py.id, py.provider_reference, py.amount_minor, py.currency, py.status, py.channel, py.gateway_response, py.provider_fees_minor, py.is_test, py.verified_at, py.paid_at, py.created_at,
        o.reference AS order_reference, o.status AS order_status, count(*) OVER()::int AS total
      FROM payments py JOIN orders o ON o.id = py.order_id
      WHERE ($1::text IS NULL OR py.status = $1) AND ($2::text IS NULL OR py.provider_reference ILIKE '%' || $2 || '%' OR o.reference ILIKE '%' || $2 || '%')
      ORDER BY py.id DESC LIMIT $3 OFFSET $4`, [status, search, limit, offset]);
    const summary = await one(`SELECT count(*) FILTER (WHERE status = 'success' AND NOT is_test)::int AS live_success, COALESCE(sum(amount_minor) FILTER (WHERE status = 'success' AND NOT is_test),0)::bigint AS live_received,
        COALESCE(sum(provider_fees_minor) FILTER (WHERE status = 'success' AND NOT is_test),0)::bigint AS live_fees,
        count(*) FILTER (WHERE status = 'failed')::int AS failed, count(*) FILTER (WHERE status = 'initialized')::int AS open FROM payments`);
    return { payments: rows, summary, page: pg, pageSize, total: rows[0]?.total ?? 0 };
  });

  r.get('/api/admin/payment-events', requirePerm('payments.view'), async (ctx) => {
    const { limit, offset } = page(ctx.query, 50);
    return { events: await q(`SELECT id, provider, event_type, provider_reference, signature_valid, processing_result, received_at, processed_at FROM payment_events ORDER BY id DESC LIMIT $1 OFFSET $2`, [limit, offset]) };
  });

  r.get('/api/admin/refunds', requirePerm('payments.view'), async (ctx) => ({
    refunds: await q(`SELECT r.*, o.reference AS order_reference, o.status AS order_status, u.full_name AS reviewed_by FROM refunds r JOIN orders o ON o.id = r.order_id
      LEFT JOIN users u ON u.id = r.reviewed_by_user_id WHERE ($1::text IS NULL OR r.status = $1) ORDER BY r.id DESC LIMIT 200`, [ctx.query.get('status') || null]),
  }));

  r.post('/api/admin/refunds/:id/reject', requirePerm('refunds.manage'), async (ctx) => {
    const id = zId.parse(ctx.params.id);
    const b = z.object({ note }).parse(ctx.body);
    await tx(async (db) => {
      const rf = await one('SELECT * FROM refunds WHERE id = $1 FOR UPDATE', [id], db);
      if (!rf) throw notFound('Refund not found');
      if (rf.status !== 'requested') throw conflict('Only open requests can be rejected');
      await db.query(`UPDATE refunds SET status = 'rejected', reviewed_by_user_id = $2, reviewed_at = now(), notes = $3, updated_at = now() WHERE id = $1`, [id, ctx.user!.id, b.note]);
      await audit(ctx, 'refund.reject', 'refund', id, { status: rf.status }, { status: 'rejected', note: b.note }, db);
    });
    return { ok: true };
  });

  r.get('/api/admin/reconciliation', requirePerm('payments.view'), async (ctx) => {
    const { from, to } = dateRange(ctx.query, 7);
    const rows = await q(`SELECT to_char(date_trunc('day', py.paid_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day, count(*)::int AS payments, COALESCE(sum(py.amount_minor),0)::bigint AS received,
        COALESCE(sum(py.provider_fees_minor),0)::bigint AS fees,
        count(*) FILTER (WHERE o.status = 'successful')::int AS delivered, count(*) FILTER (WHERE o.status IN ('failed','needs_review','queued','processing','paid'))::int AS unresolved,
        count(*) FILTER (WHERE o.status IN ('refunded','refund_pending'))::int AS refunded
      FROM payments py JOIN orders o ON o.id = py.order_id WHERE py.status = 'success' AND NOT py.is_test AND py.paid_at BETWEEN $1 AND $2 GROUP BY 1 ORDER BY 1 DESC`, [from, to]);
    const issues = await q(`SELECT o.reference, o.status, o.total_minor, o.updated_at FROM orders o WHERE NOT o.is_test AND o.status IN ('needs_review','failed','refund_pending') ORDER BY o.updated_at LIMIT 100`);
    return { days: rows, issues };
  });

  // ---------- Suppliers ----------
  r.get('/api/admin/suppliers', requirePerm('orders.view'), async () => {
    const rows = await q(`SELECT s.*, (SELECT count(*)::int FROM products p WHERE p.supplier_id = s.id) AS products,
        (SELECT count(*)::int FROM delivery_attempts a WHERE a.supplier_id = s.id) AS attempts,
        (SELECT count(*)::int FROM delivery_attempts a WHERE a.supplier_id = s.id AND a.status IN ('failed','unknown')) AS problem_attempts
      FROM suppliers s ORDER BY s.id`);
    return {
      suppliers: rows.map((s) => {
        const a = adapterFor(s.adapter);
        const missing = a ? a.missingConfig() : ['Unknown adapter'];
        return { ...s, automated: !!a?.automated, missingConfig: missing, connectionStatus: !a?.automated ? 'manual' : missing.length ? 'not_connected' : s.last_check_ok ? 'connected' : s.last_check_at ? 'check_failed' : 'untested' };
      }),
    };
  });

  r.post('/api/admin/suppliers/:id/test', requirePerm('suppliers.manage'), async (ctx) => {
    const s = await one('SELECT * FROM suppliers WHERE id = $1', [zId.parse(ctx.params.id)]);
    if (!s) throw notFound('Supplier not found');
    const a = adapterFor(s.adapter);
    const res = a ? await a.testConnection().catch((e) => ({ ok: false, message: e instanceof Error ? e.message : 'failed', balanceMinor: null })) : { ok: false, message: 'Unknown adapter' };
    const balance = (res as any).balanceMinor ?? null;
    await q(`UPDATE suppliers SET last_check_at = now(), last_check_ok = $2, last_check_message = $3, balance_minor = $4, balance_checked_at = CASE WHEN $4::bigint IS NULL THEN balance_checked_at ELSE now() END, updated_at = now() WHERE id = $1`,
      [s.id, res.ok, res.message, balance]);
    await audit(ctx, 'supplier.test', 'supplier', s.id, null, res);
    return { result: res };
  });

  r.patch('/api/admin/suppliers/:id', requirePerm('suppliers.manage'), async (ctx) => {
    const id = zId.parse(ctx.params.id);
    const b = z.object({ is_enabled: z.boolean(), notes: z.string().trim().max(1000).nullable() }).parse(ctx.body);
    const before = await one('SELECT * FROM suppliers WHERE id = $1', [id]);
    if (!before) throw notFound('Supplier not found');
    if (b.is_enabled && adapterFor(before.adapter)?.automated && adapterFor(before.adapter)!.missingConfig().length) throw conflict('This supplier is not connected yet, so it cannot be enabled.');
    await q('UPDATE suppliers SET is_enabled = $2, notes = $3, updated_at = now() WHERE id = $1', [id, b.is_enabled, b.notes]);
    await audit(ctx, 'supplier.update', 'supplier', id, { is_enabled: before.is_enabled, notes: before.notes }, b);
    return { ok: true };
  });

  r.get('/api/admin/suppliers/:id/attempts', requirePerm('orders.view'), async (ctx) => ({
    attempts: await q(`SELECT a.id, a.attempt_no, a.request_id, a.status, a.supplier_reference, a.error_message, a.started_at, a.completed_at, o.reference AS order_reference
      FROM delivery_attempts a JOIN orders o ON o.id = a.order_id WHERE a.supplier_id = $1 ORDER BY a.id DESC LIMIT 100`, [zId.parse(ctx.params.id)]),
  }));

  // ---------- Customers ----------
  r.get('/api/admin/customers', requirePerm('customers.view'), async (ctx) => {
    const { limit, offset, page: pg, pageSize } = page(ctx.query, 25);
    const search = (ctx.query.get('q') || '').trim() || null;
    const full = can(ctx.user, 'customers.restrict');
    const rows = await q(`SELECT u.id, u.full_name, u.email, u.phone, u.status, u.created_at, u.last_login_at,
        (SELECT count(*)::int FROM orders o WHERE o.user_id = u.id AND o.status IN ${MONEY_IN}) AS paid_orders,
        (SELECT COALESCE(sum(total_minor),0)::bigint FROM orders o WHERE o.user_id = u.id AND o.status = 'successful') AS spent,
        count(*) OVER()::int AS total
      FROM users u WHERE u.role = 'customer' AND ($1::text IS NULL OR u.full_name ILIKE '%' || $1 || '%' OR u.email ILIKE '%' || $1 || '%' OR u.phone LIKE '%' || $1 || '%')
      ORDER BY u.created_at DESC LIMIT $2 OFFSET $3`, [search, limit, offset]);
    return { customers: rows.map((c) => ({ ...c, email: full ? c.email : maskEmail(c.email), phone: full ? c.phone : maskPhone(c.phone) })), page: pg, pageSize, total: rows[0]?.total ?? 0 };
  });

  r.get('/api/admin/customers/:id', requirePerm('customers.view'), async (ctx) => {
    const id = zId.parse(ctx.params.id);
    const u = await one(`SELECT id, full_name, email, phone, role, status, restricted_reason, created_at, last_login_at FROM users WHERE id = $1`, [id]);
    if (!u) throw notFound('Customer not found');
    const orders = await q(`SELECT o.*, NULL AS customer_name, (SELECT status FROM payments py WHERE py.order_id = o.id ORDER BY (py.status='success') DESC, py.id DESC LIMIT 1) AS payment_status FROM orders o WHERE o.user_id = $1 ORDER BY o.created_at DESC LIMIT 50`, [id]);
    const tickets = await q(`SELECT reference, subject, status, created_at FROM support_tickets WHERE user_id = $1 ORDER BY id DESC LIMIT 50`, [id]);
    const actions = await q(`SELECT a.action, a.after_data, a.created_at, x.full_name AS actor FROM audit_logs a LEFT JOIN users x ON x.id = a.actor_user_id WHERE a.entity_type = 'user' AND a.entity_id = $1 ORDER BY a.id DESC LIMIT 50`, [String(id)]);
    const full = can(ctx.user, 'customers.restrict');
    return { customer: { ...u, email: full ? u.email : maskEmail(u.email), phone: full ? u.phone : maskPhone(u.phone) }, orders: orders.map((o) => adminOrderRow(o, ctx)), tickets, actions };
  });

  r.post('/api/admin/customers/:id/restrict', requirePerm('customers.restrict'), async (ctx) => {
    const id = zId.parse(ctx.params.id);
    const b = z.object({ reason: note }).parse(ctx.body);
    await tx(async (db) => {
      const u = await one('SELECT * FROM users WHERE id = $1 FOR UPDATE', [id], db);
      if (!u) throw notFound('User not found');
      if (u.role !== 'customer' && !can(ctx.user, 'team.manage')) throw forbidden('Only owners can restrict team members');
      if (u.id === ctx.user!.id) throw conflict('You cannot restrict your own account');
      if (u.role === 'owner') {
        const owners = await one<{ n: number }>(`SELECT count(*)::int AS n FROM users WHERE role = 'owner' AND status = 'active'`, [], db);
        if (owners!.n <= 1) throw conflict('You cannot restrict the last active owner');
      }
      await db.query(`UPDATE users SET status = 'restricted', restricted_reason = $2, updated_at = now() WHERE id = $1`, [id, b.reason]);
      await revokeAllSessions(id, null, db);
      await audit(ctx, 'user.restrict', 'user', id, { status: u.status }, { status: 'restricted', reason: b.reason }, db);
    });
    return { ok: true };
  });

  r.post('/api/admin/customers/:id/restore', requirePerm('customers.restrict'), async (ctx) => {
    const id = zId.parse(ctx.params.id);
    await tx(async (db) => {
      const u = await one('SELECT * FROM users WHERE id = $1 FOR UPDATE', [id], db);
      if (!u) throw notFound('User not found');
      if (u.role !== 'customer' && !can(ctx.user, 'team.manage')) throw forbidden('Only owners can restore team members');
      await db.query(`UPDATE users SET status = 'active', restricted_reason = NULL, updated_at = now() WHERE id = $1`, [id]);
      await audit(ctx, 'user.restore', 'user', id, { status: u.status }, { status: 'active' }, db);
    });
    return { ok: true };
  });

  r.post('/api/admin/customers/:id/reset-link', requirePerm('customers.restrict'), async (ctx) => {
    const id = zId.parse(ctx.params.id);
    const u = await one('SELECT id, role FROM users WHERE id = $1', [id]);
    if (!u) throw notFound('User not found');
    if (u.role !== 'customer' && !can(ctx.user, 'team.manage')) throw forbidden();
    const token = randomToken(32);
    await q(`INSERT INTO password_reset_tokens (user_id, token_hash, created_by_admin_id, expires_at) VALUES ($1,$2,$3, now() + interval '24 hours')`, [id, sha256(token), ctx.user!.id]);
    await audit(ctx, 'user.reset_link', 'user', id, null, { expires_hours: 24 });
    return { link: `${config.publicBaseUrl}/reset-password?token=${token}`, expiresInHours: 24 };
  });

  // ---------- Support ----------
  r.get('/api/admin/tickets', requirePerm('support.reply'), async (ctx) => {
    const status = ctx.query.get('status') || null;
    return {
      tickets: await q(`SELECT t.id, t.reference, t.subject, t.category, t.status, t.email, t.name, t.created_at, t.updated_at, o.reference AS order_reference,
          (SELECT author_type FROM support_messages m WHERE m.ticket_id = t.id ORDER BY m.id DESC LIMIT 1) AS last_author
        FROM support_tickets t LEFT JOIN orders o ON o.id = t.order_id WHERE ($1::text IS NULL OR t.status = $1)
        ORDER BY CASE t.status WHEN 'open' THEN 0 WHEN 'awaiting_customer' THEN 1 ELSE 2 END, t.updated_at DESC LIMIT 200`, [status]),
    };
  });

  r.get('/api/admin/tickets/:ref', requirePerm('support.reply'), async (ctx) => {
    const t = await one(`SELECT t.*, o.reference AS order_reference, o.status AS order_status FROM support_tickets t LEFT JOIN orders o ON o.id = t.order_id WHERE t.reference = $1`, [ctx.params.ref.toUpperCase()]);
    if (!t) throw notFound('Ticket not found');
    const messages = await q(`SELECT m.author_type, m.body, m.created_at, u.full_name AS author_name FROM support_messages m LEFT JOIN users u ON u.id = m.author_user_id WHERE m.ticket_id = $1 ORDER BY m.id`, [t.id]);
    return { ticket: { ...t, access_token_hash: undefined }, messages };
  });

  r.post('/api/admin/tickets/:ref/reply', requirePerm('support.reply'), async (ctx) => {
    const b = z.object({ message: zText(4000, 2), status: z.enum(['open', 'awaiting_customer', 'resolved', 'closed']).optional() }).parse(ctx.body);
    await tx(async (db) => {
      const t = await one('SELECT * FROM support_tickets WHERE reference = $1 FOR UPDATE', [ctx.params.ref.toUpperCase()], db);
      if (!t) throw notFound('Ticket not found');
      await db.query(`INSERT INTO support_messages (ticket_id, author_type, author_user_id, body) VALUES ($1,'admin',$2,$3)`, [t.id, ctx.user!.id, b.message]);
      await db.query(`UPDATE support_tickets SET status = $2, updated_at = now() WHERE id = $1`, [t.id, b.status ?? 'awaiting_customer']);
      if (t.user_id) await db.query(`INSERT INTO notifications (user_id, type, title, body) VALUES ($1,'ticket_reply',$2,$3)`, [t.user_id, `Reply on ticket ${t.reference}`, b.message.slice(0, 300)]);
      await audit(ctx, 'ticket.reply', 'ticket', t.reference, { status: t.status }, { status: b.status ?? 'awaiting_customer' }, db);
    });
    return { ok: true };
  });

  r.post('/api/admin/tickets/:ref/status', requirePerm('support.reply'), async (ctx) => {
    const b = z.object({ status: z.enum(['open', 'awaiting_customer', 'resolved', 'closed']) }).parse(ctx.body);
    const t = await one('SELECT * FROM support_tickets WHERE reference = $1', [ctx.params.ref.toUpperCase()]);
    if (!t) throw notFound('Ticket not found');
    await q(`UPDATE support_tickets SET status = $2, updated_at = now() WHERE id = $1`, [t.id, b.status]);
    await q(`INSERT INTO support_messages (ticket_id, author_type, author_user_id, body) VALUES ($1,'system',$2,$3)`, [t.id, ctx.user!.id, `Status changed to ${b.status.replace('_', ' ')}`]);
    await audit(ctx, 'ticket.status', 'ticket', t.reference, { status: t.status }, b);
    return { ok: true };
  });

  // ---------- Settings & integrations ----------
  r.get('/api/admin/settings', requirePerm('orders.view'), async () => {
    const s = await getSettings();
    const suppliers = await q('SELECT code, name, is_enabled, adapter, last_check_ok FROM suppliers ORDER BY id');
    return {
      settings: s,
      integrations: {
        payments: { provider: 'Paystack', mode: paymentsMode(), webhookUrl: `${config.publicBaseUrl}/api/webhooks/paystack`, callbackUrl: `${config.publicBaseUrl}/order/…` },
        email: { configured: emailConfigured(), provider: 'Resend' },
        sms: { configured: false, note: 'No SMS provider connected yet' },
        suppliers: suppliers.map((x) => ({ ...x, connected: adapterFor(x.adapter)?.automated ? adapterFor(x.adapter)!.missingConfig().length === 0 && !!x.last_check_ok : null })),
        publicBaseUrl: config.publicBaseUrl,
      },
    };
  });

  r.put('/api/admin/settings/:key', requirePerm('settings.manage'), async (ctx) => {
    const key = ctx.params.key as SettingKey;
    const schema = settingSchemas[key];
    if (!schema) throw notFound('Unknown setting');
    if (key === 'business' && ctx.user!.role !== 'owner' && (ctx.body?.show_founders !== undefined)) {
      const cur = (await getSettings()).business;
      if (ctx.body.show_founders !== cur.show_founders) throw forbidden('Only owners can change whether founders are shown publicly');
    }
    const value = schema.parse(ctx.body) as any;
    const before = await putSetting(key, value, ctx.user!.id);
    await audit(ctx, 'settings.update', 'setting', key, before, value);
    return { ok: true, value };
  });

  // ---------- Team (owners only) ----------
  r.get('/api/admin/team', requirePerm('team.manage'), async () => ({
    members: await q(`SELECT id, full_name, email, phone, role, status, last_login_at, created_at FROM users WHERE role <> 'customer' ORDER BY created_at`),
    invites: await q(`SELECT i.id, i.label, i.role, i.expires_at, i.used_at, i.created_at, u.full_name AS used_by FROM admin_invites i LEFT JOIN users u ON u.id = i.used_by_user_id ORDER BY i.id DESC LIMIT 50`),
  }));

  r.post('/api/admin/team/invites', requirePerm('team.manage'), async (ctx) => {
    const b = z.object({ label: zText(80, 2), role: z.enum(['support', 'admin', 'owner']) }).parse(ctx.body);
    const token = randomToken(32);
    const inv = await one(`INSERT INTO admin_invites (token_hash, role, label, expires_at, created_by_user_id) VALUES ($1,$2,$3, now() + interval '72 hours', $4) RETURNING id, expires_at`, [sha256(token), b.role, b.label, ctx.user!.id]);
    await audit(ctx, 'team.invite', 'admin_invite', inv.id, null, b);
    return { link: `${config.publicBaseUrl}/admin/invite/${token}`, expiresAt: inv.expires_at };
  });

  r.post('/api/admin/team/:id/role', requirePerm('team.manage'), async (ctx) => {
    const id = zId.parse(ctx.params.id);
    const b = z.object({ role: z.enum(['customer', 'support', 'admin', 'owner']) }).parse(ctx.body);
    await tx(async (db) => {
      const u = await one('SELECT * FROM users WHERE id = $1 FOR UPDATE', [id], db);
      if (!u) throw notFound('User not found');
      if (u.id === ctx.user!.id) throw conflict('You cannot change your own role');
      if (u.role === 'owner' && b.role !== 'owner') {
        const owners = await one<{ n: number }>(`SELECT count(*)::int AS n FROM users WHERE role = 'owner' AND status = 'active'`, [], db);
        if (owners!.n <= 1) throw conflict('There must always be at least one owner');
      }
      await db.query('UPDATE users SET role = $2, updated_at = now() WHERE id = $1', [id, b.role]);
      await revokeAllSessions(id, null, db);
      await audit(ctx, 'team.role_change', 'user', id, { role: u.role }, { role: b.role }, db);
    });
    return { ok: true };
  });

  // ---------- Audit log ----------
  r.get('/api/admin/audit', requirePerm('audit.view'), async (ctx) => {
    const { limit, offset, page: pg, pageSize } = page(ctx.query, 50);
    const rows = await q(`SELECT a.id, a.action, a.entity_type, a.entity_id, a.before_data, a.after_data, a.ip, a.created_at, u.full_name AS actor, count(*) OVER()::int AS total
      FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_user_id WHERE ($1::text IS NULL OR a.entity_type = $1) ORDER BY a.id DESC LIMIT $2 OFFSET $3`, [ctx.query.get('entity') || null, limit, offset]);
    return { entries: rows, page: pg, pageSize, total: rows[0]?.total ?? 0 };
  });

  // ---------- Agents ----------
  r.get('/api/admin/agents', requirePerm('agents.manage'), async () => ({
    agents: await q(`SELECT a.*, u.email, COALESCE((SELECT sum(amount_minor) FROM agent_ledger l WHERE l.agent_id = a.id),0)::bigint AS balance_minor,
        (SELECT count(*)::int FROM agent_ledger l WHERE l.agent_id = a.id AND l.type = 'commission') AS sales
      FROM agents a LEFT JOIN users u ON u.id = a.user_id ORDER BY a.id DESC`),
    withdrawals: await q(`SELECT w.*, a.name AS agent_name, a.referral_code FROM agent_withdrawals w JOIN agents a ON a.id = w.agent_id ORDER BY (w.status = 'requested') DESC, w.id DESC LIMIT 200`),
    legacyAgents: (await one(`SELECT CASE WHEN to_regclass('legacy_agents') IS NULL THEN 0 ELSE (SELECT count(*)::int FROM legacy_agents) END AS n`))!.n,
  }));

  r.post('/api/admin/agents/:id', requirePerm('agents.manage'), async (ctx) => {
    const id = zId.parse(ctx.params.id);
    const b = z.object({ status: z.enum(['active', 'suspended']), commission_bps: z.number().int().min(0).max(5000).nullable() }).parse(ctx.body);
    const before = await one('SELECT status, commission_bps FROM agents WHERE id = $1', [id]);
    if (!before) throw notFound('Agent not found');
    await q('UPDATE agents SET status = $2, commission_bps = $3 WHERE id = $1', [id, b.status, b.commission_bps]);
    await audit(ctx, 'agent.update', 'agent', id, before, b);
    return { ok: true };
  });

  r.post('/api/admin/withdrawals/:id', requirePerm('agents.manage'), async (ctx) => {
    const id = zId.parse(ctx.params.id);
    const b = z.object({ action: z.enum(['paid', 'rejected']), payout_reference: z.string().trim().max(100).optional(), note: z.string().trim().max(300).optional() }).parse(ctx.body);
    if (b.action === 'paid' && !b.payout_reference) throw new HttpError(400, 'Enter the Mobile Money transaction ID you paid with');
    await tx(async (db) => {
      const w = await one('SELECT * FROM agent_withdrawals WHERE id = $1 FOR UPDATE', [id], db);
      if (!w) throw notFound('Withdrawal not found');
      if (w.status !== 'requested') throw conflict('Already processed');
      await db.query(`UPDATE agent_withdrawals SET status = $2, payout_reference = $3, note = $4, processed_by = $5, processed_at = now() WHERE id = $1`, [id, b.action, b.payout_reference ?? null, b.note ?? null, ctx.user!.id]);
      if (b.action === 'rejected') await db.query(`INSERT INTO agent_ledger (agent_id, withdrawal_id, type, amount_minor, note, created_by) VALUES ($1,$2,'reversal',$3,'Withdrawal rejected',$4)`, [w.agent_id, w.id, w.amount_minor, ctx.user!.id]);
      await audit(ctx, `withdrawal.${b.action}`, 'agent_withdrawal', id, { status: w.status }, b, db);
    });
    return { ok: true };
  });

  // Staff session info (used by the dashboard shell)
  r.get('/api/admin/me', requireStaff, async (ctx) => ({ user: ctx.user }));
}
