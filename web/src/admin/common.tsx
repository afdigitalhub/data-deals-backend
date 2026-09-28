import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { get } from '../lib/api';
import { ghs } from '../lib/format';
import { errMsg } from '../components/ui';

export function useLoad<T = any>(url: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);
  const reload = useCallback(async () => {
    if (!url) return;
    const n = ++seq.current;
    setLoading(true);
    try { const d = await get<T>(url); if (n === seq.current) { setData(d); setError(null); } } catch (e) { if (n === seq.current) setError(errMsg(e)); } finally { if (n === seq.current) setLoading(false); }
  }, [url]);
  useEffect(() => { reload(); }, [reload, ...deps]); // eslint-disable-line react-hooks/exhaustive-deps
  return { data, error, loading, reload, setData };
}

export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  if (total <= pageSize) return null;
  const pages = Math.ceil(total / pageSize);
  return (
    <div className="row between" style={{ marginTop: 12 }}>
      <span className="small muted">{total} total · page {page} of {pages}</span>
      <div className="row"><button className="btn btn-light btn-sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button><button className="btn btn-light btn-sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</button></div>
    </div>
  );
}

export function Panel({ title, action, children }: { title?: ReactNode; action?: ReactNode; children: ReactNode }) {
  return <div className="panel">{(title || action) && <div className="panel-head"><h2>{title}</h2>{action}</div>}{children}</div>;
}

/** Lightweight SVG area chart (no chart library, keeps the dashboard fast on phones). */
export function AreaChart({ points, height = 200 }: { points: { label: string; value: number }[]; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  if (!points.length) return <div className="empty small">No sales in this period yet.</div>;
  const W = 640; const H = height; const pad = { l: 44, r: 10, t: 12, b: 26 };
  const max = Math.max(...points.map((p) => p.value), 1);
  const niceMax = (() => { const e = Math.pow(10, Math.floor(Math.log10(max))); const m = max / e; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * e; })();
  const x = (i: number) => pad.l + (points.length === 1 ? (W - pad.l - pad.r) / 2 : (i * (W - pad.l - pad.r)) / (points.length - 1));
  const y = (v: number) => pad.t + (1 - v / niceMax) * (H - pad.t - pad.b);
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const area = `${line} L${x(points.length - 1)},${H - pad.b} L${x(0)},${H - pad.b} Z`;
  const ticks = [0, 0.5, 1].map((f) => niceMax * f);
  const every = Math.max(1, Math.ceil(points.length / 6));
  const onMove = (e: React.PointerEvent) => {
    const r = ref.current?.getBoundingClientRect(); if (!r) return;
    const px = ((e.clientX - r.left) / r.width) * W;
    let best = 0; let d = Infinity;
    points.forEach((_, i) => { const dd = Math.abs(x(i) - px); if (dd < d) { d = dd; best = i; } });
    setHover(best);
  };
  return (
    <div className="chart" ref={ref} style={{ position: 'relative' }} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Sales over time">
        {ticks.map((t) => <g key={t}><line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="#EEECE6" /><text x={pad.l - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="#8A8E96">{t >= 100000 ? `${(t / 100000).toFixed(t % 100000 ? 1 : 0)}k` : (t / 100).toFixed(t % 100 ? (t % 10 ? 2 : 1) : 0)}</text></g>)}
        <path d={area} fill="#FFD400" fillOpacity=".28" />
        <path d={line} fill="none" stroke="#E0B000" strokeWidth="2.5" strokeLinejoin="round" />
        {points.map((p, i) => i % every === 0 || i === points.length - 1 ? <text key={i} x={x(i)} y={H - 6} textAnchor="middle" fontSize="11" fill="#8A8E96">{p.label.slice(5).replace('-', '/')}</text> : null)}
        {hover !== null && <><line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={H - pad.b} stroke="#101114" strokeOpacity=".25" /><circle cx={x(hover)} cy={y(points[hover].value)} r="5" fill="#101114" stroke="#FFD400" strokeWidth="2" /></>}
      </svg>
      {hover !== null && <div className="chart-tip" style={{ left: `${(x(hover) / W) * 100}%`, top: `${(y(points[hover].value) / H) * 100}%` }}>{points[hover].label}: <b>{ghs(points[hover].value)}</b></div>}
    </div>
  );
}

export function fillDays(from: Date, to: Date, rows: { day: string; sales: number }[]) {
  const map = new Map(rows.map((r) => [r.day, r.sales]));
  const out: { label: string; value: number }[] = [];
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  let guard = 0;
  while (d <= to && guard++ < 400) { const k = d.toISOString().slice(0, 10); out.push({ label: k, value: map.get(k) || 0 }); d.setUTCDate(d.getUTCDate() + 1); }
  return out;
}

export const isoDay = (d: Date) => d.toISOString().slice(0, 10);
