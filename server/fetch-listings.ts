import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { initDb } from "./db.js";
import { syncListingsForRarity, syncListingsDiversified } from "./sync.js";

// Load .env
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, "..", ".env");
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, "utf-8");
  for (const line of envContent.split("\n")) {
    const match = line.match(/^(\w+)=(.*)$/);
    if (match) process.env[match[1]] = match[2].trim();
  }
}

const apiKey = process.env.CSFLOAT_API_KEY;
if (!apiKey) {
  console.error("Missing CSFLOAT_API_KEY in .env");
  process.exit(1);
}

async function main() {
  const db = initDb();

  const rarities = [
    "Consumer Grade",
    "Industrial Grade",
    "Mil-Spec",
    "Restricted",
    "Classified",
  ];

  // ─── Pass 1: Cheapest listings per rarity ──────────────────────────────────
  console.log("=== Pass 1: Cheapest listings (lowest_price) ===\n");
  for (const rarity of rarities) {
    const existing = (
      db.prepare(`
        SELECT COUNT(*) as c FROM listings l
        JOIN skins s ON l.skin_id = s.id
        WHERE s.rarity = ?
      `).get(rarity) as { c: number }
    ).c;
    console.log(`${rarity}: ${existing} existing listings`);

    try {
      await syncListingsForRarity(db, rarity, { pages: 10, apiKey });
    } catch (err) {
      console.error(`Failed for ${rarity}:`, err);
    }
    await new Promise((r) => setTimeout(r, 10000));
  }

  // ─── Pass 2: Most recent listings for diversity ────────────────────────────
  console.log("\n=== Pass 2: Recent listings for diversity (most_recent) ===\n");
  for (const rarity of rarities) {
    try {
      await syncListingsDiversified(db, rarity, { pages: 10, apiKey });
    } catch (err) {
      console.error(`Failed for ${rarity}:`, err);
    }
    await new Promise((r) => setTimeout(r, 10000));
  }

  // ─── Summary ───────────────────────────────────────────────────────────────
  const total = (db.prepare("SELECT COUNT(*) as c FROM listings").get() as { c: number }).c;
  const uniqueSkins = (db.prepare("SELECT COUNT(DISTINCT skin_id) as c FROM listings").get() as { c: number }).c;

  console.log(`\n=== Summary ===`);
  console.log(`Total listings: ${total}`);
  console.log(`Unique skins with listings: ${uniqueSkins}`);

  for (const rarity of rarities) {
    const stats = db.prepare(`
      SELECT COUNT(DISTINCT l.skin_id) as unique_skins, COUNT(*) as total_listings,
             (SELECT COUNT(*) FROM skins WHERE rarity = ? AND stattrak = 0) as total_in_rarity
      FROM listings l JOIN skins s ON l.skin_id = s.id WHERE s.rarity = ?
    `).get(rarity, rarity) as { unique_skins: number; total_listings: number; total_in_rarity: number };
    console.log(`  ${rarity}: ${stats.total_listings} listings, ${stats.unique_skins}/${stats.total_in_rarity} skins (${(stats.unique_skins / stats.total_in_rarity * 100).toFixed(0)}%)`);
  }
}

main().catch(console.error);
