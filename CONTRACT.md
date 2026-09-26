# CONTRACT.md — frozen interfaces

> **Agreed at the 10:30 checkpoint. Non-negotiable after that.**
> Owner split: **Lucas = trust layer** · **Gabriel = brain + face**
> Rule: anything *cross-boundary* requires both. Decided in <2 min or deferred to the next gate.

## 1. `ReorderSignal` — the one object that crosses the boundary
Emitted by Gabriel's scheduler · consumed by Lucas's policy engine.

```ts
type ReorderSignal = {
  consumable_id: string;
  product_key: string;
  est_empty_date: string;   // ISO date
  days_until_empty: number;
  source: 'recharge' | 'seed';
};
```

## 2. Policy verdict
```ts
type Verdict =
  | { decision: 'allow' }
  | { decision: 'deny'; reason: string }
  | { decision: 'escalate'; reason: string };
```
`deny` and `escalate` **never** place an order.

## 3. Table names (8, exact)
`users, consumables, shops, price_findings, spend_tokens, orders, audit_log, consent`

## 4. Token contract
`spend_tokens`: `max_amount, category_scope, issued_at, expires_at, revoked_at, status`
Minted and revoked **only** via the privacy panel.

## 5. Audit record (written by Lucas's order path)
```ts
{ action, inputs(jsonb), options(jsonb), choice, reason, token_id }
```
Gabriel's UI reads `audit_log + spend_tokens + consent` — **nothing else**.

## 6. Integration checkpoints
| Time | Checkpoint |
|---|---|
| 10:30 | this contract frozen (both) |
| 13:30 | first merge — order path live |
| 14:30 | second merge — panel + revoke |
