
import Database from "better-sqlite3";
import { setSyncMeta } from "../db.js";
import { RARITY_ORDER } from "../../shared/types.js";
import { COLLECTIONS_URL, SKINS_URL } from "./types.js";
import type { RawCollection, RawSkin } from "./types.js";
import { normalizeRarity } from "./utils.js";

export async function syncSkinData(db: Database.Database) {
  console.log("Fetching collections...");
  const collectionsRes = await fetch(COLLECTIONS_URL);
  const collections: RawCollection[] = await collectionsRes.json();
  console.log(`  Got ${collections.length} collections`);

  console.log("Fetching skins...");
  const skinsRes = await fetch(SKINS_URL);
  const skins: RawSkin[] = await skinsRes.json();
  console.log(`  Got ${skins.length} skin entries (with wear variants)`);

  // Insert collections
  const insertCollection = db.prepare(
    "INSERT OR REPLACE INTO collections (id, name, image_url) VALUES (?, ?, ?)"
  );
  const insertCollections = db.transaction((cols: RawCollection[]) => {
    for (const c of cols) {
      insertCollection.run(c.id, c.name, c.image ?? null);
    }
  });
  insertCollections(collections);
  console.log(`  Inserted ${collections.length} collections`);

  // Deduplicate skins by skin_id + stattrak (each skin has multiple entries per wear)
  // ByMykel API shares skin_id between StatTrak and non-StatTrak variants,
  // so we use a composite key to keep both.
  const skinMap = new Map<string, RawSkin>();
  for (const s of skins) {
    const key = s.stattrak ? `${s.skin_id}:st` : s.skin_id;
    if (!skinMap.has(key)) {
      skinMap.set(key, s);
    }
  }
  console.log(`  ${skinMap.size} unique skins after dedup`);

  // Insert skins
  const insertSkin = db.prepare(`
    INSERT OR REPLACE INTO skins (id, name, weapon, min_float, max_float, rarity, stattrak, souvenir, image_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let skinCount = 0;
  const insertSkins = db.transaction(() => {
    for (const [compositeId, s] of skinMap) {
      const weapon = s.weapon?.name ?? s.name.split(" | ")[0] ?? "Unknown";
      const rarity = normalizeRarity(s.rarity.name);

      // Skip skins without a known rarity tier (agents, stickers, etc.)
      if (!(rarity in RARITY_ORDER) && rarity !== "Contraband") continue;

      // Strip condition from name: "AK-47 | Redline (Field-Tested)" -> "AK-47 | Redline"
      // StatTrak names keep their "StatTrak™" prefix to match CSFloat/DMarket naming
      const baseName = s.name.replace(/\s*\([^)]+\)\s*$/, "").trim();

      insertSkin.run(
        compositeId,  // "skin-xxx" or "skin-xxx:st"
        baseName,
        weapon,
        s.min_float ?? 0.0,
        s.max_float ?? 1.0,
        rarity,
        s.stattrak ? 1 : 0,
        s.souvenir ? 1 : 0,
        s.image ?? null
      );
      skinCount++;
    }
  });
  insertSkins();
  console.log(`  Inserted ${skinCount} skins`);

  // Build skin_collections from collections.json "contains" array
  const insertSkinCollection = db.prepare(
    "INSERT OR IGNORE INTO skin_collections (skin_id, collection_id) VALUES (?, ?)"
  );

  let linkCount = 0;
  const insertLinks = db.transaction(() => {
    for (const col of collections) {
      if (!col.contains) continue;
      for (const item of col.contains) {
        // The contains array uses the base skin_id (e.g., "skin-bc677a3996cc")
        // Link non-StatTrak variant
        const exists = db.prepare("SELECT 1 FROM skins WHERE id = ?").get(item.id);
        if (exists) {
          insertSkinCollection.run(item.id, col.id);
          linkCount++;
        }
        // Also link StatTrak variant (composite ID "skin-xxx:st")
        const stId = `${item.id}:st`;
        const stExists = db.prepare("SELECT 1 FROM skins WHERE id = ?").get(stId);
        if (stExists) {
          insertSkinCollection.run(stId, col.id);
          linkCount++;
        }
      }
    }
  });
  insertLinks();
  console.log(`  Inserted ${linkCount} collection links`);

  setSyncMeta(db, "last_skin_sync", new Date().toISOString());
}
