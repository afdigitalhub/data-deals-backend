import { useState, type ReactNode } from 'react';
import { post } from '../lib/api';
import { NETWORK_META, dateTime, ghs } from '../lib/format';
import { Link, navigate, useLocation, usePageTitle } from '../lib/router';
import { Alert, CopyButton, Field, Input, Loading, Modal, NetworkBadge, StatusPill, Spinner, Textarea, errMsg } from '../components/ui';
import { Pager, Panel, useLoad } from './common';
import { IcBack } from '../components/icons';

const STATUSES = ['pending_payment', 'paid', 'queued', 'processing', 'needs_review', 'successful', 'failed', 'refund_pending', 'refunded', 'payment_failed', 'expired'];

export function OrdersPage({ queue }: { queue?: 'manual' | 'review' }) {
  const { search } = useLocation();
  const q2 = queue || (search.get('queue') as any) || '';
  usePageTitle(q2 === 'manual' ? 'Manual delivery queue' : q2 === 'review' ? 'Needs review' : 'Orders');
  const [status, setStatus] = useState('');
  const [network, setNetwork] = useState('');
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [page, setPage] = useState(1);
  const [hideTest, setHideTest] = useState(false);
  const params = new URLSearchParams({ page: String(page) });
  if (status) params.set('status', status);
  if (network) params.set('network', network);
  if (term) params.set('q', term);
  if (q2) params.set('queue', q2);
  if (hideTest) params.set('test', '0');
  const { data, error, loading, reload } = useLoad<any>(`/api/admin/orders?${params}`);
  return (
    <>
      <div className="admin-head">
        <h1>{q2 === 'manual' ? 'Manual delivery queue' : q2 === 'review' ? 'Needs review' : q2 === 'escalated' ? 'Escalated orders' : 'Orders'}</h1>
        <button className="btn btn-light btn-sm" onClick={reload}>{loading ? <Spinner /> : 'Refresh'}</button>
      </div>
      {q2 === 'manual' && <Alert kind="info">Paid orders waiting for an admin to deliver them. Oldest first. Only record a delivery after the recipient actually received it.</Alert>}
      {q2 === 'review' && <Alert kind="warn">These orders have an uncertain supplier result or a payment issue. Check with the supplier or Paystack before marking them delivered or failed. Never send them again blindly.</Alert>}
      <div className="toolbar" style={{ marginTop: 12 }}>
        <form style={{ display: 'contents' }} onSubmit={(e) => { e.preventDefault(); setTerm(q.trim()); setPage(1); }}>
          <input className="input" placeholder="Search reference, phone, email, supplier ref" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search orders" />
        </form>
        {!q2 && <select className="select" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Status"><option value="">All statuses</option>{STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}</select>}
        <select className="select" value={network} onChange={(e) => { setNetwork(e.target.value); setPage(1); }} aria-label="Network"><option value="">All networks</option><option value="MTN">MTN</option><option value="TELECEL">Telecel</option><option value="AT">AT</option></select>
        <label className="check small" style={{ alignItems: 'center' }}><input type="checkbox" checked={hideTest} onChange={(e) => setHideTest(e.target.checked)} />Hide test</label>
      </div>
      {error && <Alert>{error}</Alert>}
      {!data ? <Loading /> : data.orders.length === 0 ? <div className="panel empty">{q2 ? 'Nothing waiting here. 🎉' : 'No orders match.'}</div> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Reference</th><th>Customer</th><th>Recipient</th><th>Network</th><th>Product</th><th className="num">Paid</th><th>Payment</th><th>Delivery</th><th>Supplier ref</th><th>Created</th><th>Updated</th></tr></thead>
            <tbody>{data.orders.map((o: any) => (
              <tr key={o.reference} className="clickable" onClick={() => navigate(`/admin/orders/${o.reference}`)}>
                <td className="mono nowrap">{o.reference} {o.isTest && <span className="tag-test">TEST</span>} {o.escalated && <span className="pill pill-danger">Escalated</span>}</td>
                <td>{o.customer}<div className="tiny muted">{o.customerEmail}</div></td>
                <td className="nowrap">{o.recipientPhone}</td>
                <td><NetworkBadge code={o.network} size="sm" /></td>
                <td>{o.product}</td>
                <td className="num nowrap">{ghs(o.totalMinor)}</td>
                <td><StatusPill status={o.paymentStatus === 'none' ? 'initialized' : o.paymentStatus} label={o.paymentStatus === 'none' ? 'None' : undefined} /></td>
                <td><StatusPill status={o.status} /></td>
                <td className="mono tiny">{o.supplierReference || '—'}</td>
                <td className="nowrap small">{dateTime(o.createdAt)}</td>
                <td className="nowrap small">{dateTime(o.updatedAt)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {data && <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
    </>
  );
}

type ActionKind = 'deliver' | 'fail' | 'retry' | 'refund' | 'escalate' | 'reconcile' | null;

export function OrderDetailPage({ reference }: { reference: string }) {
  usePageTitle(`Order ${reference}`);
  const { data, error, reload } = useLoad<any>(`/api/admin/orders/${encodeURIComponent(reference)}`);
  const [action, setAction] = useState<ActionKind>(null);
  const [flash, setFlash] = useState<string | null>(null);
  if (error) return <Alert>{error}</Alert>;
  if (!data) return <Loading />;
  const o = data.order; const a = data.actions;
  const done = (msg: string) => { setAction(null); setFlash(msg); reload(); };
  return (
    <>
      <button className="btn btn-ghost btn-sm" onClick={() => history.length > 1 ? history.back() : navigate('/admin/orders')} style={{ paddingLeft: 0 }}><IcBack width={18} height={18} />Back</button>
      <div className="admin-head">
        <div><div className="row" style={{ gap: 8 }}><h1 className="mono">{o.reference}</h1><CopyButton text={o.reference} /></div><div className="row small" style={{ marginTop: 6, gap: 8 }}><StatusPill status={o.status} label={o.statusLabel} />{o.is_test && <span className="tag-test">TEST ORDER</span>}{o.escalated && <span className="pill pill-danger">Escalated</span>}<span className="muted">Created {dateTime(o.created_at)}</span></div></div>
        <div className="row">
          {a.recordDelivery && <button className="btn btn-yellow btn-sm" onClick={() => setAction('deliver')}>{a.supplierCheckRequired ? 'Confirm delivered' : 'Record delivery'}</button>}
          {a.markFailed && <button className="btn btn-light btn-sm" onClick={() => setAction('fail')}>Mark failed</button>}
          {a.retry && <button className="btn btn-dark btn-sm" onClick={() => setAction('retry')}>Retry delivery</button>}
          {a.refund && <button className="btn btn-light btn-sm" onClick={() => setAction('refund')}>Refund</button>}
          {a.reconcile && <button className="btn btn-light btn-sm" onClick={() => setAction('reconcile')}>Check Paystack / supplier</button>}
          {!o.escalated && <button className="btn btn-ghost btn-sm" onClick={() => setAction('escalate')}>Escalate</button>}
        </div>
      </div>
      {flash && <div style={{ marginBottom: 12 }}><Alert kind="success">{flash}</Alert></div>}
      {o.status === 'needs_review' && <div style={{ marginBottom: 12 }}><Alert kind="warn">This order needs investigation. {a.supplierCheckRequired ? 'The last supplier request has an unknown result — it may have been delivered. Check the supplier portal for the request ID below before choosing “Confirm delivered” or “Mark failed”.' : 'Read the history below to see why.'}</Alert></div>}

      <div className="grid-2" style={{ gap: 16, alignItems: 'start' }}>
        <Panel title="Order">
          <dl className="kv">
            <dt>Recipient</dt><dd className="row" style={{ gap: 8 }}><b>{o.recipient_phone}</b><NetworkBadge code={o.network_code} size="sm" />{NETWORK_META[o.network_code]?.name}</dd>
            <dt>Product</dt><dd>{o.product_snapshot?.name}{o.kind === 'airtime' ? ` · ${ghs(o.face_value_minor)} airtime` : o.product_snapshot?.validity_label ? ` · ${o.product_snapshot.validity_label}` : ''}</dd>
            <dt>Customer</dt><dd>{o.customer_id ? <Link to={`/admin/customers/${o.customer_id}`} className="link">{o.customer_name}</Link> : 'Guest'} · {o.contact_email}{o.contact_phone ? ` · ${o.contact_phone}` : ''}</dd>
            <dt>Price / fee</dt><dd>{ghs(o.price_minor)} + {ghs(o.fee_minor)}</dd>
            <dt>Total paid</dt><dd><b>{ghs(o.total_minor)}</b></dd>
            <dt>Supplier cost</dt><dd>{o.actual_cost_minor !== null ? ghs(o.actual_cost_minor) : o.expected_cost_minor !== null ? `${ghs(o.expected_cost_minor)} (expected)` : <span className="muted">Not recorded</span>}</dd>
            <dt>Margin</dt><dd>{(o.actual_cost_minor ?? o.expected_cost_minor) !== null ? ghs(o.total_minor - (o.actual_cost_minor ?? o.expected_cost_minor)) : '—'}</dd>
            <dt>Fulfilment</dt><dd style={{ textTransform: 'capitalize' }}>{o.fulfilment_mode}{o.supplier_reference ? ` · ref ${o.supplier_reference}` : ''}</dd>
            {o.agent_code && <><dt>Agent</dt><dd>{o.agent_code} · commission {ghs(o.agent_commission_minor)}</dd></>}
            <dt>Paid at</dt><dd>{dateTime(o.paid_at)}</dd>
            <dt>Delivered at</dt><dd>{dateTime(o.delivered_at)}</dd>
            <dt>Client IP</dt><dd className="mono tiny">{o.client_ip || '—'}</dd>
          </dl>
        </Panel>
        <div>
          <Panel title="Payments">
            {data.payments.length === 0 ? <div className="small muted">No payment attempts.</div> : data.payments.map((p: any) => (
              <div key={p.id} className="list-row" style={{ alignItems: 'flex-start' }}>
                <div style={{ flex: 1, minWidth: 0 }}><div className="mono small">{p.provider_reference}</div><div className="tiny muted">{p.provider}{p.is_test ? ' (test)' : ''} · {p.channel || 'channel n/a'} · {p.gateway_response || '—'} · verified {dateTime(p.verified_at)}</div></div>
                <div style={{ textAlign: 'right' }}><b>{ghs(p.amount_minor)}</b><div><StatusPill status={p.status} /></div>{p.provider_fees_minor !== null && <div className="tiny muted">fee {ghs(p.provider_fees_minor)}</div>}</div>
              </div>
            ))}
          </Panel>
          <Panel title="Supplier requests">
            {data.attempts.length === 0 ? <div className="small muted">{o.fulfilment_mode === 'manual' ? 'Manual delivery — no supplier requests.' : 'No supplier requests yet.'}</div> : data.attempts.map((x: any) => (
              <div key={x.id} className="list-row" style={{ alignItems: 'flex-start' }}>
                <div style={{ flex: 1, minWidth: 0 }}><div className="small"><b>#{x.attempt_no}</b> {x.supplier_name} · request <span className="mono">{x.request_id}</span></div><div className="tiny muted">{x.supplier_reference ? `Supplier ref ${x.supplier_reference} · ` : ''}{x.error_message || x.response_summary?.message || ''} · {dateTime(x.started_at)}</div></div>
                <StatusPill status={x.status} />
              </div>
            ))}
          </Panel>
          {data.refunds.length > 0 && (
            <Panel title="Refunds">
              {data.refunds.map((r: any) => (
                <div key={r.id} className="list-row" style={{ alignItems: 'flex-start' }}>
                  <div style={{ flex: 1 }}><div className="small">{r.reason}</div><div className="tiny muted">{r.requested_by_type} request · {dateTime(r.created_at)}{r.reviewed_by ? ` · by ${r.reviewed_by}` : ''}{r.notes ? ` · ${r.notes}` : ''}</div>
                    {r.status === 'requested' && a.refund !== undefined && (r.reason.startsWith('Duplicate') || o.status === 'failed') && <RefundApprove reference={o.reference} refundId={r.id} onDone={done} />}
                  </div>
                  <div style={{ textAlign: 'right' }}><b>{ghs(r.amount_minor)}</b><div><StatusPill status={r.status} /></div></div>
                </div>
              ))}
            </Panel>
          )}
          {data.tickets.length > 0 && <Panel title="Support tickets">{data.tickets.map((t: any) => <Link key={t.reference} to={`/admin/support/${t.reference}`} className="list-row"><span className="mono small">{t.reference}</span><span style={{ flex: 1 }}>{t.subject}</span><StatusPill status={t.status} /></Link>)}</Panel>}
        </div>
      </div>

      <Panel title="History (permanent record)">
        <ul className="event-list">
          {data.events.map((e: any) => (
            <li key={e.id}>
              <div className="row between"><b>{e.message}</b><span className="tiny muted nowrap">{dateTime(e.created_at)}</span></div>
              <div className="tiny muted">{e.actor_type === 'admin' ? `By ${e.actor_name || 'admin'}` : e.actor_type.replace('_', ' ')}{e.from_status ? ` · ${e.from_status.replace(/_/g, ' ')} → ${e.to_status?.replace(/_/g, ' ')}` : ''}</div>
            </li>
          ))}
        </ul>
      </Panel>

      {action === 'deliver' && <DeliverModal o={o} unknown={a.supplierCheckRequired} onClose={() => setAction(null)} onDone={() => done('Delivery recorded.')} />}
      {action === 'fail' && <FailModal o={o} unknown={a.supplierCheckRequired} onClose={() => setAction(null)} onDone={() => done('Order marked as failed.')} />}
      {action === 'retry' && <SimpleAction title="Retry delivery" onClose={() => setAction(null)} confirmLabel="Retry now" body={<p>The previous supplier request was a confirmed failure, so it is safe to try again. A new request will be created (or it goes to the manual queue if no supplier is connected).</p>} run={() => post(`/api/admin/orders/${o.reference}/retry`)} onDone={() => done('Retry queued.')} />}
      {action === 'refund' && <ReasonAction title="Refund this order" label="Reason for refund" confirmLabel={`Refund ${ghs(o.total_minor)} via Paystack`} onClose={() => setAction(null)} body={<Alert kind="warn">Only refund if you are sure the top-up was NOT delivered. This sends the money back to the customer through Paystack.</Alert>} run={(reason) => post(`/api/admin/orders/${o.reference}/refund`, { reason })} onDone={() => done('Refund submitted to Paystack. It will show as completed once Paystack confirms.')} />}
      {action === 'escalate' && <ReasonAction title="Escalate order" label="What needs attention?" confirmLabel="Escalate" onClose={() => setAction(null)} run={(note) => post(`/api/admin/orders/${o.reference}/escalate`, { note })} onDone={() => done('Order escalated.')} />}
      {action === 'reconcile' && <SimpleAction title="Check with Paystack and supplier" onClose={() => setAction(null)} confirmLabel="Run checks" body={<p>We'll ask Paystack for the latest status of any open payment, and ask the supplier about any pending request. Nothing is charged or sent.</p>} run={() => post(`/api/admin/orders/${o.reference}/reconcile`)} onDone={() => done('Checks completed. See history for results.')} />}
    </>
  );
}

function RefundApprove({ reference, refundId, onDone }: { reference: string; refundId: number; onDone: (m: string) => void }) {
  const [mode, setMode] = useState<null | 'approve' | 'reject'>(null);
  return (
    <>
      <div className="row" style={{ marginTop: 8 }}><button className="btn btn-dark btn-sm" onClick={() => setMode('approve')}>Approve & refund</button><button className="btn btn-light btn-sm" onClick={() => setMode('reject')}>Reject</button></div>
      {mode === 'approve' && <ReasonAction title="Approve refund" label="Note" confirmLabel="Refund via Paystack" onClose={() => setMode(null)} run={(reason) => post(`/api/admin/orders/${reference}/refund`, { reason, refund_id: refundId })} onDone={() => onDone('Refund submitted to Paystack.')} />}
      {mode === 'reject' && <ReasonAction title="Reject refund request" label="Reason (shown in history)" confirmLabel="Reject request" onClose={() => setMode(null)} run={(note) => post(`/api/admin/refunds/${refundId}/reject`, { note })} onDone={() => onDone('Refund request rejected.')} />}
    </>
  );
}

function DeliverModal({ o, unknown, onClose, onDone }: { o: any; unknown: boolean; onClose: () => void; onDone: () => void }) {
  const [ref, setRef] = useState('');
  const [note, setNote] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={unknown ? 'Confirm the supplier delivered it' : 'Record manual delivery'} onClose={onClose}>
      <div className="card-soft small" style={{ marginBottom: 14 }}>Deliver <b>{o.kind === 'airtime' ? `${ghs(o.face_value_minor)} airtime` : o.product_snapshot?.name}</b> to <b className="mono">{o.recipient_phone}</b> on <b>{NETWORK_META[o.network_code]?.name}</b>.</div>
      <Field label="Network / supplier confirmation reference" hint="The transaction ID from the network or supplier, if you have one"><Input value={ref} onChange={(e) => setRef(e.target.value)} /></Field>
      <Field label="How was it delivered?"><Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Sent from the MTN reseller portal, customer confirmed receipt" /></Field>
      <label className="check" style={{ marginBottom: 14 }}><input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} /><span>I confirm the recipient has actually received this top-up. (This is recorded permanently with my name.)</span></label>
      {err && <div style={{ marginBottom: 12 }}><Alert>{err}</Alert></div>}
      <button className="btn btn-yellow btn-block" disabled={busy || !confirm || note.trim().length < 5} onClick={async () => { setBusy(true); setErr(null); try { await post(`/api/admin/orders/${o.reference}/record-delivery`, { confirmation_reference: ref || null, note, confirm: true }); onDone(); } catch (e) { setErr(errMsg(e)); setBusy(false); } }}>{busy ? <Spinner /> : 'Mark as delivered'}</button>
    </Modal>
  );
}

function FailModal({ o, unknown, onClose, onDone }: { o: any; unknown: boolean; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [checked, setChecked] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="Mark delivery as failed" onClose={onClose}>
      <Field label="Reason"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Network rejected the number / supplier out of stock" /></Field>
      {unknown && <label className="check" style={{ marginBottom: 14 }}><input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} /><span>I checked with the supplier and this top-up was <b>not</b> delivered.</span></label>}
      <p className="small muted">The customer will be told. You can then retry the delivery or refund them.</p>
      {err && <div style={{ marginBottom: 12 }}><Alert>{err}</Alert></div>}
      <button className="btn btn-dark btn-block" disabled={busy || reason.trim().length < 5 || (unknown && !checked)} onClick={async () => { setBusy(true); setErr(null); try { await post(`/api/admin/orders/${o.reference}/mark-failed`, { reason, supplier_checked: unknown ? checked : undefined }); onDone(); } catch (e) { setErr(errMsg(e)); setBusy(false); } }}>{busy ? <Spinner /> : 'Mark failed'}</button>
    </Modal>
  );
}

export function SimpleAction({ title, body, confirmLabel, run, onClose, onDone }: { title: string; body: ReactNode; confirmLabel: string; run: () => Promise<unknown>; onClose: () => void; onDone: () => void }) {
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={title} onClose={onClose}>
      {body}
      {err && <div style={{ marginBottom: 12 }}><Alert>{err}</Alert></div>}
      <button className="btn btn-dark btn-block" disabled={busy} onClick={async () => { setBusy(true); setErr(null); try { await run(); onDone(); } catch (e) { setErr(errMsg(e)); setBusy(false); } }}>{busy ? <Spinner /> : confirmLabel}</button>
    </Modal>
  );
}

export function ReasonAction({ title, label, body, confirmLabel, run, onClose, onDone }: { title: string; label: string; body?: ReactNode; confirmLabel: string; run: (reason: string) => Promise<unknown>; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={title} onClose={onClose}>
      {body && <div style={{ marginBottom: 12 }}>{body}</div>}
      <Field label={label} hint="At least 5 characters"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      {err && <div style={{ marginBottom: 12 }}><Alert>{err}</Alert></div>}
      <button className="btn btn-dark btn-block" disabled={busy || reason.trim().length < 5} onClick={async () => { setBusy(true); setErr(null); try { await run(reason); onDone(); } catch (e) { setErr(errMsg(e)); setBusy(false); } }}>{busy ? <Spinner /> : confirmLabel}</button>
    </Modal>
  );
}
