import { describe, it, expect } from "vitest";
import { dopplerPhaseFromPaintIndex } from "../../server/sync/doppler-phases.js";

describe("dopplerPhaseFromPaintIndex", () => {
  describe("regular Doppler", () => {
    it("412 → Phase 1", () => expect(dopplerPhaseFromPaintIndex(412, "★ Karambit | Doppler")).toBe("Phase 1"));
    it("413 → Phase 2", () => expect(dopplerPhaseFromPaintIndex(413, "★ Karambit | Doppler")).toBe("Phase 2"));
    it("414 → Phase 3", () => expect(dopplerPhaseFromPaintIndex(414, "★ Karambit | Doppler")).toBe("Phase 3"));
    it("415 → Phase 4", () => expect(dopplerPhaseFromPaintIndex(415, "★ Karambit | Doppler")).toBe("Phase 4"));
    it("416 → Ruby",    () => expect(dopplerPhaseFromPaintIndex(416, "★ Karambit | Doppler")).toBe("Ruby"));
    it("417 → Sapphire", () => expect(dopplerPhaseFromPaintIndex(417, "★ Karambit | Doppler")).toBe("Sapphire"));
    it("418 → Black Pearl", () => expect(dopplerPhaseFromPaintIndex(418, "★ Karambit | Doppler")).toBe("Black Pearl"));
    it("unknown index → null", () => expect(dopplerPhaseFromPaintIndex(999, "★ Karambit | Doppler")).toBeNull());
  });

  describe("Gamma Doppler", () => {
    it("568 → Phase 1", () => expect(dopplerPhaseFromPaintIndex(568, "★ M9 Bayonet | Gamma Doppler")).toBe("Phase 1"));
    it("572 → Emerald", () => expect(dopplerPhaseFromPaintIndex(572, "★ M9 Bayonet | Gamma Doppler")).toBe("Emerald"));
    it("unknown index → null", () => expect(dopplerPhaseFromPaintIndex(999, "★ M9 Bayonet | Gamma Doppler")).toBeNull());
  });

  describe("non-Doppler skins", () => {
    it("returns null for Fade", () => expect(dopplerPhaseFromPaintIndex(412, "★ Karambit | Fade")).toBeNull());
    it("returns null for non-knife", () => expect(dopplerPhaseFromPaintIndex(412, "AK-47 | Redline")).toBeNull());
  });
});
