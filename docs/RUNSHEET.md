# Run sheet — 2 minutes

**The format is max 2 minutes.** (Earlier drafts of this sheet were written for 3; the
event page says *"Every team submits a live demo at code freeze. Max 2 minutes."*)

The mechanics take **~13 seconds**. Everything else is you talking. Don't rush the clicks
and don't fill silence with features; the demo is four sentences and four clicks.

If you are running long, cut in this order: **the minimisation beat, then the consent beat.**
Never cut the audit trail, the revoke, or the identity switch — those are the pitch.

The panel reads top to bottom as: **Your next refill** (the button) → **Your safeguards** →
**What Replenish knows** → **Recent activity**. The script walks down the page, comes back up
to press the button, then walks down again.

---

## Before you start (2 minutes before you're called)

```bash
git pull origin main
npm run reset:demo        # resets the demo state
```

That gives you exactly one live spending permission, three seeded consumables, and a
three-row activity trail. **Do not skip it** — turning off spending is irreversible, so if
you demo twice without resetting, the second run has nothing to spend with.

If the Replenish bot is part of the demo, **restart it after the reset** and paste a fresh
token from `npm run demo:jwt`. The reset recreates the consumable, so a bot still holding
the old id fails its next order.

Then open a browser tab on **https://replenish-autopilot.vercel.app** and leave it there.
Confirm:

- top left reads **SIGNED IN AS Demo shopper**
- the refill card is ready and **Check prices & reorder** is *not* greyed out
- **Your purchase limit** shows the green **On** badge

---

## The two minutes

### 0:00 — Don't open with the product

> "Everyone here is going to show you a bot that buys things for them.
> I want to start somewhere else: with how little power I gave mine."

**Do:** You're at the top. The card already says *Coffee beans 1kg is due in 4 days*.
Don't press the button yet — scroll down to **Your safeguards**.

This is the whole pitch. If you get only one sentence out, get that one out.

### 0:15 — Consent (`What Replenish can see`)

> "It watches exactly the categories I allow. Consumables — allowed. Household — allowed.
> Electronics — not shared. That's not a preference screen, that's the boundary of what it can see."

**Do:** Point at the three rows (`Consumables — Allowed`, `Household — Allowed`, `Electronics — Not shared`).
*Optional interactivity:* Click any category to toggle permission live via Supabase RLS.

### 0:30 — The limit (`Your purchase limit`)

> "This is what it's allowed to spend. Forty pounds, maximum per order. Consumables only.
> It expires tomorrow whether I use it or not.
> A cap, a category, an expiry — and it can't talk its way past any of them."

**Do:** Point at the preset limit pills (£10, £25, £40, £60). Hover **Turn off automatic spending**
but don't click yet. (If spending is ever turned off, a "Resume automatic spending" button lets
you restore spending immediately).

### 0:45 — Minimisation (`What Replenish knows`)

> "And this is the entire record of what it knows about me. Three items.
> Not my profile, not my purchase history, not my browsing. What I buy,
> how long it lasts, and when it runs out."

**Do:** Point at the items (Coffee beans, Oat milk, Toothpaste). Point at **"That's the whole record."**

### 1:00 — Run it

> "So let's let it shop."

**Do:** Scroll back to the top. Point to the refill switcher pills (e.g. Coffee beans or Oat milk).
Click **Check prices & reorder**. Narrate the status line as it changes:

- *"Checking what is about to run out."*
- *"Coffee is four days out. Comparing shops."*
- *"Lowest price found: Waitrose at £13.50. Your spending permission allows Shopify Dev
  Store, so that is where the test order will go."*
- *"Test order … placed at Shopify Dev Store for £12.00. No money was charged."*

**This is the live moment.** The third line is the strongest sentence on screen: the
cheapest shop is not the shop it is allowed to use, and it says so. Let it land. If it's
slow, narrate the wait — don't apologise for it.

### 1:30 — The receipts (`Recent activity`)

> "Here's the part I'd want if I were you. Every decision, the options it compared,
> and the reason. Not a log — a *receipt*."

**Do:** Scroll to **Recent activity**. Newest is on top; the top two rows are the run you
just did:

- **Order placed · Completed** — open **View receipt**: *Shopify Dev Store*, *£12.00 (asked
  £13.50)*, and the Shopify order reference.
- **Prices checked · Within budget** — the sentence under it is Grok's explanation. Open
  **View receipt**: all three shops, **Lowest found** on Waitrose, and a **Source ↗** link
  for each price.

**To show the refusal:** click **Show N earlier events** to reveal the seeded **Order stopped · Blocked**
row. Show judges that when the token was inactive or over cap, the system denied the order.

### 1:48 — Turn it off

> "And when I've had enough —"

**Do:** Click **Turn off automatic spending**. The badge flips to **Paused** and the card reads
**Automatic spending is off — Replenish cannot place an order.** The button at the top now
reads **Reordering paused**.

> "— it's done. Not paused behind a setting. It cannot spend a penny."

### 1:54 — The proof

> "One last thing. I said only I can see what it knows."

**Do:** Click **Signed in as Demo shopper** (top left account menu) → **View as Someone else**. Same
page — **No shopping data for this account**. Then switch back to **Demo shopper**.

> "Same code, same database, different person. The locks are real, not UI."

**Close on:** *"That's the whole idea. The agent does the buying — I keep the power."*

### Optional — the bot is refused (only if you have 20 seconds spare)

After **Turn off automatic spending**, message the Replenish bot *"Coffee beans are running
low. Reorder them."* It calls the same API with the demo user's token and is refused, and says
so. Rehearse this once first — if the refusal also adds a new **Order stopped** row after a
refresh, you can point at it as live.

---

## If something breaks

| Symptom | What to do |
|---|---|
| Button reads **Reordering paused** or is greyed out | You forgot `npm run reset:demo`. Say "let me reset the demo state" and rerun it — takes 2 seconds. Or click the green **Resume automatic spending** button. |
| Compare is slow (>10s) | It's calling live price APIs. Keep talking: *"it's checking three shops in real time."* Don't click twice. |
| **Something went wrong** box appears | Read it out. The error messages are written to be legible and honest. Then fall back to the recorded video. |
| **Prices checked · Needs approval** | The cheapest price exceeded the limit — a *good* outcome. *"It refused to overspend."* |
| Bot's order fails on a foreign key | It's holding ids from before the reset. Restart the bot. |
| Total network failure | Play the recorded fallback. Mention it's a recording. Don't debug live. |

**Never** click **Turn off automatic spending** before the receipts beat. It's the ending, and
it's irreversible (though you can resume with the resume button if needed).

---

## Q&A — the ones you'll get

**"Is it a real order?"**
Real order object, real Shopify store, flagged as a test order so no money moves. Say that
plainly — it's the right answer, not a hedge.

**"Why £12.00 when it found £13.50?"**
Shopify is authoritative on price; the dev store's catalogue price differs from the scraped
retail price. We store what was actually charged — the receipt shows both. This is a
*feature* — we found that mismatch and fixed it rather than shipping two numbers that disagree.

**"Why didn't it buy from Waitrose?"**
The spending permission is scoped to one shop. It compares everywhere, but it can only spend
where you allowed it — and the status line and receipt say that out loud.

**"Where's Grok?"**
Two places. The **Replenish bot** is the agent that wants to spend — and gets refused when it
shouldn't. The **xAI API** writes the sentence under *Prices checked*. Neither can authorise
anything: the limit and the policy engine sit between both of them and the card.
*(Point to the "How Grok Bot interacts with Replenish" architecture card on the page to show judges the credential boundary).*

**"Does the Grok Bot have your store API key?"**
No. Point directly to the architecture card: the Grok Bot holds **only the shopper's temporary scoped JWT** (Bearer token). It has zero store admin secrets, zero elevated privileges, and cannot bypass the server's policy engine.

**"What stops the AI from overspending?"**
Not the prompt. The spending permission — cap, category, shop, expiry — enforced server-side,
with the user's login token required to spend at all. The prompt could be fully hijacked and
the cap still holds.

**"Couldn't it just call a different shop?"**
The permission is shop-scoped. Wrong shop returns `deny`, and the attempt is written to the
activity trail.

**"What happens if you delete the app?"**
Turning spending off is server-side. The permission stops working immediately, wherever the
agent is running.
