import { useEffect, useState } from 'react';
import { disablePush, enablePush, pushState, setMarketing, type PushState } from '../lib/push';
import { Spinner } from './ui';
import { IcBell } from './icons';

type Variant = 'dashboard' | 'order' | 'settings';

/** Friendly opt-in for phone notifications. Renders nothing where notifications can't work. */
export function NotifyCard({ variant = 'dashboard', orderReference, orderToken }: { variant?: Variant; orderReference?: string; orderToken?: string }) {
  const [st, setSt] = useState<{ state: PushState; marketing: boolean; endpoint: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [daily, setDaily] = useState(variant !== 'order');
  const refresh = () => pushState().then(setSt).catch(() => setSt({ state: 'unsupported', marketing: false, endpoint: null }));
  useEffect(() => { refresh(); }, []);
  if (!st || st.state === 'unsupported' || st.state === 'disabled-by-site') return null;

  const turnOn = async () => {
    setBusy(true); setErr(null);
    try { await enablePush({ marketing: daily, orderReference, orderToken }); await refresh(); } catch (e) { setErr(e instanceof Error ? e.message : 'Could not turn on notifications'); } finally { setBusy(false); }
  };

  if (st.state === 'on') {
    if (variant === 'order') return <div className="notify-card notify-on"><span className="notify-ic"><IcBell /></span><div className="notify-body"><b>Notifications are on.</b> We'll alert this phone when the order is delivered.</div></div>;
    if (variant === 'dashboard') return null; // keep the dashboard clean once enabled; manage it under Profile & security or /notifications
    return (
      <div className="notify-card notify-on">
        <span className="notify-ic"><IcBell /></span>
        <div className="notify-body">
          <b>Notifications are on for this phone</b>
          <label className="check" style={{ margin: '10px 0 6px' }}>
            <input type="checkbox" checked={st.marketing} disabled={busy} onChange={async (e) => { const v = e.target.checked; setBusy(true); try { await setMarketing(st.endpoint!, v); await refresh(); } finally { setBusy(false); } }} />
            <span>Daily data deals and "running low" reminders</span>
          </label>
          <div className="tiny muted">Order updates (delivered, failed, refunded) always come through while notifications are on.</div>
          <button className="btn btn-ghost btn-sm" style={{ marginTop: 8, paddingLeft: 0 }} disabled={busy} onClick={async () => { setBusy(true); try { await disablePush(st.endpoint!); await refresh(); } finally { setBusy(false); } }}>Turn off all notifications</button>
        </div>
      </div>
    );
  }

  if (st.state === 'ios-needs-install') {
    return (
      <div className="notify-card">
        <span className="notify-ic"><IcBell /></span>
        <div className="notify-body">
          <b>{variant === 'order' ? 'Want a delivery alert?' : 'Get DataCedi notifications on your iPhone'}</b>
          <div className="small">Tap the <b>Share</b> button in Safari, choose <b>Add to Home Screen</b>, then open DataCedi from your home screen and turn notifications on.</div>
        </div>
      </div>
    );
  }

  if (st.state === 'blocked') {
    if (variant !== 'settings') return null;
    return <div className="notify-card"><span className="notify-ic"><IcBell /></span><div className="notify-body"><b>Notifications are blocked for this site</b><div className="small">Open your browser's site settings for DataCedi, allow notifications, then come back to this page.</div></div></div>;
  }

  const copy = variant === 'order'
    ? { title: 'Get an alert when it\'s delivered', text: 'We\'ll notify this phone the moment your bundle lands.', cta: 'Notify me' }
    : { title: 'Get data deals on your phone 🔔', text: 'One short message a day with deals, a reminder when your data may be running low, and an alert the moment an order is delivered. Turn it off anytime.', cta: 'Turn on notifications' };
  return (
    <div className="notify-card">
      <span className="notify-ic"><IcBell /></span>
      <div className="notify-body">
        <b>{copy.title}</b>
        <div className="small">{copy.text}</div>
        {variant === 'order' && (
          <label className="check" style={{ margin: '8px 0 0' }}><input type="checkbox" checked={daily} onChange={(e) => setDaily(e.target.checked)} /><span className="small">Also send me daily data deals</span></label>
        )}
        {err && <div className="small" style={{ color: 'var(--danger)', marginTop: 6 }}>{err}</div>}
        <button className="btn btn-dark btn-sm" style={{ marginTop: 10 }} onClick={turnOn} disabled={busy}>{busy ? <Spinner /> : copy.cta}</button>
      </div>
    </div>
  );
}
