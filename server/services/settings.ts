import { z } from 'zod';
import { one, q } from '../db/pool.js';

const optStr = (max: number) => z.string().trim().max(max).nullable().transform((v) => (v ? v : null));

export const settingSchemas = {
  business: z.object({
    name: z.string().trim().min(2).max(60),
    tagline: z.string().trim().max(120),
    support_email: optStr(254).refine((v) => !v || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), 'Enter a valid email'),
    support_phone: optStr(30),
    whatsapp_number: optStr(30).refine((v) => !v || /^\+?\d{9,15}$/.test(v.replace(/\s/g, '')), 'Use digits only, e.g. 233241234567'),
    address: optStr(200),
    show_founders: z.boolean(),
    founders: z.array(z.object({ name: z.string().trim().min(2).max(60), title: z.string().trim().min(2).max(60) })).max(4).default([]),
  }),
  limits: z.object({
    max_order_minor: z.number().int().min(100).max(10_000_000),
    max_orders_per_recipient_per_day: z.number().int().min(1).max(500),
    order_expiry_minutes: z.number().int().min(10).max(1440),
  }),
  maintenance: z.object({ enabled: z.boolean(), message: z.string().trim().max(300) }),
  policies: z.object({ refund_window_days: z.number().int().min(0).max(90) }),
  notifications: z.object({ email_enabled: z.boolean(), sms_enabled: z.boolean(), admin_alert_email: optStr(254) }),
  push: z.object({
    daily_enabled: z.boolean(),
    send_hour: z.number().int().min(6).max(21),
    reminders_enabled: z.boolean(),
    custom_title: optStr(60),
    custom_message: optStr(180),
  }),
  agents: z.object({ enabled: z.boolean(), default_commission_bps: z.number().int().min(0).max(5000), min_withdrawal_minor: z.number().int().min(100).max(10_000_000) }),
};
export type SettingKey = keyof typeof settingSchemas;
export type Settings = { [K in SettingKey]: z.infer<(typeof settingSchemas)[K]> };

let cache: { at: number; data: Settings } | null = null;

export async function getSettings(): Promise<Settings> {
  if (cache && Date.now() - cache.at < 15_000) return cache.data;
  const rows = await q<{ key: SettingKey; value: any }>('SELECT key, value FROM settings');
  const data = Object.fromEntries(rows.map((r) => [r.key, r.value])) as Settings;
  cache = { at: Date.now(), data };
  return data;
}

export async function getSetting<K extends SettingKey>(key: K): Promise<Settings[K]> {
  return (await getSettings())[key];
}

export async function putSetting<K extends SettingKey>(key: K, value: Settings[K], userId: number) {
  const before = await one('SELECT value FROM settings WHERE key = $1', [key]);
  await q(`INSERT INTO settings (key, value, updated_by, updated_at) VALUES ($1, $2, $3, now())
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`, [key, value, userId]);
  cache = null;
  return before?.value;
}

export function clearSettingsCache() { cache = null; }

export const DEFAULT_FOUNDERS = [{ name: 'Adonle Fameye', title: 'Co-founder & CEO' }, { name: 'Ben K', title: 'Co-founder & CEO' }];
export const foundersOf = (b: any): Array<{ name: string; title: string }> => (Array.isArray(b?.founders) && b.founders.length ? b.founders : DEFAULT_FOUNDERS);
