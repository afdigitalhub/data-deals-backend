export const ghs = (minor: number | null | undefined) => minor === null || minor === undefined ? '—' : `GHS ${(minor / 100).toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const cedisToMinor = (v: string) => { const n = Number(String(v).replace(/,/g, '')); return Number.isFinite(n) ? Math.round(n * 100) : NaN; };
export const minorToCedis = (m: number | null | undefined) => (m === null || m === undefined ? '' : (m / 100).toFixed(2));

export function dataSize(mb: number | null | undefined) {
  if (!mb) return '';
  return mb >= 1024 ? `${+(mb / 1024).toFixed(mb % 1024 ? 1 : 0)}GB` : `${mb}MB`;
}

export function dateTime(d: string | Date | null | undefined) {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
export function dateOnly(d: string | Date | null | undefined) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
export function timeAgo(d: string | Date) {
  const s = (Date.now() - new Date(d).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return dateOnly(d);
}

export function normalizePhone(input: string): string | null {
  const d = input.replace(/[^\d+]/g, '');
  let local = '';
  if (/^\+233\d{9}$/.test(d)) local = '0' + d.slice(4);
  else if (/^233\d{9}$/.test(d)) local = '0' + d.slice(3);
  else if (/^0\d{9}$/.test(d)) local = d;
  else if (/^[2-5]\d{8}$/.test(d)) local = '0' + d;
  else return null;
  return /^0[2-5]\d{8}$/.test(local) ? local : null;
}

export type Network = { code: string; name: string; prefixes: string[] };
/** Suggests a network from the number prefix. Numbers can be ported, so the customer always confirms. */
export function guessNetwork(phone: string, networks: Network[]): string | null {
  const n = normalizePhone(phone);
  if (!n) return null;
  const pre = n.slice(0, 3);
  return networks.find((x) => x.prefixes.includes(pre))?.code ?? null;
}

export function randomKey() {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

export const NETWORK_META: Record<string, { name: string; color: string; ink: string; short: string }> = {
  MTN: { name: 'MTN', color: '#FFCB05', ink: '#101114', short: 'MTN' },
  TELECEL: { name: 'Telecel', color: '#E30613', ink: '#FFFFFF', short: 'T' },
  AT: { name: 'AT', color: '#0B8A48', ink: '#FFFFFF', short: 'AT' },
};

export const CATEGORY_LABEL: Record<string, string> = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', non_expiry: 'Non-expiry', other: 'Other', airtime: 'Airtime' };

/** '7 days' -> 'Valid for 7 days'; 'No expiry' stays as is. */
export const validityText = (v: string) => (/^\d/.test(v.trim()) ? `Valid for ${v}` : v);
