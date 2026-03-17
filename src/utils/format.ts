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

/** Get the marketplace source from a listing ID (prefixed format) */
export function listingSource(listingId: string): "csfloat" | "dmarket" | "skinport" {
  if (listingId.startsWith("dmarket:")) return "dmarket";
  if (listingId.startsWith("skinport:")) return "skinport";
  return "csfloat";
}

/** Source-aware listing URL — routes to the correct marketplace with float/price filters */
export function listingUrl(listingId: string, skinName?: string, condition?: string, floatValue?: number, priceCents?: number): string {
  const source = listingSource(listingId);
  if (source === "dmarket") {
    const params = new URLSearchParams({ title: skinName ?? "" });
    if (floatValue !== undefined && floatValue > 0) {
      const margin = 0.005;
      params.set("floatValueFrom", Math.max(0, floatValue - margin).toFixed(3));
      params.set("floatValueTo", Math.min(1, floatValue + margin).toFixed(3));
    }
    if (priceCents !== undefined && priceCents > 0) {
      const priceDollars = priceCents / 100;
      params.set("price-from", Math.max(0, priceDollars - 1).toFixed(2));
      params.set("price-to", (priceDollars + 1).toFixed(2));
    }
    return `https://dmarket.com/ingame-items/item-list/csgo-skins?${params.toString()}`;
  }
  if (source === "skinport") {
    // Skinport: search with condition + float/price range filters
    const query = condition ? `${skinName} (${condition})` : (skinName ?? "");
    const params = new URLSearchParams({ search: query });
    if (floatValue !== undefined && floatValue > 0) {
      // Skinport uses wear as integer percentage (0-100)
      const wearPct = Math.round(floatValue * 100);
      params.set("weargt", String(Math.max(0, wearPct - 1)));
      params.set("wearlt", String(Math.min(100, wearPct + 1)));
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
  return "CF";
}

/** Badge color for source */
export function sourceColor(source: string): string {
  if (source === "dmarket") return "#4f8cff";
  if (source === "skinport") return "#f5a623";
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
