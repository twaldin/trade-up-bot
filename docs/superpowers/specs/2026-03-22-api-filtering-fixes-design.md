# API Filtering & Search Fixes Design

## Overview

Fix broken skin/collection filtering across FilterBar, DataViewer, and collection pages. Redesign market filter UX. Optimize slow SQL queries.

## 1. FilterBar Autocomplete Fix

**Root cause**: `/api/filter-options` silently returns empty arrays when Redis misses and the DB fallback fails. `AutocompleteInput` has no items to render.

### Changes

**`/api/filter-options` endpoint** (`server/routes/trade-ups.ts`):
- Add output skins: parse `outcomes_json` from active trade-ups, extract `skin_name`, merge with input skins.
- Each skin entry: `{ name: string, input: boolean, output: boolean }`. A skin appearing as both gets `input: true, output: true`.
- Ensure daemon pre-populates `filter_opts` Redis cache every cycle.
- DB fallback must handle errors gracefully (currently swallows silently).

**`AutocompleteInput` component** (`src/components/FilterBar.tsx`):
- Search normalization: strip `★` and `|` from both query and item labels before matching. Display original full names.
- Dropdown selection only — no Enter key behavior. Enter does nothing.
- Sublabels: skins show "input", "output", or "input & output". Collections show trade-up count.

**`/api/trade-ups` filter logic** (`server/routes/trade-ups.ts`):
- Wire format unchanged: skins joined by `||`, collections by `|` in URL params. Backend parsing changes from OR to AND semantics.
- Multiple skins: AND logic. Each selected skin generates its own subquery checking both `trade_up_inputs.skin_name` and `outcomes_json LIKE`. Trade-up must match ALL selected skins.
- Multiple collections: AND logic. Each selected collection generates its own `trade_up_inputs.collection_name` subquery. Trade-up must involve ALL selected collections.
- Single skin/collection: unchanged behavior (matches inputs or outputs).
- Note: this is a semantic change. Bookmarked URLs with multiple skins will go from OR to AND, which may return fewer/zero results. This is the intended behavior per requirements.

**DB skin name format**: The database stores full names verbatim including `★` and `|` (e.g., `★ Bayonet | Fade`). The selected value from the autocomplete is the full original name, which matches the DB exactly. Normalization only applies to the search/matching step, not the stored filter value.

## 2. DataViewer Server-Side Search

**Root cause**: Autocomplete only searches 200 skins loaded in memory. Skins outside that set are invisible to autocomplete.

### Changes

**New endpoint `GET /api/skin-suggestions`** (`server/routes/data.ts`):
- Query param: `q` (min 2 chars).
- Query: `SELECT s.name, s.weapon, s.rarity, STRING_AGG(DISTINCT c.name, ',') as collection_name FROM skins s LEFT JOIN skin_collections sc ON s.id = sc.skin_id LEFT JOIN collections c ON sc.collection_id = c.id WHERE <normalized_match> AND s.stattrak = false GROUP BY s.name, s.weapon, s.rarity ORDER BY s.rarity DESC, s.name ASC LIMIT 15`. The LEFT JOINs are lightweight since the result set is small (LIMIT 15). Sort by rarity descending (Covert first) then alphabetical — avoids the expensive listing count subquery while keeping results useful.
- Search normalization: strip `★` and `|` from matching. User types "bayonet fade" → matches "★ Bayonet | Fade".
- For knife/glove skins (no `skin_collections` rows), `collection_name` will be null — the frontend can handle this gracefully.
- Response: `{ results: [{ name, weapon, rarity, collection_name }] }`.
- Redis cached 60s by query.

**DataViewer search** (`src/components/DataViewer.tsx`):
- Replace client-side suggestion filtering with debounced (250ms) server calls to `/api/skin-suggestions?q=X`.
- Min 2 chars to trigger.
- On selecting a suggestion: set as `appliedSearch` → triggers full `/api/skin-data?search=X` fetch.
- Remove the `skins.filter(...)` suggestion logic entirely.

## 3. Collection Knife/Glove Display

**Root cause**: Knives aren't in `skin_collections` table. `outputCollection` lookup in `collectionKnifePool` fails silently when collection names don't match `CASE_KNIFE_MAP` keys → unfiltered query returns all skins.

### Changes

**All tab includes knives** (`server/routes/data.ts`):
- When `rarity` is "all" (or empty) and `collectionFilter` is set: check if the collection exists in `collectionKnifePool`. If yes, run two queries — the existing `skin_collections` query for regular skins, plus an `outputCollection`-style query for the collection's knife/glove pool. Merge results in JS (concat arrays). If the collection is NOT in `collectionKnifePool` (e.g., "The Inferno Collection"), skip the knife query entirely — only regular skins returned.
- All skins on the collection page must belong to that collection/case. No unfiltered leakage.
- Sort merged results: knives/gloves (`★` prefix) first, then by listing_count descending.

**Knife/Glove tab fix**:
- When `outputCollection` lookup returns no `poolData`, return empty array instead of running unfiltered query.
- Add server-side logging when a collection claims knives but isn't in `CASE_KNIFE_MAP`.

**Sort order**:
- Knives/gloves (`★` prefix) sorted first descending in API responses and frontend `SkinList`.

**Collection name matching**:
- Verify DB collection names match `CASE_KNIFE_MAP` keys exactly by running a comparison query at startup or in tests.
- If mismatches exist: update `CASE_KNIFE_MAP` keys to match the DB (the DB names come from the authoritative ByMykel API, so they're canonical).

## 4. Market Filter Redesign

**Current**: Inline checkboxes next to autocomplete inputs.

### Changes

**New `MarketFilter` component** (`src/components/FilterBar.tsx`):
- Pill/popover matching RangeFilter pattern.
- Default: pill shows "Market any".
- Active: "Market CSFloat" or "Market CSFloat, DMarket" with blue highlight.
- Popover: checkboxes for each market + Clear button.
- Click outside to dismiss.
- Remove the existing inline market checkboxes. `FilterChips` no longer renders a separate markets chip — market state is exclusively managed by the new pill.

## 5. Performance Optimization

### Index additions (verify via `EXPLAIN ANALYZE`):
- `trade_up_inputs(skin_name)` — for DISTINCT and filter queries.
- `trade_up_inputs(collection_name)` — for GROUP BY and filter queries.
- `trade_up_inputs(skin_name, trade_up_id)` — for AND-logic multi-skin subqueries (skin_name as leading column since it's the equality predicate).
- `listings(skin_id, stattrak)` — for skin-data JOIN.
- `skin_collections(skin_id)` — for collection filter subquery.

### Cache tuning:
- `/api/skin-data` Redis TTL: 120s → 300s.
- `/api/filter-options`: ensure daemon pre-populates every cycle in the post-cycle hook (see `server/daemon/` for cycle lifecycle). DB fallback is safety net only.
- `/api/skin-suggestions`: 60s TTL.

### Query optimization:
- `/api/skin-data`: audit `STRING_AGG(DISTINCT)` and `COUNT(DISTINCT)` cost. Consider pre-computed listing counts if needed.
- `/api/trade-ups` outcome matching: `outcomes_json LIKE` cannot use indexes. Acceptable short-term since other WHERE clauses narrow the scan. Long-term: consider `trade_up_outcomes` table.
- General: run `EXPLAIN ANALYZE` on heaviest paths, add missing indexes.
