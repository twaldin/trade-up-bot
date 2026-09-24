import { describe, expect, it, vi } from "vitest";
import {
  BYMYKEL_URL_RE,
  createFaceCache,
  FACE_BATCH_SIZE,
  FACE_TIMEOUT_MS,
  faceBatches,
  faceCacheKey,
  faceFor,
  faceOrderKey,
  facesRequestUrl,
  hydrateOutcomesIfNeeded,
  isBlockedCatalogUrl,
  listSurvivesFaceError,
  loadFaces,
  namesFromCacheKey,
  rememberFaces,
} from "../../src/preview/lib/skin-images.js";
import { parseFaceNames } from "../../server/routes/preview-faces.js";
import { makeTradeUp } from "../helpers/fixtures.js";

/** Grid order the way /skins renders it: listing count, not alphabetical. */
const GRID = [
  "AK-47 | Redline",
  "AK-47 | Slate",
  "MP5-SD | Neon Squeezer",
  "Negev | Wall Bang",
  ...Array.from({ length: 196 }, (_, i) => `AK-47 | Aquamarine ${String(i).padStart(3, "0")}`),
];

function namesInRequest(input: RequestInfo | URL): string[] {
  const url = new URL(String(input), "http://preview.test");
  return parseFaceNames(url.searchParams.get("names"));
}

function facesResponder(requested: string[][]) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const names = namesInRequest(input);
    requested.push(names);
    const faces = Object.fromEntries(names.map((name) => [name, `https://community.fastly.steamstatic.com/economy/image/${encodeURIComponent(name)}`]));
    return new Response(JSON.stringify({ faces }), { status: 200, headers: { "content-type": "application/json" } });
  });
}

describe("preview faces follow the rendered grid", () => {
  it("never sends a batch the server would truncate", () => {
    expect(FACE_BATCH_SIZE).toBeLessThanOrEqual(80);
    const batches = faceBatches(GRID);
    for (const batch of batches) {
      expect(parseFaceNames(new URL(facesRequestUrl(batch), "http://preview.test").searchParams.get("names"))).toHaveLength(batch.length);
    }
    expect(batches.flat()).toEqual(GRID);
  });

  it("batches in render order so the first screen goes first", () => {
    const [first] = faceBatches(GRID);
    expect(first.slice(0, 4)).toEqual(["AK-47 | Redline", "AK-47 | Slate", "MP5-SD | Neon Squeezer", "Negev | Wall Bang"]);
    expect(first).toHaveLength(FACE_BATCH_SIZE);
  });

  it("dedupes and drops blanks without re-sorting", () => {
    expect(faceBatches(["B | Two", "", "A | One", "B | Two"])).toEqual([["B | Two", "A | One"]]);
    expect(namesFromCacheKey(faceOrderKey(["B | Two", "", "A | One", "B | Two"]))).toEqual(["B | Two", "A | One"]);
  });

  it("fills every tile of a 200-row page, top listing-count skins included", async () => {
    const cache = createFaceCache();
    const requested: string[][] = [];
    await loadFaces(GRID, cache, facesResponder(requested) as unknown as typeof fetch);
    expect(requested.every((batch) => batch.length <= FACE_BATCH_SIZE)).toBe(true);
    expect(new Set(requested.flat())).toEqual(new Set(GRID));
    for (const name of ["AK-47 | Redline", "AK-47 | Slate", "MP5-SD | Neon Squeezer"]) {
      expect(faceFor(cache, name)).toContain("steamstatic");
    }
  });

  it("does not refetch names whose batch is still in flight", async () => {
    const cache = createFaceCache();
    const requested: string[][] = [];
    const respond = facesResponder(requested);
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
      await gate;
      return respond(input);
    });
    const firstPage = loadFaces(GRID.slice(0, 100), cache, fetchFn as unknown as typeof fetch);
    const bothPages = loadFaces(GRID, cache, fetchFn as unknown as typeof fetch);
    release();
    await Promise.all([firstPage, bothPages]);
    const flat = requested.flat();
    expect(flat).toHaveLength(new Set(flat).size);
    expect(new Set(flat)).toEqual(new Set(GRID));
    expect(faceFor(cache, "AK-47 | Redline")).toContain("steamstatic");
  });
});

describe("preview face loading is bounded", () => {
  it("gives up on a faces route that never answers", async () => {
    const cache = createFaceCache();
    const fetchFn = vi.fn(() => new Promise<Response>(() => {}));
    const started = Date.now();
    await loadFaces(["AK-47 | Redline"], cache, fetchFn as unknown as typeof fetch, 30);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(faceFor(cache, "AK-47 | Redline")).toBeNull();
  });

  it("keeps whatever landed before the deadline", async () => {
    const cache = createFaceCache();
    const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("/api/preview/faces")) {
        return new Response(
          JSON.stringify({ faces: { "AK-47 | Redline": "https://steamcommunity.com/economy/image/x" } }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Promise<Response>(() => {});
    });
    await loadFaces(["AK-47 | Redline"], cache, fetchFn as unknown as typeof fetch, 50);
    expect(faceFor(cache, "AK-47 | Redline")).toContain("steamcommunity.com");
  });

  it("defaults to a short deadline so a dead route cannot stall the board", () => {
    expect(FACE_TIMEOUT_MS).toBeLessThanOrEqual(2000);
  });
});

describe("preview faces under the rate limit", () => {
  it("treats a 429 as rate-limited, not as a missing faces route: no /__face/ fan-out", async () => {
    const { browseHeldUntil, resetBrowseFetchState } = await import("../../src/preview/lib/page-fetch.js");
    resetBrowseFetchState();
    const cache = createFaceCache();
    const names = Array.from({ length: 60 }, (_, i) => `AK-47 | Skin ${i}`);
    // express-rate-limit's default 429 body is a string, served as text/html.
    const fetchFn = vi.fn(async (_input: RequestInfo | URL) => new Response("Too many requests, please try again later.", {
      status: 429,
      headers: { "content-type": "text/html; charset=utf-8", "retry-after": "20" },
    }));
    const before = Date.now();
    await loadFaces(names, cache, fetchFn as unknown as typeof fetch, 200);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn.mock.calls.every(([url]) => String(url).startsWith("/api/preview/faces"))).toBe(true);
    expect(browseHeldUntil()).toBeGreaterThanOrEqual(before + 20_000);
    resetBrowseFetchState();
  });

  it("still scrapes when the host really has no faces route", async () => {
    const cache = createFaceCache();
    const fetchFn = vi.fn(async (input: RequestInfo | URL) => (String(input).startsWith("/api/preview/faces")
      ? new Response("<html>not found</html>", { status: 404, headers: { "content-type": "text/html" } })
      : new Response("<html></html>", { status: 200, headers: { "content-type": "text/html" } })));
    await loadFaces(["AWP | Asiimov"], cache, fetchFn as unknown as typeof fetch, 200);
    expect(fetchFn.mock.calls.some(([url]) => String(url).startsWith("/__face/"))).toBe(true);
  });
});

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
