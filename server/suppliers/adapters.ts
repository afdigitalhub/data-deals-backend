import { config } from '../config.js';

/**
 * Supplier adapters turn a paid order into a real top-up through an AUTHORISED supplier API.
 *
 * Outcomes are deliberately strict:
 *  - success : the supplier's documented contract says the top-up is CONFIRMED delivered
 *  - pending : the supplier accepted the request but has not confirmed delivery yet
 *  - failed  : the supplier definitively says it was NOT delivered (safe to retry or refund)
 *  - unknown : timeout / network error / unexpected reply — it MAY have been delivered.
 *              Never retried automatically; goes to the admin investigation queue.
 */
export type DeliveryOutcome = 'success' | 'pending' | 'failed' | 'unknown';
export interface DeliveryResult { outcome: DeliveryOutcome; supplierReference?: string | null; message?: string; costMinor?: number | null; raw?: Record<string, unknown> }
export interface DeliveryRequest { requestId: string; kind: 'data' | 'airtime'; network: string; recipient: string; productCode: string | null; faceValueMinor: number | null; dataMb?: number | null }

export interface SupplierAdapter {
  code: string;
  /** Automated adapters send requests to a supplier API. The manual adapter never does. */
  automated: boolean;
  missingConfig(): string[];
  testConnection(): Promise<{ ok: boolean; message: string; balanceMinor?: number | null }>;
  deliver(req: DeliveryRequest): Promise<DeliveryResult>;
  checkStatus?(req: DeliveryRequest, supplierReference: string | null): Promise<DeliveryResult>;
  /** Returns a reason if this adapter cannot deliver this request, checked BEFORE anything is sent. */
  unsupported?(req: DeliveryRequest): string | null;
}

const manual: SupplierAdapter = {
  code: 'manual',
  automated: false,
  missingConfig: () => [],
  async testConnection() { return { ok: true, message: 'Manual fulfilment is handled by authorised admins in the dashboard.' }; },
  async deliver() { throw new Error('manual adapter does not deliver automatically'); },
};

/**
 * RemaData — the founders' chosen supplier. RemaData does not publish public API documentation, so this adapter
 * is intentionally NOT wired to any guessed endpoints. Once the founders receive the official API documentation
 * and credentials, implement deliver()/checkStatus() against that contract and set the env vars below.
 */
const remadata: SupplierAdapter = {
  code: 'remadata',
  automated: true,
  missingConfig() {
    const m: string[] = [];
    if (!config.remadata.apiKey) m.push('REMADATA_API_KEY');
    if (!config.remadata.baseUrl) m.push('REMADATA_API_BASE_URL');
    m.push('Official RemaData API documentation (request/response contract not yet implemented)');
    return m;
  },
  async testConnection() {
    return { ok: false, message: 'Not connected. Waiting for RemaData API documentation and credentials.' };
  },
  async deliver() {
    return { outcome: 'failed', message: 'RemaData integration is not connected yet — no request was sent.' };
  },
};

/**
 * Sandbox supplier — ONLY for automated tests and local development (refuses to run in production).
 * Recipient number endings choose the simulated outcome: ...1 failed, ...2 unknown, ...3 pending→success, else success.
 */
export const sandboxCalls: DeliveryRequest[] = [];
const sandbox: SupplierAdapter = {
  code: 'sandbox',
  automated: true,
  missingConfig: () => (config.supplierSandbox ? [] : ['SUPPLIER_SANDBOX (test environments only)']),
  async testConnection() { return { ok: config.supplierSandbox, message: config.supplierSandbox ? 'Sandbox reachable (TEST ONLY)' : 'Sandbox disabled', balanceMinor: null }; },
  async deliver(req) {
    if (!config.supplierSandbox) return { outcome: 'failed', message: 'sandbox disabled' };
    sandboxCalls.push(req);
    const end = req.recipient.slice(-1);
    if (end === '1') return { outcome: 'failed', supplierReference: 'SBX-F-' + req.requestId, message: 'Sandbox: recipient not eligible' };
    if (end === '2') return { outcome: 'unknown', message: 'Sandbox: simulated timeout' };
    if (end === '3') return { outcome: 'pending', supplierReference: 'SBX-P-' + req.requestId, message: 'Sandbox: accepted, awaiting confirmation' };
    return { outcome: 'success', supplierReference: 'SBX-S-' + req.requestId, message: 'Sandbox: delivered (TEST)' };
  },
  async checkStatus(req, ref) {
    return { outcome: 'success', supplierReference: ref || 'SBX-S-' + req.requestId, message: 'Sandbox: confirmed (TEST)' };
  },
};


/**
 * DataMart GH — documented at https://www.datamartgh.shop/api-doc (Authentication + Purchase Data sections).
 *  POST {base}/purchase  headers: X-API-Key, X-Idempotency-Key (+ X-API-Secret if enabled)
 *  body: { phoneNumber: "0551234567", network: "YELLO" | "TELECEL" | "AT_PREMIUM", capacity: "5" (GB), gateway: "wallet", ref }
 *  reply: { status: "success", data: { purchaseId, orderReference, price, orderStatus: "completed" | ... } }
 *         { status: "error", message } on refusal (e.g. insufficient wallet balance) — nothing is charged.
 * The idempotency key is our attempt id, so a retry of the same attempt can never charge twice.
 */
const DM_NETWORK: Record<string, string> = { MTN: 'YELLO', TELECEL: 'TELECEL', AT: 'AT_PREMIUM' };
const DM_TIMEOUT_MS = 45_000;

export function datamartCapacity(req: DeliveryRequest): string | null {
  const code = (req.productCode || '').trim().toUpperCase().replace(/\s*GB$/, '');
  if (code) return /^\d+(\.\d+)?$/.test(code) && Number(code) > 0 ? String(Number(code)) : null;
  if (req.dataMb && req.dataMb % 1024 === 0) return String(req.dataMb / 1024);
  return null;
}

async function dmCall(method: 'GET' | 'POST', path: string, body?: unknown, idempotencyKey?: string): Promise<{ http: number; json: any }> {
  const headers: Record<string, string> = { 'X-API-Key': config.datamart.apiKey, Accept: 'application/json' };
  if (config.datamart.apiSecret) headers['X-API-Secret'] = config.datamart.apiSecret;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (idempotencyKey) headers['X-Idempotency-Key'] = idempotencyKey;
  const res = await fetch(config.datamart.baseUrl + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(DM_TIMEOUT_MS) });
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  return { http: res.status, json };
}

const toMinor = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 100) : typeof v === 'string' && /^\d+(\.\d+)?$/.test(v) ? Math.round(Number(v) * 100) : null);

export function interpretDatamartPurchase(http: number, json: any): DeliveryResult {
  const msg = (json && typeof json.message === 'string' ? json.message : '') || `HTTP ${http}`;
  const code = json && typeof json.code === 'string' ? json.code : '';
  // Server errors, "already processing" and odd replies: the bundle MAY have gone through. Never guess.
  if (http >= 500 || http === 408 || http === 409 || code === 'REQUEST_IN_PROGRESS') return { outcome: 'unknown', message: `DataMart: ${msg}` };
  if (http >= 400) return { outcome: 'failed', message: `DataMart refused the order (nothing was sent): ${msg}${code ? ` [${code}]` : ''}` };
  if (!json || json.status !== 'success' || !json.data) {
    if (json && json.status === 'error') return { outcome: 'failed', message: `DataMart refused the order: ${msg}` };
    return { outcome: 'unknown', message: `DataMart gave an unexpected reply (${msg})` };
  }
  const d = json.data;
  const ref = String(d.orderReference || d.purchaseId || d.transactionReference || '') || null;
  const status = String(d.orderStatus || '').toLowerCase();
  const costMinor = toMinor(d.price);
  if (status === 'completed' || status === 'delivered' || status === 'successful' || status === 'success') return { outcome: 'success', supplierReference: ref, costMinor, message: 'DataMart: delivered' };
  if (status === 'failed' || status === 'cancelled' || status === 'canceled' || status === 'refunded') return { outcome: 'failed', supplierReference: ref, message: `DataMart: order ${status}` };
  return { outcome: 'pending', supplierReference: ref, costMinor, message: `DataMart accepted the order (status: ${status || 'processing'}). Confirm delivery in the DataMart dashboard.` };
}

const datamart: SupplierAdapter = {
  code: 'datamart',
  automated: true,
  missingConfig() {
    return config.datamart.apiKey ? [] : ['DATAMART_API_KEY'];
  },
  unsupported(req) {
    if (req.kind !== 'data') return 'DataMart is only connected for data bundles';
    if (!DM_NETWORK[req.network]) return `DataMart does not support network ${req.network}`;
    if (!datamartCapacity(req)) return 'Set the DataMart bundle size in GB (e.g. 1, 2, 5) as the supplier product code';
    return null;
  },
  async testConnection() {
    if (!config.datamart.apiKey) return { ok: false, message: 'DATAMART_API_KEY is not set in Render yet.' };
    // Read-only wallet balance check. Places no order and spends nothing.
    const { http, json } = await dmCall('GET', '/balance');
    const msg = (json && json.message) || `HTTP ${http}`;
    if (http === 401 || http === 403) return { ok: false, message: `DataMart rejected the API key (${msg}). Check the key in Render, and the IP allow-list in DataMart.` };
    if (http === 404) return { ok: false, message: 'DataMart balance address not found. Send the Balance section of the DataMart docs so it can be confirmed.' };
    if (http >= 200 && http < 300 && json && json.status === 'success') {
      const d = json.data ?? json;
      const bal = toMinor(d.balance ?? d.walletBalance ?? d.currentBalance ?? d.availableBalance);
      return { ok: true, message: bal == null ? 'Connected to DataMart (key accepted).' : `Connected to DataMart. Wallet balance: GHS ${(bal / 100).toFixed(2)}`, balanceMinor: bal };
    }
    return { ok: false, message: `DataMart replied unexpectedly: ${msg}` };
  },
  async deliver(req) {
    const network = DM_NETWORK[req.network];
    const capacity = datamartCapacity(req);
    if (!network || !capacity || req.kind !== 'data') return { outcome: 'failed', message: 'Not sent: product is not set up for DataMart' };
    const ref = `${config.datamart.refPrefix}${req.requestId}`;
    const { http, json } = await dmCall('POST', '/purchase', { phoneNumber: req.recipient, network, capacity, gateway: 'wallet', ref }, ref);
    return { ...interpretDatamartPurchase(http, json), raw: { http, status: json?.status ?? null } };
  },
};

const registry: Record<string, SupplierAdapter> = { manual, remadata, datamart, sandbox };
export function adapterFor(code: string): SupplierAdapter | null { return registry[code] ?? null; }
export function isAdapterReady(code: string): boolean {
  const a = adapterFor(code);
  return !!a && a.automated && a.missingConfig().length === 0;
}
