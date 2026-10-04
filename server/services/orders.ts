import { config, paymentsMode } from '../config.js';
import { one, pool, q, tx, isUniqueViolation, type Queryable } from '../db/pool.js';
import { accessToken, humanCode, sha256 } from '../lib/crypto.js';
import { log } from '../lib/log.js';
import { bpsOf, formatGhs } from '../lib/util.js';
import { HttpError, conflict, notFound, type Ctx } from '../http/core.js';
import { paymentProvider, PaymentUnavailable } from '../payments/provider.js';
import { adapterFor, isAdapterReady, type DeliveryRequest, type DeliveryResult } from '../suppliers/adapters.js';
import { enqueue, registerJob } from './jobs.js';
import { alertAdmins, notify } from './notify.js';
import { scheduleDailyPush } from './push.js';
import { getSetting } from './settings.js';
import { audit } from './audit.js';

export type OrderStatus = 'pending_payment' | 'payment_failed' | 'expired' | 'paid' | 'queued' | 'processing' | 'successful' | 'failed' | 'needs_review' | 'refund_pending' | 'refunded';

// Every status change must be listed here; anything else is rejected.
const ALLOWED: Record<OrderStatus, OrderStatus[]> = {
  pending_payment: ['paid', 'payment_failed', 'expired'],
  payment_failed: ['paid', 'pending_payment', 'expired'],
  expired: ['paid'],
  paid: ['queued', 'processing', 'needs_review'],
  queued: ['processing', 'successful', 'failed', 'needs_review'],
  processing: ['successful', 'failed', 'needs_review', 'queued'],
  needs_review: ['successful', 'failed'],
  failed: ['queued', 'successful', 'refund_pending'],
  refund_pending: ['refunded', 'failed'],
  successful: [],
  refunded: [],
};

export const STATUS_LABEL: Record<OrderStatus, string> = {
  pending_payment: 'Awaiting payment', payment_failed: 'Payment failed', expired: 'Expired (not paid)', paid: 'Paid',
  queued: 'Queued for delivery', processing: 'Delivering', successful: 'Delivered', failed: 'Delivery failed',
  needs_review: 'Being checked', refund_pending: 'Refund in progress', refunded: 'Refunded',
};

type Actor = { type: 'system' | 'customer' | 'admin' | 'supplier' | 'payment_provider'; userId?: number | null };

export async function transition(db: Queryable, order: { id: number; status: OrderStatus }, to: OrderStatus, actor: Actor, eventType: string, message: string, data?: unknown, extraSet = '', extraParams: unknown[] = []) {
  if (!ALLOWED[order.status].includes(to)) throw new HttpError(409, `Order cannot move from "${STATUS_LABEL[order.status]}" to "${STATUS_LABEL[to]}"`, 'invalid_transition');
  const params = [order.id, to, order.status, ...extraParams];
  const res = await db.query(`UPDATE orders SET status = $2, updated_at = now()${extraSet ? ', ' + extraSet : ''} WHERE id = $1 AND status = $3 RETURNING id`, params);
  if (!res.rowCount) throw new HttpError(409, 'Order was updated by someone else. Refresh and try again.', 'stale');
  await addEvent(db, order.id, eventType, message, actor, data, order.status, to);
  order.status = to;
}

export async function addEvent(db: Queryable, orderId: number, eventType: string, message: string, actor: Actor, data?: unknown, from?: string | null, to?: string | null) {
  await db.query(`INSERT INTO order_events (order_id, event_type, from_status, to_status, message, actor_type, actor_user_id, data) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [orderId, eventType, from ?? null, to ?? null, message, actor.type, actor.userId ?? null, data ?? null]);
}

// ---------- Pricing (server is the only source of truth) ----------
export interface Quote { productId: number; kind: 'data' | 'airtime'; network: string; name: string; faceValueMinor: number | null; priceMinor: number; feeMinor: number; totalMinor: number; expectedCostMinor: number | null; currency: string }

export async function quote(productId: number, amountMinor: number | undefined, db: Queryable = pool): Promise<{ quote: Quote; product: any }> {
  const product = await one(`SELECT p.*, n.is_active AS network_active FROM products p JOIN networks n ON n.code = p.network_code WHERE p.id = $1`, [productId], db);
  if (!product || product.status !== 'live' || !product.network_active) throw new HttpError(404, 'This product is not available right now', 'product_unavailable');
  if (product.kind === 'data') {
    const fee = Number(product.fee_minor);
    return { product, quote: { productId: product.id, kind: 'data', network: product.network_code, name: product.name, faceValueMinor: null, priceMinor: product.price_minor, feeMinor: fee, totalMinor: product.price_minor + fee, expectedCostMinor: product.cost_minor, currency: product.currency } };
  }
  if (!Number.isInteger(amountMinor) || amountMinor! <= 0) throw new HttpError(400, 'Enter an airtime amount', 'amount_required');
  if (amountMinor! < product.airtime_min_minor || amountMinor! > product.airtime_max_minor) {
    throw new HttpError(400, `Airtime amount must be between ${formatGhs(product.airtime_min_minor)} and ${formatGhs(product.airtime_max_minor)}`, 'amount_out_of_range');
  }
  const fee = bpsOf(amountMinor!, product.airtime_fee_bps);
  const cost = product.airtime_cost_bps === null ? null : bpsOf(amountMinor!, product.airtime_cost_bps);
  return { product, quote: { productId: product.id, kind: 'airtime', network: product.network_code, name: product.name, faceValueMinor: amountMinor!, priceMinor: amountMinor!, feeMinor: fee, totalMinor: amountMinor! + fee, expectedCostMinor: cost, currency: product.currency } };
}

// ---------- Create order + start payment ----------
export interface CreateOrderInput { idempotencyKey: string; productId: number; networkCode: string; recipientPhone: string; amountMinor?: number; email?: string; contactPhone?: string; referralCode?: string; paymentMethod?: 'mobile_money' | 'card' }

export async function createOrder(ctx: Ctx, input: CreateOrderInput) {
  const maintenance = await getSetting('maintenance');
  if (maintenance?.enabled) throw new HttpError(503, maintenance.message || 'Purchases are paused for maintenance', 'maintenance');
  const provider = paymentProvider();
  if (!provider) throw new HttpError(503, 'Online payments are not switched on yet. Please check back soon.', 'payments_unavailable');

  // Idempotent replay: same key returns the same order (never a second charge).
  const existing = await one('SELECT * FROM orders WHERE idempotency_key = $1', [input.idempotencyKey]);
  if (existing) return replayExisting(ctx, existing, input);

  const email = ctx.user ? ctx.user.email : input.email;
  if (!email) throw new HttpError(400, 'Enter your email address for the receipt', 'email_required');

  const { quote: qt, product } = await quote(input.productId, input.amountMinor);
  if (qt.network !== input.networkCode) throw new HttpError(400, 'The selected product is for a different network', 'network_mismatch');

  const limits = await getSetting('limits');
  if (qt.totalMinor > limits.max_order_minor) throw new HttpError(400, `Orders above ${formatGhs(limits.max_order_minor)} are not allowed`, 'limit_exceeded');
  const recent = await one<{ n: number }>(`SELECT count(*)::int AS n FROM orders WHERE recipient_phone = $1 AND created_at > now() - interval '24 hours' AND status NOT IN ('pending_payment','expired','payment_failed')`, [input.recipientPhone]);
  if ((recent?.n ?? 0) >= limits.max_orders_per_recipient_per_day) throw new HttpError(429, 'This number has reached the daily purchase limit. Please try again tomorrow or contact support.', 'recipient_limit');

  let agent: { id: number; commission_bps: number | null } | undefined;
  const agentSettings = await getSetting('agents');
  if (input.referralCode && agentSettings?.enabled) {
    agent = await one(`SELECT id, commission_bps FROM agents WHERE referral_code = $1 AND status = 'active' AND (user_id IS NULL OR user_id <> $2)`, [input.referralCode.toUpperCase(), ctx.user?.id ?? 0]);
  }
  const commission = agent ? bpsOf(qt.priceMinor, agent.commission_bps ?? agentSettings.default_commission_bps) : 0;

  const snapshot = { name: product.name, kind: product.kind, network: product.network_code, data_mb: product.data_mb, validity_label: product.validity_label, category: product.category };
  let order: any;
  for (let i = 0; i < 5 && !order; i++) {
    const reference = `DD${humanCode(8)}`;
    try {
      order = await tx(async (db) => {
        const o = await one(`INSERT INTO orders (reference, idempotency_key, access_token_hash, user_id, contact_email, contact_phone, recipient_phone, network_code, product_id, kind,
              product_snapshot, face_value_minor, price_minor, fee_minor, total_minor, expected_cost_minor, currency, agent_id, agent_commission_minor, is_test, client_ip)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) RETURNING *`,
          [reference, input.idempotencyKey, sha256(accessToken('order', reference)), ctx.user?.id ?? null, email, input.contactPhone ?? ctx.user?.phone ?? null, input.recipientPhone,
            qt.network, qt.productId, qt.kind, snapshot, qt.faceValueMinor, qt.priceMinor, qt.feeMinor, qt.totalMinor, qt.expectedCostMinor, qt.currency,
            agent?.id ?? null, commission, paymentsMode() !== 'live', ctx.ip], db);
        await addEvent(db, o.id, 'created', `Order created for ${qt.name} to ${input.recipientPhone}`, { type: ctx.user ? 'customer' : 'system', userId: ctx.user?.id }, { total_minor: qt.totalMinor });
        return o;
      });
    } catch (e) {
      if (isUniqueViolation(e, 'orders_idempotency_key_key')) {
        const again = await one('SELECT * FROM orders WHERE idempotency_key = $1', [input.idempotencyKey]);
        return replayExisting(ctx, again, input);
      }
      if (!isUniqueViolation(e, 'orders_reference_key')) throw e;
    }
  }
  const payment = await startPayment(order, input.paymentMethod);
  return presentCheckout(order, payment.authorization_url);
}

async function replayExisting(ctx: Ctx, existing: any, input: CreateOrderInput) {
  const same = existing.product_id === input.productId && existing.recipient_phone === input.recipientPhone &&
    (existing.kind === 'data' || existing.face_value_minor === input.amountMinor) && (existing.user_id ?? null) === (ctx.user?.id ?? null);
  if (!same) throw conflict('This checkout was already used for a different purchase. Please refresh the page.', 'idempotency_mismatch');
  if (existing.status === 'pending_payment') {
    const pay = await one(`SELECT * FROM payments WHERE order_id = $1 AND status = 'initialized' ORDER BY id DESC LIMIT 1`, [existing.id]);
    const url = pay?.authorization_url ?? (await startPayment(existing, input.paymentMethod)).authorization_url;
    return presentCheckout(existing, url);
  }
  return presentCheckout(existing, null);
}

function presentCheckout(order: any, authorizationUrl: string | null) {
  return { reference: order.reference, accessToken: accessToken('order', order.reference), status: order.status, totalMinor: order.total_minor, authorizationUrl, isTest: order.is_test };
}

/** Initialises a payment attempt with the provider. The provider reference is unique per attempt. */
export async function startPayment(order: any, method?: 'mobile_money' | 'card') {
  const provider = paymentProvider();
  if (!provider) throw new HttpError(503, 'Online payments are not switched on yet.', 'payments_unavailable');
  const n = (await one<{ n: number }>('SELECT count(*)::int AS n FROM payments WHERE order_id = $1', [order.id]))!.n + 1;
  const providerRef = `${order.reference}-${n}`;
  const payment = await one(`INSERT INTO payments (order_id, provider, provider_reference, amount_minor, currency, is_test) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [order.id, provider.name, providerRef, order.total_minor, order.currency, order.is_test]);
  try {
    const token = accessToken('order', order.reference);
    const init = await provider.initialize({
      reference: providerRef, amountMinor: order.total_minor, email: order.contact_email,
      callbackUrl: `${config.publicBaseUrl}/order/${order.reference}?t=${token}&paid=1`,
      channels: method ? [method] : undefined,
      metadata: { order_reference: order.reference, product: order.product_snapshot?.name, recipient: order.recipient_phone, cancel_action: `${config.publicBaseUrl}/order/${order.reference}?t=${token}` },
    });
    return (await one(`UPDATE payments SET authorization_url = $2, access_code = $3, updated_at = now() WHERE id = $1 RETURNING *`, [payment.id, init.authorizationUrl, init.accessCode]))!;
  } catch (e) {
    await q(`UPDATE payments SET status = 'failed', gateway_response = $2, updated_at = now() WHERE id = $1`, [payment.id, e instanceof Error ? e.message.slice(0, 300) : 'init failed']);
    if (e instanceof PaymentUnavailable) throw new HttpError(502, 'We could not reach the payment provider. Please try again in a moment.', 'payment_init_failed');
    throw e;
  }
}

/** Customer asks to pay again for an unpaid order. Previous attempts are verified first so nobody pays twice. */
export async function retryPayment(order: any, method?: 'mobile_money' | 'card') {
  const pending = await q(`SELECT provider_reference FROM payments WHERE order_id = $1 AND status = 'initialized'`, [order.id]);
  for (const p of pending) await confirmPayment(p.provider_reference, 'verify');
  const fresh = (await one('SELECT * FROM orders WHERE id = $1', [order.id]))!;
  if (!['pending_payment', 'payment_failed'].includes(fresh.status)) return presentCheckout(fresh, null);
  if (fresh.status === 'payment_failed') await tx((db) => transition(db, fresh, 'pending_payment', { type: 'customer', userId: fresh.user_id }, 'payment_retry', 'Customer is trying to pay again'));
  const pay = await startPayment(fresh, method);
  return presentCheckout(fresh, pay.authorization_url);
}

// ---------- Payment confirmation (webhook, return page, reconciliation) ----------
export async function confirmPayment(providerRef: string, source: 'webhook' | 'verify' | 'reconcile' | 'admin'): Promise<string> {
  const provider = paymentProvider();
  if (!provider) return 'payments_not_configured';
  const pay = await one('SELECT * FROM payments WHERE provider_reference = $1', [providerRef]);
  if (!pay) return 'unknown_reference';
  if (pay.status === 'success') return 'already_confirmed';

  const v = await provider.verify(providerRef); // official server-side verification — never trust the browser
  return tx(async (db) => {
    const p = (await one('SELECT * FROM payments WHERE id = $1 FOR UPDATE', [pay.id], db))!;
    if (p.status === 'success') return 'already_confirmed';
    const order = (await one('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [p.order_id], db))!;
    const actor: Actor = { type: 'payment_provider' };

    if (v.found && v.status === 'success') {
      const matches = v.amountMinor === p.amount_minor && (v.currency || '').toUpperCase() === p.currency;
      await db.query(`UPDATE payments SET status = 'success', channel = $2, gateway_response = $3, provider_fees_minor = $4, paid_at = COALESCE($5::timestamptz, now()), verified_at = now(), updated_at = now() WHERE id = $1`,
        [p.id, v.channel, v.gatewayResponse, v.feesMinor, v.paidAt]);
      if (!matches) {
        await addEvent(db, order.id, 'payment_amount_mismatch', `Payment ${providerRef} verified with ${v.currency} ${v.amountMinor} but order expected ${p.currency} ${p.amount_minor}`, actor, { source });
        if (['pending_payment', 'payment_failed', 'expired'].includes(order.status)) {
          await transition(db, order, 'paid', actor, 'payment_confirmed', 'Payment received but amount did not match — needs review', { source }, 'paid_at = now()');
          await transition(db, order, 'needs_review', { type: 'system' }, 'review_required', 'Paid amount does not match the order total. Check before delivering.');
        }
        alertAdmins('Payment amount mismatch', `Order ${order.reference}: verified ${v.amountMinor} vs expected ${p.amount_minor}`);
        return 'amount_mismatch';
      }
      if (['pending_payment', 'payment_failed', 'expired'].includes(order.status)) {
        await transition(db, order, 'paid', actor, 'payment_confirmed', `Payment verified with Paystack (${v.channel || 'unknown channel'})`, { source, provider_reference: providerRef }, 'paid_at = now()');
        await enqueue('fulfil', { orderId: order.id }, { uniqueKey: `fulfil:${order.id}` }, db);
        return 'confirmed';
      }
      // The order was already paid through another attempt: this is a duplicate payment. Flag it for a refund review.
      await db.query(`INSERT INTO refunds (order_id, payment_id, amount_minor, reason, status, requested_by_type) VALUES ($1,$2,$3,$4,'requested','admin') ON CONFLICT DO NOTHING`,
        [order.id, p.id, p.amount_minor, `Duplicate payment ${providerRef} — order was already paid`]);
      await addEvent(db, order.id, 'duplicate_payment', `A second payment (${providerRef}) was received for this order. A refund request was created for review.`, actor, { source });
      alertAdmins('Duplicate payment received', `Order ${order.reference} received a second payment ${providerRef}.`);
      return 'duplicate_payment';
    }

    const ageMin = (Date.now() - new Date(p.created_at).getTime()) / 60000;
    if (v.found && (v.status === 'failed' || v.status === 'reversed' || (v.status === 'abandoned' && ageMin > 120))) {
      const st = v.status === 'reversed' ? 'reversed' : v.status === 'abandoned' ? 'abandoned' : 'failed';
      await db.query(`UPDATE payments SET status = $2, gateway_response = $3, verified_at = now(), updated_at = now() WHERE id = $1 AND status = 'initialized'`, [p.id, st, v.gatewayResponse]);
      if (order.status === 'pending_payment' && st === 'failed') {
        await transition(db, order, 'payment_failed', actor, 'payment_failed', `Payment was not completed: ${v.gatewayResponse || 'declined'}`);
      }
      return 'payment_' + st;
    }
    if (!v.found && ageMin > 180) {
      await db.query(`UPDATE payments SET status = 'abandoned', verified_at = now(), updated_at = now() WHERE id = $1 AND status = 'initialized'`, [p.id]);
      return 'payment_abandoned';
    }
    await db.query('UPDATE payments SET verified_at = now() WHERE id = $1', [p.id]);
    return 'still_pending';
  });
}

// ---------- Fulfilment ----------
/** How many times an order waits for a supplier wallet top-up before it is marked failed (first 3 a minute apart, then every 5 minutes: about 8 hours). */
const LOW_BALANCE_MAX_TRIES = 100;
function deliveryRequest(order: any, product: any, requestId: string): DeliveryRequest {
  return { requestId, kind: order.kind, network: order.network_code, recipient: order.recipient_phone, productCode: product.supplier_product_code, faceValueMinor: order.face_value_minor, dataMb: product.data_mb ?? null };
}

export async function fulfil(orderId: number, opts: { retry?: boolean } = {}) {
  const plan = await tx(async (db) => {
    const order = await one('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [orderId], db);
    if (!order) return null;
    if (!(order.status === 'paid' || (order.status === 'queued' && opts.retry))) return null;
    const product = (await one('SELECT * FROM products WHERE id = $1', [order.product_id], db))!;
    const supplier = product.supplier_id ? await one('SELECT * FROM suppliers WHERE id = $1', [product.supplier_id], db) : null;
    const adapter = supplier ? adapterFor(supplier.adapter) : null;
    const preview = deliveryRequest(order, product, '');
    const autoReady = !!supplier && supplier.is_enabled && isAdapterReady(supplier.adapter) &&
      (adapter?.unsupported ? adapter.unsupported(preview) === null : (order.kind === 'airtime' || !!product.supplier_product_code));

    const last = await one(`SELECT * FROM delivery_attempts WHERE order_id = $1 ORDER BY attempt_no DESC LIMIT 1`, [order.id], db);
    if (last && ['sending', 'pending', 'unknown'].includes(last.status)) {
      await transition(db, order, 'needs_review', { type: 'system' }, 'review_required', 'A previous supplier request has no final result. Check with the supplier before doing anything else.');
      return null;
    }
    if (!autoReady) {
      if (product.manual_fulfilment_allowed) {
        if (order.status !== 'queued') await transition(db, order, 'queued', { type: 'system' }, 'awaiting_manual', 'Waiting for an admin to deliver this order manually', null, "fulfilment_mode = 'manual'");
        else await db.query(`UPDATE orders SET fulfilment_mode = 'manual', updated_at = now() WHERE id = $1`, [order.id]);
        return null;
      }
      await transition(db, order, 'needs_review', { type: 'system' }, 'review_required', 'No connected supplier for this product and manual delivery is not allowed');
      return null;
    }
    const attemptNo = (last?.attempt_no ?? 0) + 1;
    const requestId = `${order.reference}-A${attemptNo}`;
    const req = deliveryRequest(order, product, requestId);
    const attempt = await one(`INSERT INTO delivery_attempts (order_id, attempt_no, supplier_id, request_id, request_summary) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [order.id, attemptNo, supplier.id, requestId, { kind: req.kind, network: req.network, recipient: req.recipient, product_code: req.productCode, face_value_minor: req.faceValueMinor }], db);
    await transition(db, order, 'processing', { type: 'system' }, 'delivery_requested', `Delivery request ${requestId} sent to ${supplier.name}`, null, "fulfilment_mode = 'auto', supplier_id = $4", [supplier.id]);
    return { attemptId: attempt!.id as number, req, adapter: supplier.adapter as string };
  });
  if (!plan) return;
  let result: DeliveryResult;
  try {
    result = await adapterFor(plan.adapter)!.deliver(plan.req);
  } catch (e) {
    // Network errors and timeouts mean the supplier MAY have delivered. Never assume either way.
    result = { outcome: 'unknown', message: e instanceof Error ? e.message : 'supplier error' };
  }
  await applyDeliveryResult(plan.attemptId, result);
}

export async function applyDeliveryResult(attemptId: number, result: DeliveryResult) {
  const followUp = await tx(async (db) => {
    const attempt = await one('SELECT a.*, s.adapter, s.name AS supplier_name FROM delivery_attempts a JOIN suppliers s ON s.id = a.supplier_id WHERE a.id = $1 FOR UPDATE OF a', [attemptId], db);
    if (!attempt || !['sending', 'pending', 'unknown'].includes(attempt.status)) return null;
    const order = (await one('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [attempt.order_id], db))!;
    const final = result.outcome === 'success' || result.outcome === 'failed';
    await db.query(`UPDATE delivery_attempts SET status = $2, supplier_reference = COALESCE($3, supplier_reference), response_summary = $4, error_message = $5, completed_at = CASE WHEN $6 THEN now() ELSE completed_at END WHERE id = $1`,
      [attemptId, result.outcome, result.supplierReference ?? null, { outcome: result.outcome, message: result.message ?? null }, result.outcome === 'success' ? null : result.message ?? null, final]);
    const actor: Actor = { type: 'supplier' };
    if (result.outcome === 'success') {
      if (!['processing', 'needs_review', 'queued'].includes(order.status)) return null;
      await transition(db, order, 'successful', actor, 'delivered', `Supplier confirmed delivery${result.supplierReference ? ` (ref ${result.supplierReference})` : ''}`, null,
        'delivered_at = now(), supplier_reference = $4, actual_cost_minor = COALESCE($5, expected_cost_minor)', [result.supplierReference ?? null, result.costMinor ?? null]);
      await onDelivered(db, order);
      return null;
    }
    if (result.outcome === 'failed') {
      if (!['processing', 'needs_review', 'queued'].includes(order.status)) return null;
      // Our wallet at the supplier is empty: nothing was sent. Hold the order and try again automatically after a top-up,
      // instead of telling the customer it failed.
      if (result.lowBalance && order.status === 'processing' && Number(attempt.attempt_no) < LOW_BALANCE_MAX_TRIES) {
        await transition(db, order, 'queued', { type: 'system' }, 'delivery_delayed', `${attempt.supplier_name} wallet is empty. The order is waiting and will be sent automatically after a top-up (try ${attempt.attempt_no}).`);
        return { lowBalance: true, orderId: Number(order.id), tryNo: Number(attempt.attempt_no), reference: order.reference as string, supplier: attempt.supplier_name as string };
      }
      await transition(db, order, 'failed', actor, 'delivery_failed', `Supplier says the top-up was not delivered: ${result.message || 'no reason given'}`);
      await notify({ userId: order.user_id, email: order.contact_email, orderId: order.id, type: 'order_failed', title: `We couldn't deliver order ${order.reference}`, body: `Your ${order.product_snapshot?.name} to ${order.recipient_phone} could not be delivered. Our team will retry or refund you. Reference: ${order.reference}` }, db);
      alertAdmins('Delivery failed', `Order ${order.reference} failed at supplier: ${result.message}`);
      return null;
    }
    if (result.outcome === 'pending') {
      await addEvent(db, order.id, 'delivery_pending', `Supplier accepted the request and is processing it${result.supplierReference ? ` (ref ${result.supplierReference})` : ''}`, actor);
      if (!adapterFor(attempt.adapter)?.checkStatus) alertAdmins('Delivery waiting for confirmation', `Order ${order.reference}: ${attempt.supplier_name} accepted it but has not confirmed delivery. Check the supplier dashboard, then record the result.`);
      return { check: true, adapter: attempt.adapter };
    }
    // unknown
    if (order.status === 'processing') {
      await transition(db, order, 'needs_review', { type: 'system' }, 'review_required', `Supplier result is unknown (${result.message || 'no response'}). It will NOT be retried automatically — check with ${attempt.supplier_name} first.`);
    }
    alertAdmins('Delivery needs review', `Order ${order.reference}: supplier outcome unknown.`);
    return { check: true, adapter: attempt.adapter };
  });
  const held = followUp as { lowBalance?: boolean; orderId: number; tryNo: number; reference: string; supplier: string } | null;
  if (held?.lowBalance) {
    // First retries come quickly (the owner may be topping up right now), then every 5 minutes for about 8 hours.
    const delayMs = held.tryNo <= 3 ? 60_000 : 5 * 60_000;
    await enqueue('fulfil', { orderId: held.orderId, retry: true }, { uniqueKey: `lowbal:${held.orderId}:${held.tryNo}`, delayMs });
    alertAdmins(`${held.supplier} wallet is empty`, `Top up your ${held.supplier} wallet now. Order ${held.reference} is paid and waiting. It will be delivered automatically after you top up.`);
    return;
  }
  const chk = followUp as { check?: boolean; adapter: string } | null;
  if (chk?.check && adapterFor(chk.adapter)?.checkStatus) {
    await enqueue('check_delivery', { attemptId, n: 1 }, { uniqueKey: `check:${attemptId}:1`, delayMs: 15_000 });
  }
}

async function onDelivered(db: Queryable, order: any) {
  if (order.agent_id && order.agent_commission_minor > 0) {
    await db.query(`INSERT INTO agent_ledger (agent_id, order_id, type, amount_minor, note) VALUES ($1,$2,'commission',$3,$4) ON CONFLICT (order_id) WHERE type = 'commission' DO NOTHING`,
      [order.agent_id, order.id, order.agent_commission_minor, `Commission for ${order.reference}`]);
  }
  await notify({ userId: order.user_id, email: order.contact_email, orderId: order.id, type: 'order_delivered', title: `Delivered: ${order.product_snapshot?.name}`, body: `Your ${order.product_snapshot?.name} to ${order.recipient_phone} was delivered. Reference: ${order.reference}` }, db);
}

export async function checkDelivery(attemptId: number, n: number) {
  const a = await one('SELECT a.*, s.adapter FROM delivery_attempts a JOIN suppliers s ON s.id = a.supplier_id WHERE a.id = $1', [attemptId]);
  if (!a || !['pending', 'unknown', 'sending'].includes(a.status)) return;
  const adapter = adapterFor(a.adapter);
  if (!adapter?.checkStatus) return;
  const order = (await one('SELECT * FROM orders WHERE id = $1', [a.order_id]))!;
  const product = (await one('SELECT * FROM products WHERE id = $1', [order.product_id]))!;
  let r: DeliveryResult;
  try { r = await adapter.checkStatus(deliveryRequest(order, product, a.request_id), a.supplier_reference); } catch (e) { r = { outcome: 'unknown', message: e instanceof Error ? e.message : 'status check failed' }; }
  if (r.outcome === 'success' || r.outcome === 'failed') return applyDeliveryResult(attemptId, r);
  // Keep the latest supplier answer visible to admins (e.g. "DataMart: waiting").
  await q(`UPDATE delivery_attempts SET response_summary = $2, supplier_reference = COALESCE(supplier_reference, $3) WHERE id = $1`,
    [attemptId, { outcome: r.outcome, message: r.message ?? null, checks: n, checkedAt: new Date().toISOString() }, r.supplierReference ?? null]);
  // Check every 15s at first, then at most every 5 minutes, for up to about 8 hours (networks can run hours behind).
  if (n < 100) {
    await enqueue('check_delivery', { attemptId, n: n + 1 }, { uniqueKey: `check:${attemptId}:${n + 1}`, delayMs: Math.min(5 * 60_000, 15_000 * 2 ** Math.min(n, 5)) });
  } else if (order.status === 'processing') {
    await tx(async (db) => {
      const o = (await one('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [order.id], db))!;
      if (o.status === 'processing') await transition(db, o, 'needs_review', { type: 'system' }, 'review_required', 'Supplier has not confirmed delivery after many checks. Investigate with the supplier.');
    });
  }
}

// ---------- Periodic housekeeping ----------
export async function periodicTasks() {
  // 1) Payments still "initialized" after 5 minutes: ask Paystack directly (covers missed or delayed webhooks).
  const stale = await q(`SELECT provider_reference FROM payments WHERE status = 'initialized' AND created_at < now() - interval '5 minutes' AND created_at > now() - interval '3 days' AND (verified_at IS NULL OR verified_at < now() - interval '4 minutes') ORDER BY id LIMIT 50`);
  for (const p of stale) { try { await confirmPayment(p.provider_reference, 'reconcile'); } catch (e) { log.warn('reconcile failed', { ref: p.provider_reference, err: e }); } }
  // 2) Expire unpaid orders (only when no payment attempt is still open).
  const limits = await getSetting('limits');
  const expiring = await q(`SELECT o.* FROM orders o WHERE o.status IN ('pending_payment','payment_failed') AND o.created_at < now() - make_interval(mins => $1)
      AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.order_id = o.id AND p.status = 'initialized' AND p.created_at > now() - interval '3 hours') LIMIT 100`, [limits.order_expiry_minutes]);
  for (const o of expiring) {
    await tx(async (db) => {
      const cur = (await one('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [o.id], db))!;
      if (['pending_payment', 'payment_failed'].includes(cur.status)) await transition(db, cur, 'expired', { type: 'system' }, 'expired', 'Order expired without a completed payment');
    }).catch((e) => log.warn('expire failed', { err: e }));
  }
  // 3) Supplier requests stuck in "sending" (process crashed mid-request) become "unknown" and go to review.
  const stuck = await q(`SELECT id FROM delivery_attempts WHERE status = 'sending' AND started_at < now() - interval '5 minutes' LIMIT 50`);
  for (const a of stuck) await applyDeliveryResult(a.id, { outcome: 'unknown', message: 'No response recorded (server restarted during the request)' });
  // 4) Refunds being processed by Paystack: check their status.
  await reconcileRefunds();
  // 5) Daily phone notification run (once per day after the configured hour).
  await scheduleDailyPush().catch((e) => log.warn('daily push schedule failed', { err: e }));
}

export async function reconcileRefunds() {
  const provider = paymentProvider();
  if (!provider) return;
  const rows = await q(`SELECT * FROM refunds WHERE status = 'processing' AND provider_refund_id IS NOT NULL ORDER BY id LIMIT 50`);
  for (const r of rows) {
    const st = await provider.refundStatus(r.provider_refund_id).catch(() => 'unknown' as const);
    if (st === 'processed' || st === 'failed') await finishRefund(r.id, st, 'reconcile');
  }
}

export async function finishRefund(refundId: number, outcome: 'processed' | 'failed', source: string) {
  await tx(async (db) => {
    const r = await one('SELECT * FROM refunds WHERE id = $1 FOR UPDATE', [refundId], db);
    if (!r || r.status !== 'processing') return;
    await db.query(`UPDATE refunds SET status = $2, processed_at = CASE WHEN $2 = 'processed' THEN now() ELSE processed_at END, updated_at = now() WHERE id = $1`, [r.id, outcome]);
    const order = (await one('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [r.order_id], db))!;
    if (order.status === 'refund_pending') {
      if (outcome === 'processed') {
        await transition(db, order, 'refunded', { type: 'payment_provider' }, 'refunded', `Refund of ${formatGhs(r.amount_minor)} completed by Paystack`, { source });
        await notify({ userId: order.user_id, email: order.contact_email, orderId: order.id, type: 'order_refunded', title: `Refund completed for ${order.reference}`, body: `We refunded ${formatGhs(r.amount_minor)} for order ${order.reference}.` }, db);
      } else {
        await transition(db, order, 'failed', { type: 'payment_provider' }, 'refund_failed', 'Paystack could not complete the refund. An admin needs to follow up.', { source });
        alertAdmins('Refund failed', `Refund for ${order.reference} failed at Paystack.`);
      }
    } else {
      await addEvent(db, order.id, outcome === 'processed' ? 'refund_processed' : 'refund_failed', `Refund #${r.id} (${formatGhs(r.amount_minor)}) ${outcome}`, { type: 'payment_provider' }, { source });
    }
  });
}

// ---------- Admin actions (every one is audited) ----------
async function loadForUpdate(db: Queryable, reference: string) {
  const o = await one('SELECT * FROM orders WHERE reference = $1 FOR UPDATE', [reference], db);
  if (!o) throw notFound('Order not found');
  return o;
}

export async function adminRecordDelivery(ctx: Ctx, reference: string, input: { confirmationReference?: string | null; note: string }) {
  const admin: Actor = { type: 'admin', userId: ctx.user!.id };
  await tx(async (db) => {
    const o = await loadForUpdate(db, reference);
    if (!['queued', 'needs_review', 'failed'].includes(o.status)) throw conflict(`Delivery can't be recorded while the order is "${STATUS_LABEL[o.status as OrderStatus]}"`);
    const product = (await one('SELECT manual_fulfilment_allowed FROM products WHERE id = $1', [o.product_id], db))!;
    const last = await one('SELECT * FROM delivery_attempts WHERE order_id = $1 ORDER BY attempt_no DESC LIMIT 1', [o.id], db);
    if (last && ['sending', 'pending'].includes(last.status)) throw conflict('A supplier request is still in progress for this order. Wait for its result.');
    const resolvingUnknown = last?.status === 'unknown';
    if (!resolvingUnknown && !product.manual_fulfilment_allowed) throw conflict('Manual delivery is not allowed for this product');
    if (resolvingUnknown) {
      await db.query(`UPDATE delivery_attempts SET status = 'success', supplier_reference = COALESCE($2, supplier_reference), completed_at = now(), error_message = NULL WHERE id = $1`, [last.id, input.confirmationReference || null]);
    }
    const before = { status: o.status };
    await transition(db, o, 'successful', admin, resolvingUnknown ? 'review_resolved_delivered' : 'manual_delivery_recorded',
      `${resolvingUnknown ? 'Admin confirmed with the supplier that it was delivered' : 'Admin recorded manual delivery'}: ${input.note}${input.confirmationReference ? ` (confirmation ${input.confirmationReference})` : ''}`,
      { confirmation_reference: input.confirmationReference || null }, 'delivered_at = now(), supplier_reference = COALESCE($4, supplier_reference), actual_cost_minor = COALESCE(actual_cost_minor, expected_cost_minor)', [input.confirmationReference || null]);
    await onDelivered(db, o);
    await audit(ctx, 'order.record_delivery', 'order', o.reference, before, { status: 'successful', ...input }, db);
  });
}

export async function adminMarkFailed(ctx: Ctx, reference: string, input: { reason: string; supplierChecked?: boolean }) {
  await tx(async (db) => {
    const o = await loadForUpdate(db, reference);
    if (!['queued', 'needs_review'].includes(o.status)) throw conflict(`Only queued orders or orders under review can be marked failed`);
    const last = await one('SELECT * FROM delivery_attempts WHERE order_id = $1 ORDER BY attempt_no DESC LIMIT 1', [o.id], db);
    if (last && ['sending', 'pending'].includes(last.status)) throw conflict('A supplier request is still in progress. Wait for its result.');
    if (last?.status === 'unknown') {
      if (!input.supplierChecked) throw conflict('Confirm you checked with the supplier that this top-up was NOT delivered.', 'supplier_check_required');
      await db.query(`UPDATE delivery_attempts SET status = 'failed', completed_at = now(), error_message = $2 WHERE id = $1`, [last.id, `Admin confirmed not delivered: ${input.reason}`]);
    }
    await transition(db, o, 'failed', { type: 'admin', userId: ctx.user!.id }, 'marked_failed', `Admin marked delivery as failed: ${input.reason}`);
    await audit(ctx, 'order.mark_failed', 'order', o.reference, { status: last?.status }, input, db);
    await notify({ userId: o.user_id, email: o.contact_email, orderId: o.id, type: 'order_failed', title: `We couldn't deliver order ${o.reference}`, body: `Your order could not be delivered. We'll retry or refund you. Reference: ${o.reference}` }, db);
  });
}

export async function adminRetry(ctx: Ctx, reference: string) {
  await tx(async (db) => {
    const o = await loadForUpdate(db, reference);
    if (o.status !== 'failed') throw conflict('Only failed orders can be retried');
    const openRefund = await one(`SELECT 1 FROM refunds WHERE order_id = $1 AND status IN ('requested','approved','processing','processed')`, [o.id], db);
    if (openRefund) throw conflict('This order has a refund in progress or completed');
    const last = await one('SELECT * FROM delivery_attempts WHERE order_id = $1 ORDER BY attempt_no DESC LIMIT 1', [o.id], db);
    if (last && last.status !== 'failed') throw conflict('The last supplier request is not a confirmed failure. Resolve it before retrying.');
    const n = (await one<{ n: number }>('SELECT count(*)::int AS n FROM order_events WHERE order_id = $1 AND event_type = $2', [o.id, 'retry_requested'], db))!.n + 1;
    await transition(db, o, 'queued', { type: 'admin', userId: ctx.user!.id }, 'retry_requested', `Admin requested delivery retry #${n}`);
    await enqueue('fulfil', { orderId: o.id, retry: true }, { uniqueKey: `fulfil:${o.id}:retry:${n}` }, db);
    await audit(ctx, 'order.retry', 'order', o.reference, null, { retry: n }, db);
  });
}

export async function adminEscalate(ctx: Ctx, reference: string, note: string) {
  await tx(async (db) => {
    const o = await loadForUpdate(db, reference);
    await db.query('UPDATE orders SET escalated = true, updated_at = now() WHERE id = $1', [o.id]);
    await addEvent(db, o.id, 'escalated', `Escalated: ${note}`, { type: 'admin', userId: ctx.user!.id });
    await audit(ctx, 'order.escalate', 'order', o.reference, null, { note }, db);
  });
}

export async function adminReconcile(ctx: Ctx, reference: string) {
  const o = await one('SELECT * FROM orders WHERE reference = $1', [reference]);
  if (!o) throw notFound('Order not found');
  const pays = await q(`SELECT provider_reference FROM payments WHERE order_id = $1 AND status = 'initialized'`, [o.id]);
  const results: Record<string, string> = {};
  for (const p of pays) results[p.provider_reference] = await confirmPayment(p.provider_reference, 'admin');
  const attempts = await q(`SELECT id FROM delivery_attempts WHERE order_id = $1 AND status IN ('pending','unknown')`, [o.id]);
  for (const a of attempts) await checkDelivery(a.id, 99);
  await tx(async (db) => {
    await addEvent(db, o.id, 'reconciled', `Admin ran reconciliation (${Object.keys(results).length} payment checks, ${attempts.length} supplier checks)`, { type: 'admin', userId: ctx.user!.id }, results);
    await audit(ctx, 'order.reconcile', 'order', o.reference, null, results, db);
  });
  return results;
}

/** Starts a refund with Paystack. Blocked whenever the top-up may have been delivered. */
export async function adminRefund(ctx: Ctx, reference: string, input: { reason: string; refundId?: number }) {
  const provider = paymentProvider();
  if (!provider) throw new HttpError(503, 'Payments are not configured', 'payments_unavailable');
  const prep = await tx(async (db) => {
    const o = await loadForUpdate(db, reference);
    let refund = input.refundId ? await one('SELECT * FROM refunds WHERE id = $1 AND order_id = $2 FOR UPDATE', [input.refundId, o.id], db) : null;
    if (input.refundId && !refund) throw notFound('Refund request not found');
    const isDuplicate = refund?.payment_id && refund.reason?.startsWith('Duplicate payment');
    if (!isDuplicate) {
      if (o.status !== 'failed') throw conflict(o.status === 'needs_review' ? 'Resolve the review first: confirm with the supplier whether it was delivered.' : `Refunds are only allowed for failed deliveries (order is "${STATUS_LABEL[o.status as OrderStatus]}")`);
      const unresolved = await one(`SELECT 1 FROM delivery_attempts WHERE order_id = $1 AND status IN ('sending','pending','unknown')`, [o.id], db);
      if (unresolved) throw conflict('A supplier request has no final result — it may have been delivered. Resolve it first.');
    }
    const payment = refund?.payment_id ? await one('SELECT * FROM payments WHERE id = $1', [refund.payment_id], db) : await one(`SELECT * FROM payments WHERE order_id = $1 AND status = 'success' ORDER BY id LIMIT 1`, [o.id], db);
    if (!payment || payment.status !== 'success') throw conflict('No verified payment to refund');
    if (refund) {
      if (!['requested', 'approved'].includes(refund.status)) throw conflict('This refund was already handled');
      await db.query(`UPDATE refunds SET status = 'processing', reviewed_by_user_id = $2, reviewed_at = now(), notes = $3, updated_at = now() WHERE id = $1`, [refund.id, ctx.user!.id, input.reason]);
    } else {
      try {
        refund = await one(`INSERT INTO refunds (order_id, payment_id, amount_minor, reason, status, requested_by_type, requested_by_user_id, reviewed_by_user_id, reviewed_at)
            VALUES ($1,$2,$3,$4,'processing','admin',$5,$5,now()) RETURNING *`, [o.id, payment.id, payment.amount_minor, input.reason, ctx.user!.id], db);
      } catch (e) {
        if (isUniqueViolation(e)) throw conflict('There is already an open refund for this order');
        throw e;
      }
    }
    if (!isDuplicate) await transition(db, o, 'refund_pending', { type: 'admin', userId: ctx.user!.id }, 'refund_started', `Refund of ${formatGhs(payment.amount_minor)} started: ${input.reason}`);
    await audit(ctx, 'order.refund', 'order', o.reference, { status: o.status }, { refund_id: refund!.id, reason: input.reason }, db);
    return { refundId: refund!.id as number, providerRef: payment.provider_reference as string, amount: payment.amount_minor as number, isDuplicate };
  });
  const r = await provider.refund(prep.providerRef, prep.amount, input.reason);
  if (r.ok) {
    await q(`UPDATE refunds SET provider_refund_id = $2, updated_at = now() WHERE id = $1`, [prep.refundId, r.refundId]);
    if (r.status === 'processed') await finishRefund(prep.refundId, 'processed', 'provider');
    return { ok: true, message: 'Refund submitted to Paystack' };
  }
  await tx(async (db) => {
    await db.query(`UPDATE refunds SET status = 'failed', notes = COALESCE(notes,'') || $2, updated_at = now() WHERE id = $1`, [prep.refundId, ` | Paystack: ${r.message}`]);
    const o = (await one('SELECT * FROM orders WHERE reference = $1 FOR UPDATE', [reference], db))!;
    if (o.status === 'refund_pending') await transition(db, o, 'failed', { type: 'payment_provider' }, 'refund_failed', `Paystack rejected the refund: ${r.message}`);
  });
  throw new HttpError(502, `Paystack did not accept the refund: ${r.message}`, 'refund_rejected');
}

// ---------- Job registration ----------
registerJob('fulfil', async (p) => fulfil(Number(p.orderId), { retry: !!p.retry }));
registerJob('check_delivery', async (p) => checkDelivery(Number(p.attemptId), Number(p.n || 1)));
