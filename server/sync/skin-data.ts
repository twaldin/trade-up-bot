
import pg from "pg";
import { setSyncMeta } from "../db.js";
import { RARITY_ORDER } from "../../shared/types.js";
import { COLLECTIONS_URL, SKINS_URL } from "./types.js";
import type { RawCollection, RawSkin } from "./types.js";
import { normalizeRarity } from "./utils.js";

export async function syncSkinData(pool: pg.Pool) {
  console.log("Fetching collections...");
  const collectionsRes = await fetch(COLLECTIONS_URL);
  const collections: RawCollection[] = await collectionsRes.json();
  console.log(`  Got ${collections.length} collections`);

  console.log("Fetching skins...");
  const skinsRes = await fetch(SKINS_URL);
  const skins: RawSkin[] = await skinsRes.json();
  console.log(`  Got ${skins.length} skin entries (with wear variants)`);

  // Insert collections
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const c of collections) {
      await client.query(
        `INSERT INTO collections (id, name, image_url) VALUES ($1, $2, $3)
         ON CONFLICT (id) DO UPDATE SET name = $2, image_url = $3`,
        [c.id, c.name, c.image ?? null]
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
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
  let skinCount = 0;
  const client2 = await pool.connect();
  try {
    await client2.query("BEGIN");
    for (const [compositeId, s] of skinMap) {
      const weapon = s.weapon?.name ?? s.name.split(" | ")[0] ?? "Unknown";
      const rarity = normalizeRarity(s.rarity.name);

      // Skip skins without a known rarity tier (agents, stickers, etc.)
      if (!(rarity in RARITY_ORDER) && rarity !== "Contraband") continue;

      // Strip condition from name: "AK-47 | Redline (Field-Tested)" -> "AK-47 | Redline"
      // StatTrak names keep their "StatTrak™" prefix to match CSFloat/DMarket naming
      const baseName = s.name.replace(/\s*\([^)]+\)\s*$/, "").trim();

      await client2.query(
        `INSERT INTO skins (id, name, weapon, min_float, max_float, rarity, stattrak, souvenir, image_url)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (id) DO UPDATE SET
           name = $2, weapon = $3, min_float = $4, max_float = $5,
           rarity = $6, stattrak = $7, souvenir = $8, image_url = $9`,
        [
          compositeId,  // "skin-xxx" or "skin-xxx:st"
          baseName,
          weapon,
          s.min_float ?? 0.0,
          s.max_float ?? 1.0,
          rarity,
          s.stattrak ? 1 : 0,
          s.souvenir ? 1 : 0,
          s.image ?? null,
        ]
      );
      skinCount++;
    }
    await client2.query("COMMIT");
  } catch (err) {
    await client2.query("ROLLBACK");
    throw err;
  } finally {
    client2.release();
  }
  console.log(`  Inserted ${skinCount} skins`);

  // Build skin_collections from collections.json "contains" array
  let linkCount = 0;
  const client3 = await pool.connect();
  try {
    await client3.query("BEGIN");
    for (const col of collections) {
      if (!col.contains) continue;
      for (const item of col.contains) {
        // The contains array uses the base skin_id (e.g., "skin-bc677a3996cc")
        // Link non-StatTrak variant
        const { rows: existsRows } = await client3.query(
          "SELECT 1 FROM skins WHERE id = $1", [item.id]
        );
        if (existsRows.length > 0) {
          await client3.query(
            "INSERT INTO skin_collections (skin_id, collection_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
            [item.id, col.id]
          );
          linkCount++;
        }
        // Also link StatTrak variant (composite ID "skin-xxx:st")
        const stId = `${item.id}:st`;
        const { rows: stExistsRows } = await client3.query(
          "SELECT 1 FROM skins WHERE id = $1", [stId]
        );
        if (stExistsRows.length > 0) {
          await client3.query(
            "INSERT INTO skin_collections (skin_id, collection_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
            [stId, col.id]
          );
          linkCount++;
        }
      }
    }
    await client3.query("COMMIT");
  } catch (err) {
    await client3.query("ROLLBACK");
    throw err;
  } finally {
    client3.release();
  }
  console.log(`  Inserted ${linkCount} collection links`);

  await setSyncMeta(pool, "last_skin_sync", new Date().toISOString());
}
