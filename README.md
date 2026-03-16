# CS2 Trade-Up Bot

Automated CS2 trade-up contract analyzer. Finds profitable trade-ups across all rarity tiers by combining market data from CSFloat, DMarket, and Skinport.

## What It Does

CS2 trade-up contracts let you trade 10 gun skins of one rarity for 1 gun skin of the next rarity (or 5 Covert skins for 1 knife/glove). The output skin's float (wear) is deterministic based on input floats. The bot:

1. **Fetches listings** from CSFloat and DMarket marketplaces
2. **Evaluates every combination** of inputs across collections, targeting specific output float values
3. **Calculates expected value** accounting for all possible outcomes weighted by probability
4. **Finds profitable trade-ups** where EV > total input cost (after marketplace fees)
5. **Tracks theories** — pre-screens combos before spending API budget to fetch their listings
6. **Builds multi-step staircases** — chains of trade-ups (e.g., 100 cheap Restricted skins → 10 Classified → 1 expensive Covert)

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌────────────────┐
│   Frontend   │────▶│  Express API │────▶│  SQLite (WAL)  │
│  React/Vite  │     │  port 3001   │     │  tradeup.db    │
│  port 5173   │     └──────────────┘     └────────────────┘
└─────────────┘              ▲                     ▲
                             │              ┌──────┴───────┐
                    ┌────────┴────────┐     │              │
                    │     Daemon      │     │   DMarket    │
                    │  Multi-phase    │     │   Fetcher    │
                    │  20-min cycles  │     │  2 RPS cont. │
                    └─────────────────┘     └──────────────┘
```

### Key Directories

```
server/
├── engine/              # Trade-up math, pricing, discovery (barrel: engine.ts)
│   ├── core.ts          # Float calculation, probability math
│   ├── pricing.ts       # Multi-source price cache (CSFloat/DMarket/Skinport)
│   ├── discovery.ts     # Generic rarity discovery engine
│   ├── knife-discovery.ts  # Knife/glove specific discovery
│   ├── evaluation.ts    # EV calculation for gun trade-ups
│   ├── knife-evaluation.ts # EV calculation for knife trade-ups
│   ├── rarity-tiers.ts  # Config-driven tier system
│   ├── staircase-generic.ts # Multi-step staircase chains
│   └── db-ops.ts        # Save/merge/revive trade-ups
├── daemon-knife/        # Daemon loop
│   ├── index.ts         # Main loop, worker spawning
│   ├── phases/          # Per-phase logic (split from monolithic phases.ts)
│   │   ├── housekeeping.ts
│   │   ├── theory.ts
│   │   ├── data-fetch.ts
│   │   ├── knife-calc.ts
│   │   └── classified-calc.ts
│   ├── calc-worker.ts   # Child process for parallel discovery
│   └── state.ts         # Budget tracking, rate limit pacing
├── sync/                # Data fetchers (barrel: sync.ts)
│   ├── csfloat.ts       # CSFloat listing search
│   ├── dmarket.ts       # DMarket listings + buy API
│   ├── sales.ts         # CSFloat sale history
│   ├── skinport-ws.ts   # Skinport WebSocket (passive)
│   └── wanted.ts        # Theory-guided targeted fetching
├── routes/              # Express API routes
├── dmarket-fetcher.ts   # Standalone continuous DMarket fetcher
└── db.ts                # SQLite schema + connection

src/                     # React frontend
├── App.tsx              # Routing, nav, status bar
├── pages/               # Route pages
└── components/          # UI components

shared/
├── types.ts             # Shared TypeScript interfaces
└── caseData.ts          # Case → collection → knife mappings
```

## Trade-Up Types

| Type | Formula | Example |
|------|---------|---------|
| Knife/Glove | 5 Covert → 1 ★ | 5× M4A4 Buzz Kill → 1× Butterfly Knife Fade |
| Classified→Covert | 10 Classified → 1 Covert | 10× AUG Syd Mead → 1× AK-47 Asiimov |
| Restricted→Classified | 10 Restricted → 1 Classified | 10× P2000 Space Race → 1× AK-47 Crane Flight |
| Mil-Spec→Restricted | 10 Mil-Spec → 1 Restricted | 10× Galil AR Metallic Squeezer → 1× M4A1-S Electrum |
| Staircase RC | 100 R → 10 C → 1 Cv | Chain of trade-ups producing a Covert |
| Staircase RCK | 500 R → 50 C → 5 Cv → 1 K | Chain producing a Knife/Glove |

## Daemon Cycle (20-min target)

1. **Housekeeping** — purge stale data, refresh listing statuses
2. **Theory** — pre-screen combos using pricing models (knife, classified, restricted, milspec)
3. **API Probe** — check CSFloat rate limit pools
4. **Data Fetch** — sale history, listings, DMarket coverage, wanted list
5. **Parallel Discovery** — 5 worker processes find trade-ups simultaneously
6. **Materialization** — validate theories with real listing data
7. **Staircase Evaluation** — build multi-step chains from existing trade-ups
8. **Cooldown** — staleness checks using individual lookup pool

## Setup

```bash
npm install
cp .env.example .env
# Add CSFLOAT_API_KEY, DMARKET_PUBLIC_KEY, DMARKET_SECRET_KEY to .env
```

## Data Sources

- **CSFloat** — primary marketplace. Listings, sale history, ref prices. Auth required.
- **DMarket** — secondary marketplace. Listings (commodity skins), purchase API. Auth required.
- **Skinport** — passive WebSocket feed. Listings + sale events for price observations. No auth.

## Key Technical Details

- **Float formula**: `outputFloat = outMin + avg((inFloat - inMin)/(inMax - inMin)) × (outMax - outMin)` — fully deterministic
- **Probability**: weighted by input collection representation (e.g., 3 from Collection A + 2 from Collection B = 60%/40% chance)
- **Price values**: stored as integer cents throughout
- **DB**: SQLite with WAL mode for concurrent access. 12GB+ with 45M+ outcome rows (optimization planned).
- **Workers**: child_process.fork() with NDJSON temp file IPC (avoids V8 string limits on large result sets)
