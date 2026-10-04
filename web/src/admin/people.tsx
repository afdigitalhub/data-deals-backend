import { useState } from 'react';
import { post } from '../lib/api';
import { useApp } from '../lib/app-state';
import { dateTime, ghs, timeAgo } from '../lib/format';
import { Link, navigate, usePageTitle } from '../lib/router';
import { Alert, CopyButton, Field, Input, Loading, Modal, Select, Spinner, StatusPill, Textarea, errMsg } from '../components/ui';
import { IcBack } from '../components/icons';
import { Pager, Panel, useLoad } from './common';
import { ReasonAction } from './orders';

export function CustomersPage() {
  usePageTitle('Customers');
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [page, setPage] = useState(1);
  const { data, error } = useLoad<any>(`/api/admin/customers?page=${page}${term ? `&q=${encodeURIComponent(term)}` : ''}`);
  return (
    <>
      <div className="admin-head"><h1>Customers</h1></div>
      <form className="toolbar" onSubmit={(e) => { e.preventDefault(); setTerm(q.trim()); setPage(1); }}><input className="input" placeholder="Search name, email or phone" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search customers" /><button className="btn btn-dark btn-sm">Search</button></form>
      {error && <Alert>{error}</Alert>}
      {!data ? <Loading /> : data.customers.length === 0 ? <div className="panel empty">No customers yet.</div> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Name</th><th>Email</th><th>Phone</th><th className="num">Paid orders</th><th className="num">Delivered spend</th><th>Status</th><th>Joined</th></tr></thead>
          <tbody>{data.customers.map((c: any) => <tr key={c.id} className="clickable" onClick={() => navigate(`/admin/customers/${c.id}`)}><td><b>{c.full_name}</b></td><td>{c.email}</td><td>{c.phone}</td><td className="num">{c.paid_orders}</td><td className="num">{ghs(c.spent)}</td><td><StatusPill status={c.status} /></td><td className="small">{dateTime(c.created_at)}</td></tr>)}</tbody>
        </table></div>
      )}
      {data && <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
    </>
  );
}

export function CustomerDetailPage({ id }: { id: string }) {
  usePageTitle('Customer');
  const { user } = useApp();
  const canRestrict = !!user?.permissions.includes('customers.restrict');
  const { data, error, reload } = useLoad<any>(`/api/admin/customers/${id}`);
  const [act, setAct] = useState<null | 'restrict'>(null);
  const [link, setLink] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  if (error) return <Alert>{error}</Alert>;
  if (!data) return <Loading />;
  const c = data.customer;
  return (
    <>
      <button className="btn btn-ghost btn-sm" onClick={() => navigate('/admin/customers')} style={{ paddingLeft: 0 }}><IcBack width={18} height={18} />Customers</button>
      <div className="admin-head"><div><h1>{c.full_name}</h1><div className="row small" style={{ gap: 8, marginTop: 4 }}><StatusPill status={c.status} /><span className="muted">Joined {dateTime(c.created_at)} · last login {c.last_login_at ? timeAgo(c.last_login_at) : 'never'}</span></div></div>
        {canRestrict && <div className="row">
          {c.status === 'active' ? <button className="btn btn-light btn-sm" onClick={() => setAct('restrict')}>Restrict account</button> : <button className="btn btn-dark btn-sm" onClick={async () => { try { await post(`/api/admin/customers/${id}/restore`); setMsg('Account restored'); reload(); } catch (e) { setMsg(errMsg(e)); } }}>Restore account</button>}
          <button className="btn btn-light btn-sm" onClick={async () => { try { const r = await post(`/api/admin/customers/${id}/reset-link`); setLink(r.link); } catch (e) { setMsg(errMsg(e)); } }}>Create password reset link</button>
        </div>}
      </div>
      {msg && <div style={{ marginBottom: 12 }}><Alert kind="info">{msg}</Alert></div>}
      {c.status === 'restricted' && <div style={{ marginBottom: 12 }}><Alert kind="warn">Restricted: {c.restricted_reason}</Alert></div>}
      {link && <div style={{ marginBottom: 12 }}><Alert kind="info"><b>One-time reset link (valid 24 hours).</b> Send it only to the customer, privately — it lets whoever opens it set a new password.<div className="row" style={{ marginTop: 8 }}><span className="mono tiny" style={{ wordBreak: 'break-all' }}>{link}</span><CopyButton text={link} /></div></Alert></div>}
      <div className="grid-2" style={{ gap: 16, alignItems: 'start' }}>
        <Panel title="Details"><dl className="kv"><dt>Email</dt><dd>{c.email}</dd><dt>Phone</dt><dd>{c.phone || '—'}</dd><dt>Role</dt><dd style={{ textTransform: 'capitalize' }}>{c.role}</dd></dl></Panel>
        <Panel title="Admin actions on this account">{data.actions.length === 0 ? <div className="small muted">None.</div> : <ul className="event-list">{data.actions.map((a: any, i: number) => <li key={i}><b>{a.action}</b> by {a.actor || 'system'} <span className="tiny muted">· {dateTime(a.created_at)}</span>{a.after_data?.reason && <div className="tiny muted">{a.after_data.reason}</div>}</li>)}</ul>}</Panel>
      </div>
      <Panel title="Orders">
        {data.orders.length === 0 ? <div className="small muted">No orders.</div> : (
          <div className="table-wrap" style={{ border: 0 }}><table className="table"><thead><tr><th>Reference</th><th>Recipient</th><th>Product</th><th className="num">Amount</th><th>Status</th><th>Date</th></tr></thead>
            <tbody>{data.orders.map((o: any) => <tr key={o.reference} className="clickable" onClick={() => navigate(`/admin/orders/${o.reference}`)}><td className="mono">{o.reference}</td><td>{o.recipientPhone}</td><td>{o.product}</td><td className="num">{ghs(o.totalMinor)}</td><td><StatusPill status={o.status} /></td><td className="small">{dateTime(o.createdAt)}</td></tr>)}</tbody></table></div>
        )}
      </Panel>
      <Panel title="Support tickets">{data.tickets.length === 0 ? <div className="small muted">None.</div> : data.tickets.map((t: any) => <Link key={t.reference} to={`/admin/support/${t.reference}`} className="list-row"><span className="mono small">{t.reference}</span><span style={{ flex: 1 }}>{t.subject}</span><StatusPill status={t.status} /></Link>)}</Panel>
      {act === 'restrict' && <ReasonAction title="Restrict this account" label="Reason (recorded permanently)" confirmLabel="Restrict and sign out" onClose={() => setAct(null)} body={<p className="small">The customer will be signed out and blocked from logging in or buying while signed in.</p>} run={(reason) => post(`/api/admin/customers/${id}/restrict`, { reason })} onDone={() => { setAct(null); setMsg('Account restricted'); reload(); }} />}
    </>
  );
}

export function TicketsPage() {
  usePageTitle('Support');
  const [status, setStatus] = useState('open');
  const { data, error } = useLoad<any>(`/api/admin/tickets${status ? `?status=${status}` : ''}`);
  return (
    <>
      <div className="admin-head"><h1>Support</h1><div className="seg">{[['open', 'Open'], ['awaiting_customer', 'Awaiting customer'], ['resolved', 'Resolved'], ['', 'All']].map(([v, l]) => <button key={v} className={status === v ? 'active' : ''} onClick={() => setStatus(v)}>{l}</button>)}</div></div>
      {error && <Alert>{error}</Alert>}
      {!data ? <Loading /> : data.tickets.length === 0 ? <div className="panel empty">No tickets here.</div> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Ticket</th><th>Subject</th><th>Category</th><th>From</th><th>Order</th><th>Status</th><th>Updated</th></tr></thead>
          <tbody>{data.tickets.map((t: any) => <tr key={t.reference} className="clickable" onClick={() => navigate(`/admin/support/${t.reference}`)}><td className="mono">{t.reference}</td><td><b>{t.subject}</b>{t.last_author === 'customer' && t.status !== 'closed' && <span className="pill pill-warn" style={{ marginLeft: 6 }}>Needs reply</span>}</td><td className="small">{t.category.replace('_', ' ')}</td><td className="small">{t.name || ''} {t.email}</td><td className="mono small">{t.order_reference || '—'}</td><td><StatusPill status={t.status} /></td><td className="small">{timeAgo(t.updated_at)}</td></tr>)}</tbody>
        </table></div>
      )}
    </>
  );
}

export function TicketDetailPage({ reference }: { reference: string }) {
  usePageTitle(`Ticket ${reference}`);
  const { data, error, reload } = useLoad<any>(`/api/admin/tickets/${reference}`);
  const [msg, setMsg] = useState('');
  const [next, setNext] = useState('awaiting_customer');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (error) return <Alert>{error}</Alert>;
  if (!data) return <Loading />;
  const t = data.ticket;
  return (
    <>
      <button className="btn btn-ghost btn-sm" onClick={() => navigate('/admin/support')} style={{ paddingLeft: 0 }}><IcBack width={18} height={18} />Support</button>
      <div className="admin-head"><div><div className="mono small muted">{t.reference}</div><h1>{t.subject}</h1><div className="row small" style={{ gap: 8, marginTop: 4 }}><StatusPill status={t.status} /><span className="muted">{t.category.replace('_', ' ')} · {t.name || ''} {t.email}{t.phone ? ` · ${t.phone}` : ''}</span></div></div>
        <div className="row">{t.order_reference && <Link to={`/admin/orders/${t.order_reference}`} className="btn btn-light btn-sm">Order {t.order_reference} ({t.order_status?.replace(/_/g, ' ')})</Link>}
          <select className="select" style={{ minHeight: 36, width: 'auto' }} value={t.status} onChange={async (e) => { await post(`/api/admin/tickets/${reference}/status`, { status: e.target.value }); reload(); }} aria-label="Change status"><option value="open">Open</option><option value="awaiting_customer">Awaiting customer</option><option value="resolved">Resolved</option><option value="closed">Closed</option></select></div>
      </div>
      <div className="stack">
        {data.messages.map((m: any, i: number) => (
          <div key={i} className="panel" style={{ margin: 0, borderLeft: m.author_type === 'admin' ? '4px solid var(--yellow)' : undefined, background: m.author_type === 'system' ? 'transparent' : undefined, border: m.author_type === 'system' ? 0 : undefined, padding: m.author_type === 'system' ? 4 : undefined }}>
            <div className="tiny muted" style={{ marginBottom: 4 }}><b>{m.author_type === 'admin' ? m.author_name || 'Admin' : m.author_type === 'customer' ? 'Customer' : 'System'}</b> · {dateTime(m.created_at)}</div>
            <div style={{ whiteSpace: 'pre-wrap' }} className={m.author_type === 'system' ? 'small muted' : ''}>{m.body}</div>
          </div>
        ))}
      </div>
      <Panel title="Reply">
        <Field label="Message to customer"><Textarea value={msg} onChange={(e) => setMsg(e.target.value)} /></Field>
        <div className="row">
          <Select value={next} onChange={(e) => setNext(e.target.value)} style={{ width: 'auto' }}><option value="awaiting_customer">Then: awaiting customer</option><option value="resolved">Then: resolved</option><option value="open">Then: keep open</option><option value="closed">Then: close</option></Select>
          <button className="btn btn-dark" disabled={busy || msg.trim().length < 2} onClick={async () => { setBusy(true); setErr(null); try { await post(`/api/admin/tickets/${reference}/reply`, { message: msg, status: next }); setMsg(''); reload(); } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); } }}>{busy ? <Spinner /> : 'Send reply'}</button>
        </div>
        {err && <div style={{ marginTop: 10 }}><Alert>{err}</Alert></div>}
        <p className="tiny muted" style={{ marginTop: 8 }}>{t.user_id ? 'The customer sees replies in their account.' : 'Guest ticket: the customer sees replies through the link they got when they opened it.'} Email notifications are sent only if email is configured in Settings.</p>
      </Panel>
    </>
  );
}

export function TeamPage() {
  usePageTitle('Team');
  const { user } = useApp();
  const { data, error, reload } = useLoad<any>('/api/admin/team');
  const [inv, setInv] = useState({ label: '', role: 'admin' });
  const [link, setLink] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  if (error) return <Alert>{error}</Alert>;
  if (!data) return <Loading />;
  return (
    <>
      <div className="admin-head"><h1>Team</h1></div>
      <Panel title="Members">
        <div className="table-wrap" style={{ border: 0 }}><table className="table"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Last login</th><th></th></tr></thead>
          <tbody>{data.members.map((m: any) => <tr key={m.id}><td><b>{m.full_name}</b></td><td>{m.email}</td><td style={{ textTransform: 'capitalize' }}>{m.role}</td><td><StatusPill status={m.status} /></td><td className="small">{m.last_login_at ? timeAgo(m.last_login_at) : 'Never'}</td>
            <td>{m.id !== user?.id && <select className="select" style={{ minHeight: 34, width: 'auto', fontSize: '.85rem' }} value={m.role} onChange={async (e) => { if (!confirm(`Change ${m.full_name}'s role to ${e.target.value}? They will be signed out.`)) return; try { await post(`/api/admin/team/${m.id}/role`, { role: e.target.value }); reload(); } catch (e2) { alert(errMsg(e2)); } }} aria-label="Role"><option value="support">Support</option><option value="admin">Admin</option><option value="owner">Owner</option><option value="customer">Remove access</option></select>}</td></tr>)}</tbody></table></div>
        <p className="tiny muted">Owners can do everything, including managing the team. Admins run daily operations (orders, products, refunds, settings). Support can view orders and answer tickets, with customer contact details partly hidden.</p>
      </Panel>
      <Panel title="Invite someone">
        <div className="grid-2">
          <Field label="Who is this for?"><Input value={inv.label} onChange={(e) => setInv({ ...inv, label: e.target.value })} placeholder="e.g. Ben K" /></Field>
          <Field label="Role"><Select value={inv.role} onChange={(e) => setInv({ ...inv, role: e.target.value })}><option value="support">Support</option><option value="admin">Admin</option><option value="owner">Owner</option></Select></Field>
        </div>
        {err && <div style={{ marginBottom: 12 }}><Alert>{err}</Alert></div>}
        <button className="btn btn-dark" disabled={inv.label.trim().length < 2} onClick={async () => { setErr(null); try { const r = await post('/api/admin/team/invites', inv); setLink(r.link); setInv({ label: '', role: 'admin' }); reload(); } catch (e) { setErr(errMsg(e)); } }}>Create invite link</button>
        {link && <div style={{ marginTop: 12 }}><Alert kind="info"><b>Send this link privately.</b> It works once and expires in 72 hours. The person chooses their own password.<div className="row" style={{ marginTop: 8 }}><span className="mono tiny" style={{ wordBreak: 'break-all' }}>{link}</span><CopyButton text={link} /></div></Alert></div>}
        {data.invites.length > 0 && <ul className="event-list" style={{ marginTop: 12 }}>{data.invites.map((i: any) => <li key={i.id} className="row between"><span>{i.label} · <span style={{ textTransform: 'capitalize' }}>{i.role}</span></span><span className="tiny muted">{i.used_at ? `Used by ${i.used_by} ${timeAgo(i.used_at)}` : new Date(i.expires_at) < new Date() ? 'Expired' : `Expires ${dateTime(i.expires_at)}`}</span></li>)}</ul>}
      </Panel>
    </>
  );
}

export function AgentsPage() {
  usePageTitle('Agents');
  const { data, error, reload } = useLoad<any>('/api/admin/agents');
  const [pay, setPay] = useState<any | null>(null);
  if (error) return <Alert>{error}</Alert>;
  if (!data) return <Loading />;
  return (
    <>
      <div className="admin-head"><h1>Agents</h1><Link to="/admin/settings" className="btn btn-light btn-sm">Programme settings</Link></div>
      <Alert kind="info">Agents share a referral link and earn commission on delivered orders. Switch the programme on and set the default commission in Settings. Commission is credited only after delivery.{data.legacyAgents ? ` ${data.legacyAgents} agent(s) from the old site are kept in the archive.` : ''}</Alert>
      <Panel title="Withdrawal requests">
        {data.withdrawals.length === 0 ? <div className="small muted">None yet.</div> : <ul className="event-list">{data.withdrawals.map((w: any) => <li key={w.id} className="row between"><span><b>{ghs(w.amount_minor)}</b> to {w.momo_number} · {w.agent_name} ({w.referral_code}) · {dateTime(w.created_at)}{w.payout_reference ? ` · paid ref ${w.payout_reference}` : ''}</span>{w.status === 'requested' ? <span className="row"><button className="btn btn-dark btn-sm" onClick={() => setPay(w)}>Mark paid</button><button className="btn btn-light btn-sm" onClick={async () => { const note = prompt('Reason for rejecting?'); if (note === null) return; await post(`/api/admin/withdrawals/${w.id}`, { action: 'rejected', note }); reload(); }}>Reject</button></span> : <StatusPill status={w.status} />}</li>)}</ul>}
      </Panel>
      <Panel title="Agents">
        {data.agents.length === 0 ? <div className="small muted">No agents yet.</div> : (
          <div className="table-wrap" style={{ border: 0 }}><table className="table"><thead><tr><th>Name</th><th>Code</th><th>Contact</th><th className="num">Sales</th><th className="num">Balance</th><th>Commission</th><th>Status</th></tr></thead>
            <tbody>{data.agents.map((a: any) => <tr key={a.id}><td><b>{a.name}</b></td><td className="mono">{a.referral_code}</td><td className="small">{a.email || ''} {a.phone}</td><td className="num">{a.sales}</td><td className="num">{ghs(a.balance_minor)}</td><td>{a.commission_bps === null ? 'Default' : `${(a.commission_bps / 100).toFixed(2)}%`}</td>
              <td><button className="btn btn-light btn-sm" onClick={async () => { await post(`/api/admin/agents/${a.id}`, { status: a.status === 'active' ? 'suspended' : 'active', commission_bps: a.commission_bps }); reload(); }}>{a.status === 'active' ? 'Suspend' : 'Activate'}</button></td></tr>)}</tbody></table></div>
        )}
      </Panel>
      {pay && <PayModal w={pay} onClose={() => setPay(null)} onDone={() => { setPay(null); reload(); }} />}
    </>
  );
}

function PayModal({ w, onClose, onDone }: { w: any; onClose: () => void; onDone: () => void }) {
  const [ref, setRef] = useState('');
  const [err, setErr] = useState<string | null>(null);
  return (
    <Modal title="Record withdrawal payment" onClose={onClose}>
      <p>Send <b>{ghs(w.amount_minor)}</b> to <b>{w.momo_number}</b> by Mobile Money first, then enter the transaction ID here.</p>
      <Field label="Mobile Money transaction ID"><Input value={ref} onChange={(e) => setRef(e.target.value)} /></Field>
      {err && <div style={{ marginBottom: 12 }}><Alert>{err}</Alert></div>}
      <button className="btn btn-dark btn-block" disabled={ref.trim().length < 3} onClick={async () => { try { await post(`/api/admin/withdrawals/${w.id}`, { action: 'paid', payout_reference: ref }); onDone(); } catch (e) { setErr(errMsg(e)); } }}>Mark as paid</button>
    </Modal>
  );
}
