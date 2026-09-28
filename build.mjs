// Build script: bundles the API server and the website with esbuild (fast, one dependency).
import { build } from 'esbuild';
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { brotliCompressSync, gzipSync, constants } from 'node:zlib';

const serverOnly = process.argv.includes('--server-only');
const t0 = Date.now();

rmSync('dist/server', { recursive: true, force: true });
await build({
  entryPoints: ['server/index.ts', 'server/app.ts', 'server/db/pool.ts', 'server/db/migrate.ts', 'server/services/jobs.ts', 'server/services/orders.ts', 'server/payments/provider.ts', 'server/suppliers/adapters.ts', 'server/http/security.ts', 'server/services/settings.ts'],
  outdir: 'dist/server', outbase: 'server', bundle: true, splitting: true, platform: 'node', format: 'esm', target: 'node20',
  packages: 'external', sourcemap: true, logLevel: 'warning',
});
cpSync('server/db/migrations', 'dist/server/migrations', { recursive: true });
cpSync('server/db/migrations', 'dist/server/db/migrations', { recursive: true });

if (!serverOnly) {
  rmSync('dist/web', { recursive: true, force: true });
  const res = await build({
    entryPoints: { app: 'web/src/main.tsx' }, outdir: 'dist/web/assets', bundle: true, splitting: true, format: 'esm', minify: true,
    target: ['es2020', 'chrome87', 'safari15', 'firefox90'], entryNames: '[name]-[hash]', chunkNames: 'c-[hash]', assetNames: '[name]-[hash]',
    jsx: 'automatic', metafile: true, logLevel: 'warning', legalComments: 'none',
    define: { 'process.env.NODE_ENV': '"production"' },
  });
  const outputs = Object.keys(res.metafile.outputs).map((p) => p.replace(/^dist\/web/, ''));
  const entryJs = outputs.find((p) => /\/app-[A-Z0-9]+\.js$/i.test(p));
  const entryCss = outputs.find((p) => /\/app-[A-Z0-9]+\.css$/i.test(p));
  cpSync('web/public', 'dist/web', { recursive: true });
  const html = readFileSync('web/index.html', 'utf8')
    .replace('<!--ASSETS-->', `${entryCss ? `<link rel="stylesheet" href="${entryCss}">` : ''}\n    <script type="module" src="${entryJs}"></script>`);
  writeFileSync('dist/web/index.html', html);
  // Service worker: pre-cache the app shell (hashed assets never change) for fast repeat visits on slow networks.
  const version = Date.now().toString(36);
  const sw = readFileSync('web/sw.js', 'utf8').replace('__VERSION__', version).replace('__ASSETS__', JSON.stringify(outputs.filter((p) => !p.endsWith('.map'))));
  writeFileSync('dist/web/sw.js', sw);
  // Pre-compress text assets.
  const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
  for (const f of walk('dist/web')) {
    if (!/\.(js|css|html|svg|webmanifest|json|txt)$/.test(f)) continue;
    const buf = readFileSync(f);
    if (buf.length < 1024) continue;
    writeFileSync(f + '.gz', gzipSync(buf, { level: 9 }));
    writeFileSync(f + '.br', brotliCompressSync(buf, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }));
  }
  const sizes = outputs.filter((p) => p.endsWith('.js') || p.endsWith('.css')).map((p) => `${p} ${(statSync('dist/web' + p).size / 1024).toFixed(1)}kB`);
  console.log('web:', sizes.join(', '));
}
console.log(`build ok in ${Date.now() - t0}ms`);
