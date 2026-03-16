# CS2 Trade-Up Bot

Finds profitable CS2 trade-up contracts by analyzing market data from CSFloat, DMarket, and Skinport.

## How It Works

CS2 trade-up contracts let you trade 10 skins of one rarity for 1 skin of the next rarity (or 5 Covert skins for 1 knife/glove). The output float is deterministic: `outFloat = outMin + avg(normalized_inputs) × (outMax - outMin)`. The bot:

1. **Fetches listings** continuously from CSFloat (API) and DMarket (2 RPS fetcher)
2. **Evaluates combinations** across collections at ~45 float targets per combo
3. **Calculates EV** from all possible outcomes weighted by collection probability
4. **Finds profitable trade-ups** where EV exceeds cost after marketplace fees

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌────────────────┐
│   Frontend   │────▶│  Express API │────▶│  SQLite (WAL)  │
│  React/Vite  │     │  port 3001   │     │  tradeup.db    │
│  port 5173   │     └──────────────┘     └────────────────┘
└─────────────┘              ▲                     ▲
                             │              ┌──────┴───────┐
                    ┌────────┴────────┐     │   DMarket    │
                    │     Daemon      │     │   Fetcher    │
                    │  10-min cycles  │     │  2 RPS cont. │
                    │  5 workers      │     └──────────────┘
                    └─────────────────┘
```

### Project Structure

```
server/
├── engine/              # Trade-up math + discovery (barrel: engine.ts)
│   ├── core.ts          # Float calculation, probability math
│   ├── pricing.ts       # Multi-source price cache (CSFloat-primary)
│   ├── knn-pricing.ts   # KNN float-precise pricing for knife/glove outputs
│   ├── discovery.ts     # Generic rarity discovery (all tiers)
│   ├── knife-discovery.ts   # Knife/glove discovery with condition targeting
│   ├── evaluation.ts    # EV for gun trade-ups
│   ├── knife-evaluation.ts  # EV for knife trade-ups (Doppler phase expansion)
│   ├── selection.ts     # Float-targeted listing selection strategies
│   ├── store.ts         # Diversity-controlled result deduplication
│   ├── rarity-tiers.ts  # Config-driven tier definitions
│   ├── staircase.ts     # 2-stage staircase (Classified→Covert→Knife)
│   ├── fees.ts          # Per-marketplace fee calculations
│   ├── db-ops.ts        # Merge-save, revival, trimming
│   └── knife-data.ts    # Knife/glove constants, Doppler phases
├── daemon-knife/        # Daemon loop
│   ├── index.ts         # Main loop, worker spawning
│   ├── phases/          # Per-phase logic
│   ├── calc-worker.ts   # Child process for parallel discovery (NDJSON IPC)
│   ├── loops.ts         # Cooldown: staleness + random exploration
│   └── state.ts         # Budget pacing, rate limit tracking
├── sync/                # Data fetchers (barrel: sync.ts)
│   ├── csfloat.ts       # CSFloat listing search
│   ├── dmarket.ts       # DMarket listings
│   ├── sales.ts         # CSFloat sale history
│   └── skinport-ws.ts   # Skinport WebSocket (passive)
├── routes/              # Express API routes
├── dmarket-fetcher.ts   # Standalone continuous DMarket fetcher
└── db.ts                # SQLite schema + migrations

src/                     # React frontend
├── App.tsx              # Routing, nav, status bar
├── pages/               # TradeUpsPage, CalculatorPage
└── components/          # TradeUpTable, DataViewer, DaemonModal, etc.

shared/types.ts          # Shared TypeScript types
```

## Trade-Up Types

| Type | Inputs | Output |
|------|--------|--------|
| Knife/Glove | 5 Covert guns | 1 Knife or Gloves |
| Classified→Covert | 10 Classified | 1 Covert gun |
| Restricted→Classified | 10 Restricted | 1 Classified |
| Mil-Spec→Restricted | 10 Mil-Spec | 1 Restricted |
| Industrial→Mil-Spec | 10 Industrial Grade | 1 Mil-Spec |
| Staircase | 50 Classified | 5 Covert → 1 Knife |

## Daemon Cycle (10-min target)

1. **Housekeeping** — purge stale data, refresh listing statuses
2. **API Probe** — check CSFloat rate limit pools (3 independent pools)
3. **Data Fetch** — sale history + CSFloat listings (Covert + Extraordinary only)
4. **Parallel Discovery** — 5 worker processes (knife, classified, restricted, milspec, industrial)
5. **Staircase** — build 2-stage chains from classified trade-ups
6. **Cooldown** — staleness checks + random exploration + revival

CSFloat budget goes 100% to Covert inputs + Extraordinary outputs. DMarket fetcher handles all lower rarities at 2 RPS continuously.

## Setup

```bash
npm install
cp .env.example .env
# Add API keys to .env:
#   CSFLOAT_API_KEY=...
#   DMARKET_PUBLIC_KEY=...
#   DMARKET_SECRET_KEY=...

# Start all processes:
npx tsx watch server/index.ts              # API server (port 3001)
npm run dev                                 # Frontend (port 5173)
NODE_OPTIONS="--max-old-space-size=8192" npx tsx server/daemon.ts   # Daemon
npx tsx server/dmarket-fetcher.ts           # DMarket fetcher (2 RPS)
```

## Pricing

**Output pricing** (sell side) — CSFloat-primary, conservative:
- CSFloat sale history → DMarket/Skinport floor (gap-fill) → CSFloat ref → KNN float-precise (★ items)

**Input pricing** (buy side) — actual listing prices + marketplace fees:
- CSFloat: 2.8% + $0.30 deposit | DMarket: 2.5% | Skinport: 0%

**Seller fees** deducted from outputs: CSFloat 2% | DMarket 2% | Skinport 12%

## Technical Details

- **Float formula**: `outFloat = outMin + avg((inFloat - inMin)/(inMax - inMin)) × (outMax - outMin)` — fully deterministic
- **Probability**: weighted by input collection representation
- **Prices**: integer cents throughout (no floating point for money)
- **DB**: SQLite WAL mode, ~2GB. 50K cap per type with composite score trimming.
- **Workers**: `child_process.fork()` with NDJSON temp file IPC (avoids V8 string limits)
- **Discovery**: ~45 float targets per knife combo, condition-pure groups, per-skin combos, value-sorted selection
- **Chance-to-profit**: first-class metric — trade-ups with >25% chance kept even if EV-negative
