import pg from "pg";

interface VerifyResult {
  listing_id: string;
  status: "active" | "sold" | "delisted" | "error";
  current_price?: number;
  original_price: number;
}

export async function verifyTradeUpListings(
  pool: pg.Pool,
  tradeUpId: number,
  apiKey: string,
): Promise<VerifyResult[]> {
  // Load inputs
  const { rows: inputs } = await pool.query(
    "SELECT listing_id, skin_name, price_cents, source FROM trade_up_inputs WHERE trade_up_id = $1",
    [tradeUpId],
  );

  const results: VerifyResult[] = [];

  for (const input of inputs) {
    if (input.listing_id.startsWith("theor") || input.listing_id.startsWith("theory")) {
      results.push({ listing_id: input.listing_id, status: "active", original_price: input.price_cents });
      continue;
    }

    // Only verify CSFloat listings via API
    if (!input.source || input.source === "csfloat") {
      try {
        const resp = await fetch(`https://csfloat.com/api/v1/listings/${input.listing_id}`, {
          headers: { Authorization: apiKey },
        });

        if (resp.status === 404) {
          results.push({ listing_id: input.listing_id, status: "sold", original_price: input.price_cents });
        } else if (resp.ok) {
          const data = await resp.json();
          const state = data.state || "listed";
          results.push({
            listing_id: input.listing_id,
            status: state === "listed" ? "active" : "sold",
            current_price: data.price,
            original_price: input.price_cents,
          });
        } else {
          results.push({ listing_id: input.listing_id, status: "error", original_price: input.price_cents });
        }
      } catch {
        results.push({ listing_id: input.listing_id, status: "error", original_price: input.price_cents });
      }
    } else {
      // DMarket, Skinport, Buff — assume active (can't check per-listing)
      results.push({ listing_id: input.listing_id, status: "active", original_price: input.price_cents });
    }
  }

  return results;
}
