import { z } from 'zod';
import { one, q, tx, isUniqueViolation } from '../db/pool.js';
import { getDummyHash, hashPassword, humanCode, sha256, verifyPassword } from '../lib/crypto.js';
import { formatGhs, zEmail, zName, zPassword, zPhone } from '../lib/util.js';
import { HttpError, conflict, notFound, type Ctx, type Router } from '../http/core.js';
import { rateLimit } from '../http/security.js';
import { getPolicies, POLICY_ORDER } from '../policies.js';
import { createSession, destroySession, revokeAllSessions, type SessionUser } from '../auth/sessions.js';

export interface StoreSettings { name: string; tagline: string; whatsapp: string; phones: string[]; location: string; delivery_note: string; about: string; free_delivery_minor: number; gift_enabled: boolean; owner_name?: string; owner_title?: string }

let storeCache: { at: number; data: StoreSettings } | null = null;
export async function getStore(): Promise<StoreSettings> {
  if (storeCache && Date.now() - storeCache.at < 15_000) return storeCache.data;
  const row = await one<{ value: StoreSettings }>(`SELECT value FROM settings WHERE key = 'store'`);
  storeCache = { at: Date.now(), data: Object.assign({ free_delivery_minor: 0, gift_enabled: false }, row!.value) };
  return storeCache.data;
}
export const clearStoreCache = () => { storeCache = null; };

/** 0546867225 -> 233546867225 (the form wa.me links need). */
export const waNumber = (local: string) => '233' + local.replace(/\D/g, '').replace(/^233/, '').replace(/^0/, '');

export const PRODUCT_LIST = `SELECT p.id, p.slug, p.name, p.price_minor, p.compare_at_minor, p.status, p.is_featured, p.sizes, p.colours, p.badges,
    (p.created_at > now() - interval '14 days') AS is_new,
    c.slug AS category_slug, c.name AS category_name,
    (SELECT i.id FROM product_images i WHERE i.product_id = p.id ORDER BY i.position, i.id LIMIT 1) AS image_id,
    (SELECT i.id FROM product_images i WHERE i.product_id = p.id ORDER BY i.position, i.id OFFSET 1 LIMIT 1) AS image2_id
  FROM products p LEFT JOIN categories c ON c.id = p.category_id`;

/** The shape of an item in lists. "thumb" is the small copy for cards; "image" is the full photo. */
export const card = (p: any) => ({
  id: Number(p.id), slug: p.slug, name: p.name, priceMinor: Number(p.price_minor), compareAtMinor: p.compare_at_minor == null ? null : Number(p.compare_at_minor), soldOut: p.status === 'sold_out',
  featured: p.is_featured, sizes: p.sizes, colours: p.colours, badges: p.badges || [], isNew: !!p.is_new,
  category: p.category_slug ? { slug: p.category_slug, name: p.category_name } : null,
  image: p.image_id ? `/media/${p.image_id}` : null, image2: p.image2_id ? `/media/${p.image2_id}` : null,
  thumb: p.image_id ? `/media/${p.image_id}/t` : null, thumb2: p.image2_id ? `/media/${p.image2_id}/t` : null,
});

const COLLECTION_LIST = `SELECT k.id, k.kind, k.name, k.slug, k.tagline, k.body,
    (SELECT count(*)::int FROM collection_products cp JOIN products p ON p.id = cp.product_id WHERE cp.collection_id = k.id AND p.status IN ('live','sold_out')) AS count,
    (SELECT i.id FROM collection_products cp JOIN products p ON p.id = cp.product_id JOIN product_images i ON i.product_id = p.id
       WHERE cp.collection_id = k.id AND p.status IN ('live','sold_out') ORDER BY cp.position, p.id, i.position, i.id LIMIT 1) AS image_id
  FROM collections k WHERE k.is_active`;
const collectionCard = (k: any) => ({ kind: k.kind, name: k.name, slug: k.slug, tagline: k.tagline, body: k.body, count: k.count, image: k.image_id ? `/media/${k.image_id}` : null, thumb: k.image_id ? `/media/${k.image_id}/t` : null });
const collectionProducts = (id: number, limit = 60) => q(`${PRODUCT_LIST} JOIN collection_products cp ON cp.product_id = p.id
  WHERE cp.collection_id = $1 AND p.status IN ('live','sold_out') ORDER BY (p.status = 'sold_out'), cp.position, p.id LIMIT $2`, [id, limit]);

const TRACK_STEPS = ['new', 'confirmed', 'preparing', 'out_for_delivery', 'delivered'];

const publicUser = (u: SessionUser) => ({ id: u.id, email: u.email, fullName: u.full_name, role: u.role });

/** Product photos, served straight from the database with a long cache (an image id never changes its bytes). */
export async function serveImage(ctx: Ctx) {
  const m = /^\/media\/(\d{1,12})(\/t)?$/.exec(ctx.path);
  if (!m || (ctx.method !== 'GET' && ctx.method !== 'HEAD')) { ctx.res.writeHead(404); ctx.res.end(); return; }
  // Read as base64 text so the bytes come back identical whatever the database driver does with binary columns.
  // "/t" asks for the small copy used on cards; items without one yet fall back to the full photo.
  const row = m[2]
    ? await one<{ mime: string; b64: string }>(`SELECT mime, encode(COALESCE(thumb, bytes), 'base64') AS b64 FROM product_images WHERE id = $1`, [Number(m[1])])
    : await one<{ mime: string; b64: string }>(`SELECT mime, encode(bytes, 'base64') AS b64 FROM product_images WHERE id = $1`, [Number(m[1])]);
  if (!row) { ctx.res.writeHead(404, { 'Content-Type': 'text/plain' }); ctx.res.end('Not found'); return; }
  const bytes = Buffer.from(row.b64, 'base64');
  const isWebp = bytes.subarray(0, 4).toString('ascii') === 'RIFF';
  const isPng = bytes[0] === 0x89 && bytes[1] === 0x50;
  const type = isWebp ? 'image/webp' : isPng ? 'image/png' : bytes[0] === 0xff ? 'image/jpeg' : row.mime;
  // The small copy can appear later for the same address, so it is cached for a day rather than forever.
  ctx.res.writeHead(200, { 'Content-Type': type, 'Content-Length': String(bytes.length), 'Cache-Control': m[2] ? 'public, max-age=86400' : 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' });
  ctx.res.end(ctx.method === 'HEAD' ? undefined : bytes);
}

export function registerShopRoutes(r: Router) {
  r.get('/api/health', async () => { await one('SELECT 1'); return { ok: true }; });

  r.get('/api/config', async (ctx) => {
    const s = await getStore();
    const categories = await q(`SELECT c.name, c.slug, (SELECT count(*)::int FROM products p WHERE p.category_id = c.id AND p.status IN ('live','sold_out')) AS count,
      (SELECT i.id FROM product_images i JOIN products p ON p.id = i.product_id WHERE p.category_id = c.id AND p.status IN ('live','sold_out') ORDER BY p.is_featured DESC, p.created_at DESC, i.position, i.id LIMIT 1) AS image_id
      FROM categories c WHERE c.is_active ORDER BY c.sort_order, c.id`);
    const total = await one<{ n: number }>(`SELECT count(*)::int AS n FROM products WHERE status IN ('live','sold_out')`);
    const collections = await q(`${COLLECTION_LIST} ORDER BY k.sort_order, k.id`);
    const pol = await getPolicies();
    ctx.json(200, {
      store: { name: s.name, tagline: s.tagline, whatsapp: s.whatsapp, whatsappIntl: waNumber(s.whatsapp), phones: s.phones, location: s.location, deliveryNote: s.delivery_note, about: s.about,
        freeDeliveryMinor: Number(s.free_delivery_minor) || 0, giftEnabled: !!s.gift_enabled, ownerName: s.owner_name || '', ownerTitle: s.owner_title || '' },
      categories: categories.map((c: any) => ({ name: c.name, slug: c.slug, count: c.count, image: c.image_id ? `/media/${c.image_id}/t` : null })), productCount: total!.n,
      collections: collections.filter((k: any) => k.count > 0).map(collectionCard),
      policies: POLICY_ORDER.filter((k) => pol[k]?.body?.trim()).map((k) => ({ slug: k, title: pol[k].title })),
    }, { 'Cache-Control': 'public, max-age=20' });
  });

  r.get('/api/products', async (ctx) => {
    const cat = ctx.query.get('category');
    const search = (ctx.query.get('q') || '').trim().slice(0, 60);
    const featured = ctx.query.get('featured') === '1';
    const limit = Math.min(60, Math.max(1, Number(ctx.query.get('limit')) || 60));
    // "ids" fetches a saved list (wishlist, recently viewed) and keeps the order the visitor saved them in.
    const idsRaw = ctx.query.get('ids');
    if (idsRaw !== null) {
      const ids = idsRaw.split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 40);
      if (!ids.length) return { products: [] };
      const rows = await q(`${PRODUCT_LIST} WHERE p.status IN ('live','sold_out') AND p.id = ANY($1::bigint[])`, [ids]);
      const by = new Map(rows.map((p: any) => [Number(p.id), p]));
      return { products: ids.map((id) => by.get(id)).filter(Boolean).map(card) };
    }
    const newest = ctx.query.get('sort') === 'new';
    const rows = await q(`${PRODUCT_LIST}
      WHERE p.status IN ('live','sold_out') AND ($1::text IS NULL OR c.slug = $1) AND ($2 = '' OR p.name ILIKE '%' || $2 || '%') AND (NOT $3 OR p.is_featured)
      ORDER BY (p.status = 'sold_out'), ${newest ? '' : 'p.is_featured DESC, '}p.created_at DESC, p.id DESC LIMIT $4`, [cat || null, search, featured, limit]);
    return { products: rows.map(card) };
  });

  r.get('/api/policies/:slug', async (ctx) => {
    const pol = (await getPolicies())[ctx.params.slug];
    if (!pol || !pol.body.trim()) throw notFound('This page is not available.');
    ctx.json(200, { policy: { slug: ctx.params.slug, title: pol.title, body: pol.body } }, { 'Cache-Control': 'public, max-age=20' });
  });

  // Everything the home page needs in one request.
  r.get('/api/home', async (ctx) => {
    const drops = await q(`${PRODUCT_LIST} WHERE p.status = 'live' ORDER BY p.created_at DESC, p.id DESC LIMIT 10`);
    const edit = await one(`${COLLECTION_LIST} AND k.kind = 'edit' ORDER BY k.sort_order, k.id LIMIT 1`);
    const editProducts = edit && edit.count > 0 ? await collectionProducts(edit.id, 5) : [];
    // A mixed set for the moving strip and the changing hero photo. The order is reshuffled once a day.
    const runway = await q(`${PRODUCT_LIST} WHERE p.status = 'live' AND EXISTS (SELECT 1 FROM product_images i WHERE i.product_id = p.id) ORDER BY md5(p.id::text || current_date::text) LIMIT 20`);
    ctx.json(200, { runway: runway.map(card), newDrops: drops.map(card), edit: edit && edit.count > 0 ? { ...collectionCard(edit), products: editProducts.map(card) } : null }, { 'Cache-Control': 'public, max-age=20' });
  });

  r.get('/api/collections/:slug', async (ctx) => {
    const k = await one(`${COLLECTION_LIST} AND k.slug = $1`, [ctx.params.slug]);
    if (!k) throw notFound('This collection is not available.');
    return { collection: collectionCard(k), products: (await collectionProducts(k.id)).map(card) };
  });

  r.get('/api/products/:slug', async (ctx) => {
    const p = await one(`${PRODUCT_LIST} WHERE p.slug = $1 AND p.status IN ('live','sold_out')`, [ctx.params.slug]);
    if (!p) throw notFound('This item is no longer available.');
    const full = await one<{ description: string }>('SELECT description FROM products WHERE id = $1', [p.id]);
    const images = await q<{ id: number }>('SELECT id FROM product_images WHERE product_id = $1 ORDER BY position, id', [p.id]);
    const related = p.category_slug ? await q(`${PRODUCT_LIST} WHERE p.status = 'live' AND c.slug = $1 AND p.id <> $2 ORDER BY p.created_at DESC LIMIT 4`, [p.category_slug, p.id]) : [];
    // "Complete the look": pieces the owner paired with this item, in either direction. Never guessed.
    // The item's own pairings come first. Only when it has none do we show the pieces that name it, and never more than three.
    let look = await q(`${PRODUCT_LIST} WHERE p.status = 'live' AND p.id <> $1 AND p.id = ANY((SELECT pairs_with FROM products WHERE id = $1)::bigint[]) ORDER BY p.id LIMIT 4`, [p.id]);
    if (!look.length) look = await q(`${PRODUCT_LIST} WHERE p.status = 'live' AND p.id <> $1 AND $1 = ANY(p.pairs_with) ORDER BY p.id LIMIT 3`, [p.id]);
    return { product: { ...card(p), description: full!.description, images: images.map((i) => `/media/${i.id}`) }, related: related.map(card), look: look.map(card) };
  });

  // A customer sends their bag. Prices always come from the database, never from the browser.
  r.post('/api/orders', rateLimit('order', 12, 10 * 60_000), async (ctx) => {
    const b = z.object({
      name: zName, phone: zPhone,
      location: z.string().trim().min(2, 'Tell us where to deliver').max(160),
      note: z.string().trim().max(400).optional().default(''),
      items: z.array(z.object({
        productId: z.number().int().positive(), qty: z.number().int().min(1).max(20),
        size: z.string().trim().max(30).optional().default(''), colour: z.string().trim().max(30).optional().default(''),
      })).min(1, 'Your bag is empty').max(30),
      gift: z.object({ recipient: z.string().trim().max(80).default(''), message: z.string().trim().max(300).default('') }).nullable().optional(),
    }).parse(ctx.body);
    const ids = [...new Set(b.items.map((i) => i.productId))];
    const rows = await q(`SELECT id, name, slug, price_minor, status, sizes, colours FROM products WHERE id = ANY($1::bigint[])`, [ids]);
    const byId = new Map(rows.map((p: any) => [Number(p.id), p]));
    const lines = b.items.map((i) => {
      const p = byId.get(i.productId);
      if (!p || p.status === 'draft') throw conflict('An item in your bag is no longer available. Please remove it and try again.', 'item_gone');
      if (p.status === 'sold_out') throw conflict(`${p.name} is sold out. Please remove it from your bag.`, 'sold_out');
      if (p.sizes.length && !p.sizes.includes(i.size)) throw new HttpError(400, `Choose a size for ${p.name}`, 'size_required');
      if (p.colours.length && !p.colours.includes(i.colour)) throw new HttpError(400, `Choose a colour for ${p.name}`, 'colour_required');
      return { productId: Number(p.id), name: p.name, slug: p.slug, size: p.sizes.length ? i.size : '', colour: p.colours.length ? i.colour : '', qty: i.qty, priceMinor: Number(p.price_minor) };
    });
    const total = lines.reduce((s, l) => s + l.priceMinor * l.qty, 0);
    const unpriced = lines.filter((l) => l.priceMinor <= 0).length;
    const s = await getStore();
    const gift = s.gift_enabled && b.gift && (b.gift.recipient || b.gift.message) ? b.gift : null;
    let reference = '';
    for (let n = 0; n < 5; n++) {
      reference = 'PM-' + humanCode(6);
      try {
        await q(`INSERT INTO orders (reference, customer_name, customer_phone, location, note, items, total_minor, ip, gift) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [reference, b.name, b.phone, b.location, b.note, JSON.stringify(lines), total, ctx.ip, gift ? JSON.stringify(gift) : null]);
        break;
      } catch (e) { if (!isUniqueViolation(e) || n === 4) throw e; }
    }
    const opts = (l: { size: string; colour: string }) => { const o = [l.size && `size ${l.size}`, l.colour].filter(Boolean); return o.length ? ` (${o.join(', ')})` : ''; };
    const totalLine = unpriced === lines.length ? 'Please send me the prices.'
      : unpriced > 0 ? `Priced items: ${formatGhs(total)}. Please send the price for the other ${unpriced === 1 ? 'item' : `${unpriced} items`}. Delivery not included.`
      : `Total: ${formatGhs(total)} (delivery not included)`;
    const text = [
      `Hello ${s.name}, I would like to order:`, '',
      ...lines.map((l, i) => `${i + 1}. ${l.name}${opts(l)} x${l.qty} - ${l.priceMinor > 0 ? formatGhs(l.priceMinor * l.qty) : 'price please'}`),
      '', totalLine, '',
      `Name: ${b.name}`, `Phone: ${b.phone}`, `Deliver to: ${b.location}`, ...(b.note ? [`Note: ${b.note}`] : []),
      ...(gift ? ['', 'This is a gift.', ...(gift.recipient ? [`For: ${gift.recipient}`] : []), ...(gift.message ? [`Gift message: ${gift.message}`] : [])] : []),
      '', `Order number: ${reference}`,
    ].join('\n');
    ctx.json(201, { reference, totalMinor: total, unpriced, whatsappUrl: `https://wa.me/${waNumber(s.whatsapp)}?text=${encodeURIComponent(text)}` });
  });

  // Order tracking: the order number and the phone number used on the order must both match.
  r.post('/api/orders/track', rateLimit('track', 40, 10 * 60_000), async (ctx) => {
    const b = z.object({ reference: z.string().trim().toUpperCase().regex(/^PM-[A-Z0-9]{4,10}$/, 'Enter the order number, like PM-ABC123'), phone: zPhone }).parse(ctx.body);
    const o = await one(`SELECT reference, customer_phone, items, total_minor, status, created_at, updated_at FROM orders WHERE reference = $1`, [b.reference]);
    if (!o || o.customer_phone !== b.phone) throw notFound('We could not find an order with that number and phone number.');
    return { order: {
      reference: o.reference, status: o.status, step: TRACK_STEPS.indexOf(o.status), createdAt: o.created_at, updatedAt: o.updated_at, totalMinor: Number(o.total_minor),
      items: (o.items as any[]).map((l) => ({ name: l.name, slug: l.slug, qty: l.qty, size: l.size, colour: l.colour, priceMinor: l.priceMinor })),
    } };
  });

  // ---------- Staff sign-in ----------
  r.get('/api/auth/me', async (ctx) => ({ user: ctx.user && ctx.user.role !== 'customer' ? publicUser(ctx.user) : null }));

  r.post('/api/auth/login', rateLimit('login', 10, 15 * 60_000), async (ctx) => {
    const b = z.object({ email: zEmail, password: z.string().min(1).max(200) }).parse(ctx.body);
    const u = await one<SessionUser & { password_hash: string }>(`SELECT id, email, full_name, phone, role, status, password_hash FROM users WHERE lower(email) = $1`, [b.email]);
    const ok = await verifyPassword(b.password, u ? u.password_hash : await getDummyHash());
    if (!u || !ok) throw new HttpError(401, 'Email or password is not correct', 'bad_login');
    if (u.status !== 'active') throw new HttpError(403, 'This account is restricted.', 'restricted');
    const { password_hash: _ph, ...user } = u;
    await createSession(ctx, user);
    return { user: publicUser(user) };
  });

  r.post('/api/auth/logout', async (ctx) => { await destroySession(ctx); return { ok: true }; });

  r.get('/api/auth/link/:token', rateLimit('link', 30, 60 * 60_000), async (ctx) => {
    const l = await one(`SELECT kind, role, label FROM access_links WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()`, [sha256(ctx.params.token)]);
    if (!l) throw notFound('This link is invalid, expired or already used.');
    return { link: { kind: l.kind, role: l.role, label: l.label } };
  });

  r.post('/api/auth/link/:token', rateLimit('link', 30, 60 * 60_000), async (ctx) => {
    const user = await tx(async (db) => {
      const l = await one(`SELECT * FROM access_links WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now() FOR UPDATE`, [sha256(ctx.params.token)], db);
      if (!l) throw notFound('This link is invalid, expired or already used.');
      let u: SessionUser;
      if (l.kind === 'invite') {
        const b = z.object({ full_name: zName, email: zEmail, phone: zPhone.optional(), password: zPassword }).parse(ctx.body);
        const existing = await one(`SELECT id FROM users WHERE lower(email) = $1`, [b.email], db);
        if (existing) throw conflict('An account with this email already exists. Log in instead.', 'email_taken');
        u = (await one<SessionUser>(`INSERT INTO users (email, phone, full_name, password_hash, role) VALUES ($1,$2,$3,$4,$5) RETURNING id, email, full_name, phone, role, status`,
          [b.email, b.phone ?? null, b.full_name, await hashPassword(b.password), l.role || 'admin'], db))!;
      } else {
        const b = z.object({ password: zPassword }).parse(ctx.body);
        u = (await one<SessionUser>(`UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1 RETURNING id, email, full_name, phone, role, status`, [l.user_id, await hashPassword(b.password)], db))!;
        await revokeAllSessions(u.id, null, db);
      }
      await db.query('UPDATE access_links SET used_at = now() WHERE id = $1', [l.id]);
      return u;
    });
    await createSession(ctx, user);
    ctx.json(201, { user: publicUser(user) });
  });
}
