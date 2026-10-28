/** A skin document is indexable once it has at least this many listings. */
export const SKIN_INDEX_MIN_LISTINGS = 5;

/** Same rule the skin HTML route and the in-app skin page use. */
export function skinRobotsForListingCount(listingCount: number): "noindex, follow" | "index, follow" {
  return listingCount < SKIN_INDEX_MIN_LISTINGS ? "noindex, follow" : "index, follow";
}
