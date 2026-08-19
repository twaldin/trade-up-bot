import { describe, expect, it, vi } from "vitest";
import { loadBoardRows } from "../../src/preview/lib/board-load.js";
import {
  boardQueryString,
  DEFAULT_QUERY,
  isDefaultQuery,
} from "../../src/preview/components/PreviewFilters.js";
import { sortRows } from "../../src/preview/components/PreviewTable.js";
import { groupBySeries } from "../../src/preview/components/PriceScatter.js";

describe("preview board query", () => {
  it("sends only the parameters the trade-ups API accepts", () => {
    const params = new URLSearchParams(boardQueryString(DEFAULT_QUERY));
    expect([...params.keys()].sort()).toEqual(["order", "per_page", "sort"]);
    expect(params.get("sort")).toBe("trade_up_score");
    expect(params.get("order")).toBe("desc");
  });

  it("converts dollars to integer cents and percent to a fraction", () => {
    const params = new URLSearchParams(boardQueryString({
      ...DEFAULT_QUERY,
      minProfit: "1.27",
      maxCost: "50",
      minChance: "40",
    }));
    expect(params.get("min_profit")).toBe("127");
    expect(params.get("max_cost")).toBe("5000");
    expect(params.get("min_chance")).toBe("0.4");
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

  it("clears the board and stops loading when the list request fails", async () => {
    const warmFaces = vi.fn(async () => undefined);
    const harness = ports({
      fetchRows: async () => { throw new Error("offline"); },
      warmFaces,
    });
    await loadBoardRows<Row>(harness.ports);
    expect(harness.rows[harness.rows.length - 1]).toEqual([]);
    expect(harness.loading).toEqual([true, false]);
    expect(warmFaces).not.toHaveBeenCalled();
  });

  it("keeps the board up when hydration fails", async () => {
    const harness = ports({
      hydrate: async () => { throw new Error("no outcomes"); },
    });
    await loadBoardRows<Row>(harness.ports);
    expect(harness.rows[harness.rows.length - 1]?.[0]?.id).toBe(1);
    expect(harness.loading).toEqual([true, false]);
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

  it("keeps the existing rows when a page request fails", async () => {
    const emitted: unknown[] = [];
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
      },
    });
    expect(emitted).toEqual([]);
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
});
