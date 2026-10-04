import { useEffect, useState } from 'react';
import { get } from '../lib/api';
import { Link, usePageTitle } from '../lib/router';
import { useShop, type Product } from '../lib/store';
import { plural } from '../lib/format';
import { waLink } from '../components/layout';
import { IcSearch, IcWhatsApp, Loading, Notice, ProductCard, errMsg } from '../components/ui';

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
  const { data, error } = useProducts('?limit=8');
  const s = config?.store;
  const lead = data?.find((p) => p.image) || null;
  return (
    <>
      <section className={`hero ${lead ? 'has-photo' : ''}`}>
        <div className="hero-in">
          <div className="hero-copy">
            <h1>{s?.tagline || 'Sneakers, outfits and the finishing touches.'}</h1>
            <p>Pick what you like, send the order on WhatsApp, and we deliver to you anywhere in Ghana.</p>
            <div className="hero-cta">
              <Link to="/shop" className="btn btn-gold">Shop everything</Link>
              {s && <a className="btn btn-line" href={waLink(s.whatsappIntl, `Hello ${s.name}, I have a question.`)} target="_blank" rel="noopener"><IcWhatsApp />Chat on WhatsApp</a>}
            </div>
          </div>
          {lead && (
            <Link to={`/item/${lead.slug}`} className="hero-photo" aria-label={lead.name}>
              <img src={lead.image!} alt={lead.name} />
              <span className="hero-tag"><b>{lead.name}</b>Just in</span>
            </Link>
          )}
        </div>
        <nav className="hero-index" aria-label="Shop by category">
          {(config?.categories || []).map((c) => (
            <Link key={c.slug} to={`/shop/${c.slug}`}><span>{c.name}</span><em>{c.count > 0 ? plural(c.count, 'piece') : 'Soon'}</em></Link>
          ))}
        </nav>
      </section>

      <section className="band">
        <div className="wrap">
          <div className="band-head"><h2>New in</h2>{data && data.length > 0 && <Link to="/shop" className="more">See everything</Link>}</div>
          {error ? <Notice>{error}</Notice> : !data ? <Loading text="Loading the latest pieces" /> : data.length === 0
            ? <EmptyShelf title="The first pieces are on their way" body="We're adding our sneakers and outfits to the site. Until then, message us and we'll send you photos and prices of what's in stock." />
            : <div className="grid">{data.map((p) => <ProductCard key={p.id} p={p} />)}</div>}
        </div>
      </section>

      <section className="band band-bone">
        <div className="wrap">
          <div className="band-head"><h2>How ordering works</h2></div>
          <ol className="steps">
            <li><b>Add to your bag</b><span>Choose your size and colour on each item.</span></li>
            <li><b>Send the order on WhatsApp</b><span>One tap sends us your list, your name and where to deliver.</span></li>
            <li><b>Confirm and receive</b><span>We confirm stock, the delivery fee and payment with you, then send it out.</span></li>
          </ol>
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
        <div className="filters" role="navigation" aria-label="Categories">
          <Link to="/shop" className={!category ? 'on' : ''}>Everything</Link>
          {(config?.categories || []).map((c) => <Link key={c.slug} to={`/shop/${c.slug}`} className={c.slug === category ? 'on' : ''}>{c.name}</Link>)}
        </div>
        <label className="search"><IcSearch /><input value={term} onChange={(e) => setTerm(e.target.value)} placeholder={`Search ${cat ? cat.name.toLowerCase() : 'the shop'}`} aria-label="Search" maxLength={60} /></label>
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
