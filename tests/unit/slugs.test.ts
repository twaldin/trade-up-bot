import { describe, it, expect } from "vitest";
import { toSlug, fromSlug } from "../../shared/slugs.js";

describe("toSlug", () => {
  it("converts standard skin name", () => {
    expect(toSlug("AK-47 | Redline")).toBe("ak-47-redline");
  });

  it("strips star prefix from knives", () => {
    expect(toSlug("★ Butterfly Knife | Lore")).toBe("butterfly-knife-lore");
  });

  it("preserves weapon hyphens", () => {
    expect(toSlug("M4A1-S | Master Piece")).toBe("m4a1-s-master-piece");
    expect(toSlug("USP-S | Kill Confirmed")).toBe("usp-s-kill-confirmed");
  });

  it("strips special characters", () => {
    expect(toSlug("P250 | X-Ray")).toBe("p250-x-ray");
    expect(toSlug("MAC-10 | Neon Rider")).toBe("mac-10-neon-rider");
  });

  it("strips parentheses and dots", () => {
    expect(toSlug("M4A4 | In Living Color (holo)")).toBe("m4a4-in-living-color-holo");
  });

  it("collapses multiple hyphens", () => {
    expect(toSlug("★ Karambit | Fade")).toBe("karambit-fade");
  });

  it("handles gloves", () => {
    expect(toSlug("★ Sport Gloves | Hedge Maze")).toBe("sport-gloves-hedge-maze");
  });

  it("handles bare knife names (no finish)", () => {
    expect(toSlug("★ Navaja Knife")).toBe("navaja-knife");
  });
});

describe("fromSlug", () => {
  it("is the inverse lookup — tested in integration with DB", () => {
    expect(typeof fromSlug).toBe("function");
  });
});
