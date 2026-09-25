import { describe, expect, it } from "vitest";
import { dopplerBaseName, withDopplerFaces } from "../../shared/doppler-face.js";
import { facesFromRows, parseFaceNames } from "../../server/routes/preview-faces.js";

describe("preview faces lookup", () => {
  it("parses pipe-delimited names and caps the batch", () => {
    expect(parseFaceNames("AK-47 | Redline||AWP | Asiimov")).toEqual([
      "AK-47 | Redline",
      "AWP | Asiimov",
    ]);
    expect(parseFaceNames("")).toEqual([]);
    const many = Array.from({ length: 120 }, (_, i) => `Skin ${i}`).join("||");
    expect(parseFaceNames(many)).toHaveLength(80);
  });

  it("maps stored image_url without inventing catalog fetches", () => {
    expect(facesFromRows([
      { name: "AK-47 | Redline", image_url: "https://community.fastly.steamstatic.com/economy/image/abc" },
      { name: "Ghost", image_url: null },
    ])).toEqual({
      "AK-47 | Redline": "https://community.fastly.steamstatic.com/economy/image/abc",
      Ghost: null,
    });
  });

  it("resolves Doppler and Gamma Doppler phases to the base finish image", () => {
    expect(dopplerBaseName("★ Karambit | Doppler Phase 2")).toBe("★ Karambit | Doppler");
    expect(dopplerBaseName("★ Karambit | Doppler Ruby")).toBe("★ Karambit | Doppler");
    expect(dopplerBaseName("★ Karambit | Doppler Sapphire")).toBe("★ Karambit | Doppler");
    expect(dopplerBaseName("★ Karambit | Doppler Black Pearl")).toBe("★ Karambit | Doppler");
    expect(dopplerBaseName("★ M9 Bayonet | Gamma Doppler Emerald")).toBe("★ M9 Bayonet | Gamma Doppler");
    expect(dopplerBaseName("★ M9 Bayonet | Gamma Doppler Phase 1")).toBe("★ M9 Bayonet | Gamma Doppler");
    expect(dopplerBaseName("★ Karambit | Doppler")).toBeNull();
    const base = "https://community.fastly.steamstatic.com/economy/image/doppler";
    const gamma = "https://community.fastly.steamstatic.com/economy/image/gamma";
    const faces = withDopplerFaces(
      ["★ Karambit | Doppler Phase 2", "★ Karambit | Doppler Ruby", "★ M9 Bayonet | Gamma Doppler Emerald"],
      {
        "★ Karambit | Doppler": base,
        "★ M9 Bayonet | Gamma Doppler": gamma,
      },
    );
    expect(faces["★ Karambit | Doppler Phase 2"]).toBe(base);
    expect(faces["★ Karambit | Doppler Ruby"]).toBe(base);
    expect(faces["★ M9 Bayonet | Gamma Doppler Emerald"]).toBe(gamma);
  });
});
