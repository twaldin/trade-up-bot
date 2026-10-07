import { describe, expect, it } from "vitest";
import {
  formatProfitableCount,
  listProfitableSuffix,
} from "../../src/preview/lib/profitable-count.js";

describe("total_profitable_capped", () => {
  it("shows 10,000+ when the flag is true and never the 10001 sentinel", () => {
    const label = formatProfitableCount(10001, true);
    expect(label).toBe("10,000+");
    expect(label).not.toContain("10001");
    expect(label).not.toContain("10,001");
    expect(listProfitableSuffix({ count: 10001, capped: true, deduped: false })).toBe("(10,000+ profitable)");
  });

  it("shows the count when the flag is false", () => {
    expect(formatProfitableCount(56, false)).toBe("56");
    expect(formatProfitableCount(7085, false)).toBe("7,085");
    expect(listProfitableSuffix({ count: 56, capped: false, deduped: false })).toBe("(56 profitable)");
  });

  it("defaults a missing flag to false", () => {
    expect(formatProfitableCount(56, undefined)).toBe("56");
    expect(formatProfitableCount(56, null)).toBe("56");
    expect(listProfitableSuffix({ count: 7 })).toBe("(7 profitable)");
  });

  it("does not present a deduped list's profitable count as the full population", () => {
    expect(listProfitableSuffix({ count: 56, capped: false, deduped: true })).toBeNull();
    expect(listProfitableSuffix({ count: 10001, capped: true, deduped: true })).toBeNull();
  });
});
