import { get, post } from './api';

export type PushState = 'unsupported' | 'ios-needs-install' | 'disabled-by-site' | 'blocked' | 'off' | 'on';

const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches || (navigator as any).standalone === true;

let cfg: Promise<{ enabled: boolean; publicKey: string | null }> | null = null;
export const pushConfig = () => (cfg ??= get('/api/push/config').catch(() => ({ enabled: false, publicKey: null })));

function keyBytes(b64: string) {
  const s = atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

async function registration() {
  if (!('serviceWorker' in navigator)) return null;
  return (await navigator.serviceWorker.getRegistration()) || (await navigator.serviceWorker.register('/sw.js').catch(() => null));
}

export async function pushState(): Promise<{ state: PushState; marketing: boolean; endpoint: string | null }> {
  const c = await pushConfig();
  if (!c.enabled) return { state: 'disabled-by-site', marketing: false, endpoint: null };
  if (!('PushManager' in window) || !('Notification' in window) || !('serviceWorker' in navigator)) {
    return { state: isIOS() && !isStandalone() ? 'ios-needs-install' : 'unsupported', marketing: false, endpoint: null };
  }
  if (Notification.permission === 'denied') return { state: 'blocked', marketing: false, endpoint: null };
  const reg = await registration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub || Notification.permission !== 'granted') return { state: 'off', marketing: false, endpoint: null };
  const st = await post<{ subscribed: boolean; marketing: boolean }>('/api/push/status', { endpoint: sub.endpoint }).catch(() => ({ subscribed: false, marketing: false }));
  if (!st.subscribed) return { state: 'off', marketing: false, endpoint: sub.endpoint };
  return { state: 'on', marketing: st.marketing, endpoint: sub.endpoint };
}

/** Asks the browser for permission (must be called from a tap) and saves the subscription. */
export async function enablePush(opts: { marketing?: boolean; orderReference?: string; orderToken?: string } = {}) {
  const c = await pushConfig();
  if (!c.enabled || !c.publicKey) throw new Error('Phone notifications are not available yet.');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error(perm === 'denied' ? 'Notifications are blocked for this site. Allow them in your browser settings, then try again.' : 'Notifications were not allowed.');
  const reg = await registration();
  if (!reg) throw new Error('Your browser does not support notifications here.');
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(c.publicKey) });
  const json = sub.toJSON() as any;
  await post('/api/push/subscribe', { subscription: { endpoint: json.endpoint, keys: json.keys }, marketing: opts.marketing ?? true, order_reference: opts.orderReference },
    opts.orderToken ? { 'X-Order-Token': opts.orderToken } : undefined);
}

export async function setMarketing(endpoint: string, marketing: boolean) {
  await post('/api/push/preferences', { endpoint, marketing });
}

export async function disablePush(endpoint: string) {
  await post('/api/push/unsubscribe', { endpoint });
  const reg = await registration();
  const sub = await reg?.pushManager.getSubscription();
  await sub?.unsubscribe().catch(() => {});
}
