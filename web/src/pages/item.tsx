import { useEffect, useRef, useState } from 'react';
import { get } from '../lib/api';
import { Link, navigate, usePageTitle } from '../lib/router';
import { useShop, type Product } from '../lib/store';
import { ghs } from '../lib/format';
import { waLink } from '../components/layout';
import { IcBack, IcMinus, IcPlus, IcWhatsApp, Loading, Notice, PhotoBlank, Price, ProductCard, errMsg } from '../components/ui';

type Full = Product & { description: string; images: string[] };

export function ItemPage({ slug }: { slug: string }) {
  const { config, add } = useShop();
  const [data, setData] = useState<{ product: Full; related: Product[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [size, setSize] = useState('');
  const [colour, setColour] = useState('');
  const [qty, setQty] = useState(1);
  const [shot, setShot] = useState(0);
  const [need, setNeed] = useState<string | null>(null);
  const [added, setAdded] = useState(false);
  const rail = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let off = false;
    setData(null); setError(null); setSize(''); setColour(''); setQty(1); setShot(0); setNeed(null); setAdded(false);
    get<{ product: Full; related: Product[] }>(`/api/products/${encodeURIComponent(slug)}`).then((r) => {
      if (off) return;
      setData(r);
      if (r.product.sizes.length === 1) setSize(r.product.sizes[0]);
      if (r.product.colours.length === 1) setColour(r.product.colours[0]);
    }).catch((e) => { if (!off) setError(errMsg(e)); });
    return () => { off = true; };
  }, [slug]);
  usePageTitle(data?.product.name || 'Item');

  if (error) return <section className="band"><div className="wrap"><Notice>{error}</Notice><p style={{ marginTop: 16 }}><Link to="/shop" className="btn btn-dark">Back to the shop</Link></p></div></section>;
  if (!data) return <section className="band"><div className="wrap"><Loading /></div></section>;
  const p = data.product;
  const s = config?.store;

  const check = () => {
    if (p.sizes.length && !size) { setNeed('Choose a size first'); return false; }
    if (p.colours.length && !colour) { setNeed('Choose a colour first'); return false; }
    setNeed(null);
    return true;
  };
  const addToBag = () => { if (!check()) return; add(p, size, colour, qty); setAdded(true); };
  const goTo = (i: number) => { setShot(i); const el = rail.current; if (el) el.scrollTo({ left: el.clientWidth * i, behavior: 'smooth' }); };
  const onScroll = () => { const el = rail.current; if (el && el.clientWidth) setShot(Math.round(el.scrollLeft / el.clientWidth)); };
  const detail = [size && `size ${size}`, colour].filter(Boolean).join(', ');
  const ask = s ? waLink(s.whatsappIntl, `Hello ${s.name}, is this available? ${p.name}${detail ? ` (${detail})` : ''}${p.priceMinor > 0 ? ` - ${ghs(p.priceMinor)}` : '. How much is it?'}\n${location.origin}/item/${p.slug}`) : '#';

  return (
    <>
      <section className="item">
        <div className="item-gallery">
          <button className="back" onClick={() => (history.length > 1 ? history.back() : navigate('/shop'))}><IcBack />Back</button>
          {p.images.length ? (
            <>
              <div className="rail" ref={rail} onScroll={onScroll}>
                {p.images.map((src, i) => <img key={src} src={src} alt={`${p.name}, photo ${i + 1}`} loading={i ? 'lazy' : undefined} />)}
              </div>
              {p.images.length > 1 && (
                <div className="thumbs">
                  {p.images.map((src, i) => <button key={src} className={i === shot ? 'on' : ''} onClick={() => goTo(i)} aria-label={`Photo ${i + 1}`}><img src={src} alt="" /></button>)}
                </div>
              )}
            </>
          ) : <div className="rail rail-blank"><PhotoBlank name={p.name} /></div>}
        </div>

        <div className="item-info">
          {p.category && <Link to={`/shop/${p.category.slug}`} className="crumb">{p.category.name}</Link>}
          <h1>{p.name}</h1>
          <Price p={p} large />
          {p.soldOut && <Notice kind="info">This one is sold out. Message us and we'll tell you when it's back.</Notice>}

          {p.sizes.length > 0 && (
            <fieldset className="opts"><legend>Size{size ? <span>{size}</span> : null}</legend>
              <div>{p.sizes.map((x) => <button key={x} type="button" className={x === size ? 'on' : ''} aria-pressed={x === size} onClick={() => { setSize(x); setNeed(null); setAdded(false); }}>{x}</button>)}</div>
            </fieldset>
          )}
          {p.colours.length > 0 && (
            <fieldset className="opts"><legend>Colour{colour ? <span>{colour}</span> : null}</legend>
              <div>{p.colours.map((x) => <button key={x} type="button" className={x === colour ? 'on' : ''} aria-pressed={x === colour} onClick={() => { setColour(x); setNeed(null); setAdded(false); }}>{x}</button>)}</div>
            </fieldset>
          )}

          {!p.soldOut && p.priceMinor > 0 && (
            <div className="buy">
              <div className="qty" role="group" aria-label="Quantity">
                <button type="button" onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="One less"><IcMinus /></button>
                <span aria-live="polite">{qty}</span>
                <button type="button" onClick={() => setQty((q) => Math.min(20, q + 1))} aria-label="One more"><IcPlus /></button>
              </div>
              <button className="btn btn-dark btn-wide" onClick={addToBag}>Add to bag</button>
            </div>
          )}
          {need && <Notice>{need}</Notice>}
          {added && <Notice kind="ok">Added to your bag. <Link to="/bag">View bag</Link></Notice>}
          {p.priceMinor > 0
            ? <a className="btn btn-line-dark btn-wide" href={ask} target="_blank" rel="noopener"><IcWhatsApp />Ask about this on WhatsApp</a>
            : <a className="btn btn-gold btn-wide ask-price" href={ask} target="_blank" rel="noopener"><IcWhatsApp />Ask for the price on WhatsApp</a>}

          {p.description && <div className="desc">{p.description.split(/\n+/).map((t, i) => <p key={i}>{t}</p>)}</div>}
          <p className="fine">{s?.deliveryNote}</p>
        </div>
      </section>

      {data.related.length > 0 && (
        <section className="band band-bone"><div className="wrap">
          <div className="band-head"><h2>More {p.category?.name.toLowerCase()}</h2></div>
          <div className="grid">{data.related.map((r) => <ProductCard key={r.id} p={r} />)}</div>
        </div></section>
      )}
    </>
  );
}
