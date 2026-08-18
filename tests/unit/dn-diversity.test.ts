import { describe, expect, it } from "vitest";
import {
  DN_API_MAX_PER_SIGNATURE,
  DN_COLLECTION_NAMES,
  applyDnDiversity,
  applyDnDiversityToListSql,
  collectionComboHasDn,
  displayedTopMedianScore,
  isDreamsNightmaresCollection,
  shouldApplyDnDiversity,
} from "../../server/routes/dn-diversity.js";

type Row = { id: number; collection_names: string[]; score: number };

function row(id: number, collections: string[], score: number): Row {
  return { id, collection_names: collections, score };
}

const DN = "The Dreams & Nightmares Collection";
const FRACTURE = "The Fracture Collection";

describe("D&N collection identity", () => {
  it("recognizes the canonical DB collection name", () => {
    expect(isDreamsNightmaresCollection("The Dreams & Nightmares Collection")).toBe(true);
  });

  it("recognizes the short SEO/display name", () => {
    expect(isDreamsNightmaresCollection("Dreams & Nightmares")).toBe(true);
  });

  it("does not treat other collections as D&N", () => {
    expect(isDreamsNightmaresCollection("The Fracture Collection")).toBe(false);
    expect(isDreamsNightmaresCollection("The Recoil Collection")).toBe(false);
  });

  it("flags a combo that includes D&N", () => {
    expect(collectionComboHasDn([DN])).toBe(true);
    expect(collectionComboHasDn([DN, FRACTURE])).toBe(true);
    expect(collectionComboHasDn([FRACTURE])).toBe(false);
    expect(collectionComboHasDn([])).toBe(false);
  });

  it("exports both stored name variants for the SQL overlap check", () => {
    expect(DN_COLLECTION_NAMES).toContain("The Dreams & Nightmares Collection");
    expect(DN_COLLECTION_NAMES).toContain("Dreams & Nightmares");
  });
});

describe("shouldApplyDnDiversity", () => {
  it("applies on the default unfiltered board", () => {
    expect(shouldApplyDnDiversity({})).toBe(true);
  });

  it("applies when only a rarity type tab is set", () => {
    expect(shouldApplyDnDiversity({ type: "classified_covert" })).toBe(true);
  });

  it("skips when the user filtered to specific collection(s)", () => {
    expect(shouldApplyDnDiversity({ collection: DN })).toBe(false);
    expect(shouldApplyDnDiversity({ collection: FRACTURE })).toBe(false);
    expect(shouldApplyDnDiversity({ collection: `${DN}|${FRACTURE}` })).toBe(false);
  });

  it("skips an empty/whitespace collection filter (treat as unset)", () => {
    expect(shouldApplyDnDiversity({ collection: "" })).toBe(true);
    expect(shouldApplyDnDiversity({ collection: "   " })).toBe(true);
  });

  it("skips my_claims so a user's locked contracts are not silently dropped", () => {
    expect(shouldApplyDnDiversity({ myClaims: true })).toBe(false);
  });
});

describe("applyDnDiversity (TradeUpStore-style top-N per D&N signature)", () => {
  it("uses the same default cap as TradeUpStore (20 per signature)", () => {
    expect(DN_API_MAX_PER_SIGNATURE).toBe(20);
  });

  it("keeps every non-D&N row", () => {
    const rows = [
      row(1, [FRACTURE], 10),
      row(2, ["The Recoil Collection"], 9),
      row(3, [FRACTURE, "The Recoil Collection"], 8),
    ];
    expect(applyDnDiversity(rows)).toEqual(rows);
  });

  it("caps a single D&N signature at maxPerSignature, keeping the first (highest) rows", () => {
    const rows: Row[] = [];
    for (let i = 0; i < 25; i++) {
      rows.push(row(100 - i, [DN], 5000 - i));
    }
    const kept = applyDnDiversity(rows, 20);
    expect(kept).toHaveLength(20);
    expect(kept.map((r) => r.score)).toEqual(rows.slice(0, 20).map((r) => r.score));
    expect(kept.every((r) => r.collection_names.includes(DN))).toBe(true);
  });

  it("gives mixed D&N combos their own signature bucket", () => {
    const dnOnly = Array.from({ length: 25 }, (_, i) => row(i + 1, [DN], 4000 - i));
    const mixed = Array.from({ length: 5 }, (_, i) => row(200 + i, [DN, FRACTURE], 3000 - i));
    const kept = applyDnDiversity([...dnOnly, ...mixed], 20);

    const keptDnOnly = kept.filter((r) => r.collection_names.length === 1);
    const keptMixed = kept.filter((r) => r.collection_names.length === 2);
    expect(keptDnOnly).toHaveLength(20);
    expect(keptMixed).toHaveLength(5);
  });

  it("surfaces lower-score non-D&N rows that D&N clones would otherwise bury", () => {
    const dnClones = Array.from({ length: 40 }, (_, i) => row(i + 1, [DN], 9000 - i));
    const others = [
      row(500, [FRACTURE], 80),
      row(501, ["The Recoil Collection"], 70),
    ];
    const kept = applyDnDiversity([...dnClones, ...others], 20);

    expect(kept.filter((r) => collectionComboHasDn(r.collection_names))).toHaveLength(20);
    expect(kept.some((r) => r.id === 500)).toBe(true);
    expect(kept.some((r) => r.id === 501)).toBe(true);
    expect(kept).toHaveLength(22);
  });

  it("accepted optical M1 hit: displayed top-100 median drops when D&N clones are capped", () => {
    const dnClones = Array.from({ length: 100 }, (_, i) => row(i + 1, [DN], 200 - i));
    const others = Array.from({ length: 80 }, (_, i) => row(1000 + i, [FRACTURE], 40 - Math.floor(i / 10)));

    const rawTop100 = [...dnClones, ...others].slice(0, 100);
    const diversified = applyDnDiversity([...dnClones, ...others], 20);
    const displayedTop100 = diversified.slice(0, 100);

    expect(displayedTopMedianScore(rawTop100)).toBe(displayedTopMedianScore(dnClones));
    expect(displayedTopMedianScore(displayedTop100)).toBeLessThan(displayedTopMedianScore(rawTop100));
    expect(new Set(displayedTop100.map((r) => r.collection_names[0])).size).toBeGreaterThan(1);
  });

  it("is a no-op when the cap is not exceeded", () => {
    const rows = [row(1, [DN], 10), row(2, [DN], 9)];
    expect(applyDnDiversity(rows, 20)).toEqual(rows);
  });
});

describe("applyDnDiversityToListSql", () => {
  it("leaves the default FROM/WHERE untouched when diversity is off", () => {
    const sql = applyDnDiversityToListSql({
      where: "WHERE t.listing_status = 'active'",
      sortCol: "t.trade_up_score",
      sortOrder: "DESC",
      apply: false,
      startParamIndex: 3,
    });
    expect(sql.fromWhere).toBe("FROM trade_ups t WHERE t.listing_status = 'active'");
    expect(sql.params).toEqual([]);
    expect(sql.nextParamIndex).toBe(3);
  });

  it("wraps the list in a per-D&N-signature window when diversity is on", () => {
    const sql = applyDnDiversityToListSql({
      where: "WHERE t.listing_status = 'active'",
      sortCol: "t.trade_up_score",
      sortOrder: "DESC",
      apply: true,
      startParamIndex: 3,
    });
    expect(sql.fromWhere).toContain("FROM trade_ups t");
    expect(sql.fromWhere).toContain("ROW_NUMBER() OVER");
    expect(sql.fromWhere).toContain("PARTITION BY t.collection_names");
    expect(sql.fromWhere).toContain("t.collection_names && $3::text[]");
    expect(sql.fromWhere).toContain("dn_sig_rank <= $4");
    expect(sql.fromWhere).not.toContain("ELSE t.id::text");
    expect(sql.params).toEqual([[...DN_COLLECTION_NAMES], DN_API_MAX_PER_SIGNATURE]);
    expect(sql.nextParamIndex).toBe(5);
  });
});
