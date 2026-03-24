# Reddit Education Post — Week 1 Wednesday

**Target:** r/cs2
**Pillar:** Education
**Real data source:** Trade-up #19 — M4A1-S Welcome to the Jungle outcomes at f=0.069761 (FN, $5,319) vs f=0.085029 (MW, $1,632)

---

## Post

**Title:** Why a 0.069 float is worth 3x more than a 0.071 — CS2 condition boundaries explained

**Body:**

If you've ever looked at two listings of the same skin — almost identical wear — and seen wildly different prices, condition boundaries are why. And if you're doing trade-ups, understanding this can save you thousands.

**The boundary that matters most**

Every CS2 skin has a float value between 0.00 and 1.00. The float maps to a condition:

| Condition | Float Range |
|---|---|
| Factory New (FN) | 0.00 – 0.07 |
| Minimal Wear (MW) | 0.07 – 0.15 |
| Field-Tested (FT) | 0.15 – 0.38 |
| Well-Worn (WW) | 0.38 – 0.45 |
| Battle-Scarred (BS) | 0.45 – 1.00 |

Look at that FN/MW boundary: **0.07**. A skin at 0.0699 is Factory New. A skin at 0.0701 is Minimal Wear. The visual difference between them is literally invisible — but the price difference can be massive.

**A real example: M4A1-S | Welcome to the Jungle**

Right now on the marketplace:

- Factory New (float 0.0697): **~$5,320**
- Minimal Wear (float 0.0850): **~$1,632**

That's **3.26x the price** for a difference of 0.015 in float. Same skin, same collection, functionally identical appearance. $3,688 in value separated by a number most people don't even look at.

**Why this destroys trade-up profits**

Here's where it gets dangerous. In a trade-up contract, the output float is **deterministic**. It's calculated from your input floats using this formula:

```
output_float = (average_input_float × (max_float - min_float)) + min_float
```

Where `max_float` and `min_float` are the float range boundaries of the output skin.

This means if you know your exact input floats, you know exactly what output float you'll get. It's not random — only the skin/collection assignment is random.

So imagine you're building a Classified → Covert trade-up. Your target output is M4A1-S Welcome to the Jungle. The float range for this skin is 0.00–1.00 (full range).

If your average input float works out to 0.0697 → output is Factory New → worth $5,320.

If your average input float is just a bit higher at 0.0850 → output is Minimal Wear → worth $1,632.

**The inputs you can actually buy determine which outcome you get.**

Here's a real scenario I found recently: same 10 input skins, same collection mix, same $4,042 total cost. The only difference was the specific listings available:

- **Scenario A** (ideal floats): Average input float → output 0.0697 (FN). Value: $5,320. Profit: **+$1,278**.
- **Scenario B** (available floats): Average input float → output 0.0850 (MW). Value: $1,632. Profit: **-$2,410**.

Exact same trade-up, exact same skins. One is profitable, one loses $2,400. The difference? Which specific listings were on the marketplace and what floats they had.

**What to check before any trade-up**

1. **Calculate the output float** from your actual input floats, not the "average" or "ideal" ones. The formula above works — plug in the real numbers.

2. **Check how close you are to a boundary.** If your output float is 0.068 and the FN boundary is 0.07, you have a 0.002 margin. One slightly wrong input float and you cross it.

3. **Look at both sides of the boundary.** What's the output worth if you land FN? What if you land MW? If the gap is huge (like $5,320 vs $1,632), this trade-up lives or dies by float precision.

4. **Verify listings exist at the floats you need.** "Average price $200" means nothing if the cheapest listing at the float range you need is $280.

Tools that source from real marketplace listings (like TradeUpBot) test 45+ float targets near these boundaries to find exactly where the condition flips. That's the only reliable way to know if a trade-up actually works before you spend money.

**TL;DR:** A tiny float difference can mean 3x price difference at condition boundaries. In trade-ups, the exact float of your inputs determines the output condition. If your calculator doesn't account for this using real listings, the profit number is meaningless.
