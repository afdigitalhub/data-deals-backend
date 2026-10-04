import { useEffect, useState } from 'react';
import { get } from '../lib/api';
import { Link, usePageTitle } from '../lib/router';
import { useShop, type Product } from '../lib/store';
import { plural } from '../lib/format';
import { waLink } from '../components/layout';
import { CatIcon, IcArrow, IcSearch, IcShield, IcTruck, IcWallet, IcWhatsApp, Loading, Notice, ProductCard, errMsg } from '../components/ui';

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

export function HomePage() {
  const { config } = useShop();
  usePageTitle('Pmsomel Enterprise | Sneakers, outfits and accessories in Ghana');
  const { data, error } = useProducts('?limit=24');
  const s = config?.store;
  const cats = config?.categories || [];
  const [tab, setTab] = useState('');
  const [pick, setPick] = useState(0);
  const withPhoto = (data || []).filter((p) => p.image).slice(0, 3);
  const lead = withPhoto[Math.min(pick, withPhoto.length - 1)] || null;
  const shown = (data || []).filter((p) => !tab || p.category?.slug === tab).slice(0, 10);
  const tabs = cats.filter((c) => (data || []).some((p) => p.category?.slug === c.slug));
  const promos = cats.slice(0, 2);
  const promoLine = (slug: string) => (/sneak|shoe/.test(slug) ? 'Clean pairs for every day' : /bag|access/.test(slug) ? 'The finishing touches' : 'Fresh styles for every vibe');
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
              {withPhoto.map((p, i) => <button key={p.id} className={p.id === lead?.id ? 'on' : ''} onClick={() => setPick(i)} aria-label={`Show ${p.name}`}><img src={p.image!} alt="" /></button>)}
            </div>
          )}
        </div>
        {lead && <Link to={`/item/${lead.slug}`} className="hero-link">{lead.name}<IcArrow width={16} height={16} /></Link>}
      </section>

      <section className="catbar">
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

      <section className="band">
        <div className="wrap">
          <div className="band-head">
            <h2>Featured products</h2>
            {tabs.length > 1 && (
              <div className="pills" role="group" aria-label="Filter featured products">
                <button className={!tab ? 'on' : ''} onClick={() => setTab('')}>All</button>
                {tabs.map((c) => <button key={c.slug} className={tab === c.slug ? 'on' : ''} onClick={() => setTab(c.slug)}>{c.name}</button>)}
              </div>
            )}
          </div>
          {error ? <Notice>{error}</Notice> : !data ? <Loading text="Loading the latest pieces" /> : data.length === 0
            ? <EmptyShelf title="The first pieces are on their way" body="We're adding our sneakers and outfits to the site. Until then, message us and we'll send you photos and prices of what's in stock." />
            : <div className="grid grid-5">{shown.map((p) => <ProductCard key={p.id} p={p} />)}</div>}
        </div>
      </section>

      {promos.length === 2 && (
        <section className="band">
          <div className="wrap promos">
            {promos.map((c, i) => (
              <Link key={c.slug} to={`/shop/${c.slug}`} className={`promo ${i === 0 ? 'promo-light' : ''}`}>
                {c.image && <img src={c.image} alt="" loading="lazy" />}
                <span className="promo-copy">
                  <span className="kicker">{c.count > 0 ? 'In the shop now' : 'Coming soon'}</span>
                  <b>{c.name}</b>
                  <span>{promoLine(c.slug)}</span>
                  <span className="promo-btn">{i === 0 ? 'Shop' : 'Explore'} {c.name.toLowerCase()}<IcArrow width={16} height={16} /></span>
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="trust">
        <div className="wrap trust-row">
          <div><IcTruck /><span><b>Delivery</b>Across Ghana</span></div>
          <div><IcWallet /><span><b>Pay after we confirm</b>Nothing charged on the site</span></div>
          <div><IcWhatsApp width={24} height={24} /><span><b>WhatsApp support</b>Chat with us anytime</span></div>
          <div><IcShield /><span><b>Size help</b>Ask before you order</span></div>
        </div>
      </section>
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
        <h2>Sizes and exchanges</h2>
        <p>Not sure about a size? Message us before you order and we'll help you choose. If something arrives and doesn't fit, tell us the same day and we'll sort out an exchange where the item is unworn.</p>
        {s?.about ? <><h2>About {s.name}</h2><p>{s.about}</p></> : null}
        <h2>Reach us</h2>
        {s && (
          <ul className="reach">
            {s.phones.map((p) => <li key={p}><a href={`tel:${p}`}>{p.replace(/^(\d{3})(\d{3})(\d{4})$/, '$1 $2 $3')}</a></li>)}
            <li><a href={waLink(s.whatsappIntl, `Hello ${s.name}, I have a question.`)} target="_blank" rel="noopener">Chat on WhatsApp</a></li>
            {s.location ? <li>{s.location}</li> : null}
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
