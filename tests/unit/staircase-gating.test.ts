import { describe, it, expect } from "vitest";
import { shouldRunStaircase, STAIRCASE_EVERY_N_CYCLES } from "../../server/daemon/utils.js";

// D — wire the staircase pass into the daemon cycle; Iteration 9 tightened the
// cadence. The pass costs 10-23s measured (vs the 1-3 min estimated when
// every-4 was chosen) while the profitable pool decays 30-73% between
// refreshes and troughs to single digits — so: every 2nd cycle, plus cycle 1
// so a restart doesn't open a ~2h staircase blackout.
describe("shouldRunStaircase", () => {
  it("fires on every Nth cycle and not in between", () => {
    expect(shouldRunStaircase(2, 2)).toBe(true);
    expect(shouldRunStaircase(4, 2)).toBe(true);
    expect(shouldRunStaircase(6, 2)).toBe(true);
    for (const c of [3, 5, 7, 9]) {
      expect(shouldRunStaircase(c, 2)).toBe(false);
    }
  });

  it("fires on cycle 1 regardless of interval (post-restart warmup)", () => {
    expect(shouldRunStaircase(1, 2)).toBe(true);
    expect(shouldRunStaircase(1, 4)).toBe(true);
  });

  it("never fires on cycle 0", () => {
    expect(shouldRunStaircase(0, 2)).toBe(false);
  });

  it("never fires for a non-positive interval (no mod-by-zero / always-on)", () => {
    expect(shouldRunStaircase(4, 0)).toBe(false);
    expect(shouldRunStaircase(1, 0)).toBe(false);
    expect(shouldRunStaircase(8, -1)).toBe(false);
  });

  it("defaults to every 2nd cycle via STAIRCASE_EVERY_N_CYCLES", () => {
    expect(STAIRCASE_EVERY_N_CYCLES).toBe(2);
    expect(shouldRunStaircase(2)).toBe(true);
    expect(shouldRunStaircase(3)).toBe(false);
  });
});
