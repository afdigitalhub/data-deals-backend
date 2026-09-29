import type { ServerResponse } from 'node:http';
import { config } from '../config.js';
import { HttpError, type Ctx } from './core.js';

export function securityHeaders(res: ServerResponse, opts: { html?: boolean } = {}) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  if (config.secureCookies) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  if (opts.html) {
    res.setHeader('Content-Security-Policy', [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data:",
      "connect-src 'self'",
      "manifest-src 'self'",
      "worker-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ].join('; '));
  }
}

function allowedOrigins(): Set<string> {
  const s = new Set<string>([new URL(config.publicBaseUrl).origin, ...config.extraAllowedOrigins]);
  return s;
}

/**
 * CSRF protection for state-changing API calls: the browser must send JSON (which cross-site forms cannot do
 * without a CORS preflight we never approve) and, when an Origin header is present, it must be our own site.
 * Session cookies are also SameSite=Lax.
 */
export function csrfGuard(ctx: Ctx) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(ctx.method)) return;
  const origin = ctx.req.headers.origin;
  if (origin) {
    const host = ctx.req.headers['x-forwarded-host'] || ctx.req.headers.host;
    const sameHost = host && (origin === `https://${host}` || origin === `http://${host}`);
    if (!sameHost && !allowedOrigins().has(origin)) throw new HttpError(403, 'Request blocked', 'bad_origin');
  }
  const type = String(ctx.req.headers['content-type'] || '');
  if (ctx.rawBody && ctx.rawBody.length && !type.includes('application/json')) throw new HttpError(415, 'Unsupported content type');
  if (ctx.req.headers['x-requested-with'] !== 'datacedi') throw new HttpError(403, 'Request blocked', 'missing_client_header');
}

// ---------- Rate limiting (in-memory, per instance) ----------
const buckets = new Map<string, { count: number; reset: number }>();
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (b.reset < now) buckets.delete(k);
}, 60_000).unref();

export function rateLimit(name: string, max: number, windowMs: number, keyFn?: (ctx: Ctx) => string) {
  return (ctx: Ctx) => {
    if (config.isTest && process.env.RATE_LIMITS !== 'on') return;
    hit(`${name}:${keyFn ? keyFn(ctx) : ctx.ip}`, max, windowMs);
  };
}

export function hit(key: string, max: number, windowMs: number) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || b.reset < now) { b = { count: 0, reset: now + windowMs }; buckets.set(key, b); }
  b.count++;
  if (b.count > max) {
    const secs = Math.ceil((b.reset - now) / 1000);
    throw new HttpError(429, `Too many attempts. Please wait ${secs > 90 ? Math.ceil(secs / 60) + ' minutes' : secs + ' seconds'} and try again.`, 'rate_limited');
  }
}

export function resetRateLimits() { buckets.clear(); }
