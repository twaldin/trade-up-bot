/**
 * Buy API — purchase listings from external marketplaces.
 * Currently supports DMarket only (CSFloat has no public buy API).
 */

import { Router } from "express";
import Database from "better-sqlite3";
import { buyDMarketItem, isDMarketConfigured } from "../sync.js";

export function buyRouter(db: Database.Database) {
  const router = Router();

  /**
   * POST /api/buy/dmarket
   * Body: { listingId: "dmarket:<itemId>", expectedPriceCents: number }
   *
   * Purchases a DMarket listing. Validates the listing exists in our DB
   * with matching price before executing the buy.
   */
  router.post("/api/buy/dmarket", async (req, res) => {
    if (!isDMarketConfigured()) {
      return res.status(503).json({ error: "DMarket API not configured" });
    }

    const { listingId, expectedPriceCents } = req.body as {
      listingId?: string;
      expectedPriceCents?: number;
    };

    if (!listingId || !expectedPriceCents) {
      return res.status(400).json({ error: "Missing listingId or expectedPriceCents" });
    }

    if (!listingId.startsWith("dmarket:")) {
      return res.status(400).json({ error: "Not a DMarket listing" });
    }

    // Verify listing exists in our DB with expected price
    const listing = db.prepare(
      "SELECT id, price_cents, skin_id FROM listings WHERE id = ? AND source = 'dmarket'"
    ).get(listingId) as { id: string; price_cents: number; skin_id: string } | undefined;

    if (!listing) {
      return res.status(404).json({ error: "Listing not found in database" });
    }

    if (listing.price_cents !== expectedPriceCents) {
      return res.status(409).json({
        error: "Price changed",
        dbPrice: listing.price_cents,
        expectedPrice: expectedPriceCents,
      });
    }

    const itemId = listingId.replace("dmarket:", "");

    try {
      const result = await buyDMarketItem(itemId, expectedPriceCents);
      if (result.success) {
        // Remove from listings since we bought it
        db.prepare("DELETE FROM listings WHERE id = ?").run(listingId);
        res.json({ success: true, operationId: result.operationId });
      } else {
        res.status(400).json({ success: false, error: result.error });
      }
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  return router;
}
