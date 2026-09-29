import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { get, post } from '../lib/api';
import { dateTime, ghs, timeAgo } from '../lib/format';
import { Link, navigate, usePageTitle } from '../lib/router';
import { Alert, Empty, Loading, NetworkBadge, Spinner, StatusPill, errMsg } from '../components/ui';
import { IcBack, IcChat } from '../components/icons';

const time = (s: string) => new Date(s).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** Turns order numbers (DCXXXXXXXX) in a message into links to the order. Everything else stays plain text. */
function Linkify({ text }: { text: string }) {
  const parts = text.split(/\b(DC[A-Z0-9]{8})\b/g);
  return <>{parts.map((p, i) => (i % 2 ? <Link key={i} to={`/admin/orders/${p}`} className="chat-link">{p}</Link> : <span key={i}>{p}</span>))}</>;
}

function Composer({ onSend, placeholder }: { onSend: (text: string) => Promise<void>; placeholder: string }) {
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    const t = draft.trim();
    if (!t || busy) return;
    setBusy(true); setErr(null);
    try { await onSend(t); setDraft(''); } catch (e2) { setErr(errMsg(e2)); } finally { setBusy(false); }
  };
  return (
    <form className="achat-compose" onSubmit={submit}>
      {err && <div className="chat-err">{err}</div>}
      <div className="chat-row">
        <textarea rows={1} value={draft} placeholder={placeholder} maxLength={2000}
          onChange={(e) => { setDraft(e.target.value); e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 130) + 'px'; }}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && window.matchMedia('(min-width: 900px)').matches) { e.preventDefault(); submit(); } }} />
        <button className="chat-send" disabled={busy || !draft.trim()} aria-label="Send">{busy ? <Spinner /> : <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M3.4 20.4 21 12 3.4 3.6 3.3 10l12.4 2-12.4 2z" /></svg>}</button>
      </div>
    </form>
  );
}

/** Polls a list endpoint that returns messages after an id, appending new ones. */
function usePolledMessages<T extends { id: number }>(url: string | null, pick: (d: any) => T[], ms: number) {
  const [items, setItems] = useState<T[]>([]);
  const [extra, setExtra] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const last = useRef(0);
  useEffect(() => { last.current = 0; setItems([]); setExtra(null); }, [url]);
  const load = useCallback(async () => {
    if (!url) return;
    try {
      const d = await get(`${url}${url.includes('?') ? '&' : '?'}since=${last.current}`);
      const got = pick(d);
      if (got.length) { last.current = got[got.length - 1].id; setItems((cur) => { const seen = new Set(cur.map((m) => m.id)); return [...cur, ...got.filter((m) => !seen.has(m.id))]; }); }
      setExtra(d); setError(null);
    } catch (e) { setError(errMsg(e)); }
  }, [url]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); const t = setInterval(() => { if (document.visibilityState === 'visible') load(); }, ms); return () => clearInterval(t); }, [load, ms]);
  return { items, extra, error, load };
}

// ---------- Live chat inbox ----------
export function LiveChatPage({ id }: { id?: string }) {
  usePageTitle('Live chat');
  const [tab, setTab] = useState<'open' | 'closed'>('open');
  const [list, setList] = useState<any[] | null>(null);
  const loadList = useCallback(() => get(`/api/admin/chat?status=${tab}`).then((d) => setList(d.conversations)).catch(() => setList([])), [tab]);
  useEffect(() => { loadList(); const t = setInterval(loadList, 6000); return () => clearInterval(t); }, [loadList]);

  return (
    <>
      <div className="admin-head"><h1>Live chat</h1><span className="tiny muted">Customers see replies instantly, and get a phone alert if they turned notifications on.</span></div>
      <div className={`achat ${id ? 'has-open' : ''}`}>
        <aside className="achat-list">
          <div className="seg" style={{ marginBottom: 10 }}>
            <button className={tab === 'open' ? 'active' : ''} onClick={() => setTab('open')}>Open</button>
            <button className={tab === 'closed' ? 'active' : ''} onClick={() => setTab('closed')}>Closed</button>
          </div>
          {list === null ? <Loading /> : !list.length ? <Empty icon={<IcChat />} title={tab === 'open' ? 'No open chats' : 'No closed chats'}>{tab === 'open' ? 'When a customer taps the Chat button on the website, the conversation appears here.' : ''}</Empty> : list.map((c) => (
            <Link key={c.id} to={`/admin/chat/${c.id}`} className={`achat-item ${String(c.id) === id ? 'active' : ''}`}>
              <span className="achat-av">{c.name.trim().charAt(0).toUpperCase()}</span>
              <span className="achat-mid">
                <span className="achat-name">{c.name}{c.isGuest && <em>guest</em>}</span>
                <span className="achat-prev">{c.lastSender === 'staff' ? 'You: ' : ''}{c.lastBody}</span>
              </span>
              <span className="achat-side">
                <span className="tiny muted">{timeAgo(c.lastMessageAt)}</span>
                {c.unread > 0 && <span className="badge-count">{c.unread}</span>}
              </span>
            </Link>
          ))}
        </aside>
        <section className="achat-main">{id ? <Conversation id={id} onChange={loadList} /> : <div className="achat-empty"><IcChat width={40} height={40} /><p>Choose a conversation</p></div>}</section>
      </div>
    </>
  );
}

function Conversation({ id, onChange }: { id: string; onChange: () => void }) {
  const { items, extra, error, load } = usePolledMessages<any>(`/api/admin/chat/${id}`, (d) => d.messages, 3000);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.scrollTo({ top: ref.current.scrollHeight }); }, [items.length]);
  if (error && !extra) return <Alert>{error}</Alert>;
  if (!extra) return <Loading />;
  const c = extra.conversation;
  const setStatus = async (status: 'open' | 'closed') => { await post(`/api/admin/chat/${id}/status`, { status }); load(); onChange(); };
  return (
    <div className="achat-conv">
      <div className="achat-conv-head">
        <button className="icon-btn achat-back" onClick={() => navigate('/admin/chat')} aria-label="Back"><IcBack /></button>
        <span className="achat-av">{c.name.trim().charAt(0).toUpperCase()}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <b>{c.name}</b>
          <div className="tiny muted">{[c.phone, c.email, c.isGuest ? 'Guest (no account)' : 'Customer account'].filter(Boolean).join(' · ')}</div>
        </div>
        {c.status === 'open' ? <button className="btn btn-light btn-sm" onClick={() => setStatus('closed')}>Close chat</button> : <button className="btn btn-light btn-sm" onClick={() => setStatus('open')}>Reopen</button>}
      </div>
      {(extra.linkedOrder || extra.recentOrders?.length > 0) && (
        <div className="achat-orders">
          {extra.linkedOrder && <OrderChip o={extra.linkedOrder} label="Attached" />}
          {extra.recentOrders.filter((o: any) => o.reference !== extra.linkedOrder?.reference).slice(0, 3).map((o: any) => <OrderChip key={o.reference} o={o} />)}
        </div>
      )}
      <div className="achat-msgs" ref={ref}>
        {items.map((m: any, i: number) => m.sender === 'system'
          ? <div key={m.id} className="chat-sys">{m.body}</div>
          : (
            <div key={m.id} className={`chat-msg ${m.sender === 'staff' ? 'me' : 'them'}`}>
              {m.sender === 'staff' && items[i - 1]?.staffName !== m.staffName && <span className="chat-from">{m.staffName}</span>}
              <div className="chat-bubble"><Linkify text={m.body} /></div>
              <span className="chat-time">{time(m.at)}{m.sender === 'staff' && m.id <= c.customerLastReadId ? ' · Seen' : ''}</span>
            </div>
          ))}
      </div>
      <Composer placeholder={`Reply to ${c.name.split(' ')[0]}…`} onSend={async (t) => { await post(`/api/admin/chat/${id}/messages`, { message: t }); await load(); onChange(); }} />
    </div>
  );
}

function OrderChip({ o, label }: { o: any; label?: string }) {
  return (
    <Link to={`/admin/orders/${o.reference}`} className="achat-order">
      <NetworkBadge code={o.network} size="sm" />
      <span><b className="mono">{o.reference}</b>{label && <em>{label}</em>}<br /><span className="tiny muted">{ghs(o.totalMinor)} → {o.recipient} · {dateTime(o.createdAt)}</span></span>
      <StatusPill status={o.status} label={o.statusLabel} />
    </Link>
  );
}

// ---------- Team chat ----------
export function TeamChatPage() {
  usePageTitle('Team chat');
  const { items, extra, error, load } = usePolledMessages<any>('/api/admin/team-chat', (d) => d.messages, 3000);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.scrollTo({ top: ref.current.scrollHeight }); }, [items.length]);
  const me = extra?.me;
  const reads: any[] = extra?.reads || [];
  const lastMine = [...items].reverse().find((m) => m.userId === me);
  const seenBy = lastMine ? reads.filter((r) => r.userId !== me && r.lastReadId >= lastMine.id).map((r) => r.name) : [];
  let body: ReactNode;
  if (error && !extra) body = <Alert>{error}</Alert>;
  else if (!extra) body = <Loading />;
  else body = (
    <div className="achat-conv team">
      <div className="achat-conv-head">
        <span className="achat-av team">⚡</span>
        <div style={{ flex: 1 }}><b>DataCedi team</b><div className="tiny muted">Private to staff: {reads.map((r) => r.name).join(', ') || 'you'}</div></div>
      </div>
      <div className="achat-msgs" ref={ref}>
        {!items.length && <div className="chat-sys">Say hello to the team 👋 Type an order number like DC1234ABCD and it becomes a link.</div>}
        {items.map((m: any, i: number) => (
          <div key={m.id} className={`chat-msg ${m.userId === me ? 'me' : 'them'}`}>
            {m.userId !== me && items[i - 1]?.userId !== m.userId && <span className="chat-from">{m.name}</span>}
            <div className="chat-bubble"><Linkify text={m.body} /></div>
            <span className="chat-time">{time(m.at)}{m === lastMine && seenBy.length ? ` · Seen by ${seenBy.join(', ')}` : ''}</span>
          </div>
        ))}
      </div>
      <Composer placeholder="Message the team…" onSend={async (t) => { await post('/api/admin/team-chat', { message: t }); await load(); }} />
    </div>
  );
  return (
    <>
      <div className="admin-head"><h1>Team chat</h1><span className="tiny muted">Only you and your team can see this.</span></div>
      <div className="achat single">{body}</div>
    </>
  );
}
