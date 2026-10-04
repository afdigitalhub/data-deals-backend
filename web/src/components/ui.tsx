import { type ReactNode, type SVGProps } from 'react';
import { Link } from '../lib/router';
import { ghs } from '../lib/format';
import type { Product } from '../lib/store';
import { ApiError } from '../lib/api';

type P = SVGProps<SVGSVGElement>;
const S = (p: P & { children: ReactNode }) => <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...p} />;
export const IcBag = (p: P) => <S {...p}><path d="M5 8h14l-1 12H6L5 8Z" /><path d="M9 8V6a3 3 0 0 1 6 0v2" /></S>;
export const IcMenu = (p: P) => <S {...p}><path d="M4 7h16M4 12h16M4 17h10" /></S>;
export const IcClose = (p: P) => <S {...p}><path d="m6 6 12 12M18 6 6 18" /></S>;
export const IcSearch = (p: P) => <S {...p}><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></S>;
export const IcBack = (p: P) => <S {...p}><path d="m14 6-6 6 6 6" /></S>;
export const IcPlus = (p: P) => <S {...p}><path d="M12 5v14M5 12h14" /></S>;
export const IcMinus = (p: P) => <S {...p}><path d="M5 12h14" /></S>;
export const IcTrash = (p: P) => <S {...p}><path d="M5 7h14M10 7V5h4v2M7 7l1 13h8l1-13" /></S>;
export const IcPhone = (p: P) => <S {...p}><path d="M6 3h4l1.500 5-2.300 1.400a12 12 0 0 0 5.400 5.400L16 12.500l5 1.500v4a2 2 0 0 1-2.200 2A17 17 0 0 1 4 5.200 2 2 0 0 1 6 3Z" /></S>;
export const IcPin = (p: P) => <S {...p}><path d="M12 21s7-6.200 7-11.500A7 7 0 0 0 5 9.500C5 14.800 12 21 12 21Z" /><circle cx="12" cy="9.500" r="2.500" /></S>;
export const IcHome = (p: P) => <S {...p}><path d="M4 11.500 12 4l8 7.500V20h-5.500v-5h-5v5H4v-8.500Z" /></S>;
export const IcGrid = (p: P) => <S {...p}><rect x="4" y="4" width="6.500" height="6.500" rx="1.800" /><rect x="13.500" y="4" width="6.500" height="6.500" rx="1.800" /><rect x="4" y="13.500" width="6.500" height="6.500" rx="1.800" /><rect x="13.500" y="13.500" width="6.500" height="6.500" rx="1.800" /></S>;
export const IcShield = (p: P) => <S {...p}><path d="M12 3 5 6v5.500c0 4.300 2.900 7.700 7 9 4.100-1.300 7-4.700 7-9V6l-7-3Z" /><path d="m9 12 2.200 2.200L15.200 10" /></S>;
export const IcShoe = (p: P) => <S {...p}><path d="M3 17v-4.500c0-1 .600-1.500 1.500-1.500.800 0 1.200.800 2.500.800 1.800 0 3-2.300 3.600-4.300l2.900 1.200 1.800 3.300 3.900 1.200c1.100.400 1.800 1.300 1.800 2.500V17H3Z" /><path d="M3 14.500h18M12.300 10.200l-1.600 1M14 12.300l-1.600 1" /></S>;
export const IcDress = (p: P) => <S {...p}><path d="M9 3v3.500L10.500 9 6 20h12L13.500 9 15 6.500V3" /><path d="M9 6.500c1 .900 2 1.300 3 1.300s2-.400 3-1.300M10.500 9h3" /></S>;
export const IcShirt = (p: P) => <S {...p}><path d="m9 4-5 2.500 1.500 4L8 9.500V20h8V9.500l2.500 1 1.500-4L15 4a3 3 0 0 1-6 0Z" /></S>;
export const IcTag = (p: P) => <S {...p}><path d="M4 4h7.500l8.500 8.500-7.500 7.500L4 11.500V4Z" /><circle cx="8.300" cy="8.300" r="1.300" /></S>;
/** Picks a picture for a category from its name, so new categories the owner adds still get a sensible icon. */
export function CatIcon({ slug }: { slug: string }) {
  if (/sneak|shoe|slide|sandal|boot|heel/.test(slug)) return <IcShoe />;
  if (/women|ladies|lady|dress|girl/.test(slug)) return <IcDress />;
  if (/men|shirt|top|boy|outfit|wear/.test(slug)) return <IcShirt />;
  if (/bag|purse/.test(slug)) return <IcBag />;
  return <IcTag />;
}
export const IcTruck = (p: P) => <S {...p}><path d="M2.500 6h11v10h-11zM13.500 9.500h4l3 3.500v3h-7" /><circle cx="7" cy="17.500" r="1.800" /><circle cx="17" cy="17.500" r="1.800" /></S>;
export const IcWallet = (p: P) => <S {...p}><rect x="3" y="6" width="18" height="13" rx="2.500" /><path d="M3 10h18M15.500 14.500h2" /></S>;
export const IcArrow = (p: P) => <S {...p}><path d="M5 12h14M13 6l6 6-6 6" /></S>;
export const IcWhatsApp = (p: P) => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true" {...p}><path d="M12 2a10 10 0 0 0-8.600 15.100L2 22l5-1.300A10 10 0 1 0 12 2Zm5.300 14.100c-.200.600-1.300 1.200-1.800 1.200-.500.100-1 .200-3.300-.700-2.800-1.100-4.500-3.900-4.700-4.100-.100-.200-1.100-1.500-1.100-2.900s.700-2 1-2.300c.200-.300.500-.300.700-.300h.500c.200 0 .400 0 .600.500l.800 2c.100.200.100.400 0 .500l-.400.600-.300.300c-.100.200-.300.300-.100.600.100.300.700 1.100 1.400 1.800 1 .900 1.800 1.100 2 1.300.300.100.400.100.600-.100l.800-1c.200-.300.400-.200.600-.100l1.900.900c.300.100.500.200.500.300.100.100.100.600-.100 1.200Z" /></svg>
);

export function Wordmark({ light = false }: { light?: boolean }) {
  return (
    <Link to="/" className={`wordmark ${light ? 'on-dark' : ''}`} aria-label="Pmsomel Enterprise home">
      <svg className="wm-crown" viewBox="0 0 24 12" width="20" height="10" aria-hidden="true"><path d="M2 11h20L23 3l-5.500 4L12 1 6.500 7 1 3l1 8Z" fill="currentColor" /></svg>
      <span className="wm-name">PM</span><span className="wm-sub">Pmsomel Enterprise</span>
    </Link>
  );
}

export function Price({ p, large = false }: { p: { priceMinor: number; compareAtMinor: number | null }; large?: boolean }) {
  return (
    <span className={`price ${large ? 'price-lg' : ''}`}>
      <span>{ghs(p.priceMinor)}</span>
      {p.compareAtMinor ? <s aria-label={`Was ${ghs(p.compareAtMinor)}`}>{ghs(p.compareAtMinor)}</s> : null}
    </span>
  );
}

/** Shown where a photo will go. Uses the item's initial so an item without photos still looks deliberate. */
export function PhotoBlank({ name }: { name: string }) {
  return <div className="photo-blank" aria-hidden="true"><span>{name.trim().slice(0, 1).toUpperCase()}</span></div>;
}

export function ProductCard({ p }: { p: Product }) {
  return (
    <Link to={`/item/${p.slug}`} className={`pcard ${p.soldOut ? 'is-out' : ''}`}>
      <div className="pcard-photo">
        {p.image ? <img src={p.image} alt={p.name} loading="lazy" decoding="async" /> : <PhotoBlank name={p.name} />}
        {p.soldOut ? <span className="flag">Sold out</span> : p.compareAtMinor ? <span className="flag flag-gold">Reduced</span> : p.featured ? <span className="flag flag-gold">Featured</span> : null}
      </div>
      <div className="pcard-name">{p.name}</div>
      <div className="pcard-foot"><Price p={p} /><span className="pcard-go" aria-hidden="true"><IcBag width={18} height={18} /></span></div>
    </Link>
  );
}

export const Loading = ({ text = 'Loading' }: { text?: string }) => <div className="loading" role="status"><i /><span>{text}</span></div>;
export function Notice({ kind = 'error', children }: { kind?: 'error' | 'ok' | 'info'; children: ReactNode }) {
  return <div className={`notice notice-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>{children}</div>;
}
export const errMsg = (e: unknown) => (e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Something went wrong. Please try again.');
export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return <label className="field"><span className="field-label">{label}</span>{children}{hint ? <span className="field-hint">{hint}</span> : null}</label>;
}
