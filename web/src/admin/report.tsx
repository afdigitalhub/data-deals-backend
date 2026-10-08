import { useEffect, useState } from 'react';
import { ghs } from '../lib/format';
import { Link } from '../lib/router';
import { enablePush, pushState, type PushState } from '../lib/push';
import { useLoad } from './common';

interface DayReport { day: string; orders: number; delivered: number; salesMinor: number; waiting: number; review: number; failed: number; refunded: number; topNetwork: string | null }
const NET: Record<string, string> = { MTN: 'MTN', TELECEL: 'Telecel', AT: 'AT' };

function Day({ label, r }: { label: string; r: DayReport }) {
  return (
    <div className="dr-day">
      <div className="dr-label">{label}</div>
      {r.orders === 0 ? <div className="dr-empty">No paid orders</div> : (
        <>
          <div className="dr-big">{ghs(r.salesMinor)}</div>
          <div className="dr-line">{r.orders} order{r.orders === 1 ? '' : 's'} · {r.delivered} delivered{r.topNetwork ? ` · top: ${NET[r.topNetwork] ?? r.topNetwork}` : ''}</div>
          {(r.waiting > 0 || r.review > 0 || r.failed > 0 || r.refunded > 0) && (
            <div className="dr-flags">
              {r.waiting > 0 && <span className="dr-flag wait">{r.waiting} processing</span>}
              {r.review > 0 && <Link to="/admin/review" className="dr-flag warn">{r.review} to check</Link>}
              {r.failed > 0 && <Link to="/admin/orders?status=failed" className="dr-flag bad">{r.failed} failed</Link>}
              {r.refunded > 0 && <span className="dr-flag">{r.refunded} refunded</span>}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Today and yesterday at a glance, plus the switch that sends the owner a report to this phone every morning. */
export function DailyReportCard() {
  const { data } = useLoad<{ today: DayReport; yesterday: DayReport }>('/api/admin/daily-report');
  const [st, setSt] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const refresh = () => pushState().then((s) => setSt(s.state)).catch(() => setSt('unsupported'));
  useEffect(() => { refresh(); }, []);
  if (!data) return null;
  const turnOn = async () => {
    setBusy(true); setMsg(null);
    try { await enablePush({ marketing: false }); await refresh(); setMsg('Done. Your report will arrive on this phone every morning.'); }
    catch (e) { setMsg(e instanceof Error ? e.message : 'Could not turn on notifications'); }
    finally { setBusy(false); }
  };
  return (
    <div className="dr-card">
      <div className="dr-head"><b>Daily report</b><span>Updates as orders come in</span></div>
      <div className="dr-days"><Day label="Today so far" r={data.today} /><Day label="Yesterday" r={data.yesterday} /></div>
      {st === 'off' && <button className="btn btn-yellow btn-sm dr-btn" disabled={busy} onClick={turnOn}>{busy ? 'Turning on…' : 'Send me this report every morning'}</button>}
      {st === 'on' && <div className="dr-note">✓ Your report is sent to this phone every morning.</div>}
      {st === 'ios-needs-install' && <div className="dr-note">On iPhone: tap Share, then Add to Home Screen, open the site from there and come back here to turn on the morning report.</div>}
      {st === 'blocked' && <div className="dr-note">Notifications are blocked for this site. Allow them in your browser settings to get the morning report.</div>}
      {msg && <div className="dr-note">{msg}</div>}
    </div>
  );
}
