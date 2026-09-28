import { InstallBanner } from './InstallBanner';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, navigate, useLocation } from '../lib/router';
import { useApp } from '../lib/app-state';
import { Logo } from './ui';
import { IcChat, IcHeadset, IcHome, IcList, IcMenu, IcTag, IcUser, IcX } from './icons';

const NAV = [
  { to: '/', label: 'Home' },
  { to: '/airtime', label: 'Airtime' },
  { to: '/data-bundles', label: 'Data Bundles' },
  { to: '/rates', label: 'Rates' },
  { to: '/how-it-works', label: 'How it Works' },
  { to: '/track', label: 'Track Order' },
  { to: '/support', label: 'Support' },
];

export function Header({ onYellow = false }: { onYellow?: boolean }) {
  const { path } = useLocation();
  const { user, config } = useApp();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);
  const isStaff = user && user.role !== 'customer';
  return (
    <>
      {config?.maintenance.enabled && <div className="banner">{config.maintenance.message}</div>}
      {config?.payments.enabled && config.payments.testMode && <div className="banner test">Test mode — payments on this site are not real yet.</div>}
      <header className={`site-header ${onYellow && !open ? 'on-yellow' : ''}`}>
        <div className="container inner">
          <Logo />
          <nav className="nav" aria-label="Main">
            {NAV.map((n) => <Link key={n.to} to={n.to} className={path === n.to ? 'active' : ''}>{n.label}</Link>)}
          </nav>
          <div className="header-actions">
            {user ? (
              <>
                {isStaff && <Link to="/admin" className="btn btn-outline btn-sm desktop-only">Admin</Link>}
                <Link to="/account" className="btn btn-dark desktop-only">My account</Link>
              </>
            ) : (
              <>
                <Link to="/login" className="btn btn-outline desktop-only" style={{ minWidth: 100 }}>Login</Link>
                <Link to="/register" className="btn btn-dark desktop-only" style={{ minWidth: 110 }}>Sign Up</Link>
              </>
            )}
            <button className="icon-btn menu-toggle" aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open} onClick={() => setOpen(!open)}>{open ? <IcX /> : <IcMenu />}</button>
          </div>
        </div>
      </header>
      {open && (
        <div className="mobile-menu">
          {NAV.map((n) => <Link key={n.to} to={n.to}>{n.label}</Link>)}
          <div className="stack" style={{ marginTop: 20 }}>
            {user ? (
              <>
                <Link to="/account" className="btn btn-dark btn-block" style={{ borderBottom: 0 }}>My account</Link>
                {isStaff && <Link to="/admin" className="btn btn-outline btn-block" style={{ borderBottom: 0 }}>Admin dashboard</Link>}
              </>
            ) : (
              <>
                <Link to="/login" className="btn btn-outline btn-block" style={{ borderBottom: 0 }}>Login</Link>
                <Link to="/register" className="btn btn-dark btn-block" style={{ borderBottom: 0 }}>Create account</Link>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

export function Footer() {
  const { config } = useApp();
  const b = config?.business;
  return (
    <footer className="site-footer">
      <div className="container">
        <div className="footer-cols">
          <div>
            <Logo light />
            <p className="small" style={{ marginTop: 12, maxWidth: '34ch', color: '#B9BBC0' }}>Airtime and data bundles for MTN, Telecel and AT. Pay with Mobile Money or card.</p>
            {(b?.supportEmail || b?.supportPhone || b?.whatsappNumber) && (
              <ul className="small" style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 6 }}>
                {b?.supportPhone && <li>Call: <a href={`tel:${b.supportPhone.replace(/\s/g, '')}`}>{b.supportPhone}</a></li>}
                {b?.whatsappNumber && <li>WhatsApp: <a href={`https://wa.me/${b.whatsappNumber.replace(/\D/g, '')}`} target="_blank" rel="noopener">Chat with us</a></li>}
                {b?.supportEmail && <li>Email: <a href={`mailto:${b.supportEmail}`}>{b.supportEmail}</a></li>}
              </ul>
            )}
          </div>
          <div>
            <h4>Buy</h4>
            <ul><li><Link to="/airtime">Airtime</Link></li><li><Link to="/data-bundles">Data bundles</Link></li><li><Link to="/rates">Rates</Link></li><li><Link to="/how-it-works">How it works</Link></li></ul>
          </div>
          <div>
            <h4>Help</h4>
            <ul><li><Link to="/support">Support & FAQs</Link></li><li><Link to="/support#contact">Report a problem</Link></li><li><Link to="/contact">Contact</Link></li><li><Link to="/track">Track an order</Link></li></ul>
          </div>
          <div>
            <h4>Company</h4>
            <ul><li><Link to="/about">About</Link></li><li><Link to="/terms">Terms</Link></li><li><Link to="/privacy">Privacy</Link></li><li><Link to="/refund-policy">Refund policy</Link></li></ul>
          </div>
        </div>
        <div className="small" style={{ borderTop: '1px solid #2A2C31', marginTop: 32, paddingTop: 18, color: '#8E9197' }}>
          © {new Date().getFullYear()} {b?.name || 'Data Deals'}. MTN, Telecel and AT are trademarks of their respective owners. Data Deals is an independent reseller and is not affiliated with any network.
        </div>
      </div>
    </footer>
  );
}

export function BottomNav() {
  const { path } = useLocation();
  const { user } = useApp();
  const items = [
    { to: '/', label: 'Home', icon: <IcHome /> },
    { to: '/data-bundles', label: 'Deals', icon: <IcTag /> },
    { to: user ? '/account/orders' : '/track', label: 'Orders', icon: <IcList /> },
    { to: '/support', label: 'Support', icon: <IcHeadset /> },
    { to: '/account', label: 'Profile', icon: <IcUser /> },
  ];
  const active = (to: string) => (to === '/' ? path === '/' : to === '/account' ? path === '/account' || path.startsWith('/account/profile') : path.startsWith(to));
  return (
    <nav className="bottom-nav" aria-label="Quick navigation">
      {items.map((i) => <Link key={i.to} to={i.to} className={active(i.to) ? 'active' : ''}><span className="dot">{i.icon}</span>{i.label}</Link>)}
    </nav>
  );
}

export function SiteLayout({ children, onYellow = false }: { children: ReactNode; onYellow?: boolean }) {
  return (
    <div className="has-bottom-nav">
      <Header onYellow={onYellow} />
      <main id="main">{children}</main>
      <Footer />
      <InstallBanner />
      <BottomNav />
    </div>
  );
}

export function WhatsAppLink({ children, text }: { children?: ReactNode; text?: string }) {
  const { config } = useApp();
  const n = config?.business.whatsappNumber;
  if (!n) return null;
  return <a className="btn btn-light" href={`https://wa.me/${n.replace(/\D/g, '')}${text ? `?text=${encodeURIComponent(text)}` : ''}`} target="_blank" rel="noopener"><IcChat width={18} height={18} />{children || 'WhatsApp us'}</a>;
}

export function goLogin(next?: string) { navigate(`/login${next ? `?next=${encodeURIComponent(next)}` : ''}`); }
