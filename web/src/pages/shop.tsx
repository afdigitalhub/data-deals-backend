import { useEffect, useMemo, useState } from 'react';
import { useApp, type Product } from '../lib/app-state';
import { validityText, CATEGORY_LABEL, NETWORK_META, dataSize, ghs, guessNetwork, normalizePhone } from '../lib/format';
import { Link, navigate, useLocation, usePageTitle } from '../lib/router';
import { SiteLayout } from '../components/layout';
import { BuyWidget, PhoneInput, checkoutUrl, productLabel } from '../components/BuyWidget';
import { Alert, Empty, Modal, NetworkBadge } from '../components/ui';
import { twiGreeting, dailyTwiLine } from '../lib/greeting';
import { IcArrow, IcBolt, IcGlobe, IcHeadset, IcSearch, IcShield, IcTag, IcWifi } from '../components/icons';

export function HomePage() {
  usePageTitle('Data Deals — Airtime & Data Bundles for MTN, Telecel and AT');
  const { user, products, loadProducts } = useApp();
  useEffect(() => { loadProducts().catch(() => {}); }, [loadProducts]);
  const featured = (products || []).filter((p) => p.kind === 'data').slice(0, 6);
  const g = twiGreeting();
  const line = dailyTwiLine();
  return (
    <SiteLayout onYellow>
      <section className="hero">
        <div className="container hero-inner">
          <div className="hero-copy">
            {user ? (
              <Link to="/account" className="greet-card">
                <span className="greet-avatar" aria-hidden="true">{(user.fullName || '?').trim().charAt(0).toUpperCase()}</span>
                <span className="greet-text">
                  <span className="greet-hello">{g.twi}, <b>{user.fullName.split(' ')[0]}</b> 👋</span>
                  <span className="greet-sub"><b>{line.twi}</b> {line.en}</span>
                </span>
                <span className="greet-go">Dashboard <IcArrow width={16} height={16} /></span>
              </Link>
            ) : (
              <div className="hero-kicker hero-kicker-split"><span className="kick-hi">{g.twi}! Akwaaba 👋</span><span className="kick-rest">FAST <i /> SECURE <i /> RELIABLE</span></div>
            )}
            <h1>Stay Connected.<span className="accent">Always.</span></h1>
            <p className="lead">Buy airtime and data bundles for MTN, Telecel and AT. Fast, simple and reliable.</p>
            <div className="features">
              <div className="feature"><div className="ic"><IcBolt /></div>Quick<br />checkout</div>
              <div className="feature"><div className="ic"><IcShield /></div>Secure<br />payments</div>
              <div className="feature"><div className="ic"><IcTag /></div>Clear<br />prices</div>
              <div className="feature"><div className="ic"><IcHeadset /></div>Real<br />support</div>
            </div>
            <div className="row">
              <a href="#buy" className="btn btn-dark btn-lg" onClick={(e) => { e.preventDefault(); document.getElementById('buy')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>Buy Now <IcArrow width={18} height={18} /></a>
              {!user && <Link to="/register" className="btn btn-outline btn-lg">Create Account</Link>}
              {user && <Link to="/account" className="btn btn-outline btn-lg">My dashboard</Link>}
            </div>
          </div>
          <img className="hero-lady" src="/images/hero-lady.webp" alt="" width="372" height="540" decoding="async" />
          <BuyWidget />
        </div>
      </section>

      <section className="container lady-banner-wrap">
        <div className="lady-banner">
          <div className="lady-banner-text">
            <h2>Data and airtime in seconds</h2>
            <p>MTN, Telecel and AT. Pay with Mobile Money.</p>
            <a href="#buy" className="btn btn-dark btn-sm" onClick={(e) => { e.preventDefault(); document.getElementById('buy')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>Buy Now</a>
          </div>
          <img src="/images/hero-lady.webp" alt="" width="372" height="540" loading="lazy" decoding="async" />
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="row between" style={{ alignItems: 'flex-end', marginBottom: 18 }}>
            <div><div className="eyebrow">Popular right now</div><h2 style={{ margin: 0 }}>Data bundles</h2></div>
            <Link to="/data-bundles" className="link">See all bundles</Link>
          </div>
          {products === null ? <div className="bundle-list">{[0, 1, 2].map((i) => <div key={i} className="skeleton" style={{ height: 84 }} />)}</div>
            : featured.length ? <div className="bundle-list">{featured.map((p) => <BundleCard key={p.id} p={p} />)}</div>
            : <div className="card-soft"><Empty icon={<IcWifi />} title="Bundles are being set up">Prices will appear here as soon as they are approved for sale.</Empty></div>}
        </div>
      </section>

      <section className="section" style={{ background: 'var(--soft)' }}>
        <div className="container">
          <div className="eyebrow">How it works</div>
          <h2>Top up in under a minute</h2>
          <div className="grid-3" style={{ marginTop: 18 }}>
            {[
              ['Choose', 'Pick MTN, Telecel or AT, enter the number and choose a bundle or airtime amount.'],
              ['Pay securely', 'Pay with Mobile Money or card on Paystack\'s secure checkout. We never see your PIN or card details.'],
              ['Track it', 'Follow your order live and get a receipt. If anything goes wrong, our team will fix it or refund you.'],
            ].map(([t, d], i) => (
              <div className="card" key={t}><div className="net-badge" style={{ background: 'var(--yellow)', marginBottom: 12 }}>{i + 1}</div><h3>{t}</h3><p className="muted small" style={{ margin: 0 }}>{d}</p></div>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="promo">
            <div><h2 style={{ margin: 0 }}>Buying for someone else?</h2><p style={{ margin: '6px 0 0' }}>Enter their number at checkout. Save numbers you use often in your account.</p></div>
            <Link to={user ? '/account/recipients' : '/register'} className="btn btn-dark">{user ? 'Saved numbers' : 'Create free account'}</Link>
          </div>
        </div>
      </section>
    </SiteLayout>
  );
}

export function BundleCard({ p, onBuy }: { p: Product; onBuy?: () => void }) {
  return (
    <div className="bundle">
      <div className="globe"><IcGlobe width={22} height={22} /></div>
      <div style={{ minWidth: 0 }}>
        <div className="size">{p.dataMb ? dataSize(p.dataMb) : p.name}</div>
        <div className="val">{p.validity ? validityText(p.validity) : CATEGORY_LABEL[p.category]} · <NetworkName code={p.network} /></div>
      </div>
      <div className="right">
        <div className="price">{ghs((p.priceMinor || 0) + p.feeMinor)}</div>
        <button className="btn btn-yellow btn-sm" onClick={onBuy || (() => navigate(`/data-bundles?network=${p.network}&buy=${p.id}`))}>Buy</button>
      </div>
    </div>
  );
}
const NetworkName = ({ code }: { code: string }) => <>{NETWORK_META[code]?.name || code}</>;

export function AirtimePage() {
  usePageTitle('Buy Airtime Online — MTN, Telecel, AT');
  return (
    <SiteLayout>
      <div className="container page-head"><div className="eyebrow">Airtime</div><h1>Buy airtime for any network</h1><p className="muted" style={{ maxWidth: '52ch' }}>Top up yourself or someone else on MTN, Telecel or AT. Choose the amount, pay with Mobile Money or card, and follow the delivery live.</p></div>
      <div className="container" style={{ maxWidth: 560, marginLeft: 'auto', marginRight: 'auto', paddingBottom: 40 }}>
        <BuyWidget initialMode="airtime" />
      </div>
    </SiteLayout>
  );
}

export function DataBundlesPage() {
  usePageTitle('Data Bundles — MTN, Telecel, AT');
  const { products, loadProducts, config } = useApp();
  const { search } = useLocation();
  const [network, setNetwork] = useState<string>(search.get('network') || 'MTN');
  const [cat, setCat] = useState('all');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<'price' | 'size'>('price');
  const [buying, setBuying] = useState<Product | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => { loadProducts().catch(() => setErr(true)); }, [loadProducts]);
  useEffect(() => {
    const id = Number(search.get('buy'));
    if (id && products) { const p = products.find((x) => x.id === id); if (p) setBuying(p); }
  }, [search, products]);

  const list = useMemo(() => {
    let l = (products || []).filter((p) => p.kind === 'data' && p.network === network);
    if (cat !== 'all') l = l.filter((p) => p.category === cat);
    if (q.trim()) { const s = q.trim().toLowerCase(); l = l.filter((p) => `${p.name} ${dataSize(p.dataMb)} ${p.validity || ''}`.toLowerCase().includes(s)); }
    return [...l].sort((a, b) => (sort === 'price' ? (a.priceMinor || 0) - (b.priceMinor || 0) : (a.dataMb || 0) - (b.dataMb || 0)));
  }, [products, network, cat, q, sort]);
  const cats = useMemo(() => Array.from(new Set((products || []).filter((p) => p.kind === 'data' && p.network === network).map((p) => p.category))), [products, network]);

  return (
    <SiteLayout>
      <div className="container page-head"><div className="eyebrow">Data bundles</div><h1>Pick a bundle</h1></div>
      <div className="container" style={{ paddingBottom: 40 }}>
        <div className="nets" style={{ maxWidth: 520 }} role="tablist" aria-label="Network">
          {(config?.networks || []).map((n) => (
            <button key={n.code} role="tab" aria-selected={network === n.code} className={`net ${network === n.code ? 'active' : ''}`} onClick={() => { setNetwork(n.code); setCat('all'); }}>
              <NetworkBadge code={n.code} />{NETWORK_META[n.code]?.name || n.name}
            </button>
          ))}
        </div>
        <div className="row" style={{ marginBottom: 16 }}>
          <div className="filters" style={{ flex: '1 1 260px' }}>
            {['all', ...['daily', 'weekly', 'monthly', 'non_expiry', 'other'].filter((c) => cats.includes(c))].map((c) => (
              <button key={c} className={`chip ${cat === c ? 'active' : ''}`} onClick={() => setCat(c)}>{c === 'all' ? 'All' : CATEGORY_LABEL[c]}</button>
            ))}
          </div>
          <div className="row" style={{ flex: '1 1 300px', justifyContent: 'flex-end' }}>
            <div className="input-group" style={{ flex: 1, maxWidth: 260 }}>
              <input className="input" style={{ minHeight: 42 }} placeholder="Search e.g. 5GB" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search bundles" />
              <span className="addon" style={{ right: 12 }}><IcSearch width={18} height={18} /></span>
            </div>
            <select className="select" style={{ width: 'auto', minHeight: 42 }} value={sort} onChange={(e) => setSort(e.target.value as 'price' | 'size')} aria-label="Sort">
              <option value="price">Lowest price</option><option value="size">Smallest size</option>
            </select>
          </div>
        </div>
        {err && <Alert>We couldn't load bundles. Check your connection and refresh.</Alert>}
        {products === null && !err ? <div className="bundle-list">{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton" style={{ height: 84 }} />)}</div>
          : list.length ? <div className="bundle-list">{list.map((p) => <BundleCard key={p.id} p={p} onBuy={() => setBuying(p)} />)}</div>
          : <div className="card-soft"><Empty icon={<IcWifi />} title={`No ${NETWORK_META[network]?.name} bundles on sale yet`}>Bundles appear here once their prices are approved. Try another network or check back soon.</Empty></div>}
      </div>
      {buying && <QuickBuy product={buying} onClose={() => { setBuying(null); if (search.get('buy')) navigate(`/data-bundles?network=${network}`, { replace: true }); }} />}
    </SiteLayout>
  );
}

function QuickBuy({ product, onClose }: { product: Product; onClose: () => void }) {
  const { config } = useApp();
  const [phone, setPhone] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const n = normalizePhone(phone);
  const guess = config && n ? guessNetwork(n, config.networks) : null;
  return (
    <Modal title={`${productLabel(product)} · ${NETWORK_META[product.network]?.name}`} onClose={onClose}>
      <p className="muted small" style={{ marginTop: 0 }}>Price {ghs((product.priceMinor || 0) + product.feeMinor)}. Enter the {NETWORK_META[product.network]?.name} number that should receive this bundle.</p>
      <label className="step-label" htmlFor="qb-phone" style={{ display: 'block' }}>Recipient phone number</label>
      <PhoneInput id="qb-phone" value={phone} onChange={setPhone} />
      {guess && guess !== product.network && <p className="net-note" style={{ marginTop: 8 }}>This number usually belongs to {NETWORK_META[guess]?.name}. Continue only if it was ported to {NETWORK_META[product.network]?.name}.</p>}
      {err && <div style={{ marginTop: 10 }}><Alert>{err}</Alert></div>}
      <button className="btn btn-yellow btn-block btn-lg" style={{ marginTop: 16 }} onClick={() => { if (!n) return setErr('Enter a valid Ghana mobile number'); navigate(checkoutUrl({ productId: product.id, network: product.network, phone: n })); }}>Continue to checkout</button>
    </Modal>
  );
}

export function RatesPage() {
  usePageTitle('Rates & Prices');
  const { products, loadProducts, config } = useApp();
  const [err, setErr] = useState(false);
  useEffect(() => { loadProducts().catch(() => setErr(true)); }, [loadProducts]);
  return (
    <SiteLayout>
      <div className="container page-head"><div className="eyebrow">Rates</div><h1>Current prices</h1><p className="muted">Prices shown are exactly what you pay at checkout, including any service fee. Only products currently on sale are listed.</p></div>
      <div className="container" style={{ paddingBottom: 40 }}>
        {err && <Alert>We couldn't load prices. Please refresh.</Alert>}
        {products === null && !err ? <div className="skeleton" style={{ height: 240 }} /> : (
          <div className="grid-3">
            {(config?.networks || []).map((n) => {
              const data = (products || []).filter((p) => p.network === n.code && p.kind === 'data');
              const air = (products || []).find((p) => p.network === n.code && p.kind === 'airtime');
              return (
                <div className="card" key={n.code}>
                  <div className="row" style={{ marginBottom: 12 }}><NetworkBadge code={n.code} /><h3 style={{ margin: 0 }}>{NETWORK_META[n.code]?.name}</h3></div>
                  {data.length === 0 && !air && <p className="muted small">Not on sale yet.</p>}
                  {data.length > 0 && (
                    <table className="table" style={{ marginBottom: 12 }}>
                      <thead><tr><th>Bundle</th><th>Validity</th><th className="num">Price</th></tr></thead>
                      <tbody>{data.map((p) => <tr key={p.id}><td><b>{p.dataMb ? dataSize(p.dataMb) : p.name}</b></td><td className="muted">{p.validity || CATEGORY_LABEL[p.category]}</td><td className="num"><b>{ghs((p.priceMinor || 0) + p.feeMinor)}</b></td></tr>)}</tbody>
                    </table>
                  )}
                  {air && <p className="small" style={{ margin: 0 }}><b>Airtime:</b> {ghs(air.airtimeMinMinor)} – {ghs(air.airtimeMaxMinor)}{air.airtimeFeeBps ? ` · ${(air.airtimeFeeBps / 100).toFixed(2)}% service fee` : ' · no service fee'}</p>}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </SiteLayout>
  );
}
