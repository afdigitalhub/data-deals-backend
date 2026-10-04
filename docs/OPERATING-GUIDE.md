# Data Glow — Founders' Operating Guide

For Adonle Fameye and Emilia. Everything here can be done from a phone.

## 1. Where things are
| What | Where |
|---|---|
| Website (customers) | https://data-glow.onrender.com (until you connect your own domain) |
| Admin command centre | same address + `/admin` |
| Code | GitHub → afdigitalhub/data-deals-backend |
| Hosting | Render → data-deals-backend |
| Database | Neon → project `data-deals` |
| Payments | Paystack dashboard |

The old address `data-deals-frontend.onrender.com` forwards customers to the new site.

## 2. First-time setup (one time only)
1. **Open your admin invite link** (sent to you privately). Choose your own password. Each founder gets a separate link. Links work once and expire after 72 hours.
2. **Paystack keys**: Render → data-deals-backend → Environment → set `PAYSTACK_SECRET_KEY`. Start with the **test** key (`sk_test_…`), then switch to the **live** key (`sk_live_…`) when you're ready to take real money. Never paste keys in chats or screenshots.
3. **Paystack webhook**: Paystack → Settings → API Keys & Webhooks → Webhook URL:
   `https://data-glow.onrender.com/api/webhooks/paystack`
   (Admin → Settings shows this URL with a Copy button.)
4. **Business contact details**: Admin → Settings → Business details → support phone, WhatsApp number, email.
5. **Prices**: Admin → Products. Every product starts as **Draft** (invisible to customers). For each one:
   Edit → check selling price and enter your **supplier cost** → Save → **Go live** → tick the confirmation.
   The 9 bundles from the old site were imported as drafts with their old prices — check them before going live.
   Airtime products need min/max amounts, your fee % and your supplier cost %.

## 3. Daily routine (5 minutes)
1. **Dashboard** — look at the yellow/black buttons at the top: orders waiting for manual delivery and orders that need review.
2. **Manual delivery** (while RemaData isn't connected, every paid order lands here, oldest first):
   - Open the order → send the bundle/airtime to the number shown (e.g. from your reseller/supplier portal).
   - Press **Record delivery** → enter the confirmation/transaction ID → describe how you sent it → tick "recipient actually received it".
   - Only record it after it has really been delivered. The customer's page updates immediately.
   - If you can't deliver it: **Mark failed** with a reason, then **Retry** or **Refund**.
3. **Needs review** — orders where the result is uncertain (for example the supplier didn't answer). **Do not send again.**
   Check the supplier portal for the request ID shown on the order:
   - It arrived → **Confirm delivered**.
   - It did not arrive → **Mark failed** (tick "I checked with the supplier") → then Retry or Refund.
4. **Support** — reply to open tickets. Customers see replies on their ticket page or in their account.

## 4. Refunds
- Allowed only for orders that **failed** (never for delivered ones, never while a result is uncertain).
- Open the order → **Refund** → reason → Paystack sends the money back. Status becomes "Refund in progress", then "Refunded" when Paystack confirms.
- Customer refund requests (from the Support form) appear on the order with **Approve & refund / Reject**.
- If a customer is ever charged twice, the system detects it and creates a refund request automatically.

## 5. Money and reports
- **Dashboard / Reports**: sales, delivered sales, supplier cost, margin, Paystack fees, by network and product. Test orders are hidden unless you tick "Include test orders".
- **Payments & refunds → Reconciliation**: daily money received — compare with your Paystack settlement report.
- A payment is only counted after the server confirms it with Paystack. Screenshots or "I paid" messages are never proof — check the order.

## 6. Team and security
- **Team** (owners only): create invite links for new staff. Roles:
  - *Owner* — everything, including team.
  - *Admin* — daily operations, products, refunds, settings.
  - *Support* — view orders and answer tickets (customer contact details partly hidden).
- **Audit log**: every admin action, permanently recorded with who and when. Nobody can edit or delete it.
- Use a strong, unique password. Log out on shared phones. If a phone is lost, change your password (this signs out all other devices).
- **Maintenance mode** (Settings): pauses new purchases instantly without taking the site down.

## 7. Connecting RemaData for automatic delivery
Automatic delivery switches on only when a real, tested connection exists:
1. Get from RemaData: **official API documentation** and your **API key**.
2. Share the documentation (not the key) so the connector can be finished against their real contract.
3. Put the key in Render → Environment (`REMADATA_API_KEY`, `REMADATA_API_BASE_URL`).
4. Admin → Suppliers → **Test connection** → **Enable**.
5. Admin → Products → Edit each product → choose RemaData and enter RemaData's product code. Keep "Allow manual delivery" ticked as a fallback.

## 8. Before taking real money (launch checklist)
- [ ] Both founders have admin accounts (invite links used).
- [ ] Test mode: place a test order with Paystack's test key, pay with a test card/MoMo, record delivery, and try a refund.
- [ ] Paystack account fully activated for live payments (business verification complete) and live key set.
- [ ] Paystack webhook URL saved.
- [ ] Every live product has a checked price and supplier cost.
- [ ] Support phone/WhatsApp/email set in Settings.
- [ ] You can actually deliver each product you put live (supplier account funded, or manual process ready).
- [ ] Render plan: the free plan sleeps after ~15 minutes without visitors (first visit then takes ~1 minute). For a real shop, upgrade `data-deals-backend` to **Starter** (about US$7/month) so it's always on.
- [ ] Optional: email via Resend (for password-reset and order emails) — set `RESEND_API_KEY` and `EMAIL_FROM`.
- [ ] Optional: your own domain (e.g. datadeals.com.gh) → Render → Custom domains, then set `PUBLIC_BASE_URL`.

### Business and legal items to confirm yourselves
These aren't technical, and only you can confirm them:
- Business registration (Registrar-General / ORC) and a business bank or MoMo merchant account for Paystack settlements.
- Your supplier agreement with RemaData (or any wholesaler) allows reselling to the public.
- Any licensing or registration the National Communications Authority (NCA) requires for reselling airtime/data at your scale.
- Tax registration (GRA) and record-keeping.
- Registration with the Data Protection Commission (Act 843) as a company processing personal data.
- Review the Terms, Privacy and Refund Policy pages and adjust them to your final business details.

## 9. If something goes wrong
- **Site not loading**: Render → data-deals-backend → Logs/Events. On the free plan, wait a minute (it may be waking up).
- **Paid but stuck on "Awaiting payment"**: open the order in admin → **Check Paystack / supplier**.
- **Lots of failed deliveries**: turn on Maintenance mode, then investigate with your supplier.
