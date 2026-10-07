import { useEffect, useState } from "react";
import {
  parseBoardDelayPayload,
  type BoardDelayGap,
} from "../../../shared/board-delay.js";
import { getEffectiveTier } from "../../../shared/pro-access.js";

/** Express session cookie. HttpOnly, so a page script only sees it when a test or a non-HttpOnly mirror set it. */
export const SESSION_COOKIE_NAME = "connect.sid";
/** Last account this board confirmed. Read on the next load so the hold is in the first paint. */
export const BOARD_ACCOUNT_STORAGE_KEY = "tub_board_account";
/** Production nav cache. A paid tier here skips the optimistic hold. */
export const NAV_ACCOUNT_STORAGE_KEY = "site_nav_user";

export type PaintAccount = { tier?: string; lifetime?: boolean } | null | undefined;

export interface PaintDecision {
  account: PaintAccount;
  /** False while an optimistic guest hold is on screen and auth has not answered. */
  settled: boolean;
}

/**
 * Free and logged-out viewers load the gap. `undefined` is auth still resolving,
 * so the request waits. Pro, lifetime, basic, and admin skip it.
 */
export function shouldFetchBoardDelay(user: PaintAccount): boolean {
  if (user === undefined) return false;
  return getEffectiveTier(user) === "free";
}

export function hasSessionCookie(cookieHeader: string): boolean {
  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    if (trimmed.slice(0, eq) === SESSION_COOKIE_NAME && trimmed.slice(eq + 1) !== "") return true;
  }
  return false;
}

/** `undefined` = nothing stored. `null` = a confirmed guest. */
export function parseStoredBoardAccount(raw: string | null): PaintAccount {
  if (raw == null) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (parsed === null) return null;
  if (!parsed || typeof parsed !== "object") return undefined;
  const tier = Reflect.get(parsed, "tier");
  const lifetime = Reflect.get(parsed, "lifetime");
  if (typeof tier !== "string" || tier === "") return undefined;
  if (lifetime !== undefined && typeof lifetime !== "boolean") return undefined;
  return lifetime === true ? { tier, lifetime: true } : { tier };
}

/**
 * What to paint before `/api/auth/me`.
 * A stored account is settled. No session cookie is an optimistic guest (hold, nothing under it).
 * A session cookie with no stored tier stays unknown so a paid board does not reserve the slot.
 */
export function accountToPaint(cookieHeader: string, storedRaw: string | null, navRaw: string | null = null): PaintDecision {
  const stored = parseStoredBoardAccount(storedRaw);
  if (stored !== undefined) return { account: stored, settled: true };
  const nav = parseStoredBoardAccount(navRaw);
  if (nav !== undefined) return { account: nav, settled: true };
  if (!hasSessionCookie(cookieHeader)) return { account: null, settled: false };
  return { account: undefined, settled: false };
}

function readStorage(key: string): string | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStoredBoardAccount(account: { tier?: string; lifetime?: boolean } | null): void {
  try {
    if (typeof localStorage === "undefined") return;
    if (account === null) {
      localStorage.setItem(BOARD_ACCOUNT_STORAGE_KEY, "null");
      return;
    }
    const tier = typeof account.tier === "string" && account.tier !== "" ? account.tier : "free";
    const value = account.lifetime === true ? { tier, lifetime: true } : { tier };
    localStorage.setItem(BOARD_ACCOUNT_STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Private mode. The next load paints the optimistic guest hold again.
  }
}

export function paintAccountFromBrowser(): PaintDecision {
  if (typeof document === "undefined") return accountToPaint("", null, null);
  return accountToPaint(
    document.cookie,
    readStorage(BOARD_ACCOUNT_STORAGE_KEY),
    readStorage(NAV_ACCOUNT_STORAGE_KEY),
  );
}

export {
  BOARD_DELAY_SECONDS,
  boardDelaySentence,
  parseBoardDelayPayload,
  parseBoardDelayRow,
  type BoardDelayGap,
} from "../../../shared/board-delay.js";

/** undefined while the request is in flight, null if it failed, was skipped, or the body was unusable. */
export function useBoardDelay(enabled = true): BoardDelayGap | null | undefined {
  const [gap, setGap] = useState<BoardDelayGap | null | undefined>(enabled ? undefined : null);
  useEffect(() => {
    if (!enabled) {
      setGap(null);
      return;
    }
    let live = true;
    fetch("/api/board-delay")
      .then((res) => (res.ok ? res.json() : null))
      .then((body: unknown) => {
        if (live) setGap(parseBoardDelayPayload(body));
      })
      .catch(() => {
        if (live) setGap(null);
      });
    return () => { live = false; };
  }, [enabled]);
  return gap;
}
