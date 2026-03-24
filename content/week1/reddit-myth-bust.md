# Reddit Myth-Bust Post — Week 1 Monday

**Target:** r/cs2 (cross-post to r/GlobalOffensiveTrade)
**Pillar:** Myth-Busting
**Rule:** DO NOT mention TradeUpBot. Pure value. If people ask how you figured this out, answer naturally in comments.
**Data source:** Real production prices. AK-47 Redline FT avg $48.56 (min $31.09), MW avg $304.03. AWP Asiimov FT avg $135.23, WW avg $96.86.

---

## Post

**Title:** I found a Restricted → Classified trade-up that "should" be 40% profit. Then I tried to actually buy the inputs.

**Body:**

I've been doing trade-ups for a while, and I keep running into the same problem: the math looks great on paper, but falls apart the second you try to buy real listings.

Here's yesterday's example.

**The theory**

I found a Restricted → Classified trade-up on a calculator targeting the AWP | The End. The calculator said:

- 10 inputs: 8x Glock-18 Trace Lock (FT) at ~$3.00 average + 2x XM1014 Zombie Offensive (MW) at ~$0.70 each
- Total cost: ~$25.40
- 80% chance the output is AWP The End (FT), worth ~$41
- Expected profit: ~$10 (40% ROI)

Sounds solid — 80% chance at 40% profit with only $25 on the line. So I went to buy the inputs.

**What actually happened**

First five Glock-18 Trace Locks — the calculator used the $3.00 average. But the cheapest listings on DMarket with the float ranges I need? $2.96, $3.69, $3.01, $2.97, $2.97. The $3.69 one hurt — that one listing at a slightly lower float costs 23% more than the "average."

But here's the real issue. The Trace Lock has a massive price swing across conditions. The calculator uses an FT average of $3.72. But here's what the marketplace actually looks like:

| Condition | Avg Price | Price Range |
|---|---|---|
| Factory New | $25.85 | $14.23 – $35.00+ |
| Minimal Wear | $8.63 | $4.60 – $12.00+ |
| Field-Tested | $3.72 | $2.31 – $5.00+ |

If the calculator assumed even slightly different input floats — pushing the average up — my output float could land in a different condition bracket. An AWP The End in FT is $41. In MW? $66. In FN? $232.

But going the other direction — if my inputs are worse than the calculator assumed — the output could hit WW ($35) or BS ($37). On a $26 input cost, that's a loss.

**The actual spread**

When I priced out every input with real listings (not averages), the total came to $26.02 — close to the estimate, but the devil is in the float details. The 80% chance at the AWP The End is real, but:

- 80% → AWP The End FT ($39.90): profit of $13.88
- 6.7% → Dual Berettas Melondrama FT ($6.80): loss of $19.22
- 6.7% → FAMAS Rapid Eye Movement FT ($6.83): loss of $19.19
- 6.7% → MP7 Abyssal Apparition FT ($6.80): loss of $19.22

That 20% downside? You lose $19 on a $26 bet. The calculator's "40% ROI" assumed you'd always hit the AWP. Reality: your expected value is $33.28 on a $26.02 input, which is 27.9% ROI — still profitable, but that's not what the calculator advertised.

**The bigger problem**

This is a cheap trade-up where the difference is manageable. But scale this up to Covert → Knife/Glove trade-ups at $1,500+, and the gap between theoretical and real pricing is where people lose serious money.

On the knife/glove tier, an input like SSG 08 Dragonfire has this price spread:

| Condition | Avg Price |
|---|---|
| Factory New | $526 |
| Field-Tested | $324 |
| Battle-Scarred | $305 |

A calculator that uses "average" FT price of $324 when the cheapest real listing is $265? That's $59 off per input. On 5 inputs, you're $295 over budget before you even check floats.

**Bottom line**

If a trade-up tool shows you profit based on average prices and ideal floats, check the real listings before committing money. The gap between theory and execution is usually larger than you expect — sometimes it's the entire margin.

Three things to watch:
1. Real listing prices vs the "average" the calculator uses
2. Available float values vs the floats the calculator assumed
3. Whether the inputs still exist by the time you source all 10

---

## Comment reply (if someone asks "how did you figure this out?")

"I built a tool that pulls real listings from CSFloat, DMarket, and Skinport and calculates trade-ups from actual available inputs instead of averages. It tests different float targets to find where condition boundaries cross. It's called TradeUpBot (tradeupbot.app) — free to browse everything."
