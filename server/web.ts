import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import type { Ctx } from './http/core.js';
import { securityHeaders } from './http/security.js';
import { one, q } from './db/pool.js';
import { getStore } from './routes/shop.js';

const here = dirname(fileURLToPath(import.meta.url));
const WEB_DIR = [join(here, '..', 'web'), join(here, '..', 'dist', 'web')].find((d) => existsSync(join(d, 'index.html'))) || join(here, '..', 'web');

const TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2', '.xml': 'application/xml',
};

const PRIVATE_PREFIXES = ['/admin', '/bag', '/order-sent'];
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

let template: string | null = null;
function getTemplate(): string | null {
  if (template && config.isProduction) return template;
  const f = join(WEB_DIR, 'index.html');
  template = existsSync(f) ? readFileSync(f, 'utf8') : null;
  return template;
}

/** Page title, description and share picture for each address, so links look right on WhatsApp and Google. */
async function pageMeta(path: string): Promise<{ title: string; description: string; image: string; index: boolean; status: number }> {
  const s = await getStore().catch(() => null);
  const name = s?.name || 'Pmsomel Enterprise';
  const base = { image: `${config.publicBaseUrl}/icons/og.png`, index: true, status: 200 };
  const general = `${name} sells sneakers, outfits, bags and accessories in Ghana. Order on WhatsApp and get it delivered.`;
  if (path === '/') return { ...base, title: `${name} | Sneakers, outfits and accessories in Ghana`, description: general };
  if (path === '/shop') return { ...base, title: `Shop everything | ${name}`, description: general };
  if (path === '/delivery') return { ...base, title: `Delivery and contact | ${name}`, description: `How ordering and delivery work at ${name}, and how to reach us.` };
  const cat = /^\/shop\/([a-z0-9-]+)$/.exec(path);
  if (cat) {
    const c = await one<{ name: string }>('SELECT name FROM categories WHERE slug = $1 AND is_active', [cat[1]]).catch(() => undefined);
    if (c) return { ...base, title: `${c.name} | ${name}`, description: `Shop ${c.name.toLowerCase()} at ${name}. Order on WhatsApp and get it delivered in Ghana.` };
  }
  const item = /^\/item\/([a-z0-9-]+)$/.exec(path);
  if (item) {
    const p = await one<{ id: number; name: string; price_minor: number; description: string }>(`SELECT id, name, price_minor, description FROM products WHERE slug = $1 AND status IN ('live','sold_out')`, [item[1]]).catch(() => undefined);
    if (p) {
      const img = await one<{ id: number }>('SELECT id FROM product_images WHERE product_id = $1 ORDER BY position, id LIMIT 1', [p.id]).catch(() => undefined);
      return { ...base, title: `${p.name} | ${name}`, description: `GHS ${(p.price_minor / 100).toFixed(2)}. ${(p.description || general).slice(0, 150)}`, image: img ? `${config.publicBaseUrl}/media/${img.id}` : base.image };
    }
  }
  if (PRIVATE_PREFIXES.some((p) => path === p || path.startsWith(p + '/'))) return { ...base, title: name, description: general, index: false };
  return { ...base, title: `Page not found | ${name}`, description: general, index: false, status: 404 };
}

async function renderIndex(ctx: Ctx, path: string) {
  const tpl = getTemplate();
  if (!tpl) { ctx.res.writeHead(503, { 'Content-Type': 'text/plain' }); ctx.res.end('Website build missing. Run npm run build.'); return; }
  const m = await pageMeta(path);
  const canonical = `${config.publicBaseUrl}${path === '/' ? '/' : path}`;
  const head = [
    `<title>${esc(m.title)}</title>`,
    `<meta name="description" content="${esc(m.description)}">`,
    `<meta name="robots" content="${m.index ? 'index,follow' : 'noindex,nofollow'}">`,
    `<link rel="canonical" href="${esc(canonical)}">`,
    `<meta property="og:type" content="website"><meta property="og:site_name" content="Pmsomel Enterprise">`,
    `<meta property="og:title" content="${esc(m.title)}"><meta property="og:description" content="${esc(m.description)}">`,
    `<meta property="og:url" content="${esc(canonical)}"><meta property="og:image" content="${esc(m.image)}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
  ].join('\n    ');
  securityHeaders(ctx.res, { html: true });
  ctx.res.writeHead(m.status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
  ctx.res.end(ctx.method === 'HEAD' ? undefined : tpl.replace('<!--HEAD-->', head));
}

function sendFile(ctx: Ctx, file: string, cache: string) {
  const type = TYPES[extname(file)] || 'application/octet-stream';
  const accept = String(ctx.req.headers['accept-encoding'] || '');
  let path = file;
  let encoding: string | null = null;
  if (/\bbr\b/.test(accept) && existsSync(file + '.br')) { path = file + '.br'; encoding = 'br'; }
  else if (/\bgzip\b/.test(accept) && existsSync(file + '.gz')) { path = file + '.gz'; encoding = 'gzip'; }
  const body = readFileSync(path);
  const headers: Record<string, string> = { 'Content-Type': type, 'Cache-Control': cache, 'Content-Length': String(body.length), Vary: 'Accept-Encoding' };
  if (encoding) headers['Content-Encoding'] = encoding;
  securityHeaders(ctx.res);
  ctx.res.writeHead(200, headers);
  ctx.res.end(ctx.method === 'HEAD' ? undefined : body);
}

export async function serveWeb(ctx: Ctx) {
  if (ctx.method !== 'GET' && ctx.method !== 'HEAD') { ctx.res.writeHead(405); ctx.res.end(); return; }
  const path = ctx.path;
  if (path === '/robots.txt') {
    ctx.res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' });
    ctx.res.end(`User-agent: *\nAllow: /\n${PRIVATE_PREFIXES.map((p) => `Disallow: ${p}`).join('\n')}\nDisallow: /api/\n\nSitemap: ${config.publicBaseUrl}/sitemap.xml\n`);
    return;
  }
  if (path === '/sitemap.xml') {
    const cats = await q<{ slug: string }>('SELECT slug FROM categories WHERE is_active ORDER BY sort_order').catch(() => []);
    const items = await q<{ slug: string }>(`SELECT slug FROM products WHERE status IN ('live','sold_out') ORDER BY id DESC LIMIT 2000`).catch(() => []);
    const urls = ['/', '/shop', '/delivery', ...cats.map((c) => `/shop/${c.slug}`), ...items.map((p) => `/item/${p.slug}`)];
    ctx.res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' });
    ctx.res.end(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map((u) => `<url><loc>${config.publicBaseUrl}${u}</loc></url>`).join('')}</urlset>`);
    return;
  }
  if (extname(path)) {
    const file = normalize(join(WEB_DIR, path));
    if (file.startsWith(WEB_DIR) && existsSync(file) && statSync(file).isFile()) {
      sendFile(ctx, file, path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : path.endsWith('.webmanifest') ? 'no-cache' : 'public, max-age=86400');
      return;
    }
    ctx.res.writeHead(404, { 'Content-Type': 'text/plain' });
    ctx.res.end('Not found');
    return;
  }
  await renderIndex(ctx, path.length > 1 ? path.replace(/\/+$/, '') : path);
}
