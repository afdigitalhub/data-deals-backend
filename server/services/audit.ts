import { q, type Queryable } from '../db/pool.js';
import type { Ctx } from '../http/core.js';

/** Writes an immutable admin audit record (the table rejects edits and deletes). */
export async function audit(ctx: Ctx | null, action: string, entityType: string, entityId: string | number | null, before: unknown, after: unknown, db?: Queryable) {
  await q(`INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, before_data, after_data, ip) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [ctx?.user?.id ?? null, action, entityType, entityId === null ? null : String(entityId), before ?? null, after ?? null, ctx?.ip ?? null], db);
}
