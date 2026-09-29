import { useEffect, useRef, useState } from 'react';
import { useApp } from '../lib/app-state';
import { ghs } from '../lib/format';
import { Link } from '../lib/router';
import { NetworkBadge } from './ui';

const STEPS = [
  { title: 'Choose your network', text: 'Tap MTN, Telecel or AT.' },
  { title: 'Type the number', text: 'Yours or anyone you want to send data to.' },
  { title: 'Pick a bundle', text: 'See the full price before you pay.' },
  { title: 'Pay with MoMo', text: 'Approve on your phone. Data lands in seconds.' },
];
const DEMO_NUMBER = '024 123 4567';
const STEP_MS = 3400;

/** Animated "how to buy data" walkthrough on a phone screen. Pure CSS/JS: no video download. */
export function HowToBuyDemo() {
  const { products } = useApp();
  const [step, setStep] = useState(0);
  const [typed, setTyped] = useState(0);
  const [phase, setPhase] = useState(0); // step 4: 0 = MoMo prompt, 1 = delivered
  const [visible, setVisible] = useState(false);
  const [manual, setManual] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  // Real bundles only: the cheapest live MTN bundles, so the demo never shows a made-up price.
  const mtn = (products || []).filter((p) => p.kind === 'data' && p.network === 'MTN' && p.priceMinor).sort((a, b) => (a.priceMinor! - b.priceMinor!)).slice(0, 3);
  const pick = mtn[0];
  const size = (mb: number | null) => (!mb ? '' : mb % 1024 === 0 ? `${mb / 1024}GB` : `${mb}MB`);

  useEffect(() => {
    const el = ref.current;
    if (!el || !('IntersectionObserver' in window)) { setVisible(true); return; }
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.25 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Auto-advance while on screen (paused if the visitor tapped a step or prefers reduced motion).
  useEffect(() => {
    if (!visible || manual || reduced) return;
    const t = setTimeout(() => setStep((s) => (s + 1) % STEPS.length), step === 3 ? STEP_MS + 1600 : STEP_MS);
    return () => clearTimeout(t);
  }, [step, visible, manual, reduced]);

  // Typing effect on step 2; MoMo → delivered on step 4.
  useEffect(() => {
    setTyped(step === 1 && !reduced ? 0 : DEMO_NUMBER.length);
    setPhase(0);
    if (step === 1 && !reduced) {
      let n = 0;
      const i = setInterval(() => { n++; setTyped(n); if (n >= DEMO_NUMBER.length) clearInterval(i); }, 150);
      return () => clearInterval(i);
    }
    if (step === 3) { const t = setTimeout(() => setPhase(1), reduced ? 0 : 2000); return () => clearTimeout(t); }
  }, [step, reduced]);

  const choose = (i: number) => { setManual(true); setStep(i); };

  return (
    <div className="demo" ref={ref}>
      <div className="demo-phone" aria-hidden="true">
        <div className="demo-notch" />
        <div className="demo-screen">
          <div className="demo-top"><span className="demo-logo">Data<b>Cedi</b></span><span className="demo-step">Step {step + 1}/4</span></div>

          <div className={`demo-pane ${step === 0 ? 'on' : ''}`}>
            <div className="demo-label">1. Select network</div>
            <div className="demo-nets">
              {(['MTN', 'TELECEL', 'AT'] as const).map((c, i) => (
                <div key={c} className={`demo-net ${i === 0 ? 'pick' : ''}`}><NetworkBadge code={c} size="sm" /><span>{c === 'TELECEL' ? 'Telecel' : c}</span>{i === 0 && <i className="demo-tap" />}</div>
              ))}
            </div>
          </div>

          <div className={`demo-pane ${step === 1 ? 'on' : ''}`}>
            <div className="demo-label">2. Enter phone number</div>
            <div className="demo-input"><span className="demo-flag">🇬🇭</span>{DEMO_NUMBER.slice(0, typed)}<i className="demo-caret" /></div>
            <div className="demo-hint">✓ MTN number</div>
          </div>

          <div className={`demo-pane ${step === 2 ? 'on' : ''}`}>
            <div className="demo-label">3. Choose data bundle</div>
            {(mtn.length ? mtn : [null, null, null]).map((p, i) => (
              <div key={i} className={`demo-bundle ${i === 0 ? 'pick' : ''}`}>
                <span><b>{p ? size(p.dataMb) : '—'}</b> <small>{p?.validity || 'MTN data'}</small></span>
                <b>{p ? ghs(p.priceMinor! + p.feeMinor) : ''}</b>
                {i === 0 && <i className="demo-tap" />}
              </div>
            ))}
          </div>

          <div className={`demo-pane ${step === 3 ? 'on' : ''}`}>
            {phase === 0 ? (
              <div className="demo-momo">
                <div className="demo-momo-h">Mobile Money</div>
                <div>Approve payment of</div>
                <div className="demo-momo-amt">{pick ? ghs(pick.priceMinor! + pick.feeMinor) : 'your bundle'}</div>
                <div className="demo-momo-btn">Approve ✓<i className="demo-tap" /></div>
              </div>
            ) : (
              <div className="demo-done">
                <div className="demo-check">✓</div>
                <b>Delivered!</b>
                <span>{pick ? `${size(pick.dataMb)} MTN` : 'Your bundle'} sent to {DEMO_NUMBER}</span>
              </div>
            )}
          </div>

          {step < 3 && <div className={`demo-cta step-${step}`}>{step === 2 ? (pick ? `Buy · ${ghs(pick.priceMinor! + pick.feeMinor)}` : 'Buy Data Bundle') : 'Continue'}<i className="demo-tap" /></div>}
          <div className="demo-note">{step === 0 ? 'Network matched to the number' : step === 1 ? 'Buy for yourself or anyone' : step === 2 ? 'No hidden fees' : 'Secured by Paystack 🔒'}</div>
          <div className="demo-bar"><i key={`${step}-${manual}`} style={{ animationDuration: `${step === 3 ? STEP_MS + 1600 : STEP_MS}ms`, animationPlayState: visible && !manual && !reduced ? 'running' : 'paused' }} /></div>
        </div>
      </div>

      <div className="demo-steps">
        <div className="eyebrow">How to buy data</div>
        <h2>Data in 4 easy steps</h2>
        <ol>
          {STEPS.map((s, i) => (
            <li key={s.title}>
              <button className={i === step ? 'on' : ''} onClick={() => choose(i)} aria-pressed={i === step}>
                <span className="demo-num">{i + 1}</span>
                <span><b>{s.title}</b><small>{s.text}</small></span>
              </button>
            </li>
          ))}
        </ol>
        <a href="#buy" className="btn btn-dark btn-lg" onClick={(e) => { e.preventDefault(); document.getElementById('buy')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>Buy data now</a>
        <Link to="/how-it-works" className="link small" style={{ marginLeft: 14 }}>More details</Link>
      </div>
    </div>
  );
}

/** Moving text strip in brand colours. */
export function Ticker() {
  const items = ['MTN', 'Telecel', 'AT', 'Pay with Mobile Money', 'Buy for anyone', 'Track every order', 'Secure checkout by Paystack', 'Akwaaba 👋'];
  const row = items.map((t, i) => <span key={i}>{t}<i>⚡</i></span>);
  return (
    <div className="ticker" aria-hidden="true">
      <div className="ticker-track">{row}{row}</div>
    </div>
  );
}

const WORDS = ['MTN data', 'Telecel data', 'AT data', 'airtime'];

/** Phone-size hero stage: the DataCedi lady with rotating text and a moving strip. */
export function HeroStage() {
  const [i, setI] = useState(0);
  const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  useEffect(() => {
    if (reduced) return;
    const t = setInterval(() => setI((n) => (n + 1) % WORDS.length), 2200);
    return () => clearInterval(t);
  }, [reduced]);
  const strip = ['MTN', 'Telecel', 'AT', 'Pay with MoMo', 'Delivered fast', 'Akwaaba 👋'].map((t, k) => <span key={k}>{t}<i>⚡</i></span>);
  return (
    <div className="stage">
      <div className="stage-glow" aria-hidden="true" />
      <img className="stage-lady" src="/images/hero-lady.webp" alt="Smiling customer buying data on her phone" width="372" height="540" decoding="async" fetchPriority="high" />
      <div className="stage-copy">
        <span className="stage-pill">⚡ Instant top-up</span>
        <div className="stage-line">Buy</div>
        <div className="stage-word" aria-live="polite"><span key={i}>{WORDS[i]}</span></div>
        <div className="stage-sub">for yourself or anyone, in seconds</div>
      </div>
      <div className="stage-strip" aria-hidden="true"><div className="ticker-track">{strip}{strip}</div></div>
    </div>
  );
}
