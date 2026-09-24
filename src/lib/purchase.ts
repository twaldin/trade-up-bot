// Post-checkout purchase reporting. Verifies the Stripe session server-side (amount,
// ownership) before firing. An exclusive Web Lock serializes the claim across tabs.
// Without navigator.locks, each tab writes a token and fires only if it still owns
// that token after a short wait. A pending claim expires after 2 minutes and is
// removed on a failed or non-2xx fetch so a retry can report. The in-flight set
// only covers the current document.
import { trackPurchaseComplete } from "./conversions.js";

const FIRED_PREFIX = "tub_purchase_";
const PENDING_TTL_MS = 2 * 60 * 1000;
const inflightByWindow = new WeakMap<object, Set<string>>();

interface LockRequest {
  request(name: string, options: { mode: "exclusive" }, callback: () => Promise<void>): Promise<void>;
}

function inflightFor(win: object): Set<string> {
  let set = inflightByWindow.get(win);
  if (!set) {
    set = new Set();
    inflightByWindow.set(win, set);
  }
  return set;
}

function pendingStamp(value: string): number | null {
  if (!value.startsWith("pending:")) return null;
  const stamp = Number(value.slice("pending:".length).split(":")[0]);
  return Number.isFinite(stamp) ? stamp : null;
}

function pendingIsFresh(value: string, now: number): boolean {
  const started = pendingStamp(value);
  return started != null && now - started < PENDING_TTL_MS;
}

function locksOf(win: Window): LockRequest | null {
  if (!("navigator" in win) || !win.navigator) return null;
  const locks = win.navigator.locks;
  if (!locks || typeof locks.request !== "function") return null;
  return locks;
}

function newToken(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === "function") return cryptoApi.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

function readKey(win: Window, key: string): string | null {
  try { return win.localStorage.getItem(key); } catch { return null; }
}

function writeKey(win: Window, key: string, value: string): void {
  try { win.localStorage.setItem(key, value); } catch { /* storage blocked */ }
}

function clearIfOurs(win: Window, key: string, claimValue: string): void {
  try {
    if (win.localStorage.getItem(key) === claimValue) win.localStorage.removeItem(key);
  } catch { /* ignore */ }
}

async function firePurchase(win: Window, tier: string, sessionId: string, key: string, claimValue: string): Promise<void> {
  try {
    const res = await fetch(`/api/checkout-session/${encodeURIComponent(sessionId)}`, {
      credentials: "include",
    });
    if (!res.ok) {
      clearIfOurs(win, key, claimValue);
      return;
    }
    const data: { transaction_id: string; value: number; currency: string; ga4_server_side?: boolean } = await res.json();
    if (readKey(win, key) !== claimValue) return;
    trackPurchaseComplete({
      sessionId,
      checkoutPlan: tier,
      transactionId: data.transaction_id,
      value: data.value,
      currency: data.currency,
      ga4ServerSide: data.ga4_server_side === true,
    });
    writeKey(win, key, "1");
  } catch {
    clearIfOurs(win, key, claimValue);
  }
}

async function claimAndFire(win: Window, tier: string, sessionId: string, confirmToken: boolean): Promise<void> {
  const inflight = inflightFor(win);
  if (inflight.has(sessionId)) return;
  const key = FIRED_PREFIX + sessionId;
  const existing = readKey(win, key);
  if (existing === "1" || (existing != null && pendingIsFresh(existing, Date.now()))) return;

  const claimValue = `pending:${Date.now()}:${newToken()}`;
  writeKey(win, key, claimValue);
  inflight.add(sessionId);
  try {
    if (confirmToken) {
      await sleep(50 + Math.floor(Math.random() * 101));
      if (readKey(win, key) !== claimValue) return;
    }
    await firePurchase(win, tier, sessionId, key, claimValue);
  } finally {
    inflight.delete(sessionId);
  }
}

export async function reportPurchase(tier: string, sessionId: string): Promise<void> {
  const win = window;
  const locks = locksOf(win);
  if (locks) {
    await locks.request(`tub_purchase_${sessionId}`, { mode: "exclusive" }, async () => {
      await claimAndFire(win, tier, sessionId, false);
    });
    return;
  }
  await claimAndFire(win, tier, sessionId, true);
}
