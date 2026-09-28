import { NotifyCard } from '../components/NotifyCard';
import { useState, type FormEvent } from 'react';
import { post } from '../lib/api';
import { rememberOrder, rememberedOrders } from '../lib/app-state';
import { dateOnly } from '../lib/format';
import { Link, navigate, useLocation, usePageTitle } from '../lib/router';
import { SiteLayout } from '../components/layout';
import { Alert, Field, Input, Spinner, errMsg } from '../components/ui';

/** Find an order with its order number + the phone number used on it. No account needed. */
export function TrackForm({ compact = false }: { compact?: boolean }) {
  const { search } = useLocation();
  const [reference, setReference] = useState(search.get('ref') || '');
  const [phone, setPhone] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    const ref = reference.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (ref.length < 6) return setErr('Enter your order number. It starts with DD and is on your receipt.');
    if (phone.replace(/\D/g, '').length < 9) return setErr('Enter the phone number used for the order.');
    setBusy(true);
    try {
      const r = await post<{ reference: string; accessToken: string }>('/api/orders/track', { reference: ref, phone });
      rememberOrder(r.reference, r.accessToken);
      navigate(`/order/${r.reference}?t=${r.accessToken}`);
    } catch (e2) { setErr(errMsg(e2)); setBusy(false); }
  };
  return (
    <form className={compact ? '' : 'card-elev'} onSubmit={submit} noValidate>
      {!compact && <h2 style={{ fontSize: '1.3rem' }}>Find your order</h2>}
      <Field label="Order number" hint="Starts with DD, e.g. DDK7M2Q9XA. It's on your receipt.">
        <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="DD…" autoCapitalize="characters" autoComplete="off" style={{ textTransform: 'uppercase' }} />
      </Field>
      <Field label="Phone number" hint="The number that received the bundle, or the one you gave at checkout">
        <Input inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="e.g. 0551234567" />
      </Field>
      {err && <div style={{ marginBottom: 12 }}><Alert>{err}</Alert></div>}
      <button className="btn btn-yellow btn-block btn-lg" disabled={busy}>{busy ? <Spinner /> : 'Track order'}</button>
    </form>
  );
}

export function TrackPage() {
  usePageTitle('Track Your Order');
  const recent = rememberedOrders();
  return (
    <SiteLayout>
      <div className="container" style={{ maxWidth: 560, padding: '24px 16px 48px' }}>
        <div className="eyebrow">Track order</div>
        <h1 style={{ fontSize: '1.9rem' }}>Where is my bundle?</h1>
        <p className="muted">Enter your order number and phone number to see exactly where your order is: paid, delivering or delivered.</p>
        <TrackForm />
        {recent.length > 0 && (
          <div className="card" style={{ marginTop: 16 }}>
            <h3>Orders on this phone</h3>
            {recent.map((g) => <Link key={g.r} to={`/order/${g.r}?t=${g.t}`} className="list-row"><span className="mono" style={{ fontWeight: 700 }}>{g.r}</span><span className="small muted" style={{ marginLeft: 'auto' }}>{dateOnly(new Date(g.at))}</span></Link>)}
          </div>
        )}
        <p className="small muted" style={{ marginTop: 16 }}>Can't find your order number? <Link to="/support#contact" className="link">Contact support</Link> with the phone number and the time you paid. Have an account? <Link to="/login?next=/account/orders" className="link">Log in</Link> to see all your orders.</p>
      </div>
    </SiteLayout>
  );
}

export function NotificationsPage() {
  usePageTitle('Notification settings');
  return (
    <SiteLayout>
      <div className="container" style={{ maxWidth: 620, padding: '24px 16px 48px' }}>
        <h1 style={{ fontSize: '1.8rem' }}>Notification settings</h1>
        <p className="muted">Choose what Data Deals sends to this phone. Changes apply to this device only.</p>
        <NotifyCard variant="settings" />
        <p className="tiny muted">If you don't see any options here, notifications aren't turned on for this browser.</p>
      </div>
    </SiteLayout>
  );
}
