# Reddit Myth-Bust Post — Week 1 Monday

**Target:** r/cs2 (cross-post to r/GlobalOffensiveTrade)
**Pillar:** Myth-Busting
**Rule:** DO NOT mention TradeUpBot. Pure value. If people ask how you figured this out, answer naturally in comments.

---

## Post

**Title:** I found a Classified → Covert trade-up that "should" be profitable. Then I tried to actually source the inputs.

**Body:**

I've been doing trade-ups for a while, and I keep running into the same problem: the math looks great on paper, but falls apart the second you try to buy real listings.

Here's yesterday's example.

**The theory**

I found a Classified → Covert trade-up targeting the M4A1-S | Welcome to the Jungle. The calculator said:

- 10 Classified inputs at ~$350-400 average each
- Total cost: ~$3,500
- Output: M4A1-S | Welcome to the Jungle in Factory New (float ~0.069)
- Expected value: ~$5,300
- Profit: ~$1,800 (51% ROI)

Factory New Welcome to the Jungle at a 0.069 float? That's worth $5,319. Sounds amazing. Let's go buy the inputs.

**What actually happened**

First three inputs — AK-47 Redline, AWP Asiimov, M4A1-S Golden Coil — I found real listings, but they cost 8-15% more than the "average" price the calculator used. The Redline was $233 instead of $200. The Golden Coil was $776 instead of $650. Running total already $180 over budget.

Then input 4: Desert Eagle Kumicho Dragon. The calculator assumed a specific float range that would keep the average low enough to hit Factory New output. The cheapest listing at the float I needed? $582 — almost $100 more than the average price assumed. And it's at float 0.2435, which is higher than what the calculator modeled.

This is the critical part. The output float in a trade-up is calculated from your input floats. When I plugged in the actual floats of the listings I could buy — not the idealized floats the calculator assumed — the output float came out to 0.085.

0.085 is Minimal Wear. Not Factory New.

That Welcome to the Jungle in MW instead of FN? It's worth $1,632. Not $5,319.

**The final math**

| | Calculator said | What I could actually buy |
|---|---|---|
| Total input cost | ~$3,500 | $4,042 |
| Output float | 0.069 (Factory New) | 0.085 (Minimal Wear) |
| Output value | $5,319 | $1,632 |
| Profit | +$1,800 | **-$2,410** |
| ROI | +51% | **-60%** |

That "51% profit" was actually a 60% loss. The entire margin — and then some — was eaten by three things:

1. **Real prices are higher than averages.** The calculator uses historical Steam Market averages that include old sales at prices that no longer exist. The cheapest listing you can actually buy today is almost always more.

2. **Float values determine everything.** A 0.069 output is Factory New ($5,319). A 0.085 output is Minimal Wear ($1,632). That 0.016 difference wiped out $3,687 of value. And the calculator didn't check whether listings at the right floats actually exist.

3. **You can't control what's available.** The floats you need might not have listings. The ones that do might be priced higher. And by the time you've sourced 7 inputs, the first ones might have sold.

**Bottom line**

If a trade-up tool doesn't show you actual listings with exact floats and exact prices — if it's just computing averages and ideal floats — the profit number it shows you is fiction. The gap between theoretical profit and what you can actually execute is usually the entire margin.

Before you commit real money to any trade-up, try sourcing the inputs yourself. Look at real listings. Check the floats. Run the output float calculation with the actual numbers. You might save yourself a lot of money.

---

## Comment reply (if someone asks "how did you figure this out?")

"I built a tool that pulls real listings from CSFloat, DMarket, and Skinport and calculates trade-ups from actual available inputs instead of averages. It tests different float targets to find where condition boundaries cross. It's called TradeUpBot (tradeupbot.app) — free to browse everything."
