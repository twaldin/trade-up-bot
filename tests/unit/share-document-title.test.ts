import { describe, expect, it } from "vitest";
import {
  detailTradeUpDocumentTitle,
  detailTradeUpHeading,
  shareDocumentTitle,
  tradeUpCountPhrase,
} from "../../shared/copy.js";

describe("shareDocumentTitle", () => {
  it("strips ★ and turns ' | ' inside names into a space", () => {
    const title = shareDocumentTitle("Covert", 4120, [
      { skin_name: "★ Butterfly Knife | Fade", probability: 0.2 },
      { skin_name: "★ Karambit | Doppler", probability: 0.8 },
    ]);
    expect(title).toBe("Karambit Doppler: +$41.20 Expected P/L | TradeUpBot");
    expect(title).not.toContain("★");
    expect(title).not.toContain("%");
    expect(title.length).toBeLessThanOrEqual(60);
  });

  it("uses the butterfly example when that outcome is likeliest", () => {
    const title = shareDocumentTitle("Knife/Glove", 4120, [
      { skin_name: "★ Butterfly Knife | Fade", probability: 0.62 },
    ]);
    expect(title).toBe("Butterfly Knife Fade: +$41.20 Expected P/L | TradeUpBot");
  });

  it("falls back to the type label when the name form exceeds 60 characters", () => {
    const title = shareDocumentTitle("Knife/Glove", -1234, [
      { skin_name: "★ Sport Gloves | Vice Specialist Extraordinary", probability: 1 },
    ]);
    expect(title).toBe("Knife/Glove Trade-Up: -$12.34 Expected P/L | TradeUpBot");
    expect(title.length).toBeLessThanOrEqual(60);
    expect(title).not.toContain("%");
  });

  it("falls back to CS2 Trade-Up when the type label form is still too long", () => {
    const title = shareDocumentTitle("Extraordinary Collectible", -1234, [
      { skin_name: "★ A Very Long Outcome Name That Cannot Fit", probability: 1 },
    ]);
    expect(title).toBe("CS2 Trade-Up: -$12.34 Expected P/L | TradeUpBot");
    expect(title.length).toBeLessThanOrEqual(60);
  });

  it("caps a still-too-long generic title at 60 characters", () => {
    const title = shareDocumentTitle("Extraordinary Collectible", -1e17, []);
    expect(title.length).toBe(60);
    expect(title.startsWith("CS2 Trade-Up:")).toBe(true);
    expect(title).not.toContain("%");
  });

  it("signs negative expected P/L", () => {
    const title = shareDocumentTitle("Knife/Glove", -1234, [
      { skin_name: "AK-47 | Redline", probability: 0.4 },
    ]);
    expect(title).toBe("AK-47 Redline: -$12.34 Expected P/L | TradeUpBot");
  });
});

describe("detailTradeUpHeading", () => {
  it("names input rarity to output rarity", () => {
    expect(detailTradeUpHeading("classified_covert")).toBe("Classified to Covert Trade-Up");
    expect(detailTradeUpHeading("covert_knife")).toBe("Covert to Knife/Glove Trade-Up");
    expect(detailTradeUpHeading("restricted_classified")).toBe("Restricted to Classified Trade-Up");
  });

  it("keeps the current detail title tail", () => {
    expect(detailTradeUpDocumentTitle("classified_covert", 3509, "32%")).toBe(
      "Classified to Covert Trade-Up — $35.09 expected P/L (32% above cost) | TradeUpBot",
    );
  });
});

describe("tradeUpCountPhrase", () => {
  it("singularizes one trade-up", () => {
    expect(tradeUpCountPhrase(1)).toBe("1 trade-up");
    expect(tradeUpCountPhrase(3)).toBe("3 trade-ups");
  });
});
