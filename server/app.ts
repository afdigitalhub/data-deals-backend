import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { Router, createCtx, readBody, sendError } from './http/core.js';
import { csrfGuard, rateLimit, securityHeaders } from './http/security.js';
import { loadSession } from './auth/sessions.js';
import { registerShopRoutes, serveImage } from './routes/shop.js';
import { registerAdminRoutes } from './routes/admin.js';
import { serveWeb } from './web.js';
import { log } from './lib/log.js';

export function buildRouter() {
  const r = new Router();
  registerShopRoutes(r);
  registerAdminRoutes(r);
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
        // Photo uploads arrive as base64 JSON, so they get a larger limit than ordinary requests.
        const isUpload = /^\/api\/admin\/products\/\d+\/images$/.test(ctx.path);
        await readBody(ctx, isUpload ? 4 * 1024 * 1024 : 100 * 1024);
        apiLimiter(ctx);
        csrfGuard(ctx);
        await loadSession(ctx);
        const m = router.match(ctx.method, ctx.path);
        if (m === null) { ctx.json(404, { error: { message: 'Not found', code: 'not_found' } }); return; }
        if (m === 'method') { ctx.json(405, { error: { message: 'Method not allowed', code: 'method' } }); return; }
        ctx.params = m.params;
        await router.run(ctx, m.route);
        return;
      }
      if (ctx.path.startsWith('/media/')) { await serveImage(ctx); return; }
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
