import { config, assertProductionConfig, paymentsMode } from './config.js';
import { migrate } from './db/migrate.js';
import { pool } from './db/pool.js';
import { createApp } from './app.js';
import { startWorker, stopWorker } from './services/jobs.js';
import { periodicTasks } from './services/orders.js';
import { log } from './lib/log.js';

async function main() {
  const problems = assertProductionConfig();
  if (problems.length) {
    for (const p of problems) log.error('configuration problem', { problem: p });
    process.exit(1);
  }
  await migrate();
  const server = createApp();
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;
  server.requestTimeout = 60_000;
  server.listen(config.port, () => log.info('Data Deals running', { port: config.port, env: config.nodeEnv, payments: paymentsMode(), baseUrl: config.publicBaseUrl }));
  if (config.workerEnabled) startWorker(periodicTasks);

  const shutdown = (sig: string) => {
    log.info('shutting down', { sig });
    stopWorker();
    server.close(() => pool.end().finally(() => process.exit(0)));
    setTimeout(() => process.exit(0), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('unhandledRejection', (e) => log.error('unhandled rejection', { err: e }));
}

main().catch((e) => {
  log.error('startup failed', { err: e });
  process.exit(1);
});
