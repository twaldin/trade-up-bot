import { describe, expect, it } from "vitest";
import {
  COLLECTION_EMPTY_COPY,
  RATE_LIMIT_COPY,
  applyBoardFetch,
  collectionTradeUpsCopy,
  parseTradeUpsResponse,
  type BoardSnapshot,
} from "../../src/lib/trade-ups-board.js";
import { makeTradeUp } from "../helpers/fixtures.js";

const empty: BoardSnapshot = { tradeUps: [], total: 0, totalProfitable: 0, loadKind: "ok" };

describe("collection trade-ups under a 429", () => {
  it("says rate-limited, not 'no trade-ups found', when the first load is throttled", () => {
    const snap = applyBoardFetch(empty, parseTradeUpsResponse(429, false, "Too many requests, please try again later."));
    expect(collectionTradeUpsCopy({ loading: false, snapshot: snap })).toBe(RATE_LIMIT_COPY);
  });

  it("keeps the last good rows on a throttled refetch and says so", () => {
    const good = applyBoardFetch(empty, parseTradeUpsResponse(200, true, { trade_ups: [makeTradeUp()], total: 1 }));
    const throttled = applyBoardFetch(good, parseTradeUpsResponse(429, false, null));
    expect(throttled.tradeUps).toHaveLength(1);
    expect(collectionTradeUpsCopy({ loading: false, snapshot: throttled })).toBe(RATE_LIMIT_COPY);
  });

  it("only claims the collection has none after a real empty answer", () => {
    const none = applyBoardFetch(empty, parseTradeUpsResponse(200, true, { trade_ups: [], total: 0 }));
    expect(collectionTradeUpsCopy({ loading: false, snapshot: none })).toBe(COLLECTION_EMPTY_COPY);
    expect(collectionTradeUpsCopy({ loading: true, snapshot: empty })).toBeNull();
    const rows = applyBoardFetch(empty, parseTradeUpsResponse(200, true, { trade_ups: [makeTradeUp()], total: 1 }));
    expect(collectionTradeUpsCopy({ loading: false, snapshot: rows })).toBeNull();
  });
});
