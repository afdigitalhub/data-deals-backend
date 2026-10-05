import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { get, safeStorage } from './api';

export interface Category { name: string; slug: string; count: number; image?: string | null }
export interface Collection { kind: 'vibe' | 'edit'; name: string; slug: string; tagline: string; body: string; count: number; image: string | null; thumb: string | null }
export interface Store { name: string; tagline: string; whatsapp: string; whatsappIntl: string; phones: string[]; location: string; deliveryNote: string; about: string; freeDeliveryMinor: number; giftEnabled: boolean }
export interface Config { store: Store; categories: Category[]; productCount: number; collections: Collection[]; policies: { slug: string; title: string }[] }
export interface Product {
  id: number; slug: string; name: string; priceMinor: number; compareAtMinor: number | null; soldOut: boolean; featured: boolean;
  sizes: string[]; colours: string[]; category: { slug: string; name: string } | null; image: string | null; image2: string | null; thumb: string | null; thumb2: string | null;
  badges: string[]; isNew: boolean;
}
export interface BagLine { key: string; productId: number; slug: string; name: string; priceMinor: number; image: string | null; size: string; colour: string; qty: number }

interface Shop {
  config: Config | null;
  bag: BagLine[];
  bagCount: number;
  bagTotal: number;
  add: (p: Product, size: string, colour: string, qty: number) => void;
  setQty: (key: string, qty: number) => void;
  remove: (key: string) => void;
  clear: () => void;
  saved: number[];
  isSaved: (id: number) => boolean;
  toggleSaved: (p: { id: number; name: string }) => void;
  recent: number[];
  seen: (id: number) => void;
  toast: { text: string; to?: string; label?: string; n: number } | null;
  say: (text: string, to?: string, label?: string) => void;
  quick: Product | null;
  openQuick: (p: Product | null) => void;
}
const Ctx = createContext<Shop>(null as unknown as Shop);
const KEY = 'pm_bag_v1';
const SAVED = 'pm_saved_v1';
const RECENT = 'pm_recent_v1';
function loadIds(key: string): number[] {
  try { const a = JSON.parse(safeStorage().get(key) || '[]'); return Array.isArray(a) ? a.filter((n) => Number.isInteger(n) && n > 0).slice(0, 40) : []; } catch { return []; }
}

function loadBag(): BagLine[] {
  try {
    const raw = safeStorage().get(KEY);
    const a = raw ? JSON.parse(raw) : [];
    return Array.isArray(a) ? a.filter((l) => l && typeof l.productId === 'number' && l.qty > 0) : [];
  } catch { return []; }
}

export function ShopProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<Config | null>(null);
  const [bag, setBag] = useState<BagLine[]>(loadBag);
  useEffect(() => { get<Config>('/api/config').then(setConfig).catch(() => {}); }, []);
  useEffect(() => { safeStorage().set(KEY, JSON.stringify(bag)); }, [bag]);
  // Saved items and recently viewed items live on this phone only: the shop has no customer accounts.
  const [saved, setSaved] = useState<number[]>(() => loadIds(SAVED));
  const [recent, setRecent] = useState<number[]>(() => loadIds(RECENT));
  const [toast, setToast] = useState<Shop['toast']>(null);
  const [quick, setQuick] = useState<Product | null>(null);
  useEffect(() => { safeStorage().set(SAVED, JSON.stringify(saved)); }, [saved]);
  useEffect(() => { safeStorage().set(RECENT, JSON.stringify(recent)); }, [recent]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 3200); return () => clearTimeout(t); }, [toast]);
  const say = useCallback((text: string, to?: string, label?: string) => setToast({ text, to, label, n: Date.now() }), []);
  const toggleSaved = useCallback((p: { id: number; name: string }) => {
    setSaved((a) => {
      const has = a.includes(p.id);
      setToast(has ? { text: 'Removed from your saved items', n: Date.now() } : { text: 'Saved', to: '/my-space/saved', label: 'View saved', n: Date.now() });
      return has ? a.filter((x) => x !== p.id) : [p.id, ...a].slice(0, 40);
    });
  }, []);
  const seen = useCallback((id: number) => setRecent((a) => (a[0] === id ? a : [id, ...a.filter((x) => x !== id)].slice(0, 12))), []);

  const add = useCallback((p: Product, size: string, colour: string, qty: number) => {
    const key = `${p.id}|${size}|${colour}`;
    setBag((b) => {
      const hit = b.find((l) => l.key === key);
      if (hit) return b.map((l) => (l.key === key ? { ...l, qty: Math.min(20, l.qty + qty) } : l));
      return [...b, { key, productId: p.id, slug: p.slug, name: p.name, priceMinor: p.priceMinor, image: p.thumb || p.image, size, colour, qty }];
    });
  }, []);
  const setQty = useCallback((key: string, qty: number) => setBag((b) => b.map((l) => (l.key === key ? { ...l, qty: Math.max(1, Math.min(20, qty)) } : l))), []);
  const remove = useCallback((key: string) => setBag((b) => b.filter((l) => l.key !== key)), []);
  const clear = useCallback(() => setBag([]), []);

  const value = useMemo<Shop>(() => ({
    config, bag, add, setQty, remove, clear, saved, toggleSaved, recent, seen, toast, say, quick, openQuick: setQuick,
    isSaved: (id: number) => saved.includes(id),
    bagCount: bag.reduce((n, l) => n + l.qty, 0),
    bagTotal: bag.reduce((n, l) => n + l.qty * l.priceMinor, 0),
  }), [config, bag, add, setQty, remove, clear, saved, toggleSaved, recent, seen, toast, say, quick]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export const useShop = () => useContext(Ctx);
