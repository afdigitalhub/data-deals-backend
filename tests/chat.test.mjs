// Live support chat and team chat.
import test from 'node:test';
import assert from 'node:assert/strict';
const { start, stop, sql, makeOwner, liveDataProduct, checkout, Client } = await import('./helpers.mjs');
let owner;
test.before(async () => { await start(); owner = await makeOwner(); });
test.after(async () => { await stop(); });

const tokenHeader = (t) => ({ 'X-Chat-Token': t });

test('guest can start a chat, keeps it with a private token, and strangers cannot read it', async () => {
  const guest = new Client();
  const empty = await guest.get('/api/chat');
  assert.equal(empty.data.conversation, null);
  const noName = await guest.post('/api/chat/start', { message: 'Hello' });
  assert.equal(noName.status, 400);
  const s = await guest.post('/api/chat/start', { name: 'Kwame', phone: '0241234567', message: 'My data has not arrived' });
  assert.equal(s.status, 200, JSON.stringify(s.data));
  assert.ok(s.data.token);
  const mine = await guest.get('/api/chat', tokenHeader(s.data.token));
  assert.equal(mine.data.conversation.name, 'Kwame');
  assert.equal(mine.data.messages.at(-1).body, 'My data has not arrived');
  // a different browser without the token sees nothing; a made-up token sees nothing
  assert.equal((await new Client().get('/api/chat')).data.conversation, null);
  assert.equal((await new Client().get('/api/chat', tokenHeader('x'.repeat(32)))).data.conversation, null);
  // the database never stores the raw token
  const row = (await sql('SELECT guest_token_hash FROM chat_conversations'))[0];
  assert.notEqual(row.guest_token_hash, s.data.token);
});

test('staff see the chat, reply, unread counts update, customers see the reply; closing and reopening', async () => {
  const conv = (await owner.get('/api/admin/chat')).data.conversations[0];
  assert.equal(conv.name, 'Kwame'); assert.equal(conv.unread, 1);
  assert.equal((await owner.get('/api/admin/chat-unread')).data.support, 1);
  const detail = await owner.get(`/api/admin/chat/${conv.id}`);
  assert.equal(detail.data.messages.length, 1);
  assert.equal((await owner.get('/api/admin/chat-unread')).data.support, 0, 'opening marks as read');
  assert.equal((await owner.post(`/api/admin/chat/${conv.id}/messages`, { message: 'Sorry Kwame, checking now 🙏' })).status, 200);
  const g1 = (await sql(`SELECT id FROM chat_conversations WHERE name = 'Kwame'`))[0];
  const msgs = (await sql(`SELECT sender, body FROM chat_messages WHERE conversation_id = $1 ORDER BY id`, [g1.id]));
  assert.deepEqual(msgs.map((m) => m.sender), ['customer', 'staff']);
  // close, then a customer message reopens it
  await owner.post(`/api/admin/chat/${conv.id}/status`, { status: 'closed' });
  assert.equal((await sql('SELECT status FROM chat_conversations WHERE id = $1', [conv.id]))[0].status, 'closed');
  // messages are immutable
  await assert.rejects(sql('UPDATE chat_messages SET body = $1', ['edited']));
});

test('logged-in customer: chat tied to account, order attached only if it is theirs', async () => {
  const cust = new Client();
  await cust.post('/api/auth/register', { full_name: 'Ama Owusu', email: 'ama@example.com', phone: '0241110000', password: 'Str0ngPassw0rd' });
  const product = await liveDataProduct(owner);
  const o = await checkout(cust, product, { recipient_phone: '0241110000' });
  const other = await checkout(new Client(), product, { recipient_phone: '0241110001' });
  const s = await cust.post('/api/chat/start', { message: 'Question about my order', order_reference: o.data.reference });
  assert.equal(s.status, 200); assert.equal(s.data.token, null);
  const view = await cust.get('/api/chat?read=1');
  assert.equal(view.data.conversation.orderReference, o.data.reference);
  assert.ok(view.data.messages.some((m) => m.sender === 'system' && m.body.includes(o.data.reference)));
  // someone else's order can't be attached
  await cust.post('/api/chat/messages', { message: 'and this one?', order_reference: other.data.reference });
  assert.equal((await cust.get('/api/chat')).data.conversation.orderReference, o.data.reference);
  // staff detail shows linked order and recent orders
  const id = view.data.conversation.id;
  const d = await owner.get(`/api/admin/chat/${id}`);
  assert.equal(d.data.linkedOrder.reference, o.data.reference);
  assert.equal(d.data.conversation.email, 'ama@example.com');
  // customers can't use staff endpoints
  assert.equal((await cust.get('/api/admin/chat')).status, 403);
  assert.equal((await cust.get('/api/admin/team-chat')).status, 403);
});

test('team chat: staff only, read receipts, unread badge for the other founder', async () => {
  // invite a second staff member (Ben)
  const { randomBytes, createHash } = await import('node:crypto');
  const t = randomBytes(24).toString('base64url');
  await sql(`INSERT INTO admin_invites (token_hash, role, label, expires_at) VALUES ($1,'admin','ben', now() + interval '1 day')`, [createHash('sha256').update(t).digest('hex')]);
  const ben = new Client();
  assert.equal((await ben.post(`/api/auth/invite/${t}`, { full_name: 'Ben K', email: 'ben@example.com', phone: '0241112224', password: 'Str0ngPassw0rd' })).status, 201);
  assert.equal((await owner.post('/api/admin/team-chat', { message: 'Ben, check DDKG2E9CL8 please' })).status, 200);
  assert.equal((await ben.get('/api/admin/chat-unread')).data.team, 1);
  const tb = await ben.get('/api/admin/team-chat');
  assert.equal(tb.data.messages[0].body, 'Ben, check DDKG2E9CL8 please');
  assert.equal(tb.data.messages[0].name, 'Adonle Fameye');
  assert.equal((await ben.get('/api/admin/chat-unread')).data.team, 0);
  const to = await owner.get('/api/admin/team-chat');
  assert.ok(to.data.reads.find((r) => r.name === 'Ben').lastReadId >= to.data.messages[0].id, 'owner can see Ben read it');
  assert.equal((await owner.post('/api/admin/team-chat', { message: '' })).status, 400);
});

test('team can message a guest customer from an order; the guest sees it via their order and can reply', async () => {
  const product = (await sql(`SELECT * FROM products WHERE status = 'live' LIMIT 1`))[0];
  const guest = new Client();
  const o = await checkout(guest, product, { recipient_phone: '0592290174', email: 'emilia@example.com' });
  const ref = o.data.reference; const tok = o.data.accessToken;
  const r = await owner.post(`/api/admin/orders/${ref}/message`, { message: 'Hello Emilia, your data is on the way 🙏' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  // without proof of the order: nothing
  assert.equal((await new Client().get('/api/chat', { 'X-Order-Ref': ref, 'X-Order-Token': 'wrong-token-wrong-token' })).data.conversation, null);
  // with the order's private token: sees the message, unread count, and gets a chat token of its own
  const v = await guest.get('/api/chat', { 'X-Order-Ref': ref, 'X-Order-Token': tok });
  assert.equal(v.data.conversation.orderReference, ref);
  assert.equal(v.data.unread, 1);
  assert.ok(v.data.messages.some((m) => m.sender === 'staff' && m.body.startsWith('Hello Emilia')));
  assert.ok(v.data.token, 'guest browser receives its own chat token');
  // reply using the chat token alone
  assert.equal((await guest.post('/api/chat/messages', { message: 'Thank you!' }, { 'X-Chat-Token': v.data.token })).status, 200);
  const staffView = await owner.get(`/api/admin/chat/${r.data.conversationId}`);
  assert.equal(staffView.data.messages.at(-1).body, 'Thank you!');
  // a second message from the team goes to the same conversation
  const r2 = await owner.post(`/api/admin/orders/${ref}/message`, { message: 'Delivered now ✅' });
  assert.equal(r2.data.conversationId, r.data.conversationId);
});
