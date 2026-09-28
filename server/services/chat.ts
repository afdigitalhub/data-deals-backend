import { one, q } from '../db/pool.js';
import { can, type SessionUser } from '../auth/sessions.js';
import { queueUserPush } from './push.js';

/** Staff who looked at chat in the last 2 minutes count as "online" (kept in memory; resets on restart). */
const seen = new Map<number, number>();
export const markStaffSeen = (userId: number) => seen.set(userId, Date.now());
export const staffOnline = () => [...seen.values()].some((t) => Date.now() - t < 120_000);

export async function staffIds(exceptUserId?: number) {
  const rows = await q(`SELECT id, role, status FROM users WHERE role IN ('support','admin','owner') AND status = 'active'`);
  return rows.filter((u) => can(u as unknown as SessionUser, 'support.reply') && u.id !== exceptUserId).map((u) => Number(u.id));
}

export async function addMessage(conversationId: number, sender: 'customer' | 'staff' | 'system', body: string, staffUserId: number | null = null) {
  const m = await one(`INSERT INTO chat_messages (conversation_id, sender, staff_user_id, body) VALUES ($1,$2,$3,$4) RETURNING id, created_at`, [conversationId, sender, staffUserId, body]);
  await q(`UPDATE chat_conversations SET last_message_at = now(), status = CASE WHEN $2 = 'customer' THEN 'open' ELSE status END, closed_at = CASE WHEN $2 = 'customer' THEN NULL ELSE closed_at END WHERE id = $1`, [conversationId, sender]);
  return m;
}

export async function messagesAfter(conversationId: number, since: number) {
  const rows = await q(`SELECT m.id, m.sender, m.body, m.created_at, u.full_name AS staff_name
      FROM chat_messages m LEFT JOIN users u ON u.id = m.staff_user_id
      WHERE m.conversation_id = $1 AND m.id > $2 ORDER BY m.id LIMIT 200`, [conversationId, since]);
  return rows.map((r) => ({ id: Number(r.id), sender: r.sender, body: r.body, at: r.created_at, staffName: r.staff_name ? String(r.staff_name).split(' ')[0] : null }));
}

export async function notifyStaffOfCustomerMessage(conv: any, body: string) {
  const ids = await staffIds();
  await queueUserPush(ids, { title: `💬 ${conv.name}`, body: body.slice(0, 140), url: `/admin/chat/${conv.id}`, tag: `chat-${conv.id}` }, `chat-staff:${conv.id}:${Date.now()}`);
}

export async function notifyCustomerOfReply(conv: any, staffName: string, body: string) {
  if (!conv.user_id) return;
  await queueUserPush([Number(conv.user_id)], { title: `💬 ${staffName} from Data Deals`, body: body.slice(0, 140), url: '/?chat=open', tag: 'chat-reply' }, `chat-cust:${conv.id}:${Date.now()}`);
}
