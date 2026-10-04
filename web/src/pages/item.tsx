import { useEffect, useRef, useState } from 'react';
import { get } from '../lib/api';
import { Link, navigate, usePageTitle } from '../lib/router';
import { useShop, type Product } from '../lib/store';
import { ghs } from '../lib/format';
import { waLink } from '../components/layout';
import { Options } from '../components/quickadd';
import { ContinueExploring } from './shop';
import { IcBack, IcCheck, IcMinus, IcPlus, IcRuler, IcWhatsApp, Loading, Notice, PhotoBlank, Price, ProductCard, SaveButton, badgeFor, errMsg } from '../components/ui';

type Full = Product & { description: string; images: string[] };

/**
 * "What's my size?" Works only from the sizes this item really comes in. The shop has no body-measurement chart yet,
 * so it asks for the size the customer normally wears and how they like the fit, and does not pretend to measure them.
 */
function SizeHelp({ sizes, onPick }: { sizes: string[]; onPick: (s: string) => void }) {
  const [open, setOpen] = useState(false);
  const [usual, setUsual] = useState('');
  const [fit, setFit] = useState<'slim' | 'regular' | 'oversized'>('regular');
  const i = sizes.indexOf(usual);
  const target = i < 0 ? -1 : fit === 'oversized' ? i + 1 : fit === 'slim' ? i - 1 : i;
  const pick = i < 0 ? null : sizes[Math.max(0, Math.min(sizes.length - 1, target))];
  const edge = pick !== null && (target < 0 || target > sizes.length - 1);
  return (
    <div className="sizehelp">
      <button type="button" className="sizehelp-toggle" aria-expanded={open} onClick={() => setOpen((v) => !v)}><IcRuler width={18} height={18} />What's my size?</button>
      {open && (
        <div className="sizehelp-body">
          <label className="field"><span className="field-label">The size you normally wear</span>
            <select value={usual} onChange={(e) => setUsual(e.target.value)}><option value="">Choose</option>{sizes.map((x) => <option key={x} value={x}>{x}</option>)}</select>
          </label>
          <div className="seg" role="group" aria-label="How you like it to fit">
            {(['slim', 'regular', 'oversized'] as const).map((f) => <button key={f} type="button" className={fit === f ? 'on' : ''} aria-pressed={fit === f} onClick={() => setFit(f)}>{f === 'slim' ? 'Slim' : f === 'regular' ? 'Regular' : 'Oversized'}</button>)}
          </div>
          {pick && (
            <div className="sizehelp-result">
              <p>We suggest <b>size {pick}</b>{fit === 'regular' ? ', your usual size.' : fit === 'oversized' ? (edge ? ". It is the largest we have in this item." : ', one up from your usual size for a looser fit.') : (edge ? '. It is the smallest we have in this item.' : ', one down from your usual size for a closer fit.')}</p>
              <button type="button" className="btn btn-line btn-wide" onClick={() => { onPick(pick); setOpen(false); }}><IcCheck width={18} height={18} />Use size {pick}</button>
            </div>
          )}
          <p className="fine">This goes by your usual size. We don't have body measurements for this item on the site yet, so if you're between sizes, message us and we'll check for you.</p>
        </div>
      )}
    </div>
  );
}

/** "Complete the look": this item plus the pieces the owner paired with it, added to the bag in one go. */
function Look({ main, pieces, mainChoice, checkMain }: { main: Full; pieces: Product[]; mainChoice: { size: string; colour: string }; checkMain: () => boolean }) {
  const { add, say } = useShop();
  const [choice, setChoice] = useState<Record<number, { size: string; colour: string }>>({});
  const [need, setNeed] = useState<string | null>(null);
  const get1 = (p: Product) => choice[p.id] || { size: p.sizes.length === 1 ? p.sizes[0] : '', colour: p.colours.length === 1 ? p.colours[0] : '' };
  const set1 = (p: Product, patch: Partial<{ size: string; colour: string }>) => { setChoice((c) => ({ ...c, [p.id]: { ...get1(p), ...patch } })); setNeed(null); };
  const addAll = () => {
    if (!main.soldOut && !checkMain()) { setNeed('Choose your options for this item first, at the top of the page.'); return; }
    for (const p of pieces) {
      const c = get1(p);
      if ((p.sizes.length && !c.size) || (p.colours.length && !c.colour)) { setNeed(`Choose ${p.sizes.length && !c.size ? 'a size' : 'a colour'} for ${p.name}.`); return; }
    }
    if (!main.soldOut) add(main, mainChoice.size, mainChoice.colour, 1);
    for (const p of pieces) { const c = get1(p); add(p, c.size, c.colour, 1); }
    say(`The look is in your bag (${pieces.length + (main.soldOut ? 0 : 1)} pieces)`, '/bag', 'View bag');
  };
  const priced = [main, ...pieces].every((p) => p.priceMinor > 0);
  const total = [main, ...pieces].reduce((n, p) => n + p.priceMinor, 0);
  return (
    <section className="band look">
      <div className="wrap">
        <div className="band-head"><h2>Complete the look</h2><span className="band-note">Pieces we wear with this</span></div>
        <div className="look-in">
          <ul className="look-list">
            {pieces.map((p) => {
              const c = get1(p);
              return (
                <li key={p.id}>
                  <Link to={`/item/${p.slug}`} className="look-pic">{p.thumb ? <img src={p.thumb} alt={p.name} loading="lazy" /> : <PhotoBlank name={p.name} />}</Link>
                  <div className="look-main">
                    <Link to={`/item/${p.slug}`} className="look-name">{p.name}</Link>
                    <Price p={p} />
                    <div className="look-opts">
                      {p.sizes.length > 1 && <select value={c.size} onChange={(e) => set1(p, { size: e.target.value })} aria-label={`Size for ${p.name}`}><option value="">Size</option>{p.sizes.map((x) => <option key={x}>{x}</option>)}</select>}
                      {p.colours.length > 1 && <select value={c.colour} onChange={(e) => set1(p, { colour: e.target.value })} aria-label={`Colour for ${p.name}`}><option value="">Colour</option>{p.colours.map((x) => <option key={x}>{x}</option>)}</select>}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="look-buy">
            {priced ? <p className="look-total"><span>The full look</span><b>{ghs(total)}</b></p> : <p className="look-total"><span>The full look</span><b>{pieces.length + 1} pieces</b></p>}
            {need && <Notice>{need}</Notice>}
            <button type="button" className="btn btn-gold btn-wide" onClick={addAll}>Add the full look to bag</button>
          </div>
        </div>
      </div>
    </section>
  );
}

export function ItemPage({ slug }: { slug: string }) {
  const { config, add, say, seen } = useShop();
  const [data, setData] = useState<{ product: Full; related: Product[]; look: Product[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [size, setSize] = useState('');
  const [colour, setColour] = useState('');
  const [qty, setQty] = useState(1);
  const [shot, setShot] = useState(0);
  const [need, setNeed] = useState<string | null>(null);
  const rail = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let off = false;
    setData(null); setError(null); setSize(''); setColour(''); setQty(1); setShot(0); setNeed(null);
    get<{ product: Full; related: Product[]; look: Product[] }>(`/api/products/${encodeURIComponent(slug)}`).then((r) => {
      if (off) return;
      setData(r);
      seen(r.product.id);
      if (r.product.sizes.length === 1) setSize(r.product.sizes[0]);
      if (r.product.colours.length === 1) setColour(r.product.colours[0]);
    }).catch((e) => { if (!off) setError(errMsg(e)); });
    return () => { off = true; };
  }, [slug, seen]);
  usePageTitle(data?.product.name || 'Item');

  if (error) return <section className="band"><div className="wrap"><Notice>{error}</Notice><p style={{ marginTop: 16 }}><Link to="/shop" className="btn btn-dark">Back to the shop</Link></p></div></section>;
  if (!data) return <section className="band"><div className="wrap"><Loading /></div></section>;
  const p = data.product;
  const s = config?.store;
  const badge = badgeFor(p);

  const check = () => {
    if (p.sizes.length && !size) { setNeed('Choose a size first'); return false; }
    if (p.colours.length && !colour) { setNeed('Choose a colour first'); return false; }
    setNeed(null);
    return true;
  };
  const addToBag = () => { if (!check()) return; add(p, size, colour, qty); say(`${p.name} is in your bag`, '/bag', 'View bag'); };
  const goTo = (i: number) => { setShot(i); const el = rail.current; if (el) el.scrollTo({ left: el.clientWidth * i, behavior: 'smooth' }); };
  const onScroll = () => { const el = rail.current; if (el && el.clientWidth) setShot(Math.round(el.scrollLeft / el.clientWidth)); };
  // Picking a colour shows that colour's photo when the item has one photo per colour, in the same order.
  const pickColour = (v: string) => { setColour(v); setNeed(null); const i = p.colours.indexOf(v); if (p.colours.length > 1 && p.images.length >= p.colours.length && i >= 0) goTo(i); };
  const detail = [size && `size ${size}`, colour].filter(Boolean).join(', ');
  const ask = s ? waLink(s.whatsappIntl, `Hello ${s.name}, is this available? ${p.name}${detail ? ` (${detail})` : ''}${p.priceMinor > 0 ? ` - ${ghs(p.priceMinor)}` : '. How much is it?'}\n${location.origin}/item/${p.slug}`) : '#';

  return (
    <>
      <section className="item">
        <div className="item-gallery">
          <button className="back" onClick={() => (history.length > 1 ? history.back() : navigate('/shop'))}><IcBack />Back</button>
          <SaveButton p={p} className="item-save" />
          {p.images.length ? (
            <>
              <div className="rail" ref={rail} onScroll={onScroll}>
                {p.images.map((src, i) => <img key={src} src={src} alt={`${p.name}, photo ${i + 1}`} loading={i ? 'lazy' : undefined} decoding="async" />)}
              </div>
              {p.images.length > 1 && (
                <div className="thumbs">
                  {p.images.map((src, i) => <button key={src} className={i === shot ? 'on' : ''} onClick={() => goTo(i)} aria-label={`Photo ${i + 1}`}><img src={`${src}/t`} alt="" loading="lazy" /></button>)}
                </div>
              )}
            </>
          ) : <div className="rail rail-blank"><PhotoBlank name={p.name} /></div>}
        </div>

        <div className="item-info">
          <nav className="trail" aria-label="Breadcrumb"><Link to="/">Home</Link>{p.category ? <Link to={`/shop/${p.category.slug}`}>{p.category.name}</Link> : <Link to="/shop">Shop</Link>}</nav>
          <h1>{p.name}</h1>
          <div className="item-price"><Price p={p} large />{badge ? <span className={`tag ${badge.gold ? 'tag-gold' : ''}`}>{badge.text}</span> : null}</div>
          {p.priceMinor <= 0 && !p.soldOut && <p className="fine">Add it to your bag and send the order. We reply on WhatsApp with the price before you pay anything.</p>}
          {p.soldOut && <Notice kind="info">This one is sold out. Message us and we'll tell you when it's back.</Notice>}

          <Options label="Size" values={p.sizes} value={size} onPick={(v) => { setSize(v); setNeed(null); }} />
          {p.sizes.length > 1 && <SizeHelp sizes={p.sizes} onPick={(v) => { setSize(v); setNeed(null); }} />}
          <Options label="Colour" values={p.colours} value={colour} onPick={pickColour} colour />

          {!p.soldOut && (
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
          <a className="btn btn-line-dark btn-wide" href={ask} target="_blank" rel="noopener"><IcWhatsApp />{p.priceMinor > 0 ? 'Ask about this on WhatsApp' : 'Ask for the price on WhatsApp'}</a>

          {p.description && <div className="desc">{p.description.split(/\n+/).map((t, i) => <p key={i}>{t}</p>)}</div>}
          <ul className="assure">
            <li>{s?.deliveryNote}</li>
            <li>Nothing is charged on the site. You pay after we confirm your order.</li>
          </ul>
        </div>
      </section>

      {data.look.length > 0 && <Look main={p} pieces={data.look} mainChoice={{ size, colour }} checkMain={check} />}

      {data.related.length > 0 && (
        <section className="band"><div className="wrap">
          <div className="band-head"><h2>More {p.category?.name.toLowerCase()}</h2>{p.category ? <Link to={`/shop/${p.category.slug}`} className="more">See all</Link> : null}</div>
          <div className="grid">{data.related.map((r) => <ProductCard key={r.id} p={r} />)}</div>
        </div></section>
      )}

      <ContinueExploring exclude={p.id} />
    </>
  );
}
