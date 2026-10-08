import { describe, expect, it } from "vitest";
import {
  TRADE_UP_LOCK_ORDER_RULE,
  ascendingInputKeys,
  ascendingNumberIds,
  ascendingTextIds,
} from "../../server/engine/lock-order.js";

describe("trade-up lock order", () => {
  it("states the ascending id rule in one sentence", () => {
    expect(TRADE_UP_LOCK_ORDER_RULE).toBe(
      "Every transaction that locks more than one row of trade_ups, trade_up_inputs, or listings takes those locks one row at a time in ascending id order; trade_up_inputs has no id column, so those rows lock in ascending (trade_up_id, listing_id) order.",
    );
  });

  it("sorts trade-up ids ascending and drops duplicates", () => {
    expect(ascendingNumberIds([8, 3, 3, 11, 1])).toEqual([1, 3, 8, 11]);
  });

  it("sorts listing ids ascending", () => {
    expect(ascendingTextIds(["dmarket:b", "dmarket:a", "dmarket:b"])).toEqual(["dmarket:a", "dmarket:b"]);
  });

  it("sorts input rows by trade_up_id then listing_id", () => {
    expect(ascendingInputKeys([
      { tradeUpId: 4, listingId: "b" },
      { tradeUpId: 2, listingId: "b" },
      { tradeUpId: 2, listingId: "a" },
      { tradeUpId: 2, listingId: "a" },
    ])).toEqual([
      { tradeUpId: 2, listingId: "a" },
      { tradeUpId: 2, listingId: "b" },
      { tradeUpId: 4, listingId: "b" },
    ]);
  });
});
