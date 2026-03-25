import { describe, it, expect, vi, afterEach } from "vitest";
import { BudgetTracker, FreshnessTracker, TARGET_CYCLE_MS } from "../../server/daemon/state.js";

// ─── BudgetTracker ──────────────────────────────────────────────────────────

describe("BudgetTracker", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  // ── Constructor ──────────────────────────────────────────────────────────

  describe("constructor", () => {
    it("uses default budgets (sale=190, listing=180)", () => {
      const bt = new BudgetTracker();
      expect(bt.saleRemaining).toBe(190);
      expect(bt.listingRemaining).toBe(180);
    });

    it("accepts custom budgets", () => {
      const bt = new BudgetTracker(100, 50);
      expect(bt.saleRemaining).toBe(100);
      expect(bt.listingRemaining).toBe(50);
    });
  });

  // ── Usage tracking ───────────────────────────────────────────────────────

  describe("usage tracking", () => {
    it("useSale decrements sale remaining", () => {
      const bt = new BudgetTracker(100, 100);
      bt.useSale(10);
      expect(bt.saleRemaining).toBe(90);
    });

    it("useListing decrements listing remaining", () => {
      const bt = new BudgetTracker(100, 100);
      bt.useListing(5);
      expect(bt.listingRemaining).toBe(95);
    });

    it("use() counts as sale usage (backward compat)", () => {
      const bt = new BudgetTracker(100, 100);
      bt.use(7);
      expect(bt.saleRemaining).toBe(93);
    });

    it("usedCount = saleUsed + listingUsed", () => {
      const bt = new BudgetTracker(100, 100);
      bt.useSale(3);
      bt.useListing(4);
      expect(bt.usedCount).toBe(7);
    });

    it("saleRemaining = saleBudget - saleUsed", () => {
      const bt = new BudgetTracker(200, 100);
      bt.useSale(50);
      bt.useSale(25);
      expect(bt.saleRemaining).toBe(125);
    });

    it("listingRemaining = listingBudget - listingUsed", () => {
      const bt = new BudgetTracker(100, 200);
      bt.useListing(30);
      bt.useListing(20);
      expect(bt.listingRemaining).toBe(150);
    });

    it("default count of 1 for useSale/useListing/use", () => {
      const bt = new BudgetTracker(100, 100);
      bt.useSale();
      bt.useListing();
      bt.use();
      expect(bt.saleRemaining).toBe(98); // 2 sale calls
      expect(bt.listingRemaining).toBe(99);
    });
  });

  // ── Safety buffer enforcement ────────────────────────────────────────────

  describe("safety buffer enforcement", () => {
    it("hasBudget() returns false when saleRemaining < needed + 30", () => {
      const bt = new BudgetTracker(35, 100);
      // saleRemaining=35, needed=6 → 6+30=36 > 35 → false
      expect(bt.hasBudget(6)).toBe(false);
    });

    it("hasBudget() returns true when saleRemaining >= needed + 30", () => {
      const bt = new BudgetTracker(36, 100);
      // saleRemaining=36, needed=6 → 6+30=36 ≤ 36 → true
      expect(bt.hasBudget(6)).toBe(true);
    });

    it("hasBudget() with default needed=1 checks against 31", () => {
      const bt = new BudgetTracker(31, 100);
      expect(bt.hasBudget()).toBe(true);
      const bt2 = new BudgetTracker(30, 100);
      expect(bt2.hasBudget()).toBe(false);
    });

    it("hasSaleBudget() uses sale safety buffer (30)", () => {
      const bt = new BudgetTracker(40, 100);
      // saleRemaining=40, needed=10 → 10+30=40 ≤ 40 → true
      expect(bt.hasSaleBudget(10)).toBe(true);
      // needed=11 → 11+30=41 > 40 → false
      expect(bt.hasSaleBudget(11)).toBe(false);
    });

    it("hasListingBudget() uses listing safety buffer (5)", () => {
      const bt = new BudgetTracker(100, 15);
      // listingRemaining=15, needed=10 → 10+5=15 ≤ 15 → true
      expect(bt.hasListingBudget(10)).toBe(true);
      // needed=11 → 11+5=16 > 15 → false
      expect(bt.hasListingBudget(11)).toBe(false);
    });

    it("hasBudget() with large needed param", () => {
      const bt = new BudgetTracker(190, 180);
      // needed=200 → 200+30=230 > 190 → false
      expect(bt.hasBudget(200)).toBe(false);
    });
  });

  // ── Usable amounts ──────────────────────────────────────────────────────

  describe("usable amounts", () => {
    it("listingUsable = max(0, listingRemaining - 5)", () => {
      const bt = new BudgetTracker(100, 50);
      expect(bt.listingUsable).toBe(45); // 50 - 5
    });

    it("saleUsable = max(0, saleRemaining - 30)", () => {
      const bt = new BudgetTracker(100, 50);
      expect(bt.saleUsable).toBe(70); // 100 - 30
    });

    it("individualUsable = max(0, individualRemaining - 100)", () => {
      const bt = new BudgetTracker();
      // default individual budget is 40000
      expect(bt.individualUsable).toBe(39900); // 40000 - 100
    });

    it("listingUsable never goes negative", () => {
      const bt = new BudgetTracker(100, 3);
      // listingRemaining=3, 3-5=-2 → max(0,-2) = 0
      expect(bt.listingUsable).toBe(0);
    });

    it("saleUsable never goes negative", () => {
      const bt = new BudgetTracker(20, 100);
      // saleRemaining=20, 20-30=-10 → max(0,-10) = 0
      expect(bt.saleUsable).toBe(0);
    });

    it("individualUsable never goes negative", () => {
      const bt = new BudgetTracker();
      bt.setIndividualPool(50, null);
      // individualRemaining=50, 50-100=-50 → 0
      expect(bt.individualUsable).toBe(0);
    });
  });

  // ── Rate limit flags ─────────────────────────────────────────────────────

  describe("rate limit flags", () => {
    it("markSaleRateLimited sets sale flag only", () => {
      const bt = new BudgetTracker();
      bt.markSaleRateLimited();
      expect(bt.isSaleRateLimited()).toBe(true);
      expect(bt.isListingRateLimited()).toBe(false);
      expect(bt.isRateLimited()).toBe(false); // both must be true
    });

    it("markListingRateLimited sets listing flag only", () => {
      const bt = new BudgetTracker();
      bt.markListingRateLimited();
      expect(bt.isListingRateLimited()).toBe(true);
      expect(bt.isSaleRateLimited()).toBe(false);
      expect(bt.isRateLimited()).toBe(false);
    });

    it("markRateLimited sets both flags", () => {
      const bt = new BudgetTracker();
      bt.markRateLimited();
      expect(bt.isSaleRateLimited()).toBe(true);
      expect(bt.isListingRateLimited()).toBe(true);
      expect(bt.isRateLimited()).toBe(true);
    });

    it("clearRateLimit clears both flags", () => {
      const bt = new BudgetTracker();
      bt.markRateLimited();
      bt.clearRateLimit();
      expect(bt.isSaleRateLimited()).toBe(false);
      expect(bt.isListingRateLimited()).toBe(false);
      expect(bt.isRateLimited()).toBe(false);
    });

    it("isRateLimited() requires BOTH flags (not just one)", () => {
      const bt = new BudgetTracker();
      bt.markSaleRateLimited();
      expect(bt.isRateLimited()).toBe(false);
      bt.markListingRateLimited();
      expect(bt.isRateLimited()).toBe(true);
    });
  });

  // ── Pool updates from API probe ──────────────────────────────────────────

  describe("pool updates from API probe", () => {
    it("setListingPool updates budget and resets used to 0", () => {
      const bt = new BudgetTracker(100, 100);
      bt.useListing(50);
      expect(bt.listingRemaining).toBe(50);

      bt.setListingPool(150, null, 200);
      expect(bt.listingRemaining).toBe(150); // budget replaced, used reset to 0
    });

    it("setSalePool updates budget and resets used to 0", () => {
      const bt = new BudgetTracker(100, 100);
      bt.useSale(30);
      expect(bt.saleRemaining).toBe(70);

      bt.setSalePool(400, null);
      expect(bt.saleRemaining).toBe(400);
    });

    it("setIndividualPool updates budget and resets used to 0", () => {
      const bt = new BudgetTracker();
      bt.useIndividual(1000);
      expect(bt.individualRemaining).toBe(39000);

      bt.setIndividualPool(48000, null);
      expect(bt.individualRemaining).toBe(48000);
    });

    it("null remaining does not change budget", () => {
      const bt = new BudgetTracker(100, 200);
      bt.useListing(50);

      bt.setListingPool(null, null, null);
      // Budget stays 200, but used was reset to 0
      expect(bt.listingRemaining).toBe(200);
    });

    it("setListingPool stores resetAt for pacing", () => {
      const bt = new BudgetTracker();
      bt.setListingPool(150, 1711000000, 200);
      expect(bt.listingResetAt).toBe(1711000000);
    });

    it("setSalePool stores resetAt", () => {
      const bt = new BudgetTracker();
      bt.setSalePool(400, 1711001000);
      expect(bt.saleResetAt).toBe(1711001000);
    });

    it("setIndividualPool stores resetAt", () => {
      const bt = new BudgetTracker();
      bt.setIndividualPool(45000, 1711002000);
      expect(bt.individualResetAt).toBe(1711002000);
    });
  });

  // ── Cycle budget pacing ──────────────────────────────────────────────────

  describe("cycleListingBudget", () => {
    it("with no resetAt returns conservative default (min of usable, 30)", () => {
      const bt = new BudgetTracker(100, 100);
      // listingUsable = 100 - 5 = 95, no resetAt → min(95, 30) = 30
      expect(bt.cycleListingBudget()).toBe(30);
    });

    it("with no resetAt and low usable returns usable", () => {
      const bt = new BudgetTracker(100, 20);
      // listingUsable = 20 - 5 = 15, no resetAt → min(15, 30) = 15
      expect(bt.cycleListingBudget()).toBe(15);
    });

    it("with resetAt very soon (<2 min) returns all usable", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-03-21T12:00:00Z"));
      const bt = new BudgetTracker(100, 100);
      // resetAt in 60 seconds (<120s threshold)
      const resetAt = Math.floor(Date.now() / 1000) + 60;
      bt.setListingPool(100, resetAt, 200);
      expect(bt.cycleListingBudget()).toBe(95); // all usable (100 - 5)
    });

    it("with resetAt 1 hour away and 30-min cycle returns usable/2", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-03-21T12:00:00Z"));
      const bt = new BudgetTracker();
      const resetAt = Math.floor(Date.now() / 1000) + 3600; // 1 hour
      bt.setListingPool(100, resetAt, 200);
      // usable = 100 - 5 = 95
      // cyclesUntilReset = floor(3600 / 1800) = 2
      // perCycle = ceil(95 / 2) = 48
      expect(bt.cycleListingBudget()).toBe(48);
    });

    it("enforces minimum of 5 calls", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-03-21T12:00:00Z"));
      const bt = new BudgetTracker();
      const resetAt = Math.floor(Date.now() / 1000) + 36000; // 10 hours
      bt.setListingPool(10, resetAt, 200);
      // usable = 10 - 5 = 5
      // cyclesUntilReset = floor(36000 / 1800) = 20
      // perCycle = ceil(5 / 20) = 1 → clamped to min 5
      expect(bt.cycleListingBudget()).toBe(5);
    });

    it("returns 0 when usable is 0", () => {
      const bt = new BudgetTracker(100, 5);
      // listingUsable = 5 - 5 = 0
      expect(bt.cycleListingBudget()).toBe(0);
    });

    it("returns 0 when usable is negative (below safety buffer)", () => {
      const bt = new BudgetTracker(100, 3);
      // listingRemaining = 3, usable = max(0, 3-5) = 0
      expect(bt.cycleListingBudget()).toBe(0);
    });
  });

  describe("cycleSaleBudget", () => {
    it("with no resetAt returns conservative default (min of usable, 30)", () => {
      const bt = new BudgetTracker(190, 100);
      // saleUsable = 190 - 30 = 160, no resetAt → min(160, 30) = 30
      expect(bt.cycleSaleBudget()).toBe(30);
    });

    it("with resetAt very soon (<2 min) returns all usable", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-03-21T12:00:00Z"));
      const bt = new BudgetTracker();
      const resetAt = Math.floor(Date.now() / 1000) + 30;
      bt.setSalePool(100, resetAt);
      // usable = 100 - 30 = 70
      expect(bt.cycleSaleBudget()).toBe(70);
    });

    it("with resetAt 1 hour away paces across cycles", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-03-21T12:00:00Z"));
      const bt = new BudgetTracker();
      const resetAt = Math.floor(Date.now() / 1000) + 3600;
      bt.setSalePool(100, resetAt);
      // usable = 100 - 30 = 70
      // cyclesUntilReset = floor(3600 / 1800) = 2
      // perCycle = ceil(70 / 2) = 35
      expect(bt.cycleSaleBudget()).toBe(35);
    });

    it("enforces minimum of 3 calls", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-03-21T12:00:00Z"));
      const bt = new BudgetTracker();
      const resetAt = Math.floor(Date.now() / 1000) + 86400; // 24 hours
      bt.setSalePool(35, resetAt);
      // usable = 35 - 30 = 5
      // cyclesUntilReset = floor(86400 / 1800) = 48
      // perCycle = ceil(5 / 48) = 1 → clamped to min 3
      expect(bt.cycleSaleBudget()).toBe(3);
    });

    it("returns 0 when usable is 0", () => {
      const bt = new BudgetTracker(30, 100);
      // saleUsable = 30 - 30 = 0
      expect(bt.cycleSaleBudget()).toBe(0);
    });
  });

  describe("cycleIndividualBudget", () => {
    it("with no resetAt returns conservative default (min of usable, 500)", () => {
      const bt = new BudgetTracker();
      // individualUsable = 40000 - 100 = 39900, no resetAt → min(39900, 500) = 500
      expect(bt.cycleIndividualBudget()).toBe(500);
    });

    it("with resetAt very soon (<2 min) returns all usable", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-03-21T12:00:00Z"));
      const bt = new BudgetTracker();
      const resetAt = Math.floor(Date.now() / 1000) + 90;
      bt.setIndividualPool(5000, resetAt);
      // usable = 5000 - 100 = 4900
      expect(bt.cycleIndividualBudget()).toBe(4900);
    });

    it("with resetAt far away paces across cycles", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-03-21T12:00:00Z"));
      const bt = new BudgetTracker();
      const resetAt = Math.floor(Date.now() / 1000) + 7200; // 2 hours
      bt.setIndividualPool(10000, resetAt);
      // usable = 10000 - 100 = 9900
      // cyclesUntilReset = floor(7200 / 1800) = 4
      // perCycle = ceil(9900 / 4) = 2475
      expect(bt.cycleIndividualBudget()).toBe(2475);
    });

    it("enforces minimum of 50 calls", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-03-21T12:00:00Z"));
      const bt = new BudgetTracker();
      const resetAt = Math.floor(Date.now() / 1000) + 86400;
      bt.setIndividualPool(200, resetAt);
      // usable = 200 - 100 = 100
      // cyclesUntilReset = floor(86400 / 1800) = 48
      // perCycle = ceil(100 / 48) = 3 → clamped to min 50
      expect(bt.cycleIndividualBudget()).toBe(50);
    });

    it("returns 0 when usable is 0", () => {
      const bt = new BudgetTracker();
      bt.setIndividualPool(100, null);
      // individualUsable = 100 - 100 = 0
      expect(bt.cycleIndividualBudget()).toBe(0);
    });
  });

  // ── Lower-rarity budgets ─────────────────────────────────────────────────

  describe("lower-rarity budgets", () => {
    it("setLowerRarityBudgets stores values", () => {
      const bt = new BudgetTracker();
      bt.setLowerRarityBudgets(10, 20, 30);
      expect(bt.restrictedCalls).toBe(10);
      expect(bt.milspecCalls).toBe(20);
      expect(bt.industrialCalls).toBe(30);
    });

    it("defaults to 0 for all lower-rarity budgets", () => {
      const bt = new BudgetTracker();
      expect(bt.restrictedCalls).toBe(0);
      expect(bt.milspecCalls).toBe(0);
      expect(bt.industrialCalls).toBe(0);
    });
  });

  // ── Individual pool ──────────────────────────────────────────────────────

  describe("individual pool", () => {
    it("useIndividual decrements remaining", () => {
      const bt = new BudgetTracker();
      bt.useIndividual(500);
      expect(bt.individualRemaining).toBe(39500);
    });

    it("useIndividual defaults to 1", () => {
      const bt = new BudgetTracker();
      bt.useIndividual();
      expect(bt.individualRemaining).toBe(39999);
    });

    it("individualRemaining reflects budget minus used", () => {
      const bt = new BudgetTracker();
      bt.setIndividualPool(10000, null);
      bt.useIndividual(200);
      expect(bt.individualRemaining).toBe(9800);
    });

    it("individualUsable respects 100 safety buffer", () => {
      const bt = new BudgetTracker();
      bt.setIndividualPool(500, null);
      bt.useIndividual(300);
      // remaining = 200, usable = 200 - 100 = 100
      expect(bt.individualUsable).toBe(100);
    });
  });
});

// ─── FreshnessTracker ───────────────────────────────────────────────────────

describe("FreshnessTracker", () => {
  it("markListingsChanged() records a change", () => {
    const ft = new FreshnessTracker();
    // Should not throw — verifies the method exists and runs
    ft.markListingsChanged();
  });
});
