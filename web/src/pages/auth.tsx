import { useEffect, useState, type FormEvent } from 'react';
import { get, post } from '../lib/api';
import { useApp, type User } from '../lib/app-state';
import { Link, navigate, useLocation, usePageTitle } from '../lib/router';
import { Header } from '../components/layout';
import { Alert, Field, Input, Loading, Logo, Spinner, errMsg, fieldErr } from '../components/ui';

function safeNext(n: string | null, fallback: string) {
  return n && n.startsWith('/') && !n.startsWith('//') ? n : fallback;
}

function AuthShell({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <>
      <Header />
      <div className="auth-wrap">
        <div className="auth-card card-elev">
          <h1 style={{ fontSize: '1.6rem', marginBottom: 4 }}>{title}</h1>
          {sub && <p className="muted small">{sub}</p>}
          {children}
        </div>
      </div>
    </>
  );
}

export function LoginPage() {
  usePageTitle('Log in');
  const { search } = useLocation();
  const { setUser } = useApp();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try {
      const r = await post<{ user: User }>('/api/auth/login', { email, password });
      setUser(r.user);
      navigate(safeNext(search.get('next'), r.user.role === 'customer' ? '/account' : '/admin'), { replace: true });
    } catch (e2) { setErr(e2); } finally { setBusy(false); }
  };
  return (
    <AuthShell title="Welcome back" sub="Log in to track orders and buy faster.">
      <form onSubmit={submit} noValidate>
        <Field label="Email" error={fieldErr(err, 'email')}><Input type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
        <Field label="Password"><Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>
        {err ? <div style={{ marginBottom: 12 }}><Alert>{errMsg(err)}</Alert></div> : null}
        <button className="btn btn-dark btn-block btn-lg" disabled={busy}>{busy ? <Spinner /> : 'Log in'}</button>
      </form>
      <div className="row between small" style={{ marginTop: 16 }}>
        <Link to="/forgot-password" className="link">Forgot password?</Link>
        <span>New here? <Link to={`/register${search.get('next') ? `?next=${encodeURIComponent(search.get('next')!)}` : ''}`} className="link">Create account</Link></span>
      </div>
    </AuthShell>
  );
}

export function RegisterPage() {
  usePageTitle('Create an account');
  const { search } = useLocation();
  const { setUser } = useApp();
  const [f, setF] = useState({ full_name: '', email: '', phone: '', password: '' });
  const [agree, setAgree] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    if (!agree) { setErr(new Error('Please accept the Terms and Privacy Policy')); return; }
    setBusy(true);
    try {
      const r = await post<{ user: User }>('/api/auth/register', f);
      setUser(r.user);
      navigate(safeNext(search.get('next'), '/account'), { replace: true });
    } catch (e2) { setErr(e2); } finally { setBusy(false); }
  };
  return (
    <AuthShell title="Create your account" sub="Track every order, save numbers and check out faster.">
      <form onSubmit={submit} noValidate>
        <Field label="Full name" error={fieldErr(err, 'full_name')}><Input autoComplete="name" value={f.full_name} onChange={set('full_name')} /></Field>
        <Field label="Email" error={fieldErr(err, 'email')}><Input type="email" autoComplete="email" inputMode="email" value={f.email} onChange={set('email')} /></Field>
        <Field label="Phone number" error={fieldErr(err, 'phone')}><Input inputMode="tel" autoComplete="tel" placeholder="0241234567" value={f.phone} onChange={set('phone')} /></Field>
        <Field label="Password" error={fieldErr(err, 'password')} hint="At least 8 characters, with letters and a number"><Input type="password" autoComplete="new-password" value={f.password} onChange={set('password')} /></Field>
        <label className="check" style={{ marginBottom: 14 }}><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} /><span>I agree to the <Link to="/terms" className="link" target="_blank">Terms</Link> and <Link to="/privacy" className="link" target="_blank">Privacy Policy</Link>.</span></label>
        {err && !fieldErr(err, 'email') && !fieldErr(err, 'password') && !fieldErr(err, 'phone') && !fieldErr(err, 'full_name') ? <div style={{ marginBottom: 12 }}><Alert>{errMsg(err)}</Alert></div> : null}
        <button className="btn btn-dark btn-block btn-lg" disabled={busy}>{busy ? <Spinner /> : 'Create account'}</button>
      </form>
      <p className="small" style={{ marginTop: 16, textAlign: 'center' }}>Already have an account? <Link to="/login" className="link">Log in</Link></p>
    </AuthShell>
  );
}

export function ForgotPage() {
  usePageTitle('Reset password');
  const { config } = useApp();
  const [email, setEmail] = useState('');
  const [done, setDone] = useState<null | { emailAvailable: boolean }>(null);
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try { setDone(await post('/api/auth/forgot', { email })); } catch (e2) { setErr(e2); } finally { setBusy(false); }
  };
  const contact = config?.business.whatsappNumber || config?.business.supportPhone || config?.business.supportEmail;
  return (
    <AuthShell title="Forgot your password?" sub="Enter your account email and we'll send you a reset link.">
      {done ? (
        done.emailAvailable ? <Alert kind="success">If an account exists for that email, a reset link is on its way. It expires in 1 hour.</Alert>
          : <Alert kind="info">Email reset links are not switched on yet. Please <Link to="/support#contact" className="link">contact support</Link>{contact ? ` (${contact})` : ''} and our team will send you a secure reset link.</Alert>
      ) : (
        <form onSubmit={submit} noValidate>
          <Field label="Email" error={fieldErr(err, 'email')}><Input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          {err && !fieldErr(err, 'email') ? <div style={{ marginBottom: 12 }}><Alert>{errMsg(err)}</Alert></div> : null}
          <button className="btn btn-dark btn-block btn-lg" disabled={busy}>{busy ? <Spinner /> : 'Send reset link'}</button>
        </form>
      )}
      <p className="small" style={{ marginTop: 16, textAlign: 'center' }}><Link to="/login" className="link">Back to login</Link></p>
    </AuthShell>
  );
}

export function ResetPage() {
  usePageTitle('Choose a new password');
  const { search } = useLocation();
  const [pw, setPw] = useState('');
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try { await post('/api/auth/reset', { token: search.get('token') || '', password: pw }); setDone(true); } catch (e2) { setErr(e2); } finally { setBusy(false); }
  };
  return (
    <AuthShell title="Choose a new password">
      {done ? <><Alert kind="success">Your password was changed. You've been signed out of other devices.</Alert><Link to="/login" className="btn btn-dark btn-block" style={{ marginTop: 14 }}>Log in</Link></> : (
        <form onSubmit={submit} noValidate>
          <Field label="New password" error={fieldErr(err, 'password')} hint="At least 8 characters, with letters and a number"><Input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
          {err && !fieldErr(err, 'password') ? <div style={{ marginBottom: 12 }}><Alert>{errMsg(err)}</Alert></div> : null}
          <button className="btn btn-dark btn-block btn-lg" disabled={busy}>{busy ? <Spinner /> : 'Save new password'}</button>
        </form>
      )}
    </AuthShell>
  );
}

export function InviteAcceptPage({ token }: { token: string }) {
  usePageTitle('Set up your admin account');
  const { setUser } = useApp();
  const [invite, setInvite] = useState<{ role: string; label: string } | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [f, setF] = useState({ full_name: '', email: '', phone: '', password: '' });
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { get(`/api/auth/invite/${encodeURIComponent(token)}`).then((r) => setInvite(r.invite)).catch((e) => setLoadErr(errMsg(e))); }, [token]);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try { const r = await post<{ user: User }>(`/api/auth/invite/${encodeURIComponent(token)}`, f); setUser(r.user); navigate('/admin', { replace: true }); } catch (e2) { setErr(e2); } finally { setBusy(false); }
  };
  return (
    <div className="auth-wrap" style={{ minHeight: '100vh', background: 'var(--yellow)' }}>
      <div className="auth-card card-elev">
        <div style={{ marginBottom: 16 }}><Logo /></div>
        {loadErr ? <Alert>{loadErr}</Alert> : !invite ? <Loading /> : (
          <>
            <h1 style={{ fontSize: '1.5rem' }}>Set up your {invite.role} account</h1>
            <p className="muted small">Invite for <b>{invite.label}</b>. Choose your own password — nobody else will know it. This link works once.</p>
            <form onSubmit={submit} noValidate>
              <Field label="Full name" error={fieldErr(err, 'full_name')}><Input autoComplete="name" value={f.full_name} onChange={set('full_name')} /></Field>
              <Field label="Email" error={fieldErr(err, 'email')}><Input type="email" autoComplete="email" value={f.email} onChange={set('email')} /></Field>
              <Field label="Phone" error={fieldErr(err, 'phone')}><Input inputMode="tel" value={f.phone} onChange={set('phone')} /></Field>
              <Field label="Password" error={fieldErr(err, 'password')} hint="Use a strong password you don't use anywhere else"><Input type="password" autoComplete="new-password" value={f.password} onChange={set('password')} /></Field>
              {err && !Object.keys((err as any).details || {}).length ? <div style={{ marginBottom: 12 }}><Alert>{errMsg(err)}</Alert></div> : null}
              <button className="btn btn-dark btn-block btn-lg" disabled={busy}>{busy ? <Spinner /> : 'Create admin account'}</button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
