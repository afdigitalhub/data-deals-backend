import { useEffect, useState, type ReactNode } from 'react';
import { useApp } from '../lib/app-state';
import { get } from '../lib/api';
import { NETWORK_META, dateTime, ghs } from '../lib/format';
import { Link, match, navigate, useLocation, usePageTitle } from '../lib/router';
import { Alert, Loading, NetworkBadge, StatusPill } from '../components/ui';
import { Bolt, IcBox, IcCart, IcChart, IcCheckCircle, IcClock, IcFile, IcHome, IcLife, IcLogout, IcMenu, IcPlug, IcRefund, IcSettings, IcShare, IcUsers, IcAlert, IcChat } from '../components/icons';
import { AreaChart, Panel, fillDays, isoDay, useLoad } from './common';
import { OrdersPage, OrderDetailPage } from './orders';
import { LiveChatPage, TeamChatPage } from './chat';
import { ProductsPage, SuppliersPage } from './catalog';
import { CustomersPage, CustomerDetailPage, TicketsPage, TicketDetailPage, TeamPage, AgentsPage } from './people';
import { PaymentsPage, SettingsPage, AuditPage } from './system';

const NAV: { to: string; label: string; icon: ReactNode; perm: string; group?: string }[] = [
  { to: '/admin', label: 'Dashboard', icon: <IcHome />, perm: 'orders.view' },
  { to: '/admin/orders', label: 'Orders', icon: <IcCart />, perm: 'orders.view' },
  { to: '/admin/queue', label: 'Manual delivery', icon: <IcClock />, perm: 'orders.view' },
  { to: '/admin/review', label: 'Needs review', icon: <IcAlert />, perm: 'orders.view' },
  { to: '/admin/customers', label: 'Customers', icon: <IcUsers />, perm: 'customers.view' },
  { to: '/admin/products', label: 'Products', icon: <IcBox />, perm: 'orders.view', group: 'Catalogue' },
  { to: '/admin/suppliers', label: 'Suppliers & networks', icon: <IcPlug />, perm: 'orders.view' },
  { to: '/admin/payments', label: 'Payments & refunds', icon: <IcRefund />, perm: 'payments.view', group: 'Money' },
  { to: '/admin/reports', label: 'Reports', icon: <IcChart />, perm: 'analytics.view' },
  { to: '/admin/agents', label: 'Agents', icon: <IcShare />, perm: 'agents.manage' },
  { to: '/admin/chat', label: 'Live chat', icon: <IcChat />, perm: 'support.reply', group: 'Operations' },
  { to: '/admin/team-chat', label: 'Team chat', icon: <IcUsers />, perm: 'orders.view' },
  { to: '/admin/support', label: 'Support tickets', icon: <IcLife />, perm: 'support.reply' },
  { to: '/admin/team', label: 'Team', icon: <IcUsers />, perm: 'team.manage' },
  { to: '/admin/audit', label: 'Audit log', icon: <IcFile />, perm: 'audit.view' },
  { to: '/admin/settings', label: 'Settings', icon: <IcSettings />, perm: 'orders.view' },
];

export default function AdminApp() {
  const { user, userLoaded, logout } = useApp();
  const { path } = useLocation();
  const [open, setOpen] = useState(false);
  const counts = useLoad<any>(user && user.role !== 'customer' ? '/api/admin/overview?from=' + isoDay(new Date(Date.now() - 86400000)) : null, [path]);
  useEffect(() => setOpen(false), [path]);
  const [unread, setUnread] = useState<{ support: number; team: number }>({ support: 0, team: 0 });
  useEffect(() => {
    if (!user || user.role === 'customer') return;
    const tick = () => { if (document.visibilityState === 'visible') get('/api/admin/chat-unread').then(setUnread).catch(() => {}); };
    tick(); const t = setInterval(tick, 12000); return () => clearInterval(t);
  }, [user?.id, path]);
  useEffect(() => { if (userLoaded && !user) navigate(`/login?next=${encodeURIComponent(path)}`, { replace: true }); }, [userLoaded, user, path]);
  if (!userLoaded || !user) return <Loading text="Checking your access…" />;
  if (user.role === 'customer') return <div className="container section"><Alert>This area is for Data Glow administrators only.</Alert><Link to="/" className="btn btn-dark" style={{ marginTop: 12 }}>Back to the website</Link></div>;
  const can = (p: string) => user.permissions.includes(p);
  const q = counts.data?.queue;

  let page: ReactNode = <div className="panel">Page not found.</div>;
  const m = (p: string) => match(p, path);
  if (path === '/admin') page = can('analytics.view') ? <Dashboard /> : <OrdersPage />;
  else if (path === '/admin/orders') page = <OrdersPage />;
  else if (path === '/admin/queue') page = <OrdersPage queue="manual" />;
  else if (path === '/admin/review') page = <OrdersPage queue="review" />;
  else if (m('/admin/orders/:ref')) page = <OrderDetailPage reference={m('/admin/orders/:ref')!.ref} />;
  else if (path === '/admin/products') page = <ProductsPage />;
  else if (path === '/admin/suppliers') page = <SuppliersPage />;
  else if (path === '/admin/payments') page = <PaymentsPage />;
  else if (path === '/admin/reports') page = <Dashboard reports />;
  else if (path === '/admin/customers') page = <CustomersPage />;
  else if (m('/admin/customers/:id')) page = <CustomerDetailPage id={m('/admin/customers/:id')!.id} />;
  else if (path === '/admin/chat') page = <LiveChatPage />;
  else if (m('/admin/chat/:id')) page = <LiveChatPage id={m('/admin/chat/:id')!.id} />;
  else if (path === '/admin/team-chat') page = <TeamChatPage />;
  else if (path === '/admin/support') page = <TicketsPage />;
  else if (m('/admin/support/:ref')) page = <TicketDetailPage reference={m('/admin/support/:ref')!.ref} />;
  else if (path === '/admin/team') page = <TeamPage />;
  else if (path === '/admin/agents') page = <AgentsPage />;
  else if (path === '/admin/audit') page = <AuditPage />;
  else if (path === '/admin/settings') page = <SettingsPage />;

  const badge = (to: string) => {
    if (to === '/admin/queue' && q?.manual_queue) return <span className="badge-count cnt">{q.manual_queue}</span>;
    if (to === '/admin/review' && q?.reviews) return <span className="badge-count cnt">{q.reviews}</span>;
    if (to === '/admin/chat' && unread.support) return <span className="badge-count cnt">{unread.support}</span>;
    if (to === '/admin/team-chat' && unread.team) return <span className="badge-count cnt">{unread.team}</span>;
    if (to === '/admin/support' && counts.data?.openTickets) return <span className="badge-count cnt">{counts.data.openTickets}</span>;
    return null;
  };
  return (
    <div className="admin">
      <header className="admin-top">
        <button className="icon-btn admin-menu-btn" aria-label="Menu" onClick={() => setOpen(!open)}><IcMenu /></button>
        <Link to="/admin" className="logo"><Bolt style={{ color: '#FF5FA2', width: 24, height: 28 }} /><span>Data <span className="deals">Deals</span></span></Link>
        <div className="admin-user">
          <div className="desktop-only" style={{ flexDirection: 'column', alignItems: 'flex-end', lineHeight: 1.2 }}><b>{user.fullName}</b><span style={{ color: '#9FA2A8', textTransform: 'capitalize' }}>{user.role}</span></div>
          <div className="avatar">{user.fullName.split(' ').map((s) => s[0]).slice(0, 2).join('').toUpperCase()}</div>
          <button className="icon-btn" aria-label="Log out" title="Log out" onClick={async () => { await logout(); navigate('/login'); }}><IcLogout /></button>
        </div>
      </header>
      <div className="admin-body">
        {open && <div className="side-backdrop" onClick={() => setOpen(false)} />}
        <nav className={`admin-side ${open ? 'open' : ''}`} aria-label="Admin">
          {NAV.filter((n) => can(n.perm)).map((n) => (
            <div key={n.to}>
              {n.group && <div className="grp">{n.group}</div>}
              <Link to={n.to} className={path === n.to || (n.to !== '/admin' && path.startsWith(n.to + '/')) ? 'active' : ''}>{n.icon}{n.label}{badge(n.to)}</Link>
            </div>
          ))}
          <div className="grp">Website</div>
          <Link to="/"><IcHome />Open website</Link>
        </nav>
        <main className="admin-main">{page}</main>
      </div>
    </div>
  );
}

function Dashboard({ reports = false }: { reports?: boolean }) {
  usePageTitle(reports ? 'Reports' : 'Dashboard');
  const [range, setRange] = useState<'1' | '7' | '30' | '90'>(reports ? '30' : '30');
  const [includeTest, setIncludeTest] = useState(false);
  const to = new Date();
  const from = new Date(Date.now() - (Number(range) - 1) * 86400000);
  const { data, error, loading } = useLoad<any>(`/api/admin/overview?from=${isoDay(from)}&to=${isoDay(to)}${includeTest ? '&test=1' : ''}`);
  const t = data?.totals;
  const successRate = t && t.orders ? Math.round((t.successful / Math.max(1, t.successful + t.failed + t.needs_review + t.pending_delivery)) * 100) : null;
  return (
    <>
      <div className="admin-head">
        <h1>{reports ? 'Reports' : 'Dashboard'}</h1>
        <div className="row">
          <label className="check small"><input type="checkbox" checked={includeTest} onChange={(e) => setIncludeTest(e.target.checked)} />Include test orders</label>
          <div className="seg">{(['1', '7', '30', '90'] as const).map((r) => <button key={r} className={range === r ? 'active' : ''} onClick={() => setRange(r)}>{r === '1' ? 'Today' : `${r} days`}</button>)}</div>
        </div>
      </div>
      {error && <Alert>{error}</Alert>}
      {!data ? <Loading /> : (
        <>
          {(data.queue.manual_queue > 0 || data.queue.reviews > 0 || data.queue.escalated > 0) && (
            <div className="row" style={{ marginBottom: 14 }}>
              {data.queue.manual_queue > 0 && <Link to="/admin/queue" className="btn btn-yellow btn-sm">{data.queue.manual_queue} order{data.queue.manual_queue > 1 ? 's' : ''} waiting for manual delivery</Link>}
              {data.queue.reviews > 0 && <Link to="/admin/review" className="btn btn-dark btn-sm">{data.queue.reviews} need{data.queue.reviews > 1 ? '' : 's'} review</Link>}
              {data.queue.escalated > 0 && <Link to="/admin/orders?queue=escalated" className="btn btn-light btn-sm">{data.queue.escalated} escalated</Link>}
            </div>
          )}
          <div className="kpis" style={{ opacity: loading ? 0.6 : 1 }}>
            <Kpi label="Total orders" value={t.orders.toLocaleString()} sub={`${t.awaiting_payment} awaiting payment`} icon={<IcCart />} tint="#E8F0FE" />
            <Kpi label="Gross sales" value={ghs(t.gross_sales)} sub={`Refunded ${ghs(data.refunds.refunded)}`} icon={<IcChart />} tint="#E6F5EC" />
            <Kpi label="Delivered" value={t.successful.toLocaleString()} sub={successRate !== null ? `${successRate}% of paid orders` : '—'} icon={<IcCheckCircle />} tint="#E6F5EC" subColor="var(--success)" />
            <Kpi label="Pending / failed" value={`${t.pending_delivery + t.needs_review} / ${t.failed}`} sub={`${t.needs_review} need review`} icon={<IcClock />} tint="#FFF1DC" subColor="var(--warn)" />
          </div>
          <div className="kpis">
            <Kpi label="Delivered sales" value={ghs(t.delivered_sales)} sub="Revenue from delivered orders" />
            <Kpi label="Supplier cost" value={ghs(t.supplier_cost)} sub={t.successful_without_cost ? `${t.successful_without_cost} delivered order(s) have no cost recorded` : 'All delivered orders costed'} subColor={t.successful_without_cost ? 'var(--warn)' : undefined} />
            <Kpi label="Gross margin" value={ghs(t.gross_margin)} sub="Delivered orders with known cost" />
            <Kpi label="Payment fees" value={ghs(data.fees.payment_fees)} sub="Reported by Paystack" />
          </div>
          <Panel title="Sales overview">
            <AreaChart points={fillDays(from, to, data.trend)} />
          </Panel>
          <div className="grid-2" style={{ gap: 16 }}>
            <Panel title="Sales by network">
              {data.byNetwork.length === 0 ? <div className="small muted">No paid orders in this period.</div> : data.byNetwork.map((n: any) => {
                const max = Math.max(...data.byNetwork.map((x: any) => x.sales), 1);
                return <div key={n.network} style={{ marginBottom: 12 }}><div className="row between small" style={{ marginBottom: 4 }}><span className="row" style={{ gap: 8 }}><NetworkBadge code={n.network} size="sm" /><b>{NETWORK_META[n.network]?.name}</b> · {n.orders} orders</span><b>{ghs(n.sales)}</b></div><div className="bar"><i style={{ width: `${(n.sales / max) * 100}%` }} /></div></div>;
              })}
            </Panel>
            <Panel title="Top products">
              {data.byProduct.length === 0 ? <div className="small muted">No paid orders in this period.</div> : (
                <table className="table"><tbody>{data.byProduct.map((p: any, i: number) => <tr key={i}><td><b>{p.product}</b> <span className="muted small">{NETWORK_META[p.network]?.name}</span></td><td className="num">{p.orders}</td><td className="num"><b>{ghs(p.sales)}</b></td></tr>)}</tbody></table>
              )}
            </Panel>
          </div>
          {!reports && (
            <Panel title="Recent orders" action={<Link to="/admin/orders" className="link-amber small">View all</Link>}>
              {data.recent.length === 0 ? <div className="empty small">No orders yet. They'll appear here as soon as customers start buying.</div> : (
                <div className="table-wrap" style={{ border: 0 }}><table className="table">
                  <thead><tr><th>Reference</th><th>Recipient</th><th>Network</th><th>Product</th><th className="num">Amount</th><th>Status</th></tr></thead>
                  <tbody>{data.recent.map((o: any) => <tr key={o.reference} className="clickable" onClick={() => navigate(`/admin/orders/${o.reference}`)}><td className="mono">{o.reference} {o.isTest && <span className="tag-test">TEST</span>}</td><td>{o.recipientPhone}</td><td>{NETWORK_META[o.network]?.name}</td><td>{o.product}</td><td className="num">{ghs(o.totalMinor)}</td><td><StatusPill status={o.status} /></td></tr>)}</tbody>
                </table></div>
              )}
            </Panel>
          )}
          <p className="tiny muted">All figures come from real orders in the database{includeTest ? ', including test orders' : ' (test orders excluded)'}. Updated {dateTime(new Date())}.</p>
        </>
      )}
    </>
  );
}

function Kpi({ label, value, sub, icon, tint, subColor }: { label: string; value: string; sub?: string; icon?: ReactNode; tint?: string; subColor?: string }) {
  return (
    <div className="kpi">
      {icon && <div className="k-ic" style={{ background: tint }}>{icon}</div>}
      <div className="k-label">{label}</div>
      <div className="k-value">{value}</div>
      {sub && <div className="k-sub" style={{ color: subColor || 'var(--muted)' }}>{sub}</div>}
    </div>
  );
}
