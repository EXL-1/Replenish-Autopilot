# Run sheet — 2 minutes

**The format is max 2 minutes.** (Earlier drafts of this sheet were written for 3; the
event page says *"Every team submits a live demo at code freeze. Max 2 minutes."*)

The mechanics take **~13 seconds**. Everything else is you talking. Don't rush the clicks
and don't fill silence with features; the demo is four sentences and four clicks.

If you are running long, cut in this order: **the minimisation beat, then the consent beat.**
Never cut the audit trail, the revoke, or the identity switch — those are the pitch.

---

## Before you start (2 minutes before you're called)

```bash
git pull origin main
npm run reset:demo        # resets the demo state
```

That gives you exactly one live token, the single consumable, and the three-beat trail.
**Do not skip it** — revoking is irreversible, so if you demo twice without resetting, the
second run has no live token.

**If you are using the Grok Bot beat: restart the bot after resetting.** `reset:demo`
recreates the consumable, and any agent still holding the old ids will fail its next order.

Then open a browser tab on **https://replenish-autopilot.vercel.app** and leave it there.
Confirm the panel reads **"SIGNED IN AS Demo shopper"**, that the card says *"Coffee beans
1kg is due in 4 days"*, and that **Check prices & reorder** is clickable.

---

## The two minutes

### 0:00 — Don't open with the product

> "Everyone here is going to show you a bot that buys things for them.
> I want to start somewhere else: with how little power I gave mine."

**Do:** You're already on the panel. Don't scroll — you're at the top.

This is the whole pitch. If you get only one sentence out, get that one out.

### 0:15 — Consent (`What Replenish can see`)

> "It watches exactly one category. Consumables — on. Household — on.
> Electronics — off. That's not a preference screen, that's the boundary of what it can see."

**Do:** Point at the **ACCESS** block. `Consumables — Allowed`, `Household — Allowed`,
`Electronics — Not shared`. Don't click anything.

### 0:30 — Minimisation (`What Replenish knows`)

> "This is the entire record of what it knows about me. One line.
> Not my profile, not my purchase history, not my browsing. One row: what I bought,
> how often, and when it runs out."

**Do:** Read the single row aloud — *"Coffee beans 1kg · Expected to run out 30 Sept 2026 ·
usually lasts 28 days"*. Note the line under it: **"That's the whole record."**

### 0:45 — The token (`Your safeguards`)

> "This is what it's allowed to spend. Forty pounds. Consumables only.
> It expires tomorrow at this time whether I use it or not.
> A cap, a category, an expiry — and it can't talk its way past any of them."

**Do:** Point at the **SPENDING** block — *"£40.00 maximum per order · Consumables only ·
Until 27 Sept 2026"*. Point at **Turn off automatic spending** but don't click it yet.

### 1:00 — Run it

> "So let's let it shop."

**Do:** Click **Check prices & reorder**. Narrate what appears:


- *"Checking what is about to run out."*
- *"Coffee is four days out. Comparing shops."*
- *"It chose Waitrose at £13.50."*
- *"Order placed."*

**This is the live moment.** If it's slow, narrate the wait — don't apologise for it.

### 1:30 — The audit trail (`Recent activity`)

> "Here's the part I'd want if I were you. Every decision, the options it compared,
> and the reason. Not a log — a *receipt*."

**Do:** The two newest cards appear on their own — a `✓ Order placed` and a `£ Prices checked`.
**The refusal is now hidden**: click **Show N earlier events** to reveal the `Order blocked`
row. Do that on stage — it is the strongest thing in the demo and it is behind a click.

- `compare` — with all three shops and their prices, and a link to where each price came from
- `order.placed` — `Shopify Dev Store · £12.00 (asked £13.50)`
- `order.blocked` — `£13.50 · cap £40.00`

That third line is the strongest thing on the screen: **the agent tried, and was refused.**

### 1:48 — Revoke

> "And when I've had enough —"

**Do:** Click **Turn off automatic spending**. It reads **Off**, and the permission count
updates.

> "— it's done. Not paused, not gated behind a setting. It cannot spend a penny."

### 1:54 — The proof

> "One last thing. I said only I can see what it knows."

**Do:** Click the **SIGNED IN AS — Demo shopper** control at the top of the panel (account
switching now lives in that menu). Choose the other account. Same panel, same screen —
**empty**. Then switch back.

> "Same code, same database, different person. The locks are real, not UI."

**Close on:** *"That's the whole idea. The agent does the buying — I keep the power."*

---

## If something breaks

| Symptom | What to do |
|---|---|
| The reorder button won't work | You forgot `npm run reset:demo`. Say "let me reset the demo state" and rerun it — takes 2 seconds. |
| Compare is slow (>10s) | It's calling live price APIs. Keep talking: *"it's checking three shops in real time."* Don't click twice. |
| An API error appears in red | Read it out. The error messages are written to be legible and honest. Then fall back to the recorded video. |
| Order says `escalate` | That means the cheapest price exceeded the cap — a *good* outcome. *"It refused to overspend."* |
| Total network failure | Play the recorded fallback. Mention it's a recording. Don't debug live. |

**Never** click **Turn off automatic spending** before the audit-trail beat. It's the
ending, and it's irreversible.

**Turn it back on after the demo** if you're demoing again — or just rerun `npm run reset:demo`.

---

## Q&A — the ones you'll get

**"Is it a real order?"**
Real order object, real Shopify store, flagged as a test order so no money moves. Say that
plainly — it's the right answer, not a hedge.

**"Why £12.00 when it picked £13.50?"**
Shopify is authoritative on price; the dev store's catalogue price differs from the scraped
retail price. We store what was actually charged. This is a *feature* — we found that
mismatch and fixed it rather than shipping two numbers that disagree.

**"What stops the AI from overspending?"**
Not the prompt. The token — cap, category, shop scope, expiry — enforced server-side, with
the JWT required to spend at all. The prompt could be fully hijacked and the cap still holds.

**"Couldn't it just call a different shop?"**
The token is shop-scoped. Wrong shop returns `deny`, and the attempt is written to the audit
trail.

**"What happens if you delete the app?"**
Revoke is server-side. The token stops working immediately, wherever it's running.
