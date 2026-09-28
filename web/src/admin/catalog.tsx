import { useState } from 'react';
import { patch, post, put } from '../lib/api';
import { useApp } from '../lib/app-state';
import { CATEGORY_LABEL, NETWORK_META, cedisToMinor, dataSize, dateTime, ghs, minorToCedis } from '../lib/format';
import { usePageTitle } from '../lib/router';
import { Alert, Field, Input, Loading, Modal, NetworkBadge, Select, Spinner, StatusPill, Textarea, errMsg } from '../components/ui';
import { IcPlus } from '../components/icons';
import { Panel, useLoad } from './common';

export function ProductsPage() {
  usePageTitle('Products');
  const { user } = useApp();
  const canManage = !!user?.permissions.includes('products.manage');
  const { data, error, reload } = useLoad<any>('/api/admin/products');
  const sup = useLoad<any>('/api/admin/suppliers');
  const [editing, setEditing] = useState<any | null>(null);
  const [golive, setGolive] = useState<any | null>(null);
  const [history, setHistory] = useState<any | null>(null);
  const [net, setNet] = useState('');
  const [status, setStatus] = useState('');
  if (error) return <Alert>{error}</Alert>;
  const list = (data?.products || []).filter((p: any) => (!net || p.network_code === net) && (!status || p.status === status));
  const drafts = (data?.products || []).filter((p: any) => p.status === 'draft').length;
  const setStatusFor = async (p: any, s: string) => { try { await post(`/api/admin/products/${p.id}/status`, { status: s }); reload(); } catch (e) { alert(errMsg(e)); } };
  return (
    <>
      <div className="admin-head"><h1>Products</h1>{canManage && <button className="btn btn-yellow btn-sm" onClick={() => setEditing({ kind: 'data', network_code: 'MTN', category: 'weekly', fee_minor: 0, manual_fulfilment_allowed: true, sort_order: 0 })}><IcPlus width={16} height={16} />New product</button>}</div>
      {drafts > 0 && <div style={{ marginBottom: 12 }}><Alert kind="info">{drafts} product{drafts > 1 ? 's are' : ' is'} in <b>draft</b> and not visible to customers. Check each price and supplier cost, then press <b>Go live</b>. Products imported from the old site are drafts until you confirm them.</Alert></div>}
      <div className="toolbar">
        <select className="select" value={net} onChange={(e) => setNet(e.target.value)} aria-label="Network"><option value="">All networks</option><option value="MTN">MTN</option><option value="TELECEL">Telecel</option><option value="AT">AT</option></select>
        <select className="select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status"><option value="">All statuses</option><option value="live">Live</option><option value="draft">Draft</option><option value="paused">Paused</option></select>
      </div>
      {!data ? <Loading /> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Network</th><th>Product</th><th>Category</th><th className="num">Selling price</th><th className="num">Fee</th><th className="num">Supplier cost</th><th className="num">Margin</th><th>Delivery</th><th>Status</th><th></th></tr></thead>
            <tbody>{list.map((p: any) => {
              const air = p.kind === 'airtime';
              const margin = !air && p.cost_minor !== null ? p.price_minor + p.fee_minor - p.cost_minor : null;
              return (
                <tr key={p.id}>
                  <td><NetworkBadge code={p.network_code} size="sm" /></td>
                  <td style={{ minWidth: 170 }}><b>{air ? p.name : `${p.data_mb ? dataSize(p.data_mb) : p.name}`}</b><div className="tiny muted">{air ? `${ghs(p.airtime_min_minor)} – ${ghs(p.airtime_max_minor)}` : p.validity_label || ''}</div>{p.admin_note && <div className="tiny muted" title={p.admin_note} style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.admin_note}</div>}</td>
                  <td>{CATEGORY_LABEL[p.category]}</td>
                  <td className="num">{air ? 'Face value' : ghs(p.price_minor)}</td>
                  <td className="num nowrap">{air ? `${(p.airtime_fee_bps / 100).toFixed(2)}%` : ghs(p.fee_minor)}</td>
                  <td className="num">{air ? (p.airtime_cost_bps !== null ? `${(p.airtime_cost_bps / 100).toFixed(2)}% of value` : <span className="muted">Not set</span>) : p.cost_minor !== null ? ghs(p.cost_minor) : <span className="muted">Not set</span>}</td>
                  <td className="num">{air ? (p.airtime_cost_bps !== null ? `${((10000 + p.airtime_fee_bps - p.airtime_cost_bps) / 100).toFixed(2)}%` : '—') : margin !== null ? <span style={{ color: margin < 0 ? 'var(--danger)' : undefined }}>{ghs(margin)}</span> : '—'}</td>
                  <td className="small">{p.supplier_name ? `${p.supplier_name}${p.supplier_product_code ? ` (${p.supplier_product_code})` : ''}` : 'Manual'}{p.supplier_name && p.manual_fulfilment_allowed ? ' + manual' : ''}</td>
                  <td><StatusPill status={p.status} /></td>
                  <td className="nowrap">
                    {canManage && <>
                      <button className="btn btn-light btn-sm" onClick={() => setEditing(p)}>Edit</button>{' '}
                      {p.status !== 'live' ? <button className="btn btn-yellow btn-sm" onClick={() => setGolive(p)}>Go live</button> : <button className="btn btn-light btn-sm" onClick={() => setStatusFor(p, 'paused')}>Pause</button>}{' '}
                    </>}
                    <button className="btn btn-ghost btn-sm" onClick={() => setHistory(p)}>History</button>
                  </td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      )}
      {editing && <ProductForm initial={editing} suppliers={sup.data?.suppliers || []} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
      {golive && <GoLive p={golive} onClose={() => setGolive(null)} onDone={() => { setGolive(null); reload(); }} />}
      {history && <HistoryModal p={history} onClose={() => setHistory(null)} />}
    </>
  );
}

function GoLive({ p, onClose, onDone }: { p: any; onClose: () => void; onDone: () => void }) {
  const [ok, setOk] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const air = p.kind === 'airtime';
  return (
    <Modal title="Put this product on sale?" onClose={onClose}>
      <div className="card-soft" style={{ marginBottom: 12 }}>
        <div className="row"><NetworkBadge code={p.network_code} /><b>{air ? p.name : `${dataSize(p.data_mb) || p.name} · ${p.validity_label || ''}`}</b></div>
        <div className="small" style={{ marginTop: 8 }}>{air ? <>Customers pay face value + {(p.airtime_fee_bps / 100).toFixed(2)}% fee, between {ghs(p.airtime_min_minor)} and {ghs(p.airtime_max_minor)}.</> : <>Customers pay <b>{ghs(p.price_minor + p.fee_minor)}</b>.</>} Supplier cost: {air ? (p.airtime_cost_bps !== null ? `${(p.airtime_cost_bps / 100).toFixed(2)}%` : 'not set') : p.cost_minor !== null ? ghs(p.cost_minor) : 'not set'}.</div>
        <div className="small">Delivery: {p.supplier_name ? `${p.supplier_name}${p.manual_fulfilment_allowed ? ', with manual fallback' : ''}` : 'manual by admins'}</div>
      </div>
      {(air ? p.airtime_cost_bps === null : p.cost_minor === null) && <div style={{ marginBottom: 12 }}><Alert kind="warn">Supplier cost is not recorded, so margins for this product can't be calculated.</Alert></div>}
      <label className="check" style={{ marginBottom: 14 }}><input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} /><span>I confirm this price is correct and we can actually deliver this product.</span></label>
      {err && <div style={{ marginBottom: 12 }}><Alert>{err}</Alert></div>}
      <button className="btn btn-yellow btn-block" disabled={!ok || busy} onClick={async () => { setBusy(true); setErr(null); try { await post(`/api/admin/products/${p.id}/status`, { status: 'live', confirm_pricing: true }); onDone(); } catch (e) { setErr(errMsg(e)); setBusy(false); } }}>{busy ? <Spinner /> : 'Go live'}</button>
    </Modal>
  );
}

function HistoryModal({ p, onClose }: { p: any; onClose: () => void }) {
  const { data } = useLoad<any>(`/api/admin/products/${p.id}/history`);
  return (
    <Modal title="Change history" onClose={onClose}>
      {!data ? <Loading /> : data.history.length === 0 ? <p className="muted">No changes recorded yet.</p> : (
        <ul className="event-list">{data.history.map((h: any) => (
          <li key={h.id}><b>{h.action.replace('product.', '').replace('_', ' ')}</b> by {h.actor || 'system'} <span className="tiny muted">· {dateTime(h.created_at)}</span>
            <div className="tiny muted">{describeChange(h.before_data, h.after_data)}</div></li>
        ))}</ul>
      )}
    </Modal>
  );
}
function describeChange(b: any, a: any) {
  if (!b || !a) return '';
  const keys = ['status', 'price_minor', 'fee_minor', 'cost_minor', 'name', 'validity_label', 'airtime_fee_bps', 'airtime_cost_bps', 'airtime_min_minor', 'airtime_max_minor', 'supplier_id', 'supplier_product_code', 'manual_fulfilment_allowed'];
  return keys.filter((k) => k in a && JSON.stringify(a[k]) !== JSON.stringify(b[k])).map((k) => `${k.replace(/_minor$/, '').replace(/_/g, ' ')}: ${fmt(k, b[k])} → ${fmt(k, a[k])}`).join(' · ');
}
const fmt = (k: string, v: any) => (v === null || v === undefined ? '—' : k.endsWith('_minor') ? ghs(v) : k.endsWith('_bps') ? `${(v / 100).toFixed(2)}%` : String(v));

function ProductForm({ initial, suppliers, onClose, onSaved }: { initial: any; suppliers: any[]; onClose: () => void; onSaved: () => void }) {
  const isNew = !initial.id;
  const [f, setF] = useState({
    kind: initial.kind, network_code: initial.network_code, name: initial.name || '', category: initial.category || (initial.kind === 'airtime' ? 'airtime' : 'weekly'),
    data_gb: initial.data_mb ? String(+(initial.data_mb / 1024).toFixed(3)) : '', validity_label: initial.validity_label || '',
    price: minorToCedis(initial.price_minor), fee: minorToCedis(initial.fee_minor ?? 0), cost: minorToCedis(initial.cost_minor),
    air_min: minorToCedis(initial.airtime_min_minor ?? 100), air_max: minorToCedis(initial.airtime_max_minor ?? 50000),
    air_fee: initial.airtime_fee_bps !== undefined ? String(initial.airtime_fee_bps / 100) : '0', air_cost: initial.airtime_cost_bps !== null && initial.airtime_cost_bps !== undefined ? String(initial.airtime_cost_bps / 100) : '',
    manual: initial.manual_fulfilment_allowed ?? true, supplier_id: initial.supplier_id ? String(initial.supplier_id) : '', supplier_product_code: initial.supplier_product_code || '',
    sort_order: String(initial.sort_order ?? 0), admin_note: initial.admin_note || '',
  });
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value });
  const air = f.kind === 'airtime';
  const nOrNull = (v: string) => (v.trim() === '' ? null : cedisToMinor(v));
  const bps = (v: string) => (v.trim() === '' ? null : Math.round(Number(v) * 100));
  const save = async () => {
    setBusy(true); setErr(null);
    const mb = f.data_gb.trim() ? Math.round(Number(f.data_gb) * 1024) : null;
    const body: any = {
      kind: f.kind, network_code: f.network_code, name: f.name.trim() || (air ? `${NETWORK_META[f.network_code]?.name} Airtime` : mb ? dataSize(mb) : ''), category: air ? 'airtime' : f.category,
      data_mb: air ? null : mb, validity_label: air ? null : f.validity_label || null,
      price_minor: air ? null : nOrNull(f.price), fee_minor: air ? 0 : cedisToMinor(f.fee || '0'), cost_minor: air ? null : nOrNull(f.cost),
      airtime_min_minor: air ? nOrNull(f.air_min) : null, airtime_max_minor: air ? nOrNull(f.air_max) : null,
      airtime_fee_bps: air ? bps(f.air_fee) ?? 0 : 0, airtime_cost_bps: air ? bps(f.air_cost) : null,
      manual_fulfilment_allowed: f.manual, supplier_id: f.supplier_id ? Number(f.supplier_id) : null, supplier_product_code: f.supplier_product_code || null,
      sort_order: Number(f.sort_order) || 0, admin_note: f.admin_note || null,
    };
    try { if (isNew) await post('/api/admin/products', body); else await put(`/api/admin/products/${initial.id}`, body); onSaved(); } catch (e) { setErr(e); setBusy(false); }
  };
  const autoSuppliers = suppliers.filter((s) => s.automated);
  return (
    <Modal title={isNew ? 'New product' : 'Edit product'} onClose={onClose}>
      {!isNew && initial.status === 'live' && <div style={{ marginBottom: 12 }}><Alert kind="warn">This product is live. Price changes apply to new orders immediately; existing orders keep the price they were bought at.</Alert></div>}
      <div className="grid-2">
        <Field label="Type"><Select value={f.kind} onChange={set('kind')} disabled={!isNew}><option value="data">Data bundle</option><option value="airtime">Airtime</option></Select></Field>
        <Field label="Network"><Select value={f.network_code} onChange={set('network_code')}><option value="MTN">MTN</option><option value="TELECEL">Telecel</option><option value="AT">AT</option></Select></Field>
      </div>
      {!air ? (
        <>
          <div className="grid-2">
            <Field label="Data size (GB)" hint="e.g. 1, 2.5, 0.5 for 512MB"><Input inputMode="decimal" value={f.data_gb} onChange={set('data_gb')} /></Field>
            <Field label="Validity shown to customers" hint="e.g. 7 days"><Input value={f.validity_label} onChange={set('validity_label')} /></Field>
            <Field label="Category"><Select value={f.category} onChange={set('category')}>{['daily', 'weekly', 'monthly', 'non_expiry', 'other'].map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}</Select></Field>
            <Field label="Display name (optional)" hint="Defaults to the size"><Input value={f.name} onChange={set('name')} /></Field>
            <Field label="Selling price (GHS)"><Input inputMode="decimal" value={f.price} onChange={set('price')} /></Field>
            <Field label="Customer service fee (GHS)"><Input inputMode="decimal" value={f.fee} onChange={set('fee')} /></Field>
            <Field label="Supplier cost (GHS)" hint="What you pay the supplier. Never shown to customers."><Input inputMode="decimal" value={f.cost} onChange={set('cost')} /></Field>
          </div>
        </>
      ) : (
        <div className="grid-2">
          <Field label="Minimum amount (GHS)"><Input inputMode="decimal" value={f.air_min} onChange={set('air_min')} /></Field>
          <Field label="Maximum amount (GHS)"><Input inputMode="decimal" value={f.air_max} onChange={set('air_max')} /></Field>
          <Field label="Customer fee (%)" hint="Added on top of the airtime value"><Input inputMode="decimal" value={f.air_fee} onChange={set('air_fee')} /></Field>
          <Field label="Supplier cost (% of value)" hint="e.g. 97 if you pay GHS 9.70 for GHS 10"><Input inputMode="decimal" value={f.air_cost} onChange={set('air_cost')} /></Field>
        </div>
      )}
      <div className="grid-2">
        <Field label="Automatic supplier" hint={autoSuppliers.length ? 'Only connected suppliers deliver automatically' : 'No automatic supplier connected yet'}>
          <Select value={f.supplier_id} onChange={set('supplier_id')}><option value="">None (manual delivery)</option>{autoSuppliers.map((s) => <option key={s.id} value={s.id}>{s.name}{s.connectionStatus !== 'connected' ? ' — not connected' : ''}</option>)}</Select>
        </Field>
        <Field label="Supplier product code" hint="DataMart: bundle size in GB, e.g. 5. Leave empty to use this bundle's size."><Input value={f.supplier_product_code} onChange={set('supplier_product_code')} disabled={!f.supplier_id} /></Field>
      </div>
      <label className="check" style={{ marginBottom: 14 }}><input type="checkbox" checked={f.manual} onChange={set('manual')} /><span>Allow manual delivery by admins (used when no automatic supplier can deliver)</span></label>
      <div className="grid-2">
        <Field label="Sort order" hint="Lower shows first"><Input inputMode="numeric" value={f.sort_order} onChange={set('sort_order')} /></Field>
      </div>
      <Field label="Internal note (admins only)"><Textarea value={f.admin_note} onChange={set('admin_note')} style={{ minHeight: 70 }} /></Field>
      {err ? <div style={{ marginBottom: 12 }}><Alert>{errMsg(err)}</Alert></div> : null}
      <button className="btn btn-dark btn-block" disabled={busy} onClick={save}>{busy ? <Spinner /> : isNew ? 'Create as draft' : 'Save changes'}</button>
      {isNew && <p className="tiny muted" style={{ marginTop: 8 }}>New products start as drafts. Customers can't see them until you press Go live.</p>}
    </Modal>
  );
}

export function SuppliersPage() {
  usePageTitle('Suppliers & networks');
  const { user } = useApp();
  const canManage = !!user?.permissions.includes('suppliers.manage');
  const { data, error, reload } = useLoad<any>('/api/admin/suppliers');
  const [attemptsFor, setAttemptsFor] = useState<any | null>(null);
  const [testing, setTesting] = useState<number | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (error) return <Alert>{error}</Alert>;
  if (!data) return <Loading />;
  return (
    <>
      <div className="admin-head"><h1>Suppliers & networks</h1></div>
      <Alert kind="info">Automatic delivery only runs through a supplier that is <b>connected</b> (credentials set and a successful connection test). Until then, paid orders go to the manual delivery queue. We never claim a connection that hasn't been tested.</Alert>
      {msg && <div style={{ marginTop: 12 }}><Alert kind={msg.ok ? 'success' : 'warn'}>{msg.text}</Alert></div>}
      <div className="grid-2" style={{ marginTop: 16, gap: 16 }}>
        {data.suppliers.map((s: any) => (
          <Panel key={s.id} title={<span className="row" style={{ gap: 8 }}>{s.name} <StatusPill status={s.connectionStatus} /></span>}>
            <dl className="kv">
              <dt>Type</dt><dd>{s.automated ? 'Automatic (API)' : 'Manual by admins'}</dd>
              <dt>Networks</dt><dd className="row" style={{ gap: 6 }}>{s.networks.map((n: string) => <NetworkBadge key={n} code={n} size="sm" />)}</dd>
              <dt>Enabled</dt><dd>{s.is_enabled ? 'Yes' : 'No'}</dd>
              <dt>Products using it</dt><dd>{s.products}</dd>
              <dt>Requests</dt><dd>{s.attempts} total · {s.problem_attempts} failed/unknown</dd>
              <dt>Last check</dt><dd>{s.last_check_at ? `${dateTime(s.last_check_at)} — ${s.last_check_ok ? 'OK' : 'Failed'}: ${s.last_check_message}` : 'Never tested'}</dd>
              <dt>Balance</dt><dd>{s.balance_minor !== null ? `${ghs(s.balance_minor)} (${dateTime(s.balance_checked_at)})` : <span className="muted">Not provided</span>}</dd>
              {s.notes && <><dt>Notes</dt><dd>{s.notes}</dd></>}
            </dl>
            {s.missingConfig.length > 0 && s.automated && (
              <div style={{ marginTop: 12 }}><Alert kind="warn"><b>Needed before it can connect:</b><ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{s.missingConfig.map((m: string) => <li key={m}>{m}</li>)}</ul></Alert></div>
            )}
            <div className="row" style={{ marginTop: 12 }}>
              {canManage && s.automated && <button className="btn btn-light btn-sm" disabled={testing === s.id} onClick={async () => { setTesting(s.id); try { const r = await post(`/api/admin/suppliers/${s.id}/test`); setMsg({ ok: !!r.result.ok, text: `${s.name}: ${r.result.message}` }); reload(); } catch (e) { setMsg({ ok: false, text: errMsg(e) }); } finally { setTesting(null); } }}>{testing === s.id ? <Spinner /> : 'Test connection'}</button>}
              {canManage && s.automated && (s.is_enabled || s.missingConfig.length === 0) && <button className="btn btn-light btn-sm" onClick={async () => { try { await patch(`/api/admin/suppliers/${s.id}`, { is_enabled: !s.is_enabled, notes: s.notes }); reload(); } catch (e) { setMsg({ ok: false, text: errMsg(e) }); } }}>{s.is_enabled ? 'Disable' : 'Enable'}</button>}
              <button className="btn btn-ghost btn-sm" onClick={() => setAttemptsFor(s)}>Request history</button>
            </div>
          </Panel>
        ))}
      </div>
      {attemptsFor && <AttemptsModal s={attemptsFor} onClose={() => setAttemptsFor(null)} />}
    </>
  );
}

function AttemptsModal({ s, onClose }: { s: any; onClose: () => void }) {
  const { data } = useLoad<any>(`/api/admin/suppliers/${s.id}/attempts`);
  return (
    <Modal title={`${s.name} — requests`} onClose={onClose}>
      {!data ? <Loading /> : data.attempts.length === 0 ? <p className="muted">No requests yet.</p> : (
        <ul className="event-list">{data.attempts.map((a: any) => <li key={a.id}><div className="row between"><span className="mono small">{a.request_id}</span><StatusPill status={a.status} /></div><div className="tiny muted">{a.order_reference} · {dateTime(a.started_at)}{a.supplier_reference ? ` · ref ${a.supplier_reference}` : ''}{a.error_message ? ` · ${a.error_message}` : ''}</div></li>)}</ul>
      )}
    </Modal>
  );
}
