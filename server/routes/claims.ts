import { Router } from "express";
import pg from "pg";
import { requireTier, type User } from "../auth.js";
import { cacheGet, cacheSet, cacheInvalidatePrefix, checkRateLimit, getRateLimit, getRedis } from "../redis.js";
import { cascadeTradeUpStatuses, deleteListings } from "../engine.js";

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

/** Get all active claims from Redis (fast) or fall back to PostgreSQL */
export async function getActiveClaims(pool: pg.Pool): Promise<ActiveClaim[]> {
  // Try Redis first
  const cached = await cacheGet<ActiveClaim[]>("active_claims");
  if (cached) {
    // Filter out expired claims (normalize format)
    const now = new Date().toISOString().replace("T", " ").replace("Z", "");
    return cached.filter(c => c.expires_at > now);
  }

  // Fallback: load from PostgreSQL and populate Redis
  try {
    const { rows: claims } = await pool.query(
      "SELECT trade_up_id, user_id, claimed_at, expires_at FROM trade_up_claims WHERE released_at IS NULL AND expires_at > NOW()"
    );

    const result: ActiveClaim[] = [];
    for (const c of claims) {
      const { rows: inputs } = await pool.query(
        "SELECT listing_id FROM trade_up_inputs WHERE trade_up_id = $1",
        [c.trade_up_id]
      );
      result.push({ ...c, listing_ids: inputs.map((i: any) => i.listing_id) });
    }

    await cacheSet("active_claims", result, 300); // 5-min TTL, refreshed on claim/release
    return result;
  } catch {
    return [];
  }
}

/** Refresh the Redis claims cache after a claim/release */
async function refreshClaimsCache(pool: pg.Pool): Promise<void> {
  try {
    const { rows: claims } = await pool.query(
      "SELECT trade_up_id, user_id, claimed_at, expires_at FROM trade_up_claims WHERE released_at IS NULL AND expires_at > NOW()"
    );

    const result: ActiveClaim[] = [];
    for (const c of claims) {
      const { rows: inputs } = await pool.query(
        "SELECT listing_id FROM trade_up_inputs WHERE trade_up_id = $1",
        [c.trade_up_id]
      );
      result.push({ ...c, listing_ids: inputs.map((i: any) => i.listing_id) });
    }

    await cacheSet("active_claims", result, 300); // 5-min TTL
    console.log(`Claims cache refreshed: ${result.length} active claims`);
  } catch (e) {
    console.error("Claims cache refresh failed:", e instanceof Error ? e.message : e);
  }
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
  is_theoretical: boolean;
  listing_status: string;
}

type VerificationStatus = "all_active" | "partial" | "stale";

export function claimsRouter(pool: pg.Pool): Router {
  const router = Router();

  // Auto-expire: release claims past their expires_at and clear claimed_by on listings
  // Uses FOR UPDATE SKIP LOCKED to prevent double-processing with daemon
  async function releaseExpiredClaims() {
    const client = await pool.connect();
    let expired: { id: number; trade_up_id: number; user_id: string }[] = [];
    try {
      await client.query('BEGIN');

      const { rows } = await client.query(
        "SELECT id, trade_up_id, user_id FROM trade_up_claims WHERE released_at IS NULL AND expires_at <= NOW() FOR UPDATE SKIP LOCKED"
      );
      expired = rows;

      if (expired.length > 0) {
        for (const claim of expired) {
          const { rows: listings } = await client.query(
            "SELECT listing_id FROM trade_up_inputs WHERE trade_up_id = $1",
            [claim.trade_up_id]
          );
          for (const { listing_id } of listings) {
            await client.query(
              "UPDATE listings SET claimed_by = NULL, claimed_at = NULL WHERE id = $1 AND claimed_by = $2",
              [listing_id, claim.user_id]
            );
          }
          await client.query(
            "UPDATE trade_up_claims SET released_at = NOW() WHERE id = $1",
            [claim.id]
          );
        }
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    if (expired.length === 0) return;

    // Cascade status — unclaimed listings may restore trade-ups to active
    const allListingIds: string[] = [];
    for (const claim of expired) {
      const { rows: ls } = await pool.query(
        "SELECT listing_id FROM trade_up_inputs WHERE trade_up_id = $1",
        [claim.trade_up_id]
      );
      for (const { listing_id } of ls) {
        if (!listing_id.startsWith("theor")) allListingIds.push(listing_id);
      }
    }
    if (allListingIds.length > 0) {
      await cascadeTradeUpStatuses(pool, allListingIds);
    }
  }

  // Check if a listing still exists in the DB
  async function verifyInputs(tradeUpId: number): Promise<{
    status: VerificationStatus;
    total: number;
    active: number;
    missing: string[];
  }> {
    const { rows: inputs } = await pool.query(
      "SELECT listing_id, skin_name FROM trade_up_inputs WHERE trade_up_id = $1",
      [tradeUpId]
    );

    const missing: string[] = [];
    let active = 0;

    for (const input of inputs) {
      // Skip theoretical inputs
      if (input.listing_id === "theoretical" || input.listing_id.startsWith("theory")) {
        active++;
        continue;
      }

      const { rows } = await pool.query(
        "SELECT 1 FROM listings WHERE id = $1",
        [input.listing_id]
      );

      if (rows.length > 0) {
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

  // POST /api/trade-ups/:id/claim - claim a trade-up (Basic + Pro)
  router.post("/api/trade-ups/:id/claim", requireTier("basic", "pro"), async (req, res) => {
    const tradeUpId = parseInt(String(req.params.id));
    if (isNaN(tradeUpId)) {
      res.status(400).json({ error: "Invalid trade-up ID" });
      return;
    }

    const userId = (req.user as User)?.steam_id || "anonymous";
    const userTier = (req.user as User)?.tier as string || "free";
    const isProLevel = userTier === "pro" || userTier === "admin";

    await releaseExpiredClaims();

    // Rate limit: basic 5/24hr, pro 10/hr
    const claimMax = isProLevel ? 10 : 5;
    const claimWindow = isProLevel ? 3600 : 86400;
    const rateLimit = await checkRateLimit(userId, "claim", claimMax, claimWindow);
    if (!rateLimit.allowed) {
      const resetLabel = isProLevel
        ? `${Math.ceil(rateLimit.resetIn! / 60)} min`
        : `${Math.ceil(rateLimit.resetIn! / 3600)} hr`;
      res.status(429).json({
        error: `Claim limit reached (${claimMax}/${isProLevel ? "hour" : "day"}). Resets in ${resetLabel}.`,
        rate_limit: rateLimit,
      });
      return;
    }

    // Check trade-up exists and is profitable
    const { rows: [tradeUp] } = await pool.query(
      "SELECT id, profit_cents, is_theoretical, listing_status FROM trade_ups WHERE id = $1",
      [tradeUpId]
    );

    if (!tradeUp) {
      res.status(404).json({ error: "Trade-up not found" });
      return;
    }

    if (tradeUp.is_theoretical) {
      res.status(400).json({ error: "Cannot claim theoretical trade-ups" });
      return;
    }

    if (tradeUp.profit_cents <= 0) {
      res.status(400).json({ error: "Trade-up is not profitable" });
      return;
    }

    if (tradeUp.listing_status === "stale") {
      res.status(400).json({ error: "Trade-up is stale — listings have been purchased or removed" });
      return;
    }

    // Verify input listings still exist in DB (fast, no API calls) — outside transaction
    const verification = await verifyInputs(tradeUpId);

    // All claim checks + insert happen inside a single transaction with FOR UPDATE
    // to serialize concurrent claims on the same trade-up.
    const expiresAt = new Date(Date.now() + CLAIM_DURATION_MINUTES * 60 * 1000).toISOString().replace("T", " ").replace("Z", "");
    let listingIds: string[] = [];
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Advisory lock on trade-up ID — serializes concurrent claims on the same
      // trade-up without holding row locks. Different trade-ups don't block each other.
      // Released automatically when the transaction ends.
      await client.query("SELECT pg_advisory_xact_lock($1)", [tradeUpId]);

      // Check no active claim on this trade-up (serialized by advisory lock)
      const { rows: [existingClaim] } = await client.query(
        "SELECT id, user_id FROM trade_up_claims WHERE trade_up_id = $1 AND released_at IS NULL AND expires_at > NOW()",
        [tradeUpId]
      );

      if (existingClaim) {
        await client.query('ROLLBACK');
        if (existingClaim.user_id === userId) {
          res.status(409).json({ error: "You already have an active claim on this trade-up" });
        } else {
          res.status(409).json({ error: "This trade-up is already claimed by another user" });
        }
        return;
      }

      // Check user has < MAX_ACTIVE_CLAIMS active claims
      const { rows: [activeCountRow] } = await client.query(
        "SELECT COUNT(*) as c FROM trade_up_claims WHERE user_id = $1 AND released_at IS NULL AND expires_at > NOW()",
        [userId]
      );

      if (parseInt(activeCountRow.c) >= MAX_ACTIVE_CLAIMS) {
        await client.query('ROLLBACK');
        res.status(429).json({
          error: `Maximum ${MAX_ACTIVE_CLAIMS} active claims allowed`,
          active_claims: parseInt(activeCountRow.c),
        });
        return;
      }

      // Load listing IDs for this trade-up
      const { rows: listingRows } = await client.query(
        "SELECT listing_id FROM trade_up_inputs WHERE trade_up_id = $1",
        [tradeUpId]
      );
      listingIds = listingRows.map((r: any) => r.listing_id).filter((id: string) => !id.startsWith("theor"));

      // Listing-level conflict check with FOR UPDATE: locks the listing rows so
      // concurrent claims on different trade-ups sharing listings are serialized.
      if (listingIds.length > 0) {
        const placeholders = listingIds.map((_: any, i: number) => `$${i + 1}`).join(",");
        const { rows: lockedListings } = await client.query(
          `SELECT id, claimed_by FROM listings WHERE id IN (${placeholders}) FOR UPDATE`,
          listingIds
        );
        const conflicts = lockedListings.filter((l: any) => l.claimed_by && l.claimed_by !== userId);
        if (conflicts.length > 0) {
          await client.query('ROLLBACK');
          res.status(409).json({ error: "Some listings are already claimed by another user" });
          return;
        }
      }

      // Insert claim + mark listings as claimed (all inside advisory lock)
      await client.query(
        `INSERT INTO trade_up_claims (trade_up_id, user_id, claimed_at, expires_at, released_at)
         VALUES ($1, $2, NOW(), $3, NULL)
         ON CONFLICT (trade_up_id, user_id) DO UPDATE SET claimed_at = NOW(), expires_at = $3, released_at = NULL`,
        [tradeUpId, userId, expiresAt]
      );
      for (const id of listingIds) {
        await client.query(
          "UPDATE listings SET claimed_by = $1, claimed_at = NOW() WHERE id = $2",
          [userId, id]
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    const { rows: [claim] } = await pool.query(
      "SELECT * FROM trade_up_claims WHERE trade_up_id = $1 AND user_id = $2 AND released_at IS NULL ORDER BY id DESC LIMIT 1",
      [tradeUpId, userId]
    );

    // Cascade status to other trade-ups sharing these now-claimed listings
    await cascadeTradeUpStatuses(pool, listingIds);

    // Refresh Redis claims cache + invalidate trade-ups cache (AWAIT before responding
    // so the next request sees fresh data — fire-and-forget caused claims to not show up)
    await refreshClaimsCache(pool);
    await cacheInvalidatePrefix("tu:");

    res.json({
      claim: {
        id: claim.id,
        trade_up_id: claim.trade_up_id,
        user_id: claim.user_id,
        claimed_at: claim.claimed_at,
        expires_at: claim.expires_at,
      },
      verification,
      rate_limit: rateLimit,
    });
  });

  // DELETE /api/trade-ups/:id/claim - release a claim early
  router.delete("/api/trade-ups/:id/claim", async (req, res) => {
    const tradeUpId = parseInt(req.params.id);
    if (isNaN(tradeUpId)) {
      res.status(400).json({ error: "Invalid trade-up ID" });
      return;
    }

    const userId = (req.user as User)?.steam_id || "anonymous";

    const result = await pool.query(
      "UPDATE trade_up_claims SET released_at = NOW() WHERE trade_up_id = $1 AND user_id = $2 AND released_at IS NULL AND expires_at > NOW()",
      [tradeUpId, userId]
    );

    if (result.rowCount === 0) {
      res.status(404).json({ error: "No active claim found for this trade-up" });
      return;
    }

    // Clear claimed_by on listings (no cascade — refreshListingStatuses handles in housekeeping)
    const { rows: listingRows2 } = await pool.query(
      "SELECT listing_id FROM trade_up_inputs WHERE trade_up_id = $1",
      [tradeUpId]
    );
    for (const { listing_id } of listingRows2) {
      await pool.query(
        "UPDATE listings SET claimed_by = NULL, claimed_at = NULL WHERE id = $1 AND claimed_by = $2",
        [listing_id, userId]
      );
    }

    // Cascade status — listings are unclaimed so other trade-ups may become active again
    const releasedIds = listingRows2.map((r: any) => r.listing_id).filter((id: string) => !id.startsWith("theor"));
    await cascadeTradeUpStatuses(pool, releasedIds);

    // Await Redis updates before responding
    await refreshClaimsCache(pool);
    await cacheInvalidatePrefix("tu:");

    res.json({ released: true, trade_up_id: tradeUpId });
  });

  // POST /api/trade-ups/:id/confirm - confirm purchase (per-listing)
  // Body: { listing_ids: string[] } — which listings user actually bought
  // Confirmed listings are deleted (triggers auto-correct cascade on next read)
  // Unchecked listings are released (claimed_by cleared)
  router.post("/api/trade-ups/:id/confirm", requireTier("basic", "pro"), async (req, res) => {
    const tradeUpId = parseInt(String(req.params.id));
    if (isNaN(tradeUpId)) {
      res.status(400).json({ error: "Invalid trade-up ID" });
      return;
    }

    const userId = (req.user as User)?.steam_id || "anonymous";

    // Must have an active claim on this trade-up
    const { rows: [claim] } = await pool.query(
      "SELECT id FROM trade_up_claims WHERE trade_up_id = $1 AND user_id = $2 AND released_at IS NULL AND confirmed_at IS NULL AND expires_at > NOW()",
      [tradeUpId, userId]
    );

    if (!claim) {
      res.status(404).json({ error: "No active claim found. Claim first, then confirm after purchasing." });
      return;
    }

    // Load all real listing IDs for this trade-up
    const { rows: inputRows } = await pool.query(
      "SELECT listing_id FROM trade_up_inputs WHERE trade_up_id = $1",
      [tradeUpId]
    );
    const allListingIds = inputRows.map((r: any) => r.listing_id).filter((id: string) => !id.startsWith("theor"));
    const validIds = new Set(allListingIds);

    // Per-listing confirm: listing_ids = which ones user bought
    // Backward compat: if listing_ids missing/empty, confirm all
    const requestedIds = (req.body?.listing_ids as string[] | undefined);
    const confirmed = requestedIds?.length
      ? requestedIds.filter(id => validIds.has(id))
      : allListingIds;
    const confirmedSet = new Set(confirmed);
    const released = allListingIds.filter(id => !confirmedSet.has(id));

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Delete confirmed listings (auto-correct treats as missing on next read)
      for (const id of confirmed) {
        await client.query("DELETE FROM listings WHERE id = $1", [id]);
      }

      // Release unchecked listings (clear claimed_by)
      for (const id of released) {
        await client.query(
          "UPDATE listings SET claimed_by = NULL, claimed_at = NULL WHERE id = $1 AND claimed_by = $2",
          [id, userId]
        );
      }

      // Mark claim as confirmed + released
      await client.query(
        "UPDATE trade_up_claims SET confirmed_at = NOW(), released_at = NOW() WHERE id = $1",
        [claim.id]
      );

      // If all listings confirmed, mark trade-up stale immediately
      if (confirmed.length === allListingIds.length) {
        await client.query(
          "UPDATE trade_ups SET listing_status = 'stale', preserved_at = COALESCE(preserved_at, NOW()) WHERE id = $1",
          [tradeUpId]
        );
      }
      // Partial confirm: auto-correct handles status on next read

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    // Cascade status to all trade-ups sharing deleted/released listings
    const allAffectedIds = [...confirmed, ...released];
    if (allAffectedIds.length > 0) {
      await cascadeTradeUpStatuses(pool, allAffectedIds);
    }

    console.log(`Confirm: ${confirmed.length} bought, ${released.length} released (trade-up ${tradeUpId}, user ${userId})`);

    await refreshClaimsCache(pool);
    await cacheInvalidatePrefix("tu:");

    res.json({
      confirmed: true,
      trade_up_id: tradeUpId,
      listings_confirmed: confirmed.length,
      listings_released: released.length,
    });
  });

  // GET /api/claims - list user's active claims
  router.get("/api/claims", async (req, res) => {
    const userId = (req.user as User)?.steam_id || "anonymous";

    await releaseExpiredClaims();

    const { rows: claims } = await pool.query(`
      SELECT c.*, t.total_cost_cents, t.expected_value_cents, t.profit_cents,
             t.roi_percentage, t.type, t.chance_to_profit, t.best_case_cents,
             t.worst_case_cents, t.listing_status
      FROM trade_up_claims c
      JOIN trade_ups t ON c.trade_up_id = t.id
      WHERE c.user_id = $1 AND c.released_at IS NULL AND c.expires_at > NOW()
      ORDER BY c.claimed_at DESC
    `, [userId]);

    const result = claims.map((c: any) => ({
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
