import { type ReactNode, type SVGProps } from 'react';
import { Link } from '../lib/router';
import { ghs } from '../lib/format';
import { useShop, type Product } from '../lib/store';
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
  if (/^men|shirt|top|boy|outfit|wear/.test(slug)) return <IcShirt />;
  if (/bag|purse/.test(slug)) return <IcBag />;
  return <IcTag />;
}
export const IcTruck = (p: P) => <S {...p}><path d="M2.500 6h11v10h-11zM13.500 9.500h4l3 3.500v3h-7" /><circle cx="7" cy="17.500" r="1.800" /><circle cx="17" cy="17.500" r="1.800" /></S>;
export const IcWallet = (p: P) => <S {...p}><rect x="3" y="6" width="18" height="13" rx="2.500" /><path d="M3 10h18M15.500 14.500h2" /></S>;
export const IcArrow = (p: P) => <S {...p}><path d="M5 12h14M13 6l6 6-6 6" /></S>;
export const IcHeart = ({ filled, ...p }: P & { filled?: boolean }) => <S {...p} fill={filled ? 'currentColor' : 'none'}><path d="M12 20s-7.500-4.600-7.500-10.200A4.300 4.300 0 0 1 12 7.400a4.300 4.300 0 0 1 7.500 2.400C19.500 15.400 12 20 12 20Z" /></S>;
export const IcUser = (p: P) => <S {...p}><circle cx="12" cy="8.500" r="3.700" /><path d="M4.500 20c1.200-3.600 4-5.400 7.500-5.400s6.300 1.800 7.500 5.400" /></S>;
export const IcCheck = (p: P) => <S {...p}><path d="m5 12.500 4.500 4.500L19 7.500" /></S>;
export const IcRuler = (p: P) => <S {...p}><path d="M3.500 15.500 15.500 3.500l5 5-12 12-5-5Z" /><path d="m7.500 11.500 2 2M10.500 8.500l2 2M13.500 5.500l2 2" /></S>;
export const IcGift = (p: P) => <S {...p}><path d="M4 11h16v9H4zM3 7.500h18V11H3zM12 7.500V20M12 7.500c-1.500-3.500-5.500-3.500-5.500-1.200 0 1.200 2 1.200 5.500 1.200Zm0 0c1.500-3.500 5.500-3.500 5.500-1.200 0 1.200-2 1.200-5.500 1.200Z" /></S>;
export const IcBox = (p: P) => <S {...p}><path d="M3.500 7.500 12 3l8.500 4.500v9L12 21l-8.500-4.500v-9Z" /><path d="M3.500 7.500 12 12l8.500-4.500M12 12v9" /></S>;
export const IcCog = (p: P) => <S {...p}><circle cx="12" cy="12" r="3" /><path d="M12 3v2.500M12 18.500V21M3 12h2.500M18.500 12H21M5.600 5.600l1.800 1.800M16.600 16.600l1.800 1.800M5.600 18.400l1.800-1.800M16.600 7.400l1.800-1.800" /></S>;
export const IcDoc = (p: P) => <S {...p}><path d="M6 3h8l4 4v14H6V3Z" /><path d="M14 3v4h4M9 12h6M9 16h6" /></S>;
export const IcLayers = (p: P) => <S {...p}><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 13 9 5 9-5" /></S>;
export const IcWhatsApp = (p: P) => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true" {...p}><path d="M12 2a10 10 0 0 0-8.600 15.100L2 22l5-1.300A10 10 0 1 0 12 2Zm5.300 14.100c-.200.600-1.300 1.200-1.800 1.200-.500.100-1 .200-3.300-.700-2.800-1.100-4.500-3.900-4.700-4.100-.100-.200-1.100-1.500-1.100-2.900s.700-2 1-2.300c.200-.300.500-.300.700-.300h.500c.200 0 .400 0 .600.500l.800 2c.100.200.100.400 0 .500l-.400.600-.300.300c-.100.200-.300.300-.100.600.100.300.700 1.100 1.400 1.800 1 .900 1.800 1.100 2 1.300.300.100.400.100.600-.100l.800-1c.200-.300.400-.200.600-.100l1.900.900c.300.100.500.200.500.300.100.100.100.600-.100 1.200Z" /></svg>
);

/** The PM mark. "row" is the header form: mark on the left, name beside it. Without it, the stacked form for footers and sign-in. */
export function Wordmark({ light = false, row = false, to = '/' }: { light?: boolean; row?: boolean; to?: string }) {
  const crown = <svg className="wm-crown" viewBox="0 0 24 12" width="20" height="10" aria-hidden="true"><path d="M2 11h20L23 3l-5.500 4L12 1 6.500 7 1 3l1 8Z" fill="currentColor" /></svg>;
  if (row) return (
    <Link to={to} className={`wordmark wm-row ${light ? 'on-dark' : ''}`} aria-label="Pmsomel Enterprise home">
      <span className="wm-mark">{crown}<span className="wm-name">PM</span></span>
      <span className="wm-text"><b>Pmsomel</b><i>Enterprise</i></span>
    </Link>
  );
  return (
    <Link to={to} className={`wordmark ${light ? 'on-dark' : ''}`} aria-label="Pmsomel Enterprise home">
      {crown}<span className="wm-name">PM</span><span className="wm-sub">Pmsomel Enterprise</span>
    </Link>
  );
}

export function Price({ p, large = false }: { p: { priceMinor: number; compareAtMinor: number | null }; large?: boolean }) {
  return (
    <span className={`price ${large ? 'price-lg' : ''}`}>
      <span>{p.priceMinor > 0 ? ghs(p.priceMinor) : 'Ask for price'}</span>
      {p.compareAtMinor ? <s aria-label={`Was ${ghs(p.compareAtMinor)}`}>{ghs(p.compareAtMinor)}</s> : null}
    </span>
  );
}

/** Shown where a photo will go. Uses the item's initial so an item without photos still looks deliberate. */
export function PhotoBlank({ name }: { name: string }) {
  return <div className="photo-blank" aria-hidden="true"><span>{name.trim().slice(0, 1).toUpperCase()}</span></div>;
}

const SWATCH: Record<string, string> = {
  black: '#111', white: '#f7f7f5', cream: '#efe6d2', beige: '#dfcfb4', taupe: '#9c8f80', brown: '#6b4428', olive: '#7b7a35', yellow: '#e3b21c', grey: '#9a9a9a', gray: '#9a9a9a',
  blue: '#2046c9', navy: '#1b2550', red: '#d2301f', green: '#1f5a36', wine: '#6a1526', pink: '#e58aa6', orange: '#d9661f', purple: '#6a3d9a', gold: '#c9a24a', silver: '#c8c8c8',
};
export const swatch = (name: string) => SWATCH[name.trim().toLowerCase()] || null;

/** Small colour dots for a card. Unknown colour names are counted in words rather than guessed at. */
export function ColourDots({ colours }: { colours: string[] }) {
  if (colours.length < 2) return null;
  const known = colours.map((c) => ({ c, hex: swatch(c) }));
  if (known.some((k) => !k.hex)) return <span className="dots-text">{colours.length} colours</span>;
  return <span className="dots" aria-label={`${colours.length} colours: ${colours.join(', ')}`}>{known.slice(0, 5).map((k) => <i key={k.c} style={{ background: k.hex! }} />)}{colours.length > 5 ? <em>+{colours.length - 5}</em> : null}</span>;
}

const BADGE: Record<string, string> = { limited: 'Limited', bestseller: 'Bestseller', trending: 'Trending' };
/** One badge per card, the most useful one. Each comes from the item's real state, never from decoration. */
export function badgeFor(p: Product): { text: string; gold: boolean } | null {
  if (p.soldOut) return { text: 'Sold out', gold: false };
  if (p.compareAtMinor) return { text: 'Sale', gold: true };
  for (const k of ['limited', 'bestseller', 'trending']) if (p.badges?.includes(k)) return { text: BADGE[k], gold: true };
  if (p.isNew) return { text: 'New', gold: false };
  return null;
}

export function SaveButton({ p, className = '' }: { p: { id: number; name: string }; className?: string }) {
  const { isSaved, toggleSaved } = useShop();
  const on = isSaved(p.id);
  return <button type="button" className={`save ${on ? 'on' : ''} ${className}`} aria-pressed={on} aria-label={on ? `Remove ${p.name} from saved items` : `Save ${p.name}`} onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleSaved(p); }}><IcHeart filled={on} width={19} height={19} /></button>;
}

export function ProductCard({ p }: { p: Product }) {
  const { add, say, openQuick } = useShop();
  const badge = badgeFor(p);
  const needsChoice = p.sizes.length > 1 || p.colours.length > 1;
  const quick = () => {
    if (needsChoice) { openQuick(p); return; }
    add(p, p.sizes[0] || '', p.colours[0] || '', 1);
    say(`${p.name} is in your bag`, '/bag', 'View bag');
  };
  return (
    <article className={`pcard ${p.soldOut ? 'is-out' : ''}`}>
      <Link to={`/item/${p.slug}`} className="pcard-link">
        <div className={`pcard-photo ${p.thumb2 ? 'has-two' : ''}`}>
          {p.thumb ? <img src={p.thumb} alt={p.name} loading="lazy" decoding="async" /> : <PhotoBlank name={p.name} />}
          {p.thumb2 ? <img className="alt" src={p.thumb2} alt="" loading="lazy" decoding="async" /> : null}
          {badge ? <span className={`flag ${badge.gold ? 'flag-gold' : ''}`}>{badge.text}</span> : null}
        </div>
        <div className="pcard-name">{p.name}</div>
      </Link>
      <SaveButton p={p} className="pcard-save" />
      <div className="pcard-foot">
        <span className="pcard-meta"><Price p={p} /><ColourDots colours={p.colours} /></span>
        {!p.soldOut && <button type="button" className="pcard-go" onClick={quick} aria-label={needsChoice ? `Choose options for ${p.name}` : `Add ${p.name} to bag`}><IcPlus width={18} height={18} /></button>}
      </div>
    </article>
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
