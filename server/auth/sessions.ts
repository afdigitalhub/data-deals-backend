import { config } from '../config.js';
import { one, q, type Queryable } from '../db/pool.js';
import { randomToken, sha256 } from '../lib/crypto.js';
import { HttpError, type Ctx } from '../http/core.js';

export type Role = 'customer' | 'support' | 'admin' | 'owner';
export interface SessionUser { id: number; email: string; full_name: string; phone: string | null; role: Role; status: 'active' | 'restricted' }

export const COOKIE = config.secureCookies ? '__Host-dd_session' : 'dd_session';
const CUSTOMER_TTL_S = 30 * 24 * 3600;
const STAFF_TTL_S = 12 * 3600;

export async function createSession(ctx: Ctx, user: SessionUser, db?: Queryable) {
  const token = randomToken(32);
  const ttl = user.role === 'customer' ? CUSTOMER_TTL_S : STAFF_TTL_S;
  await q(`INSERT INTO sessions (user_id, token_hash, ip, user_agent, expires_at) VALUES ($1, $2, $3, $4, now() + make_interval(secs => $5))`,
    [user.id, sha256(token), ctx.ip, String(ctx.req.headers['user-agent'] || '').slice(0, 300), ttl], db);
  ctx.setCookie(COOKIE, token, { maxAge: ttl, httpOnly: true, secure: config.secureCookies, sameSite: 'Lax' });
}

export async function loadSession(ctx: Ctx) {
  const token = ctx.cookies[COOKIE];
  if (!token || token.length > 100) return;
  const row = await one<SessionUser & { session_id: number; last_seen_at: Date }>(
    `SELECT s.id AS session_id, s.last_seen_at, u.id, u.email, u.full_name, u.phone, u.role, u.status
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()`, [sha256(token)]);
  if (!row) return;
  const { session_id, last_seen_at, ...user } = row;
  ctx.user = user;
  ctx.sessionId = session_id;
  if (Date.now() - new Date(last_seen_at).getTime() > 5 * 60_000) {
    q('UPDATE sessions SET last_seen_at = now() WHERE id = $1', [session_id]).catch(() => {});
  }
}

export async function destroySession(ctx: Ctx) {
  if (ctx.sessionId) await q('UPDATE sessions SET revoked_at = now() WHERE id = $1', [ctx.sessionId]);
  ctx.setCookie(COOKIE, '', { maxAge: 0, httpOnly: true, secure: config.secureCookies, sameSite: 'Lax' });
}

export async function revokeAllSessions(userId: number, exceptSessionId?: number | null, db?: Queryable) {
  await q('UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL AND ($2::bigint IS NULL OR id <> $2)', [userId, exceptSessionId ?? null], db);
}

// ---------- Authorisation ----------
const RANK: Record<Role, number> = { customer: 0, support: 1, admin: 2, owner: 3 };

export type Permission =
  | 'orders.view' | 'orders.fulfil' | 'refunds.manage' | 'products.manage' | 'payments.view'
  | 'suppliers.manage' | 'customers.view' | 'customers.restrict' | 'support.reply' | 'settings.manage'
  | 'team.manage' | 'audit.view' | 'analytics.view' | 'agents.manage';

const MIN_ROLE: Record<Permission, Role> = {
  'orders.view': 'support', 'support.reply': 'support', 'customers.view': 'support',
  'orders.fulfil': 'admin', 'refunds.manage': 'admin', 'products.manage': 'admin', 'payments.view': 'admin',
  'suppliers.manage': 'admin', 'customers.restrict': 'admin', 'settings.manage': 'admin', 'audit.view': 'admin',
  'analytics.view': 'admin', 'agents.manage': 'admin',
  'team.manage': 'owner',
};

export function can(user: SessionUser | null, p: Permission): boolean {
  return !!user && user.status === 'active' && RANK[user.role] >= RANK[MIN_ROLE[p]];
}

export function permissionsFor(user: SessionUser): Permission[] {
  return (Object.keys(MIN_ROLE) as Permission[]).filter((p) => can(user, p));
}

export const requireUser = (ctx: Ctx) => {
  if (!ctx.user) throw new HttpError(401, 'Please log in to continue', 'unauthenticated');
  if (ctx.user.status !== 'active') throw new HttpError(403, 'Your account is restricted. Please contact support.', 'restricted');
};

export const requireStaff = (ctx: Ctx) => {
  requireUser(ctx);
  if (ctx.user!.role === 'customer') throw new HttpError(403, 'Admins only', 'forbidden');
};

export const requirePerm = (p: Permission) => (ctx: Ctx) => {
  requireStaff(ctx);
  if (!can(ctx.user, p)) throw new HttpError(403, 'You do not have permission to do that', 'forbidden');
};
