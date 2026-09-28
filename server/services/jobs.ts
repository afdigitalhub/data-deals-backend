import { hostname } from 'node:os';
import { pool, q, type Queryable } from '../db/pool.js';
import { log } from '../lib/log.js';

export type JobHandler = (payload: any) => Promise<void>;
const handlers = new Map<string, JobHandler>();
export function registerJob(type: string, fn: JobHandler) { handlers.set(type, fn); }

/** Durable job queue in Postgres. unique_key makes enqueueing idempotent (e.g. one fulfilment job per order). */
export async function enqueue(type: string, payload: Record<string, unknown>, opts: { uniqueKey?: string; delayMs?: number; maxAttempts?: number } = {}, db: Queryable = pool) {
  await q(`INSERT INTO jobs (type, payload, unique_key, run_at, max_attempts) VALUES ($1, $2, $3, now() + make_interval(secs => $4), $5)
           ON CONFLICT (unique_key) DO NOTHING`, [type, payload, opts.uniqueKey ?? null, (opts.delayMs ?? 0) / 1000, opts.maxAttempts ?? 5], db);
}

const workerId = `${hostname()}:${process.pid}`;

/** Claims and runs one ready job. Returns false when the queue is empty. */
export async function runOneJob(): Promise<boolean> {
  const claimed = await q(`UPDATE jobs SET status = 'running', locked_at = now(), attempts = attempts + 1, updated_at = now()
     WHERE id = (SELECT id FROM jobs WHERE status = 'pending' AND run_at <= now() ORDER BY run_at, id LIMIT 1 FOR UPDATE SKIP LOCKED)
     RETURNING *`);
  const job = claimed[0];
  if (!job) return false;
  const fn = handlers.get(job.type);
  try {
    if (!fn) throw new Error(`no handler for job type ${job.type}`);
    await fn(job.payload);
    await q(`UPDATE jobs SET status = 'done', updated_at = now(), last_error = NULL WHERE id = $1`, [job.id]);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const final = job.attempts >= job.max_attempts;
    const backoffS = Math.min(3600, 15 * 2 ** (job.attempts - 1));
    await q(`UPDATE jobs SET status = $2, last_error = $3, run_at = now() + make_interval(secs => $4), locked_at = NULL, updated_at = now() WHERE id = $1`,
      [job.id, final ? 'failed' : 'pending', msg.slice(0, 1000), backoffS]);
    log.error('job failed', { jobId: job.id, type: job.type, attempts: job.attempts, final, worker: workerId, err: e });
  }
  return true;
}

export async function drainJobs(max = 100) {
  for (let i = 0; i < max; i++) if (!(await runOneJob())) return;
}

let timer: NodeJS.Timeout | null = null;
let periodicTimer: NodeJS.Timeout | null = null;
let busy = false;

export function startWorker(periodic: () => Promise<void>) {
  const tick = async () => {
    if (busy) return;
    busy = true;
    try { await drainJobs(50); } catch (e) { log.error('worker tick failed', { err: e }); } finally { busy = false; }
  };
  timer = setInterval(tick, 2000);
  // Jobs left "running" by a crashed process are released after 10 minutes. Fulfilment is safe to re-run
  // because it detects an in-flight supplier request and routes it to review instead of sending again.
  const every = async () => {
    try {
      await q(`UPDATE jobs SET status = 'pending', locked_at = NULL WHERE status = 'running' AND locked_at < now() - interval '10 minutes'`);
      await periodic();
    } catch (e) { log.error('periodic tasks failed', { err: e }); }
  };
  periodicTimer = setInterval(every, 5 * 60_000);
  setTimeout(every, 10_000).unref();
  log.info('worker started', { workerId });
}

export function stopWorker() {
  if (timer) clearInterval(timer);
  if (periodicTimer) clearInterval(periodicTimer);
}
