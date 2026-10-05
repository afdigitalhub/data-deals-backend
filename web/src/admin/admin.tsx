import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { del, get, post, put } from '../lib/api';
import { Link, navigate, usePageTitle } from '../lib/router';
import { dateTime, ghs, prettyPhone } from '../lib/format';
import { Field, IcArrow, IcBag, IcBox, IcCheck, IcClose, IcCog, IcDoc, IcGrid, IcHome, IcLayers, IcMenu, IcPlus, IcSearch, IcTag, IcTrash, Loading, Notice, PhotoBlank, Wordmark, errMsg } from '../components/ui';

interface Me { id: number; email: string; fullName: string; role: string }
interface Img { id: number; url: string; thumb?: string }
interface AProduct { id: number; slug: string; name: string; categoryId: number | null; categoryName: string | null; description: string; priceMinor: number; compareAtMinor: number | null; sizes: string[]; colours: string[]; status: 'draft' | 'live' | 'sold_out'; isFeatured: boolean; badges: string[]; pairsWith: number[]; images: Img[] }
interface ACollection { id: number; kind: 'vibe' | 'edit'; name: string; slug: string; tagline: string; body: string; is_active: boolean; sort_order: number; product_ids: number[] }
interface ACategory { id: number; name: string; slug: string; sort_order: number; is_active: boolean; count: number }
const STATUS: Record<string, string> = { draft: 'Hidden', live: 'On sale', sold_out: 'Sold out' };

function useLoad<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!path) return;
    let off = false;
    get<T>(path).then((r) => { if (!off) { setData(r); setError(null); } }).catch((e) => { if (!off) setError(errMsg(e)); });
    return () => { off = true; };
  }, [path, n]);
  return { data, error, reload: () => setN((x) => x + 1), setData };
}

/** Shrinks a phone photo in the browser before upload, so pages stay fast and uploads work on slow networks. */
async function shrink(file: File): Promise<{ data: string; thumb: string }> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('That file is not a photo we can open.')); i.src = url; });
    const draw = (max: number) => {
      const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * scale); c.height = Math.round(img.naturalHeight * scale);
      const g = c.getContext('2d')!;
      g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
      g.drawImage(img, 0, 0, c.width, c.height);
      return c;
    };
    // A small copy for the shop's cards, so pages open fast on slow networks.
    const thumb = draw(640).toDataURL('image/jpeg', 0.72);
    const c = draw(1400);
    for (const quality of [0.84, 0.74, 0.62, 0.5]) {
      const data = c.toDataURL('image/jpeg', quality);
      if (data.length < 1_700_000) return { data, thumb };
    }
    throw new Error('That photo is too large even after shrinking. Try another one.');
  } finally { URL.revokeObjectURL(url); }
}

interface Counts { live: number; drafts: number; sold_out: number; new_orders: number; orders_week: number; orders_open: number; no_price: number; no_sizes: number; no_photo: number }
function Shell({ me, tab, children, onLogout }: { me: Me; tab: string; children: ReactNode; onLogout: () => void }) {
  const sum = useLoad<{ counts: Counts }>('/api/admin/summary');
  const fresh = sum.data?.counts.new_orders || 0;
  const [more, setMore] = useState(false);
  useEffect(() => { setMore(false); }, [tab]);
  const main: [string, string, ReactNode][] = [['overview', 'Overview', <IcHome />], ['orders', 'Orders', <IcBag />], ['items', 'Items', <IcGrid />], ['prices', 'Prices', <IcTag />]];
  const rest: [string, string, ReactNode][] = [['collections', 'Collections', <IcLayers />], ['categories', 'Categories', <IcBox />], ['policies', 'Policies', <IcDoc />], ['details', 'Shop details', <IcCog />]];
  const badge = (k: string) => (k === 'orders' && fresh > 0 ? <i>{fresh}</i> : null);
  const inRest = rest.some(([k]) => k === tab);
  return (
    <div className="adm site">
      <aside className="adm-side" aria-label="Admin sections">
        <Wordmark light row to="/admin" />
        <nav>
          {[...main, ...rest].map(([k, label, icon]) => <Link key={k} to={`/admin/${k}`} className={tab === k ? 'on' : ''}>{icon}<span>{k === 'prices' ? 'Prices and sizes' : label}</span>{badge(k)}</Link>)}
        </nav>
        <div className="adm-side-foot">
          <Link to="/" className="btn btn-line">View shop</Link>
          <div className="adm-who"><span>{me.fullName}</span><button className="link-btn" onClick={onLogout}>Log out</button></div>
        </div>
      </aside>
      <header className="adm-top">
        <Wordmark light row to="/admin" />
        <Link to="/" className="adm-view">View shop</Link>
      </header>
      <main className="adm-main">{children}</main>
      <nav className="tabbar adm-bar" aria-label="Admin sections">
        {main.map(([k, label, icon]) => <Link key={k} to={`/admin/${k}`} className={tab === k ? 'on' : ''}><span className="tab-ic">{icon}{badge(k)}</span>{label}</Link>)}
        <button type="button" className={more || inRest ? 'on' : ''} onClick={() => setMore(true)} aria-expanded={more}><IcMenu />More</button>
      </nav>
      {more && (
        <div className="sheet" role="dialog" aria-modal="true" aria-label="More admin sections">
          <div className="sheet-scrim" onClick={() => setMore(false)} />
          <div className="sheet-panel adm-more">
            <div className="adm-more-head"><b>{me.fullName}</b><button className="hbtn" onClick={() => setMore(false)} aria-label="Close"><IcClose /></button></div>
            {rest.map(([k, label, icon]) => <Link key={k} to={`/admin/${k}`} className={tab === k ? 'on' : ''}>{icon}{label}</Link>)}
            <Link to="/"><IcArrow />View shop</Link>
            <button type="button" onClick={onLogout}><IcClose />Log out</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- Sign in and one-time links ----------
function Login({ onDone }: { onDone: (u: Me) => void }) {
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const go = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null);
    try { onDone((await post<{ user: Me }>('/api/auth/login', { email, password })).user); } catch (err) { setError(errMsg(err)); setBusy(false); }
  };
  return (
    <div className="gate site"><form className="gate-card" onSubmit={go}>
      <Wordmark light />
      <h1>Staff log in</h1>
      <Field label="Email"><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required /></Field>
      <Field label="Password"><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required /></Field>
      {error && <Notice>{error}</Notice>}
      <button className="btn btn-dark btn-wide" disabled={busy}>{busy ? 'Logging in' : 'Log in'}</button>
      <p className="fine"><Link to="/">Back to the shop</Link></p>
    </form></div>
  );
}

export function LinkPage({ token }: { token: string }) {
  usePageTitle('Set up your access');
  const { data, error } = useLoad<{ link: { kind: 'invite' | 'reset'; label: string | null } }>(`/api/auth/link/${encodeURIComponent(token)}`);
  const [f, setF] = useState({ full_name: '', email: '', phone: '', password: '' });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  if (error) return <div className="gate site"><div className="gate-card"><Wordmark light /><Notice>{error}</Notice><p className="fine"><Link to="/admin">Go to staff log in</Link></p></div></div>;
  if (!data) return <div className="gate site"><Loading /></div>;
  const invite = data.link.kind === 'invite';
  const go = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try {
      await post(`/api/auth/link/${encodeURIComponent(token)}`, invite ? { full_name: f.full_name, email: f.email, password: f.password, ...(f.phone ? { phone: f.phone } : {}) } : { password: f.password });
      navigate('/admin', { replace: true });
      location.reload();
    } catch (x) { setErr(errMsg(x)); setBusy(false); }
  };
  return (
    <div className="gate site"><form className="gate-card" onSubmit={go}>
      <Wordmark light />
      <h1>{invite ? 'Create your admin account' : 'Choose a new password'}</h1>
      {invite && <>
        <Field label="Your name"><input value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} autoComplete="name" required /></Field>
        <Field label="Email"><input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} autoComplete="username" required /></Field>
        <Field label="Phone number (optional)"><input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} inputMode="tel" autoComplete="tel" /></Field>
      </>}
      <Field label="Password" hint="At least 8 characters, with letters and a number."><input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} autoComplete="new-password" required minLength={8} /></Field>
      {err && <Notice>{err}</Notice>}
      <button className="btn btn-dark btn-wide" disabled={busy}>{busy ? 'Saving' : invite ? 'Create account' : 'Save password'}</button>
    </form></div>
  );
}

// ---------- Items ----------
function Items() {
  const { data, error, reload } = useLoad<{ products: AProduct[] }>('/api/admin/products');
  const [busy, setBusy] = useState<number | null>(null);
  const [term, setTerm] = useState('');
  const [filter, setFilter] = useState<'all' | 'no_price' | 'no_sizes' | 'hidden'>('all');
  const setStatus = async (p: AProduct, status: string) => { setBusy(p.id); try { await post(`/api/admin/products/${p.id}/status`, { status }); reload(); } finally { setBusy(null); } };
  const all = data?.products || [];
  const n = { all: all.length, no_price: all.filter((p) => p.priceMinor === 0).length, no_sizes: all.filter((p) => p.sizes.length === 0).length, hidden: all.filter((p) => p.status === 'draft').length };
  const t = term.trim().toLowerCase();
  const shown = all.filter((p) => (filter === 'no_price' ? p.priceMinor === 0 : filter === 'no_sizes' ? p.sizes.length === 0 : filter === 'hidden' ? p.status === 'draft' : true) && (!t || p.name.toLowerCase().includes(t)));
  return (
    <>
      <div className="adm-head"><h1>Items</h1><Link to="/admin/items/new" className="btn btn-dark"><IcPlus />Add an item</Link></div>
      {error ? <Notice>{error}</Notice> : !data ? <Loading /> : all.length === 0 ? (
        <div className="empty"><h2>Add your first item</h2><p>Take a photo, give it a name and a price, and it goes on the shop.</p><Link to="/admin/items/new" className="btn btn-dark"><IcPlus />Add an item</Link></div>
      ) : (
        <>
          <label className="search"><IcSearch /><input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Search items" aria-label="Search items" /></label>
          <div className="filters">
            {([['all', 'All'], ['no_price', 'No price'], ['no_sizes', 'No sizes'], ['hidden', 'Hidden']] as const).map(([k, label]) => <a key={k} href="#" className={filter === k ? 'on' : ''} onClick={(e) => { e.preventDefault(); setFilter(k); }}>{label} ({n[k]})</a>)}
          </div>
          {shown.length === 0 ? <p className="adm-sum">No items match.</p> : (
            <ul className="adm-list">
              {shown.map((p) => (
                <li key={p.id}>
                  <Link to={`/admin/items/${p.id}`} className="adm-thumb">{p.images[0] ? <img src={p.images[0].thumb || p.images[0].url} alt="" loading="lazy" /> : <PhotoBlank name={p.name} />}</Link>
                  <div className="adm-li-main">
                    <Link to={`/admin/items/${p.id}`} className="adm-li-name">{p.name}</Link>
                    <span className="adm-li-meta">{p.priceMinor > 0 ? ghs(p.priceMinor) : <b className="warn">No price</b>}{p.sizes.length ? `, ${p.sizes.length} size${p.sizes.length === 1 ? '' : 's'}` : ''}{p.categoryName ? `, ${p.categoryName}` : ''}{p.images.length === 0 ? ', no photo yet' : ''}</span>
                  </div>
                  <select value={p.status} disabled={busy === p.id} onChange={(e) => setStatus(p, e.target.value)} aria-label={`Status of ${p.name}`} className={`st st-${p.status}`}>
                    {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </>
  );
}

// ---------- Overview ----------
function Overview({ me }: { me: Me }) {
  const sum = useLoad<{ counts: Counts }>('/api/admin/summary');
  const orders = useLoad<{ orders: any[] }>('/api/admin/orders');
  const c = sum.data?.counts;
  const LABEL: Record<string, string> = { new: 'New', confirmed: 'Confirmed', preparing: 'Preparing', out_for_delivery: 'Out for delivery', delivered: 'Delivered', cancelled: 'Cancelled' };
  const todo: [number, string, string, string][] = c ? [
    [c.new_orders, `${c.new_orders} new order${c.new_orders === 1 ? '' : 's'} to confirm`, 'Reply to the customer, then set the order to Confirmed.', '/admin/orders'],
    [c.no_price, `${c.no_price} item${c.no_price === 1 ? ' has' : 's have'} no price`, 'Customers see "Ask for price" until you add one.', '/admin/prices'],
    [c.no_sizes, `${c.no_sizes} item${c.no_sizes === 1 ? ' has' : 's have'} no sizes`, 'Add sizes so customers can choose and use the size helper.', '/admin/prices'],
    [c.no_photo, `${c.no_photo} item${c.no_photo === 1 ? ' has' : 's have'} no photo`, 'Items with photos sell far better.', '/admin/items'],
  ] : [];
  const open = todo.filter((t) => t[0] > 0);
  return (
    <>
      <div className="adm-head"><h1>Hello, {me.fullName.split(' ')[0]}</h1><Link to="/admin/items/new" className="btn btn-dark"><IcPlus />Add an item</Link></div>
      {sum.error ? <Notice>{sum.error}</Notice> : !c ? <Loading /> : (
        <>
          <div className="stats">
            <Link to="/admin/orders" className={c.new_orders > 0 ? 'hot' : ''}><b>{c.new_orders}</b><span>New orders</span></Link>
            <Link to="/admin/orders"><b>{c.orders_open}</b><span>Being handled</span></Link>
            <Link to="/admin/orders"><b>{c.orders_week}</b><span>Orders in 7 days</span></Link>
            <Link to="/admin/items"><b>{c.live}</b><span>Items on sale</span></Link>
          </div>

          <h2 className="adm-h2">To do</h2>
          {open.length === 0 ? <div className="done-all"><IcCheck />Everything is up to date.</div> : (
            <ul className="todo">{open.map(([, title, text, to]) => <li key={title}><Link to={to}><span><b>{title}</b>{text}</span><IcArrow width={18} height={18} /></Link></li>)}</ul>
          )}

          <h2 className="adm-h2">Latest orders</h2>
          {!orders.data ? <Loading /> : orders.data.orders.length === 0 ? <p className="adm-sum">No orders yet. When a customer sends their bag, it shows here.</p> : (
            <ul className="adm-list">
              {orders.data.orders.slice(0, 5).map((o) => (
                <li key={o.id} className="adm-coll"><div className="adm-li-main"><Link to="/admin/orders" className="adm-li-name">{o.reference}, {o.name}</Link><span className="adm-li-meta">{dateTime(o.createdAt)}, {o.items.length} item{o.items.length === 1 ? '' : 's'}{o.totalMinor > 0 ? `, ${ghs(o.totalMinor)}` : ''}</span></div><span className={`pill pill-${o.status}`}>{LABEL[o.status]}</span></li>
              ))}
            </ul>
          )}
        </>
      )}
    </>
  );
}

// ---------- Prices and sizes, many items at once ----------
function Prices() {
  const { data, error, reload } = useLoad<{ products: AProduct[] }>('/api/admin/products');
  const [edit, setEdit] = useState<Record<number, { price: string; sizes: string }>>({});
  const [only, setOnly] = useState(true);
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [frozen, setFrozen] = useState<number[] | null>(null);
  const all = (data?.products || []).filter((p) => p.status !== 'draft');
  // The list is fixed when the page opens, so a row does not jump away while you are still typing in it.
  useEffect(() => { if (data && !frozen) setFrozen(all.filter((p) => p.priceMinor === 0 || p.sizes.length === 0).map((p) => p.id)); }, [data]); // eslint-disable-line
  const rows = only && frozen ? all.filter((p) => frozen.includes(p.id)) : all;
  const cur = (p: AProduct) => edit[p.id] || { price: p.priceMinor > 0 ? String(p.priceMinor / 100) : '', sizes: p.sizes.join(', ') };
  const set = (p: AProduct, patch: Partial<{ price: string; sizes: string }>) => { setEdit((e) => ({ ...e, [p.id]: { ...cur(p), ...patch } })); setMsg(null); };
  const changed = Object.keys(edit).length;
  const save = async () => {
    setBusy(true); setMsg(null);
    try {
      const items = Object.entries(edit).map(([id, v]) => ({ id: Number(id), price: v.price.trim() || '0', sizes: v.sizes.split(',').map((x) => x.trim()).filter(Boolean) }));
      await put('/api/admin/products/bulk', { items });
      setEdit({}); reload(); setMsg({ kind: 'ok', text: `Saved ${items.length} item${items.length === 1 ? '' : 's'}. The shop updates straight away.` });
    } catch (x) { setMsg({ kind: 'error', text: errMsg(x) }); } finally { setBusy(false); }
  };
  return (
    <>
      <div className="adm-head"><h1>Prices and sizes</h1></div>
      <p className="adm-sum">Type the price and the sizes for each item, then save them all at once. Separate sizes with commas, for example: 40, 41, 42 or S, M, L. Leave sizes empty for one-size items.</p>
      {error ? <Notice>{error}</Notice> : !data ? <Loading /> : (
        <>
          <label className="check"><input type="checkbox" checked={only} onChange={(e) => setOnly(e.target.checked)} /><span>Only show items missing a price or sizes</span></label>
          {rows.length === 0 ? <div className="done-all"><IcCheck />Every item has a price and sizes.</div> : (
            <ul className="quick">
              {rows.map((p) => {
                const v = cur(p);
                return (
                  <li key={p.id} className={edit[p.id] ? 'dirty' : ''}>
                    <span className="adm-thumb">{p.images[0] ? <img src={p.images[0].thumb || p.images[0].url} alt="" loading="lazy" /> : <PhotoBlank name={p.name} />}</span>
                    <div className="quick-main">
                      <Link to={`/admin/items/${p.id}`} className="adm-li-name">{p.name}</Link>
                      <div className="quick-fields">
                        <label><span>GH₵</span><input value={v.price} onChange={(e) => set(p, { price: e.target.value })} inputMode="decimal" placeholder="Price" aria-label={`Price of ${p.name}`} /></label>
                        <input value={v.sizes} onChange={(e) => set(p, { sizes: e.target.value })} placeholder="Sizes: 40, 41, 42" aria-label={`Sizes of ${p.name}`} />
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
          <div className="savebar"><span>{changed > 0 ? `${changed} item${changed === 1 ? '' : 's'} changed` : 'No changes yet'}</span><button className="btn btn-dark" disabled={busy || changed === 0} onClick={save}>{busy ? 'Saving' : 'Save all'}</button></div>
        </>
      )}
    </>
  );
}

// ---------- Policies ----------
function Policies() {
  const { data, error } = useLoad<{ policies: { slug: string; title: string; body: string }[] }>('/api/admin/policies');
  const [f, setF] = useState<{ slug: string; title: string; body: string }[] | null>(null);
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  useEffect(() => { if (data) setF(data.policies); }, [data]);
  if (error) return <Notice>{error}</Notice>;
  if (!f) return <Loading />;
  const save = async (e: FormEvent) => { e.preventDefault(); setBusy(true); setMsg(null); try { await put('/api/admin/policies', { policies: f }); setMsg({ kind: 'ok', text: 'Saved. Customers see the new wording within a minute.' }); } catch (x) { setMsg({ kind: 'error', text: errMsg(x) }); } finally { setBusy(false); } };
  return (
    <form onSubmit={save}>
      <div className="adm-head"><h1>Policies</h1></div>
      <p className="adm-sum">These are the promises customers read on the shop. Read each one and change anything that is not how you work. Start a line with ## for a heading and with - for a list point.</p>
      {f.map((x, i) => (
        <div className="editor editor-sub" key={x.slug}>
          <div className="adm-head"><h2>{x.title}</h2><a className="link-btn" href={`/policy/${x.slug}`} target="_blank" rel="noopener">View on shop</a></div>
          <Field label="Page title"><input value={x.title} onChange={(e) => setF(f.map((y, j) => (j === i ? { ...y, title: e.target.value } : y)))} required maxLength={60} /></Field>
          <Field label="Text" hint="Leave it empty to hide this page from the shop."><textarea rows={14} value={x.body} onChange={(e) => setF(f.map((y, j) => (j === i ? { ...y, body: e.target.value } : y)))} maxLength={6000} /></Field>
        </div>
      ))}
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
      <div className="savebar"><span>Changes apply to all four pages</span><button className="btn btn-dark" disabled={busy}>{busy ? 'Saving' : 'Save policies'}</button></div>
    </form>
  );
}

function ListInput({ label, hint, value, onChange, placeholder }: { label: string; hint: string; value: string[]; onChange: (v: string[]) => void; placeholder: string }) {
  const [t, setT] = useState('');
  const commit = () => { const parts = t.split(',').map((x) => x.trim()).filter(Boolean); if (parts.length) onChange([...new Set([...value, ...parts])].slice(0, 30)); setT(''); };
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      {value.length > 0 && <div className="tags">{value.map((v) => <button type="button" key={v} onClick={() => onChange(value.filter((x) => x !== v))} aria-label={`Remove ${v}`}>{v}<i>×</i></button>)}</div>}
      <div className="tag-add"><input value={t} onChange={(e) => setT(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }} onBlur={commit} placeholder={placeholder} maxLength={120} /><button type="button" className="btn btn-line-dark" onClick={commit}>Add</button></div>
      <span className="field-hint">{hint}</span>
    </div>
  );
}

function ItemEditor({ id }: { id: number | null }) {
  const cats = useLoad<{ categories: ACategory[] }>('/api/admin/categories');
  const existing = useLoad<{ product: AProduct }>(id ? `/api/admin/products/${id}` : null);
  const [f, setF] = useState({ name: '', category_id: null as number | null, description: '', price: '', compare_at: '', sizes: [] as string[], colours: [] as string[], status: 'live' as AProduct['status'], is_featured: false, badges: [] as string[], pairs_with: [] as number[] });
  const all = useLoad<{ products: AProduct[] }>('/api/admin/products');
  const [images, setImages] = useState<Img[]>([]);
  const [queued, setQueued] = useState<{ data: string; thumb: string; key: string }[]>([]);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null); const [saved, setSaved] = useState(false);
  const [upBusy, setUpBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const p = existing.data?.product; if (!p) return;
    setF({ name: p.name, category_id: p.categoryId, description: p.description, price: String(p.priceMinor / 100), compare_at: p.compareAtMinor ? String(p.compareAtMinor / 100) : '', sizes: p.sizes, colours: p.colours, status: p.status, is_featured: p.isFeatured, badges: p.badges || [], pairs_with: p.pairsWith || [] });
    setImages(p.images);
  }, [existing.data]);

  const pick = async (files: FileList | null) => {
    if (!files?.length) return;
    setUpBusy(true); setError(null);
    try {
      for (const file of Array.from(files).slice(0, 8)) {
        const { data, thumb } = await shrink(file);
        if (id) { const r = await post<{ image: Img }>(`/api/admin/products/${id}/images`, { data, thumb }); setImages((a) => [...a, r.image]); }
        else setQueued((a) => [...a, { data, thumb, key: `${Date.now()}-${Math.random()}` }]);
      }
    } catch (e) { setError(errMsg(e)); } finally { setUpBusy(false); if (fileRef.current) fileRef.current.value = ''; }
  };
  const removeImage = async (img: Img) => { try { await del(`/api/admin/images/${img.id}`); setImages((a) => a.filter((x) => x.id !== img.id)); } catch (e) { setError(errMsg(e)); } };
  const makeFirst = async (img: Img) => {
    const next = [img, ...images.filter((x) => x.id !== img.id)]; setImages(next);
    try { await put(`/api/admin/products/${id}/images/order`, { ids: next.map((x) => x.id) }); } catch (e) { setError(errMsg(e)); }
  };

  const save = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null); setSaved(false);
    const body = { name: f.name, category_id: f.category_id, description: f.description, price: f.price, compare_at: f.compare_at ? f.compare_at : null, sizes: f.sizes, colours: f.colours, status: f.status, is_featured: f.is_featured, badges: f.badges, pairs_with: f.pairs_with };
    try {
      if (id) { await put(`/api/admin/products/${id}`, body); setSaved(true); }
      else {
        const r = await post<{ product: AProduct }>('/api/admin/products', body);
        for (const qd of queued) await post(`/api/admin/products/${r.product.id}/images`, { data: qd.data, thumb: qd.thumb });
        navigate('/admin/items');
      }
    } catch (x) { setError(errMsg(x)); } finally { setBusy(false); }
  };
  const destroy = async () => {
    if (!id || !confirm(`Delete "${f.name}" and its photos? This cannot be undone.`)) return;
    try { await del(`/api/admin/products/${id}`); navigate('/admin/items'); } catch (e) { setError(errMsg(e)); }
  };

  if (id && existing.error) return <Notice>{existing.error}</Notice>;
  if (id && !existing.data) return <Loading />;
  const photoCount = images.length + queued.length;
  return (
    <form className="editor" onSubmit={save}>
      <div className="adm-head"><h1>{id ? 'Edit item' : 'Add an item'}</h1><Link to="/admin/items" className="link-btn">Back to items</Link></div>

      <div className="field">
        <span className="field-label">Photos</span>
        <div className="shots">
          {images.map((img, i) => (
            <div key={img.id} className="shot"><img src={img.url} alt="" />
              {i === 0 ? <em>Main photo</em> : <button type="button" className="shot-main" onClick={() => makeFirst(img)}>Make main</button>}
              <button type="button" className="shot-x" onClick={() => removeImage(img)} aria-label="Remove photo"><IcTrash width={16} height={16} /></button>
            </div>
          ))}
          {queued.map((qd, i) => (
            <div key={qd.key} className="shot"><img src={qd.data} alt="" />{images.length === 0 && i === 0 ? <em>Main photo</em> : null}
              <button type="button" className="shot-x" onClick={() => setQueued((a) => a.filter((x) => x.key !== qd.key))} aria-label="Remove photo"><IcTrash width={16} height={16} /></button>
            </div>
          ))}
          {photoCount < 8 && <label className={`shot shot-add ${upBusy ? 'busy' : ''}`}><input ref={fileRef} type="file" accept="image/*" multiple onChange={(e) => pick(e.target.files)} disabled={upBusy} /><IcPlus /><span>{upBusy ? 'Adding' : 'Add photo'}</span></label>}
        </div>
        <span className="field-hint">Up to 8 photos. The first one shows in the shop. Clear, bright photos on a plain background sell best.</span>
      </div>

      <Field label="Name"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required maxLength={120} placeholder="For example: Pink wrap dress" /></Field>
      <div className="two">
        <Field label="Price (GH₵)" hint="Put 0 to show 'Ask for price'."><input value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} inputMode="decimal" required placeholder="250" /></Field>
        <Field label="Old price (optional)" hint="Shows crossed out, to mark a reduction."><input value={f.compare_at} onChange={(e) => setF({ ...f, compare_at: e.target.value })} inputMode="decimal" placeholder="300" /></Field>
      </div>
      <Field label="Category">
        <select value={f.category_id ?? ''} onChange={(e) => setF({ ...f, category_id: e.target.value ? Number(e.target.value) : null })}>
          <option value="">No category</option>
          {(cats.data?.categories || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </Field>
      <ListInput label="Sizes" hint="Type sizes separated by commas, then Add. Leave empty for one-size items." placeholder="40, 41, 42 or S, M, L" value={f.sizes} onChange={(v) => setF({ ...f, sizes: v })} />
      <ListInput label="Colours" hint="Leave empty if it comes in one colour." placeholder="Black, White" value={f.colours} onChange={(v) => setF({ ...f, colours: v })} />
      <Field label="Description (optional)"><textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} rows={4} maxLength={2000} placeholder="Material, fit, what it goes with." /></Field>
      <Field label="Status">
        <select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as AProduct['status'] })}>
          <option value="live">On sale: customers can see and order it</option>
          <option value="sold_out">Sold out: shown, but cannot be ordered</option>
          <option value="draft">Hidden: only you can see it</option>
        </select>
      </Field>
      <label className="check"><input type="checkbox" checked={f.is_featured} onChange={(e) => setF({ ...f, is_featured: e.target.checked })} /><span>Show this first in the shop</span></label>

      <div className="field">
        <span className="field-label">Badge on the photo</span>
        <div className="checks">
          {([['bestseller', 'Bestseller'], ['trending', 'Trending'], ['limited', 'Limited']] as const).map(([k, label]) => (
            <label key={k} className="check"><input type="checkbox" checked={f.badges.includes(k)} onChange={(e) => setF({ ...f, badges: e.target.checked ? [...f.badges, k] : f.badges.filter((x) => x !== k) })} /><span>{label}</span></label>
          ))}
        </div>
        <span className="field-hint">Tick only what is true. "New" shows by itself for the first 14 days, and "Sale" shows when there is an old price.</span>
      </div>

      <div className="field">
        <span className="field-label">Complete the look: worn with</span>
        {f.pairs_with.length > 0 && <div className="tags">{f.pairs_with.map((pid) => { const o = all.data?.products.find((x) => x.id === pid); return <button type="button" key={pid} onClick={() => setF({ ...f, pairs_with: f.pairs_with.filter((x) => x !== pid) })} aria-label="Remove">{o ? o.name : `Item ${pid}`}<i>×</i></button>; })}</div>}
        {f.pairs_with.length < 4 && (
          <select value="" onChange={(e) => { const v = Number(e.target.value); if (v) setF({ ...f, pairs_with: [...f.pairs_with, v] }); }}>
            <option value="">Add an item that goes with this one</option>
            {(all.data?.products || []).filter((o) => o.id !== id && !f.pairs_with.includes(o.id) && o.status !== 'draft').map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        )}
        <span className="field-hint">Up to 4. Customers see these on the item page and can add the whole outfit at once.</span>
      </div>

      {error && <Notice>{error}</Notice>}
      {saved && <Notice kind="ok">Saved.</Notice>}
      <div className="editor-actions">
        <button className="btn btn-dark" disabled={busy || upBusy}>{busy ? 'Saving' : id ? 'Save changes' : 'Add to shop'}</button>
        {id ? <button type="button" className="link-btn danger" onClick={destroy}>Delete item</button> : null}
      </div>
    </form>
  );
}

// ---------- Orders ----------
function Orders() {
  const { data, error, reload } = useLoad<{ orders: any[] }>('/api/admin/orders');
  const set = async (id: number, status: string) => { await post(`/api/admin/orders/${id}/status`, { status }); reload(); };
  const LABEL: Record<string, string> = { new: 'New', confirmed: 'Confirmed', preparing: 'Preparing', out_for_delivery: 'Out for delivery', delivered: 'Delivered', cancelled: 'Cancelled' };
  return (
    <>
      <div className="adm-head"><h1>Orders</h1></div>
      <p className="adm-sum">Every order a customer sends from the shop is saved here, even if they never press send on WhatsApp. When you change the status, the customer sees it on their order tracking page.</p>
      {error ? <Notice>{error}</Notice> : !data ? <Loading /> : data.orders.length === 0 ? <div className="empty"><h2>No orders yet</h2><p>When a customer sends their bag, it shows here with their name, number and location.</p></div> : (
        <ul className="orders">
          {data.orders.map((o) => (
            <li key={o.id} className={`ord ord-${o.status}`}>
              <div className="ord-top"><b>{o.reference}</b><span>{dateTime(o.createdAt)}</span>
                <select value={o.status} onChange={(e) => set(o.id, e.target.value)} aria-label={`Status of ${o.reference}`}>{Object.entries(LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              </div>
              <div className="ord-who"><b>{o.name}</b><a href={`tel:${o.phone}`}>{prettyPhone(o.phone)}</a><a href={`https://wa.me/233${o.phone.slice(1)}`} target="_blank" rel="noopener">WhatsApp</a></div>
              <div className="ord-where">{o.location}{o.note ? ` (${o.note})` : ''}</div>
              <ul className="ord-items">{o.items.map((l: any, i: number) => <li key={i}><span>{l.qty} × {l.name}{[l.size && `size ${l.size}`, l.colour].filter(Boolean).length ? ` (${[l.size && `size ${l.size}`, l.colour].filter(Boolean).join(', ')})` : ''}</span><span>{l.priceMinor > 0 ? ghs(l.priceMinor * l.qty) : 'No price yet'}</span></li>)}</ul>
              {o.gift ? <div className="ord-where">Gift{o.gift.recipient ? ` for ${o.gift.recipient}` : ''}{o.gift.message ? `: "${o.gift.message}"` : ''}</div> : null}
              <div className="ord-total"><span>Items total</span><b>{ghs(o.totalMinor)}</b></div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

// ---------- Categories ----------
function Categories() {
  const { data, error, reload } = useLoad<{ categories: ACategory[] }>('/api/admin/categories');
  const [name, setName] = useState(''); const [err, setErr] = useState<string | null>(null);
  const addCat = async (e: FormEvent) => { e.preventDefault(); setErr(null); try { await post('/api/admin/categories', { name }); setName(''); reload(); } catch (x) { setErr(errMsg(x)); } };
  const save = async (c: ACategory, patch: Partial<ACategory>) => { setErr(null); try { await put(`/api/admin/categories/${c.id}`, { name: c.name, is_active: c.is_active, sort_order: c.sort_order, ...patch }); reload(); } catch (x) { setErr(errMsg(x)); } };
  const remove = async (c: ACategory) => { setErr(null); if (!confirm(`Delete the category "${c.name}"?`)) return; try { await del(`/api/admin/categories/${c.id}`); reload(); } catch (x) { setErr(errMsg(x)); } };
  return (
    <>
      <div className="adm-head"><h1>Categories</h1></div>
      <p className="adm-sum">These are the sections customers shop by. Rename them to match what you sell.</p>
      {err && <Notice>{err}</Notice>}
      {error ? <Notice>{error}</Notice> : !data ? <Loading /> : (
        <ul className="cats">
          {data.categories.map((c) => (
            <li key={c.id}>
              <input defaultValue={c.name} onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== c.name) save(c, { name: v }); }} aria-label="Category name" maxLength={40} />
              <span className="cats-n">{c.count} item{c.count === 1 ? '' : 's'}</span>
              <label className="check"><input type="checkbox" checked={c.is_active} onChange={(e) => save(c, { is_active: e.target.checked })} /><span>Shown</span></label>
              <button className="icon-btn" onClick={() => remove(c)} aria-label={`Delete ${c.name}`}><IcTrash /></button>
            </li>
          ))}
        </ul>
      )}
      <form className="cat-add" onSubmit={addCat}><input value={name} onChange={(e) => setName(e.target.value)} placeholder="New category, for example: Slides" maxLength={40} required minLength={2} /><button className="btn btn-dark">Add category</button></form>
    </>
  );
}

// ---------- Collections ----------
function Collections() {
  const { data, error, reload } = useLoad<{ collections: ACollection[] }>('/api/admin/collections');
  const prods = useLoad<{ products: AProduct[] }>('/api/admin/products');
  const [open, setOpen] = useState<number | 'new-vibe' | 'new-edit' | null>(null);
  const [f, setF] = useState<Omit<ACollection, 'id' | 'slug'>>({ kind: 'vibe', name: '', tagline: '', body: '', is_active: true, sort_order: 0, product_ids: [] });
  const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const start = (c: ACollection | 'new-vibe' | 'new-edit') => {
    setErr(null);
    if (typeof c === 'string') { setF({ kind: c === 'new-edit' ? 'edit' : 'vibe', name: '', tagline: '', body: '', is_active: true, sort_order: (data?.collections.length || 0) + 1, product_ids: [] }); setOpen(c); }
    else { setF({ kind: c.kind, name: c.name, tagline: c.tagline, body: c.body, is_active: c.is_active, sort_order: c.sort_order, product_ids: c.product_ids }); setOpen(c.id); }
  };
  const save = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try { if (typeof open === 'number') await put(`/api/admin/collections/${open}`, f); else await post('/api/admin/collections', f); setOpen(null); reload(); } catch (x) { setErr(errMsg(x)); } finally { setBusy(false); }
  };
  const remove = async () => { if (typeof open !== 'number' || !confirm(`Delete "${f.name}"? The items stay in the shop.`)) return; try { await del(`/api/admin/collections/${open}`); setOpen(null); reload(); } catch (x) { setErr(errMsg(x)); } };
  const list = prods.data?.products.filter((p) => p.status !== 'draft') || [];
  if (open !== null) return (
    <form className="editor" onSubmit={save}>
      <div className="adm-head"><h1>{typeof open === 'number' ? 'Edit collection' : f.kind === 'edit' ? 'New edit' : 'New vibe'}</h1><button type="button" className="link-btn" onClick={() => setOpen(null)}>Back</button></div>
      <Field label="Name"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required minLength={2} maxLength={50} placeholder={f.kind === 'edit' ? 'For example: All white, worn sharp' : 'For example: The Weekend'} /></Field>
      <Field label="Short line under the name"><input value={f.tagline} onChange={(e) => setF({ ...f, tagline: e.target.value })} maxLength={120} /></Field>
      {f.kind === 'edit' && <Field label="A few sentences about this edit" hint="Shown on the home page next to the photo."><textarea rows={4} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} maxLength={800} /></Field>}
      <label className="check"><input type="checkbox" checked={f.is_active} onChange={(e) => setF({ ...f, is_active: e.target.checked })} /><span>Show on the shop</span></label>
      <div className="field">
        <span className="field-label">Items in this collection ({f.product_ids.length})</span>
        <ul className="pick">
          {list.map((p) => {
            const on = f.product_ids.includes(p.id);
            return <li key={p.id}><label><input type="checkbox" checked={on} onChange={() => setF({ ...f, product_ids: on ? f.product_ids.filter((x) => x !== p.id) : [...f.product_ids, p.id] })} /><span className="adm-thumb">{p.images[0] ? <img src={p.images[0].thumb || p.images[0].url} alt="" loading="lazy" /> : <PhotoBlank name={p.name} />}</span><span>{p.name}</span></label></li>;
          })}
        </ul>
        <span className="field-hint">Items show in the order you tick them. The first one's photo is the cover.</span>
      </div>
      {err && <Notice>{err}</Notice>}
      <div className="editor-actions"><button className="btn btn-dark" disabled={busy}>{busy ? 'Saving' : 'Save collection'}</button>{typeof open === 'number' ? <button type="button" className="link-btn danger" onClick={remove}>Delete collection</button> : null}</div>
    </form>
  );
  return (
    <>
      <div className="adm-head"><h1>Collections</h1></div>
      <p className="adm-sum">"Shop by vibe" groups items by mood. "The Edit" is the featured story on the home page: the first edit that is shown is the one customers see.</p>
      {error ? <Notice>{error}</Notice> : !data ? <Loading /> : (
        <ul className="adm-list">
          {data.collections.map((c) => (
            <li key={c.id} className="adm-coll">
              <div className="adm-li-main"><button className="adm-li-name as-link" onClick={() => start(c)}>{c.name}</button><span className="adm-li-meta">{c.kind === 'edit' ? 'The Edit' : 'Vibe'}, {c.product_ids.length} item{c.product_ids.length === 1 ? '' : 's'}{c.is_active ? '' : ', hidden'}</span></div>
              <button className="btn btn-line-dark" onClick={() => start(c)}>Edit</button>
            </li>
          ))}
        </ul>
      )}
      <div className="editor-actions" style={{ marginTop: 16 }}><button className="btn btn-dark" onClick={() => start('new-vibe')}><IcPlus />New vibe</button><button className="btn btn-line-dark" onClick={() => start('new-edit')}><IcPlus />New edit</button></div>
    </>
  );
}

// ---------- Shop details ----------
function Details({ me }: { me: Me }) {
  const { data, error } = useLoad<{ store: any }>('/api/admin/settings');
  const [f, setF] = useState<any>(null);
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [pw, setPw] = useState({ current: '', next: '' }); const [pwMsg, setPwMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [invite, setInvite] = useState<string | null>(null);
  useEffect(() => { if (data) setF({ ...data.store, phones: data.store.phones.join(', '), free_delivery: data.store.free_delivery_minor ? String(data.store.free_delivery_minor / 100) : '' }); }, [data]);
  if (error) return <Notice>{error}</Notice>;
  if (!f) return <Loading />;
  const save = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setMsg(null);
    try { await put('/api/admin/settings', { ...f, phones: String(f.phones).split(',').map((x: string) => x.trim()).filter(Boolean) }); setMsg({ kind: 'ok', text: 'Saved. The shop updates within a minute.' }); }
    catch (x) { setMsg({ kind: 'error', text: errMsg(x) }); } finally { setBusy(false); }
  };
  const changePw = async (e: FormEvent) => { e.preventDefault(); setPwMsg(null); try { await post('/api/admin/password', pw); setPw({ current: '', next: '' }); setPwMsg({ kind: 'ok', text: 'Password changed.' }); } catch (x) { setPwMsg({ kind: 'error', text: errMsg(x) }); } };
  const makeInvite = async () => { const label = prompt('Who is this invite for?'); if (!label) return; try { setInvite((await post<{ url: string }>('/api/admin/invites', { label })).url); } catch (x) { alert(errMsg(x)); } };
  return (
    <>
      <div className="adm-head"><h1>Shop details</h1></div>
      <form className="editor" onSubmit={save}>
        <Field label="Shop name"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required maxLength={60} /></Field>
        <Field label="Headline on the home page"><input value={f.tagline} onChange={(e) => setF({ ...f, tagline: e.target.value })} maxLength={120} /></Field>
        <Field label="WhatsApp number for orders" hint="Customer orders open a chat with this number."><input value={f.whatsapp} onChange={(e) => setF({ ...f, whatsapp: e.target.value })} inputMode="tel" required /></Field>
        <Field label="Phone numbers shown on the site" hint="Separate numbers with a comma."><input value={f.phones} onChange={(e) => setF({ ...f, phones: e.target.value })} required /></Field>
        <Field label="Location (optional)" hint="Town or shop address, shown at the bottom of the site."><input value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} maxLength={120} /></Field>
        <Field label="Delivery note"><textarea rows={3} value={f.delivery_note} onChange={(e) => setF({ ...f, delivery_note: e.target.value })} maxLength={400} /></Field>
        <Field label="Free delivery from (GH₵, optional)" hint="Leave empty if you don't offer free delivery. If you set an amount, the bag tells customers how far they are from it."><input value={f.free_delivery ?? ''} onChange={(e) => setF({ ...f, free_delivery: e.target.value })} inputMode="decimal" placeholder="For example: 500" /></Field>
        <label className="check"><input type="checkbox" checked={!!f.gift_enabled} onChange={(e) => setF({ ...f, gift_enabled: e.target.checked })} /><span>Let customers mark an order as a gift (they give the receiver's name and a message for you to pass on)</span></label>
        <Field label="About the shop (optional)"><textarea rows={4} value={f.about} onChange={(e) => setF({ ...f, about: e.target.value })} maxLength={1500} /></Field>
        {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
        <div className="editor-actions"><button className="btn btn-dark" disabled={busy}>{busy ? 'Saving' : 'Save changes'}</button></div>
      </form>

      <form className="editor editor-sub" onSubmit={changePw}>
        <h2>Change your password</h2>
        <Field label="Current password"><input type="password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} autoComplete="current-password" required /></Field>
        <Field label="New password" hint="At least 8 characters, with letters and a number."><input type="password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} autoComplete="new-password" required minLength={8} /></Field>
        {pwMsg && <Notice kind={pwMsg.kind}>{pwMsg.text}</Notice>}
        <div className="editor-actions"><button className="btn btn-line-dark">Change password</button></div>
      </form>

      {me.role === 'owner' && (
        <div className="editor editor-sub">
          <h2>Give someone else access</h2>
          <p className="fine">Creates a one-time link that lets a staff member add items and see orders. It expires in 7 days.</p>
          <div className="editor-actions"><button type="button" className="btn btn-line-dark" onClick={makeInvite}>Create an invite link</button></div>
          {invite && <Notice kind="ok">Send this link to them privately: <span className="mono">{invite}</span></Notice>}
        </div>
      )}
    </>
  );
}

export function AdminApp({ path }: { path: string }) {
  usePageTitle('Admin');
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  useEffect(() => { get<{ user: Me | null }>('/api/auth/me').then((r) => setMe(r.user)).catch(() => setMe(null)); }, []);
  if (me === undefined) return <div className="gate site"><Loading /></div>;
  if (!me) return <Login onDone={setMe} />;
  const logout = async () => { await post('/api/auth/logout'); setMe(null); };
  const seg = path.replace(/^\/admin\/?/, '').split('/');
  const tab = seg[0] || 'overview';
  let page: ReactNode;
  if (tab === 'items' && seg[1] === 'new') page = <ItemEditor key="new" id={null} />;
  else if (tab === 'items' && seg[1]) page = <ItemEditor key={seg[1]} id={Number(seg[1])} />;
  else if (tab === 'orders') page = <Orders />;
  else if (tab === 'collections') page = <Collections />;
  else if (tab === 'prices') page = <Prices />;
  else if (tab === 'policies') page = <Policies />;
  else if (tab === 'items') page = <Items />;
  else if (tab === 'categories') page = <Categories />;
  else if (tab === 'details') page = <Details me={me} />;
  else page = <Overview me={me} />;
  return <Shell me={me} tab={tab} onLogout={logout}>{page}</Shell>;
}
