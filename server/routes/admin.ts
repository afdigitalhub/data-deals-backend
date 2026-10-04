import { z } from 'zod';
import { one, q, tx, isUniqueViolation } from '../db/pool.js';
import { hashPassword, randomToken, sha256, verifyPassword } from '../lib/crypto.js';
import { zPassword, zPhone } from '../lib/util.js';
import { HttpError, conflict, notFound, type Ctx, type Router } from '../http/core.js';
import { rateLimit } from '../http/security.js';
import { requireStaff, revokeAllSessions } from '../auth/sessions.js';
import { clearStoreCache, getStore } from './shop.js';
import { config } from '../config.js';

const MAX_IMAGES = 8;
const ORDER_STATUSES = ['new', 'confirmed', 'preparing', 'out_for_delivery', 'delivered', 'cancelled'] as const;
const MAX_IMAGE_BYTES = 1_400_000;

export function slugify(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70) || 'item';
}

async function uniqueSlug(table: 'products' | 'categories' | 'collections', base: string, exceptId?: number): Promise<string> {
  let slug = base;
  for (let n = 2; n < 200; n++) {
    const hit = await one(`SELECT id FROM ${table} WHERE slug = $1 AND ($2::bigint IS NULL OR id <> $2)`, [slug, exceptId ?? null]);
    if (!hit) return slug;
    slug = `${base}-${n}`;
  }
  return `${base}-${Date.now().toString(36)}`;
}

const cedis = z.union([z.number(), z.string()]).transform((v, c) => {
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[^\d.]/g, ''));
  if (!Number.isFinite(n) || n <= 0 || n > 1_000_000) { c.addIssue({ code: 'custom', message: 'Enter a price in cedis, e.g. 250' }); return z.NEVER; }
  return Math.round(n * 100);
});
const cedisOrZero = z.union([z.number(), z.string()]).transform((v, c) => {
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[^\d.]/g, ''));
  if (!Number.isFinite(n) || n < 0 || n > 1_000_000) { c.addIssue({ code: 'custom', message: 'Enter a price in cedis, e.g. 250. Put 0 to show Ask for price.' }); return z.NEVER; }
  return Math.round(n * 100);
});
const optionList = z.array(z.string().trim().min(1).max(30)).max(30).transform((a) => [...new Set(a)]);

const productInput = z.object({
  name: z.string().trim().min(2, 'Give the item a name').max(120),
  category_id: z.number().int().positive().nullable(),
  description: z.string().trim().max(2000).default(''),
  price: cedisOrZero,
  compare_at: cedis.nullable().optional(),
  sizes: optionList.default([]),
  colours: optionList.default([]),
  status: z.enum(['draft', 'live', 'sold_out']),
  is_featured: z.boolean().default(false),
  badges: z.array(z.enum(['trending', 'limited', 'bestseller'])).max(3).default([]).transform((a) => [...new Set(a)]),
  pairs_with: z.array(z.number().int().positive()).max(4).default([]),
});

const adminProduct = (p: any) => ({
  id: p.id, slug: p.slug, name: p.name, categoryId: p.category_id, categoryName: p.category_name ?? null, description: p.description,
  priceMinor: p.price_minor, compareAtMinor: p.compare_at_minor, sizes: p.sizes, colours: p.colours, status: p.status, isFeatured: p.is_featured, badges: p.badges || [], pairsWith: (p.pairs_with || []).map(Number),
  images: (p.images || []).map((id: number) => ({ id, url: `/media/${id}`, thumb: `/media/${id}/t` })), updatedAt: p.updated_at,
});

const PRODUCT_ADMIN = `SELECT p.*, c.name AS category_name,
    COALESCE((SELECT array_agg(i.id ORDER BY i.position, i.id) FROM product_images i WHERE i.product_id = p.id), '{}') AS images
  FROM products p LEFT JOIN categories c ON c.id = p.category_id`;

function decodeImage(dataUrl: string): { mime: string; bytes: Buffer } {
  const m = /^data:(image\/(?:jpeg|webp|png));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) throw new HttpError(400, 'That file is not a photo we can use. Use a JPG, PNG or WebP picture.', 'bad_image');
  const bytes = Buffer.from(m[2], 'base64');
  if (bytes.length < 200) throw new HttpError(400, 'That photo looks empty.', 'bad_image');
  if (bytes.length > MAX_IMAGE_BYTES) throw new HttpError(413, 'That photo is too large. Try a smaller picture.', 'image_too_large');
  // Check the real file signature, not just the label the browser sent.
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
  const png = bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const webp = bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP';
  const real = jpeg ? 'image/jpeg' : png ? 'image/png' : webp ? 'image/webp' : null;
  if (!real) throw new HttpError(400, 'That file is not a photo we can use. Use a JPG, PNG or WebP picture.', 'bad_image');
  return { mime: real, bytes };
}

export function registerAdminRoutes(r: Router) {
  r.get('/api/admin/summary', requireStaff, async () => {
    const counts = await one(`SELECT
        (SELECT count(*)::int FROM products WHERE status = 'live') AS live,
        (SELECT count(*)::int FROM products WHERE status = 'draft') AS drafts,
        (SELECT count(*)::int FROM products WHERE status = 'sold_out') AS sold_out,
        (SELECT count(*)::int FROM orders WHERE status = 'new') AS new_orders,
        (SELECT count(*)::int FROM orders WHERE created_at > now() - interval '7 days') AS orders_week`);
    return { counts };
  });

  // ---------- Products ----------
  r.get('/api/admin/products', requireStaff, async () => {
    const rows = await q(`${PRODUCT_ADMIN} ORDER BY p.updated_at DESC, p.id DESC LIMIT 500`);
    return { products: rows.map(adminProduct) };
  });

  r.get('/api/admin/products/:id', requireStaff, async (ctx) => {
    const p = await one(`${PRODUCT_ADMIN} WHERE p.id = $1`, [Number(ctx.params.id) || 0]);
    if (!p) throw notFound('Item not found');
    return { product: adminProduct(p) };
  });

  r.post('/api/admin/products', requireStaff, async (ctx) => {
    const b = productInput.parse(ctx.body);
    if (b.compare_at && b.compare_at <= b.price) throw new HttpError(400, 'The old price must be higher than the selling price', 'bad_compare');
    const slug = await uniqueSlug('products', slugify(b.name));
    const row = await one<{ id: number }>(`INSERT INTO products (name, slug, category_id, description, price_minor, compare_at_minor, sizes, colours, status, is_featured, badges, pairs_with)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`, [b.name, slug, b.category_id, b.description, b.price, b.compare_at ?? null, b.sizes, b.colours, b.status, b.is_featured, b.badges, b.pairs_with]);
    const p = await one(`${PRODUCT_ADMIN} WHERE p.id = $1`, [row!.id]);
    ctx.json(201, { product: adminProduct(p) });
  });

  r.put('/api/admin/products/:id', requireStaff, async (ctx) => {
    const id = Number(ctx.params.id) || 0;
    const b = productInput.parse(ctx.body);
    if (b.compare_at && b.compare_at <= b.price) throw new HttpError(400, 'The old price must be higher than the selling price', 'bad_compare');
    const cur = await one('SELECT id, name, slug FROM products WHERE id = $1', [id]);
    if (!cur) throw notFound('Item not found');
    const slug = cur.name === b.name ? cur.slug : await uniqueSlug('products', slugify(b.name), id);
    await q(`UPDATE products SET name=$2, slug=$3, category_id=$4, description=$5, price_minor=$6, compare_at_minor=$7, sizes=$8, colours=$9, status=$10, is_featured=$11, badges=$12, pairs_with=$13, updated_at=now() WHERE id=$1`,
      [id, b.name, slug, b.category_id, b.description, b.price, b.compare_at ?? null, b.sizes, b.colours, b.status, b.is_featured, b.badges, b.pairs_with.filter((x) => x !== id)]);
    const p = await one(`${PRODUCT_ADMIN} WHERE p.id = $1`, [id]);
    return { product: adminProduct(p) };
  });

  r.post('/api/admin/products/:id/status', requireStaff, async (ctx) => {
    const b = z.object({ status: z.enum(['draft', 'live', 'sold_out']) }).parse(ctx.body);
    const res = await q('UPDATE products SET status = $2, updated_at = now() WHERE id = $1 RETURNING id', [Number(ctx.params.id) || 0, b.status]);
    if (!res.length) throw notFound('Item not found');
    return { ok: true };
  });

  r.delete('/api/admin/products/:id', requireStaff, async (ctx) => {
    const res = await q('DELETE FROM products WHERE id = $1 RETURNING id', [Number(ctx.params.id) || 0]);
    if (!res.length) throw notFound('Item not found');
    return { ok: true };
  });

  // ---------- Photos ----------
  r.post('/api/admin/products/:id/images', requireStaff, rateLimit('upload', 120, 10 * 60_000), async (ctx) => {
    const id = Number(ctx.params.id) || 0;
    const b = z.object({ data: z.string().min(50).max(3_000_000), thumb: z.string().min(50).max(400_000).optional() }).parse(ctx.body);
    const img = decodeImage(b.data);
    // The browser also sends a small copy for the shop's cards. If it is missing or broken, cards use the full photo.
    let thumb: Buffer | null = null;
    if (b.thumb) { try { thumb = decodeImage(b.thumb).bytes; } catch { thumb = null; } }
    const row = await tx(async (db) => {
      const p = await one('SELECT id FROM products WHERE id = $1 FOR UPDATE', [id], db);
      if (!p) throw notFound('Item not found');
      const n = (await one<{ n: number; pos: number }>('SELECT count(*)::int AS n, COALESCE(max(position), -1)::int AS pos FROM product_images WHERE product_id = $1', [id], db))!;
      if (n.n >= MAX_IMAGES) throw conflict(`An item can have up to ${MAX_IMAGES} photos. Remove one first.`, 'too_many_images');
      const r2 = await one<{ id: number }>(`INSERT INTO product_images (product_id, position, mime, bytes, thumb) VALUES ($1,$2,$3, decode($4, 'base64'), decode($5, 'base64')) RETURNING id`, [id, n.pos + 1, img.mime, img.bytes.toString('base64'), thumb ? thumb.toString('base64') : null], db);
      await db.query('UPDATE products SET updated_at = now() WHERE id = $1', [id]);
      return r2!;
    });
    ctx.json(201, { image: { id: row.id, url: `/media/${row.id}`, thumb: `/media/${row.id}/t` } });
  });

  r.put('/api/admin/products/:id/images/order', requireStaff, async (ctx) => {
    const id = Number(ctx.params.id) || 0;
    const b = z.object({ ids: z.array(z.number().int().positive()).max(MAX_IMAGES) }).parse(ctx.body);
    await tx(async (db) => {
      for (let i = 0; i < b.ids.length; i++) await db.query('UPDATE product_images SET position = $3 WHERE id = $1 AND product_id = $2', [b.ids[i], id, i]);
    });
    return { ok: true };
  });

  r.delete('/api/admin/images/:id', requireStaff, async (ctx) => {
    const res = await q('DELETE FROM product_images WHERE id = $1 RETURNING id', [Number(ctx.params.id) || 0]);
    if (!res.length) throw notFound('Photo not found');
    return { ok: true };
  });

  // ---------- Categories ----------
  r.get('/api/admin/categories', requireStaff, async () => ({
    categories: await q(`SELECT c.id, c.name, c.slug, c.sort_order, c.is_active, (SELECT count(*)::int FROM products p WHERE p.category_id = c.id) AS count FROM categories c ORDER BY c.sort_order, c.id`),
  }));

  r.post('/api/admin/categories', requireStaff, async (ctx) => {
    const b = z.object({ name: z.string().trim().min(2).max(40) }).parse(ctx.body);
    const slug = await uniqueSlug('categories', slugify(b.name));
    const next = await one<{ n: number }>('SELECT COALESCE(max(sort_order), 0)::int + 1 AS n FROM categories');
    const row = await one('INSERT INTO categories (name, slug, sort_order) VALUES ($1,$2,$3) RETURNING id, name, slug, sort_order, is_active', [b.name, slug, next!.n]);
    ctx.json(201, { category: { ...row, count: 0 } });
  });

  r.put('/api/admin/categories/:id', requireStaff, async (ctx) => {
    const b = z.object({ name: z.string().trim().min(2).max(40), is_active: z.boolean(), sort_order: z.number().int().min(0).max(999) }).parse(ctx.body);
    const res = await q('UPDATE categories SET name = $2, is_active = $3, sort_order = $4 WHERE id = $1 RETURNING id', [Number(ctx.params.id) || 0, b.name, b.is_active, b.sort_order]);
    if (!res.length) throw notFound('Category not found');
    return { ok: true };
  });

  r.delete('/api/admin/categories/:id', requireStaff, async (ctx) => {
    const id = Number(ctx.params.id) || 0;
    const used = await one<{ n: number }>('SELECT count(*)::int AS n FROM products WHERE category_id = $1', [id]);
    if (used!.n > 0) throw conflict(`${used!.n} item${used!.n === 1 ? ' is' : 's are'} in this category. Move them first, or hide the category instead.`, 'category_in_use');
    await q('DELETE FROM categories WHERE id = $1', [id]);
    return { ok: true };
  });

  // ---------- Collections: "Shop by vibe" and "The Edit" ----------
  const collectionInput = z.object({
    kind: z.enum(['vibe', 'edit']), name: z.string().trim().min(2).max(50), tagline: z.string().trim().max(120).default(''), body: z.string().trim().max(800).default(''),
    is_active: z.boolean().default(true), sort_order: z.number().int().min(0).max(999).default(0), product_ids: z.array(z.number().int().positive()).max(60).default([]),
  });
  const saveProducts = async (db: { query: (t: string, v?: unknown[]) => Promise<unknown> }, id: number, ids: number[]) => {
    await db.query('DELETE FROM collection_products WHERE collection_id = $1', [id]);
    const unique = [...new Set(ids)];
    for (let i = 0; i < unique.length; i++) await db.query('INSERT INTO collection_products (collection_id, product_id, position) SELECT $1, id, $3 FROM products WHERE id = $2 ON CONFLICT DO NOTHING', [id, unique[i], i]);
  };

  r.get('/api/admin/collections', requireStaff, async () => ({
    collections: (await q(`SELECT k.id, k.kind, k.name, k.slug, k.tagline, k.body, k.is_active, k.sort_order,
      COALESCE((SELECT array_agg(cp.product_id ORDER BY cp.position, cp.product_id) FROM collection_products cp WHERE cp.collection_id = k.id), '{}') AS product_ids
      FROM collections k ORDER BY k.kind DESC, k.sort_order, k.id`)).map((k: any) => ({ ...k, product_ids: k.product_ids.map(Number) })),
  }));

  r.post('/api/admin/collections', requireStaff, async (ctx) => {
    const b = collectionInput.parse(ctx.body);
    const slug = await uniqueSlug('collections', slugify(b.name));
    const id = await tx(async (db) => {
      const row = await one<{ id: number }>('INSERT INTO collections (kind, name, slug, tagline, body, is_active, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id', [b.kind, b.name, slug, b.tagline, b.body, b.is_active, b.sort_order], db);
      await saveProducts(db, row!.id, b.product_ids);
      return row!.id;
    });
    ctx.json(201, { id });
  });

  r.put('/api/admin/collections/:id', requireStaff, async (ctx) => {
    const id = Number(ctx.params.id) || 0;
    const b = collectionInput.parse(ctx.body);
    await tx(async (db) => {
      const res = await db.query('UPDATE collections SET kind=$2, name=$3, tagline=$4, body=$5, is_active=$6, sort_order=$7 WHERE id=$1 RETURNING id', [id, b.kind, b.name, b.tagline, b.body, b.is_active, b.sort_order]);
      if (!res.rows.length) throw notFound('Collection not found');
      await saveProducts(db, id, b.product_ids);
    });
    return { ok: true };
  });

  r.delete('/api/admin/collections/:id', requireStaff, async (ctx) => {
    const res = await q('DELETE FROM collections WHERE id = $1 RETURNING id', [Number(ctx.params.id) || 0]);
    if (!res.length) throw notFound('Collection not found');
    return { ok: true };
  });

  // ---------- Orders ----------
  r.get('/api/admin/orders', requireStaff, async (ctx) => {
    const status = ctx.query.get('status');
    const rows = await q(`SELECT id, reference, customer_name, customer_phone, location, note, items, total_minor, status, gift, created_at FROM orders
      WHERE ($1::text IS NULL OR status = $1) ORDER BY created_at DESC LIMIT 200`, [status && ORDER_STATUSES.includes(status as any) ? status : null]);
    return { orders: rows.map((o: any) => ({ id: o.id, reference: o.reference, name: o.customer_name, phone: o.customer_phone, location: o.location, note: o.note, items: o.items, totalMinor: o.total_minor, status: o.status, gift: o.gift, createdAt: o.created_at })) };
  });

  r.post('/api/admin/orders/:id/status', requireStaff, async (ctx) => {
    const b = z.object({ status: z.enum(ORDER_STATUSES) }).parse(ctx.body);
    const res = await q('UPDATE orders SET status = $2, updated_at = now() WHERE id = $1 RETURNING id', [Number(ctx.params.id) || 0, b.status]);
    if (!res.length) throw notFound('Order not found');
    return { ok: true };
  });

  // ---------- Shop details ----------
  r.get('/api/admin/settings', requireStaff, async () => ({ store: await getStore() }));

  r.put('/api/admin/settings', requireStaff, async (ctx) => {
    const b = z.object({
      name: z.string().trim().min(2).max(60), tagline: z.string().trim().max(120),
      whatsapp: zPhone, phones: z.array(zPhone).min(1).max(4),
      location: z.string().trim().max(120), delivery_note: z.string().trim().max(400), about: z.string().trim().max(1500),
      free_delivery: z.union([z.number(), z.string()]).optional().transform((v) => { const n = Number(String(v ?? '').replace(/[^\d.]/g, '')); return Number.isFinite(n) && n > 0 && n < 1_000_000 ? Math.round(n * 100) : 0; }),
      gift_enabled: z.boolean().optional().default(false),
    }).transform(({ free_delivery, ...rest }) => ({ ...rest, free_delivery_minor: free_delivery })).parse(ctx.body);
    await q(`INSERT INTO settings (key, value, updated_at) VALUES ('store', $1, now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [JSON.stringify(b)]);
    clearStoreCache();
    return { store: b };
  });

  // ---------- Account and team ----------
  r.post('/api/admin/password', requireStaff, rateLimit('password', 8, 15 * 60_000), async (ctx) => {
    const b = z.object({ current: z.string().min(1).max(200), next: zPassword }).parse(ctx.body);
    const u = await one<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = $1', [ctx.user!.id]);
    if (!u || !(await verifyPassword(b.current, u.password_hash))) throw new HttpError(400, 'Your current password is not correct', 'bad_password');
    await q('UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1', [ctx.user!.id, await hashPassword(b.next)]);
    await revokeAllSessions(ctx.user!.id, ctx.sessionId);
    return { ok: true };
  });

  r.post('/api/admin/invites', requireStaff, async (ctx: Ctx) => {
    if (ctx.user!.role !== 'owner') throw new HttpError(403, 'Only the owner can invite staff', 'forbidden');
    const b = z.object({ label: z.string().trim().min(2).max(60) }).parse(ctx.body);
    const token = randomToken(24);
    try {
      await q(`INSERT INTO access_links (kind, token_hash, role, label, expires_at) VALUES ('invite', $1, 'admin', $2, now() + interval '7 days')`, [sha256(token), b.label]);
    } catch (e) { if (isUniqueViolation(e)) throw conflict('Please try again'); throw e; }
    ctx.json(201, { url: `${config.publicBaseUrl}/admin/link/${token}` });
  });
}
