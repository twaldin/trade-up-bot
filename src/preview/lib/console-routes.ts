/**
 * Console route vocabulary, kept in its own module so `App.tsx` can import it
 * without eagerly pulling the lazily-loaded console bundle.
 */
export type ConsolePage =
  | "landing"
  | "board"
  | "skins"
  | "skin"
  | "collections"
  | "collection"
  | "calculator"
  | "account";

/** The retired `/preview` prefix maps onto the real route. */
export function consoleTargetFor(pathname: string): string {
  const target = pathname.replace(/^\/preview\/?/, "/");
  return target === "" ? "/" : target;
}

/** Falls back to reading the page off the path when no page is passed in. */
export function pageFor(page: ConsolePage | undefined, pathname: string): ConsolePage {
  if (page) return page;
  if (/^\/trade-ups(\/|$)/.test(pathname)) return "board";
  if (/^\/skins\/[^/]+/.test(pathname)) return "skin";
  if (/^\/skins(\/|$)/.test(pathname)) return "skins";
  if (/^\/collections\/[^/]+/.test(pathname)) return "collection";
  if (/^\/collections(\/|$)/.test(pathname)) return "collections";
  if (/^\/calculator(\/|$)/.test(pathname)) return "calculator";
  if (/^\/(account|my-trade-ups)(\/|$)/.test(pathname)) return "account";
  return "landing";
}
