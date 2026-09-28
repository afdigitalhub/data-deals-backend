import { createContext, useContext, useEffect, useState, type MouseEvent, type ReactNode, type AnchorHTMLAttributes } from 'react';

interface Loc { path: string; search: URLSearchParams }
const Ctx = createContext<Loc>({ path: '/', search: new URLSearchParams() });

function read(): Loc { return { path: location.pathname.replace(/\/+$/, '') || '/', search: new URLSearchParams(location.search) }; }

export function navigate(to: string, opts: { replace?: boolean } = {}) {
  if (/^https?:/.test(to)) { location.href = to; return; }
  if (opts.replace) history.replaceState(null, '', to); else history.pushState(null, '', to);
  window.dispatchEvent(new Event('dd:navigate'));
  if (!to.includes('#')) window.scrollTo(0, 0);
}

export function RouterProvider({ children }: { children: ReactNode }) {
  const [loc, setLoc] = useState(read);
  useEffect(() => {
    const on = () => setLoc(read());
    window.addEventListener('popstate', on);
    window.addEventListener('dd:navigate', on);
    return () => { window.removeEventListener('popstate', on); window.removeEventListener('dd:navigate', on); };
  }, []);
  return <Ctx.Provider value={loc}>{children}</Ctx.Provider>;
}

export const useLocation = () => useContext(Ctx);

export function match(pattern: string, path: string): Record<string, string> | null {
  const keys: string[] = [];
  const re = new RegExp('^' + pattern.replace(/\/:([a-zA-Z]+)/g, (_m, k) => { keys.push(k); return '/([^/]+)'; }).replace(/\*$/, '.*') + '$');
  const m = re.exec(path);
  if (!m) return null;
  const out: Record<string, string> = {};
  keys.forEach((k, i) => { out[k] = decodeURIComponent(m[i + 1]); });
  return out;
}

export function Link({ to, children, onClick, ...rest }: { to: string; children: ReactNode } & AnchorHTMLAttributes<HTMLAnchorElement>) {
  const handle = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || rest.target) return;
    e.preventDefault();
    navigate(to);
  };
  return <a href={to} onClick={handle} {...rest}>{children}</a>;
}

export function usePageTitle(title: string) {
  useEffect(() => { document.title = title.includes('Data Deals') ? title : `${title} | Data Deals`; }, [title]);
}
