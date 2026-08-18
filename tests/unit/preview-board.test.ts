import { describe, expect, it } from "vitest";
import {
  bentoColumns,
  expandPushesOthers,
  groupedInputs,
  profitFill,
  profitLossSeries,
  tileClick,
} from "../../src/preview/lib/board.js";
import { makeTradeUp } from "../helpers/fixtures.js";

describe("preview board cards", () => {
  it("uses a compact 2–3 column bento on desktop and 1 on mobile", () => {
    expect(bentoColumns(390)).toBe(1);
    expect(bentoColumns(900)).toBe(2);
    expect(bentoColumns(1440)).toBe(3);
  });

  it("opens listing / outcome URLs on tile click and never treats that as expand", () => {
    const listing = tileClick("input", "https://csfloat.com/item/abc");
    const outcome = tileClick("output", "/skins/ak-47-fire-serpent?from=9");
    expect(listing).toEqual({ action: "open-listing", href: "https://csfloat.com/item/abc" });
    expect(outcome).toEqual({ action: "open-outcome", href: "/skins/ak-47-fire-serpent?from=9" });
    expect(listing.action).not.toBe("expand");
    expect(outcome.action).not.toBe("expand");
  });

  it("expands as a full-width row that pushes later cards down", () => {
    expect(expandPushesOthers(12, 12)).toBe(true);
    expect(expandPushesOthers(12, 13)).toBe(false);
  });

  it("builds a ~100px P/L series with lime for profit and charcoal for loss", () => {
    const up = profitLossSeries(2500);
    const down = profitLossSeries(-800);
    expect(up).toHaveLength(8);
    expect(up[7]?.v).toBe(25);
    expect(profitFill(2500)).toBe("lime");
    expect(profitFill(-800)).toBe("charcoal");
    expect(down[7]?.v).toBe(-8);
  });

  it("groups input skins so tiles can show ×N", () => {
    const tu = makeTradeUp({ listingIds: ["a", "b", "c", "d", "e"] });
    const groups = groupedInputs(tu.inputs);
    expect(groups[0]?.count).toBe(5);
    expect(groups[0]?.name).toBe("AK-47 | Redline");
  });
});
