import { useEffect, useState, type FormEvent } from 'react';
import { get, post, safeStorage } from '../lib/api';
import { Link, navigate, usePageTitle, useLocation } from '../lib/router';
import { useShop, type Product } from '../lib/store';
import { ghs } from '../lib/format';
import { Field, IcGift, IcMinus, IcPlus, IcTrash, IcWhatsApp, Notice, PhotoBlank, ProductCard, errMsg } from '../components/ui';

const SENT = 'pm_last_order';
export const ORDERS = 'pm_orders_v1';
export interface SavedOrder { reference: string; phone: string; at: string }
export function loadOrders(): SavedOrder[] {
  try { const a = JSON.parse(safeStorage().get(ORDERS) || '[]'); return Array.isArray(a) ? a.filter((o) => o && o.reference && o.phone).slice(0, 10) : []; } catch { return []; }
}

/** Pieces the owner paired with what is already in the bag. Shows nothing when there are no real pairings. */
function CompleteYourLook() {
  const { bag } = useShop();
  const slugs = [...new Set(bag.map((l) => l.slug))].slice(0, 3).join(',');
  const [items, setItems] = useState<Product[]>([]);
  useEffect(() => {
    if (!slugs) { setItems([]); return; }
    let off = false;
    Promise.all(slugs.split(',').map((s) => get<{ look: Product[] }>(`/api/products/${encodeURIComponent(s)}`).then((r) => r.look).catch(() => [] as Product[]))).then((all) => {
      if (off) return;
      const seen = new Set<number>();
      setItems(all.flat().filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true))));
    });
    return () => { off = true; };
  }, [slugs]);
  const inBag = new Set(bag.map((l) => l.productId));
  const show = items.filter((p) => !inBag.has(p.id)).slice(0, 2);
  if (!show.length) return null;
  return (
    <div className="bag-look">
      <h2>Complete your look</h2>
      <div className="grid">{show.map((p) => <ProductCard key={p.id} p={p} />)}</div>
    </div>
  );
}

export function BagPage() {
  const { bag, bagTotal, setQty, remove, clear, config } = useShop();
  usePageTitle('Your bag');
  const saved = (() => { try { return JSON.parse(safeStorage().get('pm_you') || '{}'); } catch { return {}; } })();
  const [name, setName] = useState<string>(saved.name || '');
  const [phone, setPhone] = useState<string>(saved.phone || '');
  const [place, setPlace] = useState<string>(saved.place || '');
  const [note, setNote] = useState('');
  const [gift, setGift] = useState(false);
  const [recipient, setRecipient] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (bag.length === 0) {
    return <section className="band"><div className="wrap"><div className="empty"><h2>Your bag is empty</h2><p>Add a pair of sneakers or an outfit and it will show up here.</p><Link to="/shop" className="btn btn-dark">Shop everything</Link></div></div></section>;
  }

  const store = config?.store;
  const unpriced = bag.filter((l) => l.priceMinor <= 0).reduce((n, l) => n + l.qty, 0);
  const count = bag.reduce((n, l) => n + l.qty, 0);
  const free = store?.freeDeliveryMinor || 0;
  const send = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const r = await post<{ reference: string; totalMinor: number; whatsappUrl: string }>('/api/orders', {
        name, phone, location: place, note,
        items: bag.map((l) => ({ productId: l.productId, qty: l.qty, size: l.size, colour: l.colour })),
        gift: gift && store?.giftEnabled ? { recipient, message } : null,
      });
      safeStorage().set('pm_you', JSON.stringify({ name, phone, place }));
      safeStorage().set(SENT, JSON.stringify(r));
      safeStorage().set(ORDERS, JSON.stringify([{ reference: r.reference, phone, at: new Date().toISOString() }, ...loadOrders()].slice(0, 10)));
      clear();
      navigate(`/order-sent?ref=${encodeURIComponent(r.reference)}`);
      window.location.href = r.whatsappUrl;
    } catch (err) { setError(errMsg(err)); setBusy(false); }
  };

  return (
    <section className="band">
      <div className="wrap bag">
        <div className="bag-lines">
          <h1>Your bag</h1>
          <ul>
            {bag.map((l) => (
              <li key={l.key}>
                <Link to={`/item/${l.slug}`} className="bag-photo">{l.image ? <img src={l.image} alt="" /> : <PhotoBlank name={l.name} />}</Link>
                <div className="bag-main">
                  <div className="bag-top"><Link to={`/item/${l.slug}`} className="bag-name">{l.name}</Link><span className="bag-price">{l.priceMinor > 0 ? ghs(l.priceMinor * l.qty) : 'Price on WhatsApp'}</span></div>
                  <span className="bag-meta">{[l.size && `Size ${l.size}`, l.colour].filter(Boolean).join(', ')}</span>
                  <div className="bag-row">
                    <div className="qty qty-sm" role="group" aria-label={`Quantity of ${l.name}`}>
                      <button type="button" onClick={() => setQty(l.key, l.qty - 1)} aria-label="One less" disabled={l.qty <= 1}><IcMinus /></button>
                      <span>{l.qty}</span>
                      <button type="button" onClick={() => setQty(l.key, l.qty + 1)} aria-label="One more"><IcPlus /></button>
                    </div>
                    <button type="button" className="link-btn" onClick={() => remove(l.key)}><IcTrash width={16} height={16} />Remove</button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
          <CompleteYourLook />
        </div>

        <form className="bag-form" onSubmit={send}>
          <ol className="steps-bar" aria-label="How ordering works"><li className="on">Contact</li><li className="on">Delivery</li><li>Send on WhatsApp</li><li>Confirmed</li></ol>

          <h2>Contact</h2>
          <Field label="Your name"><input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required maxLength={100} /></Field>
          <Field label="Phone number" hint="We call or WhatsApp this number about your order."><input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" autoComplete="tel" placeholder="024 123 4567" required maxLength={16} /></Field>

          <h2>Delivery</h2>
          <Field label="Delivery location" hint="Town and area, for example: Takoradi, Anaji."><input value={place} onChange={(e) => setPlace(e.target.value)} autoComplete="street-address" required maxLength={160} /></Field>
          <Field label="Anything we should know? (optional)"><textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={400} /></Field>

          {store?.giftEnabled && (
            <div className="gift">
              <label className="check"><input type="checkbox" checked={gift} onChange={(e) => setGift(e.target.checked)} /><span><IcGift width={18} height={18} />This is a gift</span></label>
              {gift && <>
                <Field label="Who is it for?"><input value={recipient} onChange={(e) => setRecipient(e.target.value)} maxLength={80} /></Field>
                <Field label="Gift message (optional)"><textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={2} maxLength={300} /></Field>
              </>}
            </div>
          )}

          <dl className="sum">
            <div><dt>{count} {count === 1 ? 'item' : 'items'}</dt><dd>{unpriced === count ? 'Prices on WhatsApp' : ghs(bagTotal)}</dd></div>
            {unpriced > 0 && unpriced < count && <div className="sum-note"><dt>{unpriced} without a price yet</dt><dd>Sent on WhatsApp</dd></div>}
            <div><dt>Delivery</dt><dd>{free > 0 && unpriced === 0 && bagTotal >= free ? 'Free' : 'Confirmed on WhatsApp'}</dd></div>
            {unpriced === 0 && <div className="sum-total"><dt>Total before delivery</dt><dd>{ghs(bagTotal)}</dd></div>}
          </dl>
          {free > 0 && unpriced === 0 && bagTotal < free && <p className="free-note">You're {ghs(free - bagTotal)} away from free delivery.</p>}
          <p className="fine">{store?.deliveryNote}</p>
          {error && <Notice>{error}</Notice>}
          <button className="btn btn-wa btn-wide" disabled={busy}><IcWhatsApp />{busy ? 'Opening WhatsApp' : 'Send order on WhatsApp'}</button>
          <p className="fine">Nothing is charged here. You pay after we confirm your order with you.</p>
        </form>
      </div>
    </section>
  );
}

export function OrderSentPage() {
  usePageTitle('Order ready to send');
  const { search } = useLocation();
  const ref = search.get('ref') || '';
  let last: { reference: string; totalMinor: number; whatsappUrl: string } | null = null;
  try { last = JSON.parse(safeStorage().get(SENT) || 'null'); } catch { last = null; }
  const mine = last && last.reference === ref ? last : null;
  return (
    <section className="band"><div className="wrap"><div className="empty">
      <h2>Order {ref || ''} is ready</h2>
      <p>WhatsApp should have opened with your order typed out. Press send there and we'll reply to confirm stock, delivery and payment.</p>
      {mine && <a className="btn btn-wa" href={mine.whatsappUrl} target="_blank" rel="noopener"><IcWhatsApp />Open WhatsApp again</a>}
      <p style={{ marginTop: 18 }}><Link to="/my-space" className="btn btn-line">Track this order</Link></p>
      <p style={{ marginTop: 14 }}><Link to="/shop">Keep shopping</Link></p>
    </div></div></section>
  );
}
