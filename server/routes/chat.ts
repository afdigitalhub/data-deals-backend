import { z } from 'zod';
import { one, q } from '../db/pool.js';
import { HttpError, notFound, type Ctx, type Router } from '../http/core.js';
import { rateLimit } from '../http/security.js';
import { requirePerm, requireStaff } from '../auth/sessions.js';
import { randomToken, safeEqual, sha256 } from '../lib/crypto.js';
import { zPhone } from '../lib/util.js';
import { foundersOf, getSetting } from '../services/settings.js';
import { STATUS_LABEL, type OrderStatus } from '../services/orders.js';
import { addMessage, markStaffSeen, messagesAfter, notifyCustomerOfReply, notifyStaffOfCustomerMessage, staffOnline } from '../services/chat.js';
import { queueOrderPush, queueUserPush } from '../services/push.js';
import { loadOrderForViewer } from './public.js';

const zBody = z.string().trim().min(1, 'Type a message').max(2000, 'Message is too long (2000 characters max)');
const since = (ctx: Ctx) => Math.max(0, Number(ctx.query.get('since')) || 0);

/** The caller's conversation: logged-in customers by account; guests by an order they can prove they own
 *  (order number + its private link token), or by the chat token kept in their browser. */
async function myConversation(ctx: Ctx): Promise<{ conv: any; newToken: string | null }> {
  if (ctx.user) return { conv: await one('SELECT * FROM chat_conversations WHERE user_id = $1 ORDER BY last_message_at DESC LIMIT 1', [ctx.user.id]), newToken: null };
  const orderRef = String(ctx.req.headers['x-order-ref'] || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const orderTok = String(ctx.req.headers['x-order-token'] || '');
  if (orderRef && orderTok) {
    const o = await one('SELECT id, access_token_hash, user_id FROM orders WHERE reference = $1', [orderRef]);
    if (o && !o.user_id && safeEqual(sha256(orderTok), o.access_token_hash)) {
      const conv = await one('SELECT * FROM chat_conversations WHERE order_id = $1 AND user_id IS NULL ORDER BY last_message_at DESC LIMIT 1', [o.id]);
      if (conv) {
        // First time the guest opens a chat the team started: give their browser its own chat token too.
        if (!conv.guest_token_hash) {
          const t = randomToken(24);
          await q('UPDATE chat_conversations SET guest_token_hash = $2 WHERE id = $1 AND guest_token_hash IS NULL', [conv.id, sha256(t)]);
          return { conv, newToken: t };
        }
        return { conv, newToken: null };
      }
    }
  }
  const token = String(ctx.req.headers['x-chat-token'] || '');
  if (!/^[A-Za-z0-9_-]{20,80}$/.test(token)) return { conv: null, newToken: null };
  return { conv: await one('SELECT * FROM chat_conversations WHERE guest_token_hash = $1', [sha256(token)]), newToken: null };
}

async function attachOrder(ctx: Ctx, convId: number, reference?: string, orderToken?: string) {
  if (!reference) return null;
  if (orderToken) ctx.req.headers['x-order-token'] = orderToken;
  const o = await loadOrderForViewer(ctx, reference).catch(() => null);
  if (!o) return null;
  const cur = await one('SELECT order_id FROM chat_conversations WHERE id = $1', [convId]);
  if (Number(cur?.order_id) !== Number(o.id)) {
    await q('UPDATE chat_conversations SET order_id = $2 WHERE id = $1', [convId, o.id]);
    await addMessage(convId, 'system', `Order ${o.reference} attached`);
  }
  return o;
}

async function team() {
  const b = await getSetting('business');
  return b?.show_founders ? foundersOf(b).map((f) => ({ name: f.name.split(' ')[0], initials: f.name.trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase() })) : [];
}

export function registerChatRoutes(r: Router) {
  // ---------- Customer side ----------
  r.get('/api/chat', rateLimit('chat-poll', 240, 10 * 60_000), async (ctx) => {
    const { conv, newToken } = await myConversation(ctx);
    const base = { online: staffOnline(), team: await team() };
    if (!conv) return { ...base, conversation: null, messages: [], unread: 0 };
    const messages = await messagesAfter(conv.id, since(ctx));
    const lastStaff = [...messages].reverse().find((m) => m.sender !== 'customer');
    const unread = (await one(`SELECT count(*)::int AS n FROM chat_messages WHERE conversation_id = $1 AND sender = 'staff' AND id > $2`, [conv.id, conv.customer_last_read_id])).n;
    if (ctx.query.get('read') === '1' && lastStaff) await q('UPDATE chat_conversations SET customer_last_read_id = GREATEST(customer_last_read_id, $2) WHERE id = $1', [conv.id, lastStaff.id]);
    const order = conv.order_id ? await one('SELECT reference FROM orders WHERE id = $1', [conv.order_id]) : null;
    return { ...base, token: newToken, conversation: { id: Number(conv.id), status: conv.status, name: conv.name, orderReference: order?.reference ?? null }, messages, unread: ctx.query.get('read') === '1' ? 0 : unread };
  });

  r.post('/api/chat/start', rateLimit('chat-start', 6, 10 * 60_000), async (ctx) => {
    const b = z.object({
      name: z.string().trim().min(2, 'Enter your name').max(60).optional(),
      phone: zPhone.optional().or(z.literal('').transform(() => undefined)),
      message: zBody,
      order_reference: z.string().trim().max(20).optional(),
      order_token: z.string().max(80).optional(),
    }).parse(ctx.body);
    let conv = (await myConversation(ctx)).conv;
    let token: string | null = null;
    if (!conv) {
      if (ctx.user) {
        conv = await one('INSERT INTO chat_conversations (user_id, name, phone) VALUES ($1,$2,$3) RETURNING *', [ctx.user.id, ctx.user.full_name, ctx.user.phone]);
      } else {
        if (!b.name) throw new HttpError(400, 'Enter your name', 'validation', { name: 'Enter your name' });
        token = randomToken(24);
        conv = await one('INSERT INTO chat_conversations (guest_token_hash, name, phone) VALUES ($1,$2,$3) RETURNING *', [sha256(token), b.name, b.phone ?? null]);
      }
    }
    await attachOrder(ctx, conv.id, b.order_reference, b.order_token);
    await addMessage(conv.id, 'customer', b.message);
    await notifyStaffOfCustomerMessage(conv, b.message);
    return { ok: true, token, conversationId: Number(conv.id) };
  });

  r.post('/api/chat/messages', rateLimit('chat-send', 40, 5 * 60_000), async (ctx) => {
    const b = z.object({ message: zBody, order_reference: z.string().trim().max(20).optional(), order_token: z.string().max(80).optional() }).parse(ctx.body);
    const conv = (await myConversation(ctx)).conv;
    if (!conv) throw notFound('Start a chat first');
    await attachOrder(ctx, conv.id, b.order_reference, b.order_token);
    const m = await addMessage(conv.id, 'customer', b.message);
    await notifyStaffOfCustomerMessage(conv, b.message);
    return { ok: true, id: Number(m.id) };
  });

  // ---------- Staff: live chat inbox ----------
  r.get('/api/admin/chat', requirePerm('support.reply'), async (ctx) => {
    markStaffSeen(ctx.user!.id);
    const status = ctx.query.get('status') === 'closed' ? 'closed' : 'open';
    const rows = await q(`SELECT c.*, o.reference AS order_reference, u.email AS user_email,
        (SELECT body FROM chat_messages m WHERE m.conversation_id = c.id ORDER BY id DESC LIMIT 1) AS last_body,
        (SELECT sender FROM chat_messages m WHERE m.conversation_id = c.id ORDER BY id DESC LIMIT 1) AS last_sender,
        (SELECT count(*)::int FROM chat_messages m WHERE m.conversation_id = c.id AND m.sender = 'customer' AND m.id > c.staff_last_read_id) AS unread
      FROM chat_conversations c LEFT JOIN orders o ON o.id = c.order_id LEFT JOIN users u ON u.id = c.user_id
      WHERE c.status = $1 ORDER BY c.last_message_at DESC LIMIT 100`, [status]);
    return { conversations: rows.map((c) => ({ id: Number(c.id), name: c.name, phone: c.phone, email: c.user_email, isGuest: !c.user_id, status: c.status, orderReference: c.order_reference, lastBody: c.last_body, lastSender: c.last_sender, unread: c.unread, lastMessageAt: c.last_message_at })) };
  });

  r.get('/api/admin/chat/:id', requirePerm('support.reply'), async (ctx) => {
    markStaffSeen(ctx.user!.id);
    const c = await one('SELECT c.*, u.email AS user_email FROM chat_conversations c LEFT JOIN users u ON u.id = c.user_id WHERE c.id = $1', [Number(ctx.params.id) || 0]);
    if (!c) throw notFound('Conversation not found');
    const messages = await messagesAfter(c.id, since(ctx));
    const lastCustomer = [...messages].reverse().find((m) => m.sender === 'customer');
    if (lastCustomer) await q('UPDATE chat_conversations SET staff_last_read_id = GREATEST(staff_last_read_id, $2) WHERE id = $1', [c.id, lastCustomer.id]);
    const linked = c.order_id ? await one('SELECT reference, status, network_code, recipient_phone, total_minor, created_at FROM orders WHERE id = $1', [c.order_id]) : null;
    const recent = c.user_id || c.phone ? await q(`SELECT reference, status, network_code, recipient_phone, total_minor, created_at FROM orders
        WHERE (user_id = $1 OR recipient_phone = $2 OR contact_phone = $2) AND status <> 'pending_payment' ORDER BY created_at DESC LIMIT 5`, [c.user_id ?? 0, c.phone ?? '-']) : [];
    const ord = (o: any) => o && ({ reference: o.reference, status: o.status, statusLabel: STATUS_LABEL[o.status as OrderStatus], network: o.network_code, recipient: o.recipient_phone, totalMinor: Number(o.total_minor), createdAt: o.created_at });
    return {
      conversation: { id: Number(c.id), name: c.name, phone: c.phone, email: c.user_email, isGuest: !c.user_id, status: c.status, customerLastReadId: Number(c.customer_last_read_id), createdAt: c.created_at },
      messages, linkedOrder: ord(linked), recentOrders: recent.map(ord),
    };
  });

  r.post('/api/admin/chat/:id/messages', requirePerm('support.reply'), rateLimit('chat-staff', 120, 5 * 60_000), async (ctx) => {
    markStaffSeen(ctx.user!.id);
    const b = z.object({ message: zBody }).parse(ctx.body);
    const c = await one('SELECT * FROM chat_conversations WHERE id = $1', [Number(ctx.params.id) || 0]);
    if (!c) throw notFound('Conversation not found');
    const m = await addMessage(c.id, 'staff', b.message, ctx.user!.id);
    if (c.status === 'closed') await q(`UPDATE chat_conversations SET status = 'open', closed_at = NULL WHERE id = $1`, [c.id]);
    await notifyCustomerOfReply(c, ctx.user!.full_name.split(' ')[0], b.message);
    return { ok: true, id: Number(m.id) };
  });

  r.post('/api/admin/chat/:id/status', requirePerm('support.reply'), async (ctx) => {
    const b = z.object({ status: z.enum(['open', 'closed']) }).parse(ctx.body);
    const c = await one(`UPDATE chat_conversations SET status = $2, closed_at = CASE WHEN $2 = 'closed' THEN now() ELSE NULL END WHERE id = $1 RETURNING id`, [Number(ctx.params.id) || 0, b.status]);
    if (!c) throw notFound('Conversation not found');
    await addMessage(c.id, 'system', b.status === 'closed' ? `Chat closed by ${ctx.user!.full_name.split(' ')[0]}. Reply anytime to reopen it.` : 'Chat reopened');
    return { ok: true };
  });

  // Start (or continue) a chat with the customer of an order — works for guests too: they see it on their order page.
  r.post('/api/admin/orders/:ref/message', requirePerm('support.reply'), rateLimit('chat-staff', 120, 5 * 60_000), async (ctx) => {
    markStaffSeen(ctx.user!.id);
    const b = z.object({ message: zBody }).parse(ctx.body);
    const o = await one(`SELECT o.id, o.reference, o.user_id, o.recipient_phone, o.contact_phone, o.contact_email, u.full_name, u.phone AS user_phone
        FROM orders o LEFT JOIN users u ON u.id = o.user_id WHERE o.reference = $1`, [String(ctx.params.ref).toUpperCase()]);
    if (!o) throw notFound('Order not found');
    let conv = o.user_id
      ? await one('SELECT * FROM chat_conversations WHERE user_id = $1 ORDER BY last_message_at DESC LIMIT 1', [o.user_id])
      : await one('SELECT * FROM chat_conversations WHERE order_id = $1 AND user_id IS NULL ORDER BY last_message_at DESC LIMIT 1', [o.id]);
    if (!conv) {
      const guestName = o.contact_email ? String(o.contact_email).split('@')[0] : `Customer ${o.recipient_phone}`;
      conv = await one('INSERT INTO chat_conversations (user_id, name, phone, order_id) VALUES ($1,$2,$3,$4) RETURNING *',
        [o.user_id, o.full_name || guestName, o.user_phone || o.contact_phone || o.recipient_phone, o.id]);
      await addMessage(conv.id, 'system', `Order ${o.reference} attached`);
    } else if (Number(conv.order_id) !== Number(o.id)) {
      await q('UPDATE chat_conversations SET order_id = $2 WHERE id = $1', [conv.id, o.id]);
      await addMessage(conv.id, 'system', `Order ${o.reference} attached`);
    }
    await addMessage(conv.id, 'staff', b.message, ctx.user!.id);
    await q(`UPDATE chat_conversations SET status = 'open', closed_at = NULL WHERE id = $1`, [conv.id]);
    const who = ctx.user!.full_name.split(' ')[0];
    if (o.user_id) await notifyCustomerOfReply(conv, who, b.message);
    else await queueOrderPush(Number(o.id), { title: `💬 ${who} from Data Deals`, body: b.message.slice(0, 140), tag: `chat-order-${Date.now()}` });
    return { ok: true, conversationId: Number(conv.id) };
  });

  // Unread counts for the admin menu badges.
  r.get('/api/admin/chat-unread', requireStaff, async (ctx) => {
    markStaffSeen(ctx.user!.id);
    const support = (await one(`SELECT count(*)::int AS n FROM chat_messages m JOIN chat_conversations c ON c.id = m.conversation_id
        WHERE c.status = 'open' AND m.sender = 'customer' AND m.id > c.staff_last_read_id`)).n;
    const read = await one('SELECT last_read_id FROM team_reads WHERE user_id = $1', [ctx.user!.id]);
    const teamN = (await one('SELECT count(*)::int AS n FROM team_messages WHERE id > $1 AND user_id <> $2', [read?.last_read_id ?? 0, ctx.user!.id])).n;
    return { support, team: teamN };
  });

  // ---------- Staff: private team chat ----------
  r.get('/api/admin/team-chat', requireStaff, async (ctx) => {
    markStaffSeen(ctx.user!.id);
    const rows = await q(`SELECT t.id, t.user_id, t.body, t.created_at, u.full_name, u.role FROM team_messages t JOIN users u ON u.id = t.user_id
        WHERE t.id > $1 ORDER BY t.id DESC LIMIT 200`, [since(ctx)]);
    rows.reverse();
    const last = rows.at(-1);
    if (last) await q(`INSERT INTO team_reads (user_id, last_read_id) VALUES ($1,$2) ON CONFLICT (user_id) DO UPDATE SET last_read_id = GREATEST(team_reads.last_read_id, EXCLUDED.last_read_id)`, [ctx.user!.id, last.id]);
    const reads = await q(`SELECT r.user_id, r.last_read_id, u.full_name FROM team_reads r JOIN users u ON u.id = r.user_id WHERE u.role IN ('support','admin','owner') AND u.status = 'active'`);
    return {
      me: ctx.user!.id,
      messages: rows.map((m) => ({ id: Number(m.id), userId: Number(m.user_id), name: m.full_name, role: m.role, body: m.body, at: m.created_at })),
      reads: reads.map((x) => ({ userId: Number(x.user_id), name: String(x.full_name).split(' ')[0], lastReadId: Number(x.last_read_id) })),
    };
  });

  r.post('/api/admin/team-chat', requireStaff, rateLimit('team-chat', 120, 5 * 60_000), async (ctx) => {
    markStaffSeen(ctx.user!.id);
    const b = z.object({ message: zBody }).parse(ctx.body);
    const m = await one('INSERT INTO team_messages (user_id, body) VALUES ($1,$2) RETURNING id', [ctx.user!.id, b.message]);
    await q(`INSERT INTO team_reads (user_id, last_read_id) VALUES ($1,$2) ON CONFLICT (user_id) DO UPDATE SET last_read_id = GREATEST(team_reads.last_read_id, EXCLUDED.last_read_id)`, [ctx.user!.id, m.id]);
    const others = (await q(`SELECT id FROM users WHERE role IN ('support','admin','owner') AND status = 'active' AND id <> $1`, [ctx.user!.id])).map((u) => Number(u.id));
    await queueUserPush(others, { title: `💬 ${ctx.user!.full_name.split(' ')[0]} (team)`, body: b.message.slice(0, 140), url: '/admin/team-chat', tag: 'team-chat' }, `team:${m.id}`);
    return { ok: true, id: Number(m.id) };
  });
}

