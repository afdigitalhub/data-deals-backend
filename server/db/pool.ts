import pg, { type PoolConfig, type PoolClient } from 'pg';
import { config } from '../config.js';
import { log } from '../lib/log.js';

// BIGINT columns hold money in pesewas and row counts; both are far below 2^53, so plain numbers are exact.
pg.types.setTypeParser(20, (v: string) => Number(v));

function buildPoolConfig(): PoolConfig {
  const raw = config.databaseUrl;
  if (!raw) return { connectionString: raw };
  const url = new URL(raw);
  const isLocal = ['localhost', '127.0.0.1', ''].includes(url.hostname) || url.searchParams.has('host');
  // We manage TLS explicitly (verified certificates for Neon), so drop URL flags that would override it.
  url.searchParams.delete('sslmode');
  url.searchParams.delete('channel_binding');
  return {
    connectionString: url.toString(),
    ssl: isLocal ? undefined : { rejectUnauthorized: true },
    max: Number(process.env.DB_POOL_MAX || 8),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 15_000,
  };
}

export const pool = new pg.Pool(buildPoolConfig());
pool.on('error', (err: Error) => log.error('db pool error', { err }));

export type Queryable = { query: (text: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount: number | null }> };

export async function q<T = any>(text: string, params: unknown[] = [], db: Queryable = pool): Promise<T[]> {
  const r = await db.query(text, params);
  return r.rows as T[];
}

export async function one<T = any>(text: string, params: unknown[] = [], db: Queryable = pool): Promise<T | undefined> {
  const r = await db.query(text, params);
  return r.rows[0] as T | undefined;
}

/** Run fn inside a single database transaction. Rolls back on any error. */
export async function tx<T>(fn: (db: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch { /* connection may be gone */ }
    throw e;
  } finally {
    client.release();
  }
}

export function isUniqueViolation(e: unknown, constraint?: string): boolean {
  const err = e as { code?: string; constraint?: string };
  return err?.code === '23505' && (!constraint || err.constraint === constraint);
}
