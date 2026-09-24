import { describe, it, expect } from "vitest";
import { parseMarkOutlierArgs, describeDatabaseTarget, ratioBucket } from "../../scripts/mark-outlier-stale.js";

describe("parseMarkOutlierArgs", () => {
  it("is a dry-run by default", () => {
    expect(parseMarkOutlierArgs([])).toMatchObject({ dryRun: true, fromId: 0, batchSize: 80, csvPath: undefined });
  });

  it("requires --csv with --apply and rejects unknown flags and --apply with --dry-run", () => {
    expect(parseMarkOutlierArgs(["--apply", "--csv", "out.csv"])).toMatchObject({ dryRun: false, csvPath: "out.csv" });
    expect(() => parseMarkOutlierArgs(["--apply"])).toThrow(/--csv/);
    expect(() => parseMarkOutlierArgs(["--apply", "--dry-run", "--csv", "out.csv"])).toThrow(/not both/);
    expect(() => parseMarkOutlierArgs(["--nope"])).toThrow(/unknown flag/);
    expect(() => parseMarkOutlierArgs(["--batch-size", "10"])).toThrow(/50 to 100/);
    expect(() => parseMarkOutlierArgs(["--from-id", "-1"])).toThrow(/non-negative/);
  });

  it("prints host and database without the password", () => {
    expect(describeDatabaseTarget("postgres://user:secret@db.example:5432/tradeupbot")).toEqual({
      host: "db.example",
      database: "tradeupbot",
    });
  });
});

describe("ratioBucket", () => {
  it("does not bucket an exact 5x price", () => {
    expect(ratioBucket(500, 100)).toBeNull();
    expect(ratioBucket(501, 100)).toBe("5-10x");
  });
});
