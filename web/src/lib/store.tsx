import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { get, safeStorage } from './api';

export interface Category { name: string; slug: string; count: number }
export interface Store { name: string; tagline: string; whatsapp: string; whatsappIntl: string; phones: string[]; location: string; deliveryNote: string; about: string }
export interface Config { store: Store; categories: Category[]; productCount: number }
export interface Product {
  id: number; slug: string; name: string; priceMinor: number; compareAtMinor: number | null; soldOut: boolean; featured: boolean;
  sizes: string[]; colours: string[]; category: { slug: string; name: string } | null; image: string | null; image2: string | null;
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
}
const Ctx = createContext<Shop>(null as unknown as Shop);
const KEY = 'pm_bag_v1';

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

  const add = useCallback((p: Product, size: string, colour: string, qty: number) => {
    const key = `${p.id}|${size}|${colour}`;
    setBag((b) => {
      const hit = b.find((l) => l.key === key);
      if (hit) return b.map((l) => (l.key === key ? { ...l, qty: Math.min(20, l.qty + qty) } : l));
      return [...b, { key, productId: p.id, slug: p.slug, name: p.name, priceMinor: p.priceMinor, image: p.image, size, colour, qty }];
    });
  }, []);
  const setQty = useCallback((key: string, qty: number) => setBag((b) => b.map((l) => (l.key === key ? { ...l, qty: Math.max(1, Math.min(20, qty)) } : l))), []);
  const remove = useCallback((key: string) => setBag((b) => b.filter((l) => l.key !== key)), []);
  const clear = useCallback(() => setBag([]), []);

  const value = useMemo<Shop>(() => ({
    config, bag, add, setQty, remove, clear,
    bagCount: bag.reduce((n, l) => n + l.qty, 0),
    bagTotal: bag.reduce((n, l) => n + l.qty * l.priceMinor, 0),
  }), [config, bag, add, setQty, remove, clear]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export const useShop = () => useContext(Ctx);
