import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const dir = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(resolve(dir, rel), "utf8");

const skins = read("../../src/preview/pages/PreviewSkins.tsx");
const css = read("../../src/preview/preview.css");
const table = read("../../src/preview/components/PreviewTable.tsx");

const statsStart = skins.indexOf("export function SkinStats");
const pageStart = skins.indexOf("export function PreviewSkinPage");
const collectionStart = skins.indexOf("export function PreviewCollectionPage");
const stats = skins.slice(statsStart, pageStart);
const skinPage = skins.slice(pageStart, collectionStart);

describe("skin detail listings cannot bury the trade-up board", () => {
  it("keeps the chart full-width above listings and the board", () => {
    expect(stats).toContain("preview-skin-detail__chart");
    expect(stats).toContain("PriceScatter");
    expect(stats).toContain("preview-skin-panes");
    expect(stats.indexOf("preview-skin-detail__chart")).toBeLessThan(stats.indexOf("preview-skin-panes"));
    expect(skinPage).toContain('heading="Trade-ups using this skin"');
    expect(skinPage).toContain("skin: name");
    expect(skinPage).toContain("lockedSkin={name}");
    expect(skinPage).toContain("embed");
  });

  it("puts listings and the board side by side on wide, and behind a tab on narrow", () => {
    expect(stats).toContain("preview-skin-tabs");
    expect(stats).toContain('aria-label="Skin detail"');
    expect(stats).toContain("Listings");
    expect(stats).toContain("Trade-ups");
    expect(stats).toContain('data-pane="listings"');
    expect(stats).toContain('data-pane="tradeups"');
    expect(css).toContain(".preview-skin-tabs");
    expect(css).toContain(".preview-skin-panes");
    expect(css).toContain(".preview-skin-pane--listings");
    expect(css).toContain(".preview-skin-pane--board");
    expect(css).toMatch(/\.preview-skin-panes\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
    expect(css).toMatch(/@media \(min-width: 1100px\)[\s\S]*\.preview-skin-panes\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(0,\s*1fr\)/);
    expect(css).toMatch(/@media \(min-width: 1100px\)[\s\S]*\.preview-skin-tabs\.preview-tabs\s*\{[^}]*display:\s*none/);
  });

  it("caps listings overflow inside its pane and never page-scrolls the board away", () => {
    expect(stats).toContain("preview-skin-pane--listings");
    expect(stats).toContain("LISTING_PAGE");
    expect(stats).toContain("listingMatchesQuery");
    expect(stats).not.toContain("listings.slice(0, 60)");
    expect(stats).not.toContain("slice(0, 200)");
    expect(css).toMatch(/\.preview-skin-pane--listings\s*\{[^}]*overflow-y:\s*auto/);
    expect(css).toMatch(/\.preview-skin-pane--listings\s*\{[^}]*max-height:/);
  });

  it("makes the listings table a real scrollport instead of a clipped wrap", () => {
    // `.preview-tablewrap { overflow: hidden }` plus `overflow-x: auto` computes
    // to overflow-y: hidden. If that wrap also shrinks in the pane flex column,
    // the 8k–45k table is clipped, the pane never overflows, and the wheel
    // goes to console `main`. Keep the wrap as tall as the table.
    expect(css).toMatch(/\.preview-tablewrap--fit\s*\{[^}]*flex:\s*0\s+0\s+auto/);
    expect(css).toMatch(/\.preview-skin-pane--listings\s*\{[^}]*overscroll-behavior:\s*contain/);
    expect(css).toMatch(/\.preview-skin-pane--listings\s*\{[^}]*scrollbar-gutter:\s*stable/);
    expect(css).not.toMatch(/\.preview-tablewrap--fit\s*\{[^}]*overflow-y:\s*hidden/);
  });

  it("uses an empty-state listings search hint, not example query syntax", () => {
    expect(stats).toMatch(/placeholder="Search listings…"/);
    expect(stats).not.toContain("fn ·");
    expect(stats).not.toContain("<$20");
    expect(stats).not.toContain("<0.15");
    expect(stats).toContain("listingMatchesQuery");
    expect(stats).toContain("listingQuery");
  });

  it("keeps search, page-40 loadMore, and the skin trade-up embed", () => {
    expect(stats).toContain("preview-listings-search");
    expect(stats).toContain("LISTING_PAGE");
    expect(skins).toMatch(/const LISTING_PAGE = 40/);
    expect(skinPage).toContain("usePreviewTradeUps");
    expect(skinPage).toContain("skin: name");
    expect(skinPage).not.toContain("search={board.search}");
  });
});

describe("listings table is dense and content-sized", () => {
  it("fits Price / Float / Wear / Market / Buy to content, not 1fr stretch", () => {
    expect(stats).toContain('key: "price"');
    expect(stats).toContain('key: "float"');
    expect(stats).toContain('key: "wear"');
    expect(stats).toContain('key: "market"');
    expect(stats).toContain("listingUrl(");
    expect(stats).toContain("Buy");
    expect(skins).toContain("preview-wear");
    expect(table).toContain("fit");
    expect(table).toContain("preview-table--fit");
    expect(css).toContain(".preview-table--fit");
    expect(css).toMatch(/\.preview-table--fit\s*\{[^}]*width:\s*max-content/);
    expect(css).toMatch(/\.preview-table--fit\s*\{[^}]*table-layout:\s*auto/);
    expect(css).not.toMatch(/\.preview-table--fit[^{]*\{[^}]*1fr/);
  });
});
