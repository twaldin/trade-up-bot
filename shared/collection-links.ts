import { collectionToSlug } from "./slugs.js";

export interface CollectionTradeUpLink {
  label: string;
  url: string;
}

/** Related collection-board links on a trade-up detail page. First two unique names. */
export function collectionTradeUpLinks(names: readonly string[], limit = 2): CollectionTradeUpLink[] {
  const seen = new Set<string>();
  const links: CollectionTradeUpLink[] = [];
  for (const name of names) {
    if (seen.has(name)) continue;
    seen.add(name);
    const slug = collectionToSlug(name);
    if (!slug) continue;
    const display = name.replace(/^The\s+/i, "").replace(/\s+Collection$/i, "");
    links.push({
      label: `${display} Collection Trade-Ups`,
      url: `/trade-ups/collection/${slug}`,
    });
    if (links.length >= limit) break;
  }
  return links;
}
