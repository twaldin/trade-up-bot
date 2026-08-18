import { describe, expect, it, vi } from "vitest";
import {
  BYMYKEL_URL_RE,
  createFaceCache,
  faceCacheKey,
  faceFor,
  facesRequestUrl,
  hydrateOutcomesIfNeeded,
  isBlockedCatalogUrl,
  listSurvivesFaceError,
  loadFaces,
  namesFromCacheKey,
  rememberFaces,
} from "../../src/preview/lib/skin-images.js";
import { makeTradeUp } from "../helpers/fixtures.js";

describe("preview face cache keys", () => {
  it("round-trips names that contain the market-hash pipe", () => {
    const names = ["AK-47 | Nightwish", "Dual Berettas | Melondrama", "MP9 | Starlight Protector"];
    expect(namesFromCacheKey(faceCacheKey(names))).toEqual([...names].sort());
  });

  it("dedupes and drops blanks so the key is stable across renders", () => {
    const key = faceCacheKey(["B | Two", "", "A | One", "B | Two"]);
    expect(namesFromCacheKey(key)).toEqual(["A | One", "B | Two"]);
    expect(faceCacheKey(["A | One", "B | Two"])).toBe(key);
  });
});

describe("preview skin image cache", () => {
  it("stores name → stored Steam image_url and never accepts ByMykel catalog URLs", () => {
    const cache = createFaceCache();
    rememberFaces(cache, {
      "AK-47 | Redline": "https://community.fastly.steamstatic.com/economy/image/abc",
      "AWP | Asiimov": "https://raw.githubusercontent.com/ByMykel/CSGO-API/main/public/images/awp.png",
    });
    expect(faceFor(cache, "AK-47 | Redline")).toContain("steamstatic.com");
    expect(faceFor(cache, "AWP | Asiimov")).toBeNull();
    expect(isBlockedCatalogUrl("https://github.com/ByMykel/CSGO-API/blob/main/skins.json")).toBe(true);
    expect(BYMYKEL_URL_RE.test("https://raw.githubusercontent.com/ByMykel/CSGO-API/main/public/api/en/skins.json")).toBe(true);
  });

  it("does not fetch ByMykel JSON when hydrating faces", async () => {
    const cache = createFaceCache();
    const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      expect(url).not.toMatch(BYMYKEL_URL_RE);
      expect(url).toContain("/api/preview/faces");
      return new Response(JSON.stringify({ faces: { "AK-47 | Redline": "https://community.fastly.steamstatic.com/economy/image/abc" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    await loadFaces(["AK-47 | Redline"], cache, fetchFn as unknown as typeof fetch);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(facesRequestUrl(["AK-47 | Redline"])).toBe("/api/preview/faces?names=AK-47%20%7C%20Redline");
    expect(faceFor(cache, "AK-47 | Redline")).toContain("steamstatic");
  });

  it("keeps the list alive when the faces route is missing or returns HTML 404", async () => {
    const cache = createFaceCache();
    const html404 = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).not.toMatch(BYMYKEL_URL_RE);
      return new Response("<!doctype html><title>404</title>", {
        status: 404,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    });
    await loadFaces(["AK-47 | Redline"], cache, html404 as unknown as typeof fetch);
    expect(faceFor(cache, "AK-47 | Redline")).toBeNull();
    expect(listSurvivesFaceError(404, "text/html")).toBe(true);
    expect(listSurvivesFaceError(200, "application/json")).toBe(true);
  });

  it("hydrates empty outcomes via GET /api/trade-up/:id/outcomes", async () => {
    const tu = makeTradeUp({ outcomes: [] });
    const fetchFn = vi.fn(async () =>
      new Response(JSON.stringify({
        outcomes: [{
          skin_id: "out-1",
          skin_name: "AK-47 | Fire Serpent",
          collection_name: "Test Collection",
          probability: 1,
          predicted_float: 0.15,
          predicted_condition: "Field-Tested",
          estimated_price_cents: 12000,
        }],
      }), { status: 200, headers: { "content-type": "application/json" } }),
    );
    const hydrated = await hydrateOutcomesIfNeeded(tu, fetchFn as unknown as typeof fetch);
    expect(fetchFn).toHaveBeenCalledWith(`/api/trade-up/${tu.id}/outcomes`, { credentials: "include" });
    expect(hydrated.outcomes).toHaveLength(1);
  });
});
