// Marketplace link generation — users purchase directly on CSFloat/DMarket/Skinport.
// No auto-buy (would require storing user API keys — security liability).

import { Router } from "express";
import Database from "better-sqlite3";

export function buyRouter(db: Database.Database) {
  const router = Router();

  router.get("/api/listing-link/:listingId", (req, res) => {
    const listingId = String(req.params.listingId);

    const listing = db.prepare(`
      SELECT l.id, l.price_cents, l.float_value, l.source, s.name as skin_name, s.weapon
      FROM listings l JOIN skins s ON l.skin_id = s.id
      WHERE l.id = ?
    `).get(listingId) as { id: string; price_cents: number; float_value: number; source: string; skin_name: string; weapon: string } | undefined;

    if (!listing) {
      res.status(404).json({ error: "Listing not found" });
      return;
    }

    const fullName = `${listing.weapon} | ${listing.skin_name}`;
    let url: string;

    if (listing.source === "csfloat") {
      const encoded = encodeURIComponent(fullName);
      url = `https://csfloat.com/search?market_hash_name=${encoded}&min_float=${(listing.float_value - 0.001).toFixed(4)}&max_float=${(listing.float_value + 0.001).toFixed(4)}`;
    } else if (listing.source === "dmarket") {
      const encoded = encodeURIComponent(fullName);
      url = `https://dmarket.com/ingame-items/item-list/csgo-skins?title=${encoded}&treeFilters=base`;
    } else {
      const slug = fullName.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      url = `https://skinport.com/item/cs2/${slug}`;
    }

    res.json({ url, source: listing.source, skin_name: fullName, price_cents: listing.price_cents, float_value: listing.float_value });
  });

  return router;
}
