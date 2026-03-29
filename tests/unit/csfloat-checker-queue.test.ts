import { describe, it, expect } from "vitest";

/**
 * Unit tests for the buildCheckQueue sort order logic.
 *
 * The SQL ORDER BY is:
 *   1. profitable listing flag (0 = profitable, 1 = not)
 *   2. never-checked flag (0 = never checked, 1 = previously checked)
 *   3. COALESCE(staleness_checked_at, created_at) ASC
 *
 * These tests verify that the sort keys produce the correct priority ordering
 * so that oldest never-checked listings are processed before they hit the
 * 3-day purge threshold.
 */

interface MockListing {
  id: string;
  isProfitable: boolean;
  staleness_checked_at: Date | null;
  created_at: Date;
}

/** Mirrors the SQL sort key used in buildCheckQueue */
function sortKey(l: MockListing): [number, number, number] {
  return [
    l.isProfitable ? 0 : 1,
    l.staleness_checked_at === null ? 0 : 1,
    (l.staleness_checked_at ?? l.created_at).getTime(),
  ];
}

function sortListings(listings: MockListing[]): MockListing[] {
  return [...listings].sort((a, b) => {
    const ka = sortKey(a);
    const kb = sortKey(b);
    for (let i = 0; i < ka.length; i++) {
      if (ka[i] !== kb[i]) return ka[i] < kb[i] ? -1 : 1;
    }
    return 0;
  });
}

const now = new Date("2026-03-29T12:00:00Z");
const daysAgo = (d: number) => new Date(now.getTime() - d * 86400_000);

describe("buildCheckQueue sort order", () => {
  it("profitable listings come before non-profitable", () => {
    const listings: MockListing[] = [
      { id: "non-profitable", isProfitable: false, staleness_checked_at: null, created_at: daysAgo(3) },
      { id: "profitable",     isProfitable: true,  staleness_checked_at: null, created_at: daysAgo(1) },
    ];
    const sorted = sortListings(listings);
    expect(sorted[0].id).toBe("profitable");
    expect(sorted[1].id).toBe("non-profitable");
  });

  it("within non-profitable: never-checked before previously-checked", () => {
    const listings: MockListing[] = [
      { id: "checked",       isProfitable: false, staleness_checked_at: daysAgo(2), created_at: daysAgo(3) },
      { id: "never-checked", isProfitable: false, staleness_checked_at: null,       created_at: daysAgo(1) },
    ];
    const sorted = sortListings(listings);
    expect(sorted[0].id).toBe("never-checked");
    expect(sorted[1].id).toBe("checked");
  });

  it("never-checked listings ordered by created_at ASC (oldest first)", () => {
    const listings: MockListing[] = [
      { id: "new",    isProfitable: false, staleness_checked_at: null, created_at: daysAgo(1) },
      { id: "oldest", isProfitable: false, staleness_checked_at: null, created_at: daysAgo(3) },
      { id: "mid",    isProfitable: false, staleness_checked_at: null, created_at: daysAgo(2) },
    ];
    const sorted = sortListings(listings);
    expect(sorted.map(l => l.id)).toEqual(["oldest", "mid", "new"]);
  });

  it("checked listings ordered by staleness_checked_at ASC (oldest checked first)", () => {
    const listings: MockListing[] = [
      { id: "recent", isProfitable: false, staleness_checked_at: daysAgo(1), created_at: daysAgo(5) },
      { id: "oldest", isProfitable: false, staleness_checked_at: daysAgo(3), created_at: daysAgo(4) },
      { id: "mid",    isProfitable: false, staleness_checked_at: daysAgo(2), created_at: daysAgo(6) },
    ];
    const sorted = sortListings(listings);
    expect(sorted.map(l => l.id)).toEqual(["oldest", "mid", "recent"]);
  });

  it("full priority order: profitable-never-checked, profitable-checked, non-profitable-never-checked, non-profitable-checked", () => {
    const listings: MockListing[] = [
      { id: "np-checked",  isProfitable: false, staleness_checked_at: daysAgo(2), created_at: daysAgo(4) },
      { id: "p-checked",   isProfitable: true,  staleness_checked_at: daysAgo(2), created_at: daysAgo(4) },
      { id: "np-unchecked",isProfitable: false, staleness_checked_at: null,       created_at: daysAgo(3) },
      { id: "p-unchecked", isProfitable: true,  staleness_checked_at: null,       created_at: daysAgo(3) },
    ];
    const sorted = sortListings(listings);
    expect(sorted.map(l => l.id)).toEqual([
      "p-unchecked",
      "p-checked",
      "np-unchecked",
      "np-checked",
    ]);
  });

  it("oldest never-checked listing sorts before newer never-checked — prevents 3-day purge miss", () => {
    // Simulate the scenario from issue #63: old unchecked listings accumulate
    // and must be reached before the 3-day purge window expires
    const listings: MockListing[] = [
      { id: "approaching-purge", isProfitable: false, staleness_checked_at: null, created_at: daysAgo(2.9) },
      { id: "newly-fetched",     isProfitable: false, staleness_checked_at: null, created_at: daysAgo(0.1) },
    ];
    const sorted = sortListings(listings);
    expect(sorted[0].id).toBe("approaching-purge");
  });
});
