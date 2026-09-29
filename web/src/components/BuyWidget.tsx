import { useEffect, useMemo, useState } from 'react';
import { get } from '../lib/api';
import { useApp, type Product } from '../lib/app-state';
import { CATEGORY_LABEL, NETWORK_META, cedisToMinor, dataSize, ghs, guessNetwork, normalizePhone, type Network } from '../lib/format';
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

/** Live check of a Ghana number while it is typed: format, length and which network the prefix belongs to. */
export function phoneStatus(value: string, networks: Network[], selected?: string | null): { tone: 'ok' | 'warn' | 'bad' | 'wait'; text: string } | null {
  const raw = value.replace(/[^\d+]/g, '');
  if (!raw.replace('+', '')) return null;
  const n = normalizePhone(raw);
  if (n) {
    const guess = guessNetwork(n, networks);
    if (!guess) return { tone: 'bad', text: 'Invalid number: this is not an MTN, Telecel or AT number' };
    const name = NETWORK_META[guess]?.name || guess;
    if (selected && selected !== guess) return { tone: 'warn', text: `This looks like ${/^(MTN|AT)$/.test(guess) ? 'an' : 'a'} ${name} number, but you picked ${NETWORK_META[selected]?.name || selected}. Only continue if the number was moved (ported).` };
    return { tone: 'ok', text: `Valid ${name} number` };
  }
  let d = raw.replace(/^\+/, '');
  if (d.startsWith('233')) d = '0' + d.slice(3);
  else if (/^[2-9]/.test(d)) d = '0' + d;
  if (!/^0[2-5]?$/.test(d.slice(0, 2)) || (d.length >= 2 && !/^0[2-5]/.test(d))) return { tone: 'bad', text: 'Invalid number: Ghana mobile numbers start with 02 or 05' };
  if (d.length < 10) { const left = 10 - d.length; return { tone: 'wait', text: `Keep typing… ${left} more digit${left === 1 ? '' : 's'}` }; }
  return { tone: 'bad', text: 'Invalid number: Ghana numbers have 10 digits, e.g. 024 123 4567' };
}

export function PhoneInput({ value, onChange, id = 'phone', network }: { value: string; onChange: (v: string) => void; id?: string; network?: string | null }) {
  const { user, config } = useApp();
  const status = config ? phoneStatus(value, config.networks, network) : null;
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
        <input id={id} className={`input ${status ? `phone-${status.tone}` : ''}`} inputMode="tel" autoComplete="tel" placeholder="e.g. 0551234567" value={value} onChange={(e) => onChange(e.target.value)} maxLength={16} aria-describedby={`${id}-check`} aria-invalid={status?.tone === 'bad' || undefined} />
        {contactsSupported && <button type="button" className="icon-btn addon" onClick={pick} aria-label="Choose from contacts"><IcContacts /></button>}
      </div>
      <div id={`${id}-check`} className={`phone-check ${status ? `is-${status.tone}` : ''}`} aria-live="polite">
        {status && <><span className="phone-check-ic" aria-hidden="true">{status.tone === 'ok' ? '✓' : status.tone === 'bad' ? '✕' : status.tone === 'warn' ? '!' : '…'}</span>{status.text}</>}
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
      <label className="step-label" htmlFor="buy-phone" style={{ display: 'block' }}>2. Enter phone number</label>
      <div style={{ marginBottom: 16 }}><PhoneInput id="buy-phone" value={phone} onChange={setPhone} network={network} /></div>

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
