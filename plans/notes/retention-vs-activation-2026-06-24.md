# Retention vs activation — what the data actually says (2026-06-24)

User's instinct: "maybe it's just conversion tho? people haven't gotten to use it enough to like it." **That instinct is right, and the distinction matters because it changes what we build.**

## The two different problems

- **Activation problem:** people land, never reach the "aha" (a profitable trade-up they'd act on), and bounce. Fix = funnel/first-impression/time-to-value.
- **Retention problem:** people DO reach value, but have no reason to come back. Fix = re-engagement mechanics (fresh-daily framing, alerts, digests).

You can't retain a user who never activated. **Activation is upstream of retention — fix it first.**

## What the GA data shows

- Cohort retention: week-0 of 32–76 users → **~1 by week 1 → 0 after**. Looks like a retention catastrophe.
- BUT engagement signals point to an **activation** failure underneath it:
  - Many sessions are 1–25s (bounce before value); the few multi-thousand-second sessions are power users/you, skewing the average.
  - `page_view` 4,775 vs `scroll` 1,764 (~37%) vs `click` 311 — most visitors view, a third scroll, almost none click deeper.
  - Our best blog page (1,647 impr) had **no CTA at all** until plan 022 — informational visitors had literally no path to the product.
- **Verdict: it's primarily activation right now.** People aren't bouncing because they tried the product and disliked it — most never reach the product. The retention cliff is partly an artifact of low activation (and partly inherent: a trade-up finder is a "check when I want to trade" tool, not a daily habit for casual users).

## Why this is good news

Activation is the cheaper, faster, more controllable lever — and plan 022 (just built) is the first activation fix. The sequence is clear:

### Phase 1 — Activation (now; gates everything)
1. **022 CTAs** (done, in review) — give every page a path to the product. ✅
2. **Time-to-value on the landing/product page:** the first thing a visitor sees should be a *concrete live profitable trade-up* ("This 10-input Dreams & Nightmares contract nets +$4.20 at 62% right now"), not an abstract pitch. Show the product working before asking for anything. → candidate **plan 028**.
3. **027 instrumentation:** define an `activated` event (e.g. viewed ≥1 trade-up detail or ran the calculator) so we can *measure* activation rate, not guess. Without this we're flying blind.

### Phase 2 — Retention (after activation rate is measurable and rising)
4. **Fresh-daily framing:** surface "N new profitable trade-ups found today" — the daemon already produces fresh data; we just don't advertise the freshness as a reason to return.
5. **Free-tier alert hook:** the Pro "Listing Sniper" is the natural retention engine (notify when a profitable trade-up appears). A *limited* free version (1 alert, or email digest) would drive BOTH retention and Pro upgrades. → candidate **plan 029**.
6. **Email/Discord digest:** "today's most profitable trade-up" — re-engagement for signed-in users (needs email capture at signup).

## The honest read for the user

Don't build retention machinery yet. **Most of your retention cliff is unactivated traffic.** Ship activation (022 + a "show the live product first" landing + measurement via 027), get the activation rate to a real number, THEN the retention question becomes answerable with data instead of guesses. If, after activation is fixed, *activated* users still don't return — that's a true retention problem and we build the alert/digest engine. Right now that would be solving a problem we can't yet see.

## Decisions captured this session

- Creator budget: **modest** → lean gift/affiliate (free Pro + referral link), minimal paid spend.
- Referral/affiliate tracking: **build it** (folds into plan 027 attribution + a referral-code system).
