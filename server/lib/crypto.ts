import { createHash, createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import { config } from '../config.js';

const scrypt = (pw: string, salt: Buffer, len: number, opts: ScryptOptions) =>
  new Promise<Buffer>((resolve, reject) => scryptCb(pw, salt, len, opts, (e, k) => (e ? reject(e) : resolve(k))));

// scrypt parameters (N=2^16, r=8, p=1 ≈ 64 MiB) follow OWASP guidance. Hashing is limited to 2 at a time
// so a burst of logins cannot exhaust memory on a small server.
const N = config.isTest ? 1024 : 65536;
const R = 8;
const P = 1;
let active = 0;
const waiters: (() => void)[] = [];
async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= 2) await new Promise<void>((r) => waiters.push(r));
  active++;
  try { return await fn(); } finally { active--; waiters.shift()?.(); }
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await withSlot(() => scrypt(password.normalize('NFKC'), salt, 32, { N, r: R, p: P, maxmem: 160 * 1024 * 1024 }));
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltB64, keyB64] = parts;
  const expected = Buffer.from(keyB64, 'base64');
  const key = await withSlot(() => scrypt(password.normalize('NFKC'), Buffer.from(saltB64, 'base64'), expected.length, { N: Number(n), r: Number(r), p: Number(p), maxmem: 160 * 1024 * 1024 }));
  return key.length === expected.length && timingSafeEqual(key, expected);
}

// A real hash of a random password, used so "unknown email" logins take as long as real ones.
let dummyHash: Promise<string> | null = null;
export function getDummyHash() { return (dummyHash ??= hashPassword(randomBytes(12).toString('hex'))); }

export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');
export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Deterministic access token for guest links (order receipts, support tickets). */
export function accessToken(kind: 'order' | 'ticket', reference: string): string {
  return createHmac('sha256', config.appSecret).update(`${kind}:${reference}`).digest('base64url').slice(0, 32);
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function humanCode(len: number): string {
  const bytes = randomBytes(len);
  let s = '';
  for (let i = 0; i < len; i++) s += ALPHABET[bytes[i] % ALPHABET.length];
  return s;
}
