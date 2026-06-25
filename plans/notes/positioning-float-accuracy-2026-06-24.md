# Positioning — float-exact pricing is the moat (2026-06-24)

The single sharpest strategic input of round 3, from the founder, **verified against the engine**. This is the through-line for every workstream: messaging, activation, content, SEO long-tail, conversion, and creator outreach.

## The differentiator (verified in code)

**Chain:** real buyable listings → exact float-specific input cost → **deterministic** exact output float → **float-specific** output price (KNN over real sales) → the *true* profit/EV.

Verified:
- `server/engine/core.ts calculateOutputFloat` — each input's actual `float_value` normalized within `[min_float,max_float]`, averaged → one exact output float (the public CS2 formula).
- `server/engine/evaluation.ts` — inputs priced at their real listing float+price (`effectiveBuyCost`); output priced via `lookupOutputPrice(pool, outcome, predFloat)` at the **exact predicted float**, backed by `knn-pricing.ts` (KNN over `price_observations` real sale points).

## Where competitors lose accuracy (the precise, fair claim)

The output-float→price step. Most CS2 calculators predict the output *condition* (FN/MW/FT/…) — that part's public math — but then price the output at the **condition average**. A 0.002 Factory New sells for multiples of a 0.06 Factory New, so a condition-average price makes their profit/EV numbers systematically wrong, often flipping a "profitable" trade-up to a loss or vice versa. TradeUpBot prices the *exact* output float. Same gap exists on the input side (they price inputs by condition; we use the real listing's float+price).

**Honesty guardrail for any published comparison content (025):** make the *mechanism* claim ("condition-average vs float-exact pricing") which is true and defensible; do NOT publish unverified per-competitor accusations. Codex gate must check each factual claim against `fees.ts` + the engine + a live competitor check before any comparison page ships. The mechanism story wins without needing to name-and-shame.

## How it threads through the plans

- **Messaging / activation (028):** lead every first-impression with the mechanism, made concrete. The hook isn't "find profitable trade-ups" (everyone says that) — it's **"the only finder that prices the exact output float, so the profit number is actually right."** Show a live trade-up with `condition-average estimate: +$2.10` struck through vs `float-exact: −$0.40 (the truth)`. That single visual is the activation hook, the conversion argument, and shareable content at once.
- **Calculator/trade-ups depth + schema (023):** the thickened crawler content explains float-exact pricing (great for the "why are calculators wrong" query cluster + AI-assistant citations); the on-page demo proves it.
- **Long-tail content engine (025):** our pages answer "is [specific trade-up] profitable" with **float-exact, real-listing** numbers competitors literally cannot generate without the same live-data + KNN stack. That's the defensible long-tail moat. Expand the existing "CS2 Trade-Up Calculators Are Wrong: $2,778 Data Test" post (it already ranks-ish and is exactly this angle) into a content pillar.
- **Creator outreach:** the pitch leads with the mechanism — "the only calculator that uses real float-specific pricing, not condition estimates" — a sharper hook than generic "find profitable trade-ups." Update the email templates' opening line.
- **Product moat framing:** competitors can't cheaply replicate this — it requires the live-listing ingestion + the KNN float-pricing model + deterministic discovery we already run. The data IS the defensibility.

## One-line positioning (use everywhere)

> **The only CS2 trade-up finder that prices the exact output float — not a condition average — so the profit number is the real one.**
