import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deletedTradeUpStatus } from "../../server/seo.js";

const __dir = dirname(fileURLToPath(import.meta.url));
const indexSource = readFileSync(join(__dir, "../../server/index.ts"), "utf-8");

describe("deletedTradeUpStatus (410 tombstones for deleted trade-ups)", () => {
  it("returns 410 for a numeric ID (a trade-up that existed and was purged)", () => {
    expect(deletedTradeUpStatus("12345")).toBe(410);
    expect(deletedTradeUpStatus("1")).toBe(410);
  });

  it("returns 404 for non-numeric / malformed paths (never a valid trade-up)", () => {
    expect(deletedTradeUpStatus("abc")).toBe(404);
    expect(deletedTradeUpStatus("12a")).toBe(404);
    expect(deletedTradeUpStatus("")).toBe(404);
    expect(deletedTradeUpStatus("1.5")).toBe(404);
    expect(deletedTradeUpStatus("-5")).toBe(404);
  });

  it("is wired into the SEO /trade-ups/:id handler with a noindex tombstone", () => {
    expect(indexSource).toContain("deletedTradeUpStatus(String(req.params.id))");
    expect(indexSource).toContain('"X-Robots-Tag", "noindex"');
  });
});
