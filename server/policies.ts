import { one, q } from './db/pool.js';

export interface Policy { title: string; body: string }
export type Policies = Record<string, Policy>;
export const POLICY_ORDER = ['delivery', 'returns', 'privacy', 'terms'];

/**
 * The shop's first policies. Headings start with "## " and list lines with "- ".
 * The owner edits these in the admin; what is saved there is what customers see.
 */
export const DEFAULT_POLICIES: Policies = {
  delivery: { title: 'Delivery', body: `## Where we deliver
We deliver anywhere in Ghana. You can also collect your order from us at Fire Service Road, Elubo.

## Delivery fee
The fee depends on where you are. We tell you the exact fee on WhatsApp before you pay, and nothing is added after that.

## When it arrives
We send your order out once payment is confirmed. The arrival day depends on your town, so we give it to you on WhatsApp when we confirm the order.

## Follow your order
Every order has a number that starts with PM-. Use it on the Track order page to see whether your order is confirmed, being prepared, out for delivery or delivered.

## When you receive it
Check your items when they arrive. If anything is wrong, tell us within 48 hours so we can fix it under our returns and exchanges policy.` },
  returns: { title: 'Returns and exchanges', body: `## If we got it wrong
If we send the wrong item or the wrong size, or the item arrives damaged or faulty, tell us within 48 hours of receiving it. We replace it at no cost to you, including delivery. If we cannot replace it, we refund you in full.

## If it does not fit or you change your mind
Tell us within 48 hours of receiving it. You can exchange it for another size or another item. If the new item costs more, you pay the difference. You pay the delivery cost for the exchange.

## Condition of the item
For an exchange, the item must be unworn and unwashed, with its tags and packaging, in the condition you received it.

## What we cannot take back
- Bodysuits and other items worn next to the skin, for hygiene reasons
- Items that have been worn, washed or altered
- Items reported more than 48 hours after delivery

## Refunds
When a refund is due, we send it to the mobile money number or account you paid from, within 3 working days of receiving the item back.

## How to start
Message us on WhatsApp with your order number and a photo of the item. We reply with the next step.` },
  privacy: { title: 'Privacy', body: `## What we collect
When you send an order we keep your name, phone number, delivery location, any note you add, and the items you ordered. We also record the internet address the order came from, to stop abuse of the site.

## Why we keep it
We use it only to confirm your order with you, deliver it, and sort out any problem afterwards.

## Who sees it
Only our staff. We give your name, number and location to the rider or courier delivering your order. We do not sell or share your details with anyone else.

## What stays on your phone
Your bag, saved items, recently viewed items and delivery details are stored in your own browser so the site remembers them. They are not an account. You can remove your delivery details in My space, and clearing your browser data removes the rest.

## Payments
The site does not take payments and never asks for your mobile money PIN or card details.

## Your choices
Message us on WhatsApp to see the details we hold about your orders, correct them, or ask us to delete them.` },
  terms: { title: 'Ordering and payment', body: `## How ordering works
Add items to your bag and send the order on WhatsApp. An order is confirmed only when we reply to confirm that the item and size are available, the price, and the delivery fee.

## Prices
Prices are in Ghana cedis. Where an item shows "Ask for price", we send you the price on WhatsApp before you pay anything.

## Payment
You pay after we confirm your order. We give you the payment details in the WhatsApp chat. Only pay to details sent from 054 686 7225 or 054 072 0742, and never share your mobile money PIN with anyone.

## Availability
Stock changes quickly. If an item or size is no longer available after you order, we tell you before you pay and offer another option.

## Photos and colours
We show each item as clearly as we can. Colours can look slightly different on different phone screens.

## Questions
Message or call us on 054 686 7225 or 054 072 0742. You can also visit us at Fire Service Road, Elubo.` },
};

let cache: { at: number; data: Policies } | null = null;
export async function getPolicies(): Promise<Policies> {
  if (cache && Date.now() - cache.at < 15_000) return cache.data;
  const row = await one<{ value: Policies }>(`SELECT value FROM settings WHERE key = 'policies'`);
  cache = { at: Date.now(), data: row?.value || {} };
  return cache.data;
}
export async function savePolicies(p: Policies): Promise<void> {
  await q(`INSERT INTO settings (key, value, updated_at) VALUES ('policies', $1, now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [JSON.stringify(p)]);
  cache = null;
}
