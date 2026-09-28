import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { del, get, patch, post } from '../lib/api';
import { rememberedOrders, useApp } from '../lib/app-state';
import { NETWORK_META, dataSize, dateOnly, dateTime, ghs, timeAgo } from '../lib/format';
import { Link, navigate, useLocation, usePageTitle } from '../lib/router';
import { SiteLayout } from '../components/layout';
import { Alert, CopyButton, Empty, Field, Input, Loading, NetworkBadge, Select, Spinner, StatusPill, errMsg, fieldErr } from '../components/ui';
import { IcBookmark, IcChat, IcList, IcPhone, IcPlus, IcTrash, IcWifi } from '../components/icons';

const TABS = [
  { to: '/account', label: 'Overview' },
  { to: '/account/orders', label: 'Orders' },
  { to: '/account/recipients', label: 'Saved numbers' },
  { to: '/account/tickets', label: 'Support tickets' },
  { to: '/account/profile', label: 'Profile & security' },
];

function AccountShell({ children, title }: { children: ReactNode; title: string }) {
  usePageTitle(title);
  const { user, userLoaded, config, logout } = useApp();
  const { path } = useLocation();
  useEffect(() => { if (userLoaded && !user) navigate(`/login?next=${encodeURIComponent(path)}`, { replace: true }); }, [user, userLoaded, path]);
  if (!user) return <SiteLayout><Loading /></SiteLayout>;
  const tabs = config?.agentsEnabled ? [...TABS.slice(0, 4), { to: '/account/agent', label: 'Agent earnings' }, TABS[4]] : TABS;
  return (
    <SiteLayout>
      <div className="container account-layout">
        <aside>
          <div style={{ marginBottom: 12 }}><div style={{ fontWeight: 800, fontSize: '1.15rem' }}>Hello, {user.fullName.split(' ')[0]} 👋</div><div className="small muted">{user.email}</div></div>
          <nav className="side-nav" aria-label="Account">{tabs.map((t) => <Link key={t.to} to={t.to} className={path === t.to || (t.to !== '/account' && path.startsWith(t.to)) ? 'active' : ''}>{t.label}</Link>)}</nav>
          <button className="btn btn-ghost btn-sm" style={{ marginTop: 10 }} onClick={async () => { await logout(); navigate('/'); }}>Log out</button>
        </aside>
        <section style={{ minWidth: 0 }}>{children}</section>
      </div>
    </SiteLayout>
  );
}

interface OrderRow { reference: string; status: string; statusLabel: string; kind: string; network: string; product: any; recipientPhone: string; totalMinor: number; faceValueMinor: number | null; createdAt: string; isTest: boolean }
const productText = (o: { kind: string; product: any; faceValueMinor: number | null }) => o.kind === 'data' ? `${o.product?.data_mb ? dataSize(o.product.data_mb) : o.product?.name} data` : `${ghs(o.faceValueMinor)} airtime`;

function OrderList({ orders }: { orders: OrderRow[] }) {
  return (
    <div>
      {orders.map((o) => (
        <Link key={o.reference} to={`/order/${o.reference}`} className="list-row">
          <NetworkBadge code={o.network} size="sm" />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700 }}>{productText(o)} → {o.recipientPhone} {o.isTest && <span className="tag-test">TEST</span>}</div>
            <div className="tiny muted">{o.reference} · {dateTime(o.createdAt)}</div>
          </div>
          <div style={{ textAlign: 'right' }}><div style={{ fontWeight: 800 }}>{ghs(o.totalMinor)}</div><StatusPill status={o.status} label={o.statusLabel} /></div>
        </Link>
      ))}
    </div>
  );
}

export function AccountHome() {
  const [orders, setOrders] = useState<OrderRow[] | null>(null);
  const [notes, setNotes] = useState<any[]>([]);
  useEffect(() => {
    get('/api/account/orders?pageSize=5').then((r) => setOrders(r.orders)).catch(() => setOrders([]));
    get('/api/account/notifications').then((r) => setNotes(r.notifications)).catch(() => {});
  }, []);
  const unread = notes.filter((n) => !n.read_at);
  return (
    <AccountShell title="My account">
      <div className="quick-grid" style={{ marginBottom: 18 }}>
        <Link to="/airtime" className="quick"><div className="qi"><IcPhone /></div>Airtime</Link>
        <Link to="/data-bundles" className="quick"><div className="qi"><IcWifi /></div>Data Bundles</Link>
        <Link to="/account/orders" className="quick"><div className="qi" style={{ background: '#EDE7FF' }}><IcList /></div>My Orders</Link>
        <Link to="/account/recipients" className="quick"><div className="qi" style={{ background: '#FFE3CF' }}><IcBookmark /></div>Saved Numbers</Link>
      </div>
      {unread.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="row between"><h3 style={{ margin: 0 }}>Updates</h3><button className="link" onClick={async () => { await post('/api/account/notifications/read'); setNotes(notes.map((n) => ({ ...n, read_at: new Date().toISOString() }))); }}>Mark all read</button></div>
          <ul className="event-list">{unread.slice(0, 5).map((n) => <li key={n.id}><b>{n.title}</b><div className="small muted">{n.body}</div><div className="tiny muted">{timeAgo(n.created_at)}</div></li>)}</ul>
        </div>
      )}
      <div className="card">
        <div className="row between"><h3 style={{ margin: 0 }}>Recent orders</h3><Link to="/account/orders" className="link small">View all</Link></div>
        {orders === null ? <Loading /> : orders.length ? <OrderList orders={orders} /> : <Empty icon={<IcList />} title="No orders yet">Your purchases will appear here. <Link to="/" className="link">Buy now</Link></Empty>}
      </div>
    </AccountShell>
  );
}

export function AccountOrders() {
  const [data, setData] = useState<{ orders: OrderRow[]; total: number; pageSize: number } | null>(null);
  const [pg, setPg] = useState(1);
  useEffect(() => { get(`/api/account/orders?page=${pg}`).then(setData).catch(() => setData({ orders: [], total: 0, pageSize: 20 })); }, [pg]);
  const guest = rememberedOrders();
  return (
    <AccountShell title="My orders">
      <h2>Orders</h2>
      <div className="card">
        {!data ? <Loading /> : data.orders.length ? <OrderList orders={data.orders} /> : <Empty icon={<IcList />} title="No orders on this account yet" />}
        {data && data.total > data.pageSize && (
          <div className="row between" style={{ marginTop: 12 }}>
            <button className="btn btn-light btn-sm" disabled={pg <= 1} onClick={() => setPg(pg - 1)}>Previous</button>
            <span className="small muted">Page {pg} of {Math.ceil(data.total / data.pageSize)}</span>
            <button className="btn btn-light btn-sm" disabled={pg * data.pageSize >= data.total} onClick={() => setPg(pg + 1)}>Next</button>
          </div>
        )}
      </div>
      {guest.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <h3>Orders made on this device</h3>
          <p className="small muted">Orders you placed without logging in.</p>
          {guest.map((g) => <Link key={g.r} to={`/order/${g.r}?t=${g.t}`} className="list-row"><span className="mono" style={{ fontWeight: 700 }}>{g.r}</span><span className="small muted" style={{ marginLeft: 'auto' }}>{dateOnly(new Date(g.at))}</span></Link>)}
        </div>
      )}
    </AccountShell>
  );
}

export function GuestOrdersPage() {
  usePageTitle('Track an order');
  const guest = rememberedOrders();
  return (
    <SiteLayout>
      <div className="container" style={{ maxWidth: 560, padding: '24px 16px 48px' }}>
        <h1 style={{ fontSize: '1.8rem' }}>Track an order</h1>
        <p className="muted">Log in to see all your orders, or open one you placed on this phone.</p>
        <div className="row" style={{ marginBottom: 16 }}><Link to="/login?next=/account/orders" className="btn btn-dark">Log in</Link><Link to="/register" className="btn btn-outline">Create account</Link></div>
        {guest.length > 0 ? (
          <div className="card"><h3>Orders on this device</h3>{guest.map((g) => <Link key={g.r} to={`/order/${g.r}?t=${g.t}`} className="list-row"><span className="mono" style={{ fontWeight: 700 }}>{g.r}</span><span className="small muted" style={{ marginLeft: 'auto' }}>{dateOnly(new Date(g.at))}</span></Link>)}</div>
        ) : <div className="card-soft small">No orders were placed on this device. Use the link in your receipt email, or <Link to="/support#contact" className="link">contact support</Link> with your order reference.</div>}
      </div>
    </SiteLayout>
  );
}

export function AccountRecipients() {
  const { config } = useApp();
  const [list, setList] = useState<any[] | null>(null);
  const [f, setF] = useState({ label: '', phone: '', network: '' });
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const load = () => get('/api/account/recipients').then((r) => setList(r.recipients)).catch(() => setList([]));
  useEffect(() => { load(); }, []);
  const add = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try { await post('/api/account/recipients', { label: f.label, phone: f.phone, network: f.network || null }); setF({ label: '', phone: '', network: '' }); load(); } catch (e2) { setErr(e2); } finally { setBusy(false); }
  };
  return (
    <AccountShell title="Saved numbers">
      <h2>Saved numbers</h2>
      <p className="muted small">Save numbers you top up often. They appear as one-tap choices when you buy.</p>
      <form className="card" onSubmit={add} noValidate style={{ marginBottom: 16 }}>
        <div className="grid-3">
          <Field label="Name" error={fieldErr(err, 'label')}><Input placeholder="e.g. Mum" value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} /></Field>
          <Field label="Phone" error={fieldErr(err, 'phone')}><Input inputMode="tel" placeholder="0241234567" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
          <Field label="Network (optional)"><Select value={f.network} onChange={(e) => setF({ ...f, network: e.target.value })}><option value="">Not set</option>{config?.networks.map((n) => <option key={n.code} value={n.code}>{NETWORK_META[n.code]?.name}</option>)}</Select></Field>
        </div>
        {err && !fieldErr(err, 'phone') && !fieldErr(err, 'label') ? <div style={{ marginBottom: 12 }}><Alert>{errMsg(err)}</Alert></div> : null}
        <button className="btn btn-dark" disabled={busy}><IcPlus width={18} height={18} />Save number</button>
      </form>
      <div className="card">
        {list === null ? <Loading /> : list.length === 0 ? <Empty icon={<IcBookmark />} title="No saved numbers yet" /> : list.map((r) => (
          <div key={r.id} className="list-row">
            {r.network ? <NetworkBadge code={r.network} size="sm" /> : <span className="net-badge sm" style={{ background: 'var(--soft)' }}>?</span>}
            <div style={{ flex: 1 }}><b>{r.label}</b><div className="small muted">{r.phone}</div></div>
            <Link to={`/data-bundles${r.network ? `?network=${r.network}` : ''}`} className="btn btn-yellow btn-sm">Buy</Link>
            <button className="icon-btn" aria-label={`Delete ${r.label}`} onClick={async () => { if (confirm(`Remove ${r.label}?`)) { await del(`/api/account/recipients/${r.id}`); load(); } }}><IcTrash width={18} height={18} /></button>
          </div>
        ))}
      </div>
    </AccountShell>
  );
}

export function AccountTickets() {
  const [list, setList] = useState<any[] | null>(null);
  useEffect(() => { get('/api/account/tickets').then((r) => setList(r.tickets)).catch(() => setList([])); }, []);
  return (
    <AccountShell title="Support tickets">
      <div className="row between"><h2 style={{ margin: 0 }}>Support tickets</h2><Link to="/support#contact" className="btn btn-dark btn-sm">New request</Link></div>
      <div className="card" style={{ marginTop: 14 }}>
        {list === null ? <Loading /> : list.length === 0 ? <Empty icon={<IcChat />} title="No support requests" /> : list.map((t) => (
          <Link key={t.reference} to={`/ticket/${t.reference}`} className="list-row">
            <div style={{ flex: 1, minWidth: 0 }}><b>{t.subject}</b><div className="tiny muted">{t.reference} · updated {timeAgo(t.updated_at)}{t.last_author === 'admin' ? ' · new reply' : ''}</div></div>
            <StatusPill status={t.status} />
          </Link>
        ))}
      </div>
    </AccountShell>
  );
}

export function AccountProfile() {
  const { user, refreshUser } = useApp();
  const [f, setF] = useState({ full_name: user?.fullName || '', email: user?.email || '', phone: user?.phone || '', current_password: '' });
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [pw, setPw] = useState({ current_password: '', new_password: '' });
  const [pwMsg, setPwMsg] = useState<string | null>(null);
  const [pwErr, setPwErr] = useState<unknown>(null);
  const [sessions, setSessions] = useState<any[]>([]);
  const loadSessions = () => get('/api/account/sessions').then((r) => setSessions(r.sessions)).catch(() => {});
  useEffect(() => { loadSessions(); }, []);
  const emailChanged = f.email.trim().toLowerCase() !== (user?.email || '');
  return (
    <AccountShell title="Profile & security">
      <h2>Profile</h2>
      <form className="card" style={{ marginBottom: 16 }} noValidate onSubmit={async (e) => {
        e.preventDefault(); setMsg(null); setErr(null);
        try { await patch('/api/account/profile', { ...f, current_password: f.current_password || undefined }); await refreshUser(); setMsg('Profile saved'); setF({ ...f, current_password: '' }); } catch (e2) { setErr(e2); }
      }}>
        <div className="grid-2">
          <Field label="Full name" error={fieldErr(err, 'full_name')}><Input value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} /></Field>
          <Field label="Phone" error={fieldErr(err, 'phone')}><Input inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
          <Field label="Email" error={fieldErr(err, 'email')}><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
          {emailChanged && <Field label="Current password (to change email)"><Input type="password" autoComplete="current-password" value={f.current_password} onChange={(e) => setF({ ...f, current_password: e.target.value })} /></Field>}
        </div>
        {msg && <div style={{ marginBottom: 12 }}><Alert kind="success">{msg}</Alert></div>}
        {err ? <div style={{ marginBottom: 12 }}><Alert>{errMsg(err)}</Alert></div> : null}
        <button className="btn btn-dark">Save profile</button>
      </form>

      <h2>Password</h2>
      <form className="card" style={{ marginBottom: 16 }} noValidate onSubmit={async (e) => {
        e.preventDefault(); setPwMsg(null); setPwErr(null);
        try { await post('/api/account/password', pw); setPwMsg('Password changed. Other devices were signed out.'); setPw({ current_password: '', new_password: '' }); loadSessions(); } catch (e2) { setPwErr(e2); }
      }}>
        <div className="grid-2">
          <Field label="Current password"><Input type="password" autoComplete="current-password" value={pw.current_password} onChange={(e) => setPw({ ...pw, current_password: e.target.value })} /></Field>
          <Field label="New password" error={fieldErr(pwErr, 'new_password')} hint="At least 8 characters, with letters and a number"><Input type="password" autoComplete="new-password" value={pw.new_password} onChange={(e) => setPw({ ...pw, new_password: e.target.value })} /></Field>
        </div>
        {pwMsg && <div style={{ marginBottom: 12 }}><Alert kind="success">{pwMsg}</Alert></div>}
        {pwErr && !fieldErr(pwErr, 'new_password') ? <div style={{ marginBottom: 12 }}><Alert>{errMsg(pwErr)}</Alert></div> : null}
        <button className="btn btn-dark">Change password</button>
      </form>

      <h2>Signed-in devices</h2>
      <div className="card">
        {sessions.map((s) => <div key={s.id} className="list-row"><div style={{ flex: 1, minWidth: 0 }}><b>{deviceName(s.user_agent)}</b> {s.current && <span className="pill pill-success">This device</span>}<div className="tiny muted">Last active {timeAgo(s.last_seen_at)}</div></div></div>)}
        {sessions.length > 1 && <button className="btn btn-light btn-sm" style={{ marginTop: 10 }} onClick={async () => { await post('/api/account/sessions/revoke-others'); loadSessions(); }}>Sign out all other devices</button>}
      </div>
    </AccountShell>
  );
}
function deviceName(ua: string | null) {
  if (!ua) return 'Unknown device';
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iPhone/iPad' : /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'Device';
  const br = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  return `${br} on ${os}`;
}

export function AccountAgent() {
  const [data, setData] = useState<any>(null);
  const [amt, setAmt] = useState('');
  const [momo, setMomo] = useState('');
  const [err, setErr] = useState<unknown>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const load = () => get('/api/account/agent').then(setData).catch(() => setData({ enabled: false, agent: null }));
  useEffect(() => { load(); }, []);
  const link = data?.agent ? `${location.origin}/?ref=${data.agent.referralCode}` : '';
  return (
    <AccountShell title="Agent earnings">
      <h2>Agent programme</h2>
      {!data ? <Loading /> : !data.enabled ? <div className="card-soft">The agent programme isn't open yet.</div> : !data.agent ? (
        <div className="card"><p>Share your link. When people buy through it, you earn a commission on each delivered order.</p><button className="btn btn-dark" onClick={async () => { await post('/api/account/agent'); load(); }}>Become an agent</button></div>
      ) : (
        <>
          <div className="grid-3" style={{ marginBottom: 16 }}>
            <div className="card"><div className="small muted">Available balance</div><div style={{ fontSize: '1.6rem', fontWeight: 800 }}>{ghs(data.agent.balanceMinor)}</div></div>
            <div className="card"><div className="small muted">Total earned</div><div style={{ fontSize: '1.6rem', fontWeight: 800 }}>{ghs(data.agent.earnedMinor)}</div></div>
            <div className="card"><div className="small muted">Delivered sales</div><div style={{ fontSize: '1.6rem', fontWeight: 800 }}>{data.agent.sales}</div></div>
          </div>
          <div className="card" style={{ marginBottom: 16 }}>
            <b>Your referral link</b><div className="row" style={{ marginTop: 8 }}><span className="mono" style={{ wordBreak: 'break-all' }}>{link}</span><CopyButton text={link} /></div>
            <p className="tiny muted" style={{ margin: '8px 0 0' }}>Commission: {(data.agent.commissionBps / 100).toFixed(2)}% of the product price, credited when the order is delivered.</p>
          </div>
          <form className="card" noValidate onSubmit={async (e) => {
            e.preventDefault(); setErr(null); setMsg(null);
            try { await post('/api/account/agent/withdraw', { amount_minor: Math.round(Number(amt) * 100), momo_number: momo }); setMsg('Withdrawal requested. Our team will pay it to your Mobile Money.'); setAmt(''); load(); } catch (e2) { setErr(e2); }
          }}>
            <b>Withdraw to Mobile Money</b>
            <div className="grid-2" style={{ marginTop: 10 }}>
              <Field label="Amount (GHS)" hint={`Minimum ${ghs(data.agent.minWithdrawalMinor)}`}><Input inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value)} /></Field>
              <Field label="Mobile Money number" error={fieldErr(err, 'momo_number')}><Input inputMode="tel" value={momo} onChange={(e) => setMomo(e.target.value)} /></Field>
            </div>
            {msg && <div style={{ marginBottom: 12 }}><Alert kind="success">{msg}</Alert></div>}
            {err && !fieldErr(err, 'momo_number') ? <div style={{ marginBottom: 12 }}><Alert>{errMsg(err)}</Alert></div> : null}
            <button className="btn btn-dark">Request withdrawal</button>
            {data.agent.withdrawals.length > 0 && <ul className="event-list" style={{ marginTop: 12 }}>{data.agent.withdrawals.map((w: any) => <li key={w.id} className="row between"><span>{ghs(w.amount_minor)} to {w.momo_number} · {dateOnly(w.created_at)}</span><StatusPill status={w.status} /></li>)}</ul>}
          </form>
        </>
      )}
    </AccountShell>
  );
}

