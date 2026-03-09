# CS2 Trade-Up Bot -- Research & Architecture Reference

## 1. Trade-Up Contract Mechanics

### Float Value Algorithm (Post-October 2025 "Retakes Update")

The float calculation uses a **three-stage normalization process**:

```
Step 1: Normalize each input to universal 0-1 scale
  Adjusted_Float_i = (F_i - F_min_i) / (F_max_i - F_min_i)

Step 2: Average the adjusted floats
  Avg_Adjusted = (1/10) * SUM(Adjusted_Float_i)

Step 3: Map onto output skin's float range
  Output_Float = F_min_out + Avg_Adjusted * (F_max_out - F_min_out)
```

**The float calculation is fully deterministic -- no randomness.** The only random element is *which* outcome skin you receive.

### Condition Tiers
| Condition | Float Range |
|-----------|-------------|
| Factory New (FN) | 0.00 - 0.07 |
| Minimal Wear (MW) | 0.07 - 0.15 |
| Field-Tested (FT) | 0.15 - 0.38 |
| Well-Worn (WW) | 0.38 - 0.45 |
| Battle-Scarred (BS) | 0.45 - 1.00 |

### Trade-Up Rules
- **10 skins** of the **same rarity** required (5 for knife/glove trade-ups)
- Output is **one rarity tier higher**
- Skins can be from **different collections** but must be same rarity
- StatTrak: all 10 must be StatTrak -> output is StatTrak
- Knife/Glove: 5 Covert skins from same collection -> 1 knife/glove

### Rarity Tiers (low to high)
Consumer (White) -> Industrial (Light Blue) -> Mil-Spec (Blue) -> Restricted (Purple) -> Classified (Pink) -> Covert (Red) -> Exceedingly Rare (Gold/Knives/Gloves)

### Probability Calculation (Weighted Ticket System)

```
Total_Tickets = SUM over each collection C:
  (inputs_from_C) * (outcomes_at_target_tier_in_C)

P(specific_outcome_S from collection_C) = inputs_from_C / Total_Tickets
```

**Example:**
- 7 skins from Collection A (has 2 Restricted outcomes)
- 3 skins from Collection B (has 1 Restricted outcome)
- Total Tickets = (7*2) + (3*1) = 17
- P(each A outcome) = 7/17 = 41.2%
- P(B outcome) = 3/17 = 17.6%

### Expected Value Formula

```
EV = SUM( P(outcome_i) * Price(outcome_i, predicted_float) )
Profit = EV - Total_Input_Cost
ROI = (EV - Total_Input_Cost) / Total_Input_Cost * 100%
```

---

## 2. APIs & Data Sources

### Primary: CSFloat API
- **Docs**: https://docs.csfloat.com/
- **Base**: `https://csfloat.com/api/v1`
- **Auth**: `Authorization: <API-KEY>` header (get key at csfloat.com/profile -> developer tab)
- **Prices in cents** (5000 = $50.00)

**Key Endpoints:**
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/listings` | No | All marketplace listings (max 50/page) |
| GET | `/listings/<ID>` | No | Specific listing |
| GET | `/schema` | No | Weapon pricing schema |
| GET | `/exchange-rates` | No | Currency rates |
| POST | `/buy-orders` | Yes | Create buy order |
| POST | `/buy-now` | Yes | Purchase listing |

**Listings filters:** `market_hash_name`, `min_float`, `max_float`, `min_price`, `max_price`, `rarity`, `collection`, `sort_by` (lowest_price, highest_price, most_recent, lowest_float, highest_float, best_deal), `category` (0=any, 1=normal, 2=stattrak, 3=souvenir), `limit` (max 50), `cursor`

**Client Libraries:**
- TypeScript: `npm install cs-float-api`
- Python: `pip install csfloat-api` (async, aiohttp-based)
- Rust: `csfloat-rs` on crates.io
- Go: `csfloat_go`

### Steam Community Market (Unofficial/Undocumented)
```
GET https://steamcommunity.com/market/priceoverview/?appid=730&market_hash_name=AK-47%20%7C%20Redline%20(Field-Tested)&currency=1
```
Response: `{ success, lowest_price, volume, median_price }`
Rate limit: ~200 req/5min, aggressive IP bans on abuse

### Skinport API (Free, No Auth for Prices)
- **Base**: `https://api.skinport.com/v1/`
- `GET /v1/items?app_id=730&currency=EUR` -- all items with min/max/mean/median prices
- `GET /v1/sales/history` -- aggregated sales (24h, 7d, 30d, 90d)
- **WebSocket**: `wss://skinport.com` -- real-time sale feed
- Rate: 8 req/5 min, must send `Accept-Encoding: br`

### Aggregators (Best for Multi-Market Pricing)
**Pricempire**: `https://api.pricempire.com/v4/paid/items/prices?app_id=730&sources=buff163,csfloat,skinport,steam&currency=USD`
- Auth: `Authorization: Bearer <API_KEY>`
- Sources: buff163, csfloat, skinport, steam, bitskins, dmarket, waxpeer, 20+ more
- Updates every 30s-2min

**CSGOSKINS.GG**: `https://csgoskins.gg/api/v1/prices`
- 31 marketplaces, 5-min cache
- Price histories up to 365 days

### DMarket API
- Swagger: https://docs.dmarket.com/v1/swagger.html
- Signature-based auth (NACL)
- `GET /exchange/v1/market/items` -- browse items
- `POST /marketplace-api/v1/aggregated-prices` -- pricing
- `GET /trade-aggregator/v1/last-sales` -- 12mo history

---

## 3. Skin Collection Data Sources

### ByMykel/CSGO-API (632 stars -- PRIMARY DATA SOURCE)
- **GitHub**: https://github.com/ByMykel/CSGO-API
- **Raw data URLs:**
  - `https://bymykel.github.io/CSGO-API/api/en/collections.json` -- all collections
  - `https://bymykel.github.io/CSGO-API/api/en/skins.json` -- all skins (grouped by weapon)
  - `https://bymykel.github.io/CSGO-API/api/en/skins_not_grouped.json` -- flat skin list

**Skin structure:**
```json
{
  "id": "string",
  "name": "AK-47 | Redline",
  "min_float": 0.10,
  "max_float": 0.70,
  "rarity": { "name": "Classified", "color": "#d32ce6" },
  "stattrak": true,
  "souvenir": false,
  "wears": [{ "name": "Field-Tested" }, { "name": "Well-Worn" }],
  "collections": [{ "name": "The Phoenix Collection" }]
}
```

**Collection structure:**
```json
{
  "id": "string",
  "name": "The Kilowatt Collection",
  "contains": [{ "id": "...", "name": "...", "rarity": {...} }],
  "image": "url"
}
```

### Other Data Sources
- **cs2-items-schema** (57 stars): https://github.com/somespecialone/cs2-items-schema -- auto-updates from game files, JSON + SQL
- **qwkdev/csapi** (33 stars): includes float-caps, doppler phases, inspect links
- **cs2-marketplace-ids**: buff163 + YouPin898 item IDs mapping

---

## 4. Existing Open-Source Projects

| Project | Stars | Language | Approach | Notes |
|---------|-------|----------|----------|-------|
| [CS-Trade-Up-Analyzer](https://github.com/keagan-b/CS-Trade-Up-Analyzer) | 16 | Python | Brute-force all combos | 3-phase pipeline, 64 threads, Discord bot |
| [tradeup-ninja](https://github.com/6matko/tradeup-ninja) | 20 | TypeScript | Web app | NestJS + Angular, Web Workers, IndexedDB |
| [csgo-tradeup-cli](https://github.com/StiliyanKushev/csgo-tradeup-cli) | 29 | JavaScript | Genetic algorithm | Worker threads, fastest convergence |
| [FloatTool](https://github.com/Prevter/FloatTool) | 15 | C# | Float targeting | 60M+ combos/sec, optimized math |
| [TradeLock](https://github.com/Velka-DEV/trade-lock) | 12 | Python | Automated buying | Integrates tradeupspy.com + Steam |

### Key Libraries
| Library | Stars | Language | Purpose |
|---------|-------|----------|---------|
| [steampy](https://github.com/bukson/steampy) | 662 | Python | Steam trading/market |
| [csfloat/inspect](https://github.com/csfloat/inspect) | 543 | Node.js | Float inspection service |
| [node-globaloffensive](https://github.com/DoctorMcKay/node-globaloffensive) | 339 | Node.js | CS2 Game Coordinator |
| [ByMykel/CSGO-API](https://github.com/ByMykel/CSGO-API) | 632 | JS | Skin/collection data |
| [awesome-cs2-trading](https://github.com/redlfox/awesome-cs2-trading) | -- | -- | Master resource list |

---

## 5. Recommended Architecture for Our Bot

### Tech Stack
- **Runtime**: Node.js / TypeScript (best ecosystem for CS2 APIs)
- **Database**: SQLite (local, no server needed) via better-sqlite3 or Drizzle ORM
- **CSFloat API**: `cs-float-api` npm package
- **Skin Data**: ByMykel/CSGO-API JSON (fetch on startup, cache locally)
- **Price Data**: CSFloat listings + Pricempire/Skinport for reference pricing
- **UI**: React + Vite (or Next.js) with TanStack Table for sorting/filtering

### Database Schema (Core Tables)
```sql
-- Static data (from ByMykel/CSGO-API)
collections (id, name, image_url)
skins (id, name, weapon, paint_index, min_float, max_float, rarity, stattrak, souvenir)
skin_collections (skin_id, collection_id)  -- many-to-many

-- Market data (from CSFloat/pricing APIs)
listings (id, skin_id, price_cents, float_value, paint_seed, stattrak, created_at, source)
price_history (skin_id, condition, avg_price, median_price, min_price, volume, updated_at, source)

-- Calculated trade-ups
trade_ups (
  id,
  total_cost_cents,
  expected_value_cents,
  profit_cents,
  roi_percentage,
  created_at
)
trade_up_inputs (trade_up_id, listing_id, skin_id, price_cents, float_value)
trade_up_outcomes (trade_up_id, skin_id, probability, predicted_float, predicted_condition, estimated_price_cents)
```

### Core Algorithm Pipeline
1. **Sync skin data** -- fetch collections.json + skins.json from ByMykel API
2. **Sync prices** -- pull CSFloat listings + reference prices from Skinport/Pricempire
3. **Generate trade-ups** -- for each rarity tier:
   a. Group available listings by collection
   b. For each combination of collections, calculate possible outcomes
   c. Calculate output float using the new normalized formula
   d. Look up output prices by predicted condition
   e. Calculate EV, profit, ROI
4. **Rank and filter** -- sort by profit $, ROI %, cheapest input cost, highest EV
5. **Display in UI** -- sortable/filterable table with trade-up details

### UI Features
- Sortable table columns: Profit ($), ROI (%), Total Cost, Expected Value, Cheapest Input, Most Expensive Output
- Expandable rows showing: 10 input skins with prices/floats, all possible outcomes with probabilities
- Filters: min profit, min ROI, max cost, rarity tier, specific collections
- Auto-refresh with configurable interval
- Click-to-buy links to CSFloat listings
