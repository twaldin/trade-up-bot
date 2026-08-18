import { describe, expect, it } from "vitest";
import {
  API_MAX_PER_COLLECTION_COMBO,
  applyListDiversity,
  applyListDiversityToListSql,
  collectionComboKey,
  displayedTopMedianScore,
  shouldApplyListDiversity,
} from "../../server/routes/dn-diversity.js";

type Row = { id: number; collection_names: string[]; score: number };

function row(id: number, collections: string[], score: number): Row {
  return { id, collection_names: collections, score };
}

const DN = "The Dreams & Nightmares Collection";
const FRACTURE = "The Fracture Collection";

describe("shouldApplyListDiversity", () => {
  it("applies on the default unfiltered board", () => {
    expect(shouldApplyListDiversity({})).toBe(true);
  });

  it("applies when only a rarity type tab is set", () => {
    expect(shouldApplyListDiversity({ type: "classified_covert" })).toBe(true);
  });

  it("skips when the user filtered to specific collection(s)", () => {
    expect(shouldApplyListDiversity({ collection: DN })).toBe(false);
    expect(shouldApplyListDiversity({ collection: FRACTURE })).toBe(false);
    expect(shouldApplyListDiversity({ collection: `${DN}|${FRACTURE}` })).toBe(false);
  });

  it("skips an empty/whitespace collection filter (treat as unset)", () => {
    expect(shouldApplyListDiversity({ collection: "" })).toBe(true);
    expect(shouldApplyListDiversity({ collection: "   " })).toBe(true);
  });

  it("skips my_claims so a user's locked contracts are not silently dropped", () => {
    expect(shouldApplyListDiversity({ myClaims: true })).toBe(false);
  });
});

describe("applyListDiversity (API analog of TradeUpStore: top-N per collection-combo)", () => {
  it("uses the same default cap as TradeUpStore (20 per signature)", () => {
    expect(API_MAX_PER_COLLECTION_COMBO).toBe(20);
  });

  it("keys a combo the same way TradeUpStore does (sorted names joined by |)", () => {
    expect(collectionComboKey([FRACTURE, DN])).toBe(`${DN}|${FRACTURE}`);
    expect(collectionComboKey([DN])).toBe(DN);
  });

  it("keeps every combo that is under the cap", () => {
    const rows = [
      row(1, [FRACTURE], 10),
      row(2, ["The Recoil Collection"], 9),
      row(3, [FRACTURE, "The Recoil Collection"], 8),
    ];
    expect(applyListDiversity(rows)).toEqual(rows);
  });

  it("caps a single D&N signature at N, keeping the highest rows", () => {
    const rows = Array.from({ length: 25 }, (_, i) => row(100 - i, [DN], 5000 - i));
    const kept = applyListDiversity(rows, 20);
    expect(kept).toHaveLength(20);
    expect(kept.map((r) => r.score)).toEqual(rows.slice(0, 20).map((r) => r.score));
  });

  it("caps every collection-combo, not only D&N (Check 131 analog)", () => {
    const fractureClones = Array.from({ length: 25 }, (_, i) => row(i + 1, [FRACTURE], 800 - i));
    const kept = applyListDiversity(fractureClones, 20);
    expect(kept).toHaveLength(20);
    expect(kept[0].score).toBe(800);
    expect(kept[19].score).toBe(781);
  });

  it("gives mixed combos their own bucket", () => {
    const dnOnly = Array.from({ length: 25 }, (_, i) => row(i + 1, [DN], 4000 - i));
    const mixed = Array.from({ length: 5 }, (_, i) => row(200 + i, [DN, FRACTURE], 3000 - i));
    const kept = applyListDiversity([...dnOnly, ...mixed], 20);

    expect(kept.filter((r) => r.collection_names.length === 1)).toHaveLength(20);
    expect(kept.filter((r) => r.collection_names.length === 2)).toHaveLength(5);
  });

  it("Check 131: 132 near-identical D&N rows cannot occupy the entire top after the cap", () => {
    const dnClones = Array.from({ length: 132 }, (_, i) => row(i + 1, [DN], 9000 - i));
    const others = [
      row(500, [FRACTURE], 80),
      row(501, ["The Recoil Collection"], 70),
    ];
    const kept = applyListDiversity([...dnClones, ...others], 20);
    const page = kept.slice(0, 50);

    expect(page.filter((r) => r.collection_names[0] === DN)).toHaveLength(20);
    expect(page.some((r) => r.id === 500)).toBe(true);
    expect(page.some((r) => r.id === 501)).toBe(true);
    expect(page).toHaveLength(22);
  });

  it("accepted optical M1 hit: displayed top-100 median drops when clones are capped", () => {
    const dnClones = Array.from({ length: 100 }, (_, i) => row(i + 1, [DN], 200 - i));
    const others = Array.from({ length: 80 }, (_, i) => row(1000 + i, [FRACTURE], 40 - Math.floor(i / 10)));

    const rawTop100 = [...dnClones, ...others].slice(0, 100);
    const displayedTop100 = applyListDiversity([...dnClones, ...others], 20).slice(0, 100);

    expect(displayedTopMedianScore(rawTop100)).toBe(displayedTopMedianScore(dnClones));
    expect(displayedTopMedianScore(displayedTop100)).toBeLessThan(displayedTopMedianScore(rawTop100));
    expect(new Set(displayedTop100.map((r) => collectionComboKey(r.collection_names))).size).toBeGreaterThan(1);
  });

  it("is a no-op when no combo exceeds the cap", () => {
    const rows = [row(1, [DN], 10), row(2, [DN], 9)];
    expect(applyListDiversity(rows, 20)).toEqual(rows);
  });
});

describe("applyListDiversityToListSql", () => {
  it("leaves the default FROM/WHERE untouched when diversity is off", () => {
    const sql = applyListDiversityToListSql({
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

  it("windows every collection-combo (not a D&N-only name list)", () => {
    const sql = applyListDiversityToListSql({
      where: "WHERE t.listing_status = 'active'",
      sortCol: "t.trade_up_score",
      sortOrder: "DESC",
      apply: true,
      startParamIndex: 3,
    });
    expect(sql.fromWhere).toContain("ROW_NUMBER() OVER");
    expect(sql.fromWhere).toContain("PARTITION BY t.collection_names");
    expect(sql.fromWhere).toContain("combo_rank <= $3");
    expect(sql.fromWhere).not.toContain("Dreams");
    expect(sql.fromWhere).not.toContain("&&");
    expect(sql.params).toEqual([API_MAX_PER_COLLECTION_COMBO]);
    expect(sql.nextParamIndex).toBe(4);
  });
});
