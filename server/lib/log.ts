import { config } from '../config.js';

const levels = { debug: 10, info: 20, warn: 30, error: 40 } as const;
type Level = keyof typeof levels;
const threshold = levels[(config.logLevel as Level)] ?? levels.info;

// Keys whose values must never reach the logs.
const SECRET_KEYS = /pass(word)?|secret|token|authorization|cookie|api[_-]?key|signature/i;

function scrub(v: unknown, depth = 0): unknown {
  if (depth > 4 || v === null || typeof v !== 'object') return v;
  if (v instanceof Error) return { name: v.name, message: v.message, code: (v as { code?: string }).code, stack: config.isProduction ? undefined : v.stack };
  if (Array.isArray(v)) return v.slice(0, 20).map((x) => scrub(x, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = SECRET_KEYS.test(k) ? '[redacted]' : scrub(val, depth + 1);
  return out;
}

function write(level: Level, msg: string, data?: Record<string, unknown>) {
  if (levels[level] < threshold) return;
  const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...(data ? (scrub(data) as object) : {}) });
  if (level === 'error' || level === 'warn') process.stderr.write(line + '\n');
  else process.stdout.write(line + '\n');
}

export const log = {
  debug: (m: string, d?: Record<string, unknown>) => write('debug', m, d),
  info: (m: string, d?: Record<string, unknown>) => write('info', m, d),
  warn: (m: string, d?: Record<string, unknown>) => write('warn', m, d),
  error: (m: string, d?: Record<string, unknown>) => write('error', m, d),
};
