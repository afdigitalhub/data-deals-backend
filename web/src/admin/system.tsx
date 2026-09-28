import { useEffect, useState, type ReactNode } from 'react';
import { post, put } from '../lib/api';
import { useApp } from '../lib/app-state';
import { cedisToMinor, dateTime, ghs, minorToCedis } from '../lib/format';
import { navigate, usePageTitle } from '../lib/router';
import { Alert, CopyButton, Field, Input, Loading, Select, Spinner, StatusPill, Textarea, errMsg } from '../components/ui';
import { Pager, Panel, isoDay, useLoad } from './common';

export function PaymentsPage() {
  usePageTitle('Payments & refunds');
  const [tab, setTab] = useState<'payments' | 'refunds' | 'webhooks' | 'reconciliation'>('payments');
  return (
    <>
      <div className="admin-head"><h1>Payments & refunds</h1>
        <div className="seg">{([['payments', 'Payments'], ['refunds', 'Refunds'], ['reconciliation', 'Reconciliation'], ['webhooks', 'Webhook log']] as const).map(([v, l]) => <button key={v} className={tab === v ? 'active' : ''} onClick={() => setTab(v)}>{l}</button>)}</div>
      </div>
      {tab === 'payments' && <PaymentsTab />}
      {tab === 'refunds' && <RefundsTab />}
      {tab === 'webhooks' && <WebhooksTab />}
      {tab === 'reconciliation' && <ReconTab />}
    </>
  );
}

function PaymentsTab() {
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [page, setPage] = useState(1);
  const { data, error } = useLoad<any>(`/api/admin/payments?page=${page}${status ? `&status=${status}` : ''}${term ? `&q=${encodeURIComponent(term)}` : ''}`);
  return (
    <>
      {data && <div className="kpis"><div className="kpi"><div className="k-label">Live payments received</div><div className="k-value">{ghs(data.summary.live_received)}</div><div className="k-sub muted">{data.summary.live_success} successful</div></div><div className="kpi"><div className="k-label">Paystack fees (live)</div><div className="k-value">{ghs(data.summary.live_fees)}</div></div><div className="kpi"><div className="k-label">Failed attempts</div><div className="k-value">{data.summary.failed}</div></div><div className="kpi"><div className="k-label">Open (awaiting customer)</div><div className="k-value">{data.summary.open}</div></div></div>}
      <form className="toolbar" onSubmit={(e) => { e.preventDefault(); setTerm(q.trim()); setPage(1); }}>
        <input className="input" placeholder="Search payment or order reference" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search payments" />
        <select className="select" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Status"><option value="">All</option><option value="success">Success</option><option value="initialized">Started</option><option value="failed">Failed</option><option value="abandoned">Abandoned</option><option value="reversed">Reversed</option></select>
      </form>
      {error && <Alert>{error}</Alert>}
      {!data ? <Loading /> : data.payments.length === 0 ? <div className="panel empty">No payments yet.</div> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Paystack reference</th><th>Order</th><th className="num">Amount</th><th>Status</th><th>Channel</th><th>Gateway message</th><th className="num">Fee</th><th>Verified</th><th>Created</th></tr></thead>
          <tbody>{data.payments.map((p: any) => <tr key={p.id} className="clickable" onClick={() => navigate(`/admin/orders/${p.order_reference}`)}><td className="mono small">{p.provider_reference} {p.is_test && <span className="tag-test">TEST</span>}</td><td className="mono small">{p.order_reference}<div><StatusPill status={p.order_status} /></div></td><td className="num">{ghs(p.amount_minor)}</td><td><StatusPill status={p.status} /></td><td className="small">{p.channel || '—'}</td><td className="small">{p.gateway_response || '—'}</td><td className="num small">{p.provider_fees_minor !== null ? ghs(p.provider_fees_minor) : '—'}</td><td className="small">{dateTime(p.verified_at)}</td><td className="small">{dateTime(p.created_at)}</td></tr>)}</tbody>
        </table></div>
      )}
      {data && <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
      <p className="tiny muted" style={{ marginTop: 10 }}>A payment only counts as successful after our server verifies it with Paystack's API. Browser redirects and screenshots are never accepted as proof.</p>
    </>
  );
}

function RefundsTab() {
  const [status, setStatus] = useState('');
  const { data, error } = useLoad<any>(`/api/admin/refunds${status ? `?status=${status}` : ''}`);
  return (
    <>
      <div className="toolbar"><select className="select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status"><option value="">All refunds</option><option value="requested">Requested (needs decision)</option><option value="processing">Processing</option><option value="processed">Completed</option><option value="rejected">Rejected</option><option value="failed">Failed</option></select></div>
      {error && <Alert>{error}</Alert>}
      {!data ? <Loading /> : data.refunds.length === 0 ? <div className="panel empty">No refunds.</div> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Order</th><th className="num">Amount</th><th>Reason</th><th>Requested by</th><th>Status</th><th>Reviewed</th><th>Created</th></tr></thead>
          <tbody>{data.refunds.map((r: any) => <tr key={r.id} className="clickable" onClick={() => navigate(`/admin/orders/${r.order_reference}`)}><td className="mono small">{r.order_reference}<div><StatusPill status={r.order_status} /></div></td><td className="num">{ghs(r.amount_minor)}</td><td className="small">{r.reason}</td><td className="small" style={{ textTransform: 'capitalize' }}>{r.requested_by_type}</td><td><StatusPill status={r.status} /></td><td className="small">{r.reviewed_by || '—'}</td><td className="small">{dateTime(r.created_at)}</td></tr>)}</tbody>
        </table></div>
      )}
      <p className="tiny muted" style={{ marginTop: 10 }}>Open an order to approve or reject its refund. Refunds are blocked while a delivery might have succeeded.</p>
    </>
  );
}

function WebhooksTab() {
  const { data, error, reload, loading } = useLoad<any>('/api/admin/payment-events');
  return (
    <>
      <div className="row" style={{ marginBottom: 12 }}><button className="btn btn-light btn-sm" onClick={reload}>{loading ? <Spinner /> : 'Refresh'}</button></div>
      {error && <Alert>{error}</Alert>}
      {!data ? <Loading /> : data.events.length === 0 ? <div className="panel empty">No webhook events received yet.</div> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Received</th><th>Event</th><th>Reference</th><th>Signature</th><th>Result</th></tr></thead>
          <tbody>{data.events.map((e: any) => <tr key={e.id}><td className="small">{dateTime(e.received_at)}</td><td className="mono small">{e.event_type || '—'}</td><td className="mono small">{e.provider_reference || '—'}</td><td>{e.signature_valid ? <span className="pill pill-success">Valid</span> : <span className="pill pill-danger">Rejected</span>}</td><td className="small">{e.processing_result || '—'}</td></tr>)}</tbody>
        </table></div>
      )}
    </>
  );
}

function ReconTab() {
  const [days, setDays] = useState(7);
  const from = isoDay(new Date(Date.now() - (days - 1) * 86400000));
  const { data, error } = useLoad<any>(`/api/admin/reconciliation?from=${from}`);
  return (
    <>
      <div className="seg" style={{ marginBottom: 12 }}>{[7, 30, 90].map((d) => <button key={d} className={days === d ? 'active' : ''} onClick={() => setDays(d)}>{d} days</button>)}</div>
      {error && <Alert>{error}</Alert>}
      {!data ? <Loading /> : (
        <>
          <Panel title="Live payments by day">
            {data.days.length === 0 ? <div className="small muted">No live payments in this period.</div> : (
              <div className="table-wrap" style={{ border: 0 }}><table className="table"><thead><tr><th>Day</th><th className="num">Payments</th><th className="num">Received</th><th className="num">Paystack fees</th><th className="num">Delivered</th><th className="num">Unresolved</th><th className="num">Refunded</th></tr></thead>
                <tbody>{data.days.map((d: any) => <tr key={d.day}><td>{d.day}</td><td className="num">{d.payments}</td><td className="num">{ghs(d.received)}</td><td className="num">{ghs(d.fees)}</td><td className="num">{d.delivered}</td><td className="num" style={{ color: d.unresolved ? 'var(--warn)' : undefined }}>{d.unresolved}</td><td className="num">{d.refunded}</td></tr>)}</tbody></table></div>
            )}
            <p className="tiny muted">Compare "Received" with your Paystack settlement report for the same day.</p>
          </Panel>
          <Panel title="Paid orders needing attention">
            {data.issues.length === 0 ? <div className="small muted">Nothing unresolved. 🎉</div> : <ul className="event-list">{data.issues.map((i: any) => <li key={i.reference} className="row between" style={{ cursor: 'pointer' }} onClick={() => navigate(`/admin/orders/${i.reference}`)}><span className="mono">{i.reference}</span><span>{ghs(i.total_minor)}</span><StatusPill status={i.status} /><span className="tiny muted">{dateTime(i.updated_at)}</span></li>)}</ul>}
          </Panel>
        </>
      )}
    </>
  );
}

export function SettingsPage() {
  usePageTitle('Settings');
  const { user } = useApp();
  const canEdit = !!user?.permissions.includes('settings.manage');
  const { data, error, reload } = useLoad<any>('/api/admin/settings');
  if (error) return <Alert>{error}</Alert>;
  if (!data) return <Loading />;
  const s = data.settings; const i = data.integrations;
  return (
    <>
      <div className="admin-head"><h1>Settings</h1></div>
      {!canEdit && <div style={{ marginBottom: 12 }}><Alert kind="info">You can view settings but only admins and owners can change them.</Alert></div>}
      <Panel title="Integrations status">
        <dl className="kv">
          <dt>Payments (Paystack)</dt><dd>{i.payments.mode === 'live' ? <StatusPill status="connected" label="Live mode" /> : i.payments.mode === 'test' ? <StatusPill status="untested" label="Test mode" /> : i.payments.mode === 'fake' ? <StatusPill status="untested" label="Local simulator" /> : <StatusPill status="not_connected" label="Not configured" />}</dd>
          <dt>Paystack webhook URL</dt><dd className="row" style={{ gap: 8 }}><span className="mono tiny" style={{ wordBreak: 'break-all' }}>{i.payments.webhookUrl}</span><CopyButton text={i.payments.webhookUrl} /></dd>
          <dt>Email</dt><dd>{i.email.configured ? <StatusPill status="connected" label="Configured (Resend)" /> : <StatusPill status="not_connected" label="Not configured" />}</dd>
          <dt>SMS</dt><dd><StatusPill status="not_connected" label="Not connected" /> <span className="tiny muted">{i.sms.note}</span></dd>
          <dt>Suppliers</dt><dd>{i.suppliers.map((x: any) => <div key={x.code}>{x.name}: {x.connected === null ? 'manual' : x.connected ? 'connected' : 'not connected'}</div>)}</dd>
          <dt>Site address</dt><dd className="mono tiny">{i.publicBaseUrl}</dd>
        </dl>
        <p className="tiny muted" style={{ marginTop: 10 }}>Secret keys are stored only as server environment variables on Render. They are never shown here or sent to the browser.</p>
      </Panel>
      <SettingForm k="business" title="Business details" value={s.business} canEdit={canEdit} onSaved={reload} render={(v, set) => (
        <>
          <div className="grid-2">
            <Field label="Business name"><Input value={v.name} onChange={(e) => set({ ...v, name: e.target.value })} /></Field>
            <Field label="Tagline"><Input value={v.tagline} onChange={(e) => set({ ...v, tagline: e.target.value })} /></Field>
            <Field label="Support email" hint="Shown on the website"><Input type="email" value={v.support_email || ''} onChange={(e) => set({ ...v, support_email: e.target.value })} /></Field>
            <Field label="Support phone"><Input value={v.support_phone || ''} onChange={(e) => set({ ...v, support_phone: e.target.value })} /></Field>
            <Field label="WhatsApp business number" hint="International format, digits only, e.g. 233241234567"><Input value={v.whatsapp_number || ''} onChange={(e) => set({ ...v, whatsapp_number: e.target.value })} /></Field>
            <Field label="Address (optional)"><Input value={v.address || ''} onChange={(e) => set({ ...v, address: e.target.value })} /></Field>
          </div>
          <label className="check" style={{ marginBottom: 12 }}><input type="checkbox" checked={v.show_founders} onChange={(e) => set({ ...v, show_founders: e.target.checked })} /><span>Show "co-founded by Adonle Fameye and Ben K" on the About page (owners only)</span></label>
        </>
      )} />
      <SettingForm k="maintenance" title="Maintenance mode" value={s.maintenance} canEdit={canEdit} onSaved={reload} render={(v, set) => (
        <>
          <label className="check" style={{ marginBottom: 12 }}><input type="checkbox" checked={v.enabled} onChange={(e) => set({ ...v, enabled: e.target.checked })} /><span><b>Pause all new purchases</b> (the website stays visible and existing orders keep processing)</span></label>
          <Field label="Message shown to customers"><Textarea value={v.message} onChange={(e) => set({ ...v, message: e.target.value })} style={{ minHeight: 70 }} /></Field>
        </>
      )} />
      <SettingForm k="limits" title="Purchase limits" value={s.limits} canEdit={canEdit} onSaved={reload} render={(v, set) => (
        <div className="grid-3">
          <Field label="Maximum order (GHS)"><Input inputMode="decimal" value={minorToCedis(v.max_order_minor)} onChange={(e) => set({ ...v, max_order_minor: cedisToMinor(e.target.value) || 0 })} /></Field>
          <Field label="Max paid orders per number per day"><Input inputMode="numeric" value={String(v.max_orders_per_recipient_per_day)} onChange={(e) => set({ ...v, max_orders_per_recipient_per_day: Number(e.target.value) || 0 })} /></Field>
          <Field label="Unpaid orders expire after (minutes)"><Input inputMode="numeric" value={String(v.order_expiry_minutes)} onChange={(e) => set({ ...v, order_expiry_minutes: Number(e.target.value) || 0 })} /></Field>
        </div>
      )} />
      <SettingForm k="policies" title="Refund policy" value={s.policies} canEdit={canEdit} onSaved={reload} render={(v, set) => (
        <Field label="Customers can request a refund within (days)" hint="Shown on the Refund Policy page"><Input inputMode="numeric" value={String(v.refund_window_days)} onChange={(e) => set({ ...v, refund_window_days: Number(e.target.value) || 0 })} /></Field>
      )} />
      <SettingForm k="notifications" title="Notifications" value={s.notifications} canEdit={canEdit} onSaved={reload} render={(v, set) => (
        <>
          <label className="check" style={{ marginBottom: 10 }}><input type="checkbox" checked={v.email_enabled} onChange={(e) => set({ ...v, email_enabled: e.target.checked })} disabled={!i.email.configured} /><span>Email customers about delivered, failed and refunded orders {!i.email.configured && <span className="muted">(needs email set up first)</span>}</span></label>
          <Field label="Send admin alerts to (email)" hint="Failed deliveries, reviews and duplicate payments"><Input type="email" value={v.admin_alert_email || ''} onChange={(e) => set({ ...v, admin_alert_email: e.target.value })} /></Field>
        </>
      )} />
      <PushPanel canEdit={canEdit} />
      {s.push && <SettingForm k="push" title="Daily phone messages" value={s.push} canEdit={canEdit} onSaved={reload} render={(v: any, set) => (
        <>
          <label className="check" style={{ marginBottom: 10 }}><input type="checkbox" checked={v.daily_enabled} onChange={(e) => set({ ...v, daily_enabled: e.target.checked })} /><span><b>Send one message a day</b> to customers who turned on notifications and didn't switch daily deals off</span></label>
          <label className="check" style={{ marginBottom: 12 }}><input type="checkbox" checked={v.reminders_enabled} onChange={(e) => set({ ...v, reminders_enabled: e.target.checked })} /><span><b>Smart reminders</b>: when a customer's last bundle is probably finishing, send "your data may be running low, buy again in one tap" instead of that day's message</span></label>
          <div className="grid-2">
            <Field label="Send time (Ghana time)" hint="Messages go out at this hour when the website is awake">
              <Select value={String(v.send_hour)} onChange={(e) => set({ ...v, send_hour: Number(e.target.value) })}>{Array.from({ length: 16 }, (_, i) => i + 6).map((h) => <option key={h} value={h}>{h < 12 ? `${h}:00 am` : h === 12 ? '12:00 pm' : `${h - 12}:00 pm`}</option>)}</Select>
            </Field>
            <Field label="Custom title (optional)" hint="Leave empty to use the rotating Twi messages"><Input value={v.custom_title || ''} maxLength={60} onChange={(e) => set({ ...v, custom_title: e.target.value || null })} placeholder="e.g. Weekend deal 🎉" /></Field>
          </div>
          <Field label="Custom message (optional)" hint="If set, everyone gets this instead of the rotating messages. Keep it short and honest; never promise prices that aren't on the site."><Textarea value={v.custom_message || ''} maxLength={180} onChange={(e) => set({ ...v, custom_message: e.target.value || null })} style={{ minHeight: 64 }} /></Field>
        </>
      )} />}
      <SettingForm k="agents" title="Agent programme" value={s.agents} canEdit={canEdit} onSaved={reload} render={(v, set) => (
        <>
          <label className="check" style={{ marginBottom: 12 }}><input type="checkbox" checked={v.enabled} onChange={(e) => set({ ...v, enabled: e.target.checked })} /><span>Agent programme is open</span></label>
          <div className="grid-2">
            <Field label="Default commission (% of product price)" hint="Make sure this is below your margin"><Input inputMode="decimal" value={String(v.default_commission_bps / 100)} onChange={(e) => set({ ...v, default_commission_bps: Math.round(Number(e.target.value) * 100) || 0 })} /></Field>
            <Field label="Minimum withdrawal (GHS)"><Input inputMode="decimal" value={minorToCedis(v.min_withdrawal_minor)} onChange={(e) => set({ ...v, min_withdrawal_minor: cedisToMinor(e.target.value) || 0 })} /></Field>
          </div>
        </>
      )} />
    </>
  );
}

function SettingForm<T>({ k, title, value, canEdit, onSaved, render }: { k: string; title: string; value: T; canEdit: boolean; onSaved: () => void; render: (v: T, set: (v: T) => void) => ReactNode }) {
  const [v, setV] = useState<T>(value);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => setV(value), [value]);
  const dirty = JSON.stringify(v) !== JSON.stringify(value);
  return (
    <Panel title={title}>
      <fieldset disabled={!canEdit} style={{ border: 0, padding: 0, margin: 0 }}>{render(v, (nv) => { setV(nv); setMsg(null); })}</fieldset>
      {msg && <div style={{ marginBottom: 10 }}><Alert kind="success">{msg}</Alert></div>}
      {err && <div style={{ marginBottom: 10 }}><Alert>{err}</Alert></div>}
      {canEdit && <button className="btn btn-dark btn-sm" disabled={!dirty || busy} onClick={async () => { setBusy(true); setErr(null); try { await put(`/api/admin/settings/${k}`, v); setMsg('Saved'); onSaved(); } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); } }}>{busy ? <Spinner /> : 'Save'}</button>}
    </Panel>
  );
}

export function AuditPage() {
  usePageTitle('Audit log');
  const [entity, setEntity] = useState('');
  const [page, setPage] = useState(1);
  const { data, error } = useLoad<any>(`/api/admin/audit?page=${page}${entity ? `&entity=${entity}` : ''}`);
  return (
    <>
      <div className="admin-head"><h1>Audit log</h1><Select value={entity} onChange={(e) => { setEntity(e.target.value); setPage(1); }} style={{ width: 'auto', minHeight: 40 }}><option value="">Everything</option><option value="order">Orders</option><option value="product">Products</option><option value="refund">Refunds</option><option value="user">Users</option><option value="setting">Settings</option><option value="supplier">Suppliers</option><option value="ticket">Tickets</option></Select></div>
      <Alert kind="info">Every admin action is recorded here permanently. Entries cannot be edited or deleted — not even by owners.</Alert>
      {error && <Alert>{error}</Alert>}
      {!data ? <Loading /> : (
        <div className="table-wrap" style={{ marginTop: 12 }}><table className="table">
          <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Item</th><th>Details</th></tr></thead>
          <tbody>{data.entries.map((e: any) => <tr key={e.id}><td className="small nowrap">{dateTime(e.created_at)}</td><td>{e.actor || 'System'}</td><td className="mono small">{e.action}</td><td className="small">{e.entity_type} {e.entity_id}</td><td className="tiny muted" style={{ maxWidth: 380, wordBreak: 'break-word' }}>{summarize(e.after_data)}</td></tr>)}</tbody>
        </table></div>
      )}
      {data && <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
    </>
  );
}
function summarize(d: any) {
  if (!d || typeof d !== 'object') return '';
  return Object.entries(d).filter(([k]) => !['created_at', 'updated_at', 'id', 'created_by', 'updated_by'].includes(k)).slice(0, 6).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`).join(' · ').slice(0, 300);
}

function PushPanel({ canEdit }: { canEdit: boolean }) {
  const { data, reload } = useLoad<any>('/api/admin/push');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  if (!data) return null;
  const st = data.stats; const t = data.today;
  const act = async (kind: 'test' | 'today') => {
    setBusy(kind); setMsg(null);
    try {
      const r = await post(kind === 'test' ? '/api/admin/push/test' : '/api/admin/push/send-today');
      setMsg(kind === 'test' ? (r.devices ? `Test sent to ${r.delivered} of ${r.devices} of your devices.` : 'None of your devices has notifications on. Open your dashboard on your phone and tap "Turn on notifications" first.') : `Sent today's message to ${r.sent} device${r.sent === 1 ? '' : 's'}. Devices already messaged today were skipped.`);
      reload();
    } catch (e) { setMsg(errMsg(e)); } finally { setBusy(null); }
  };
  return (
    <Panel title="Phone notifications">
      {!data.configured ? <Alert kind="info">Phone notifications are not switched on for this server yet.</Alert> : (
        <>
          <div className="grid-3" style={{ marginBottom: 12 }}>
            <div className="stat"><div className="stat-v">{st.active}</div><div className="stat-l">Phones with notifications on</div></div>
            <div className="stat"><div className="stat-v">{st.marketing}</div><div className="stat-l">Accepting daily messages</div></div>
            <div className="stat"><div className="stat-v">{t.daily + t.reminders}</div><div className="stat-l">Sent today ({t.reminders} smart reminders)</div></div>
          </div>
          <p className="tiny muted">Customers turn this on themselves from their dashboard or order page, and can switch daily messages off at any time. Order updates (delivered, failed, refunded) are sent automatically.</p>
          {msg && <div style={{ margin: '10px 0' }}><Alert kind="info">{msg}</Alert></div>}
          {canEdit && <div className="row" style={{ gap: 8 }}>
            <button className="btn btn-light btn-sm" disabled={!!busy} onClick={() => act('test')}>{busy === 'test' ? <Spinner /> : 'Send a test to my phone'}</button>
            <button className="btn btn-dark btn-sm" disabled={!!busy || !st.marketing} onClick={() => act('today')}>{busy === 'today' ? <Spinner /> : "Send today's message now"}</button>
          </div>}
        </>
      )}
    </Panel>
  );
}
