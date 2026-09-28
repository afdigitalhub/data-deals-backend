import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { ZodError } from 'zod';
import { log } from '../lib/log.js';
import type { SessionUser } from '../auth/sessions.js';

export class HttpError extends Error {
  constructor(public status: number, message: string, public code?: string, public details?: unknown) {
    super(message);
  }
}
export const badRequest = (m: string, details?: unknown) => new HttpError(400, m, 'bad_request', details);
export const notFound = (m = 'Not found') => new HttpError(404, m, 'not_found');
export const forbidden = (m = 'You do not have permission to do that') => new HttpError(403, m, 'forbidden');
export const conflict = (m: string, code = 'conflict') => new HttpError(409, m, code);

export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  id: string;
  method: string;
  path: string;
  query: URLSearchParams;
  params: Record<string, string>;
  ip: string;
  cookies: Record<string, string>;
  body: any;
  rawBody: Buffer | null;
  user: SessionUser | null;
  sessionId: number | null;
  sent: boolean;
  json(status: number, data: unknown, headers?: Record<string, string>): void;
  setCookie(name: string, value: string, opts: CookieOpts): void;
}

export interface CookieOpts { maxAge?: number; httpOnly?: boolean; secure?: boolean; sameSite?: 'Lax' | 'Strict' | 'None'; path?: string }

export type Handler = (ctx: Ctx) => unknown | Promise<unknown>;

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (!k) continue;
    try { out[k] = decodeURIComponent(v); } catch { out[k] = v; }
  }
  return out;
}

export function clientIp(req: IncomingMessage): string {
  const h = req.headers;
  const pick = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.split(',')[0]?.trim();
  return pick(h['true-client-ip']) || pick(h['cf-connecting-ip']) || pick(h['x-forwarded-for']) || req.socket.remoteAddress || 'unknown';
}

export function createCtx(req: IncomingMessage, res: ServerResponse): Ctx {
  const url = new URL(req.url || '/', 'http://local');
  const ctx: Ctx = {
    req, res,
    id: randomUUID(),
    method: (req.method || 'GET').toUpperCase(),
    path: decodeURIComponent(url.pathname).replace(/\/{2,}/g, '/'),
    query: url.searchParams,
    params: {},
    ip: clientIp(req),
    cookies: parseCookies(req.headers.cookie),
    body: undefined,
    rawBody: null,
    user: null,
    sessionId: null,
    sent: false,
    json(status, data, headers = {}) {
      if (ctx.sent) return;
      ctx.sent = true;
      const body = JSON.stringify(data);
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
      res.end(body);
    },
    setCookie(name, value, o) {
      const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${o.path || '/'}`];
      if (o.maxAge !== undefined) parts.push(`Max-Age=${Math.floor(o.maxAge)}`);
      if (o.httpOnly !== false) parts.push('HttpOnly');
      if (o.secure) parts.push('Secure');
      parts.push(`SameSite=${o.sameSite || 'Lax'}`);
      const prev = res.getHeader('Set-Cookie');
      const list = Array.isArray(prev) ? prev : prev ? [String(prev)] : [];
      res.setHeader('Set-Cookie', [...list, parts.join('; ')]);
    },
  };
  return ctx;
}

export async function readBody(ctx: Ctx, limit = 100 * 1024): Promise<void> {
  if (ctx.method === 'GET' || ctx.method === 'HEAD') return;
  const chunks: Buffer[] = [];
  let size = 0;
  await new Promise<void>((resolve, reject) => {
    ctx.req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, 'Request is too large')); ctx.req.destroy(); return; }
      chunks.push(c);
    });
    ctx.req.on('end', () => resolve());
    ctx.req.on('error', reject);
  });
  ctx.rawBody = Buffer.concat(chunks);
  if (!ctx.rawBody.length) { ctx.body = {}; return; }
  const type = String(ctx.req.headers['content-type'] || '');
  if (type.includes('application/json')) {
    try { ctx.body = JSON.parse(ctx.rawBody.toString('utf8')); } catch { throw badRequest('Invalid JSON'); }
  } else {
    ctx.body = {};
  }
}

// ---------- Router ----------
interface Route { method: string; regex: RegExp; keys: string[]; handlers: Handler[] }

export class Router {
  private routes: Route[] = [];
  add(method: string, pattern: string, ...handlers: Handler[]) {
    const keys: string[] = [];
    const regex = new RegExp('^' + pattern.replace(/\/:([a-zA-Z_]+)/g, (_m, k) => { keys.push(k); return '/([^/]+)'; }) + '/?$');
    this.routes.push({ method, regex, keys, handlers });
    return this;
  }
  get(p: string, ...h: Handler[]) { return this.add('GET', p, ...h); }
  post(p: string, ...h: Handler[]) { return this.add('POST', p, ...h); }
  put(p: string, ...h: Handler[]) { return this.add('PUT', p, ...h); }
  patch(p: string, ...h: Handler[]) { return this.add('PATCH', p, ...h); }
  delete(p: string, ...h: Handler[]) { return this.add('DELETE', p, ...h); }

  match(method: string, path: string): { route: Route; params: Record<string, string> } | 'method' | null {
    let pathMatched = false;
    for (const r of this.routes) {
      const m = r.regex.exec(path);
      if (!m) continue;
      pathMatched = true;
      if (r.method !== method && !(method === 'HEAD' && r.method === 'GET')) continue;
      const params: Record<string, string> = {};
      r.keys.forEach((k, i) => { params[k] = m[i + 1]; });
      return { route: r, params };
    }
    return pathMatched ? 'method' : null;
  }

  async run(ctx: Ctx, route: Route) {
    for (const h of route.handlers) {
      const out = await h(ctx);
      if (ctx.sent) return;
      if (out !== undefined) { ctx.json(200, out); return; }
    }
    if (!ctx.sent) ctx.json(204, null);
  }
}

export function sendError(ctx: Ctx, e: unknown) {
  if (e instanceof HttpError) {
    ctx.json(e.status, { error: { message: e.message, code: e.code, details: e.details } });
    return;
  }
  if (e instanceof ZodError) {
    const fields: Record<string, string> = {};
    for (const issue of e.issues) {
      const key = issue.path.join('.') || '_';
      if (!fields[key]) fields[key] = issue.message;
    }
    const first = Object.entries(fields)[0];
    ctx.json(400, { error: { message: first ? `${first[0] === '_' ? '' : humanField(first[0]) + ': '}${first[1]}` : 'Invalid input', code: 'validation', details: fields } });
    return;
  }
  log.error('unhandled error', { reqId: ctx.id, path: ctx.path, err: e });
  ctx.json(500, { error: { message: 'Something went wrong on our side. Please try again.', code: 'server_error', requestId: ctx.id } });
}

function humanField(k: string) {
  return k.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}
