# Replenish Autopilot

**A cross-retailer replenishment agent that runs your cart without building a profile of you.**

> Autonomous commerce isn't blocked by AI. It's blocked by trust. We built the trust layer
> that makes your cart safe to hand over.

Grok Bot Commerce · London Hackathon — Fleek HQ, 26 September 2026
**Team:** Lucas Malik (trust layer) · Gabriel Moura (brain + face)

**Live:** https://replenish-autopilot.vercel.app
**Run sheet:** [`docs/RUNSHEET.md`](./docs/RUNSHEET.md)

---

## The idea in one line

Everyone is racing to give agents a wallet. We built the thing that decides whether the
wallet is allowed to open — and proves, afterwards, exactly what it did and why.

## What it does

`signal → compare (3 shops, live) → policy check → scoped order (Shopify) → audit trail`

1. **Signal** — from a cadence and a last-delivery date, derive "coffee is empty in 4 days".
   No purchase history, no profile.
2. **Compare** — live prices from three retailers via Tavily, ranked, with the pack price
   extracted (retail ranges and per-100g unit prices stripped). Cached for
   `PRICE_CACHE_TTL_MINUTES` so a live demo never trips a rate limit.
3. **Policy check** — a spend token carries **cap + category scope + shop scope + expiry**.
   The engine returns `allow | deny | escalate`. **`deny` and `escalate` never place an order.**
4. **Order** — a real order on a real Shopify store, in test mode.
5. **Audit** — every decision logs the inputs, the options compared, the choice and the reason.

Open the live URL and press **Run replenishment** to see all five steps in one click.

## Privacy architecture — the differentiator

| Principle | How it's actually enforced |
|---|---|
| Data minimisation | One row per consumable. No profile store, no history, no browsing data. |
| User-owned data | Supabase RLS on all 8 tables: `auth.uid() = user_id`. |
| Scoped spend authority | Cap + category + shop + TTL + revoke, modelled on UCP/AP2 mandates. |
| Explainable decisions | Every action writes inputs, options compared, choice and reason. |
| Consent and control | Opt-in per category; one-tap revoke that takes effect server-side. |

### The privacy panel proves it rather than asserting it

The panel reads the database with **the signed-in user's own credentials and the public anon
key** — no service-role key reaches the browser. The **"View as"** toggle signs in as a second
account and shows the same panel, empty. That is row-level security demonstrated on screen,
not described on a slide.

## Security model

The API routes talk to Postgres through the service-role key, which **bypasses RLS** — so the
routes enforce their own rules:

- **Every route requires the caller's Supabase JWT.** No token, no data: `401`.
- Every query is **scoped to the authenticated user**, never to a value from the body or
  query string.
- Another user's `consumable_id` or `token_id` returns **404, not 403** — the endpoints can't
  be used to enumerate what exists.
- The agent and the panel go through **the same authenticated door**. There is no
  unauthenticated path to spending.

## Verified

| Check | Result |
|---|---|
| Full sequence, end to end | **7/7 pass, ~9s** (against a 180s demo budget) |
| Policy engine | `npm run check:policy` — 7/7 (cap, category, TTL, revoke, wrong shop, no token) |
| Live price compare | 3 shops, stable pick, evidence URLs |
| RLS isolation | demo user sees 27 rows; second account sees **0** |
| Auth | `401` without a JWT, `403` across users, `401` on a forged token |
| Orders | real Shopify dev-store orders, `test: true`, stored amount = **what Shopify charged** |
| Build | `npm run build` passes |

## Setup

```bash
npm install
cp .env.example .env.local     # fill in the values
supabase link --project-ref inpoajxknyuuoyddeoqo
supabase db push               # applies supabase/migrations/0001_init.sql
npm run dev
```

### Rehearsing the demo

```bash
npm run reset:demo
```

Revoking is the demo's closing beat and it is **irreversible by design** — this restores one
live token, the consent state, the single consumable and the three-beat audit trail. Run it
before every rehearsal and before the real run.

## Standards alignment

Spend tokens and mandates are modelled on **UCP / AP2** (Universal Commerce Protocol), the
open standard co-developed by Google, Shopify, Walmart, Amazon, Stripe, Visa and Mastercard —
not bespoke plumbing.

## Known trade-offs

Stated rather than hidden:

- **The demo account's password is in the client bundle.** `app/page.tsx` is a client
  component that signs in automatically so a judge can see RLS without a login step. That
  means anyone can sign in as the demo user while the site is live. Acceptable for a demo
  account; would be replaced with a real auth flow for anything else.
- **Orders are test orders.** Real order objects in a real Shopify dev store, flagged
  `test: true` so no money moves.
- **The dev store's catalogue price can differ from the scraped retail price.** We store what
  Shopify actually charged, so the panel can never disagree with the store.

## Boundaries — deliberately not built

Recurring billing, returns, multi-currency, merchant-facing app, more than three shops,
a real Recharge webhook (seeded CSV covers the demo).

See [`CONTRACT.md`](./CONTRACT.md) for the frozen interfaces.

## API

```
GET  /api/signal?user_id=<id>   -> ReorderSignal[]        (auth required)
POST /api/compare               -> price_findings[]       (auth required)
POST /api/order                 -> policy check -> Shopify order -> orders + audit_log
```

All three require `Authorization: Bearer <supabase-jwt>`.
