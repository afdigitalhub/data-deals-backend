import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './pool.js';
import { log } from '../lib/log.js';

function migrationsDir(): string {
  // Works both from source (server/db) and the build output (dist/server, with migrations copied next to it).
  const here = dirname(fileURLToPath(import.meta.url));
  for (const c of [join(here, 'migrations'), join(here, 'db', 'migrations')]) {
    try { readdirSync(c); return c; } catch { /* try next */ }
  }
  throw new Error('migrations directory not found');
}

/**
 * Applies pending SQL migrations in order. Each migration runs in its own transaction guarded by a
 * transaction-level advisory lock, so two instances starting together can never apply one twice.
 * Migrations only ever add or rename — they never drop data.
 */
export async function migrate(): Promise<string[]> {
  const dir = migrationsDir();
  const files = readdirSync(dir).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();
  const applied: string[] = [];
  for (const file of files) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(727274001)');
      await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
      const done = await client.query('SELECT 1 FROM schema_migrations WHERE id = $1', [file]);
      if (done.rows.length) { await client.query('COMMIT'); continue; }
      await client.query(readFileSync(join(dir, file), 'utf8'));
      await client.query('INSERT INTO schema_migrations (id) VALUES ($1)', [file]);
      await client.query('COMMIT');
      applied.push(file);
      log.info('migration applied', { file });
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch { /* ignore */ }
      log.error('migration failed', { file, err: e });
      throw e;
    } finally {
      client.release();
    }
  }
  return applied;
}
