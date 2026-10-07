import { describe, expect, it } from "vitest";
import {
  DISPLAY_CAP_COPY,
  END_OF_LIST_COPY,
  LIST_CAP_COPY,
  NARROW_FILTERS_HINT,
  displayCapCopy,
  showNarrowFiltersHint,
} from "../../src/preview/lib/board-notice.js";
import { listEndState } from "../../src/preview/lib/page-fetch.js";

const PAGE = 12;

describe("end-of-list notice", () => {
  it("does not call a has_more cut the end of the list", () => {
    const kind = listEndState({
      received: 4,
      pageSize: PAGE,
      page: 84,
      total: 1_000,
      rawTotal: 10_001,
      hasMore: true,
    });
    expect(kind).toBe("truncated");
    expect(displayCapCopy(1_000)).toBe(DISPLAY_CAP_COPY);
    expect(DISPLAY_CAP_COPY).toBe("Showing the top 1,000. Narrow your filters to see more.");
    expect(DISPLAY_CAP_COPY).not.toBe(END_OF_LIST_COPY);
  });

  it("keeps the end line when has_more is false", () => {
    expect(listEndState({
      received: 4,
      pageSize: PAGE,
      page: 3,
      total: 28,
      rawTotal: 28,
      hasMore: false,
    })).toBe("end");
    expect(END_OF_LIST_COPY).toBe("That's the end of this list.");
  });

  it("keeps paging when has_more is true but the loaded rows are not finished", () => {
    expect(listEndState({
      received: PAGE,
      pageSize: PAGE,
      page: 1,
      total: 1_000,
      rawTotal: 10_001,
      hasMore: true,
    })).toBe("more");
    expect(listEndState({
      received: 8,
      pageSize: PAGE,
      page: 2,
      total: 400,
      hasMore: true,
    })).toBe("more");
  });

  it("uses raw_total 10001 for the 10,000+ state and the narrow hint", () => {
    expect(listEndState({
      received: PAGE,
      pageSize: PAGE,
      page: 834,
      total: 1_000,
      rawTotal: 10_001,
    })).toBe("capped");
    expect(LIST_CAP_COPY).toMatch(/10,000/);

    expect(showNarrowFiltersHint({
      landedPage: 5,
      total: 1_000,
      rawTotal: 10_001,
      exhausted: false,
    })).toBe(true);
    expect(NARROW_FILTERS_HINT).toMatch(/Narrow/);
  });

  it("falls back to total when raw_total and has_more are missing", () => {
    expect(listEndState({ received: 4, pageSize: PAGE, page: 3, total: 28 })).toBe("end");
    expect(listEndState({ received: 0, pageSize: PAGE, page: 2, total: 12 })).toBe("end");
    expect(listEndState({ received: PAGE, pageSize: PAGE, page: 1, total: 10_001 })).toBe("more");
    expect(listEndState({ received: PAGE, pageSize: PAGE, page: 834, total: 10_001 })).toBe("capped");
    expect(listEndState({ received: 8, pageSize: PAGE, page: 2, total: 400 })).toBe("more");

    expect(showNarrowFiltersHint({ landedPage: 5, total: 2_400, exhausted: false })).toBe(true);
    expect(showNarrowFiltersHint({ landedPage: 5, total: 1_000, exhausted: false })).toBe(false);
    expect(showNarrowFiltersHint({ landedPage: 4, total: 2_400, exhausted: false })).toBe(false);
    expect(showNarrowFiltersHint({ landedPage: 5, exhausted: false })).toBe(false);
    expect(showNarrowFiltersHint({
      landedPage: 5,
      total: 2_400,
      exhausted: false,
      paging: true,
    })).toBe(false);
  });

  it("does not invent a 1,000 cap when the cut list is shorter", () => {
    expect(listEndState({
      received: 4,
      pageSize: PAGE,
      page: 2,
      total: 16,
      hasMore: true,
    })).toBe("truncated");
    expect(displayCapCopy(16)).toBe("Showing 16 trade-ups. Narrow your filters to see more.");
    expect(displayCapCopy(16)).not.toContain("1,000");
  });

  it("formats a cut list with the same sentinel rule as the landing stats", () => {
    expect(displayCapCopy(10_001)).toBe("Showing 10,000+ trade-ups. Narrow your filters to see more.");
    expect(displayCapCopy(10_001)).not.toContain("10,001");
    expect(displayCapCopy(1_000)).toBe("Showing the top 1,000. Narrow your filters to see more.");
    expect(LIST_CAP_COPY).toBe("This list stops at 10,000+ matches. Narrow the filters to see the rest.");
    expect(LIST_CAP_COPY).not.toContain("1,000+");
  });
});
