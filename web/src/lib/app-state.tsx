import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { get, post, safeStorage } from './api';
import type { Network } from './format';

export interface User { id: number; email: string; fullName: string; phone: string | null; role: 'customer' | 'support' | 'admin' | 'owner'; permissions: string[] }
export interface PublicConfig {
  business: { name: string; tagline: string; supportEmail: string | null; supportPhone: string | null; whatsappNumber: string | null; address: string | null; showFounders: boolean; founders?: Array<{ name: string; title: string }> };
  maintenance: { enabled: boolean; message: string };
  networks: Network[];
  payments: { enabled: boolean; testMode: boolean };
  agentsEnabled: boolean;
  refundWindowDays: number;
}
export interface Product {
  id: number; kind: 'data' | 'airtime'; network: string; name: string; category: string; dataMb: number | null; validity: string | null;
  priceMinor: number | null; feeMinor: number; currency: string; airtimeMinMinor: number | null; airtimeMaxMinor: number | null; airtimeFeeBps: number;
}

interface State {
  user: User | null; userLoaded: boolean; config: PublicConfig | null;
  refreshUser: () => Promise<void>; logout: () => Promise<void>; setUser: (u: User | null) => void;
  products: Product[] | null; loadProducts: (force?: boolean) => Promise<Product[]>;
}
const AppCtx = createContext<State>(null as unknown as State);

let productsPromise: Promise<Product[]> | null = null;

export function AppProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [userLoaded, setUserLoaded] = useState(false);
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [products, setProducts] = useState<Product[] | null>(null);

  const refreshUser = useCallback(async () => {
    try { const r = await get<{ user: User | null }>('/api/auth/me'); setUser(r.user); } catch { setUser(null); } finally { setUserLoaded(true); }
  }, []);
  const logout = useCallback(async () => { try { await post('/api/auth/logout'); } finally { setUser(null); } }, []);
  const loadProducts = useCallback(async (force = false) => {
    if (!productsPromise || force) productsPromise = get<{ products: Product[] }>('/api/public/products').then((r) => r.products).catch((e) => { productsPromise = null; throw e; });
    const p = await productsPromise;
    setProducts(p);
    return p;
  }, []);

  useEffect(() => {
    refreshUser();
    get<PublicConfig>('/api/public/config').then(setConfig).catch(() => setConfig(null));
    // Remember an agent referral code from ?ref=CODE for this device.
    const ref = new URLSearchParams(location.search).get('ref');
    if (ref && /^[A-Za-z0-9]{4,20}$/.test(ref)) safeStorage().set('dd_ref', ref.toUpperCase());
  }, [refreshUser]);

  return <AppCtx.Provider value={{ user, userLoaded, config, refreshUser, logout, setUser, products, loadProducts }}>{children}</AppCtx.Provider>;
}

export const useApp = () => useContext(AppCtx);

/** Guest orders are remembered on this device so customers can find their receipts. */
export function rememberOrder(reference: string, token: string) {
  const s = safeStorage();
  let list: { r: string; t: string; at: number }[] = [];
  try { list = JSON.parse(s.get('dd_orders') || '[]'); } catch { list = []; }
  list = [{ r: reference, t: token, at: Date.now() }, ...list.filter((x) => x.r !== reference)].slice(0, 20);
  s.set('dd_orders', JSON.stringify(list));
}
export function rememberedOrders(): { r: string; t: string; at: number }[] {
  try { return JSON.parse(safeStorage().get('dd_orders') || '[]'); } catch { return []; }
}
