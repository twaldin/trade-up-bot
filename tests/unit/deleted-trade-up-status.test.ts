import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deletedTradeUpStatus } from "../../server/seo.js";

const __dir = dirname(fileURLToPath(import.meta.url));
const indexSource = readFileSync(join(__dir, "../../server/index.ts"), "utf-8");
const shareSource = readFileSync(join(__dir, "../../server/trade-up-share-seo.ts"), "utf-8");

describe("deletedTradeUpStatus (410 only for a known deleted trade-up)", () => {
  it("does not treat a missing all-digit id as deleted", () => {
    expect(deletedTradeUpStatus("999999")).toBe(404);
    expect(deletedTradeUpStatus("12345")).toBe(404);
    expect(deletedTradeUpStatus("1")).toBe(404);
    expect(deletedTradeUpStatus("2147483647")).toBe(404);
  });

  it("returns 410 only when that id is already known deleted or expired", () => {
    expect(deletedTradeUpStatus("999999", true)).toBe(410);
    expect(deletedTradeUpStatus("12345", true)).toBe(410);
    expect(deletedTradeUpStatus("1", true)).toBe(410);
  });

  it("returns 404 for non-numeric / malformed paths (never a valid trade-up)", () => {
    expect(deletedTradeUpStatus("abc")).toBe(404);
    expect(deletedTradeUpStatus("abc", true)).toBe(404);
    expect(deletedTradeUpStatus("12a")).toBe(404);
    expect(deletedTradeUpStatus("")).toBe(404);
    expect(deletedTradeUpStatus("1.5")).toBe(404);
    expect(deletedTradeUpStatus("-5")).toBe(404);
  });

  it("sends a missing row to the not-found page instead of a numeric 410", () => {
    expect(indexSource).toContain("registerTradeUpDetailRoute(app, pool)");
    expect(shareSource).toContain("sendTradeUpNotFound(req, res)");
    expect(shareSource).not.toContain("deletedTradeUpStatus(");
    expect(shareSource).toContain('"X-Robots-Tag", "noindex"');
  });
});
