import { useEffect, useState } from 'react';
import { Link } from '../lib/router';
import { useShop } from '../lib/store';
import { IcClose, Price, PhotoBlank, swatch } from './ui';

/** Size and colour buttons, shared by the item page, quick add and "complete the look". */
export function Options({ label, values, value, onPick, colour = false }: { label: string; values: string[]; value: string; onPick: (v: string) => void; colour?: boolean }) {
  if (!values.length) return null;
  return (
    <fieldset className="opts"><legend>{label}{value ? <span>{value}</span> : null}</legend>
      <div>{values.map((x) => {
        const hex = colour ? swatch(x) : null;
        return <button key={x} type="button" className={x === value ? 'on' : ''} aria-pressed={x === value} onClick={() => onPick(x)}>{hex ? <i style={{ background: hex }} /> : null}{x}</button>;
      })}</div>
    </fieldset>
  );
}

/** Bottom sheet for adding an item straight from a card when it needs a size or colour chosen first. */
export function QuickAdd() {
  const { quick: p, openQuick, add, say } = useShop();
  const [size, setSize] = useState('');
  const [colour, setColour] = useState('');
  const [need, setNeed] = useState<string | null>(null);
  useEffect(() => { setSize(p && p.sizes.length === 1 ? p.sizes[0] : ''); setColour(p && p.colours.length === 1 ? p.colours[0] : ''); setNeed(null); }, [p]);
  useEffect(() => {
    if (!p) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') openQuick(null); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [p, openQuick]);
  if (!p) return null;
  const go = () => {
    if (p.sizes.length && !size) { setNeed('Choose a size'); return; }
    if (p.colours.length && !colour) { setNeed('Choose a colour'); return; }
    add(p, size, colour, 1);
    openQuick(null);
    say(`${p.name} is in your bag`, '/bag', 'View bag');
  };
  return (
    <div className="sheet" role="dialog" aria-modal="true" aria-label={`Add ${p.name}`}>
      <div className="sheet-scrim" onClick={() => openQuick(null)} />
      <div className="sheet-panel">
        <div className="sheet-head">
          <span className="sheet-pic">{p.thumb ? <img src={p.thumb} alt="" /> : <PhotoBlank name={p.name} />}</span>
          <span className="sheet-title"><b>{p.name}</b><Price p={p} /></span>
          <button className="hbtn" onClick={() => openQuick(null)} aria-label="Close"><IcClose /></button>
        </div>
        <Options label="Size" values={p.sizes} value={size} onPick={(v) => { setSize(v); setNeed(null); }} />
        <Options label="Colour" values={p.colours} value={colour} onPick={(v) => { setColour(v); setNeed(null); }} colour />
        {need && <p className="sheet-need" role="alert">{need}</p>}
        <button className="btn btn-gold btn-wide" onClick={go}>Add to bag</button>
        <Link to={`/item/${p.slug}`} className="sheet-more" onClick={() => openQuick(null)}>See full details</Link>
      </div>
    </div>
  );
}

export function Toast() {
  const { toast } = useShop();
  if (!toast) return null;
  return <div className="toast" role="status" key={toast.n}><span>{toast.text}</span>{toast.to ? <Link to={toast.to}>{toast.label}</Link> : null}</div>;
}
