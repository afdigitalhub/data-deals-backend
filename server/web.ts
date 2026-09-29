import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import type { Ctx } from './http/core.js';
import { securityHeaders } from './http/security.js';
import { foundersOf, getSetting } from './services/settings.js';

const here = dirname(fileURLToPath(import.meta.url));
const WEB_DIR = [join(here, '..', 'web'), join(here, '..', 'dist', 'web')].find((d) => existsSync(join(d, 'index.html'))) || join(here, '..', 'web');

const TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2', '.xml': 'application/xml',
};

interface PageMeta { title: string; description: string; index: boolean }
const DEFAULT_DESC = 'Buy MTN, Telecel and AT airtime and data bundles in Ghana. Pay with Mobile Money or card and track every order.';
const PAGES: Record<string, PageMeta> = {
  '/': { title: 'DataCedi — Airtime & Data Bundles for MTN, Telecel and AT', description: DEFAULT_DESC, index: true },
  '/airtime': { title: 'Buy Airtime Online — MTN, Telecel, AT | DataCedi', description: 'Top up airtime for any MTN, Telecel or AT number in Ghana. Pay with Mobile Money or card.', index: true },
  '/data-bundles': { title: 'Data Bundles — MTN, Telecel, AT | DataCedi', description: 'Browse daily, weekly and monthly data bundles for MTN, Telecel and AT. Clear prices, no surprises.', index: true },
  '/rates': { title: 'Rates & Prices | DataCedi', description: 'Current DataCedi prices for data bundles and airtime on MTN, Telecel and AT.', index: true },
  '/how-it-works': { title: 'How It Works | DataCedi', description: 'Choose a network, enter the number, pick a bundle and pay. Here is exactly what happens after you pay.', index: true },
  '/notifications': { title: 'Notification settings | DataCedi', description: 'Manage DataCedi notifications on this device.', index: false },
  '/track': { title: 'Track Your Order | DataCedi', description: 'Enter your order number and phone number to see if your airtime or data bundle has been delivered.', index: true },
  '/support': { title: 'Support & FAQs | DataCedi', description: 'Answers to common questions and a direct way to reach the DataCedi team about any order.', index: true },
  '/about': { title: 'About DataCedi', description: 'DataCedi is a Ghanaian platform for buying airtime and data bundles online.', index: true },
  '/contact': { title: 'Contact DataCedi', description: 'Get in touch with the DataCedi support team.', index: true },
  '/terms': { title: 'Terms of Service | DataCedi', description: 'The terms that apply when you use DataCedi.', index: true },
  '/privacy': { title: 'Privacy Policy | DataCedi', description: 'How DataCedi collects, uses and protects your information.', index: true },
  '/refund-policy': { title: 'Refund Policy | DataCedi', description: 'When and how DataCedi refunds orders that could not be delivered.', index: true },
  '/login': { title: 'Log in | DataCedi', description: DEFAULT_DESC, index: false },
  '/register': { title: 'Create an account | DataCedi', description: DEFAULT_DESC, index: false },
};
const PRIVATE_PREFIXES = ['/account', '/admin', '/checkout', '/order', '/ticket', '/reset-password', '/forgot-password'];

let template: string | null = null;
function getTemplate(): string | null {
  if (template && config.isProduction) return template;
  const f = join(WEB_DIR, 'index.html');
  template = existsSync(f) ? readFileSync(f, 'utf8') : null;
  return template;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

async function renderIndex(ctx: Ctx, path: string) {
  const tpl = getTemplate();
  if (!tpl) { ctx.res.writeHead(503, { 'Content-Type': 'text/plain' }); ctx.res.end('Website build missing. Run npm run build.'); return; }
  const meta = PAGES[path];
  const isPrivate = PRIVATE_PREFIXES.some((p) => path === p || path.startsWith(p + '/'));
  const known = !!meta || isPrivate;
  const title = meta?.title ?? (isPrivate ? 'DataCedi' : 'Page not found | DataCedi');
  const desc = meta?.description ?? DEFAULT_DESC;
  const canonical = `${config.publicBaseUrl}${path === '/' ? '/' : path}`;
  const robots = meta?.index ? 'index,follow' : 'noindex,nofollow';
  const business = await getSetting('business').catch(() => null);
  const org: Record<string, unknown> = { '@context': 'https://schema.org', '@type': 'Organization', name: business?.name || 'DataCedi', url: config.publicBaseUrl, logo: `${config.publicBaseUrl}/icons/icon-512.png` };
  if (business?.show_founders) org.founder = foundersOf(business).map((f) => ({ '@type': 'Person', name: f.name, jobTitle: f.title }));
  if (business?.support_email || business?.support_phone) org.contactPoint = { '@type': 'ContactPoint', contactType: 'customer support', areaServed: 'GH', ...(business.support_email ? { email: business.support_email } : {}), ...(business.support_phone ? { telephone: business.support_phone } : {}) };
  const head = [
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(desc)}">`,
    `<meta name="robots" content="${robots}">`,
    `<link rel="canonical" href="${esc(canonical)}">`,
    `<meta property="og:type" content="website"><meta property="og:site_name" content="DataCedi">`,
    `<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}">`,
    `<meta property="og:url" content="${esc(canonical)}"><meta property="og:image" content="${config.publicBaseUrl}/icons/og.png">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    path === '/' || path === '/about' ? `<script type="application/ld+json">${JSON.stringify(org).replace(/</g, '\\u003c')}</script>` : '',
  ].join('\n    ');
  const html = tpl.replace('<!--HEAD-->', head);
  securityHeaders(ctx.res, { html: true });
  ctx.res.writeHead(known ? 200 : 404, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
  ctx.res.end(ctx.method === 'HEAD' ? undefined : html);
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
    const body = `User-agent: *\nAllow: /\n${PRIVATE_PREFIXES.map((p) => `Disallow: ${p}`).join('\n')}\nDisallow: /api/\n\nSitemap: ${config.publicBaseUrl}/sitemap.xml\n`;
    ctx.res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' });
    ctx.res.end(body);
    return;
  }
  if (path === '/sitemap.xml') {
    const urls = Object.entries(PAGES).filter(([, m]) => m.index).map(([p]) => `<url><loc>${config.publicBaseUrl}${p}</loc></url>`).join('');
    ctx.res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' });
    ctx.res.end(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`);
    return;
  }

  // Static files (never allow path traversal outside the web directory).
  if (extname(path)) {
    const file = normalize(join(WEB_DIR, path));
    if (file.startsWith(WEB_DIR) && existsSync(file) && statSync(file).isFile()) {
      const immutable = path.startsWith('/assets/');
      const noCache = path === '/sw.js' || path.endsWith('.webmanifest');
      sendFile(ctx, file, immutable ? 'public, max-age=31536000, immutable' : noCache ? 'no-cache' : 'public, max-age=86400');
      return;
    }
    ctx.res.writeHead(404, { 'Content-Type': 'text/plain' });
    ctx.res.end('Not found');
    return;
  }
  await renderIndex(ctx, path.length > 1 ? path.replace(/\/+$/, '') : path);
}
