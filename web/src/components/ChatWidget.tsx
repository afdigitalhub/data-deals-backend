import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiError, get, post, safeStorage } from '../lib/api';
import { rememberedOrders, useApp } from '../lib/app-state';
import { useLocation } from '../lib/router';
import { Spinner } from './ui';
import { IcChat, IcX } from './icons';

interface Msg { id: number; sender: 'customer' | 'staff' | 'system'; body: string; at: string; staffName: string | null }
interface ChatData { conversation: { id: number; status: string; name: string; orderReference: string | null } | null; messages: Msg[]; unread: number; online: boolean; team: { name: string; initials: string }[] }

const TOKEN_KEY = 'dd_chat_token';
const CHIPS = ["My data hasn't arrived", 'I paid but see no order', 'I need a refund', 'I have a question'];
const time = (s: string) => new Date(s).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** Premium live chat with the DataCedi team. Guests get a private token; customers chat from their account. */
export function ChatWidget() {
  const { user } = useApp();
  const { path, search } = useLocation();
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState<string | null>(() => safeStorage().get(TOKEN_KEY));
  const [data, setData] = useState<ChatData | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [draft, setDraft] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const lastId = useRef(0);

  // Order context: chatting from an order page attaches that order automatically.
  const orderMatch = path.match(/^\/order\/([A-Za-z0-9]+)/);
  const orderRef = orderMatch ? orderMatch[1].toUpperCase() : undefined;
  const orderToken = search.get('t') || undefined;
  // Guests: prove access to an order (theirs, from this page or remembered on this phone) so they can see
  // chats the team started about it; plus their own chat token once they have one.
  const remembered = !user && !orderToken ? rememberedOrders()[0] : undefined;
  const orderAuth = !user ? (orderRef && orderToken ? { r: orderRef, t: orderToken } : remembered ? { r: remembered.r, t: remembered.t } : null) : null;
  const headers: Record<string, string> | undefined = user ? undefined : {
    ...(token ? { 'X-Chat-Token': token } : {}),
    ...(orderAuth ? { 'X-Order-Ref': orderAuth.r, 'X-Order-Token': orderAuth.t } : {}),
  };
  const hasChat = !!user || !!token || !!orderAuth;
  const autoOpened = useRef(false);

  useEffect(() => { if (search.get('chat') === 'open') setOpen(true); }, [search]);
  useEffect(() => { const on = () => setOpen(true); window.addEventListener('dd-open-chat', on); return () => window.removeEventListener('dd-open-chat', on); }, []);
  useEffect(() => { lastId.current = 0; setMsgs([]); setData(null); }, [user?.id]);

  const refresh = useCallback(async (markRead: boolean) => {
    if (!hasChat) return;
    try {
      const d = await get<ChatData & { token?: string | null }>(`/api/chat?since=${lastId.current}${markRead ? '&read=1' : ''}`, headers);
      if (d.token) { safeStorage().set(TOKEN_KEY, d.token); setToken(d.token); }
      setData(d);
      // A message from the team about this order: open the chat so the customer sees it straight away.
      if (!autoOpened.current && orderRef && d.unread > 0) { autoOpened.current = true; setOpen(true); }
      if (d.messages.length) {
        lastId.current = d.messages[d.messages.length - 1].id;
        setMsgs((cur) => { const seen = new Set(cur.map((m) => m.id)); return [...cur, ...d.messages.filter((m) => !seen.has(m.id))]; });
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 404 && token) { safeStorage().remove(TOKEN_KEY); setToken(null); }
    }
  }, [hasChat, token, user?.id, orderAuth?.r]); // eslint-disable-line react-hooks/exhaustive-deps

  // Poll: every 3s while open, every 25s in the background for the unread badge.
  useEffect(() => {
    if (!hasChat) { get<ChatData>('/api/chat').then(setData).catch(() => {}); return; }
    refresh(open);
    const t = setInterval(() => { if (document.visibilityState === 'visible') refresh(open); }, open ? 3000 : 25000);
    return () => clearInterval(t);
  }, [open, hasChat, refresh]);

  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' }); }, [msgs.length, open]);
  useEffect(() => {
    if (!open) return;
    const mq = window.matchMedia('(max-width: 640px)');
    if (mq.matches) { const prev = document.body.style.overflow; document.body.style.overflow = 'hidden'; return () => { document.body.style.overflow = prev; }; }
  }, [open]);

  const send = async (e?: FormEvent, text?: string) => {
    e?.preventDefault();
    const message = (text ?? draft).trim();
    if (!message || busy) return;
    setBusy(true); setErr(null);
    try {
      if (!data?.conversation) {
        const r = await post<{ token: string | null }>('/api/chat/start', { message, name: user ? undefined : name, phone: user ? undefined : phone, order_reference: orderRef, order_token: orderToken }, headers);
        if (r.token) { safeStorage().set(TOKEN_KEY, r.token); setToken(r.token); }
      } else {
        await post('/api/chat/messages', { message, order_reference: orderRef, order_token: orderToken }, headers);
      }
      setDraft('');
      setTimeout(() => refresh(true), 50);
    } catch (e2) { setErr(e2 instanceof ApiError ? (e2.details?.name || e2.message) : 'Message not sent. Check your connection.'); } finally { setBusy(false); }
  };

  const unread = open ? 0 : data?.unread || 0;
  const team = data?.team || [];
  const needsIntro = !user && !data?.conversation;
  const firstName = user?.fullName.split(' ')[0];

  return (
    <>
      {!open && (
        <button className="chat-fab" onClick={() => setOpen(true)} aria-label={unread ? `Chat with us, ${unread} new messages` : 'Chat with us'}>
          <IcChat width={24} height={24} />
          <span className="chat-fab-label">Chat</span>
          {unread > 0 && <span className="chat-badge">{unread}</span>}
        </button>
      )}
      {open && (
        <div className="chat-panel" role="dialog" aria-label="Chat with DataCedi">
          <div className="chat-head">
            <div className="chat-avatars">
              {team.length ? team.map((t) => <span key={t.initials}>{t.initials}</span>) : <span>⚡</span>}
            </div>
            <div className="chat-head-text">
              <b>DataCedi Support</b>
              <small>{data?.online ? <><i className="chat-dot" /> Online now</> : 'We usually reply within minutes'}</small>
            </div>
            <button className="chat-close" onClick={() => setOpen(false)} aria-label="Close chat"><IcX width={20} height={20} /></button>
          </div>

          <div className="chat-body" ref={listRef}>
            <div className="chat-welcome">
              <b>{firstName ? `Akwaaba, ${firstName}! 👋` : 'Akwaaba! 👋'}</b>
              <span>Ask us anything about your data, airtime or an order. {team.length ? `${team.map((t) => t.name).join(' and ')} and the team reply here.` : 'Our team replies here.'}</span>
              {orderRef && <span className="chat-order">Order {orderRef} will be attached</span>}
            </div>
            {msgs.map((m) => m.sender === 'system'
              ? <div key={m.id} className="chat-sys">{m.body}</div>
              : (
                <div key={m.id} className={`chat-msg ${m.sender === 'customer' ? 'me' : 'them'}`}>
                  {m.sender === 'staff' && <span className="chat-from">{m.staffName || 'DataCedi'} · DataCedi</span>}
                  <div className="chat-bubble">{m.body}</div>
                  <span className="chat-time">{time(m.at)}</span>
                </div>
              ))}
            {!msgs.length && (
              <div className="chat-chips">{CHIPS.map((c) => <button key={c} onClick={() => (needsIntro ? setDraft(c) : send(undefined, c))} disabled={busy}>{c}</button>)}</div>
            )}
          </div>

          <form className="chat-compose" onSubmit={send}>
            {needsIntro && (
              <div className="chat-intro">
                <input className="input" placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoComplete="name" />
                <input className="input" placeholder="Phone (optional)" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" maxLength={16} autoComplete="tel" />
              </div>
            )}
            {err && <div className="chat-err">{err}</div>}
            <div className="chat-row">
              <textarea rows={1} placeholder="Type a message…" value={draft} maxLength={2000}
                onChange={(e) => { setDraft(e.target.value); e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 110) + 'px'; }}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && window.matchMedia('(min-width: 900px)').matches) { e.preventDefault(); send(); } }} />
              <button type="submit" className="chat-send" disabled={busy || !draft.trim() || (needsIntro && name.trim().length < 2)} aria-label="Send">
                {busy ? <Spinner /> : <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M3.4 20.4 21 12 3.4 3.6 3.3 10l12.4 2-12.4 2z" /></svg>}
              </button>
            </div>
            <div className="chat-foot">Please never share your MoMo PIN or card details — DataCedi will never ask for them.</div>
          </form>
        </div>
      )}
    </>
  );
}
