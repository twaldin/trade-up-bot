import { describe, it, expect } from "vitest";
import { shouldRunStaircase, STAIRCASE_EVERY_N_CYCLES } from "../../server/daemon/utils.js";

// D — wire the staircase pass into the daemon cycle. The heavy staircase pass
// runs only every Nth cycle; this guards the gating logic.
describe("shouldRunStaircase", () => {
  it("fires on every Nth cycle and not in between", () => {
    expect(shouldRunStaircase(4, 4)).toBe(true);
    expect(shouldRunStaircase(8, 4)).toBe(true);
    expect(shouldRunStaircase(12, 4)).toBe(true);
    for (const c of [1, 2, 3, 5, 6, 7, 9, 10, 11]) {
      expect(shouldRunStaircase(c, 4)).toBe(false);
    }
  });

  it("never fires on cycle 0", () => {
    expect(shouldRunStaircase(0, 4)).toBe(false);
  });

  it("never fires for a non-positive interval (no mod-by-zero / always-on)", () => {
    expect(shouldRunStaircase(4, 0)).toBe(false);
    expect(shouldRunStaircase(8, -1)).toBe(false);
  });

  it("uses STAIRCASE_EVERY_N_CYCLES as the default interval", () => {
    const n = STAIRCASE_EVERY_N_CYCLES;
    expect(n).toBeGreaterThan(0);
    expect(shouldRunStaircase(n)).toBe(true);
    expect(shouldRunStaircase(n + 1)).toBe(false);
  });
});
