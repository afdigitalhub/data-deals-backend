import { useEffect, useState, type FormEvent } from 'react';
import { get, post, safeStorage } from '../lib/api';
import { Link, navigate, usePageTitle } from '../lib/router';
import { useShop, type Product } from '../lib/store';
import { dateTime, ghs } from '../lib/format';
import { loadOrders, ORDERS, type SavedOrder } from './bag';
import { Field, IcCheck, Loading, Notice, ProductCard, errMsg } from '../components/ui';

interface Tracked { reference: string; status: string; step: number; createdAt: string; updatedAt: string; totalMinor: number; items: { name: string; slug: string; qty: number; size: string; colour: string; priceMinor: number }[] }
const STEPS: [string, string][] = [
  ['Order received', 'We have your order.'],
  ['Order confirmed', 'Stock, price and delivery agreed with you.'],
  ['Preparing your pieces', 'We are packing your order.'],
  ['Out for delivery', 'Your order is on its way.'],
  ['Delivered', 'Enjoy it.'],
];

/** The order timeline. Every step shown as done comes from the order's real status, set by the shop. */
export function Timeline({ o }: { o: Tracked }) {
  const priced = o.items.every((l) => l.priceMinor > 0);
  return (
    <div className="track">
      <div className="track-head"><b>{o.reference}</b><span>Sent {dateTime(o.createdAt)}</span></div>
      {o.status === 'cancelled' ? <Notice kind="info">This order was cancelled. Message us if that is not what you expected.</Notice> : (
        <ol className="timeline">
          {STEPS.map(([title, text], i) => (
            <li key={title} className={i < o.step ? 'done' : i === o.step ? 'now' : ''}>
              <span className="dot">{i <= o.step ? <IcCheck width={14} height={14} /> : null}</span>
              <div><b>{title}</b>{i === o.step ? <span>{text}{i > 0 ? ` Updated ${dateTime(o.updatedAt)}.` : ''}</span> : null}</div>
            </li>
          ))}
        </ol>
      )}
      <ul className="track-items">
        {o.items.map((l, i) => <li key={i}><Link to={`/item/${l.slug}`}>{l.qty} × {l.name}{[l.size && `size ${l.size}`, l.colour].filter(Boolean).length ? ` (${[l.size && `size ${l.size}`, l.colour].filter(Boolean).join(', ')})` : ''}</Link></li>)}
      </ul>
      {priced && <p className="track-total"><span>Items total</span><b>{ghs(o.totalMinor)}</b></p>}
    </div>
  );
}

function TrackForm({ onFound }: { onFound: (o: Tracked, phone: string) => void }) {
  const [reference, setReference] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const go = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null);
    try { const r = await post<{ order: Tracked }>('/api/orders/track', { reference, phone }); onFound(r.order, phone); } catch (x) { setError(errMsg(x)); } finally { setBusy(false); }
  };
  return (
    <form className="track-form" onSubmit={go}>
      <Field label="Order number" hint="It starts with PM- and is at the end of the WhatsApp message you sent."><input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="PM-ABC123" required maxLength={14} autoCapitalize="characters" /></Field>
      <Field label="Phone number on the order"><input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" autoComplete="tel" placeholder="024 123 4567" required maxLength={16} /></Field>
      {error && <Notice>{error}</Notice>}
      <button className="btn btn-gold btn-wide" disabled={busy}>{busy ? 'Checking' : 'Track order'}</button>
    </form>
  );
}

export function TrackPage() {
  usePageTitle('Track your order');
  const [found, setFound] = useState<Tracked | null>(null);
  return (
    <section className="band"><div className="wrap narrow">
      <h1 className="page-title">Track your order</h1>
      {found ? <><Timeline o={found} /><p style={{ marginTop: 18 }}><button className="link-btn" onClick={() => setFound(null)}>Check another order</button></p></> : <TrackForm onFound={(o) => setFound(o)} />}
      <p className="fine" style={{ marginTop: 18 }}>Orders you sent from this phone are also kept in <Link to="/my-space">My space</Link>.</p>
    </div></section>
  );
}

function useProductsByIds(ids: number[]) {
  const key = ids.join(',');
  const [items, setItems] = useState<Product[] | null>(key ? null : []);
  useEffect(() => {
    if (!key) { setItems([]); return; }
    let off = false;
    get<{ products: Product[] }>(`/api/products?ids=${key}`).then((r) => { if (!off) setItems(r.products); }).catch(() => { if (!off) setItems([]); });
    return () => { off = true; };
  }, [key]);
  return items;
}

function MyOrders() {
  const [saved, setSaved] = useState<SavedOrder[]>(loadOrders);
  const [live, setLive] = useState<Record<string, Tracked | 'gone'>>({});
  useEffect(() => {
    let off = false;
    saved.slice(0, 5).forEach((o) => {
      post<{ order: Tracked }>('/api/orders/track', { reference: o.reference, phone: o.phone })
        .then((r) => { if (!off) setLive((m) => ({ ...m, [o.reference]: r.order })); })
        .catch(() => { if (!off) setLive((m) => ({ ...m, [o.reference]: 'gone' })); });
    });
    return () => { off = true; };
  }, [saved]);
  const addFound = (o: Tracked, phone: string) => {
    const next = [{ reference: o.reference, phone, at: o.createdAt }, ...saved.filter((x) => x.reference !== o.reference)].slice(0, 10);
    safeStorage().set(ORDERS, JSON.stringify(next)); setSaved(next);
  };
  return (
    <>
      {saved.length === 0 && <p className="space-empty">No orders sent from this phone yet. If you ordered from another phone, find it with the order number.</p>}
      {saved.slice(0, 5).map((o) => {
        const t = live[o.reference];
        return t === undefined ? <Loading key={o.reference} text={`Checking ${o.reference}`} /> : t === 'gone' ? <Notice key={o.reference} kind="info">We could not load order {o.reference} just now.</Notice> : <Timeline key={o.reference} o={t} />;
      })}
      <details className="space-find"><summary>Find an order by its number</summary><TrackForm onFound={addFound} /></details>
    </>
  );
}

/** "My space": orders, saved items, recently viewed and delivery details. Kept on the customer's own phone; the shop has no accounts. */
export function MySpacePage({ tab }: { tab: string }) {
  usePageTitle('My space');
  const { saved, recent } = useShop();
  const savedItems = useProductsByIds(tab === 'saved' ? saved : []);
  const recentItems = useProductsByIds(tab === 'recent' ? recent : []);
  const [you, setYou] = useState<{ name?: string; phone?: string; place?: string }>(() => { try { return JSON.parse(safeStorage().get('pm_you') || '{}'); } catch { return {}; } });
  const tabs: [string, string][] = [['orders', 'Orders'], ['saved', `Saved${saved.length ? ` (${saved.length})` : ''}`], ['recent', 'Recently viewed'], ['details', 'Delivery details']];
  const cur = tabs.some(([k]) => k === tab) ? tab : 'orders';
  const forget = () => { safeStorage().remove('pm_you'); setYou({}); };
  return (
    <section className="band"><div className="wrap">
      <h1 className="page-title">My space</h1>
      <div className="filters" role="navigation" aria-label="My space sections">
        {tabs.map(([k, label]) => <Link key={k} to={k === 'orders' ? '/my-space' : `/my-space/${k}`} className={cur === k ? 'on' : ''}>{label}</Link>)}
      </div>
      {cur === 'orders' && <div className="narrow-left"><MyOrders /></div>}
      {cur === 'saved' && (!savedItems ? <Loading /> : savedItems.length === 0
        ? <div className="empty"><h2>Nothing saved yet</h2><p>Tap the heart on any piece to keep it here for later.</p><Link to="/shop" className="btn btn-dark">Shop everything</Link></div>
        : <div className="grid">{savedItems.map((p) => <ProductCard key={p.id} p={p} />)}</div>)}
      {cur === 'recent' && (!recentItems ? <Loading /> : recentItems.length === 0
        ? <div className="empty"><h2>Nothing viewed yet</h2><p>Pieces you open will show here so you can find them again.</p><Link to="/shop" className="btn btn-dark">Shop everything</Link></div>
        : <div className="grid">{recentItems.map((p) => <ProductCard key={p.id} p={p} />)}</div>)}
      {cur === 'details' && (
        <div className="narrow-left">
          {you.name || you.phone || you.place ? (
            <div className="track">
              <ul className="track-items"><li>{you.name}</li><li>{you.phone}</li><li>{you.place}</li></ul>
              <p className="fine">These fill in automatically when you order. They are kept on this phone only.</p>
              <p style={{ marginTop: 12 }}><button className="link-btn" onClick={forget}>Remove these details from this phone</button></p>
            </div>
          ) : <p className="space-empty">Your name, number and delivery location are remembered on this phone after your first order, so you don't type them again.</p>}
          <p style={{ marginTop: 16 }}><button className="btn btn-line" onClick={() => navigate('/shop')}>Keep shopping</button></p>
        </div>
      )}
    </div></section>
  );
}
