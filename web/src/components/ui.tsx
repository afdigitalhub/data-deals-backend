import { useEffect, useState, type ReactNode, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { Link } from '../lib/router';
import { NETWORK_META } from '../lib/format';
import { Bolt, IcAlert, IcCheckCircle, IcX } from './icons';
import { ApiError } from '../lib/api';

export function Logo({ to = '/', light = false }: { to?: string; light?: boolean }) {
  return (
    <Link to={to} className="logo" aria-label="Data Deals home" style={light ? { color: '#fff' } : undefined}>
      <Bolt style={{ color: light ? '#FFD400' : 'var(--ink)' }} />
      <span>Data <span className="deals">Deals</span></span>
    </Link>
  );
}

export function NetworkBadge({ code, size }: { code: string; size?: 'sm' | 'lg' }) {
  const m = NETWORK_META[code] || { color: '#ddd', ink: '#111', short: code };
  return <span className={`net-badge ${size || ''}`} style={{ background: m.color, color: m.ink }} aria-hidden="true">{m.short}</span>;
}

export function Field({ label, hint, error, children }: { label: string; hint?: ReactNode; error?: string | null; children: ReactNode }) {
  return (
    <label className="field">
      <span className="label">{label}</span>
      {children}
      {error ? <span className="err" role="alert">{error}</span> : hint ? <span className="hint">{hint}</span> : null}
    </label>
  );
}

export function Input({ invalid, ...p }: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return <input className={`input ${invalid ? 'invalid' : ''}`} aria-invalid={invalid || undefined} {...p} />;
}
export function Select(p: SelectHTMLAttributes<HTMLSelectElement>) { return <select className="select" {...p} />; }
export function Textarea(p: TextareaHTMLAttributes<HTMLTextAreaElement>) { return <textarea className="textarea" {...p} />; }

export function Alert({ kind = 'error', children }: { kind?: 'error' | 'success' | 'warn' | 'info' | 'dark'; children: ReactNode }) {
  if (!children) return null;
  return (
    <div className={`alert alert-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      {kind === 'success' ? <IcCheckCircle width={20} height={20} style={{ flexShrink: 0 }} /> : kind === 'error' || kind === 'warn' ? <IcAlert width={20} height={20} style={{ flexShrink: 0 }} /> : null}
      <div>{children}</div>
    </div>
  );
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return <span className="spinner" role="status" aria-label={label} />;
}

export function Loading({ text = 'Loading…' }: { text?: string }) {
  return <div className="empty"><Spinner /><div className="small" style={{ marginTop: 10 }}>{text}</div></div>;
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      {icon && <div className="ic">{icon}</div>}
      <div style={{ fontWeight: 800, color: 'var(--ink)', marginBottom: 4 }}>{title}</div>
      {children && <div className="small">{children}</div>}
    </div>
  );
}

const PILL: Record<string, string> = {
  successful: 'success', paid: 'info', queued: 'warn', processing: 'info', pending_payment: 'neutral', payment_failed: 'danger', expired: 'neutral',
  failed: 'danger', needs_review: 'warn', refund_pending: 'warn', refunded: 'neutral',
  success: 'success', initialized: 'neutral', abandoned: 'neutral', reversed: 'danger',
  open: 'warn', awaiting_customer: 'info', resolved: 'success', closed: 'neutral',
  requested: 'warn', approved: 'info', processed: 'success', rejected: 'neutral',
  live: 'success', draft: 'neutral', paused: 'warn', active: 'success', restricted: 'danger', suspended: 'danger',
  sending: 'info', pending: 'info', unknown: 'warn', connected: 'success', not_connected: 'neutral', check_failed: 'danger', untested: 'warn', manual: 'info',
};
const LABEL: Record<string, string> = {
  pending_payment: 'Awaiting payment', payment_failed: 'Payment failed', needs_review: 'Needs review', refund_pending: 'Refund pending', awaiting_customer: 'Awaiting customer',
  successful: 'Delivered', not_connected: 'Not connected', check_failed: 'Check failed', initialized: 'Started', queued: 'Queued',
};
export function StatusPill({ status, label }: { status: string; label?: string }) {
  return <span className={`pill pill-${PILL[status] || 'neutral'}`}>{label || LABEL[status] || status.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())}</span>;
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', k);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', k); document.body.style.overflow = prev; };
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="row between" style={{ marginBottom: 10 }}>
          <h3 style={{ margin: 0 }}>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><IcX /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function errMsg(e: unknown) { return e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Something went wrong'; }
export function fieldErr(e: unknown, key: string) { return e instanceof ApiError ? e.details?.[key] ?? null : null; }

/** Small hook for async actions with loading and error state. */
export function useAction<A extends unknown[], R>(fn: (...a: A) => Promise<R>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const run = async (...a: A): Promise<R | undefined> => {
    setBusy(true); setError(null);
    try { return await fn(...a); } catch (e) { setError(e); return undefined; } finally { setBusy(false); }
  };
  return { run, busy, error, setError };
}

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className="btn btn-light btn-sm" onClick={async () => { try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1800); } catch { /* ignore */ } }}>
      {done ? 'Copied' : label}
    </button>
  );
}
