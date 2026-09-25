#!/usr/bin/env tsx
/**
 * Synthetic browse fixture for reproducing scroll / rate-limit behaviour locally.
 *
 * Layers fake listings and active trade-ups over the local skin catalog
 * (skins / collections / skin_collections) so the board, /skins index, skin
 * pages, and collections hub can be scrolled for minutes. Prices, floats, and
 * outcomes are generated — nothing here is real market data.
 *
 *   npx tsx scripts/seed-browse-fixture.ts
 *
 * Refuses to run when NODE_ENV=production, when the catalog is empty, or when
 * listings / trade_ups already hold rows, so it cannot touch a live database.
 */
import pg from "pg";

const RARITIES = ["Consumer Grade", "Industrial Grade", "Mil-Spec", "Restricted", "Classified", "Covert"] as const;
const TYPE_BY_INPUT: Record<string, string> = {
  "Consumer Grade": "consumer_industrial",
  "Industrial Grade": "industrial_milspec",
  "Mil-Spec": "milspec_restricted",
  "Restricted": "restricted_classified",
  "Classified": "classified_covert",
};
const BASE_PRICE: Record<string, number> = {
  "Consumer Grade": 8, "Industrial Grade": 25, "Mil-Spec": 90, "Restricted": 450, "Classified": 2200, "Covert": 9000,
};
const SOURCES = ["csfloat", "dmarket", "skinport"];
const LISTINGS_PER_SKIN = 12;
const TRADE_UPS = 2400;

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}
const rand = rng(20260924);
const pick = <T>(list: readonly T[]): T => list[Math.floor(rand() * list.length)];

function condition(f: number): string {
  if (f < 0.07) return "Factory New";
  if (f < 0.15) return "Minimal Wear";
  if (f < 0.38) return "Field-Tested";
  if (f < 0.45) return "Well-Worn";
  return "Battle-Scarred";
}

async function insertRows(pool: pg.Pool, table: string, columns: string[], rows: unknown[][]): Promise<void> {
  const chunk = Math.floor(60000 / columns.length);
  for (let i = 0; i < rows.length; i += chunk) {
    const slice = rows.slice(i, i + chunk);
    const values = slice.map((_, r) => `(${columns.map((__, c) => `$${r * columns.length + c + 1}`).join(",")})`).join(",");
    await pool.query(`INSERT INTO ${table} (${columns.join(",")}) VALUES ${values}`, slice.flat());
  }
}

type Skin = { id: string; name: string; rarity: string; min_float: number; max_float: number; collection: string | null };
type Listing = { id: string; skin: Skin; price: number; float: number; source: string };

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to seed with NODE_ENV=production");
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL || "postgresql://localhost:5432/tradeupbot" });
  const { rows: [counts] } = await pool.query(
    `SELECT (SELECT COUNT(*) FROM trade_ups)::int AS tu, (SELECT COUNT(*) FROM listings)::int AS listings,
            (SELECT COUNT(*) FROM skins)::int AS skins`,
  );
  if (counts.skins === 0) throw new Error("Skin catalog is empty — load skins/collections first");
  if (counts.tu > 0 || counts.listings > 0) {
    throw new Error(`Refusing to seed over existing data (${counts.tu} trade-ups, ${counts.listings} listings)`);
  }

  const { rows: skins } = await pool.query<Skin>(`
    SELECT s.id, s.name, s.rarity, s.min_float, s.max_float, MIN(c.name) AS collection
    FROM skins s
    LEFT JOIN skin_collections sc ON sc.skin_id = s.id
    LEFT JOIN collections c ON c.id = sc.collection_id
    WHERE s.stattrak = false
    GROUP BY s.id, s.name, s.rarity, s.min_float, s.max_float
  `);

  const listingsBySkin = new Map<string, Listing[]>();
  const listingRows: unknown[][] = [];
  for (const skin of skins) {
    const base = skin.name.startsWith("★") ? 45000 : (BASE_PRICE[skin.rarity] ?? 500);
    const list: Listing[] = [];
    for (let n = 0; n < LISTINGS_PER_SKIN; n++) {
      const span = Math.max(0.001, skin.max_float - skin.min_float);
      const float = Math.round((skin.min_float + rand() * span) * 1e6) / 1e6;
      const price = Math.max(3, Math.round(base * (0.7 + rand() * 0.8)));
      const listing = { id: `fx-l-${skin.id}-${n}`, skin, price, float, source: pick(SOURCES) };
      list.push(listing);
      listingRows.push([listing.id, skin.id, price, float, false, listing.source]);
    }
    listingsBySkin.set(skin.id, list);
  }
  await insertRows(pool, "listings", ["id", "skin_id", "price_cents", "float_value", "stattrak", "source"], listingRows);

  const byCollectionRarity = new Map<string, Skin[]>();
  for (const skin of skins) {
    if (!skin.collection || skin.name.startsWith("★")) continue;
    const key = `${skin.collection}|${skin.rarity}`;
    byCollectionRarity.set(key, [...(byCollectionRarity.get(key) ?? []), skin]);
  }
  const plans = [...byCollectionRarity.keys()].flatMap((key) => {
    const [collection, rarity] = key.split("|");
    const index = RARITIES.indexOf(rarity as (typeof RARITIES)[number]);
    if (index < 0 || index >= RARITIES.length - 1) return [];
    const outputs = byCollectionRarity.get(`${collection}|${RARITIES[index + 1]}`);
    return outputs?.length ? [{ collection, inputRarity: rarity, inputs: byCollectionRarity.get(key) ?? [], outputs }] : [];
  });
  if (plans.length === 0) throw new Error("Catalog has no collection with adjacent rarity tiers");

  const tuColumns = [
    "total_cost_cents", "expected_value_cents", "profit_cents", "roi_percentage", "chance_to_profit", "type",
    "best_case_cents", "worst_case_cents", "is_theoretical", "listing_status", "outcomes_json",
    "output_skin_names", "collection_names", "input_sources",
  ];
  const tuRows: unknown[][] = [];
  const inputPlans: Listing[][] = [];
  for (let t = 0; t < TRADE_UPS; t++) {
    const plan = pick(plans);
    const inputs = Array.from({ length: 10 }, () => pick(listingsBySkin.get(pick(plan.inputs).id) ?? []));
    const cost = inputs.reduce((sum, l) => sum + l.price, 0);
    const outputRarity = RARITIES[RARITIES.indexOf(plan.inputRarity as (typeof RARITIES)[number]) + 1];
    const outcomes = plan.outputs.map((skin) => {
      const predictedFloat = Math.round((skin.min_float + rand() * 0.4 * (skin.max_float - skin.min_float)) * 1e4) / 1e4;
      return {
        skin_id: skin.id,
        skin_name: skin.name,
        collection_name: plan.collection,
        probability: 1 / plan.outputs.length,
        predicted_float: predictedFloat,
        predicted_condition: condition(predictedFloat),
        estimated_price_cents: Math.round(cost * (0.5 + rand() * 1.1)),
      };
    });
    const ev = Math.round(outcomes.reduce((sum, o) => sum + o.probability * o.estimated_price_cents, 0));
    const profit = ev - cost;
    const pnl = outcomes.map((o) => o.estimated_price_cents - cost);
    const chance = outcomes.filter((o) => o.estimated_price_cents > cost).reduce((s, o) => s + o.probability, 0);
    tuRows.push([
      cost, ev, profit, Math.round((profit / cost) * 10000) / 100, chance, TYPE_BY_INPUT[plan.inputRarity],
      Math.max(...pnl), Math.min(...pnl), false, "active", JSON.stringify(outcomes),
      outcomes.map((o) => o.skin_name), [plan.collection], [...new Set(inputs.map((l) => l.source))],
    ]);
    inputPlans.push(inputs);
  }

  const inserted: number[] = [];
  for (let i = 0; i < tuRows.length; i += 500) {
    const slice = tuRows.slice(i, i + 500);
    const values = slice
      .map((_, r) => `(${tuColumns.map((__, c) => `$${r * tuColumns.length + c + 1}`).join(",")}, NOW() - INTERVAL '4 hours')`)
      .join(",");
    const { rows } = await pool.query(
      `INSERT INTO trade_ups (${tuColumns.join(",")}, created_at) VALUES ${values} RETURNING id`,
      slice.flat(),
    );
    inserted.push(...rows.map((row: { id: number }) => row.id));
  }

  const inputRows: unknown[][] = [];
  inserted.forEach((id, i) => {
    for (const l of inputPlans[i]) {
      inputRows.push([id, l.id, l.skin.id, l.skin.name, l.skin.collection, l.price, l.float, condition(l.float), l.source]);
    }
  });
  await insertRows(pool, "trade_up_inputs",
    ["trade_up_id", "listing_id", "skin_id", "skin_name", "collection_name", "price_cents", "float_value", "condition", "source"],
    inputRows);

  console.log(`Seeded ${listingRows.length} listings and ${inserted.length} trade-ups over ${skins.length} catalog skins`);
  await pool.end();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
