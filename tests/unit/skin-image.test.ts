import { describe, expect, it } from "vitest";
import {
  indexByMykelSkins,
  isUsableImageUrl,
  normalizeSkinLookupName,
  resolveSkinImageUrl,
} from "../../shared/skin-image.js";

describe("isUsableImageUrl", () => {
  it("accepts absolute http(s) URLs", () => {
    expect(isUsableImageUrl("https://community.akamai.steamstatic.com/economy/image/abc")).toBe(true);
    expect(isUsableImageUrl("http://example.test/skin.webp")).toBe(true);
  });

  it("rejects missing, relative, or non-http values", () => {
    expect(isUsableImageUrl(null)).toBe(false);
    expect(isUsableImageUrl(undefined)).toBe(false);
    expect(isUsableImageUrl("")).toBe(false);
    expect(isUsableImageUrl("/favicon.svg")).toBe(false);
    expect(isUsableImageUrl("javascript:alert(1)")).toBe(false);
  });
});

describe("normalizeSkinLookupName", () => {
  it("strips wear and StatTrak/Souvenir prefixes", () => {
    expect(normalizeSkinLookupName("StatTrak™ AK-47 | Redline (Field-Tested)")).toBe("AK-47 | Redline");
    expect(normalizeSkinLookupName("★ Karambit | Fade")).toBe("★ Karambit | Fade");
    expect(normalizeSkinLookupName("Souvenir AWP | Dragon Lore (Factory New)")).toBe("AWP | Dragon Lore");
  });
});

describe("resolveSkinImageUrl", () => {
  const catalog = indexByMykelSkins([
    { name: "AK-47 | Redline", image: "https://community.akamai.steamstatic.com/economy/image/redline" },
    { name: "★ Karambit | Fade", image: "https://cdn.steamstatic.com/apps/730/icons/fade.png" },
    { name: "broken", image: "/relative.png" },
  ]);

  it("prefers a stored usable URL over the catalog", () => {
    expect(resolveSkinImageUrl(
      "AK-47 | Redline",
      "https://example.test/stored.png",
      catalog,
    )).toBe("https://example.test/stored.png");
  });

  it("falls back to ByMykel/Steam catalog by exact then normalized name", () => {
    expect(resolveSkinImageUrl("AK-47 | Redline", null, catalog))
      .toBe("https://community.akamai.steamstatic.com/economy/image/redline");
    expect(resolveSkinImageUrl("StatTrak™ AK-47 | Redline (Field-Tested)", null, catalog))
      .toBe("https://community.akamai.steamstatic.com/economy/image/redline");
  });

  it("returns null only after stored and catalog miss", () => {
    expect(resolveSkinImageUrl("Unknown Skin | Invented", null, catalog)).toBe(null);
    expect(resolveSkinImageUrl("broken", null, catalog)).toBe(null);
  });
});
