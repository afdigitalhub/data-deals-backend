import { createHash } from 'node:crypto';
import { one, q, isUniqueViolation } from '../db/pool.js';
import { log } from '../lib/log.js';
import type { Router } from '../http/core.js';
import { paymentProvider } from '../payments/provider.js';
import { confirmPayment, finishRefund } from '../services/orders.js';

function sanitize(event: any) {
  // Keep what's useful for reconciliation; drop card authorization codes and customer metadata.
  const d = event?.data || {};
  return {
    event: event?.event, reference: d.reference ?? null, status: d.status ?? null, amount: d.amount ?? null, currency: d.currency ?? null,
    channel: d.channel ?? null, gateway_response: d.gateway_response ?? null, paid_at: d.paid_at ?? null, refund_id: d.id ?? null,
    transaction_reference: d.transaction_reference ?? d.transaction?.reference ?? null,
  };
}

export function registerWebhookRoutes(r: Router) {
  r.post('/api/webhooks/paystack', async (ctx) => {
    const provider = paymentProvider();
    const raw = ctx.rawBody ?? Buffer.alloc(0);
    const sig = ctx.req.headers['x-paystack-signature'];
    const valid = !!provider && provider.verifyWebhookSignature(raw, Array.isArray(sig) ? sig[0] : sig);
    const bodyHash = createHash('sha256').update(raw).digest('hex');
    let event: any = null;
    try { event = JSON.parse(raw.toString('utf8')); } catch { /* ignore */ }

    if (!valid) {
      // Unsigned or forged: record the attempt (without trusting its content) and reject.
      await q(`INSERT INTO payment_events (provider, event_type, body_sha256, signature_valid, processing_result) VALUES ('paystack', $1, $2, false, 'rejected: bad signature')`,
        [typeof event?.event === 'string' ? event.event.slice(0, 50) : null, bodyHash]);
      log.warn('paystack webhook with invalid signature', { ip: ctx.ip });
      ctx.json(401, { error: 'invalid signature' });
      return;
    }
    const s = sanitize(event);
    let eventId: number;
    try {
      const row = await one(`INSERT INTO payment_events (provider, event_type, provider_reference, body_sha256, signature_valid, payload) VALUES ('paystack',$1,$2,$3,true,$4) RETURNING id`,
        [s.event, s.reference, bodyHash, s]);
      eventId = row.id;
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      // Exact duplicate delivery. If the earlier copy was fully processed we're done; otherwise process it now.
      const prev = await one(`SELECT id, processed_at FROM payment_events WHERE provider = 'paystack' AND body_sha256 = $1 AND signature_valid`, [bodyHash]);
      if (prev?.processed_at) { ctx.json(200, { ok: true, duplicate: true }); return; }
      eventId = prev.id;
    }

    let result = 'ignored';
    try {
      if (s.event === 'charge.success' && s.reference) {
        result = await confirmPayment(s.reference, 'webhook'); // re-verifies with Paystack's API before trusting it
      } else if (s.event === 'refund.processed' || s.event === 'refund.failed') {
        const refund = await one(`SELECT r.id FROM refunds r LEFT JOIN payments p ON p.id = r.payment_id
            WHERE r.status = 'processing' AND (($1::text IS NOT NULL AND r.provider_refund_id = $1) OR ($2::text IS NOT NULL AND p.provider_reference = $2))
            ORDER BY r.id DESC LIMIT 1`, [s.refund_id ? String(s.refund_id) : null, s.transaction_reference]);
        if (refund) { await finishRefund(refund.id, s.event === 'refund.processed' ? 'processed' : 'failed', 'webhook'); result = s.event; }
        else result = 'refund not found';
      }
    } catch (e) {
      result = 'error: ' + (e instanceof Error ? e.message : 'unknown');
      log.error('webhook processing failed', { eventId, err: e });
      await q(`UPDATE payment_events SET processing_result = $2 WHERE id = $1`, [eventId, result.slice(0, 300)]);
      // Non-2xx makes Paystack retry later; processing is idempotent so that's safe.
      ctx.json(500, { error: 'processing failed' });
      return;
    }
    await q(`UPDATE payment_events SET processing_result = $2, processed_at = now() WHERE id = $1`, [eventId, result]);
    ctx.json(200, { ok: true });
  });
}
