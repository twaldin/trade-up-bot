/**
 * One document head for the SPA. Route changes reset robots and canonical here;
 * each page's own head logic runs afterward and overrides the default.
 */

export const DEFAULT_ROBOTS = "index, follow";

/**
 * Server skin SEO (`server/index.ts`) uses `listingCount < 5` for
 * `noindex, follow`. Five or more listings are `index, follow`.
 */
export const SKIN_INDEX_MIN_LISTINGS = 5;

const CANONICAL_ORIGIN = "https://tradeupbot.app";

export function robotsForListingCount(listingCount: number): string {
  return listingCount < SKIN_INDEX_MIN_LISTINGS ? "noindex, follow" : DEFAULT_ROBOTS;
}

export function canonicalForPath(pathname: string): string {
  if (pathname === "/" || pathname === "") return `${CANONICAL_ORIGIN}/`;
  if (pathname === "/account") return `${CANONICAL_ORIGIN}/my-trade-ups`;
  const blogPost = pathname.match(/^\/blog\/([^/]+)\/?$/);
  if (blogPost?.[1]) return `${CANONICAL_ORIGIN}/blog/${blogPost[1]}/`;
  const trimmed = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  return `${CANONICAL_ORIGIN}${trimmed}`;
}

function robotsMetas(): HTMLMetaElement[] {
  return [...document.querySelectorAll("meta[name='robots']")].filter(
    (node): node is HTMLMetaElement => node instanceof HTMLMetaElement,
  );
}

/** Drop extra robots tags. Leaves the surviving tag's content alone. */
export function collapseDuplicateRobots(): void {
  if (typeof document === "undefined") return;
  const nodes = robotsMetas();
  for (const extra of nodes.slice(1)) extra.remove();
}

/** Keep a single robots meta and set its content. */
export function ensureSingleRobots(content: string): void {
  if (typeof document === "undefined" || !content) return;
  const nodes = robotsMetas();
  let meta = nodes[0];
  if (!meta) {
    meta = document.createElement("meta");
    meta.setAttribute("name", "robots");
    document.head.appendChild(meta);
  }
  meta.setAttribute("content", content);
  for (const extra of nodes.slice(1)) extra.remove();
}

/** Keep a single canonical link pointing at `href`. */
export function ensureCanonical(href: string): void {
  if (typeof document === "undefined" || !href) return;
  const links = [...document.querySelectorAll("link[rel='canonical']")];
  let link = links[0];
  if (!(link instanceof HTMLLinkElement)) {
    const created = document.createElement("link");
    created.rel = "canonical";
    document.head.appendChild(created);
    link = created;
  }
  link.setAttribute("href", href);
  for (const extra of links.slice(1)) extra.remove();
}

export function removeCanonical(): void {
  if (typeof document === "undefined") return;
  document.querySelectorAll("link[rel='canonical']").forEach((node) => node.remove());
}

/** Default head for a client navigation: one `index, follow` tag and this path's canonical. */
export function resetDocumentHead(pathname: string): void {
  ensureSingleRobots(DEFAULT_ROBOTS);
  ensureCanonical(canonicalForPath(pathname));
}
