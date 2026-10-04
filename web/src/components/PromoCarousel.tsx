import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useApp } from '../lib/app-state';
import { ghs } from '../lib/format';
import { navigate } from '../lib/router';

interface Slide { key: string; tone: string; badge: string; title: ReactNode; sub: string; cta: string; art: ReactNode; go: () => void }

const INTERVAL = 4500;
const toBuy = () => document.getElementById('buy')?.scrollIntoView({ behavior: 'smooth', block: 'start' });

/** Auto-sliding promo banners at the top of the home page. Swipe or tap the dots; pauses while touched. */
export function PromoCarousel() {
  const { products } = useApp();
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const track = useRef<HTMLDivElement>(null);
  const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  // Real price only: the cheapest live MTN data bundle. If none is loaded, the slide shows no price.
  const mtn = (products || []).filter((p) => p.kind === 'data' && p.network === 'MTN' && p.priceMinor && p.dataMb)
    .sort((a, b) => a.priceMinor! + a.feeMinor - (b.priceMinor! + b.feeMinor))[0];
  const size = mtn?.dataMb ? (mtn.dataMb % 1024 === 0 ? `${mtn.dataMb / 1024}GB` : `${mtn.dataMb}MB`) : '';

  const slides: Slide[] = [
    {
      key: 'price', tone: 'night', badge: '⚡ Hot deal',
      title: mtn ? <>MTN {size} for <em>{ghs(mtn.priceMinor! + mtn.feeMinor)}</em></> : <>Cheap <em>MTN data</em> bundles</>,
      sub: 'Great prices. See the full price before you pay.', cta: 'Buy MTN data',
      art: <span className="promo-art-big">{size || 'GB'}</span>,
      go: () => navigate('/data-bundles?network=MTN'),
    },
    {
      key: 'anyone', tone: 'orange', badge: '📱 Send data',
      title: <>Buy for <em>anyone</em></>, sub: 'Mum, your guy, your babe — just type their number.', cta: 'Send data now',
      art: <span className="promo-art-ic">📲</span>, go: toBuy,
    },
    {
      key: 'momo', tone: 'light', badge: '🔒 Secure payment',
      title: <>Pay with <em>Mobile Money</em></>, sub: 'MTN MoMo, Telecel Cash and AT Money.', cta: 'See all bundles',
      art: <span className="promo-art-ic">🔒</span>, go: () => navigate('/data-bundles'),
    },
    {
      key: 'chat', tone: 'deep', badge: '💬 Real people',
      title: <>Need help? <em>Chat with us</em></>, sub: 'Our team replies right here on the website.', cta: 'Start a chat',
      art: <span className="promo-art-ic">💬</span>, go: () => window.dispatchEvent(new Event('dd-open-chat')),
    },
  ];

  const goTo = (i: number, smooth = true) => {
    const el = track.current;
    if (!el) return;
    el.scrollTo({ left: el.clientWidth * i, behavior: smooth && !reduced ? 'smooth' : 'auto' });
  };

  // Keep the dots in sync with swiping.
  useEffect(() => {
    const el = track.current;
    if (!el) return;
    let raf = 0;
    const on = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => setIdx(Math.round(el.scrollLeft / Math.max(1, el.clientWidth)))); };
    el.addEventListener('scroll', on, { passive: true });
    return () => { el.removeEventListener('scroll', on); cancelAnimationFrame(raf); };
  }, []);

  // Auto-advance while visible and not being touched.
  useEffect(() => {
    if (paused || reduced) return;
    const t = setTimeout(() => { if (document.visibilityState === 'visible') goTo((idx + 1) % slides.length); }, INTERVAL);
    return () => clearTimeout(t);
  }, [idx, paused, reduced]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="promo-car" aria-roledescription="carousel" aria-label="Data Glow offers"
      onPointerEnter={(e) => e.pointerType === 'mouse' && setPaused(true)} onPointerLeave={() => setPaused(false)}
      onTouchStart={() => setPaused(true)} onTouchEnd={() => setTimeout(() => setPaused(false), 2500)}>
      <div className="promo-track" ref={track}>
        {slides.map((s, i) => (
          <button key={s.key} type="button" className={`promo-slide tone-${s.tone}`} onClick={s.go}
            aria-roledescription="slide" aria-label={`${i + 1} of ${slides.length}`} tabIndex={i === idx ? 0 : -1}>
            <span className="promo-glow" aria-hidden="true" />
            <span className="promo-copy">
              <span className="promo-badge">{s.badge}</span>
              <span className="promo-title">{s.title}</span>
              <span className="promo-sub">{s.sub}</span>
              <span className="promo-cta">{s.cta} →</span>
            </span>
            <span className="promo-art" aria-hidden="true">{s.art}</span>
          </button>
        ))}
      </div>
      <div className="promo-dots">
        {slides.map((s, i) => (
          <button key={s.key} type="button" className={i === idx ? 'on' : ''} onClick={() => goTo(i)} aria-label={`Show offer ${i + 1}`} aria-current={i === idx}>
            {i === idx && !paused && !reduced && <i key={idx} style={{ animationDuration: `${INTERVAL}ms` }} />}
          </button>
        ))}
      </div>
    </div>
  );
}
