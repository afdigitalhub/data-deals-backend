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

const PRIVATE_PREFIXES = ['/admin', '/bag', '/order-sent', '/track', '/my-space'];
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

let template: string | null = null;
function getTemplate(): string | null {
  if (template && config.isProduction) return template;
  const f = join(WEB_DIR, 'index.html');
  template = existsSync(f) ? readFileSync(f, 'utf8') : null;
  return template;
}

/** Page title, description and share picture for each address, so links look right on WhatsApp and Google. */
type Meta = { title: string; description: string; image: string; index: boolean; status: number; ld?: object[] };
const crumbs = (items: Array<[string, string]>) => ({ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: items.map(([name, path], i) => ({ '@type': 'ListItem', position: i + 1, name, item: `${config.publicBaseUrl}${path}` })) });
async function pageMeta(path: string): Promise<Meta> {
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
    if (c) return { ...base, title: `${c.name} | ${name}`, description: `Shop ${c.name.toLowerCase()} at ${name}. Order on WhatsApp and get it delivered in Ghana.`, ld: [crumbs([['Home', '/'], ['Shop', '/shop'], [c.name, path]])] };
  }
  const coll = /^\/(vibe|edit)\/([a-z0-9-]+)$/.exec(path);
  if (coll) {
    const k = await one<{ id: number; name: string; tagline: string; body: string }>('SELECT id, name, tagline, body FROM collections WHERE slug = $1 AND kind = $2 AND is_active', [coll[2], coll[1]]).catch(() => undefined);
    if (k) return { ...base, title: `${k.name} | ${name}`, description: (k.body || `${k.tagline ? k.tagline + '. ' : ''}A collection from ${name}. Order on WhatsApp and get it delivered in Ghana.`).slice(0, 160), ld: [crumbs([['Home', '/'], [k.name, path]])] };
  }
  const item = /^\/item\/([a-z0-9-]+)$/.exec(path);
  if (item) {
    const p = await one<{ id: number; name: string; price_minor: number; description: string; status: string; category_name: string | null; category_slug: string | null }>(`SELECT p.id, p.name, p.price_minor, p.description, p.status, c.name AS category_name, c.slug AS category_slug FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE p.slug = $1 AND p.status IN ('live','sold_out')`, [item[1]]).catch(() => undefined);
    if (p) {
      const imgs = await q<{ id: number }>('SELECT id FROM product_images WHERE product_id = $1 ORDER BY position, id LIMIT 4', [p.id]).catch(() => []);
      const price = Number(p.price_minor);
      const lead = price > 0 ? `GHS ${(price / 100).toFixed(2)}. ` : '';
      const description = `${lead}${(p.description || `${p.name}${p.category_name ? `, from our ${p.category_name.toLowerCase()}` : ''}. Order on WhatsApp from ${name} and get it delivered in Ghana.`).slice(0, 150)}`;
      const product: Record<string, unknown> = { '@context': 'https://schema.org', '@type': 'Product', name: p.name, description, image: imgs.map((i) => `${config.publicBaseUrl}/media/${i.id}`), ...(p.category_name ? { category: p.category_name } : {}) };
      // A price is only published to search engines when the shop has actually set one.
      if (price > 0) product.offers = { '@type': 'Offer', priceCurrency: 'GHS', price: (price / 100).toFixed(2), availability: p.status === 'sold_out' ? 'https://schema.org/OutOfStock' : 'https://schema.org/InStock', url: `${config.publicBaseUrl}${path}` };
      const trail: Array<[string, string]> = [['Home', '/'], ...(p.category_slug ? [[p.category_name!, `/shop/${p.category_slug}`] as [string, string]] : []), [p.name, path]];
      return { ...base, title: `${p.name} | ${name}`, description, image: imgs[0] ? `${config.publicBaseUrl}/media/${imgs[0].id}` : base.image, ld: [product, crumbs(trail)] };
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
    ...(m.ld || []).map((o) => `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, '\\u003c')}</script>`),
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
    const colls = await q<{ slug: string; kind: string }>('SELECT slug, kind FROM collections WHERE is_active ORDER BY sort_order').catch(() => []);
    const urls = ['/', '/shop', '/delivery', ...cats.map((c) => `/shop/${c.slug}`), ...colls.map((k) => `/${k.kind}/${k.slug}`), ...items.map((p) => `/item/${p.slug}`)];
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
