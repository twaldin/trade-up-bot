import type { TradeUpInput, TradeUpOutcome } from "../../../shared/types.js";
import { toSlug } from "../../../shared/slugs.js";
import { listingUrl } from "../../utils/format.js";

/** Exact marketplace URLs for one grouped input skin. Never invents a listing. */
export function listingUrlsForSkin(inputs: TradeUpInput[], skinName: string): string[] {
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const input of inputs) {
    if (input.skin_name !== skinName) continue;
    const url = listingUrl(
      input.listing_id,
      input.skin_name,
      input.condition,
      input.float_value,
      input.price_cents,
      input.source,
      input.marketplace_id,
      input.stattrak,
    );
    if (seen.has(url)) continue;
    seen.add(url);
    urls.push(url);
  }
  return urls;
}

/** In-app float/price page for that exact outcome skin. */
export function outputWorthPath(
  outcome: Pick<TradeUpOutcome, "skin_name"> & Partial<Pick<TradeUpOutcome, "predicted_float" | "estimated_price_cents">>,
): string {
  const params = new URLSearchParams();
  if (outcome.predicted_float != null) params.set("float", String(outcome.predicted_float));
  if (outcome.estimated_price_cents != null) params.set("price", String(outcome.estimated_price_cents));
  const query = params.toString();
  return `/preview/skins/${toSlug(outcome.skin_name)}${query ? `?${query}` : ""}`;
}

/** Open listing URLs. Returns any that the browser blocked so a chooser can show. */
export function openExternalUrls(
  urls: string[],
  openFn: (url: string, target: string, features: string) => Window | null = (url, target, features) => window.open(url, target, features),
): string[] {
  const blocked: string[] = [];
  for (const url of urls) {
    const opened = openFn(url, "_blank", "noopener,noreferrer");
    if (!opened) blocked.push(url);
  }
  return blocked;
}
