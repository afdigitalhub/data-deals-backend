import { useEffect, useRef, useState } from 'react';
import { ApiError, get, post, safeStorage } from '../lib/api';
import { rememberOrder, useApp } from '../lib/app-state';
import { validityText, NETWORK_META, dataSize, dateTime, ghs, normalizePhone, randomKey } from '../lib/format';
import { Link, navigate, useLocation, usePageTitle } from '../lib/router';
import { SiteLayout, ChannelCard } from '../components/layout';
import { NotifyCard } from '../components/NotifyCard';
import { Alert, Empty, Field, Input, Loading, NetworkBadge, Spinner, StatusPill, errMsg, fieldErr } from '../components/ui';
import { IcAlert, IcBack, IcCard, IcCheck, IcClock, IcLock, IcPhone, IcRefund } from '../components/icons';

interface Quote { productId: number; kind: 'data' | 'airtime'; network: string; name: string; faceValueMinor: number | null; priceMinor: number; feeMinor: number; totalMinor: number; currency: string }

export function CheckoutPage() {
  usePageTitle('Checkout');
  const { search } = useLocation();
  const { user, userLoaded, config, products, loadProducts } = useApp();
  const productId = Number(search.get('product'));
  const phone = normalizePhone(search.get('phone') || '');
  const network = search.get('network') || '';
  const amount = search.get('amount') ? Number(search.get('amount')) : undefined;

  const [quote, setQuote] = useState<Quote | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [method, setMethod] = useState<'mobile_money' | 'card'>('mobile_money');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const submitted = useRef(false);
  // First-time numbers can be held by the supplier for a one-time check, so we say so before payment.
  const [firstTime, setFirstTime] = useState(false);
  useEffect(() => {
    if (!phone) return;
    let off = false;
    post<{ firstTime: boolean }>('/api/checkout/recipient-check', { phone }).then((r) => { if (!off) setFirstTime(!!r.firstTime); }).catch(() => {});
    return () => { off = true; };
  }, [phone]);

  // One idempotency key per checkout: refreshing or double-tapping reuses it, so the customer can never create two orders.
  const storageKey = `dd_ck:${productId}:${phone}:${amount || ''}:${user?.id || 'guest'}`;
  const [idemKey] = useState(() => {
    try { const k = sessionStorage.getItem(storageKey); if (k) return k; const n = randomKey(); sessionStorage.setItem(storageKey, n); return n; } catch { return randomKey(); }
  });

  useEffect(() => { loadProducts().catch(() => {}); }, [loadProducts]);
  useEffect(() => {
    if (!productId || !phone) { setLoadError('Some purchase details are missing. Please start again.'); return; }
    post<{ quote: Quote }>('/api/checkout/quote', { product_id: productId, amount_minor: amount })
      .then((r) => setQuote(r.quote)).catch((e) => setLoadError(errMsg(e)));
  }, [productId, phone, amount]);

  const product = products?.find((p) => p.id === productId);
  const pay = async () => {
    if (submitted.current) return;
    setError(null);
    if (userLoaded && !user && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError(new ApiError(400, 'Enter your email address so we can send your receipt, then tap Pay again.', 'validation', { email: 'Enter a valid email, e.g. kofi@gmail.com' }));
      const el = document.getElementById('co-email');
      if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); (el as HTMLInputElement).focus({ preventScroll: true }); }
      return;
    }
    submitted.current = true; setBusy(true);
    try {
      const r = await post<{ reference: string; accessToken: string; authorizationUrl: string | null; status: string }>('/api/checkout/orders', {
        idempotency_key: idemKey, product_id: productId, network_code: network, recipient_phone: phone, amount_minor: amount,
        email: user ? undefined : email.trim() || undefined, payment_method: method, referral_code: safeStorage().get('dd_ref') || undefined,
      });
      rememberOrder(r.reference, r.accessToken);
      if (r.authorizationUrl) { location.href = r.authorizationUrl; return; } // Paystack's secure checkout
      navigate(`/order/${r.reference}?t=${r.accessToken}`);
    } catch (e) {
      setError(e); submitted.current = false; setBusy(false);
    }
  };

  if (loadError) return <SiteLayout><div className="container section"><Empty icon={<IcAlert />} title="We can't start this checkout">{loadError}</Empty><div className="row" style={{ justifyContent: 'center' }}><Link to="/" className="btn btn-dark">Back to home</Link></div></div></SiteLayout>;

  const net = NETWORK_META[network];
  return (
    <SiteLayout>
      <div className="container" style={{ maxWidth: 620, padding: '20px 16px 48px' }}>
        <button className="btn btn-ghost btn-sm" onClick={() => history.back()} style={{ marginBottom: 8, paddingLeft: 4 }}><IcBack width={18} height={18} />Back</button>
        <h1 style={{ fontSize: '1.8rem' }}>Checkout</h1>
        {!quote ? <Loading text="Getting the latest price…" /> : (
          <div className="stack">
            <div className="card row" style={{ gap: 14, flexWrap: 'nowrap' }}>
              <NetworkBadge code={network} size="lg" />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 800, fontSize: '1.1rem' }}>{quote.kind === 'data' ? `${product?.dataMb ? dataSize(product.dataMb) : quote.name} Data Bundle` : `${ghs(quote.faceValueMinor)} Airtime`}</div>
                <div className="muted small">{net?.name}{quote.kind === 'data' && product?.validity ? ` · ${validityText(product.validity)}` : ''}</div>
                <div style={{ fontWeight: 800, marginTop: 2 }}>{ghs(quote.priceMinor)}</div>
              </div>
            </div>

            <div className="card">
              <div className="row between"><span style={{ fontWeight: 800 }}>Recipient number</span><button className="link-amber" onClick={() => history.back()}>Change</button></div>
              <div style={{ fontSize: '1.15rem', fontWeight: 700, marginTop: 6 }} className="row"><IcPhone width={18} height={18} />{phone}</div>
              <div className="tiny muted" style={{ marginTop: 4 }}>Please double-check. Top-ups sent to a wrong number cannot be reversed.</div>
            </div>

            {userLoaded && !user && (
              <div className="card">
                <Field label="Email for your receipt" error={fieldErr(error, 'email')} hint={<>Already have an account? <Link to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} className="link">Log in</Link></>}>
                  <Input id="co-email" type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
                </Field>
              </div>
            )}

            <div className="card">
              <div style={{ fontWeight: 800, marginBottom: 10 }}>Payment method</div>
              <div className="stack" role="radiogroup" aria-label="Payment method">
                {([
                  ['mobile_money', 'Mobile Money', 'MTN MoMo, Telecel Cash or AT Money', <IcPhone key="m" />],
                  ['card', 'Card', 'Visa or Mastercard', <IcCard key="c" />],
                ] as const).map(([val, title, sub, icon]) => (
                  <label key={val} className="row" style={{ border: `1.5px solid ${method === val ? 'var(--ink)' : 'var(--line)'}`, borderRadius: 14, padding: '12px 14px', cursor: 'pointer', flexWrap: 'nowrap', background: method === val ? 'var(--yellow-soft)' : 'var(--surface)' }}>
                    <span style={{ width: 38, height: 38, borderRadius: 10, background: 'var(--surface)', border: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{icon}</span>
                    <span style={{ flex: 1 }}><b>{title}</b><br /><span className="small muted">{sub}</span></span>
                    <input type="radio" name="method" checked={method === val} onChange={() => setMethod(val)} style={{ width: 20, height: 20, accentColor: 'var(--ink)' }} />
                  </label>
                ))}
              </div>
              <p className="tiny muted" style={{ margin: '10px 0 0' }}>You'll confirm the payment on Paystack's secure page. Data Deals never sees your Mobile Money PIN or card details.</p>
            </div>


            <div className="card">
              <div className="price-line"><span>{quote.kind === 'airtime' ? 'Airtime value' : 'Bundle price'}</span><span>{ghs(quote.priceMinor)}</span></div>
              <div className="price-line"><span>Service fee</span><span>{quote.feeMinor ? ghs(quote.feeMinor) : 'None'}</span></div>
              <div className="price-line total"><span>Total to pay</span><span>{ghs(quote.totalMinor)}</span></div>
            </div>

            {config?.maintenance.enabled && <Alert kind="warn">{config.maintenance.message}</Alert>}
            {config?.notice?.enabled && !config.maintenance.enabled && <Alert kind="warn">{config.notice.message}</Alert>}
            {firstTime && <Alert kind="info">First time for {phone}. It may go through a one-time verification, so delivery can take longer than usual.</Alert>}
            {config && !config.payments.enabled && <Alert kind="info">Online payments are being switched on. You'll be able to pay very soon.</Alert>}
            {config?.payments.enabled && config.payments.testMode && <Alert kind="info">Test mode: no real money will be taken and nothing will be delivered.</Alert>}
            {error ? <Alert>{errMsg(error)}</Alert> : null}

            <button className="btn btn-yellow btn-block btn-lg" onClick={pay} disabled={busy || !config?.payments.enabled || config?.maintenance.enabled}>
              {busy ? <><Spinner /> Opening secure payment…</> : `Pay ${ghs(quote.totalMinor)}`}
            </button>
            <div className="row tiny muted" style={{ justifyContent: 'center' }}><IcLock width={14} height={14} />Secured by Paystack</div>
            <p className="tiny muted" style={{ textAlign: 'center' }}>By paying you agree to our <Link to="/terms" className="link">Terms</Link> and <Link to="/refund-policy" className="link">Refund policy</Link>.</p>
          </div>
        )}
      </div>
    </SiteLayout>
  );
}

// ---------- Order status & receipt ----------
interface Order {
  reference: string; status: string; statusLabel: string; kind: string; network: string; product: any; recipientPhone: string; faceValueMinor: number | null;
  priceMinor: number; feeMinor: number; totalMinor: number; currency: string; isTest: boolean; createdAt: string; paidAt: string | null; deliveredAt: string | null;
  paymentChannel: string | null; contactEmail: string; timeline: { status: string; label: string; at: string }[]; refund: { status: string; amountMinor: number } | null;
}
const LIVE = ['pending_payment', 'paid', 'queued', 'processing'];

export function OrderPage({ reference }: { reference: string }) {
  usePageTitle(`Order ${reference}`);
  const { search } = useLocation();
  const token = search.get('t') || '';
  const justPaid = search.get('paid') === '1';
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const started = useRef(Date.now());

  useEffect(() => {
    let timer: number | undefined;
    let cancelled = false;
    const load = async () => {
      try {
        const r = await get<{ order: Order }>(`/api/orders/${encodeURIComponent(reference)}${token ? `?t=${encodeURIComponent(token)}` : ''}`);
        if (cancelled) return;
        setOrder(r.order); setError(null);
        if (token) rememberOrder(reference, token);
        const elapsed = Date.now() - started.current;
        const keepPolling = LIVE.includes(r.order.status) && (r.order.status !== 'pending_payment' || (justPaid && elapsed < 15 * 60_000));
        if (keepPolling) timer = window.setTimeout(load, elapsed < 60_000 ? 3000 : 8000);
      } catch (e) {
        if (!cancelled) { setError(errMsg(e)); timer = window.setTimeout(load, 10000); }
      }
    };
    load();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [reference, token, justPaid]);

  const payAgain = async () => {
    setRetrying(true);
    try {
      const r = await post<{ authorizationUrl: string | null }>(`/api/orders/${reference}/pay${token ? `?t=${encodeURIComponent(token)}` : ''}`, {});
      if (r.authorizationUrl) location.href = r.authorizationUrl; else location.reload();
    } catch (e) { setError(errMsg(e)); setRetrying(false); }
  };

  if (!order) return <SiteLayout><div className="container section">{error ? <Empty icon={<IcAlert />} title="Order not found">{error}</Empty> : <Loading text="Loading your order…" />}</div></SiteLayout>;

  const s = order.status;
  const view = statusView(s, justPaid);
  const supportLink = `/support?order=${order.reference}${token ? `&t=${token}` : ''}#contact`;
  return (
    <SiteLayout>
      <div className="container" style={{ maxWidth: 640, padding: '20px 16px 48px' }}>
        <div className="card-elev status-hero">
          <div className={`status-icon ${view.tone}`}>{view.icon}</div>
          <h1 style={{ fontSize: '1.6rem', marginBottom: 6 }}>{view.title}</h1>
          <p className="muted" style={{ maxWidth: '42ch', margin: '0 auto 12px' }}>{view.body}</p>
          <div className="row" style={{ justifyContent: 'center' }}><StatusPill status={s} label={order.statusLabel} />{order.isTest && <span className="tag-test">TEST ORDER</span>}</div>
          {LIVE.includes(s) && s !== 'pending_payment' && <div className="row tiny muted" style={{ justifyContent: 'center', marginTop: 12 }}><Spinner /> This page updates automatically</div>}
          {(s === 'pending_payment' || s === 'payment_failed') && (
            <div className="stack" style={{ marginTop: 16 }}>
              {s === 'pending_payment' && justPaid && <div className="row tiny muted" style={{ justifyContent: 'center' }}><Spinner /> Checking with Paystack…</div>}
              <button className="btn btn-yellow btn-lg" onClick={payAgain} disabled={retrying}>{retrying ? <Spinner /> : s === 'payment_failed' ? 'Try payment again' : justPaid ? "I haven't paid yet — pay now" : 'Pay now'}</button>
            </div>
          )}
        </div>
        {error && <div style={{ marginTop: 12 }}><Alert kind="warn">{error}</Alert></div>}
        {['paid', 'queued', 'processing', 'needs_review'].includes(s) && <div style={{ marginTop: 16 }}><NotifyCard variant="order" orderReference={order.reference} orderToken={token || undefined} /></div>}
        {s === 'successful' && <div style={{ marginTop: 16 }}><NotifyCard variant="dashboard" /></div>}
        {s !== 'pending_payment' && <div style={{ marginTop: 16 }}><ChannelCard waiting={['paid', 'queued', 'processing', 'needs_review'].includes(s)} /></div>}

        <div className="card receipt" style={{ marginTop: 16 }} id="receipt">
          <div className="row between" style={{ marginBottom: 12 }}><h2 style={{ fontSize: '1.15rem', margin: 0 }}>Receipt</h2><button className="btn btn-light btn-sm" onClick={() => window.print()}>Print / save</button></div>
          <dl>
            <dt>Order reference</dt><dd className="mono">{order.reference}</dd>
            <dt>Date</dt><dd>{dateTime(order.createdAt)}</dd>
            <dt>Network</dt><dd>{NETWORK_META[order.network]?.name}</dd>
            <dt>Product</dt><dd>{order.kind === 'data' ? `${order.product?.data_mb ? dataSize(order.product.data_mb) : order.product?.name} data${order.product?.validity_label ? ` · ${order.product.validity_label}` : ''}` : `${ghs(order.faceValueMinor)} airtime`}</dd>
            <dt>Recipient</dt><dd>{order.recipientPhone}</dd>
            <dt>Price</dt><dd>{ghs(order.priceMinor)}</dd>
            <dt>Service fee</dt><dd>{order.feeMinor ? ghs(order.feeMinor) : 'None'}</dd>
            <dt><b>Total</b></dt><dd><b>{ghs(order.totalMinor)}</b></dd>
            {order.paidAt && <><dt>Paid</dt><dd>{dateTime(order.paidAt)}{order.paymentChannel ? ` · ${order.paymentChannel === 'mobile_money' ? 'Mobile Money' : order.paymentChannel === 'card' ? 'Card' : order.paymentChannel}` : ''}</dd></>}
            {order.deliveredAt && <><dt>Delivered</dt><dd>{dateTime(order.deliveredAt)}</dd></>}
            {order.refund && <><dt>Refund</dt><dd>{ghs(order.refund.amountMinor)} · <StatusPill status={order.refund.status} /></dd></>}
          </dl>
        </div>

        {order.timeline.length > 0 && (
          <div className="card" style={{ marginTop: 16 }}>
            <h2 style={{ fontSize: '1.15rem' }}>Progress</h2>
            <ul className="timeline">{order.timeline.map((t, i) => <li key={i}><div><b>{t.label}</b><div className="tiny muted">{dateTime(t.at)}</div></div></li>)}</ul>
          </div>
        )}

        <div className="card-soft" style={{ marginTop: 16 }}>
          <b>Need help with this order?</b>
          <p className="small muted" style={{ margin: '4px 0 12px' }}>Quote your order number <span className="mono">{order.reference}</span> and we'll look into it. You can also check this order any time at <Link to="/track" className="link">Track order</Link> with that number and your phone number.</p>
          <div className="row"><Link to={supportLink} className="btn btn-dark btn-sm">Report a problem</Link>{s === 'failed' && <Link to={`/support?order=${order.reference}${token ? `&t=${token}` : ''}&type=refund#contact`} className="btn btn-light btn-sm"><IcRefund width={16} height={16} />Request refund</Link>}</div>
        </div>
      </div>
    </SiteLayout>
  );
}

function statusView(s: string, justPaid: boolean) {
  const ok = { tone: 'ok', icon: <IcCheck /> };
  const wait = { tone: 'wait', icon: <IcClock /> };
  const bad = { tone: 'bad', icon: <IcAlert /> };
  switch (s) {
    case 'successful': return { ...ok, title: 'Delivered!', body: 'The top-up has been delivered to the recipient. Thank you for using Data Deals.' };
    case 'pending_payment': return justPaid ? { ...wait, title: 'Confirming your payment', body: 'This usually takes a few seconds. If you approved the Mobile Money prompt, please wait on this page.' } : { ...wait, title: 'Waiting for payment', body: 'Your order is saved. Complete the payment to continue.' };
    case 'payment_failed': return { ...bad, title: 'Payment not completed', body: 'No money was taken for this attempt. You can try again below.' };
    case 'expired': return { ...bad, title: 'Order expired', body: 'This order was not paid in time. Please start a new purchase.' };
    case 'paid': return { ...wait, title: 'Payment received', body: 'We have confirmed your payment and are preparing delivery.' };
    case 'queued': return { ...wait, title: 'Payment received — in the delivery queue', body: 'Your order is paid and waiting to be delivered by our team. You can close this page; your receipt link stays valid.' };
    case 'processing': return { ...wait, title: 'Delivering now', body: 'We have sent your top-up for delivery and are waiting for confirmation.' };
    case 'needs_review': return { ...wait, title: 'We are checking this order', body: 'Your payment is safe. We are confirming the delivery with our supplier before doing anything else, so you are never charged twice.' };
    case 'failed': return { ...bad, title: "We couldn't deliver this order", body: 'Your payment is safe. Our team will retry the delivery or refund you. You can also request a refund below.' };
    case 'refund_pending': return { ...wait, title: 'Refund in progress', body: 'We have started your refund with Paystack. It can take a few working days to reach you.' };
    case 'refunded': return { ...ok, title: 'Refunded', body: 'Your money has been refunded.' };
    default: return { ...wait, title: 'Order status', body: '' };
  }
}
