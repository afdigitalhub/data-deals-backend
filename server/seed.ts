import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pool } from './db/pool.js';
import { log } from './lib/log.js';

/**
 * One-time imports of items the owner sent as photos.
 * Each batch runs once (guarded by a settings marker), so items the owner later edits or deletes never come back.
 * Prices were not supplied, so each item is stored with price 0 ("ask for price") until the owner sets one.
 */
type Batch = { marker: string; dir: string; items: Array<[file: string, name: string, slug: string, category: string]> };
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
];

export async function seedOnce(): Promise<void> {
  for (const b of BATCHES) await importBatch(b);
}

async function importBatch(batch: Batch): Promise<void> {
  const MARKER = batch.marker;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(727274002)');
    const done = await client.query('SELECT 1 FROM settings WHERE key = $1', [MARKER]);
    if (done.rows.length) { await client.query('COMMIT'); return; }
    let n = 0;
    // Inserted last-to-first so the first item in the list is the newest and shows first.
    for (const [file, name, slug, catSlug] of [...batch.items].reverse()) {
      const cat = await client.query('SELECT id FROM categories WHERE slug = $1', [catSlug]);
      const catId = cat.rows[0]?.id ?? null;
      let bytes: Buffer;
      try { bytes = readFileSync(join(process.cwd(), 'seed', batch.dir, file)); } catch { log.warn('seed photo missing', { file }); continue; }
      const exists = await client.query('SELECT 1 FROM products WHERE slug = $1', [slug]);
      if (exists.rows.length) continue;
      const p = await client.query(
        `INSERT INTO products (name, slug, category_id, description, price_minor, sizes, colours, status, is_featured, created_at)
         VALUES ($1,$2,$3,'',0,'{}','{}','live',false, now() + ($4 || ' milliseconds')::interval) RETURNING id`, [name, slug, catId, String(n)]);
      await client.query(`INSERT INTO product_images (product_id, position, mime, bytes) VALUES ($1, 0, 'image/jpeg', $2)`, [p.rows[0].id, bytes]);
      n++;
    }
    await client.query(`INSERT INTO settings (key, value) VALUES ($1, $2::jsonb)`, [MARKER, JSON.stringify({ imported: n, at: new Date().toISOString() })]);
    await client.query('COMMIT');
    log.info('items imported', { batch: MARKER, count: n });
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    log.error('outfit import failed', { err: e });
  } finally { client.release(); }
}
