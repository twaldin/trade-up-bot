import { initDb } from "./db.js";

async function main() {
  const db = initDb();

  const apiKey = "drKlgWjImGzDOMqGpTIG_mMQ3vvRbPv9";
  const headers = { Authorization: apiKey };
  const res = await fetch(
    "https://csfloat.com/api/v1/listings?limit=20&category=1&sort_by=lowest_price&rarity=3",
    { headers }
  );
  const data: any = await res.json();

  let matched = 0;
  let missed = 0;

  for (const listing of data.data) {
    const name: string = listing.item.market_hash_name;
    const baseName = name.replace(/\s*\([^)]+\)\s*$/, "").trim();
    const found = db
      .prepare("SELECT id, name FROM skins WHERE name = ? LIMIT 1")
      .get(baseName) as any;

    if (found) {
      matched++;
    } else {
      missed++;
      // Try LIKE search on pattern name
      const pattern = baseName.split(" | ")[1];
      if (pattern) {
        const like = db
          .prepare("SELECT name FROM skins WHERE name LIKE ? LIMIT 2")
          .all(`%${pattern}%`) as any[];
        console.log(
          `MISS: "${baseName}" -> similar: [${like.map((r: any) => r.name).join(", ")}]`
        );
      } else {
        console.log(`MISS: "${baseName}" (no pattern)`);
      }
    }
  }
  console.log(`\nMatched: ${matched}, Missed: ${missed}`);

  // Also check: how many DB skins have names that match CSFloat format
  const sampleSkins = db
    .prepare("SELECT name FROM skins WHERE rarity = 'Mil-Spec' LIMIT 10")
    .all() as any[];
  console.log(
    "\nSample DB Mil-Spec skin names:",
    sampleSkins.map((s: any) => s.name)
  );
}

main().catch(console.error);
