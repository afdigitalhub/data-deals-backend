import { createCipheriv, createECDH, createHmac, createPrivateKey, randomBytes, sign } from 'node:crypto';

/**
 * Minimal Web Push sender (RFC 8030 + RFC 8291 aes128gcm payload encryption + RFC 8292 VAPID), using only node:crypto.
 * Keys are base64url: VAPID public = 65-byte uncompressed P-256 point, VAPID private = 32-byte scalar.
 */
export const b64u = (b: Buffer) => b.toString('base64url');
export const fromB64u = (s: string) => Buffer.from(s, 'base64url');

export function generateVapidKeys() {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return { publicKey: b64u(ecdh.getPublicKey()), privateKey: b64u(ecdh.getPrivateKey()) };
}

function hmac(key: Buffer, data: Buffer) { return createHmac('sha256', key).update(data).digest(); }

/** Encrypts a payload for one subscription (single record, aes128gcm). */
export function encryptPayload(payload: Buffer, p256dhB64: string, authB64: string, opts: { salt?: Buffer; asKeys?: ReturnType<typeof createECDH> } = {}) {
  const uaPublic = fromB64u(p256dhB64);
  const authSecret = fromB64u(authB64);
  if (uaPublic.length !== 65 || authSecret.length < 16) throw new Error('invalid subscription keys');
  const as = opts.asKeys ?? createECDH('prime256v1');
  if (!opts.asKeys) as.generateKeys();
  const asPublic = as.getPublicKey();
  const ecdhSecret = as.computeSecret(uaPublic);
  const prkKey = hmac(authSecret, ecdhSecret);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic, Buffer.from([1])]);
  const ikm = hmac(prkKey, keyInfo).subarray(0, 32);
  const salt = opts.salt ?? randomBytes(16);
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01')).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01')).subarray(0, 12);
  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([cipher.update(Buffer.concat([payload, Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(4096, 16);
  header.writeUInt8(asPublic.length, 20);
  return Buffer.concat([header, asPublic, body]);
}

/** VAPID Authorization header value for a push endpoint. */
export function vapidAuthorization(endpoint: string, publicKeyB64: string, privateKeyB64: string, subject: string) {
  const pub = fromB64u(publicKeyB64);
  const key = createPrivateKey({ key: { kty: 'EC', crv: 'P-256', d: privateKeyB64, x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) }, format: 'jwk' });
  const enc = (o: object) => b64u(Buffer.from(JSON.stringify(o)));
  const unsigned = `${enc({ typ: 'JWT', alg: 'ES256' })}.${enc({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject })}`;
  const sig = sign('sha256', Buffer.from(unsigned), { key, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${unsigned}.${b64u(sig)}, k=${publicKeyB64}`;
}

export interface PushTarget { endpoint: string; p256dh: string; auth: string }
export type PushResult = { ok: true; status: number } | { ok: false; status: number; gone: boolean; message: string };

export async function sendWebPush(target: PushTarget, data: unknown, vapid: { publicKey: string; privateKey: string; subject: string }, opts: { ttl?: number; urgency?: 'low' | 'normal' | 'high'; topic?: string } = {}): Promise<PushResult> {
  const body = encryptPayload(Buffer.from(JSON.stringify(data)), target.p256dh, target.auth);
  const headers: Record<string, string> = {
    Authorization: vapidAuthorization(target.endpoint, vapid.publicKey, vapid.privateKey, vapid.subject),
    'Content-Encoding': 'aes128gcm',
    'Content-Type': 'application/octet-stream',
    TTL: String(opts.ttl ?? 12 * 3600),
    Urgency: opts.urgency ?? 'normal',
  };
  if (opts.topic) headers.Topic = opts.topic.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32);
  const res = await fetch(target.endpoint, { method: 'POST', headers, body, signal: AbortSignal.timeout(15_000) });
  if (res.status >= 200 && res.status < 300) return { ok: true, status: res.status };
  const text = await res.text().catch(() => '');
  return { ok: false, status: res.status, gone: res.status === 404 || res.status === 410, message: text.slice(0, 200) };
}

/** Push services browsers actually use. Subscriptions pointing anywhere else are refused (prevents SSRF). */
export function isAllowedPushEndpoint(endpoint: string, allowAny = false) {
  let u: URL;
  try { u = new URL(endpoint); } catch { return false; }
  if (allowAny) return u.protocol === 'https:' || u.protocol === 'http:';
  if (u.protocol !== 'https:') return false;
  const h = u.hostname.toLowerCase();
  return h === 'fcm.googleapis.com' || h === 'android.googleapis.com' || h.endsWith('.push.services.mozilla.com') || h === 'updates.push.services.mozilla.com'
    || h === 'web.push.apple.com' || h.endsWith('.push.apple.com') || h.endsWith('.notify.windows.com');
}
