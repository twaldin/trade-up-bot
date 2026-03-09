import { initDb } from "./db.js";

const db = initDb();

// Check what the engine produces for different floats of Aphrodite
const conditions = [
  { float: 0.02, label: "FN low" },
  { float: 0.06, label: "FN high" },
  { float: 0.10, label: "MW" },
  { float: 0.20, label: "FT low" },
  { float: 0.37, label: "FT high" },
  { float: 0.42, label: "WW" },
  { float: 0.50, label: "BS low" },
  { float: 0.538, label: "BS 0.538 (our case)" },
  { float: 0.70, label: "BS mid" },
  { float: 0.90, label: "BS high" },
];

// Get raw price data
const prices = db
  .prepare(
    "SELECT condition, min_price_cents, avg_price_cents FROM price_data WHERE skin_name = 'AK-47 | Aphrodite'"
  )
  .all() as any[];
console.log("Raw Aphrodite prices (Skinport):");
for (const p of prices) {
  console.log(`  ${p.condition}: min=$${(p.min_price_cents / 100).toFixed(2)}, avg=$${(p.avg_price_cents / 100).toFixed(2)}`);
}

// Now simulate the interpolation
const CONDITION_MIDPOINTS = [
  { name: "Factory New", mid: 0.035 },
  { name: "Minimal Wear", mid: 0.11 },
  { name: "Field-Tested", mid: 0.265 },
  { name: "Well-Worn", mid: 0.415 },
  { name: "Battle-Scarred", mid: 0.725 },
];

const anchors = [];
for (const cm of CONDITION_MIDPOINTS) {
  const row = prices.find((p: any) => p.condition === cm.name);
  if (row) {
    anchors.push({ float: cm.mid, price: row.min_price_cents });
  }
}
// Enforce monotonicity
for (let i = 1; i < anchors.length; i++) {
  if (anchors[i].price > anchors[i - 1].price) {
    anchors[i].price = anchors[i - 1].price;
  }
}

console.log("\nAnchors after monotonicity enforcement:");
for (const a of anchors) {
  console.log(`  float=${a.float.toFixed(3)} -> $${(a.price / 100).toFixed(2)}`);
}

console.log("\nInterpolated prices:");
for (const c of conditions) {
  // Find interpolation bracket
  let price = 0;
  if (c.float <= anchors[0].float) {
    price = anchors[0].price;
  } else if (c.float >= anchors[anchors.length - 1].float) {
    price = anchors[anchors.length - 1].price;
  } else {
    for (let i = 0; i < anchors.length - 1; i++) {
      if (c.float >= anchors[i].float && c.float <= anchors[i + 1].float) {
        const t = (c.float - anchors[i].float) / (anchors[i + 1].float - anchors[i].float);
        price = Math.round(anchors[i].price + t * (anchors[i + 1].price - anchors[i].price));
        break;
      }
    }
  }
  console.log(`  ${c.label} (${c.float.toFixed(3)}): $${(price / 100).toFixed(2)}`);
}
