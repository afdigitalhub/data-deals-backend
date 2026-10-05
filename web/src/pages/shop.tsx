import React, { useEffect, useState } from 'react';
import { get } from '../lib/api';
import { Link, usePageTitle } from '../lib/router';
import { useShop, type Collection, type Product } from '../lib/store';
import { plural } from '../lib/format';
import { waLink } from '../components/layout';
import { CatIcon, IcArrow, IcPin, IcSearch, IcShield, IcTruck, IcWallet, IcWhatsApp, Loading, Notice, ProductCard, errMsg } from '../components/ui';

function useProducts(query: string) {
  const [data, setData] = useState<Product[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let off = false;
    setData(null); setError(null);
    get<{ products: Product[] }>(`/api/products${query}`).then((r) => { if (!off) setData(r.products); }).catch((e) => { if (!off) setError(errMsg(e)); });
    return () => { off = true; };
  }, [query]);
  return { data, error };
}

/** What the shop says while it has nothing to show yet. Points people to WhatsApp so a sale is never lost. */
export function EmptyShelf({ title, body }: { title: string; body: string }) {
  const { config } = useShop();
  const s = config?.store;
  return (
    <div className="empty">
      <h2>{title}</h2>
      <p>{body}</p>
      {s && <a className="btn btn-dark" href={waLink(s.whatsappIntl, `Hello ${s.name}, what do you have in stock today?`)} target="_blank" rel="noopener"><IcWhatsApp />Ask what's in stock</a>}
    </div>
  );
}

/** "Continue exploring": items this visitor opened recently, remembered on their phone. Loads only when there is something to show. */
export function ContinueExploring({ exclude }: { exclude?: number }) {
  const { recent } = useShop();
  const ids = recent.filter((id) => id !== exclude).slice(0, 8);
  const key = ids.join(',');
  const [items, setItems] = useState<Product[]>([]);
  useEffect(() => {
    if (!key) { setItems([]); return; }
    let off = false;
    get<{ products: Product[] }>(`/api/products?ids=${key}`).then((r) => { if (!off) setItems(r.products); }).catch(() => {});
    return () => { off = true; };
  }, [key]);
  if (items.length < 2) return null;
  return (
    <section className="band">
      <div className="wrap">
        <div className="band-head"><h2>Continue exploring</h2><Link to="/my-space/recent" className="more">See all</Link></div>
        <div className="rail-row">{items.map((p) => <ProductCard key={p.id} p={p} />)}</div>
      </div>
    </section>
  );
}

interface HomeData { newDrops: Product[]; edit: (Collection & { products: Product[] }) | null }

export function HomePage() {
  const { config } = useShop();
  usePageTitle('Pmsomel Enterprise | Sneakers, outfits and accessories in Ghana');
  const [data, setData] = useState<HomeData | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { let off = false; get<HomeData>('/api/home').then((r) => { if (!off) setData(r); }).catch((e) => { if (!off) setError(errMsg(e)); }); return () => { off = true; }; }, []);
  const s = config?.store;
  const cats = config?.categories || [];
  const vibes = (config?.collections || []).filter((k) => k.kind === 'vibe');
  const [pick, setPick] = useState(0);
  const withPhoto = (data?.newDrops || []).filter((p) => p.image).slice(0, 3);
  const lead = withPhoto[Math.min(pick, withPhoto.length - 1)] || null;
  const edit = data?.edit || null;
  return (
    <>
      <section className={`hero ${lead ? 'has-photo' : ''}`}>
        {lead && <img className="hero-bg" src={lead.image!} alt="" key={lead.id} />}
        <div className="hero-in">
          <div className="hero-copy">
            <div className="kicker">Sneakers<i />Outfits<i />Accessories</div>
            <h1>Step into<em>style</em></h1>
            <p>Premium sneakers, outfits and accessories for every occasion.</p>
            <div className="hero-cta">
              <Link to="/shop" className="btn btn-gold">Shop now<IcArrow width={18} height={18} /></Link>
              {s && <a className="btn btn-ghost" href={waLink(s.whatsappIntl, `Hello ${s.name}, I have a question.`)} target="_blank" rel="noopener"><IcWhatsApp />Chat with us</a>}
            </div>
            <ul className="hero-facts">
              <li><b>Nationwide</b>Delivery across Ghana</li>
              <li><b>Easy</b>Order on WhatsApp</li>
              <li><b>Safe</b>Pay after we confirm</li>
            </ul>
          </div>
          {withPhoto.length > 1 && (
            <div className="hero-picks">
              {withPhoto.map((p, i) => <button key={p.id} className={p.id === lead?.id ? 'on' : ''} onClick={() => setPick(i)} aria-label={`Show ${p.name}`}><img src={p.thumb || p.image!} alt="" /></button>)}
            </div>
          )}
        </div>
        {lead && <Link to={`/item/${lead.slug}`} className="hero-link">{lead.name}<IcArrow width={16} height={16} /></Link>}
      </section>

      {vibes.length > 0 && (
        <section className="band">
          <div className="wrap">
            <div className="band-head"><h2>Shop by vibe</h2><span className="band-note">Pick a mood, see the pieces</span></div>
            <div className="vibes">
              {vibes.map((k) => (
                <Link key={k.slug} to={`/vibe/${k.slug}`} className="vibe">
                  {k.thumb ? <img src={k.thumb} alt="" loading="lazy" decoding="async" /> : null}
                  <span className="vibe-copy"><b>{k.name}</b><span>{k.tagline}</span><em>{plural(k.count, 'piece')}</em></span>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      <section className="band">
        <div className="wrap">
          <div className="band-head"><h2>New drops</h2>{data && data.newDrops.length > 0 && <Link to="/shop" className="more">See everything</Link>}</div>
          {error ? <Notice>{error}</Notice> : !data ? <Loading text="Loading the latest pieces" /> : data.newDrops.length === 0
            ? <EmptyShelf title="The first pieces are on their way" body="We're adding our sneakers and outfits to the site. Until then, message us and we'll send you photos and prices of what's in stock." />
            : <div className="grid grid-5">{data.newDrops.map((p) => <ProductCard key={p.id} p={p} />)}</div>}
        </div>
      </section>

      {edit && edit.products.length > 0 && (
        <section className="edit">
          <div className="wrap edit-in">
            <Link to={`/item/${edit.products[0].slug}`} className="edit-lead">
              {edit.products[0].image ? <img src={edit.products[0].image} alt={edit.products[0].name} loading="lazy" decoding="async" /> : null}
            </Link>
            <div className="edit-copy">
              <div className="kicker">The Edit</div>
              <h2>{edit.name}</h2>
              {edit.body ? <p>{edit.body}</p> : null}
              <ol className="edit-list">
                {edit.products.slice(0, 5).map((p) => (
                  <li key={p.id}><Link to={`/item/${p.slug}`}><span className="edit-thumb">{p.thumb ? <img src={p.thumb} alt="" loading="lazy" /> : null}</span><span>{p.name}</span><IcArrow width={16} height={16} /></Link></li>
                ))}
              </ol>
              <Link to={`/edit/${edit.slug}`} className="btn btn-line">See the whole edit<IcArrow width={18} height={18} /></Link>
            </div>
          </div>
        </section>
      )}

      <section className="catbar">
        <div className="wrap"><div className="band-head"><h2>Shop by category</h2></div></div>
        <div className="catbar-row">
          {cats.map((c) => (
            <Link key={c.slug} to={`/shop/${c.slug}`} className="cat">
              <span className="cat-pic">{c.image ? <img src={c.image} alt="" loading="lazy" /> : <CatIcon slug={c.slug} />}</span>
              <span className="cat-name">{c.name}</span>
            </Link>
          ))}
          <Link to="/shop" className="cat"><span className="cat-pic"><IcArrow /></span><span className="cat-name">See everything</span></Link>
        </div>
      </section>

      <ContinueExploring />

      <section className="trust">
        <div className="wrap trust-row">
          <Link to="/policy/delivery"><IcTruck /><span><b>Delivery across Ghana</b>Fee confirmed before you pay</span></Link>
          <Link to="/policy/terms"><IcWallet /><span><b>Pay after we confirm</b>Nothing charged on the site</span></Link>
          <Link to="/policy/returns"><IcShield /><span><b>Exchanges</b>Tell us within 48 hours</span></Link>
          <Link to="/track"><IcSearch /><span><b>Track your order</b>With your order number</span></Link>
          {s?.location ? <Link to="/delivery"><IcPin /><span><b>Visit us</b>{s.location}</span></Link> : null}
        </div>
      </section>
    </>
  );
}

/** A "Shop by vibe" collection or an edit: a short introduction, then the pieces the owner chose for it. */
export function CollectionPage({ slug, kind }: { slug: string; kind: 'vibe' | 'edit' }) {
  const [data, setData] = useState<{ collection: Collection; products: Product[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { config } = useShop();
  useEffect(() => {
    let off = false; setData(null); setError(null);
    get<{ collection: Collection; products: Product[] }>(`/api/collections/${encodeURIComponent(slug)}`).then((r) => { if (!off) setData(r); }).catch((e) => { if (!off) setError(errMsg(e)); });
    return () => { off = true; };
  }, [slug]);
  usePageTitle(data?.collection.name || 'Collection');
  if (error) return <section className="band"><div className="wrap"><Notice>{error}</Notice><p style={{ marginTop: 16 }}><Link to="/shop" className="btn btn-dark">Shop everything</Link></p></div></section>;
  if (!data) return <section className="band"><div className="wrap"><Loading /></div></section>;
  const k = data.collection;
  const others = (config?.collections || []).filter((c) => c.kind === 'vibe' && c.slug !== k.slug);
  return (
    <>
      <section className="chead">
        {k.image ? <img src={k.image} alt="" /> : null}
        <div className="wrap chead-in">
          <nav className="trail" aria-label="Breadcrumb"><Link to="/">Home</Link><span>{kind === 'edit' ? 'The Edit' : 'Shop by vibe'}</span></nav>
          <h1>{k.name}</h1>
          <p>{k.body || k.tagline}</p>
          <span className="count">{plural(data.products.length, 'piece')}</span>
        </div>
      </section>
      <section className="band">
        <div className="wrap">
          {data.products.length === 0
            ? <EmptyShelf title="Nothing here yet" body="We're still choosing pieces for this collection. Message us and we'll send you what's in stock." />
            : <div className="grid">{data.products.map((p) => <ProductCard key={p.id} p={p} />)}</div>}
        </div>
      </section>
      {others.length > 0 && (
        <section className="band">
          <div className="wrap">
            <div className="band-head"><h2>Try another vibe</h2></div>
            <div className="vibes">
              {others.map((c) => <Link key={c.slug} to={`/vibe/${c.slug}`} className="vibe">{c.thumb ? <img src={c.thumb} alt="" loading="lazy" /> : null}<span className="vibe-copy"><b>{c.name}</b><span>{c.tagline}</span><em>{plural(c.count, 'piece')}</em></span></Link>)}
            </div>
          </div>
        </section>
      )}
    </>
  );
}

export function ShopPage({ category }: { category?: string }) {
  const { config } = useShop();
  const cat = config?.categories.find((c) => c.slug === category) || null;
  const [term, setTerm] = useState('');
  const [search, setSearch] = useState('');
  useEffect(() => { const t = setTimeout(() => setSearch(term.trim()), 300); return () => clearTimeout(t); }, [term]);
  useEffect(() => { setTerm(''); setSearch(''); }, [category]);
  const qs = new URLSearchParams();
  if (category) qs.set('category', category);
  if (search) qs.set('q', search);
  const { data, error } = useProducts(qs.toString() ? `?${qs}` : '');
  const title = cat ? cat.name : 'Everything';
  usePageTitle(title);
  return (
    <section className="band">
      <div className="wrap">
        <div className="shop-head">
          <h1>{title}</h1>
          {data && <span className="count">{plural(data.length, 'piece')}</span>}
        </div>
        <label className="search"><IcSearch /><input value={term} onChange={(e) => setTerm(e.target.value)} placeholder={`Search ${cat ? cat.name.toLowerCase() : 'the shop'}`} aria-label="Search" maxLength={60} /></label>
        <div className="filters" role="navigation" aria-label="Categories">
          <Link to="/shop" className={!category ? 'on' : ''}>Everything</Link>
          {(config?.categories || []).map((c) => <Link key={c.slug} to={`/shop/${c.slug}`} className={c.slug === category ? 'on' : ''}>{c.name}</Link>)}
        </div>
        {error ? <Notice>{error}</Notice> : !data ? <Loading /> : data.length === 0
          ? (search
            ? <EmptyShelf title={`Nothing matches "${search}"`} body="Try a shorter word, or message us. We may have it in stock but not on the site yet." />
            : <EmptyShelf title={`${title} coming soon`} body="We're still adding pieces here. Message us and we'll send you photos and prices of what's in stock." />)
          : <div className="grid">{data.map((p) => <ProductCard key={p.id} p={p} />)}</div>}
      </div>
    </section>
  );
}

/** Policy text: lines starting "## " are headings, lines starting "- " are list items, everything else is a paragraph. */
export function PolicyText({ body }: { body: string }) {
  const out: React.ReactNode[] = [];
  let list: string[] = [];
  const flush = () => { if (list.length) { out.push(<ul key={`l${out.length}`}>{list.map((t, i) => <li key={i}>{t}</li>)}</ul>); list = []; } };
  body.split(/\n/).map((l) => l.trim()).forEach((l, i) => {
    if (!l) { flush(); return; }
    if (l.startsWith('- ')) { list.push(l.slice(2)); return; }
    flush();
    out.push(l.startsWith('## ') ? <h2 key={i}>{l.slice(3)}</h2> : <p key={i}>{l}</p>);
  });
  flush();
  return <>{out}</>;
}

export function PolicyPage({ slug }: { slug: string }) {
  const { config } = useShop();
  const [data, setData] = useState<{ title: string; body: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let off = false; setData(null); setError(null);
    get<{ policy: { title: string; body: string } }>(`/api/policies/${encodeURIComponent(slug)}`).then((r) => { if (!off) setData(r.policy); }).catch((e) => { if (!off) setError(errMsg(e)); });
    return () => { off = true; };
  }, [slug]);
  usePageTitle(data?.title || 'Policy');
  const s = config?.store;
  if (error) return <section className="band"><div className="wrap"><Notice>{error}</Notice></div></section>;
  if (!data) return <section className="band"><div className="wrap"><Loading /></div></section>;
  return (
    <section className="band">
      <div className="wrap policy">
        <nav className="policy-nav" aria-label="Policies">
          {(config?.policies || []).map((x) => <Link key={x.slug} to={`/policy/${x.slug}`} className={x.slug === slug ? 'on' : ''}>{x.title}</Link>)}
        </nav>
        <article className="prose">
          <h1>{data.title}</h1>
          <PolicyText body={data.body} />
          {s && <p className="policy-ask"><a className="btn btn-line" href={waLink(s.whatsappIntl, `Hello ${s.name}, I have a question about your ${data.title.toLowerCase()} policy.`)} target="_blank" rel="noopener"><IcWhatsApp />Ask us about this</a></p>}
        </article>
      </div>
    </section>
  );
}

export function DeliveryPage() {
  const { config } = useShop();
  usePageTitle('Delivery and contact');
  const s = config?.store;
  return (
    <section className="band">
      <div className="wrap prose">
        <h1>Delivery and contact</h1>
        <h2>Delivery</h2>
        <p>{s?.deliveryNote || 'We deliver across Ghana. The delivery fee depends on your location and is confirmed on WhatsApp before you pay.'}</p>
        <h2>How to order</h2>
        <p>Add what you want to your bag, fill in your name and delivery location, and tap "Send order on WhatsApp". We reply to confirm that your size is in stock, the delivery fee and how to pay.</p>
        <h2>Sizes</h2>
        <p>Not sure about a size? Message us before you order and we'll help you choose.</p>
        <p><Link to="/policy/delivery">Full delivery policy</Link> and <Link to="/policy/returns">returns and exchanges</Link>.</p>
        <h2>Track your order</h2>
        <p>After you send an order you get an order number. <Link to="/track">Check where your order is</Link> at any time.</p>
        {s?.about ? <><h2>About {s.name}</h2><p>{s.about}</p></> : null}
        <h2>Reach us</h2>
        {s && (
          <ul className="reach">
            {s.phones.map((p) => <li key={p}><a href={`tel:${p}`}>{p.replace(/^(\d{3})(\d{3})(\d{4})$/, '$1 $2 $3')}</a></li>)}
            <li><a href={waLink(s.whatsappIntl, `Hello ${s.name}, I have a question.`)} target="_blank" rel="noopener">Chat on WhatsApp</a></li>
            {s.location ? <li><IcPin width={18} height={18} /> {s.location}</li> : null}
          </ul>
        )}
      </div>
    </section>
  );
}

export function NotFoundPage() {
  usePageTitle('Page not found');
  return <section className="band"><div className="wrap"><div className="empty"><h2>That page isn't here</h2><p>The link may be old, or the item may have sold out.</p><Link to="/shop" className="btn btn-dark">Shop everything</Link></div></div></section>;
}
