import { config } from '../config.js';
import { log } from '../lib/log.js';

/**
 * One-off, READ-ONLY lookup of DataMart's package list (prices for this account's tier), written to the server log
 * so the founders' selling prices can be set above DataMart's cost. Places no order and spends nothing.
 * Enabled only when DATAMART_PROBE is not "off". Remove once prices are set.
 */
export async function probeDatamartPackages() {
  if (!config.datamart.apiKey || process.env.DATAMART_PROBE === 'off' || config.isTest) return;
  const headers: Record<string, string> = { 'X-API-Key': config.datamart.apiKey, Accept: 'application/json' };
  if (config.datamart.apiSecret) headers['X-API-Secret'] = config.datamart.apiSecret;
  for (const path of ['/data-packages', '/packages', '/data-packages?network=YELLO']) {
    try {
      const res = await fetch(config.datamart.baseUrl + path, { headers, signal: AbortSignal.timeout(20_000) });
      const text = await res.text();
      log.info('DMPROBE', { path, http: res.status, body: text.slice(0, 8000) });
      if (res.ok) break;
    } catch (e) {
      log.info('DMPROBE', { path, error: e instanceof Error ? e.message : String(e) });
    }
  }
}
