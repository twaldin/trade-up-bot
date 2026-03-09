import { initDb } from "./db.js";

const db = initDb();

// Recreate the first trade-up scenario:
// 1x AK-47 Red Laminate, 8x R8 Amber Fade, 1x Desert Eagle Heat Treated
// All are Classified rarity -> Covert outcomes

// Check which collections these skins belong to
const skins = ["AK-47 | Red Laminate", "R8 Revolver | Amber Fade", "Desert Eagle | Heat Treated"];
for (const name of skins) {
  const rows = db.prepare(`
    SELECT s.id, s.name, s.rarity, c.name as collection, sc.collection_id
    FROM skins s
    JOIN skin_collections sc ON s.id = sc.skin_id
    JOIN collections c ON sc.collection_id = c.id
    WHERE s.name = ?
  `).all(name) as any[];
  console.log(`${name}:`);
  for (const r of rows) {
    console.log(`  rarity=${r.rarity}, collection="${r.collection}" (${r.collection_id})`);
  }
}

// Check what Covert skins exist in those collections
console.log("\nCovert outcomes per collection:");
const colIds = db.prepare(`
  SELECT DISTINCT sc.collection_id, c.name
  FROM skins s
  JOIN skin_collections sc ON s.id = sc.skin_id
  JOIN collections c ON sc.collection_id = c.id
  WHERE s.name IN ('AK-47 | Red Laminate', 'R8 Revolver | Amber Fade', 'Desert Eagle | Heat Treated')
`).all() as any[];

for (const col of colIds) {
  const coverts = db.prepare(`
    SELECT s.name FROM skins s
    JOIN skin_collections sc ON s.id = sc.skin_id
    WHERE sc.collection_id = ? AND s.rarity = 'Covert'
  `).all(col.collection_id) as any[];
  console.log(`  ${col.name}: ${coverts.map((c: any) => c.name).join(", ") || "NONE"}`);
}

// Now manually calculate the ticket probabilities:
// Trade-up: 1 AK Red Laminate (collection A), 8 R8 Amber Fade (collection B), 1 Deagle Heat Treated (collection C?)
// Tickets = inputs_from_C * outcomes_in_C for each collection
console.log("\nExpected ticket calculation:");
console.log("If AK is from collection with 1 covert, R8 from collection with 1 covert, Deagle from same collection as R8:");
console.log("  AK collection: 1 input × 1 outcome = 1 ticket");
console.log("  R8 collection: 9 inputs × 1 outcome = 9 tickets");
console.log("  Total: 10 tickets");
console.log("  P(AK outcome) = 1/10 = 10%");
console.log("  P(R8 outcome) = 9/10 = 90%");
