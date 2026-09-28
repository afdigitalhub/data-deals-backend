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
export interface DeliveryRequest { requestId: string; kind: 'data' | 'airtime'; network: string; recipient: string; productCode: string | null; faceValueMinor: number | null }

export interface SupplierAdapter {
  code: string;
  /** Automated adapters send requests to a supplier API. The manual adapter never does. */
  automated: boolean;
  missingConfig(): string[];
  testConnection(): Promise<{ ok: boolean; message: string; balanceMinor?: number | null }>;
  deliver(req: DeliveryRequest): Promise<DeliveryResult>;
  checkStatus?(req: DeliveryRequest, supplierReference: string | null): Promise<DeliveryResult>;
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

const registry: Record<string, SupplierAdapter> = { manual, remadata, sandbox };
export function adapterFor(code: string): SupplierAdapter | null { return registry[code] ?? null; }
export function isAdapterReady(code: string): boolean {
  const a = adapterFor(code);
  return !!a && a.automated && a.missingConfig().length === 0;
}
