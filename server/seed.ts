import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pool } from './db/pool.js';
import { log } from './lib/log.js';

/**
 * One-time import of the first women's outfits the owner sent as photos.
 * Runs once (guarded by a settings marker), so items the owner later edits or deletes never come back.
 * Prices were not supplied, so each item is stored with price 0 ("ask for price") until the owner sets one.
 */
const MARKER = 'import_womens_outfits_1';
const ITEMS: Array<[string, string, string]> = [
  ['w1.jpg', 'Pink blazer dress with white lapel', 'pink-blazer-dress-white-lapel'],
  ['w3.jpg', 'Red print tiered dress', 'red-print-tiered-dress'],
  ['w6.jpg', 'White button-front maxi dress', 'white-button-front-maxi-dress'],
  ['w5.jpg', 'Sky blue cowl-neck wide-leg outfit', 'sky-blue-cowl-neck-wide-leg-outfit'],
  ['w8.jpg', 'Pink floral long-sleeve two-piece', 'pink-floral-long-sleeve-two-piece'],
  ['w4.jpg', 'Striped blouse and wine leggings set', 'striped-blouse-wine-leggings-set'],
  ['w7.jpg', 'Pink chain-print shirt and brown leggings set', 'pink-chain-print-shirt-brown-leggings-set'],
  ['w2.jpg', 'Leopard print dungaree dress', 'leopard-print-dungaree-dress'],
];

export async function seedOnce(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(727274002)');
    const done = await client.query('SELECT 1 FROM settings WHERE key = $1', [MARKER]);
    if (done.rows.length) { await client.query('COMMIT'); return; }
    const cat = await client.query(`SELECT id FROM categories WHERE slug = 'womens-outfits'`);
    const catId = cat.rows[0]?.id ?? null;
    let n = 0;
    // Inserted last-to-first so the first item in the list is the newest and shows first.
    for (const [file, name, slug] of [...ITEMS].reverse()) {
      let bytes: Buffer;
      try { bytes = readFileSync(join(process.cwd(), 'seed', 'women', file)); } catch { log.warn('seed photo missing', { file }); continue; }
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
    log.info('first outfits imported', { count: n });
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    log.error('outfit import failed', { err: e });
  } finally { client.release(); }
}
