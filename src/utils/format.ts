/** Shared formatting utilities */

export function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  // DB stores UTC without "Z" suffix — append it for correct parsing
  const ts = typeof iso === "string" && !iso.endsWith("Z") && !iso.includes("+")
    ? iso.replace(" ", "T") + "Z"
    : iso;
  const diff = Date.now() - new Date(ts).getTime();
  if (diff < 0) return "now";
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function formatDollars(cents: number): string {
  const val = cents / 100;
  return val >= 0 ? `$${val.toFixed(2)}` : `-$${Math.abs(val).toFixed(2)}`;
}

export function condAbbr(condition: string): string {
  const map: Record<string, string> = {
    "Factory New": "FN",
    "Minimal Wear": "MW",
    "Field-Tested": "FT",
    "Well-Worn": "WW",
    "Battle-Scarred": "BS",
  };
  return map[condition] ?? condition;
}

export function formatResetTime(resetAt: number | null): string {
  if (!resetAt) return "";
  const secsLeft = Math.max(0, Math.round(resetAt - Date.now() / 1000));
  if (secsLeft <= 0) return "now";
  if (secsLeft < 60) return `${secsLeft}s`;
  if (secsLeft < 3600) return `${Math.floor(secsLeft / 60)}m`;
  const h = Math.floor(secsLeft / 3600);
  const m = Math.floor((secsLeft % 3600) / 60);
  return `${h}h${m > 0 ? `${m}m` : ""}`;
}

export function csfloatListingUrl(listingId: string): string {
  return `https://csfloat.com/item/${listingId}`;
}

export function csfloatSearchUrl(skinName: string, condition?: string): string {
  const query = condition ? `${skinName} (${condition})` : skinName;
  return `https://csfloat.com/search?market_hash_name=${encodeURIComponent(query)}`;
}

/** Get the marketplace source from a listing ID (prefixed format) or explicit source field */
export function listingSource(listingId: string, source?: string): "csfloat" | "dmarket" | "skinport" | "buff" {
  if (source === "buff") return "buff";
  if (listingId.startsWith("dmarket:")) return "dmarket";
  if (listingId.startsWith("skinport:")) return "skinport";
  return "csfloat";
}

/** Source-aware listing URL — routes to the correct marketplace with float/price filters.
 *  priceCents is the EFFECTIVE cost (with buyer fees). The URL uses the ORIGINAL listing
 *  price (without fees) so price filters target the exact listing on the marketplace. */
export function listingUrl(listingId: string, skinName?: string, condition?: string, floatValue?: number, priceCents?: number, sourceHint?: string, marketplaceId?: string, stattrak?: boolean): string {
  const source = listingSource(listingId, sourceHint);
  if (source === "buff") {
    // Buff can't deep-link to a specific listing — link to the goods page
    if (marketplaceId) return `https://buff.market/market/goods/${marketplaceId}`;
    return `https://buff.market/market/csgo`;
  }
  if (source === "dmarket") {
    // DMarket: skip price filter (prices change frequently).
    // Float has 3-digit precision — floor/ceil at 3rd decimal to bracket the exact listing.
    // e.g. float 0.2819 → floatValueFrom=0.281, floatValueTo=0.282
    const params = new URLSearchParams({ title: skinName ?? "" });
    params.set("category_0", stattrak ? "stattrak_tm" : "not_stattrak_tm");
    if (floatValue !== undefined && floatValue > 0) {
      const lower = Math.floor(floatValue * 1000) / 1000;
      const upper = lower + 0.001;
      params.set("floatValueFrom", lower.toFixed(3));
      params.set("floatValueTo", upper.toFixed(3));
    }
    return `https://dmarket.com/ingame-items/item-list/csgo-skins?${params.toString()}`;
  }
  if (source === "skinport") {
    // Skinport: tight float range (±0.002) and non-StatTrak filter
    // Skinport has 0% buyer fee — priceCents IS the listing price
    const query = condition ? `${skinName} (${condition})` : (skinName ?? "");
    const params = new URLSearchParams({ search: query, type: "default" });
    if (floatValue !== undefined && floatValue > 0) {
      params.set("float_min", Math.max(0, floatValue - 0.002).toFixed(4));
      params.set("float_max", Math.min(1, floatValue + 0.002).toFixed(4));
    }
    if (priceCents !== undefined && priceCents > 0) {
      params.set("pricegt", String(Math.max(0, priceCents - 100)));
      params.set("pricelt", String(priceCents + 100));
    }
    return `https://skinport.com/market?${params.toString()}`;
  }
  return csfloatListingUrl(listingId);
}

/** Short label for source badge */
export function sourceLabel(source: string): string {
  if (source === "dmarket") return "DM";
  if (source === "skinport") return "SP";
  if (source === "buff") return "BUFF";
  return "CF";
}

/** Badge color for source */
export function sourceColor(source: string): string {
  if (source === "dmarket") return "#4f8cff";
  if (source === "skinport") return "#f5a623";
  if (source === "buff") return "#e85d04";
  return "#22c55e";
}

export function conditionColor(float: number): string {
  if (float < 0.07) return "#22c55e";
  if (float < 0.15) return "#60a5fa";
  if (float < 0.38) return "#f59e0b";
  if (float < 0.45) return "#f97316";
  return "#ef4444";
}

export function conditionLabel(float: number): string {
  if (float < 0.07) return "FN";
  if (float < 0.15) return "MW";
  if (float < 0.38) return "FT";
  if (float < 0.45) return "WW";
  return "BS";
}
