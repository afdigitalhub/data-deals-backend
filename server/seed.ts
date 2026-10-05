import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pool } from './db/pool.js';
import { log } from './lib/log.js';
import { DEFAULT_POLICIES } from './policies.js';

/**
 * One-time imports of items the owner sent as photos.
 * Each batch runs once (guarded by a settings marker), so items the owner later edits or deletes never come back.
 * Prices were not supplied, so each item is stored with price 0 ("ask for price") until the owner sets one.
 */
type Batch = { marker: string; dir: string; categories?: Array<[name: string, slug: string, sort: number]>; replace?: Array<[slug: string, files: string]>; items: Array<[file: string, name: string, slug: string, category: string, colours?: string[]]> };
const BATCHES: Batch[] = [
  { marker: 'import_womens_outfits_1', dir: 'women', items: [
    ['w1.jpg', 'Pink blazer dress with white lapel', 'pink-blazer-dress-white-lapel', 'womens-outfits'],
    ['w3.jpg', 'Red print tiered dress', 'red-print-tiered-dress', 'womens-outfits'],
    ['w6.jpg', 'White button-front maxi dress', 'white-button-front-maxi-dress', 'womens-outfits'],
    ['w5.jpg', 'Sky blue cowl-neck wide-leg outfit', 'sky-blue-cowl-neck-wide-leg-outfit', 'womens-outfits'],
    ['w8.jpg', 'Pink floral long-sleeve two-piece', 'pink-floral-long-sleeve-two-piece', 'womens-outfits'],
    ['w4.jpg', 'Striped blouse and wine leggings set', 'striped-blouse-wine-leggings-set', 'womens-outfits'],
    ['w7.jpg', 'Pink chain-print shirt and brown leggings set', 'pink-chain-print-shirt-brown-leggings-set', 'womens-outfits'],
    ['w2.jpg', 'Leopard print dungaree dress', 'leopard-print-dungaree-dress', 'womens-outfits'],
  ] },
  // Named by what the photo shows. Brand names are left for the owner to add, since only he can vouch for them.
  { marker: 'import_batch_2', dir: 'batch2', items: [
    ['s1.jpg', 'Black and white low-top sneakers with red sole', 'black-white-low-top-sneakers-red-sole', 'sneakers'],
    ['m2.jpg', 'White long-sleeve shirt with printed sleeves', 'white-long-sleeve-shirt-printed-sleeves', 'mens-outfits'],
    ['m1.jpg', 'Black and white tie-dye shirt with green stripe', 'black-white-tie-dye-shirt-green-stripe', 'mens-outfits'],
  ] },
  { marker: 'import_batch_3', dir: 'batch3', categories: [["Men's shoes", 'mens-shoes', 1]], items: [
    ['a.jpg', 'Black patent and suede lace-up shoes', 'black-patent-suede-lace-up-shoes', 'mens-shoes'],
    ['d.jpg', 'Black suede loafers with gold buckle', 'black-suede-loafers-gold-buckle', 'mens-shoes'],
    ['e.jpg', 'Black suede chunky loafers with chain', 'black-suede-chunky-loafers-chain', 'mens-shoes'],
    ['b.jpg', 'Black velvet loafers with silver spade', 'black-velvet-loafers-silver-spade', 'mens-shoes'],
    ['c.jpg', 'Pink button-front dress with white collar', 'pink-button-front-dress-white-collar', 'womens-outfits'],
  ] },
  // Photos in a batch entry can list several files separated by "|"; the first is the main photo.
  { marker: 'import_batch_4', dir: 'batch4',
    replace: [
      ['leopard-print-dungaree-dress', 'leopard.jpg|leopard-2.jpg'],
      ['pink-chain-print-shirt-brown-leggings-set', 'chain.jpg|chain-2.jpg'],
      ['striped-blouse-wine-leggings-set', 'striped.jpg|striped-2.jpg'],
    ],
    items: [
      ['yellow.jpg', 'Yellow off-shoulder puff dress', 'yellow-off-shoulder-puff-dress', 'womens-outfits'],
      ['whiteset.jpg|whiteset-2.jpg', 'White tie-front shirt and trousers set', 'white-tie-front-shirt-trousers-set', 'womens-outfits'],
      ['lime.jpg|lime-2.jpg', 'Lime green tie-front shirt and trousers set', 'lime-green-tie-front-shirt-trousers-set', 'womens-outfits'],
      ['darkdenim.jpg', 'Dark denim button-front dress', 'dark-denim-button-front-dress', 'womens-outfits'],
      ['pinktier.jpg', 'Pink tiered dress with black bow straps', 'pink-tiered-dress-black-bow-straps', 'womens-outfits'],
      ['halter.jpg', 'Beige halter-neck maxi dress', 'beige-halter-neck-maxi-dress', 'womens-outfits'],
      ['orange.jpg', 'Orange shirt and trousers set', 'orange-shirt-trousers-set', 'womens-outfits'],
      ['pinklinen.jpg', 'Pink shirt and wide-leg trousers set', 'pink-shirt-wide-leg-trousers-set', 'womens-outfits'],
      ['shirtdress.jpg', 'White shirt dress with check trim', 'white-shirt-dress-check-trim', 'womens-outfits'],
      ['lightdenim.jpg', 'Light denim button-front dress', 'light-denim-button-front-dress', 'womens-outfits'],
      ['pinkcheck.jpg|pinkcheck-2.jpg', 'Pink check long-sleeve two-piece', 'pink-check-long-sleeve-two-piece', 'womens-outfits'],
      ['cape.jpg|cape-2.jpg', 'Red print cape top and white leggings set', 'red-print-cape-top-white-leggings-set', 'womens-outfits'],
      ['redtop.jpg', 'Red V-neck ruched top', 'red-v-neck-ruched-top', 'womens-outfits'],
      ['whitevtop.jpg|whitevtop-2.jpg', 'White V-neck ruched top', 'white-v-neck-ruched-top', 'womens-outfits'],
      ['whitehalter.jpg', 'White halter top with gold neck ring', 'white-halter-top-gold-neck-ring', 'womens-outfits'],
      ['shorts.jpg|shorts-2.jpg', 'Dark green belted shorts', 'dark-green-belted-shorts', 'womens-outfits'],
      ['bodysuit.jpg|bodysuit-2.jpg', 'Beige sleeveless bodysuit', 'beige-sleeveless-bodysuit', 'womens-outfits'],
    ] },
  { marker: 'import_batch_5', dir: 'batch5', items: [
    ['puffer-black.jpg|puffer-cream.jpg|puffer-taupe.jpg', 'Puffer vest with knit sleeves', 'puffer-vest-knit-sleeves', 'mens-outfits', ['Black', 'Cream', 'Taupe']],
    ['track-brown.jpg|track-olive.jpg', 'Oversized hoodie and joggers set', 'oversized-hoodie-joggers-set', 'mens-outfits', ['Brown', 'Olive']],
    ['atee-black.jpg|atee-white.jpg|atee-black-2.jpg|atee-white-2.jpg', 'Oversized letter-print T-shirt', 'oversized-letter-print-t-shirt', 'mens-outfits', ['Black', 'White']],
    ['hoodie-yellow.jpg|hoodie-grey.jpg', 'Cross-print zip hoodie', 'cross-print-zip-hoodie', 'mens-outfits', ['Yellow', 'Grey']],
    ['camojacket.jpg', 'Camo jacket with tan collar', 'camo-jacket-tan-collar', 'mens-outfits'],
    ['handtee.jpg|handtee-2.jpg', 'White T-shirt with hand and heart prints', 'white-t-shirt-hand-heart-prints', 'mens-outfits'],
    ['joggers.jpg', 'Leopard side-panel joggers', 'leopard-side-panel-joggers', 'mens-outfits', ['Black', 'Grey']],
    ['shirt-script.jpg', 'White short-sleeve shirt with chest pockets', 'white-short-sleeve-shirt-chest-pockets', 'mens-outfits'],
    ['camotee.jpg|camotee-2.jpg', 'Camo sleeveless graphic T-shirt', 'camo-sleeveless-graphic-t-shirt', 'mens-outfits'],
    ['shorts.jpg', 'Brown denim shorts', 'brown-denim-shorts', 'mens-outfits'],
    ['shirt-heart.jpg', 'White long-sleeve shirt with red heart', 'white-long-sleeve-shirt-red-heart', 'mens-outfits'],
    ['whiteleopard.jpg', 'White trousers with leopard side panel', 'white-trousers-leopard-side-panel', 'mens-outfits'],
    ['greytee.jpg', 'Grey sleeveless T-shirt', 'grey-sleeveless-t-shirt', 'mens-outfits'],
    ['capedress.jpg', 'Off-shoulder cape dress', 'off-shoulder-cape-dress', 'womens-outfits', ['Blue', 'Red', 'Brown', 'Black']],
    ['asymtop.jpg', 'Asymmetric sleeveless top', 'asymmetric-sleeveless-top', 'womens-outfits', ['Yellow', 'Green', 'Black', 'Wine', 'White', 'Brown', 'Cream']],
  ] },
];

export async function seedOnce(): Promise<void> {
  for (const b of BATCHES) await importBatch(b);
  await once('collections_1', seedCollections);
  await once('pairings_1', seedPairings);
  await once('policies_1', async (db) => {
    await db.query(`INSERT INTO settings (key, value) VALUES ('policies', $1::jsonb) ON CONFLICT (key) DO NOTHING`, [JSON.stringify(DEFAULT_POLICIES)]);
    return Object.keys(DEFAULT_POLICIES).length;
  });
  // The shop's address, as given by the owner. Only fills it in if the owner has not already typed one.
  await once('location_1', async (db) => {
    const r = await db.query(`UPDATE settings SET value = jsonb_set(value, '{location}', to_jsonb('Fire Service Road, Elubo'::text)), updated_at = now()
      WHERE key = 'store' AND COALESCE(value->>'location', '') = '' RETURNING key`);
    return r.rows.length;
  });
  await attachThumbs();
}

type Db = { query: (text: string, values?: unknown[]) => Promise<{ rows: any[] }> };
/** Runs a setup step a single time, remembered by a settings marker, so later edits by the owner are never overwritten. */
async function once(marker: string, fn: (db: Db) => Promise<number>): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(727274002)');
    const done = await client.query('SELECT 1 FROM settings WHERE key = $1', [marker]);
    if (done.rows.length) { await client.query('COMMIT'); return; }
    const n = await fn(client);
    await client.query(`INSERT INTO settings (key, value) VALUES ($1, $2::jsonb)`, [marker, JSON.stringify({ count: n, at: new Date().toISOString() })]);
    await client.query('COMMIT');
    log.info('setup step done', { marker, count: n });
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    log.error('setup step failed', { marker, err: e });
  } finally { client.release(); }
}

// A first arrangement of the items already in the shop. The owner can change every one of these in the admin.
const COLLECTIONS: Array<{ kind: 'vibe' | 'edit'; name: string; slug: string; tagline: string; body?: string; items: string[] }> = [
  { kind: 'vibe', name: 'The Street King', slug: 'the-street-king', tagline: 'Hoodies, prints and loose fits', items: [
    'oversized-hoodie-joggers-set', 'cross-print-zip-hoodie', 'puffer-vest-knit-sleeves', 'oversized-letter-print-t-shirt', 'leopard-side-panel-joggers',
    'black-white-low-top-sneakers-red-sole', 'camo-jacket-tan-collar', 'white-t-shirt-hand-heart-prints', 'camo-sleeveless-graphic-t-shirt', 'white-trousers-leopard-side-panel'] },
  { kind: 'vibe', name: 'The Clean Look', slug: 'the-clean-look', tagline: 'Sharp shirts, sets and polished shoes', items: [
    'white-tie-front-shirt-trousers-set', 'white-long-sleeve-shirt-red-heart', 'black-patent-suede-lace-up-shoes', 'pink-blazer-dress-white-lapel', 'white-short-sleeve-shirt-chest-pockets',
    'white-button-front-maxi-dress', 'black-suede-loafers-gold-buckle', 'pink-shirt-wide-leg-trousers-set', 'orange-shirt-trousers-set', 'white-shirt-dress-check-trim',
    'sky-blue-cowl-neck-wide-leg-outfit', 'white-long-sleeve-shirt-printed-sleeves'] },
  { kind: 'vibe', name: 'The Weekend', slug: 'the-weekend', tagline: 'Denim, shorts and easy tops', items: [
    'light-denim-button-front-dress', 'brown-denim-shorts', 'dark-green-belted-shorts', 'dark-denim-button-front-dress', 'asymmetric-sleeveless-top', 'grey-sleeveless-t-shirt',
    'red-v-neck-ruched-top', 'white-v-neck-ruched-top', 'leopard-print-dungaree-dress', 'black-white-tie-dye-shirt-green-stripe', 'striped-blouse-wine-leggings-set',
    'pink-chain-print-shirt-brown-leggings-set', 'red-print-cape-top-white-leggings-set', 'beige-sleeveless-bodysuit'] },
  { kind: 'vibe', name: 'The Night Out', slug: 'the-night-out', tagline: 'Dresses and shoes for after dark', items: [
    'beige-halter-neck-maxi-dress', 'yellow-off-shoulder-puff-dress', 'off-shoulder-cape-dress', 'black-velvet-loafers-silver-spade', 'pink-tiered-dress-black-bow-straps',
    'lime-green-tie-front-shirt-trousers-set', 'red-print-tiered-dress', 'white-halter-top-gold-neck-ring', 'black-suede-chunky-loafers-chain', 'pink-check-long-sleeve-two-piece',
    'pink-button-front-dress-white-collar', 'pink-floral-long-sleeve-two-piece'] },
  { kind: 'edit', name: 'All white, worn sharp', slug: 'all-white-worn-sharp', tagline: 'The Edit',
    body: 'White is the quickest way to look put together. These are the white pieces in the shop right now, for him and for her: wear one with denim, or go head to toe.', items: [
    'white-button-front-maxi-dress', 'white-long-sleeve-shirt-red-heart', 'white-tie-front-shirt-trousers-set', 'white-short-sleeve-shirt-chest-pockets', 'white-shirt-dress-check-trim',
    'white-trousers-leopard-side-panel', 'white-halter-top-gold-neck-ring'] },
];

async function seedCollections(db: Db): Promise<number> {
  let n = 0;
  for (let i = 0; i < COLLECTIONS.length; i++) {
    const c = COLLECTIONS[i];
    const row = await db.query(`INSERT INTO collections (kind, name, slug, tagline, body, sort_order) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (slug) DO NOTHING RETURNING id`, [c.kind, c.name, c.slug, c.tagline, c.body || '', i]);
    if (!row.rows.length) continue;
    for (let j = 0; j < c.items.length; j++) {
      await db.query(`INSERT INTO collection_products (collection_id, product_id, position) SELECT $1, id, $3 FROM products WHERE slug = $2 ON CONFLICT DO NOTHING`, [row.rows[0].id, c.items[j], j]);
    }
    n++;
  }
  return n;
}

// "Complete the look": pieces that are worn together. Each row is an item and what it pairs with.
const PAIRINGS: Array<[string, string[]]> = [
  ['brown-denim-shorts', ['white-short-sleeve-shirt-chest-pockets', 'black-white-low-top-sneakers-red-sole']],
  ['grey-sleeveless-t-shirt', ['brown-denim-shorts', 'black-white-low-top-sneakers-red-sole']],
  ['white-long-sleeve-shirt-red-heart', ['black-suede-loafers-gold-buckle']],
  ['white-long-sleeve-shirt-printed-sleeves', ['black-patent-suede-lace-up-shoes']],
  ['oversized-letter-print-t-shirt', ['leopard-side-panel-joggers', 'black-white-low-top-sneakers-red-sole']],
  ['cross-print-zip-hoodie', ['leopard-side-panel-joggers', 'black-white-low-top-sneakers-red-sole']],
  ['puffer-vest-knit-sleeves', ['oversized-letter-print-t-shirt', 'white-trousers-leopard-side-panel']],
  ['camo-jacket-tan-collar', ['grey-sleeveless-t-shirt', 'brown-denim-shorts']],
  ['white-t-shirt-hand-heart-prints', ['white-trousers-leopard-side-panel', 'black-white-low-top-sneakers-red-sole']],
  ['red-v-neck-ruched-top', ['dark-green-belted-shorts']],
  ['white-v-neck-ruched-top', ['dark-green-belted-shorts']],
  ['white-halter-top-gold-neck-ring', ['dark-green-belted-shorts']],
  ['beige-sleeveless-bodysuit', ['dark-green-belted-shorts']],
];

async function seedPairings(db: Db): Promise<number> {
  let n = 0;
  for (const [slug, others] of PAIRINGS) {
    const r = await db.query(`UPDATE products SET pairs_with = (SELECT COALESCE(array_agg(id), '{}') FROM products WHERE slug = ANY($2::text[])) WHERE slug = $1 AND pairs_with = '{}' RETURNING id`, [slug, others]);
    n += r.rows.length;
  }
  return n;
}

/** Gives photos their small copy (used on cards) where one was prepared ahead of time. Safe to run on every start. */
async function attachThumbs(): Promise<void> {
  try {
    const rows = await pool.query(`SELECT id, md5(bytes) AS h FROM product_images WHERE thumb IS NULL`);
    let n = 0;
    for (const r of rows.rows) {
      const f = join(process.cwd(), 'seed', 'thumbs', `${r.h}.webp`);
      if (!existsSync(f)) continue;
      await pool.query('UPDATE product_images SET thumb = $2 WHERE id = $1', [r.id, readFileSync(f)]);
      n++;
    }
    if (n) log.info('small photo copies attached', { count: n });
  } catch (e) { log.error('small photo copies failed', { err: e }); }
}

async function importBatch(batch: Batch): Promise<void> {
  const MARKER = batch.marker;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(727274002)');
    const done = await client.query('SELECT 1 FROM settings WHERE key = $1', [MARKER]);
    if (done.rows.length) { await client.query('COMMIT'); return; }
    for (const [name, slug, sort] of batch.categories || []) {
      await client.query('INSERT INTO categories (name, slug, sort_order) VALUES ($1,$2,$3) ON CONFLICT (slug) DO NOTHING', [name, slug, sort]);
    }
    let n = 0;
    // Inserted last-to-first so the first item in the list is the newest and shows first.
    for (const [file, name, slug, catSlug, colours] of [...batch.items].reverse()) {
      const cat = await client.query('SELECT id FROM categories WHERE slug = $1', [catSlug]);
      const catId = cat.rows[0]?.id ?? null;
      let photos: Buffer[];
      try { photos = file.split('|').map((f) => readFileSync(join(process.cwd(), 'seed', batch.dir, f))); } catch { log.warn('seed photo missing', { file }); continue; }
      const exists = await client.query('SELECT 1 FROM products WHERE slug = $1', [slug]);
      if (exists.rows.length) continue;
      const p = await client.query(
        `INSERT INTO products (name, slug, category_id, description, price_minor, sizes, colours, status, is_featured, created_at)
         VALUES ($1,$2,$3,'',0,'{}',$5,'live',false, now() + ($4 || ' milliseconds')::interval) RETURNING id`, [name, slug, catId, String(n), colours || []]);
      for (let i = 0; i < photos.length; i++) await client.query(`INSERT INTO product_images (product_id, position, mime, bytes) VALUES ($1, $2, 'image/jpeg', $3)`, [p.rows[0].id, i, photos[i]]);
      n++;
    }
    // Better copies of photos for items already on the shop. Only touches an item that still has just its one original photo.
    for (const [slug, files] of batch.replace || []) {
      const pr = await client.query('SELECT p.id, (SELECT count(*)::int FROM product_images i WHERE i.product_id = p.id) AS n FROM products p WHERE p.slug = $1', [slug]);
      if (!pr.rows.length || pr.rows[0].n !== 1) continue;
      let photos: Buffer[];
      try { photos = files.split('|').map((f) => readFileSync(join(process.cwd(), 'seed', batch.dir, f))); } catch { continue; }
      await client.query(`UPDATE product_images SET id = nextval(pg_get_serial_sequence('product_images','id')), bytes = $2, position = 0 WHERE product_id = $1`, [pr.rows[0].id, photos[0]]);
      for (let i = 1; i < photos.length; i++) await client.query(`INSERT INTO product_images (product_id, position, mime, bytes) VALUES ($1, $2, 'image/jpeg', $3)`, [pr.rows[0].id, i, photos[i]]);
    }
    await client.query(`INSERT INTO settings (key, value) VALUES ($1, $2::jsonb)`, [MARKER, JSON.stringify({ imported: n, at: new Date().toISOString() })]);
    await client.query('COMMIT');
    log.info('items imported', { batch: MARKER, count: n });
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    log.error('outfit import failed', { err: e });
  } finally { client.release(); }
}
