# Data Deals

Airtime and data bundle platform for Ghana (MTN, Telecel, AT): customer website, secure checkout with Paystack,
order processing with supplier/manual fulfilment, and a private admin command centre.

One Render web service serves everything (website, API, admin) from the same address, backed by Neon PostgreSQL.

## Stack
- **Server:** Node.js 22 + TypeScript, Node's built-in HTTP server, `pg` (raw SQL), `zod` validation
- **Website & admin:** React 19 + TypeScript, bundled with esbuild (PWA, pre-compressed assets)
- **Database:** Neon PostgreSQL — SQL migrations in `server/db/migrations`, applied automatically at start-up
- **Payments:** Paystack (initialize → hosted checkout → signed webhook + server verification)

## Render settings (already configured on `data-deals-backend`)
- Build command: `npm install` (runs `node build.mjs` automatically)
- Start command: `npm start`
- Health check path (recommended): `/api/health`
- Environment variables: see `.env.example`

## How money flows (safety rules)
1. Prices are always calculated on the server. The browser never sends a price.
2. Each checkout has an idempotency key → refreshing or double-tapping can never create two orders.
3. An order becomes **paid** only after the server verifies it with Paystack's API (webhook signature checked too).
4. Fulfilment runs from a durable job queue. Supplier results are strict: *success*, *pending*, *failed*,
   or *unknown*. Unknown results are **never retried automatically** — they go to "Needs review".
5. Refunds are blocked while a delivery might have succeeded.
6. Order history and the admin audit log are immutable (database triggers block edits/deletes).

## Local development
```
cp .env.example .env   # fill in a local DATABASE_URL, set FAKE_PAYMENTS=true
npm install
npm start
npm test               # needs a local Postgres test database (TEST_DATABASE_URL)
```
`FAKE_PAYMENTS=true` and `SUPPLIER_SANDBOX=true` enable test simulators. Both refuse to run when `NODE_ENV=production`.

## Connecting RemaData (or another supplier)
Implement `deliver()` and `checkStatus()` in `server/suppliers/adapters.ts` against the supplier's **official**
API documentation, set its env vars, test the connection in Admin → Suppliers, then enable it and assign
supplier product codes to products.

See `docs/OPERATING-GUIDE.md` for the founders' day-to-day guide.
