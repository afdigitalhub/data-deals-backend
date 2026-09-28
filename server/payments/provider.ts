import { createHmac } from 'node:crypto';
import { config, paymentsMode } from '../config.js';
import { safeEqual } from '../lib/crypto.js';
import { log } from '../lib/log.js';

export interface InitResult { authorizationUrl: string; accessCode: string | null }
export interface VerifyResult {
  found: boolean;
  status: 'success' | 'failed' | 'abandoned' | 'pending' | 'reversed' | 'unknown';
  amountMinor: number | null;
  currency: string | null;
  channel: string | null;
  gatewayResponse: string | null;
  paidAt: string | null;
  feesMinor: number | null;
}
export interface RefundResult { ok: boolean; refundId: string | null; status: string | null; message: string }

export class PaymentUnavailable extends Error {}

export interface PaymentProvider {
  name: string;
  isTestMode: boolean;
  initialize(p: { reference: string; amountMinor: number; email: string; callbackUrl: string; metadata: Record<string, unknown>; channels?: string[] }): Promise<InitResult>;
  verify(reference: string): Promise<VerifyResult>;
  refund(reference: string, amountMinor: number, note: string): Promise<RefundResult>;
  refundStatus(refundId: string): Promise<'processed' | 'pending' | 'failed' | 'unknown'>;
  verifyWebhookSignature(rawBody: Buffer, signature: string | undefined): boolean;
}

// ---------- Paystack (official REST API) ----------
async function paystackCall(method: string, path: string, body?: unknown) {
  const res = await fetch(`${config.paystack.baseUrl}${path}`, {
    method,
    headers: { Authorization: `Bearer ${config.paystack.secretKey}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  let data: any = null;
  try { data = await res.json(); } catch { /* non-JSON */ }
  return { httpStatus: res.status, data };
}

const paystack: PaymentProvider = {
  name: 'paystack',
  get isTestMode() { return paymentsMode() === 'test'; },
  async initialize(p) {
    const { httpStatus, data } = await paystackCall('POST', '/transaction/initialize', {
      reference: p.reference, amount: p.amountMinor, currency: 'GHS', email: p.email, callback_url: p.callbackUrl, metadata: p.metadata, ...(p.channels ? { channels: p.channels } : {}),
    });
    if (httpStatus !== 200 || !data?.status || !data?.data?.authorization_url) {
      log.warn('paystack initialize failed', { httpStatus, message: data?.message });
      throw new PaymentUnavailable(data?.message || 'Payment provider did not accept the request');
    }
    return { authorizationUrl: data.data.authorization_url, accessCode: data.data.access_code ?? null };
  },
  async verify(reference) {
    const { httpStatus, data } = await paystackCall('GET', `/transaction/verify/${encodeURIComponent(reference)}`);
    if (httpStatus === 404 || (data && data.status === false && /not found/i.test(data.message || ''))) {
      return { found: false, status: 'unknown', amountMinor: null, currency: null, channel: null, gatewayResponse: null, paidAt: null, feesMinor: null };
    }
    if (httpStatus !== 200 || !data?.data) throw new PaymentUnavailable(`Verification unavailable (HTTP ${httpStatus})`);
    const d = data.data;
    const s = String(d.status || '').toLowerCase();
    const status: VerifyResult['status'] = s === 'success' ? 'success' : s === 'failed' ? 'failed' : s === 'abandoned' ? 'abandoned' : s === 'reversed' ? 'reversed' : ['ongoing', 'pending', 'processing', 'queued'].includes(s) ? 'pending' : 'unknown';
    return {
      found: true, status,
      amountMinor: typeof d.amount === 'number' ? d.amount : null,
      currency: d.currency ?? null,
      channel: d.channel ?? null,
      gatewayResponse: d.gateway_response ?? null,
      paidAt: d.paid_at ?? d.paidAt ?? null,
      feesMinor: typeof d.fees === 'number' ? d.fees : null,
    };
  },
  async refund(reference, amountMinor, note) {
    const { httpStatus, data } = await paystackCall('POST', '/refund', { transaction: reference, amount: amountMinor, merchant_note: note.slice(0, 200) });
    const ok = (httpStatus === 200 || httpStatus === 201) && data?.status === true;
    return { ok, refundId: data?.data?.id ? String(data.data.id) : null, status: data?.data?.status ?? null, message: data?.message || `HTTP ${httpStatus}` };
  },
  async refundStatus(refundId) {
    const { httpStatus, data } = await paystackCall('GET', `/refund/${encodeURIComponent(refundId)}`);
    if (httpStatus !== 200 || !data?.data) return 'unknown';
    const s = String(data.data.status || '').toLowerCase();
    return s === 'processed' ? 'processed' : s === 'failed' ? 'failed' : ['pending', 'processing', 'needs-attention'].includes(s) ? 'pending' : 'unknown';
  },
  verifyWebhookSignature(rawBody, signature) {
    if (!signature || !config.paystack.secretKey) return false;
    const expected = createHmac('sha512', config.paystack.secretKey).update(rawBody).digest('hex');
    return safeEqual(expected, signature);
  },
};

// ---------- Fake provider: automated tests / local development only (disabled in production) ----------
export const fakeLedger = new Map<string, { amountMinor: number; status: VerifyResult['status']; callbackUrl?: string }>();
export const fakeRefunds = new Map<string, 'processed' | 'pending' | 'failed'>();
export const FAKE_WEBHOOK_SECRET = 'fake-webhook-secret';
const fake: PaymentProvider = {
  name: 'fake',
  isTestMode: true,
  async initialize(p) {
    fakeLedger.set(p.reference, { amountMinor: p.amountMinor, status: 'pending', callbackUrl: p.callbackUrl });
    return { authorizationUrl: `${config.publicBaseUrl}/__fake-pay?reference=${encodeURIComponent(p.reference)}`, accessCode: 'fake' };
  },
  async verify(reference) {
    const t = fakeLedger.get(reference);
    if (!t) return { found: false, status: 'unknown', amountMinor: null, currency: null, channel: null, gatewayResponse: null, paidAt: null, feesMinor: null };
    return { found: true, status: t.status, amountMinor: t.amountMinor, currency: 'GHS', channel: 'mobile_money', gatewayResponse: 'Approved (TEST)', paidAt: new Date().toISOString(), feesMinor: Math.round(t.amountMinor * 0.0195) };
  },
  async refund(reference) {
    const t = fakeLedger.get(reference);
    if (!t || t.status !== 'success') return { ok: false, refundId: null, status: null, message: 'Transaction not refundable' };
    fakeRefunds.set('fake-refund-' + reference, 'pending');
    return { ok: true, refundId: 'fake-refund-' + reference, status: 'pending', message: 'Refund has been queued for processing' };
  },
  async refundStatus(refundId) { return fakeRefunds.get(refundId) ?? 'unknown'; },
  verifyWebhookSignature(rawBody, signature) {
    if (!signature) return false;
    return safeEqual(createHmac('sha512', FAKE_WEBHOOK_SECRET).update(rawBody).digest('hex'), signature);
  },
};

export function paymentProvider(): PaymentProvider | null {
  const mode = paymentsMode();
  if (mode === 'fake') return fake;
  if (mode === 'live' || mode === 'test') return paystack;
  return null;
}
