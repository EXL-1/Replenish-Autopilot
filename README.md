# GL-SpaceX

**A cross-retailer replenishment agent that runs your cart without building a profile of you.**

> Autonomous commerce isn't blocked by AI — it's blocked by trust. We built the trust layer that makes your cart safe to hand over.

Grok Bot Commerce · London Hackathon — Fleek HQ, 26 September 2026
**Team:** Lucas Malik (trust layer) · Gabriel Moura (brain + face)

## Status — foundation live

| Layer | State |
|---|---|
| **Live URL** | https://replenish-autopilot.vercel.app |
| **Supabase** | project `GL-SpaceX-Hackathon` — 8 tables + RLS applied and enforced |
| **RLS proof** | as user A the API returns 1 signal; as user B it returns `[]` |
| **Verified** | `npm run build` passes · `npm run check:policy` 7/7 · live `/api/signal` reads real Postgres |

## Privacy architecture (the differentiator)

| Principle | Implementation |
|---|---|
| Data minimization | Derive only the reorder signal from cadence — ephemeral trigger, no profile store |
| User-owned data | Supabase RLS: every row scoped to `auth.uid() = user_id` |
| Scoped spend authority | Per-merchant cap + category scope + TTL, revocable — modelled on UCP/AP2 mandates |
| Explainable decisions | Every action logs inputs, options compared, choice, reason |
| Consent & control | Opt-in per category, pause anytime, one-tap full revoke |

## The loop

`signal → compare (Tavily, 3 shops) → scoped order (Shopify) → audit`

```
GET  /api/signal?user_id=<id>   -> ReorderSignal[]  (days-until-empty < threshold)
POST /api/order                 -> policy check -> Shopify order -> orders + audit_log rows
```

The policy engine (`lib/policy-engine.ts`) returns `allow | deny | escalate`.
**`deny` and `escalate` never place an order.**

## Standards alignment

Spend tokens and mandates are modelled on **UCP / AP2** (Universal Commerce Protocol),
the open standard co-developed by Google, Shopify, Walmart, Amazon, Stripe, Visa and
Mastercard — not bespoke plumbing.

## Setup

```bash
npm install
cp .env.example .env.local     # fill in the values
supabase link --project-ref inpoajxknyuuoyddeoqo
supabase db push               # applies supabase/migrations/0001_init.sql
npm run dev
```

### Verify RLS (the 10:30 gate)
```sql
-- as user A
insert into consumables (user_id, product_key, cadence_days) values (auth.uid(), 'coffee', 28);
-- as user B: must return ZERO rows
select * from consumables;
```

## Boundaries

See [`CONTRACT.md`](./CONTRACT.md) for the frozen interfaces and the 10:30 / 13:30 / 14:30 checkpoints.

**WON'T** (cut without guilt): real recurring billing, returns, multi-currency, full ZK/encryption,
merchant-facing app, more than 3 shops.
