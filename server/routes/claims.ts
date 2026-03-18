import { Router } from "express";
import type Database from "better-sqlite3";
import { requireTier, type User } from "../auth.js";
import { cacheGet, cacheSet, cacheInvalidatePrefix } from "../redis.js";

const CLAIM_DURATION_MINUTES = 30;
const MAX_ACTIVE_CLAIMS = 5;

/** Active claim stored in Redis */
interface ActiveClaim {
  trade_up_id: number;
  user_id: string;
  claimed_at: string;
  expires_at: string;
  listing_ids: string[];
}

/** Get all active claims from Redis (fast) or fall back to SQLite */
export async function getActiveClaims(db: Database.Database): Promise<ActiveClaim[]> {
  // Try Redis first
  const cached = await cacheGet<ActiveClaim[]>("active_claims");
  if (cached) {
    // Filter out expired claims
    const now = new Date().toISOString();
    return cached.filter(c => c.expires_at > now);
  }

  // Fallback: load from SQLite and populate Redis
  try {
    const claims = db.prepare(
      "SELECT trade_up_id, user_id, claimed_at, expires_at FROM trade_up_claims WHERE released_at IS NULL AND expires_at > datetime('now')"
    ).all() as { trade_up_id: number; user_id: string; claimed_at: string; expires_at: string }[];

    const result: ActiveClaim[] = [];
    for (const c of claims) {
      const inputs = db.prepare(
        "SELECT listing_id FROM trade_up_inputs WHERE trade_up_id = ?"
      ).all(c.trade_up_id) as { listing_id: string }[];
      result.push({ ...c, listing_ids: inputs.map(i => i.listing_id) });
    }

    await cacheSet("active_claims", result, 60); // 60s TTL, refreshed on claim/release
    return result;
  } catch {
    return [];
  }
}

/** Refresh the Redis claims cache after a claim/release */
async function refreshClaimsCache(db: Database.Database): Promise<void> {
  try {
    const claims = db.prepare(
      "SELECT trade_up_id, user_id, claimed_at, expires_at FROM trade_up_claims WHERE released_at IS NULL AND expires_at > datetime('now')"
    ).all() as { trade_up_id: number; user_id: string; claimed_at: string; expires_at: string }[];

    const result: ActiveClaim[] = [];
    for (const c of claims) {
      const inputs = db.prepare(
        "SELECT listing_id FROM trade_up_inputs WHERE trade_up_id = ?"
      ).all(c.trade_up_id) as { listing_id: string }[];
      result.push({ ...c, listing_ids: inputs.map(i => i.listing_id) });
    }

    await cacheSet("active_claims", result, 60);
  } catch { /* non-critical */ }
}

interface ClaimRow {
  id: number;
  trade_up_id: number;
  user_id: string;
  claimed_at: string;
  expires_at: string;
  released_at: string | null;
}

interface TradeUpRow {
  id: number;
  profit_cents: number;
  is_theoretical: number;
  listing_status: string;
}

type VerificationStatus = "all_active" | "partial" | "stale";

export function claimsRouter(db: Database.Database): Router {
  const router = Router();

  // Auto-expire: release claims past their expires_at
  function releaseExpiredClaims() {
    db.prepare(
      "UPDATE trade_up_claims SET released_at = datetime('now') WHERE released_at IS NULL AND expires_at <= datetime('now')"
    ).run();
  }

  // Check if a listing still exists in the DB
  function verifyInputs(tradeUpId: number): {
    status: VerificationStatus;
    total: number;
    active: number;
    missing: string[];
  } {
    const inputs = db.prepare(
      "SELECT listing_id, skin_name FROM trade_up_inputs WHERE trade_up_id = ?"
    ).all(tradeUpId) as { listing_id: string; skin_name: string }[];

    const missing: string[] = [];
    let active = 0;

    for (const input of inputs) {
      // Skip theoretical inputs
      if (input.listing_id === "theoretical" || input.listing_id.startsWith("theory")) {
        active++;
        continue;
      }

      const exists = db.prepare(
        "SELECT 1 FROM listings WHERE id = ?"
      ).get(input.listing_id);

      if (exists) {
        active++;
      } else {
        missing.push(input.listing_id);
      }
    }

    const total = inputs.length;
    let status: VerificationStatus;
    if (active === total) {
      status = "all_active";
    } else if (active > 0) {
      status = "partial";
    } else {
      status = "stale";
    }

    return { status, total, active, missing };
  }

  // POST /api/trade-ups/:id/claim - claim a trade-up (Pro only)
  router.post("/api/trade-ups/:id/claim", requireTier("pro"), (req, res) => {
    const tradeUpId = parseInt(String(req.params.id));
    if (isNaN(tradeUpId)) {
      res.status(400).json({ error: "Invalid trade-up ID" });
      return;
    }

    const userId = (req.user as User)?.steam_id || "anonymous";

    releaseExpiredClaims();

    // Check trade-up exists and is profitable
    const tradeUp = db.prepare(
      "SELECT id, profit_cents, is_theoretical, listing_status FROM trade_ups WHERE id = ?"
    ).get(tradeUpId) as TradeUpRow | undefined;

    if (!tradeUp) {
      res.status(404).json({ error: "Trade-up not found" });
      return;
    }

    if (tradeUp.is_theoretical === 1) {
      res.status(400).json({ error: "Cannot claim theoretical trade-ups" });
      return;
    }

    if (tradeUp.profit_cents <= 0) {
      res.status(400).json({ error: "Trade-up is not profitable" });
      return;
    }

    // Check no active claim on this trade-up
    const existingClaim = db.prepare(
      "SELECT id, user_id FROM trade_up_claims WHERE trade_up_id = ? AND released_at IS NULL AND expires_at > datetime('now')"
    ).get(tradeUpId) as { id: number; user_id: string } | undefined;

    if (existingClaim) {
      if (existingClaim.user_id === userId) {
        res.status(409).json({ error: "You already have an active claim on this trade-up" });
      } else {
        res.status(409).json({ error: "This trade-up is already claimed by another user" });
      }
      return;
    }

    // Check user has < MAX_ACTIVE_CLAIMS active claims
    const activeCount = (db.prepare(
      "SELECT COUNT(*) as c FROM trade_up_claims WHERE user_id = ? AND released_at IS NULL AND expires_at > datetime('now')"
    ).get(userId) as { c: number }).c;

    if (activeCount >= MAX_ACTIVE_CLAIMS) {
      res.status(429).json({
        error: `Maximum ${MAX_ACTIVE_CLAIMS} active claims allowed`,
        active_claims: activeCount,
      });
      return;
    }

    // Verify input listings still exist in DB (fast, no API calls)
    const verification = verifyInputs(tradeUpId);

    // Insert claim
    const expiresAt = new Date(Date.now() + CLAIM_DURATION_MINUTES * 60 * 1000).toISOString().replace("T", " ").replace("Z", "");
    const result = db.prepare(
      "INSERT OR REPLACE INTO trade_up_claims (trade_up_id, user_id, claimed_at, expires_at, released_at) VALUES (?, ?, datetime('now'), ?, NULL)"
    ).run(tradeUpId, userId, expiresAt);

    const claim = db.prepare(
      "SELECT * FROM trade_up_claims WHERE id = ?"
    ).get(result.lastInsertRowid) as ClaimRow;

    // Refresh Redis claims cache + invalidate trade-ups cache (claimed listings change visibility)
    refreshClaimsCache(db).catch(() => {});
    cacheInvalidatePrefix("tu:").catch(() => {});

    res.json({
      claim: {
        id: claim.id,
        trade_up_id: claim.trade_up_id,
        user_id: claim.user_id,
        claimed_at: claim.claimed_at,
        expires_at: claim.expires_at,
      },
      verification,
    });
  });

  // DELETE /api/trade-ups/:id/claim - release a claim early
  router.delete("/api/trade-ups/:id/claim", (req, res) => {
    const tradeUpId = parseInt(req.params.id);
    if (isNaN(tradeUpId)) {
      res.status(400).json({ error: "Invalid trade-up ID" });
      return;
    }

    const userId = (req.user as User)?.steam_id || "anonymous";

    const result = db.prepare(
      "UPDATE trade_up_claims SET released_at = datetime('now') WHERE trade_up_id = ? AND user_id = ? AND released_at IS NULL AND expires_at > datetime('now')"
    ).run(tradeUpId, userId);

    if (result.changes === 0) {
      res.status(404).json({ error: "No active claim found for this trade-up" });
      return;
    }

    // Refresh Redis claims cache + invalidate trade-ups cache
    refreshClaimsCache(db).catch(() => {});
    cacheInvalidatePrefix("tu:").catch(() => {});

    res.json({ released: true, trade_up_id: tradeUpId });
  });

  // GET /api/claims - list user's active claims
  router.get("/api/claims", (req, res) => {
    const userId = (req.user as User)?.steam_id || "anonymous";

    releaseExpiredClaims();

    const claims = db.prepare(`
      SELECT c.*, t.total_cost_cents, t.expected_value_cents, t.profit_cents,
             t.roi_percentage, t.type, t.chance_to_profit, t.best_case_cents,
             t.worst_case_cents, t.listing_status
      FROM trade_up_claims c
      JOIN trade_ups t ON c.trade_up_id = t.id
      WHERE c.user_id = ? AND c.released_at IS NULL AND c.expires_at > datetime('now')
      ORDER BY c.claimed_at DESC
    `).all(userId) as (ClaimRow & {
      total_cost_cents: number;
      expected_value_cents: number;
      profit_cents: number;
      roi_percentage: number;
      type: string;
      chance_to_profit: number;
      best_case_cents: number;
      worst_case_cents: number;
      listing_status: string;
    })[];

    const result = claims.map(c => ({
      id: c.id,
      trade_up_id: c.trade_up_id,
      user_id: c.user_id,
      claimed_at: c.claimed_at,
      expires_at: c.expires_at,
      trade_up: {
        total_cost_cents: c.total_cost_cents,
        expected_value_cents: c.expected_value_cents,
        profit_cents: c.profit_cents,
        roi_percentage: c.roi_percentage,
        type: c.type,
        chance_to_profit: c.chance_to_profit,
        best_case_cents: c.best_case_cents,
        worst_case_cents: c.worst_case_cents,
        listing_status: c.listing_status,
      },
    }));

    res.json({ claims: result });
  });

  return router;
}
