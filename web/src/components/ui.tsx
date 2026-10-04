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
export const IcWhatsApp = (p: P) => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true" {...p}><path d="M12 2a10 10 0 0 0-8.600 15.100L2 22l5-1.300A10 10 0 1 0 12 2Zm5.300 14.100c-.200.600-1.300 1.200-1.800 1.200-.500.100-1 .200-3.300-.700-2.800-1.100-4.500-3.900-4.700-4.100-.100-.200-1.100-1.500-1.100-2.900s.700-2 1-2.300c.200-.300.500-.300.700-.300h.500c.200 0 .400 0 .600.500l.800 2c.100.200.100.400 0 .500l-.400.600-.300.300c-.100.200-.300.300-.100.600.100.300.700 1.100 1.400 1.800 1 .900 1.800 1.100 2 1.300.300.100.400.100.600-.100l.800-1c.200-.300.400-.200.600-.100l1.900.900c.300.100.500.200.500.300.100.100.100.600-.100 1.200Z" /></svg>
);

export function Wordmark({ light = false }: { light?: boolean }) {
  return (
    <Link to="/" className={`wordmark ${light ? 'on-dark' : ''}`} aria-label="Pmsomel Enterprise home">
      <span className="wm-name">Pmsomel</span><span className="wm-sub">Enterprise</span>
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
        {p.soldOut ? <span className="flag">Sold out</span> : p.compareAtMinor ? <span className="flag flag-gold">Reduced</span> : null}
      </div>
      <div className="pcard-name">{p.name}</div>
      <Price p={p} />
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
