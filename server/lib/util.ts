import { z } from 'zod';

// ---------- Money (always integer pesewas) ----------
export const formatGhs = (minor: number) => `GHS ${(minor / 100).toFixed(2)}`;
/** Basis-points fee on an amount, rounded half-up to the nearest pesewa. */
export const bpsOf = (minor: number, bps: number) => Math.floor((minor * bps + 5000) / 10000);

// ---------- Ghana phone numbers ----------
/** Normalises Ghana mobile numbers to local 10-digit form (0XXXXXXXXX). Returns null if not a valid mobile number. */
export function normalizeGhPhone(input: string): string | null {
  const digits = String(input || '').replace(/[^\d+]/g, '');
  let local: string;
  if (/^\+233\d{9}$/.test(digits)) local = '0' + digits.slice(4);
  else if (/^233\d{9}$/.test(digits)) local = '0' + digits.slice(3);
  else if (/^0\d{9}$/.test(digits)) local = digits;
  else if (/^[2-5]\d{8}$/.test(digits)) local = '0' + digits;
  else return null;
  return /^0[2-5]\d{8}$/.test(local) ? local : null;
}

export const maskPhone = (p: string | null | undefined) => (p && p.length >= 10 ? `${p.slice(0, 3)}****${p.slice(-3)}` : p || '');
export const maskEmail = (e: string | null | undefined) => {
  if (!e) return '';
  const [u, d] = e.split('@');
  return `${u.slice(0, 2)}***@${d || ''}`;
};

// ---------- Validation building blocks ----------
export const zPhone = z.string().trim().transform((v, c) => {
  const n = normalizeGhPhone(v);
  if (!n) { c.addIssue({ code: 'custom', message: 'Enter a valid Ghana mobile number, e.g. 0241234567' }); return z.NEVER; }
  return n;
});
export const zEmail = z.string().trim().toLowerCase().max(254).email('Enter a valid email address');
export const zPassword = z.string().min(8, 'Use at least 8 characters').max(200)
  .refine((v) => /[a-zA-Z]/.test(v) && /\d/.test(v), 'Use letters and at least one number');
export const zName = z.string().trim().min(2, 'Enter your name').max(100);
export const zText = (max: number, min = 1) => z.string().trim().min(min, 'This field is required').max(max);
export const zId = z.coerce.number().int().positive();
export const zNetwork = z.enum(['MTN', 'TELECEL', 'AT']);

export function page(query: URLSearchParams, defaultSize = 25) {
  const size = Math.min(100, Math.max(1, Number(query.get('pageSize')) || defaultSize));
  const p = Math.max(1, Number(query.get('page')) || 1);
  return { limit: size, offset: (p - 1) * size, page: p, pageSize: size };
}

export function dateRange(query: URLSearchParams, defaultDays = 30): { from: Date; to: Date } {
  const to = query.get('to') ? new Date(query.get('to') + 'T23:59:59.999Z') : new Date();
  const from = query.get('from') ? new Date(query.get('from') + 'T00:00:00Z') : new Date(to.getTime() - defaultDays * 86400_000);
  if (isNaN(+from) || isNaN(+to)) return { from: new Date(Date.now() - defaultDays * 86400_000), to: new Date() };
  return { from, to };
}
