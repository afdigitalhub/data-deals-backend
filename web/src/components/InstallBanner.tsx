import { useEffect, useState } from 'react';
import { safeStorage } from '../lib/api';
import { isStandalone } from '../lib/push';
import { useLocation } from '../lib/router';
import { IcX } from './icons';

// Chrome fires this once, early; keep it so the banner can use it later.
let deferred: any = null;
const listeners = new Set<() => void>();
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; listeners.forEach((f) => f()); });
  window.addEventListener('appinstalled', () => { deferred = null; safeStorage().set('dd_install_done', '1'); listeners.forEach((f) => f()); });
}

const KEY = 'dd_install_dismissed';
const HIDE_ON = ['/checkout', '/order/', '/login', '/register', '/reset', '/forgot', '/invite', '/admin'];
const isIOSSafari = () => /iPad|iPhone|iPod/.test(navigator.userAgent) && /Safari/.test(navigator.userAgent) && !/CriOS|FxiOS|EdgiOS/.test(navigator.userAgent);

export function InstallBanner() {
  const { path } = useLocation();
  const [, force] = useState(0);
  const [ready, setReady] = useState(false);
  const [hidden, setHidden] = useState(() => {
    const t = Number(safeStorage().get(KEY) || 0);
    return !!safeStorage().get('dd_install_done') || (t && Date.now() - t < 14 * 86_400_000);
  });
  useEffect(() => { const f = () => force((n) => n + 1); listeners.add(f); const t = setTimeout(() => setReady(true), 4000); return () => { listeners.delete(f); clearTimeout(t); }; }, []);
  if (hidden || !ready || isStandalone() || HIDE_ON.some((p) => path.startsWith(p))) return null;
  const ios = isIOSSafari();
  if (!deferred && !ios) return null;
  const dismiss = () => { safeStorage().set(KEY, String(Date.now())); setHidden(true); };
  return (
    <div className="install-banner" role="dialog" aria-label="Install Data Deals">
      <img src="/icons/icon-192.png" alt="" width="44" height="44" />
      <div className="install-text">
        <b>Get the Data Deals app</b>
        {ios ? <span>Tap <b>Share</b> <ShareGlyph /> then <b>Add to Home Screen</b></span> : <span>Buy data in 2 taps, right from your home screen</span>}
      </div>
      {!ios && <button className="btn btn-dark btn-sm" onClick={async () => { const d = deferred; if (!d) return; d.prompt(); const r = await d.userChoice.catch(() => null); deferred = null; if (r?.outcome === 'accepted') safeStorage().set('dd_install_done', '1'); setHidden(true); }}>Install</button>}
      <button className="install-x" aria-label="Not now" onClick={dismiss}><IcX width={18} height={18} /></button>
    </div>
  );
}

function ShareGlyph() {
  return <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline', verticalAlign: '-2px' }} aria-label="Share"><path d="M12 3v12M8 7l4-4 4 4" /><path d="M5 11v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8" /></svg>;
}
