/**
 * Tests for the worker signature precompute feature (plan 019).
 *
 * Step 1 (characterization): verifies the TradeUpStore contract used by workers —
 * signatures seeded from an external source block rediscovery.
 *
 * Step 2 (new behaviour): loadSigsFromFile round-trips a generated sig file and
 * returns a Set that properly blocks known combos.
 *
 * Step 3 (daemon precompute helper): writeSignatureFile serialises a Set<string>
 * to an NDJSON-style one-sig-per-line file that loadSigsFromFile can consume.
 */

import { describe, it, expect, afterEach } from "vitest";
import { writeFileSync, unlinkSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { TradeUpStore } from "../../server/engine/store.js";
import { makeTradeUp } from "../helpers/fixtures.js";
import { loadSigsFromFile, writeSignatureFile } from "../../server/daemon/sig-file.js";

// ─── Characterization: TradeUpStore blocks seeded sigs ──────────────────────

describe("TradeUpStore sig-seeding contract (characterization)", () => {
  it("seeds existingSignatures and blocks add() for known combos", () => {
    const known = new Set(["a,b,c,d,e"]);
    const store = new TradeUpStore(20, known);

    // A trade-up whose listing IDs produce the same sorted sig must be rejected
    const tu = makeTradeUp({ listingIds: ["c", "a", "b", "d", "e"] });
    expect(store.add(tu)).toBe(false);
    expect(store.total).toBe(0);
  });

  it("allows trade-ups whose listing IDs are not in the seeded set", () => {
    const known = new Set(["a,b,c,d,e"]);
    const store = new TradeUpStore(20, known);

    const tu = makeTradeUp({ listingIds: ["x", "y", "z", "w", "v"] });
    expect(store.add(tu)).toBe(true);
    expect(store.total).toBe(1);
  });

  it("hasSig() returns true for pre-seeded signature", () => {
    const known = new Set(["p,q,r"]);
    const store = new TradeUpStore(20, known);
    expect(store.hasSig("p,q,r")).toBe(true);
    expect(store.hasSig("x,y,z")).toBe(false);
  });
});

// ─── loadSigsFromFile + writeSignatureFile round-trip ───────────────────────

const tmpSigFile = join(tmpdir(), `test-sigs-${process.pid}.txt`);

afterEach(() => {
  if (existsSync(tmpSigFile)) unlinkSync(tmpSigFile);
});

describe("writeSignatureFile + loadSigsFromFile", () => {
  it("round-trips a set of signatures through a temp file", async () => {
    const sigs = new Set(["a,b,c", "d,e,f", "g,h,i"]);
    await writeSignatureFile(tmpSigFile, sigs);

    const loaded = await loadSigsFromFile(tmpSigFile);
    expect(loaded).toEqual(sigs);
  });

  it("returns empty set for empty input", async () => {
    await writeSignatureFile(tmpSigFile, new Set());
    const loaded = await loadSigsFromFile(tmpSigFile);
    expect(loaded.size).toBe(0);
  });

  it("loaded set blocks TradeUpStore add() for seeded sigs", async () => {
    const sig = "l1,l2,l3,l4,l5"; // sorted listing IDs from makeTradeUp default
    await writeSignatureFile(tmpSigFile, new Set([sig]));
    const loaded = await loadSigsFromFile(tmpSigFile);

    const store = new TradeUpStore(20, loaded);
    const tu = makeTradeUp(); // uses default listingIds: ["l1","l2","l3","l4","l5"]
    expect(store.add(tu)).toBe(false);
    expect(store.total).toBe(0);
  });

  it("loadSigsFromFile ignores blank lines", async () => {
    writeFileSync(tmpSigFile, "a,b,c\n\nd,e,f\n\n");
    const loaded = await loadSigsFromFile(tmpSigFile);
    expect(loaded.size).toBe(2);
    expect(loaded.has("a,b,c")).toBe(true);
    expect(loaded.has("d,e,f")).toBe(true);
  });

  it("handles large sig sets (1000 sigs)", async () => {
    const sigs = new Set(
      Array.from({ length: 1000 }, (_, i) => `listing-${i * 3},listing-${i * 3 + 1},listing-${i * 3 + 2}`)
    );
    await writeSignatureFile(tmpSigFile, sigs);
    const loaded = await loadSigsFromFile(tmpSigFile);
    expect(loaded.size).toBe(1000);
  });
});
