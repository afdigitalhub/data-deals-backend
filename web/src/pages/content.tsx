import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { get, post } from '../lib/api';
import { useApp } from '../lib/app-state';
import { dateTime } from '../lib/format';
import { Link, useLocation, usePageTitle } from '../lib/router';
import { SiteLayout, WhatsAppLink } from '../components/layout';
import { Alert, Empty, Field, Input, Loading, Select, Spinner, StatusPill, Textarea, errMsg, fieldErr } from '../components/ui';
import { IcAlert } from '../components/icons';

const UPDATED = '28 September 2026';

export function HowItWorksPage() {
  usePageTitle('How It Works');
  return (
    <SiteLayout>
      <div className="container page-head"><div className="eyebrow">How it works</div><h1>From checkout to delivered</h1></div>
      <div className="container prose" style={{ paddingBottom: 40 }}>
        <div className="steps" style={{ marginTop: 12 }}>
          <div className="s"><div><b>Choose the network and number.</b><br /><span className="muted">Select MTN, Telecel or AT and type the number to top up. We suggest the network from the number, but numbers can be moved between networks, so please confirm it.</span></div></div>
          <div className="s"><div><b>Pick a bundle or airtime amount.</b><br /><span className="muted">You see the full price, including any service fee, before you pay.</span></div></div>
          <div className="s"><div><b>Pay on Paystack's secure page.</b><br /><span className="muted">Choose Mobile Money (MTN MoMo, Telecel Cash, AT Money) or card. Paystack processes the payment; we never see your PIN or card number.</span></div></div>
          <div className="s"><div><b>We confirm your payment with Paystack.</b><br /><span className="muted">Your order is only marked paid after our server verifies it directly with Paystack.</span></div></div>
          <div className="s"><div><b>We deliver and you track it live.</b><br /><span className="muted">Your order page shows each step — paid, queued, delivering, delivered — and gives you a receipt.</span></div></div>
        </div>
        <h2>What if something goes wrong?</h2>
        <p>If a delivery fails, your payment is safe. Our team will either retry the delivery or refund you in line with our <Link to="/refund-policy" className="link">refund policy</Link>. If we're unsure whether a top-up arrived, we check with our supplier first — so you're never charged twice or refunded for something you received.</p>
        <div className="row" style={{ marginTop: 20 }}><Link to="/" className="btn btn-dark">Buy now</Link><Link to="/support" className="btn btn-outline">Questions? Visit support</Link></div>
      </div>
    </SiteLayout>
  );
}

const FAQ: [string, ReactNode][] = [
  ['How long does delivery take?', 'Most orders are delivered shortly after payment is confirmed. Your order page updates live, and you can keep the link to check later.'],
  ['Which payment methods can I use?', 'Mobile Money (MTN MoMo, Telecel Cash, AT Money) and Visa/Mastercard cards, processed securely by Paystack.'],
  ['Can I buy for someone else?', 'Yes. Just enter their number at checkout. Logged-in customers can save numbers they use often.'],
  ['I paid but my order still says "Awaiting payment".', 'Stay on the order page for a minute — we check with Paystack automatically. If it still does not update, report it with your order reference and we will verify it.'],
  ['I entered the wrong number. Can you reverse it?', 'Unfortunately telecom top-ups sent to a valid number cannot be reversed. Please double-check the number before paying.'],
  ['My order failed. Will I get my money back?', <>Yes. If we cannot deliver, we retry or refund you. See our <Link to="/refund-policy" className="link">refund policy</Link>.</>],
  ['Do I need an account?', 'No. You can buy as a guest with an email for your receipt. An account lets you see all your orders and save numbers.'],
];

export function SupportPage() {
  usePageTitle('Support & FAQs');
  const { config, user } = useApp();
  const { search } = useLocation();
  const b = config?.business;
  return (
    <SiteLayout>
      <div className="container page-head"><div className="eyebrow">Support</div><h1>How can we help?</h1></div>
      <div className="container" style={{ paddingBottom: 40 }}>
        <div className="grid-2" style={{ alignItems: 'start' }}>
          <div>
            <h2>Frequently asked questions</h2>
            <div className="faq">{FAQ.map(([q, a]) => <details key={q}><summary>{q}</summary><p className="muted">{a}</p></details>)}</div>
            {(b?.whatsappNumber || b?.supportPhone || b?.supportEmail) && (
              <div className="card-soft" style={{ marginTop: 16 }}>
                <b>Other ways to reach us</b>
                <div className="row" style={{ marginTop: 10 }}>
                  <WhatsAppLink />
                  {b?.supportPhone && <a className="btn btn-light" href={`tel:${b.supportPhone.replace(/\s/g, '')}`}>Call {b.supportPhone}</a>}
                  {b?.supportEmail && <a className="btn btn-light" href={`mailto:${b.supportEmail}`}>Email us</a>}
                </div>
              </div>
            )}
            {user && <p className="small" style={{ marginTop: 16 }}>See your requests in <Link to="/account/tickets" className="link">Support tickets</Link>.</p>}
          </div>
          <div id="contact"><SupportForm defaultOrder={search.get('order') || ''} orderToken={search.get('t') || ''} defaultType={search.get('type') || ''} /></div>
        </div>
      </div>
    </SiteLayout>
  );
}

function SupportForm({ defaultOrder, orderToken, defaultType }: { defaultOrder: string; orderToken: string; defaultType: string }) {
  const { user } = useApp();
  const [f, setF] = useState({ name: '', email: '', phone: '', category: defaultType === 'refund' ? 'refund' : defaultOrder ? 'order' : 'general', order_reference: defaultOrder, subject: '', message: '' });
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ reference: string; accessToken: string } | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try {
      const r = await post('/api/support/tickets', {
        name: user ? undefined : f.name || undefined, email: user ? undefined : f.email || undefined, phone: f.phone || undefined, category: f.category,
        subject: f.subject, message: f.message, order_reference: f.order_reference.trim() || undefined, order_token: orderToken || undefined,
      });
      setDone(r.ticket);
    } catch (e2) { setErr(e2); } finally { setBusy(false); }
  };
  if (done) return (
    <div className="card">
      <Alert kind="success">Thanks — we've received your request. Your ticket number is <b className="mono">{done.reference}</b>.</Alert>
      <p className="small muted" style={{ marginTop: 12 }}>Keep this link to read our reply and add more details:</p>
      <Link to={`/ticket/${done.reference}?t=${done.accessToken}`} className="btn btn-dark btn-block">Open my ticket</Link>
    </div>
  );
  const needsOrder = ['order', 'failed_transaction', 'refund'].includes(f.category);
  return (
    <form className="card" onSubmit={submit} noValidate>
      <h2 style={{ fontSize: '1.3rem' }}>Contact support</h2>
      {!user && <div className="grid-2">
        <Field label="Your name" error={fieldErr(err, 'name')}><Input autoComplete="name" value={f.name} onChange={set('name')} /></Field>
        <Field label="Email (for our reply)" error={fieldErr(err, 'email')}><Input type="email" autoComplete="email" value={f.email} onChange={set('email')} /></Field>
      </div>}
      <Field label="What is it about?">
        <Select value={f.category} onChange={set('category')}>
          <option value="general">General question</option><option value="order">An order</option><option value="failed_transaction">Paid but not delivered / failed</option><option value="refund">Refund request</option><option value="account">My account</option>
        </Select>
      </Field>
      {needsOrder && <Field label="Order reference" error={fieldErr(err, 'order_reference')} hint="Starts with DC — it's on your receipt"><Input value={f.order_reference} onChange={set('order_reference')} placeholder="DDXXXXXXXX" style={{ textTransform: 'uppercase' }} /></Field>}
      <Field label="Subject" error={fieldErr(err, 'subject')}><Input value={f.subject} onChange={set('subject')} maxLength={150} /></Field>
      <Field label="Message" error={fieldErr(err, 'message')}><Textarea value={f.message} onChange={set('message')} maxLength={4000} placeholder="Tell us what happened. Include the phone number and time if it's about a payment." /></Field>
      <Field label="Phone (optional)" error={fieldErr(err, 'phone')}><Input inputMode="tel" value={f.phone} onChange={set('phone')} /></Field>
      {err && !Object.keys((err as any).details || {}).length ? <div style={{ marginBottom: 12 }}><Alert>{errMsg(err)}</Alert></div> : null}
      <button className="btn btn-dark btn-block btn-lg" disabled={busy}>{busy ? <Spinner /> : 'Send request'}</button>
    </form>
  );
}

export function TicketPage({ reference }: { reference: string }) {
  usePageTitle(`Ticket ${reference}`);
  const { search } = useLocation();
  const t = search.get('t') || '';
  const [ticket, setTicket] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const q = t ? `?t=${encodeURIComponent(t)}` : '';
  const load = () => get(`/api/support/tickets/${reference}${q}`).then((r) => setTicket(r.ticket)).catch((e) => setError(errMsg(e)));
  useEffect(() => { load(); }, [reference]);
  return (
    <SiteLayout>
      <div className="container" style={{ maxWidth: 680, padding: '24px 16px 48px' }}>
        {error ? <Empty icon={<IcAlert />} title="Ticket not found">{error}</Empty> : !ticket ? <Loading /> : (
          <>
            <div className="row between"><div><div className="tiny muted mono">{ticket.reference}</div><h1 style={{ fontSize: '1.5rem', margin: 0 }}>{ticket.subject}</h1></div><StatusPill status={ticket.status} /></div>
            {ticket.orderReference && <p className="small muted">About order <span className="mono">{ticket.orderReference}</span></p>}
            <div className="stack" style={{ marginTop: 16 }}>
              {ticket.messages.map((m: any, i: number) => (
                <div key={i} className={m.author_type === 'customer' ? 'card' : m.author_type === 'admin' ? 'card-soft' : ''} style={m.author_type === 'system' ? { textAlign: 'center' } : { borderLeft: m.author_type === 'admin' ? '4px solid var(--yellow)' : undefined }}>
                  {m.author_type !== 'system' && <div className="tiny muted" style={{ marginBottom: 4 }}><b>{m.author_type === 'admin' ? 'DataCedi support' : 'You'}</b> · {dateTime(m.created_at)}</div>}
                  <div className={m.author_type === 'system' ? 'tiny muted' : ''} style={{ whiteSpace: 'pre-wrap' }}>{m.body}</div>
                </div>
              ))}
            </div>
            {ticket.status !== 'closed' && (
              <form style={{ marginTop: 16 }} onSubmit={async (e) => { e.preventDefault(); if (msg.trim().length < 2) return; setBusy(true); try { await post(`/api/support/tickets/${reference}/messages${q}`, { message: msg }); setMsg(''); await load(); } catch (e2) { setError(errMsg(e2)); } finally { setBusy(false); } }}>
                <Field label="Add a reply"><Textarea value={msg} onChange={(e) => setMsg(e.target.value)} /></Field>
                <button className="btn btn-dark" disabled={busy}>{busy ? <Spinner /> : 'Send reply'}</button>
              </form>
            )}
          </>
        )}
      </div>
    </SiteLayout>
  );
}

function Legal({ title, children }: { title: string; children: ReactNode }) {
  usePageTitle(title);
  return <SiteLayout><div className="container page-head"><h1>{title}</h1><p className="muted small">Last updated {UPDATED}</p></div><div className="container prose" style={{ paddingBottom: 48 }}>{children}</div></SiteLayout>;
}

function ContactLine() {
  const { config } = useApp();
  const b = config?.business;
  const bits = [b?.supportEmail && `email ${b.supportEmail}`, b?.supportPhone && `call ${b.supportPhone}`, b?.whatsappNumber && `WhatsApp ${b.whatsappNumber}`].filter(Boolean);
  return <>{bits.length ? bits.join(', ') + ', or ' : ''}use our <Link to="/support#contact" className="link">support form</Link></>;
}

export function AboutPage() {
  usePageTitle('About DataCedi');
  const { config } = useApp();
  return (
    <Legal title="About DataCedi">
      <p>DataCedi is a reliable platform for affordable, instant internet data bundles for all networks in Ghana — MTN, Telecel and AT. We help students, workers and businesses stay connected without paying expensive prices. Fast, cheap, and available 24/7.</p>
      <p>Whether you study, work online, run a small business or sell on WhatsApp, DataCedi keeps you online with clear prices, secure Mobile Money payments and honest order tracking.</p>
      {config?.business.showFounders && !!config.business.founders?.length && (
        <>
          <h2>Leadership</h2>
          <div className="founders">
            {config.business.founders.map((f) => (
              <div key={f.name} className="founder">
                <span className="founder-av" aria-hidden="true">{f.name.trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()}</span>
                <div><b>{f.name}</b><div className="small muted">{f.title}, DataCedi</div></div>
              </div>
            ))}
          </div>
        </>
      )}
      <h2>How we work</h2>
      <ul>
        <li>Payments are processed by Paystack. We verify every payment directly with Paystack before delivering.</li>
        <li>Top-ups are delivered through our supplier arrangements or by our team, and each order shows its real status.</li>
        <li>If we can't deliver, we retry or refund you.</li>
      </ul>
      <p>DataCedi is an independent reseller. We are not owned by, or an official partner of, MTN, Telecel or AT unless stated otherwise.</p>
    </Legal>
  );
}

export function ContactPage() {
  usePageTitle('Contact DataCedi');
  const { config } = useApp();
  const b = config?.business;
  return (
    <Legal title="Contact us">
      <p>The fastest way to reach us about an order is the <Link to="/support#contact" className="link">support form</Link>. Include your order reference (it starts with DD).</p>
      {b?.supportEmail && <p><b>Email:</b> <a href={`mailto:${b.supportEmail}`}>{b.supportEmail}</a></p>}
      {b?.supportPhone && <p><b>Phone:</b> <a href={`tel:${b.supportPhone.replace(/\s/g, '')}`}>{b.supportPhone}</a></p>}
      {b?.whatsappNumber && <p><b>WhatsApp:</b> <a href={`https://wa.me/${b.whatsappNumber.replace(/\D/g, '')}`} target="_blank" rel="noopener">Chat with us</a></p>}
      {b?.address && <p><b>Address:</b> {b.address}</p>}
      <Link to="/support#contact" className="btn btn-dark">Open a support request</Link>
    </Legal>
  );
}

export function TermsPage() {
  return (
    <Legal title="Terms of Service">
      <p>These terms apply when you use the DataCedi website and services ("DataCedi", "we", "us"). By placing an order you agree to them.</p>
      <h2>1. What we provide</h2>
      <p>We sell mobile airtime and data bundles for networks in Ghana. Products, prices and availability are shown on the website and may change. The price shown at checkout is the price you pay for that order.</p>
      <h2>2. Your responsibilities</h2>
      <ul>
        <li>Enter the correct recipient number and network. Top-ups delivered to a valid number you entered cannot be reversed.</li>
        <li>Only use payment methods you are authorised to use.</li>
        <li>Do not use DataCedi for fraud, abuse or anything unlawful. We may restrict accounts involved in suspected fraud or chargeback abuse.</li>
      </ul>
      <h2>3. Payments</h2>
      <p>Payments are processed by Paystack. An order is only treated as paid once we have verified the payment with Paystack. We do not store your card details or Mobile Money PIN.</p>
      <h2>4. Delivery</h2>
      <p>We aim to deliver promptly after payment is confirmed. Delivery depends on network and supplier systems, which can occasionally be delayed. Your order page shows the current status.</p>
      <h2>5. Failed orders and refunds</h2>
      <p>If we cannot deliver an order, we will retry or refund it as described in our <Link to="/refund-policy" className="link">Refund Policy</Link>.</p>
      <h2>6. Networks</h2>
      <p>MTN, Telecel and AT are trademarks of their owners. DataCedi is an independent reseller and is not affiliated with them unless we state otherwise. Bundle usage, speeds and expiry are governed by the network's own terms.</p>
      <h2>7. Liability</h2>
      <p>To the extent allowed by law, our liability for any order is limited to the amount you paid for it. Nothing in these terms limits rights you have under Ghanaian consumer law.</p>
      <h2>8. Changes and contact</h2>
      <p>We may update these terms; the date above shows the latest version. Questions? <ContactLine />.</p>
      <p>These terms are governed by the laws of the Republic of Ghana.</p>
    </Legal>
  );
}

export function PrivacyPage() {
  return (
    <Legal title="Privacy Policy">
      <p>This policy explains what information DataCedi collects and how we use it.</p>
      <h2>Information we collect</h2>
      <ul>
        <li><b>Order details:</b> recipient phone number, network, product, amount, and the email/phone you give for receipts.</li>
        <li><b>Account details</b> (if you register): name, email, phone number and a securely hashed password.</li>
        <li><b>Payment information:</b> Paystack processes your payment. We receive the payment reference, status, amount and channel — not your card number or Mobile Money PIN.</li>
        <li><b>Technical data:</b> IP address and device/browser information for security, fraud prevention and rate limiting.</li>
        <li><b>Support messages</b> you send us.</li>
      </ul>
      <h2>How we use it</h2>
      <ul><li>To process, deliver and support your orders.</li><li>To verify payments and prevent fraud.</li><li>To keep records required for accounting and legal obligations.</li><li>To contact you about your orders and support requests.</li></ul>
      <h2>Sharing</h2>
      <p>We share only what is needed with service providers that help us operate: Paystack (payments), our airtime/data suppliers (recipient number and product, to deliver your order), and our hosting and database providers. We do not sell your personal data.</p>
      <h2>Retention and security</h2>
      <p>We keep order and payment records for as long as needed for legal, tax and dispute purposes. Passwords are hashed, connections are encrypted, and access to admin tools is restricted and logged.</p>
      <h2>Your rights</h2>
      <p>You can ask to access or correct your personal data, or to delete your account where the law allows. <ContactLine />.</p>
      <p>We handle personal data in line with Ghana's Data Protection Act, 2012 (Act 843).</p>
    </Legal>
  );
}

export function RefundPolicyPage() {
  const { config } = useApp();
  const days = config?.refundWindowDays ?? 7;
  return (
    <Legal title="Refund Policy">
      <h2>When we refund</h2>
      <ul>
        <li>If your order could not be delivered and we are unable to deliver it on retry, we refund the full amount you paid.</li>
        <li>If you were charged twice for the same order, we refund the duplicate payment.</li>
      </ul>
      <h2>When we can't refund</h2>
      <ul>
        <li>Top-ups successfully delivered to the number you entered — including a wrong but valid number — cannot be refunded, because they cannot be reversed.</li>
        <li>Bundles that have been delivered and are subject to the network's own usage or expiry rules.</li>
      </ul>
      <h2>How it works</h2>
      <p>If we are not sure whether a top-up was delivered, we first confirm with our supplier. We only refund once we have confirmed it was not delivered — this protects you from being charged twice and us from refunding delivered orders.</p>
      <p>Refunds go back through Paystack to your original payment method. Processing times depend on your bank or Mobile Money provider and can take several working days.</p>
      <h2>Requesting a refund</h2>
      <p>Please contact us within {days} days of the order using the <Link to="/support?type=refund#contact" className="link">support form</Link> with your order reference.</p>
    </Legal>
  );
}

export function NotFoundPage() {
  usePageTitle('Page not found');
  return <SiteLayout><div className="container section"><Empty icon={<IcAlert />} title="We couldn't find that page">The link may be old or mistyped.</Empty><div className="row" style={{ justifyContent: 'center' }}><Link to="/" className="btn btn-dark">Go home</Link></div></div></SiteLayout>;
}
