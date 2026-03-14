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

/** Source-aware listing URL — routes to the correct marketplace */
export function listingUrl(listingId: string, skinName?: string, condition?: string, floatValue?: number): string {
  const source = listingSource(listingId);
  if (source === "dmarket") {
    // DMarket: use float range params to narrow results to the target listing
    // DMarket URL params only support 2 decimal places
    const params = new URLSearchParams({ title: skinName ?? "" });
    if (floatValue !== undefined && floatValue > 0) {
      const from = Math.floor(floatValue * 100) / 100;       // round down to 2dp
      const to = Math.ceil(floatValue * 100) / 100 + 0.01;   // round up + 0.01 margin
      params.set("floatValueFrom", from.toFixed(2));
      params.set("floatValueTo", Math.min(to, 1).toFixed(2));
    }
    return `https://dmarket.com/ingame-items/item-list/csgo-skins?${params.toString()}`;
  }
  if (source === "skinport") {
    const query = condition ? `${skinName} (${condition})` : skinName;
    return `https://skinport.com/market/730?search=${encodeURIComponent(query ?? "")}`;
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
