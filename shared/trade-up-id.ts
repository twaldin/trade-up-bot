/** Postgres integer max. Trade-up primary keys are int4. */
export const TRADE_UP_ID_MAX = 2147483647;

/**
 * A contract id is 1 to 10 digits, no leading zero, and at most 2147483647.
 * Scientific notation, signs, empty strings, and trailing slashes are rejected.
 */
export function parseTradeUpId(raw: string): number | null {
  if (!/^[1-9]\d{0,9}$/.test(raw)) return null;
  const id = Number(raw);
  if (!Number.isSafeInteger(id) || id > TRADE_UP_ID_MAX) return null;
  return id;
}

export function routeParam(value: string | readonly string[] | undefined): string {
  return typeof value === "string" ? value : "";
}

/** `/trade-ups//` is an empty id. A single trailing slash is the board redirect. */
export function isRepeatedTradeUpSlash(pathname: string): boolean {
  return /^\/trade-ups\/{2,}/.test(pathname);
}
