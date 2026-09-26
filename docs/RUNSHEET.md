# Run sheet — 3 minutes

The mechanics take **~10–17 seconds**. Everything else is you talking. Don't rush the
clicks and don't fill silence with features; the demo is four sentences and four clicks.

---

## Before you start (2 minutes before you're called)

```bash
git pull origin main
npm run reset:demo
```

That gives you exactly one live token, the single consumable, and the three-beat trail.
**Do not skip it** — revoking is irreversible, so if you demo twice without resetting, the
second run has no live token.

Then open a browser tab on **https://replenish-autopilot.vercel.app** and leave it there.
Confirm you can see "Signed in as Demo shopper" and a **Run replenishment** button that is
*not* greyed out.

---

## The three minutes

### 0:00 — Don't open with the product

> "Everyone here is going to show you a bot that buys things for them.
> I want to start somewhere else: with how little power I gave mine."

**Do:** You're already on the panel. Don't scroll — you're at the top.

This is the whole pitch. If you get only one sentence out, get that one out.

### 0:20 — Consent (`What I let it watch`)

> "It watches exactly one category. Consumables — on. Household — on.
> Electronics — off. That's not a preference screen, that's the boundary of what it can see."

**Do:** Point at the three chips. Don't click anything.

### 0:40 — Minimisation (`What it actually knows about me`)

> "This is the entire record of what it knows about me. One line.
> Not my profile, not my purchase history, not my browsing. One row: what I bought,
> how often, and when it runs out."

**Do:** Read the single row aloud — `coffee_beans_1kg · every 28 days · empty 2026-09-30`.

### 1:00 — The token (`What it's allowed to spend`)

> "This is what it's allowed to spend. Forty pounds. Consumables only.
> It expires tomorrow at this time whether I use it or not.
> A cap, a category, an expiry — and it can't talk its way past any of them."

**Do:** Hover the **Revoke** button but don't click yet.

### 1:30 — Run it

> "So let's let it shop."

**Do:** Click **Run replenishment**. Narrate what appears in the status line:

- *"Checking what is about to run out."*
- *"Coffee is four days out. Comparing shops."*
- *"It chose Waitrose at £13.50."*
- *"Order placed."*

**This is the live moment.** If it's slow, narrate the wait — don't apologise for it.

### 2:00 — The audit trail (`What it did, and why`)

> "Here's the part I'd want if I were you. Every decision, the options it compared,
> and the reason. Not a log — a *receipt*."

**Do:** Point at the newest three rows:

- `compare` — with all three shops and their prices, and a link to where each price came from
- `order.placed` — `Shopify Dev Store · £12.00 (asked £13.50)`
- `order.blocked` — `£13.50 · cap £40.00`

That third line is the strongest thing on the screen: **the agent tried, and was refused.**

### 2:30 — Revoke

> "And when I've had enough —"

**Do:** Click **Revoke**. The token goes grey and reads *inert*.

> "— it's done. Not paused, not gated behind a setting. It cannot spend a penny."

### 2:45 — The proof

> "One last thing. I said only I can see what it knows."

**Do:** Click **View as Someone else**. Same panel, same screen — **empty**. Then click back to **View as Demo shopper**.

> "Same code, same database, different person. The locks are real, not UI."

**Close on:** *"That's the whole idea. The agent does the buying — I keep the power."*

---

## If something breaks

| Symptom | What to do |
|---|---|
| Run button is greyed out | You forgot `npm run reset:demo`. Say "let me reset the demo state" and rerun it — takes 2 seconds. |
| Compare is slow (>10s) | It's calling live price APIs. Keep talking: *"it's checking three shops in real time."* Don't click twice. |
| An API error appears in red | Read it out. The error messages are written to be legible and honest. Then fall back to the recorded video. |
| Order says `escalate` | That means the cheapest price exceeded the cap — a *good* outcome. *"It refused to overspend."* |
| Total network failure | Play the recorded fallback. Mention it's a recording. Don't debug live. |

**Never** click Revoke before the audit-trail beat. It's the ending, and it's irreversible.

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
