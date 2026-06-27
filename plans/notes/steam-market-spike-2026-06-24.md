# Steam Community Market — Listing-Data Spike (Decision Doc)

_Date: 2026-06-24 · Confidence: medium · Scope: can TradeUpBot ingest RICH per-listing Steam Community Market (SCM) data — float+price pairs for INDIVIDUAL listings, a link per listing, active/sold/gone status, with known rate limits — as a new marketplace source alongside csfloat/dmarket/skinport/buff?_

---

## Feasibility verdict (read this first)

**Technically feasible, but rate-limit-brutal and float requires a second pipeline stage.** Rich Steam float+price+link+status data is obtainable, but the cost is concentrated in two places: (1) Valve's IP throttle (~1 request / 4 seconds, with 429 → multi-hour auto-refreshing IP bans), and (2) **Steam never returns a float** — every Steam endpoint returns price + an inspect link, and float must be resolved by a SECOND step. So "rich float+price listing data" is always a TWO-stage pipeline:

1. **listings → price + inspect link + asset/listing IDs** (Valve `render` endpoint)
2. **inspect link → float** (CS2 Game-Coordinator inspector, OR — newer — self-decode from the link)

Rate limits compound across both stages.

**Recommendation in one line:** prototype **Tier A (Valve's own public endpoints), read-only, low-volume, as a PRICE/FLOAT SIGNAL** — not a buy or sell venue (Steam's ~15% buyer fee + Steam-wallet-lock makes it a terrible execution venue). Use Tier C (steamwebapi / pricempire / steamapis) as the paid fallback for float only if the self-decode path fails. Tier B (authenticated scraping) is not worth it for data ingestion.

**Schema impact is trivial (FACT, repo-verified):** the listing `source` field is a free-form `string` (`shared/types.ts:84`; also `:100`, `:124`), and each market is fetched independently and tagged with a source (`server/sync/CLAUDE.md`). Adding `source='steam'` is schema-trivial — the hard part is the data pipeline and rate limits, not the model. `float_value: number` already exists per-listing (`server/sync/types.ts:56,90`).

---

## TIER A — Valve's own public endpoints

**Best data-richness-vs-cost, worst rate limits. Free.**

Three undocumented-but-stable JSON endpoints:

### A1. `/market/priceoverview/` — aggregate price only
`https://steamcommunity.com/market/priceoverview/?appid=730&currency=1&market_hash_name=<urlencoded>`
Returns `success, lowest_price, median_price, volume` (FACT, tyrrrz.me/blog/parsing-steam-market). AGGREGATE only — no floats, no per-listing, no links. `volume` = 24h sold count = a weak liquidity signal. **Use:** cheap price floor/ceiling sanity check, NOT the rich data we want.

### A2. `/market/listings/730/<market_hash_name>/render` — THE rich endpoint
`?start=0&count=100&currency=1&format=json` (FACT). Returns `success, start, pagesize, total_count, results_html, listinginfo, assets`.

- **Pagination:** `total_count` → page via `start`/`count` (max 100/page).
- **Per-listing object:** `listinginfo[listingid]` → `{ listingid, price, converted_price, converted_fee, asset: { appid, contextid, id (=assetid), market_actions: [{ link: "...csgo_econ_action_preview...%assetid%...A%listingid%..." }] } }` (INFERENCE from `g_rgListingInfo` structure + DoctorMcKay/node-steamcommunity CEconItem wiki + Allyans3/steam-market-api-v2 — NOT yet verified against a live render JSON; see open questions).
- **Price per listing** = `converted_price + converted_fee` (integer cents — matches the repo "prices are cents" convention).
- **Per-listing link (what data maps to a listing):** the market page is `https://steamcommunity.com/market/listings/730/<name>`. There is NO stable per-asset web permalink to a single listing beyond `page + listingid`. The richer link is the **per-asset inspect link**: `market_actions[].link` is a TEMPLATE with `%assetid%` and `%listingid%` placeholders; substitute the listing's assetid/listingid to build the `M<listingid>A<assetid>D<dvalue>` market-inspect form. **This inspect link is both the asset link AND the path to float.**
- **Sold/gone status:** there is NO per-listing status field. Active = present in render output. Sold/gone is inferred by ABSENCE — re-fetch render and diff listingids; a listingid that disappears was sold OR delisted (cannot distinguish the two from this endpoint). This is the same absence-diffing model the csfloat-checker already uses for staleness.

### A3. `/market/itemordershistogram` — real-time order book
`?country=US&language=english&currency=1&item_nameid=<id>` (FACT, search results + steamapis). Returns order-book depth (highest buy orders, sell-order ladder). `item_nameid` is NOT in the API — must be scraped once from the listing page HTML and cached per skin (FACT). **Use:** best-bid/best-ask depth, a richer price signal than priceoverview. Still no floats.

### Float resolution (the second stage)
`csgo_econ_action_preview` inspect links self-encode via `s/a/d/m` params: `s`=steam account (inventory items), `a`=assetid (required), `d`=inspect data (required), `m`=market id (market items) (FACT, github.com/csfloat/inspect). Classic path: feed the inspect link to a CS2 Game Coordinator with a logged-in account that OWNS CS2.

- **GC rate limit: 1 float / second / account; ~300 accounts / instance** (FACT, csfloat/inspect README).
- **csfloat/inspect was ARCHIVED 2026-03-25.** As of March 2026 CS2 inspect links "self-encode item details" → use `@csfloat/cs-inspect-serializer` (FACT). This *may* mean float is decodable from the link itself WITHOUT a GC round-trip — a large simplification, but **load-bearing and unverified**; the serializer decodes encoded links, but whether it yields the actual float without a GC call is the open question (see spike step 2).
- Valve heavily rate-limited the GC for community float fetching in 2023 (FACT, x.com/csfloatcom/status/1648717278589112320).

### Tier A rate limits (the wall)
- **SCM render/inventory IP throttle: community-confirmed SAFE interval ~1 request / 4 seconds** (ArchiSteamFarm guidance; FACT, multiple steamcommunity threads). "~20 req/min" is the right order of magnitude (≈15/min at 1-per-4s). Per-IP; triggers fast on shared IPs / VPNs.
- **429 "Too Many Requests" → IP ban ~6 hours, auto-refreshing if you keep hitting during the ban; some bans documented >2 days** (FACT). Can trigger "after a mere half-dozen transactions" if bursty.
- Float stage: 1/sec/account GC limit (separate quota from the IP throttle).

### Tier A verdict
Richest data, fully free, but rate limits are an order of magnitude tighter than existing sources. At 1 req/4s, one render page (100 listings)/4s ≈ 1,500 listings/min theoretical — but per-IP and ban-prone. The bot runs ONE 3-vCPU box on ONE IP already busy with csfloat/dmarket; adding Steam render scraping on the SAME IP risks 429-banning the box (and the daemon's csfloat pipeline shares that IP). **Production must use a dedicated IP / proxy, separate from the daemon's box.** Float stage needs CS2-owning bot accounts OR the new self-decode path.

---

## TIER B — Authenticated (logged-in cookie/session) scraping

**Marginal extra data, higher risk.**

Extra data unlocked by a logged-in session: your OWN listings' `original_id`, the ability to BUY/place orders, slightly higher inventory access. For READ-ONLY market listing/float data it adds essentially NOTHING over Tier A — render and histogram are public/unauthenticated (FACT).

**Risk:** the same ~1-req/4s IP throttle applies, but now a 429 / abuse pattern is tied to a real Steam ACCOUNT, not just an IP. ToS prohibits automated market access; aggressive scraping risks account flagging, market/trade holds, or bans on the logged-in account — a real asset (CS2 ownership, wallet balance). **High downside, ~zero data upside for ingestion.**

**Tier B verdict:** do NOT use for data ingestion. Reserve auth strictly for hypothetical buy execution (which we recommend against — see cross-cutting).

---

## TIER C — Third-party APIs

**Lowest engineering, recurring $ cost, abstracts the rate-limit pain.**

- **steamwebapi.com** — offers a CS2 "Float API" (float, paint seeds, patterns) and Steam market price endpoints; markets `dmarket/buff/skinport/csfloat` already exposed (FACT, steamwebapi.com/price-api). Their CSFloat endpoint `/steam/api/items?markets=csfloat` returns "float value, listing price, seller, stickers" (FACT). Markets "No 429 Errors / No Rate Limits" (marketing). Concrete per-request credit cost, tiers, and whether they expose per-listing FLOAT for the official STEAM market (vs third-party markets) is NOT documented publicly — confirm via `/pricing` + `/steam/documentation` in the spike. Free tier exists. **INFERENCE:** they primarily surface float for third-party markets (csfloat/buff), not necessarily official SCM listings — official-SCM-listing float coverage is the open question.
- **pricempire.com/api** — real-time + historical multi-market pricing incl. Steam Market, "wear values, sticker combos, pattern indexes"; updates every 1–2 min (some markets 30s); 429 on monthly-limit exhaustion (FACT). Pricing tiers not public — confirm in spike. Strong for price/history; per-individual-listing float+link coverage unconfirmed.
- **steamapis.com** — "reliable, nonblocking, real-time" SCM + third-party (Buff163/DMarket/Skinport/Skinbid/OPMarket); usage-based billing with overage charges (FACT). Good for SCM price/listing data; float coverage unconfirmed.
- **CSFloat's own API** (docs.csfloat.com) — already consumed by the bot. Returns listings WITH float (`CSFloatListing.item.float_value`, `server/sync/types.ts`). CSFloat raised personal-consumer Inspect API to **100,000/day** (FACT, x.com/csfloatcom/status/1500244373694341121). But **CSFloat ≠ Steam Market** — separate marketplace, so this gives no STEAM listings.

**Tier C verdict:** lowest risk and lowest engineering (no IP-ban / bot-account management), but (a) recurring cost, (b) you inherit a vendor's coverage gaps, (c) MOST third-party float coverage is for markets you already ingest (csfloat/buff/dmarket), so the MARGINAL value of "Steam float via a vendor" is unproven — must confirm any vendor actually returns per-listing float for OFFICIAL SCM listings.

---

## Cross-cutting: BUY source or only a price signal?

**CRITICAL economics (FACT, grounding):** Steam has NO seller fee but a ~**15% buyer/Steam fee** (10% Steam + 5% game, baked into `converted_fee`), and proceeds are **Steam-wallet-locked** (non-withdrawable to cash).

For a bot that buys 10 inputs and sells 1 output for REAL profit, Steam is a poor BUY venue: the 15% fee dwarfs existing venues (CSFloat 2.8%+30 buyer / 2% seller, DMarket 2.5%/2%, Skinport 0%/8% — from grounding), and wallet-lock means you cannot realize cash gains.

**Therefore Steam's value to this bot is a PRICE/LIQUIDITY SIGNAL and float-data source, not a buy/sell execution venue.** This materially lowers the bar:
- No authenticated buy flows needed → kills Tier B's main justification.
- Can tolerate staleness / sampling because it's a signal, not a claimable listing — exactly like the existing Skinport-WS "observations, never claim" pattern.

---

## RECOMMENDED SPIKE

Ranked best→worst by data-richness-vs-risk: **A > C > B.** Prototype **Tier A, read-only, low-volume, as a price/float SIGNAL** (mirroring the skinport-ws "observation, never claim" role), in three steps.

### Step 1 — Render-only price+link spike (1–2 days, zero ban risk if paced)
Hit `/market/listings/730/<name>/render` for ~20–50 high-value covert outputs (the collection outputs that drive trade-ups, e.g. Dead Hand outputs), paced at **1 req/4s from a NON-production IP** (laptop or a cheap separate proxy — NOT the VPS, to protect the daemon's IP). Parse `listinginfo` → assetid, listingid, `converted_price + converted_fee` (cents), `market_actions` inspect-link template. Confirm pagination via `total_count` and active/sold diffing across two fetches.
**Deliverable:** prove you can get price + per-listing-link + active/gone for SCM.

### Step 2 — Float-decode spike (the make-or-break)
Take the inspect links from step 1 and test `@csfloat/cs-inspect-serializer`: determine whether float is now SELF-DECODABLE from the link (no GC, no bot accounts) or still needs a 1/sec/account GC round-trip. **This single result decides Tier A's whole viability.** Self-decodable → Tier A is cheap, build it. GC-required → fall back to Tier C for float.

### Step 3 — Tier C confirmation (parallel, ~half a day)
Hit steamwebapi free tier; check pricempire/steamapis pricing pages to confirm whether ANY vendor returns per-listing FLOAT for OFFICIAL SCM listings, and at what credit cost. Bounds the "buy vs build" decision against step 2.

### Decision rule after the spike
- Step 2 self-decodable → **build Tier A** as a paced, separate-IP signal fetcher.
- Step 2 GC-required AND a Tier C vendor covers SCM float cheaply → **use Tier C**.
- **Tier B stays unused** unless Steam ever becomes an execution venue (it shouldn't, given 15% fee + wallet-lock).

**Total est. effort to a go/no-go:** ~2–3 engineer-days (steps 1+2 sequential, step 3 parallel).

---

## Open questions / caveats (resolve in spike, do NOT assume)
- Whether `@csfloat/cs-inspect-serializer` yields actual float without a GC call (load-bearing; csfloat/inspect archived 2026-03-25 with this exact deprecation note).
- Exact current `listinginfo` / `market_actions` field names — INFERRED from g_rgListingInfo + node-steamcommunity wiki, not fetched from a live render JSON in this research. Verify against a real response.
- Whether any Tier-C vendor exposes per-listing float for OFFICIAL SCM (vs only third-party markets already ingested).
- "~20 req/min" is approximate; community-confirmed safe rate is ~1 req/4s (≈15/min), with 429 → ~6h+ auto-refreshing IP bans. Production must use a separate IP/proxy from the daemon's box.

---

## Sources
- https://tyrrrz.me/blog/parsing-steam-market — render/priceoverview structure, caching/throttle
- https://github.com/csfloat/inspect — inspect s/a/d/m params, 1 float/sec/account, ~300 accounts/instance, archived 2026-03 self-encode note
- https://github.com/Allyans3/steam-market-api-v2
- https://github.com/DoctorMcKay/node-steamcommunity/wiki/CEconItem — listinginfo/market_actions inspect-link template
- https://www.steamwebapi.com/ · /price-api · /csfloat-api — third-party float coverage
- https://pricempire.com/api — Tier C pricing/limits
- https://steamapis.com/pricing — Tier C pricing/limits
- https://www.steamwebapi.com/blog/steam-market-listing-too-many-requests-429 + steamcommunity 429 threads — IP-ban duration, 1-req/4s safe rate
- https://x.com/csfloatcom/status/1500244373694341121 — 100k/day inspect
- https://x.com/csfloatcom/status/1648717278589112320 — Valve GC rate-limit 2023
- https://docs.csfloat.com/ — CSFloat API float coverage (separate market, not Steam)
