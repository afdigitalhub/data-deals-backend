import { useEffect, useMemo, useState } from 'react';
import { get } from '../lib/api';
import { useApp, type Product } from '../lib/app-state';
import { CATEGORY_LABEL, NETWORK_META, cedisToMinor, dataSize, ghs, guessNetwork, normalizePhone } from '../lib/format';
import { navigate } from '../lib/router';
import { Alert, NetworkBadge, Spinner } from './ui';
import { IcContacts, IcPhone, IcWifi } from './icons';

export type Mode = 'airtime' | 'data';

export function productLabel(p: Product) {
  return p.kind === 'data' ? `${p.dataMb ? dataSize(p.dataMb) : p.name}${p.validity ? ` · ${p.validity}` : ''}` : p.name;
}

export function checkoutUrl(p: { productId: number; network: string; phone: string; amountMinor?: number }) {
  const q = new URLSearchParams({ product: String(p.productId), network: p.network, phone: p.phone });
  if (p.amountMinor) q.set('amount', String(p.amountMinor));
  return `/checkout?${q}`;
}

export function NetworkPicker({ value, onChange }: { value: string | null; onChange: (c: string) => void }) {
  const { config } = useApp();
  const nets = config?.networks ?? [{ code: 'MTN', name: 'MTN', prefixes: [] }, { code: 'TELECEL', name: 'Telecel', prefixes: [] }, { code: 'AT', name: 'AT', prefixes: [] }];
  return (
    <div className="nets" role="radiogroup" aria-label="Network">
      {nets.map((n) => (
        <button key={n.code} type="button" role="radio" aria-checked={value === n.code} className={`net ${value === n.code ? 'active' : ''}`} onClick={() => onChange(n.code)}>
          <NetworkBadge code={n.code} />
          {NETWORK_META[n.code]?.name || n.name}
        </button>
      ))}
    </div>
  );
}

export function PhoneInput({ value, onChange, id = 'phone' }: { value: string; onChange: (v: string) => void; id?: string }) {
  const { user } = useApp();
  const [saved, setSaved] = useState<{ id: number; label: string; phone: string }[]>([]);
  const contactsSupported = typeof navigator !== 'undefined' && 'contacts' in navigator && 'select' in (navigator as any).contacts;
  useEffect(() => {
    if (user) get('/api/account/recipients').then((r) => setSaved(r.recipients)).catch(() => {});
  }, [user]);
  const pick = async () => {
    try {
      const res = await (navigator as any).contacts.select(['tel'], { multiple: false });
      const tel = res?.[0]?.tel?.[0];
      if (tel) onChange(normalizePhone(tel) || tel);
    } catch { /* user cancelled */ }
  };
  return (
    <>
      <div className="input-group">
        <input id={id} className="input" inputMode="tel" autoComplete="tel" placeholder="e.g. 0551234567" value={value} onChange={(e) => onChange(e.target.value)} maxLength={16} />
        {contactsSupported && <button type="button" className="icon-btn addon" onClick={pick} aria-label="Choose from contacts"><IcContacts /></button>}
      </div>
      {saved.length > 0 && (
        <div className="amount-chips" aria-label="Saved numbers">
          {saved.slice(0, 6).map((s) => <button key={s.id} type="button" className={`chip ${normalizePhone(value) === s.phone ? 'active' : ''}`} onClick={() => onChange(s.phone)}>{s.label}</button>)}
        </div>
      )}
    </>
  );
}

export function BuyWidget({ initialMode = 'data' }: { initialMode?: Mode }) {
  const { config, products, loadProducts } = useApp();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [network, setNetwork] = useState<string | null>(null);
  const [manualNetwork, setManualNetwork] = useState(false);
  const [phone, setPhone] = useState('');
  const [productId, setProductId] = useState<number | ''>('');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loadErr, setLoadErr] = useState(false);

  useEffect(() => { loadProducts().catch(() => setLoadErr(true)); }, [loadProducts]);

  const normalized = normalizePhone(phone);
  const suggested = config ? guessNetwork(phone, config.networks) : null;
  useEffect(() => {
    if (!manualNetwork && suggested) setNetwork(suggested);
  }, [suggested, manualNetwork]);

  const forNetwork = useMemo(() => (products || []).filter((p) => p.network === network && p.kind === mode), [products, network, mode]);
  const airtime = mode === 'airtime' ? forNetwork[0] : undefined;
  useEffect(() => { setProductId(''); }, [network, mode]);

  const amountMinor = cedisToMinor(amount);
  const chips = airtime ? [500, 1000, 2000, 5000, 10000].filter((v) => v >= (airtime.airtimeMinMinor || 0) && v <= (airtime.airtimeMaxMinor || Infinity)) : [];

  const submit = () => {
    setError(null);
    if (!network) return setError('Choose the network');
    if (!normalized) return setError('Enter a valid Ghana mobile number, e.g. 0551234567');
    if (mode === 'data') {
      if (!productId) return setError('Choose a data bundle');
      navigate(checkoutUrl({ productId: Number(productId), network, phone: normalized }));
    } else {
      if (!airtime) return setError(`Airtime for ${NETWORK_META[network]?.name} is not available yet`);
      if (!Number.isFinite(amountMinor) || amountMinor <= 0) return setError('Enter the airtime amount');
      if (amountMinor < (airtime.airtimeMinMinor || 0) || amountMinor > (airtime.airtimeMaxMinor || Infinity)) return setError(`Amount must be between ${ghs(airtime.airtimeMinMinor)} and ${ghs(airtime.airtimeMaxMinor)}`);
      navigate(checkoutUrl({ productId: airtime.id, network, phone: normalized, amountMinor }));
    }
  };

  const noneOnSale = products !== null && network && forNetwork.length === 0;

  return (
    <div className="card-elev buy" id="buy">
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={mode === 'airtime'} className={`tab ${mode === 'airtime' ? 'active' : ''}`} onClick={() => setMode('airtime')}><IcPhone />Airtime</button>
        <button role="tab" aria-selected={mode === 'data'} className={`tab ${mode === 'data' ? 'active' : ''}`} onClick={() => setMode('data')}><IcWifi />Data Bundles</button>
      </div>
      <p className="step-label">1. Select network</p>
      <NetworkPicker value={network} onChange={(c) => { setNetwork(c); setManualNetwork(true); }} />
      {suggested && network && suggested !== network && normalized && (
        <p className="net-note">This number usually belongs to {NETWORK_META[suggested]?.name}. Keep {NETWORK_META[network]?.name} only if the number was moved (ported).</p>
      )}
      <label className="step-label" htmlFor="buy-phone" style={{ display: 'block' }}>2. Enter phone number</label>
      <div style={{ marginBottom: 16 }}><PhoneInput id="buy-phone" value={phone} onChange={setPhone} /></div>

      {mode === 'data' ? (
        <>
          <label className="step-label" htmlFor="buy-bundle" style={{ display: 'block' }}>3. Choose data bundle</label>
          {products === null && !loadErr ? <div className="skeleton" style={{ height: 50, marginBottom: 16 }} /> : (
            <select id="buy-bundle" className="select" style={{ marginBottom: 16 }} value={productId} onChange={(e) => setProductId(e.target.value ? Number(e.target.value) : '')} disabled={!network || !!noneOnSale}>
              <option value="">{!network ? 'Select a network first' : noneOnSale ? 'No bundles on sale yet' : 'Select bundle'}</option>
              {forNetwork.map((p) => <option key={p.id} value={p.id}>{productLabel(p)} — {ghs((p.priceMinor || 0) + p.feeMinor)}{p.category && p.category !== 'other' ? ` (${CATEGORY_LABEL[p.category]})` : ''}</option>)}
            </select>
          )}
        </>
      ) : (
        <>
          <label className="step-label" htmlFor="buy-amount" style={{ display: 'block' }}>3. Enter amount</label>
          <div className="prefix-input"><span>GHS</span><input id="buy-amount" inputMode="decimal" placeholder={airtime ? `${((airtime.airtimeMinMinor || 100) / 100).toFixed(0)} – ${((airtime.airtimeMaxMinor || 0) / 100).toFixed(0)}` : '0.00'} value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} disabled={!!noneOnSale} /></div>
          <div className="amount-chips" style={{ marginBottom: 16 }}>
            {chips.map((c) => <button type="button" key={c} className={`chip ${amountMinor === c ? 'active' : ''}`} onClick={() => setAmount(String(c / 100))}>GHS {c / 100}</button>)}
          </div>
          {airtime && airtime.airtimeFeeBps > 0 && <p className="tiny muted" style={{ marginTop: -8 }}>A service fee of {(airtime.airtimeFeeBps / 100).toFixed(2)}% is added at checkout.</p>}
        </>
      )}
      {noneOnSale && <Alert kind="info">{mode === 'data' ? 'Data bundles' : 'Airtime'} for {NETWORK_META[network!]?.name} will be available soon.</Alert>}
      {loadErr && <Alert kind="error">We couldn't load prices. Check your connection and refresh.</Alert>}
      {error && <div style={{ marginBottom: 12 }}><Alert>{error}</Alert></div>}
      <button className="btn btn-yellow btn-block btn-lg" onClick={submit} disabled={!!noneOnSale}>
        {products === null && !loadErr ? <Spinner /> : mode === 'data' ? 'Buy Data Bundle' : 'Buy Airtime'}
      </button>
    </div>
  );
}
