import { useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation } from '../lib/router';
import { useShop } from '../lib/store';
import { prettyPhone } from '../lib/format';
import { IcBag, IcClose, IcHeart, IcMenu, IcPhone, IcPin, IcSearch, IcTruck, IcUser, IcWhatsApp, Wordmark } from './ui';
import { QuickAdd, Toast } from './quickadd';

export function waLink(intl: string, text: string) { return `https://wa.me/${intl}?text=${encodeURIComponent(text)}`; }

export function Layout({ children }: { children: ReactNode }) {
  const { config, bagCount, saved } = useShop();
  const { path } = useLocation();
  const [open, setOpen] = useState(false);
  useEffect(() => { setOpen(false); }, [path]);
  useEffect(() => { document.body.style.overflow = open ? 'hidden' : ''; return () => { document.body.style.overflow = ''; }; }, [open]);
  const cats = config?.categories || [];
  const s = config?.store;
  return (
    <div className="site">
      <a href="#main" className="skip">Skip to content</a>
      <div className="strap"><IcTruck width={17} height={17} /><span>Delivery across Ghana. Order on WhatsApp, pay after we confirm.</span></div>
      <header className="top">
        <div className="top-in">
          <button className="hbtn menu-btn" onClick={() => setOpen(true)} aria-label="Open menu" aria-expanded={open}><IcMenu /></button>
          <Wordmark light />
          <nav className="top-nav" aria-label="Shop sections">
            <Link to="/" className={path === '/' ? 'on' : ''}>Home</Link>
            <Link to="/shop" className={path.startsWith('/shop') ? 'on' : ''}>Shop</Link>
            {(config?.collections || []).filter((k) => k.kind === 'vibe').map((k) => <Link key={k.slug} to={`/vibe/${k.slug}`} className={path === `/vibe/${k.slug}` ? 'on' : ''}>{k.name}</Link>)}
            <Link to="/track" className={path === '/track' ? 'on' : ''}>Track order</Link>
          </nav>
          <div className="top-tools">
            <Link to="/shop" className="hbtn hide-sm" aria-label="Search the shop"><IcSearch /></Link>
            <Link to="/my-space" className="hbtn hide-sm" aria-label="My space"><IcUser /></Link>
            <Link to="/my-space/saved" className="hbtn" aria-label={`Saved items, ${saved.length}`}><IcHeart />{saved.length > 0 && <span className="bag-count">{saved.length}</span>}</Link>
            <Link to="/bag" className="hbtn" aria-label={`Bag, ${bagCount} item${bagCount === 1 ? '' : 's'}`}><IcBag />{bagCount > 0 && <span className="bag-count">{bagCount}</span>}</Link>
          </div>
        </div>
      </header>

      {open && (
        <div className="drawer" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="drawer-scrim" onClick={() => setOpen(false)} />
          <div className="drawer-panel">
            <div className="drawer-head"><Wordmark light /><button className="hbtn" onClick={() => setOpen(false)} aria-label="Close menu"><IcClose /></button></div>
            <nav className="drawer-nav">
              <Link to="/shop">Everything</Link>
              {cats.map((c) => <Link key={c.slug} to={`/shop/${c.slug}`}>{c.name}<span>{c.count}</span></Link>)}
              {(config?.collections || []).filter((k) => k.kind === 'vibe').map((k) => <Link key={k.slug} to={`/vibe/${k.slug}`} className="sub">{k.name}</Link>)}
              <Link to="/my-space">My space</Link>
              <Link to="/track">Track an order</Link>
              <Link to="/delivery">Delivery and contact</Link>
              <Link to="/policy/returns">Returns and exchanges</Link>
            </nav>
            {s && <a className="btn btn-gold" href={waLink(s.whatsappIntl, `Hello ${s.name}, I have a question.`)} target="_blank" rel="noopener"><IcWhatsApp />Chat on WhatsApp</a>}
          </div>
        </div>
      )}

      <main id="main" key={path}>{children}</main>
      <QuickAdd />
      <Toast />

      <footer className="foot">
        <div className="foot-in">
          <div className="foot-brand">
            <Wordmark light />
            <p>{s?.tagline || 'Sneakers, outfits and the finishing touches.'}</p>
          </div>
          <div className="foot-col">
            <h2>Shop</h2>
            <Link to="/shop">Everything</Link>
            {cats.map((c) => <Link key={c.slug} to={`/shop/${c.slug}`}>{c.name}</Link>)}
          </div>
          <div className="foot-col">
            <h2>Help</h2>
            <Link to="/track">Track an order</Link>
            <Link to="/my-space">My space</Link>
            {(config?.policies || []).map((x) => <Link key={x.slug} to={`/policy/${x.slug}`}>{x.title}</Link>)}
          </div>
          <div className="foot-col">
            <h2>Reach us</h2>
            {s?.phones.map((p) => <a key={p} href={`tel:${p}`}><IcPhone width={16} height={16} />{prettyPhone(p)}</a>)}
            {s && <a href={waLink(s.whatsappIntl, `Hello ${s.name}, I have a question.`)} target="_blank" rel="noopener"><IcWhatsApp width={16} height={16} />WhatsApp</a>}
            {s?.location ? <span><IcPin width={16} height={16} />{s.location}</span> : null}
            <Link to="/delivery">Delivery and contact</Link>
          </div>
        </div>
        <div className="foot-base"><span>© {new Date().getFullYear()} {s?.name || 'Pmsomel Enterprise'}</span><Link to="/admin">Staff</Link></div>
      </footer>

      {s && path !== '/bag' && !path.startsWith('/admin') && (
        <a className="wa-fab" href={waLink(s.whatsappIntl, `Hello ${s.name}, I have a question.`)} target="_blank" rel="noopener" aria-label="Chat with us on WhatsApp"><IcWhatsApp width={26} height={26} /></a>
      )}
    </div>
  );
}
