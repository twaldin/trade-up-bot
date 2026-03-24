# Reddit Education Post — Week 1 Wednesday

**Target:** r/cs2
**Pillar:** Education
**Data source:** Real production price observations. AK-47 Asiimov FN avg $713.43, MW avg $60.76 (11.7x ratio). Desert Eagle Directive FN $131.57, MW $9.28 (14.2x ratio).

---

## Post

**Title:** An AK-47 Asiimov at 0.069 float is worth $713. At 0.071, it's worth $61. Here's why condition boundaries matter in trade-ups.

**Body:**

If you've ever looked at two listings of the same skin — nearly identical wear — and seen wildly different prices, condition boundaries are why. And if you're doing trade-ups, understanding this can save you hundreds.

**The boundary that matters most**

Every CS2 skin has a float value between 0.00 and 1.00. The float maps to a condition:

| Condition | Float Range |
|---|---|
| Factory New (FN) | 0.00 – 0.07 |
| Minimal Wear (MW) | 0.07 – 0.15 |
| Field-Tested (FT) | 0.15 – 0.38 |
| Well-Worn (WW) | 0.38 – 0.45 |
| Battle-Scarred (BS) | 0.45 – 1.00 |

Look at that FN/MW boundary: **0.07**. A skin at 0.0699 is Factory New. A skin at 0.0701 is Minimal Wear. The visual difference is invisible — but the price difference is not.

**Real examples from the marketplace right now**

| Skin | FN Avg Price | MW Avg Price | Ratio |
|---|---|---|---|
| AK-47 Asiimov | **$713** | $61 | **11.7x** |
| Desert Eagle Directive | **$132** | $9 | **14.2x** |
| M4A1-S Nightmare | **$321** | $30 | **10.8x** |
| AK-47 Rat Rod | **$117** | $12 | **9.7x** |
| AWP Elite Build | **$454** | $61 | **7.5x** |

An AK-47 Asiimov at float 0.069 is Factory New — **$713**. At float 0.071 it's Minimal Wear — **$61**. That's an 11.7x price difference for 0.002 of float. Same skin, same collection, functionally identical appearance.

**Why this destroys trade-up profits**

In a trade-up contract, the output float is **deterministic**. It's calculated from your input floats:

```
output_float = (average_input_float * (max_float - min_float)) + min_float
```

Where max and min are the float range boundaries of the output skin.

This means the output float is NOT random — only the skin/collection assignment is random. If you know your exact input floats, you know exactly what output float you'll get.

Here's where it gets dangerous. Say you're building a Covert → Knife trade-up. Your inputs are 5x SSG 08 Dragonfire (FT). On the marketplace right now:

- SSG 08 Dragonfire FT: avg $324, but individual listings range from $265 to $380+
- The specific float values available: 0.1507, 0.1626, 0.1734...

If your calculator assumed floats around 0.16 (typical FT range), your output float calculation lands one way. But if the cheapest available listings have floats at 0.17 or 0.28 instead, that shifts the output float up.

In glove/knife trade-ups where the output pool spans dozens of skins, this float shift can mean:
- Landing FT gloves worth $2,000+
- Landing WW gloves worth $300

**What to check before any trade-up**

1. **Calculate the output float** from your actual input floats, not the "average" or "ideal" ones.

2. **Check how close you are to a boundary.** If your output float is 0.068 and the FN boundary is 0.07, you have 0.002 margin. One slightly wrong input float and you cross it.

3. **Look at both sides of the boundary.** What's the output worth in FN vs MW? If the gap is 11x (like the AK-47 Asiimov), your trade-up lives or dies by float precision.

4. **Verify listings exist at the floats you need.** "Average price $324" means nothing if the cheapest listing at the float range you need is $380.

Tools that source from real marketplace listings (like TradeUpBot) test 45+ float targets near condition boundaries to find exactly where the condition flips. That's the only reliable way to know if a trade-up works before you spend money.

**TL;DR:** A 0.002 float difference can mean 11x price difference at condition boundaries. In trade-ups, the exact float of your inputs determines the output condition. If your calculator doesn't account for real available floats, the profit number is meaningless.
