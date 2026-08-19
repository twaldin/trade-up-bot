/**
 * Cached item and collection names.
 *
 * In-game names never change, so every name the app has already seen — from the
 * board, the skins index, the suggestions endpoint — is remembered in
 * localStorage and reused for instant local matching on the next visit. The
 * server suggestion route still fills gaps for names we have not met yet.
 */
import type { NameHit } from "./query-parse.js";

const KEY = "pv_names_v1";
const LIMIT = 4000;

export type NameStore = Map<string, NameHit>;

export function createNameStore(): NameStore {
  return new Map();
}

/** Reads the cache. A corrupt or foreign payload is discarded, not thrown. */
export function readNameCache(storage: Pick<Storage, "getItem"> | undefined): NameHit[] {
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((row): row is NameHit =>
      typeof row === "object" && row !== null && typeof (row as NameHit).name === "string");
  } catch {
    return [];
  }
}

export function writeNameCache(
  storage: Pick<Storage, "setItem"> | undefined,
  hits: NameHit[],
): void {
  try {
    storage?.setItem(KEY, JSON.stringify(hits.slice(0, LIMIT)));
  } catch {
    // a full or blocked storage is not worth failing a render over
  }
}

/** Adds names to the store, keeping the first spelling of each. */
export function rememberNames(store: NameStore, hits: NameHit[]): NameStore {
  for (const hit of hits) {
    if (!hit?.name) continue;
    if (!store.has(hit.name)) store.set(hit.name, hit);
  }
  return store;
}

export function storeToList(store: NameStore): NameHit[] {
  return [...store.values()];
}
