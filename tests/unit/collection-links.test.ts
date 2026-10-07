import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CASE_KNIFE_MAP } from "../../server/engine/knife-data.js";
import { HIGH_VALUE_COLLECTIONS } from "../../server/sync/types.js";
import { collectionToSlug } from "../../shared/slugs.js";
import { collectionTradeUpLinks } from "../../shared/collection-links.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

/** The slug the trade-up detail related links used to emit. */
function legacyDetailSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

const MAP_COLLECTIONS = [
  "The Italy Collection",
  "The Dust Collection",
  "The Aztec Collection",
  "The Cache Collection",
  "The Overpass Collection",
  "The Train Collection",
  "The Mirage Collection",
  "The Inferno Collection",
  "The Nuke Collection",
  "The Vertigo Collection",
  "The Ancient Collection",
  "The 2021 Dust 2 Collection",
  "The 2021 Mirage Collection",
  "The 2021 Train Collection",
  "The 2021 Vertigo Collection",
];

const NAMES = [...new Set([
  ...Object.keys(CASE_KNIFE_MAP),
  ...HIGH_VALUE_COLLECTIONS,
  ...MAP_COLLECTIONS,
])];

describe("collectionTradeUpLinks", () => {
  it("uses the route slug for every known collection, not the-*-collection", () => {
    expect(NAMES.length).toBeGreaterThan(40);
    for (const name of NAMES) {
      const slug = collectionToSlug(name);
      const [link] = collectionTradeUpLinks([name]);
      expect(slug.length, name).toBeGreaterThan(0);
      expect(slug, name).not.toMatch(/^the-.+-collection$/);
      expect(link?.url, name).toBe(`/trade-ups/collection/${slug}`);
      const legacy = legacyDetailSlug(name);
      expect(legacy, name).toMatch(/^the-.+-collection$/);
      const stem = legacy.slice("the-".length, -"-collection".length);
      expect(stem, name).toBe(slug);
    }
  });

  it("points Dreams & Nightmares at dreams-nightmares", () => {
    expect(collectionTradeUpLinks(["The Dreams & Nightmares Collection"])).toEqual([
      {
        label: "Dreams & Nightmares Collection Trade-Ups",
        url: "/trade-ups/collection/dreams-nightmares",
      },
    ]);
  });

  it("keeps first-seen order, drops duplicates, and stops at two", () => {
    const links = collectionTradeUpLinks([
      "The Prisma 2 Collection",
      "The Prisma 2 Collection",
      "The Fracture Collection",
      "The Recoil Collection",
    ]);
    expect(links.map((link) => link.url)).toEqual([
      "/trade-ups/collection/prisma-2",
      "/trade-ups/collection/fracture",
    ]);
  });

  it("skips a blank name", () => {
    expect(collectionTradeUpLinks(["", "The Recoil Collection"])).toEqual([
      { label: "Recoil Collection Trade-Ups", url: "/trade-ups/collection/recoil" },
    ]);
  });
});

describe("trade-up detail related links", () => {
  const source = readFileSync(join(root, "server/trade-up-share-seo.ts"), "utf8");

  it("builds the related collection href with collectionTradeUpLinks", () => {
    expect(source).toContain("collectionTradeUpLinks");
    expect(source).not.toContain('toLowerCase().replace(/[^a-z0-9]+/g, "-")');
  });
});
