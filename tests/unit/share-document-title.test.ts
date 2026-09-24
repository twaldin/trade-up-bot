import { describe, expect, it } from "vitest";
import {
  tradeUpDescription,
  tradeUpDocumentTitle,
  tradeUpH1,
  tradeUpOgTitle,
  tradeUpPair,
} from "../../shared/copy.js";

const knife = [{ skin_name: "★ Butterfly Knife | Fade", probability: 1 }];
const gloves = [{ skin_name: "★ Sport Gloves | Vice", probability: 0.6 }, { skin_name: "★ Hand Wraps | Cobalt Skulls", probability: 0.4 }];
const mixed = [{ skin_name: "★ Karambit | Doppler", probability: 0.5 }, { skin_name: "★ Specialist Gloves | Crimson Kimono", probability: 0.5 }];

describe("tradeUpPair", () => {
  it("names every standard pair, staircase, and unknown", () => {
    expect(tradeUpPair("consumer_industrial")).toBe("Consumer to Industrial");
    expect(tradeUpPair("industrial_milspec")).toBe("Industrial to Mil-Spec");
    expect(tradeUpPair("milspec_restricted")).toBe("Mil-Spec to Restricted");
    expect(tradeUpPair("restricted_classified")).toBe("Restricted to Classified");
    expect(tradeUpPair("classified_covert")).toBe("Classified to Covert");
    expect(tradeUpPair("staircase")).toBe("Staircase");
    expect(tradeUpPair("mystery")).toBe("CS2");
  });

  it("splits knife-only, gloves-only, and mixed outputs", () => {
    expect(tradeUpPair("covert_knife", knife)).toBe("Covert to Knife");
    expect(tradeUpPair("covert_knife", gloves)).toBe("Covert to Gloves");
    expect(tradeUpPair("covert_knife", mixed)).toBe("Covert to Knife/Glove");
    expect(tradeUpPair("covert_knife", [])).toBe("Covert to Knife/Glove");
  });
});

describe("tradeUpDocumentTitle", () => {
  it("uses a collection when no output reaches 0.5", () => {
    const title = tradeUpDocumentTitle("classified_covert", [
      { skin_name: "AK-47 | Asiimov", probability: 0.49 },
    ], ["The Recoil Collection"]);
    expect(title).toBe("Classified to Covert Trade-Up: Recoil | TradeUpBot");
    expect(title).not.toContain("%");
  });

  it("uses the likeliest output name at the 0.5 threshold and strips stars", () => {
    const title = tradeUpDocumentTitle("classified_covert", [
      { skin_name: "★ AK-47 | Asiimov", probability: 0.5 },
      { skin_name: "AWP | Graphite", probability: 0.5 },
    ], ["The Recoil Collection"]);
    expect(title).toBe("Classified to Covert Trade-Up: AK-47 Asiimov | TradeUpBot");
  });

  it("never puts a knife or glove name in the title", () => {
    expect(tradeUpDocumentTitle("covert_knife", knife, ["The Dreams & Nightmares Collection"]))
      .toBe("Covert to Knife Trade-Up: Dreams & Nightmares | TradeUpBot");
    expect(tradeUpDocumentTitle("covert_knife", gloves, ["The Glove Collection"]))
      .toBe("Covert to Gloves Trade-Up: Glove | TradeUpBot");
  });

  it("joins two collections and drops Trade-Up when that is what fits", () => {
    const title = tradeUpDocumentTitle("milspec_restricted", [
      { skin_name: "P250 | Sand Dune", probability: 0.2 },
    ], ["The Prisma 2 Collection", "The Fracture Collection"]);
    expect(title).toBe("Mil-Spec to Restricted: Prisma 2 + Fracture | TradeUpBot");
    expect(title.length).toBeLessThanOrEqual(60);
  });

  it("joins three collections as the first plus N more", () => {
    const title = tradeUpDocumentTitle("restricted_classified", [], [
      "Recoil", "Fracture", "Prisma",
    ]);
    expect(title).toBe("Restricted to Classified: Recoil + 2 more | TradeUpBot");
  });

  it("falls back to the first collection, then the pair alone, and stays within 60 characters", () => {
    const longName = "AK-47 Asiimov Souvenir Factory New Extraordinary";
    const firstOnly = tradeUpDocumentTitle("classified_covert", [
      { skin_name: longName, probability: 0.9 },
    ], ["Recoil"]);
    expect(firstOnly).toBe("Classified to Covert Trade-Up: Recoil | TradeUpBot");
    expect(firstOnly.length).toBeLessThanOrEqual(60);

    const bare = tradeUpDocumentTitle("classified_covert", [
      { skin_name: longName, probability: 0.9 },
    ], ["A Collection Name That Is Far Too Long For Any Title Slot"]);
    expect(bare).toBe("Classified to Covert Trade-Up | TradeUpBot");
    expect(bare.length).toBeLessThanOrEqual(60);
    expect(bare).not.toContain("%");
  });

  it("labels staircase without an output name", () => {
    expect(tradeUpDocumentTitle("staircase", [
      { skin_name: "★ Butterfly Knife | Fade", probability: 1 },
    ], ["The Fever Collection"])).toBe("Staircase Trade-Up: Butterfly Knife Fade | TradeUpBot");
  });
});

describe("tradeUp H1, description, and og:title", () => {
  it("builds the H1 from the pair and keeps the percentage out of titles", () => {
    expect(tradeUpH1("classified_covert", 4120, 12.3, [])).toBe(
      "Classified to Covert Trade-Up — $41.20 Expected P/L (12.3% ROI)",
    );
    const og = tradeUpOgTitle("classified_covert", 4120);
    expect(og).toBe("Classified to Covert: +$41.20 Expected P/L | TradeUpBot");
    expect(og.length).toBeLessThanOrEqual(60);
    expect(og).not.toContain("%");
  });

  it("caps a huge og:title at 60 characters", () => {
    const og = tradeUpOgTitle("classified_covert", -1e17);
    expect(og.length).toBe(60);
    expect(og.startsWith("Classified to Covert")).toBe(true);
  });

  it("puts the percentage only in the description, with the cost and inputs", () => {
    const description = tradeUpDescription({
      type: "classified_covert",
      profitCents: -1234,
      costCents: 5000,
      chanceToProfit: 0.996,
      inputNames: ["★ AK-47 | Redline", "AWP | Graphite"],
    });
    expect(description).toBe(
      "-$12.34 expected P/L after fees, >99% of outcomes above cost, $50.00 cost. Inputs: AK-47 Redline, AWP Graphite.",
    );
  });
});
