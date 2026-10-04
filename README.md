# Pmsomel Enterprise store

Online shop for Pmsomel Enterprise (sneakers, outfits, bags and accessories).

- Customers browse, add to a bag and send the order to the shop's WhatsApp. Every order is also saved in the admin.
- Staff add items, photos, prices and sizes at `/admin`.
- Node 22, PostgreSQL, React. Photos are stored in the database.

## Settings (environment variables)

| Name | What it is |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `APP_SECRET` | Long random value (32+ characters) |
| `NODE_ENV` | `production` |
| `PUBLIC_BASE_URL` | Optional. The site address, if not on Render's default |

Build: `npm install`. Start: `npm start`.
