import { describe, expect, it, vi } from "vitest";
import { loadBoardRows } from "../../src/preview/lib/board-load.js";

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
      rows: (next: Row[]) => { rows.push(next); },
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
