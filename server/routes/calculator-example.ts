import type pg from "pg";
import {
  EXAMPLE_FALLBACK_TYPE,
  EXAMPLE_REQUIRED_INPUTS,
  PREFERRED_EXAMPLE_TRADE_UP_ID,
  buildExamplePayload,
  exampleHasUsableListings,
  type CalculatorExampleListing,
  type CalculatorExamplePayload,
} from "../../shared/calculator-example.js";

interface ListingRow {
  skin_name: string;
  float_value: number;
  price_cents: number;
  weapon: string | null;
  rarity: string | null;
  min_float: number | null;
  max_float: number | null;
  collection_name: string;
}

async function loadCurrentListings(
  pool: pg.Pool,
  tradeUpId: number,
): Promise<CalculatorExampleListing[]> {
  const { rows } = await pool.query<ListingRow>(
    `SELECT tui.skin_name,
            l.float_value,
            l.price_cents,
            s.weapon,
            s.rarity,
            s.min_float,
            s.max_float,
            tui.collection_name
     FROM trade_up_inputs tui
     JOIN listings l ON l.id = tui.listing_id
     LEFT JOIN skins s ON s.id = tui.skin_id
     WHERE tui.trade_up_id = $1
       AND btrim(tui.skin_name) <> ''
     ORDER BY tui.listing_id`,
    [tradeUpId],
  );

  const listings: CalculatorExampleListing[] = [];
  for (const row of rows) {
    let weapon = row.weapon;
    let rarity = row.rarity;
    let minFloat = row.min_float;
    let maxFloat = row.max_float;

    if (weapon == null || rarity == null || minFloat == null || maxFloat == null) {
      const { rows: [skin] } = await pool.query<ListingRow>(
        `SELECT weapon, rarity, min_float, max_float
         FROM skins
         WHERE name = $1 AND stattrak = false
         LIMIT 1`,
        [row.skin_name],
      );
      weapon = weapon ?? skin?.weapon ?? "";
      rarity = rarity ?? skin?.rarity ?? "";
      minFloat = minFloat ?? skin?.min_float ?? 0;
      maxFloat = maxFloat ?? skin?.max_float ?? 1;
    }

    listings.push({
      skin_name: row.skin_name,
      float_value: Number(row.float_value),
      price_cents: Number(row.price_cents),
      weapon,
      rarity,
      min_float: Number(minFloat),
      max_float: Number(maxFloat),
      collection_name: row.collection_name,
    });
  }

  return listings;
}

async function findCheapestNamedClassifiedId(pool: pg.Pool): Promise<number | null> {
  const { rows } = await pool.query<{ id: number }>(
    `SELECT t.id
     FROM trade_ups t
     WHERE t.is_theoretical = false
       AND t.listing_status = 'active'
       AND t.type = $1
       AND EXISTS (
         SELECT 1 FROM trade_up_inputs tui
         WHERE tui.trade_up_id = t.id
           AND btrim(tui.skin_name) <> ''
       )
       AND (
         SELECT COUNT(*) FROM trade_up_inputs tui
         JOIN listings l ON l.id = tui.listing_id
         WHERE tui.trade_up_id = t.id
           AND btrim(tui.skin_name) <> ''
       ) >= $2
     ORDER BY t.total_cost_cents ASC, t.id ASC
     LIMIT 1`,
    [EXAMPLE_FALLBACK_TYPE, EXAMPLE_REQUIRED_INPUTS],
  );
  return rows[0]?.id ?? null;
}

export async function resolveCalculatorExample(
  pool: pg.Pool,
): Promise<CalculatorExamplePayload | null> {
  const preferredListings = await loadCurrentListings(pool, PREFERRED_EXAMPLE_TRADE_UP_ID);
  if (exampleHasUsableListings(preferredListings)) {
    return buildExamplePayload({
      tradeUpId: PREFERRED_EXAMPLE_TRADE_UP_ID,
      usedFallback: false,
      listings: preferredListings,
    });
  }

  const fallbackId = await findCheapestNamedClassifiedId(pool);
  if (fallbackId == null) return null;

  const fallbackListings = await loadCurrentListings(pool, fallbackId);
  if (!exampleHasUsableListings(fallbackListings)) return null;

  return buildExamplePayload({
    tradeUpId: fallbackId,
    usedFallback: true,
    listings: fallbackListings,
  });
}
