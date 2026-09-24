import { describe, expect, it } from "vitest";
import { DEFAULT_QUERY } from "../../src/preview/components/PreviewFilters.js";
import {
  LOOSEN_PROBE_CAP,
  firstReturningStep,
  loosenCandidates,
  loosenProbePath,
  probeFoundRows,
  probesAllowed,
} from "../../src/preview/lib/empty-suggestions.js";

describe("loosen probes", () => {
  const steps = loosenCandidates({ ...DEFAULT_QUERY, maxCost: "1" }, "");

  it("stops at the first step that returns rows, cheapest first", async () => {
    const seen: string[] = [];
    const found = await firstReturningStep(steps, async (step) => {
      seen.push(step.query.maxCost);
      return step.query.maxCost === "5" ? "hit" : "miss";
    });
    expect(seen).toEqual(["2", "5"]);
    expect(found?.label).toBe("Raise max cost to $5");
    expect(found?.query.maxCost).toBe("5");
  });

  it("returns nothing when every probe is empty, so the UI can show only Clear filters", async () => {
    const found = await firstReturningStep(steps, async () => "miss");
    expect(found).toBeNull();
  });

  it("caps the sequence at 3 probes", async () => {
    const extra = [...steps, ...steps];
    let calls = 0;
    const found = await firstReturningStep(extra, async () => {
      calls += 1;
      return "miss";
    });
    expect(calls).toBe(LOOSEN_PROBE_CAP);
    expect(found).toBeNull();
  });

  it("stops on a rate limit instead of probing further", async () => {
    let calls = 0;
    const found = await firstReturningStep(steps, async () => {
      calls += 1;
      return "stop";
    });
    expect(calls).toBe(1);
    expect(found).toBeNull();
  });

  it("asks the list API for one row with the loosened filter", () => {
    const path = loosenProbePath(steps[1]);
    const params = new URLSearchParams(path.split("?")[1]);
    expect(path.startsWith("/api/trade-ups?")).toBe(true);
    expect(params.get("per_page")).toBe("1");
    expect(params.get("max_cost")).toBe("500");
    expect(params.get("page")).toBe("1");
  });

  it("treats a positive total as rows and an empty page as a miss", () => {
    expect(probeFoundRows({ total: 3, trade_ups: [{}] })).toBe(true);
    expect(probeFoundRows({ total: 0, trade_ups: [] })).toBe(false);
    expect(probeFoundRows(null)).toBe(false);
  });

  it("does not probe while the user is typing", () => {
    expect(probesAllowed(true)).toBe(false);
    expect(probesAllowed(false)).toBe(true);
  });
});

