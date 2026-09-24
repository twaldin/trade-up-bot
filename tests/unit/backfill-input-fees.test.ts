import { describe, it, expect } from "vitest";
import {
  describeDatabaseTarget,
  parseBackfillArgs,
  requireDatabaseUrl,
} from "../../scripts/backfill-input-fees.js";

describe("backfill flag parsing", () => {
  it("defaults to dry-run", () => {
    expect(parseBackfillArgs([]).dryRun).toBe(true);
  });

  it("--apply writes", () => {
    expect(parseBackfillArgs(["--apply"]).dryRun).toBe(false);
  });

  it("rejects --dry-run together with --apply", () => {
    expect(() => parseBackfillArgs(["--dry-run", "--apply"])).toThrow(/not both/);
    expect(() => parseBackfillArgs(["--apply", "--dry-run"])).toThrow(/not both/);
  });

  it("rejects unknown flags", () => {
    expect(() => parseBackfillArgs(["--force"])).toThrow(/unknown flag/);
    expect(() => parseBackfillArgs(["leftover"])).toThrow(/unexpected argument/);
  });

  it("accepts --tier free and rejects anything else", () => {
    expect(parseBackfillArgs(["--tier", "free"]).tier).toBe("free");
    expect(parseBackfillArgs([]).tier).toBe("pro");
    expect(() => parseBackfillArgs(["--tier", "basic"])).toThrow(/free or pro/);
  });

  it("rejects a batch size outside 50-100", () => {
    expect(() => parseBackfillArgs(["--batch-size", "500"])).toThrow(/50 to 100/);
    expect(parseBackfillArgs(["--batch-size", "80"]).batchSize).toBe(80);
  });
});

describe("backfill database target", () => {
  it("exits the guard when DATABASE_URL is unset", () => {
    expect(() => requireDatabaseUrl({})).toThrow(/DATABASE_URL is unset/);
  });

  it("prints host and database and drops the password", () => {
    const target = describeDatabaseTarget("postgresql://tradeupbot:s3cret@db.internal:5432/tradeupbot");
    expect(target).toEqual({ host: "db.internal", database: "tradeupbot" });
    expect(JSON.stringify(target)).not.toContain("s3cret");
  });
});
