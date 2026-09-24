import { createElement, Fragment, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { BOARD_LIST_INCLUDE, boardListUrl, loadBoardRows } from "../../src/preview/lib/board-load.js";
import { needsLandingStats, type ConsolePage } from "../../src/preview/lib/console-routes.js";
import { hydrateOutcomesIfNeeded } from "../../src/preview/lib/skin-images.js";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BOARD_SORTS,
  boardQueryString,
  DEFAULT_QUERY,
  isDefaultQuery,
  PreviewFilters,
} from "../../src/preview/components/PreviewFilters.js";
import { BoardNotice } from "../../src/preview/components/BoardNotice.js";
import {
  boardNotice,
  FILTERED_EMPTY_COPY,
  LOAD_ERROR_COPY,
  UNFILTERED_EMPTY_COPY,
} from "../../src/preview/lib/board-notice.js";
import { reachedTotal, SLOW_DOWN_COPY } from "../../src/preview/lib/page-fetch.js";
import { sortRows } from "../../src/preview/components/PreviewTable.js";
import {
  groupBySeries,
  scatterPlotPoint,
  scatterYMaxDollars,
} from "../../src/preview/components/PriceScatter.js";

describe("preview board query", () => {
  it("sends only the parameters the trade-ups API accepts", () => {
    const params = new URLSearchParams(boardQueryString(DEFAULT_QUERY));
    expect([...params.keys()].sort()).toEqual(["order", "per_page", "sort"]);
    expect(params.get("sort")).toBe("trade_up_score");
    expect(params.get("order")).toBe("desc");
  });

  it("converts dollars to integer cents and sends chance as a percent", () => {
    const params = new URLSearchParams(boardQueryString({
      ...DEFAULT_QUERY,
      minProfit: "1.27",
      maxCost: "50",
      minChance: "40",
    }));
    expect(params.get("min_profit")).toBe("127");
    expect(params.get("max_cost")).toBe("5000");
    expect(params.get("min_chance")).toBe("40");
  });

  it("sends Classified + Profit + min chance 100 + max $60 the way the API reads it", () => {
    const params = new URLSearchParams(boardQueryString({
      ...DEFAULT_QUERY,
      type: "restricted_classified",
      sort: "profit",
      minChance: "100",
      maxCost: "60",
    }));
    expect(params.get("type")).toBe("restricted_classified");
    expect(params.get("sort")).toBe("profit");
    expect(params.get("min_chance")).toBe("100");
    expect(params.get("max_cost")).toBe("6000");
  });

  it("offers only sort keys the API's short vocabulary uses", () => {
    expect(BOARD_SORTS.map(([value]) => value)).toEqual([
      "trade_up_score", "profit", "roi", "cost", "chance", "created",
    ]);
  });

  it("omits blank filters rather than sending empty values", () => {
    const params = new URLSearchParams(boardQueryString({ ...DEFAULT_QUERY, skin: "   ", type: "" }));
    expect(params.has("skin")).toBe(false);
    expect(params.has("type")).toBe(false);
  });

  it("passes the tier and skin filters straight through", () => {
    const params = new URLSearchParams(boardQueryString({
      ...DEFAULT_QUERY,
      type: "classified_covert",
      skin: "Nightwish",
    }));
    expect(params.get("type")).toBe("classified_covert");
    expect(params.get("skin")).toBe("Nightwish");
  });

  it("knows when nothing is filtered", () => {
    expect(isDefaultQuery(DEFAULT_QUERY)).toBe(true);
    expect(isDefaultQuery({ ...DEFAULT_QUERY, minChance: "40" })).toBe(false);
  });
});

type Row = { id: number; outcomes: string[] };

function ports(overrides: Partial<Parameters<typeof loadBoardRows<Row>>[0]> = {}) {
  const rows: Row[][] = [];
  const loading: boolean[] = [];
  const facesReady = vi.fn();
  const base = {
    fetchRows: async () => ({ rows: [{ id: 1, outcomes: [] }], isFree: true }),
    hydrate: async (row: Row) => ({ ...row, outcomes: ["Out A", "Out B"] }),
    namesOf: (list: Row[]) => list.flatMap((row) => row.outcomes),
    warmFaces: async () => undefined,
    emit: {
      rows: (next: Row[] | ((prev: Row[]) => Row[])) => {
        const previous = rows[rows.length - 1] ?? [];
        rows.push(typeof next === "function" ? next(previous) : next);
      },
      isFree: vi.fn(),
      loading: (value: boolean) => { loading.push(value); },
      facesReady,
    },
    ...overrides,
  };
  return { ports: base, rows, loading, facesReady };
}

describe("preview board load order", () => {
  it("applies hydrated outcomes even when faces never resolve", async () => {
    const never = new Promise<void>(() => {});
    const harness = ports({ warmFaces: () => never });

    await loadBoardRows<Row>(harness.ports);

    const last = harness.rows[harness.rows.length - 1];
    expect(last?.[0]?.outcomes).toEqual(["Out A", "Out B"]);
    expect(harness.loading).toEqual([true, false]);
    expect(harness.facesReady).not.toHaveBeenCalled();
  });

  it("paints the rows it has, then replaces them with the hydrated ones", async () => {
    const harness = ports();
    await loadBoardRows<Row>(harness.ports);
    expect(harness.rows).toHaveLength(2);
    expect(harness.rows[0]?.[0]?.outcomes).toEqual([]);
    expect(harness.rows[1]?.[0]?.outcomes).toEqual(["Out A", "Out B"]);
  });

  it("never waits on faces before clearing the loading flag", async () => {
    const order: string[] = [];
    const harness = ports({
      warmFaces: async () => { order.push("faces"); },
      emit: {
        rows: () => { order.push("rows"); },
        isFree: vi.fn(),
        loading: (value: boolean) => { order.push(`loading:${value}`); },
        facesReady: () => { order.push("facesReady"); },
      },
    });

    await loadBoardRows<Row>(harness.ports);
    expect(order.indexOf("loading:false")).toBeLessThan(order.indexOf("faces"));
    expect(order.indexOf("rows")).toBeLessThan(order.indexOf("faces"));
  });

  it("warms faces from the hydrated rows, not the empty ones", async () => {
    const warmFaces = vi.fn(async () => undefined);
    const harness = ports({ warmFaces });
    await loadBoardRows<Row>(harness.ports);
    await Promise.resolve();
    expect(warmFaces).toHaveBeenCalledWith(["Out A", "Out B"]);
  });

  it("signals faces are ready so the cached art can paint", async () => {
    const harness = ports();
    await loadBoardRows<Row>(harness.ports);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(harness.facesReady).toHaveBeenCalledTimes(1);
  });

  it("clears the board and reports a failure, not an empty result, when the list request fails", async () => {
    const warmFaces = vi.fn(async () => undefined);
    const failed = vi.fn();
    const rateLimited = vi.fn();
    const harness = ports({
      fetchRows: async () => { throw new Error("offline"); },
      warmFaces,
    });
    harness.ports.emit = { ...harness.ports.emit, failed, rateLimited };
    await loadBoardRows<Row>(harness.ports);
    expect(harness.rows[harness.rows.length - 1]).toEqual([]);
    expect(failed).toHaveBeenCalledTimes(1);
    expect(rateLimited).not.toHaveBeenCalled();
    expect(harness.loading).toEqual([true, false]);
    expect(warmFaces).not.toHaveBeenCalled();
  });

  it("keeps the last rows on a 429 and reports Retry-After instead of clearing the board", async () => {
    const { RateLimitError } = await import("../../src/preview/lib/page-fetch.js");
    const failed = vi.fn();
    const rateLimited = vi.fn();
    const harness = ports({ fetchRows: async () => { throw new RateLimitError("slow", 1500); } });
    harness.rows.push([{ id: 7, outcomes: [] }]);
    harness.ports.emit = { ...harness.ports.emit, failed, rateLimited };
    await loadBoardRows<Row>(harness.ports);
    expect(harness.rows).toEqual([[{ id: 7, outcomes: [] }]]);
    expect(rateLimited).toHaveBeenCalledWith(1500);
    expect(failed).not.toHaveBeenCalled();
    expect(harness.loading).toEqual([true, false]);
  });

  it("passes the API total through with the page size", async () => {
    const pageSize = vi.fn();
    const harness = ports({ fetchRows: async () => ({ rows: [{ id: 1, outcomes: [] }], isFree: false, total: 24 }) });
    harness.ports.emit = { ...harness.ports.emit, pageSize };
    await loadBoardRows<Row>(harness.ports);
    expect(pageSize).toHaveBeenCalledWith(1, 24);
  });

  it("keeps the board up when hydration fails", async () => {
    const harness = ports({
      hydrate: async () => { throw new Error("no outcomes"); },
    });
    await loadBoardRows<Row>(harness.ports);
    expect(harness.rows[harness.rows.length - 1]?.[0]?.id).toBe(1);
    expect(harness.loading).toEqual([true, false]);
  });

  it("goes silent once a newer load has replaced it", async () => {
    let live = true;
    const isFree = vi.fn();
    const pageSize = vi.fn();
    const facesReady = vi.fn();
    const harness = ports({
      isLive: () => live,
      fetchRows: async () => {
        live = false;
        return { rows: [{ id: 1, outcomes: [] }], isFree: true };
      },
    });
    harness.ports.emit.isFree = isFree;
    harness.ports.emit.facesReady = facesReady;
    Object.assign(harness.ports.emit, { pageSize });

    await loadBoardRows<Row>(harness.ports);
    await new Promise((resolve) => setTimeout(resolve, 0));

    // A stale run must not clear the loading flag the live run owns.
    expect(harness.loading).toEqual([true]);
    expect(harness.rows).toEqual([]);
    expect(isFree).not.toHaveBeenCalled();
    expect(pageSize).not.toHaveBeenCalled();
    expect(facesReady).not.toHaveBeenCalled();
  });

  it("keeps a stale run from reporting a rate limit", async () => {
    let live = true;
    const rateLimited = vi.fn();
    const harness = ports({
      isLive: () => live,
      fetchRows: async () => {
        live = false;
        throw new Error("Too many requests, please try again later.");
      },
    });
    Object.assign(harness.ports.emit, { rateLimited });
    await loadBoardRows<Row>(harness.ports);
    expect(rateLimited).not.toHaveBeenCalled();
    expect(harness.loading).toEqual([true]);
  });
});

describe("preview table sorting", () => {
  const columns = [
    { key: "name", label: "Name", sortValue: (r: { name: string; price: number }) => r.name, render: () => null },
    { key: "price", label: "Price", sortValue: (r: { name: string; price: number }) => r.price, render: () => null },
    { key: "open", label: "Open", render: () => null },
  ];
  const rows = [
    { name: "Beta", price: 300 },
    { name: "Alpha", price: 100 },
    { name: "Gamma", price: 200 },
  ];

  it("sorts numerically, not lexically", () => {
    const asc = sortRows(rows, columns[1], "asc").map((r) => r.price);
    expect(asc).toEqual([100, 200, 300]);
    const desc = sortRows(rows, columns[1], "desc").map((r) => r.price);
    expect(desc).toEqual([300, 200, 100]);
  });

  it("sorts strings locale-aware", () => {
    expect(sortRows(rows, columns[0], "asc").map((r) => r.name)).toEqual(["Alpha", "Beta", "Gamma"]);
  });

  it("leaves rows alone for an unsortable column", () => {
    expect(sortRows(rows, columns[2], "asc")).toBe(rows);
    expect(sortRows(rows, undefined, "asc")).toBe(rows);
  });

  it("does not mutate the input", () => {
    const before = rows.map((r) => r.name);
    sortRows(rows, columns[1], "desc");
    expect(rows.map((r) => r.name)).toEqual(before);
  });
});

describe("preview price scatter series", () => {
  it("folds every sale source into one series and keeps listings apart", () => {
    const groups = groupBySeries([
      { price_cents: 100, float_value: 0.1, source: "csfloat" },
      { price_cents: 120, float_value: 0.2, source: "dmarket" },
      { price_cents: 130, float_value: 0.3, source: "skinport_sale" },
      { price_cents: 140, float_value: 0.4, source: "buff_sale" },
      { price_cents: 150, float_value: 0.5, source: "sale" },
    ]);
    expect(groups.csfloat).toHaveLength(1);
    expect(groups.dmarket).toHaveLength(1);
    expect(groups.sales).toHaveLength(3);
    expect(groups.buff).toHaveLength(0);
  });

  it("drops rows with no float rather than plotting them at zero", () => {
    const groups = groupBySeries([
      { price_cents: 100, float_value: null, source: "csfloat" },
      { price_cents: 100, float_value: 0.5, source: "csfloat" },
    ]);
    expect(groups.csfloat).toHaveLength(1);
  });
});

describe("preview price scatter y-scale", () => {
  function nightwishCloud(): number[] {
    const bulk = Array.from({ length: 200 }, (_, i) => 5000 + (i % 40) * 50);
    return [...bulk, 302_900, 240_000, 160_000, 120_000, 80_000];
  }

  it("clips a Nightwish-like smear so the ~$60 cloud is readable", () => {
    const yMax = scatterYMaxDollars(nightwishCloud());
    expect(yMax).toBeGreaterThan(70);
    expect(yMax).toBeLessThan(250);
  });

  it("clips live Nightwish quantiles under a few hundred, not a few thousand", () => {
    const bulk = Array.from({ length: 190 }, (_, i) => 5500 + (i % 80) * 25);
    const mid = Array.from({ length: 10 }, (_, i) => 10_000 + i * 500);
    const tail = [14_900, 20_000, 33_600, 80_000, 302_900];
    const yMax = scatterYMaxDollars([...bulk, ...mid, ...tail]);
    expect(yMax).toBeGreaterThan(100);
    expect(yMax).toBeLessThanOrEqual(250);
  });

  it("does not clip a tight cloud with no outliers", () => {
    const prices = Array.from({ length: 80 }, (_, i) => 5900 + i * 10);
    const yMax = scatterYMaxDollars(prices);
    expect(yMax).toBeGreaterThanOrEqual(66.9);
    expect(yMax).toBeLessThan(150);
  });

  it("does not flatten a real wide spread", () => {
    const prices = Array.from({ length: 100 }, (_, i) => (100 + i * 19) * 100);
    const yMax = scatterYMaxDollars(prices);
    expect(yMax).toBeGreaterThan(1800);
  });

  it("plots outliers at the clip and keeps the real listing price", () => {
    const clipped = scatterPlotPoint(302_900, 120);
    expect(clipped.y).toBe(120);
    expect(clipped.clipped).toBe(true);
    expect(clipped.priceCents).toBe(302_900);

    const bulk = scatterPlotPoint(5960, 120);
    expect(bulk.y).toBeCloseTo(59.6);
    expect(bulk.clipped).toBe(false);
    expect(bulk.priceCents).toBe(5960);
  });

  it("leaves a handful of prices on their own max", () => {
    expect(scatterYMaxDollars([1200, 1800, 2400])).toBeGreaterThanOrEqual(24);
    expect(scatterYMaxDollars([])).toBe(1);
  });
});

describe("preview board paging", () => {
  it("appends a page instead of replacing the board", async () => {
    const pages: { id: number; outcomes: string[] }[][] = [];
    const emitted: { id: number; outcomes: string[] }[][] = [];
    await loadBoardRows<{ id: number; outcomes: string[] }>({
      fetchRows: async () => ({ rows: [{ id: 9, outcomes: [] }], isFree: false }),
      hydrate: async (row) => ({ ...row, outcomes: ["X"] }),
      namesOf: () => [],
      warmFaces: async () => undefined,
      append: true,
      emit: {
        rows: (next) => {
          const previous = emitted[emitted.length - 1] ?? [{ id: 1, outcomes: [] }];
          emitted.push(typeof next === "function" ? next(previous) : next);
        },
        isFree: () => {},
        loading: () => {},
        facesReady: () => {},
        pageSize: (count) => pages.push(new Array(count).fill({ id: 0, outcomes: [] })),
      },
    });
    expect(pages[0]).toHaveLength(1);
    // first emit appends the raw page, second swaps that page for the hydrated one
    expect(emitted[0]?.map((row) => row.id)).toEqual([1, 9]);
    expect(emitted[1]?.map((row) => row.id)).toEqual([1, 9]);
    expect(emitted[1]?.[1]?.outcomes).toEqual(["X"]);
  });

  it("keeps the existing rows when a page request fails, and reports the failure", async () => {
    const emitted: unknown[] = [];
    const failed = vi.fn();
    await loadBoardRows<{ id: number; outcomes: string[] }>({
      fetchRows: async () => { throw new Error("offline"); },
      hydrate: async (row) => row,
      namesOf: () => [],
      warmFaces: async () => undefined,
      append: true,
      emit: {
        rows: (next) => emitted.push(next),
        isFree: () => {},
        loading: () => {},
        facesReady: () => {},
        failed,
      },
    });
    expect(emitted).toEqual([]);
    expect(failed).toHaveBeenCalledTimes(1);
  });

  it("does not treat a 429 as an empty page and does not tight-loop", async () => {
    const { RateLimitError } = await import("../../src/preview/lib/page-fetch.js");
    const rateLimited = vi.fn();
    const emitted: unknown[] = [];
    const pageSize = vi.fn();
    await loadBoardRows<{ id: number; outcomes: string[] }>({
      fetchRows: async () => { throw new RateLimitError(); },
      hydrate: async (row) => row,
      namesOf: () => [],
      warmFaces: async () => undefined,
      append: true,
      emit: {
        rows: (next) => emitted.push(next),
        isFree: () => {},
        loading: () => {},
        facesReady: () => {},
        pageSize,
        rateLimited,
      },
    });
    expect(emitted).toEqual([]);
    expect(pageSize).not.toHaveBeenCalled();
    expect(rateLimited).toHaveBeenCalledTimes(1);
  });

  it("stops at the API total even when every page came back full", () => {
    expect(reachedTotal(2, 12, 24)).toBe(true);
    expect(reachedTotal(3, 12, 24)).toBe(true);
    expect(reachedTotal(1, 12, 24)).toBe(false);
    expect(reachedTotal(1, 12, 0)).toBe(true);
    expect(reachedTotal(5, 12, undefined)).toBe(false);
  });
});

type Props = { children?: ReactNode; onClick?: () => void; className?: string };

const markup = (node: ReactNode) => renderToStaticMarkup(createElement(Fragment, null, node));

function findButton(node: ReactNode, label: string): ReactElement<Props> | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findButton(child, label);
      if (hit) return hit;
    }
    return null;
  }
  if (!isValidElement<Props>(node)) return null;
  if (node.type === "button" && markup(node).includes(label)) return node;
  return findButton(node.props.children, label);
}

describe("preview board notice", () => {
  const base = { loading: false, rows: 0, throttled: false, failed: false, filtered: false };

  it("tells a filtered empty board apart from an empty scan", () => {
    expect(boardNotice({ ...base, filtered: true })).toBe("filtered-empty");
    expect(boardNotice(base)).toBe("empty");
  });

  it("shows nothing while loading or once rows are on the board", () => {
    expect(boardNotice({ ...base, loading: true })).toBeNull();
    expect(boardNotice({ ...base, rows: 12, filtered: true })).toBeNull();
  });

  it("reports a failed load as an error, never as an empty result", () => {
    expect(boardNotice({ ...base, failed: true, filtered: true })).toBe("error");
    expect(boardNotice({ ...base, failed: true, rows: 12 })).toBe("error");
  });

  it("lets a 429 win over every empty or error message", () => {
    expect(boardNotice({ ...base, throttled: true, filtered: true })).toBe("throttled");
    expect(boardNotice({ ...base, throttled: true, failed: true })).toBe("throttled");
  });

  it("renders the filtered empty copy with a Clear filters button", () => {
    const onClearFilters = vi.fn();
    const tree = BoardNotice({ notice: "filtered-empty", onClearFilters });
    const html = markup(tree);
    expect(html).toContain(FILTERED_EMPTY_COPY);
    expect(FILTERED_EMPTY_COPY).toBe("No trade-ups match these filters.");
    findButton(tree, "Clear filters")?.props.onClick?.();
    expect(onClearFilters).toHaveBeenCalledTimes(1);
  });

  it("renders a one-click suggestion that loosens the active filter", () => {
    const onApply = vi.fn();
    const tree = BoardNotice({
      notice: "filtered-empty",
      onClearFilters: vi.fn(),
      suggestion: { label: "Raise max cost to $40" },
      onApplySuggestion: onApply,
    });
    const html = markup(tree);
    expect(html).toContain("Raise max cost to $40");
    expect(html).toContain(FILTERED_EMPTY_COPY);
    findButton(tree, "Raise max cost to $40")?.props.onClick?.();
    expect(onApply).toHaveBeenCalledTimes(1);
  });

  it("renders the unfiltered empty copy with no buttons", () => {
    const html = markup(BoardNotice({ notice: "empty" }));
    expect(UNFILTERED_EMPTY_COPY).toBe("No live trade-ups right now. Check back after the next scan.");
    expect(html).toContain(UNFILTERED_EMPTY_COPY);
    expect(html).not.toContain("<button");
  });

  it("renders the error copy with a Retry button", () => {
    const onRetry = vi.fn();
    const tree = BoardNotice({ notice: "error", onRetry });
    const html = markup(tree);
    expect(LOAD_ERROR_COPY).toBe("Couldn't load trade-ups.");
    expect(html).toContain("Couldn&#x27;t load trade-ups.");
    expect(html).not.toContain(FILTERED_EMPTY_COPY);
    findButton(tree, "Retry")?.props.onClick?.();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("renders only the slow-down copy on a 429", () => {
    const html = markup(BoardNotice({ notice: "throttled" }));
    expect(html).toContain(SLOW_DOWN_COPY);
    expect(html).not.toContain(FILTERED_EMPTY_COPY);
    expect(html).not.toContain(UNFILTERED_EMPTY_COPY);
    expect(html).not.toContain("<button");
  });

  it("renders nothing without a notice", () => {
    expect(BoardNotice({ notice: null })).toBeNull();
  });
});

describe("preview filter bar Clear", () => {
  it("clears through onClear so search chips go too, even when only chips are set", () => {
    const onClear = vi.fn();
    const onChange = vi.fn();
    const tree = PreviewFilters({ query: DEFAULT_QUERY, onChange, onClear, canClear: true });
    const clear = findButton(tree, "Clear");
    expect(clear).not.toBeNull();
    clear?.props.onClick?.();
    expect(onClear).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("hides Clear when nothing is set", () => {
    const tree = PreviewFilters({ query: DEFAULT_QUERY, onChange: vi.fn(), onClear: vi.fn(), canClear: false });
    expect(findButton(tree, "Clear")).toBeNull();
  });

  it("still resets the query when no onClear is given", () => {
    const onChange = vi.fn();
    const tree = PreviewFilters({ query: { ...DEFAULT_QUERY, minChance: "40" }, onChange });
    findButton(tree, "Clear")?.props.onClick?.();
    expect(onChange).toHaveBeenCalledWith(DEFAULT_QUERY);
  });
});

const sourceDir = dirname(fileURLToPath(import.meta.url));
const readSource = (rel: string) => readFileSync(resolve(sourceDir, rel), "utf8");

describe("board request fan-out", () => {
  it("asks the list for embedded outcomes and inputs", () => {
    const url = new URL(boardListUrl("per_page=12&sort=trade_up_score&order=desc", 3), "http://x");
    expect(url.pathname).toBe("/api/trade-ups");
    expect(url.searchParams.get("include")).toBe(BOARD_LIST_INCLUDE);
    expect(BOARD_LIST_INCLUDE.split(",").sort()).toEqual(["inputs", "outcomes"]);
    expect(url.searchParams.get("page")).toBe("3");
    expect(url.searchParams.get("per_page")).toBe("12");
  });

  it("the board hook fetches through boardListUrl", () => {
    const board = readSource("../../src/preview/pages/PreviewBoard.tsx");
    expect(board).toContain("boardListUrl(settledKey, page)");
    expect(board).not.toMatch(/fetch\(`\/api\/trade-ups\?\$\{key\}&page=\$\{page\}`/);
  });

  it("an embedded row needs no per-row outcomes request", async () => {
    const fetchFn = vi.fn<typeof fetch>();
    const row = { id: 7, outcomes: [{ skin_name: "AK-47 | Redline" }] };
    await expect(hydrateOutcomesIfNeeded(row, fetchFn)).resolves.toBe(row);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe("landing stats only load on the landing page", () => {
  it("is true for the landing page and false for console pages", () => {
    expect(needsLandingStats("landing")).toBe(true);
    const others: ConsolePage[] = ["board", "skins", "skin", "collections", "collection", "calculator", "account", "pricing", "share"];
    for (const page of others) expect(needsLandingStats(page)).toBe(false);
  });

  it("PreviewApp gates its global-stats + board-count fetch on needsLandingStats", () => {
    const app = readSource("../../src/preview/PreviewApp.tsx");
    expect(app).toContain("needsLandingStats(page)");
    expect(app).toMatch(/if \(!wantsStats\) return;/);
  });
});
