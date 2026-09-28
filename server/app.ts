import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { config } from './config.js';
import { Router, createCtx, readBody, sendError } from './http/core.js';
import { csrfGuard, rateLimit, securityHeaders } from './http/security.js';
import { loadSession } from './auth/sessions.js';
import { registerPublicRoutes } from './routes/public.js';
import { registerAccountRoutes } from './routes/account.js';
import { registerAdminRoutes } from './routes/admin.js';
import { registerWebhookRoutes } from './routes/webhooks.js';
import { serveWeb } from './web.js';
import { fakeLedger } from './payments/provider.js';
import { log } from './lib/log.js';

export function buildRouter() {
  const r = new Router();
  registerPublicRoutes(r);
  registerAccountRoutes(r);
  registerAdminRoutes(r);
  registerWebhookRoutes(r);
  return r;
}

export function createApp() {
  const router = buildRouter();
  const apiLimiter = rateLimit('api', 600, 5 * 60_000);

  return createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const ctx = createCtx(req, res);
    const started = Date.now();
    try {
      if (ctx.path.startsWith('/api/')) {
        securityHeaders(res);
        if (ctx.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
        const isWebhook = ctx.path.startsWith('/api/webhooks/');
        await readBody(ctx, isWebhook ? 1024 * 1024 : 100 * 1024);
        if (!isWebhook) {
          apiLimiter(ctx);
          csrfGuard(ctx);
          await loadSession(ctx);
        }
        const m = router.match(ctx.method, ctx.path);
        if (m === null) { ctx.json(404, { error: { message: 'Not found', code: 'not_found' } }); return; }
        if (m === 'method') { ctx.json(405, { error: { message: 'Method not allowed', code: 'method' } }); return; }
        ctx.params = m.params;
        await router.run(ctx, m.route);
        return;
      }
      if (config.fakePayments && ctx.path === '/__fake-pay') return fakePayPage(ctx);
      await serveWeb(ctx);
    } catch (e) {
      if (ctx.path.startsWith('/api/')) sendError(ctx, e);
      else { log.error('web error', { err: e }); if (!res.headersSent) { res.writeHead(500); res.end('Server error'); } }
    } finally {
      const ms = Date.now() - started;
      if (ctx.path.startsWith('/api/') && (ms > 2000 || res.statusCode >= 500)) log.warn('slow or failed request', { path: ctx.path, status: res.statusCode, ms, reqId: ctx.id });
    }
  });
}

/** Local-development stand-in for the Paystack checkout page. Never available in production. */
function fakePayPage(ctx: import('./http/core.js').Ctx) {
  const ref = ctx.query.get('reference') || '';
  const t = fakeLedger.get(ref);
  const outcome = ctx.query.get('outcome');
  if (t && outcome) {
    t.status = outcome === 'success' ? 'success' : 'failed';
    const back = new URL(t.callbackUrl || '/', 'http://x');
    ctx.res.writeHead(302, { Location: back.pathname + back.search + `&reference=${encodeURIComponent(ref)}` });
    ctx.res.end();
    return;
  }
  ctx.res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  ctx.res.end(`<!doctype html><meta name=viewport content="width=device-width"><body style="font-family:sans-serif;padding:24px">
    <h2>TEST payment page (not real money)</h2><p>Reference ${ref.replace(/[<>&"]/g, '')} — amount ${t ? (t.amountMinor / 100).toFixed(2) : '?'} GHS</p>
    <p><a href="?reference=${encodeURIComponent(ref)}&outcome=success">Simulate successful payment</a></p><p><a href="?reference=${encodeURIComponent(ref)}&outcome=failed">Simulate failed payment</a></p></body>`);
}
