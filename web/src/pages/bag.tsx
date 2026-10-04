import { useState, type FormEvent } from 'react';
import { post, safeStorage } from '../lib/api';
import { Link, navigate, usePageTitle, useLocation } from '../lib/router';
import { useShop } from '../lib/store';
import { ghs } from '../lib/format';
import { Field, IcMinus, IcPlus, IcTrash, IcWhatsApp, Notice, PhotoBlank, errMsg } from '../components/ui';

const SENT = 'pm_last_order';

export function BagPage() {
  const { bag, bagTotal, setQty, remove, clear, config } = useShop();
  usePageTitle('Your bag');
  const saved = (() => { try { return JSON.parse(safeStorage().get('pm_you') || '{}'); } catch { return {}; } })();
  const [name, setName] = useState<string>(saved.name || '');
  const [phone, setPhone] = useState<string>(saved.phone || '');
  const [place, setPlace] = useState<string>(saved.place || '');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (bag.length === 0) {
    return <section className="band"><div className="wrap"><div className="empty"><h2>Your bag is empty</h2><p>Add a pair of sneakers or an outfit and it will show up here.</p><Link to="/shop" className="btn btn-dark">Shop everything</Link></div></div></section>;
  }

  const send = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const r = await post<{ reference: string; totalMinor: number; whatsappUrl: string }>('/api/orders', {
        name, phone, location: place, note,
        items: bag.map((l) => ({ productId: l.productId, qty: l.qty, size: l.size, colour: l.colour })),
      });
      safeStorage().set('pm_you', JSON.stringify({ name, phone, place }));
      safeStorage().set(SENT, JSON.stringify(r));
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
                  <Link to={`/item/${l.slug}`} className="bag-name">{l.name}</Link>
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
                <span className="bag-price">{ghs(l.priceMinor * l.qty)}</span>
              </li>
            ))}
          </ul>
        </div>

        <form className="bag-form" onSubmit={send}>
          <h2>Where should we deliver?</h2>
          <Field label="Your name"><input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required maxLength={100} /></Field>
          <Field label="Phone number" hint="We call or WhatsApp this number about your order."><input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" autoComplete="tel" placeholder="024 123 4567" required maxLength={16} /></Field>
          <Field label="Delivery location" hint="Town and area, for example: Takoradi, Anaji."><input value={place} onChange={(e) => setPlace(e.target.value)} autoComplete="street-address" required maxLength={160} /></Field>
          <Field label="Anything we should know? (optional)"><textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={400} /></Field>
          <div className="totals"><span>Items</span><b>{ghs(bagTotal)}</b></div>
          <p className="fine">{config?.store.deliveryNote}</p>
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
      <p style={{ marginTop: 18 }}><Link to="/shop">Keep shopping</Link></p>
    </div></div></section>
  );
}
