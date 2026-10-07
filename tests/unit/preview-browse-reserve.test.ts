/**
 * Browse pages reserve the fold the same way the trade-up board does:
 * skeletons only while the first fetch is in flight, and a min-height floor
 * so the footer does not move into the viewport when the rows arrive.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { PreviewBoard } from "../../src/preview/pages/PreviewBoard.js";
import { PreviewCollectionTradeUps } from "../../src/preview/pages/PreviewCollectionTradeUps.js";
import { PreviewShare } from "../../src/preview/pages/PreviewShare.js";
import {
  PreviewCollectionPage,
  PreviewCollectionsPage,
  PreviewSkinsPage,
} from "../../src/preview/pages/PreviewSkins.js";

const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../src/preview/preview.css"), "utf8");

const COLLECTIONS_LEDE = "CS2 collections group weapon skins by the case, operation, map, or themed release where those skins entered the game. Each collection contains skins across rarity tiers, and those rarity tiers determine which inputs and outputs can appear in a trade-up.";
const SHARE_LEDE = "Same verify, claim, confirm, and release flow as the live board. Expected value on the card is the probability-weighted output; Expected P/L is that value minus cost.";

function page(node: ReturnType<typeof createElement>, path: string) {
  return renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: [path] },
    createElement(Routes, null,
      createElement(Route, { path: "/collections", element: node }),
      createElement(Route, { path: "/collections/:name", element: node }),
      createElement(Route, { path: "/skins", element: node }),
      createElement(Route, { path: "/trade-ups/:id", element: node }),
      createElement(Route, { path: "/trade-ups/collection/:slug", element: node }),
    ),
  ));
}

function board(props: Partial<Parameters<typeof PreviewBoard>[0]> = {}) {
  return renderToStaticMarkup(createElement(MemoryRouter, null, createElement(PreviewBoard, {
    tradeUps: [],
    loading: true,
    isFree: false,
    expandedId: null,
    onExpand: () => {},
    ...props,
  })));
}

describe("browse pages reserve the fold", () => {
  it("uses the board floor and does not lock the block to a fixed height", () => {
    const fold = css.match(/\.preview-fold\s*\{[^}]*\}/);
    const pageFold = css.match(/\.preview-page--fold\s*\{[^}]*\}/);
    expect(fold?.[0]).toBeTruthy();
    expect(pageFold?.[0]).toBeTruthy();
    expect(fold?.[0]).not.toMatch(/(?<!min-)height\s*:/);
    expect(pageFold?.[0]).not.toMatch(/(?<!min-)height\s*:/);
    expect(fold?.[0]).toMatch(/min-height:\s*100vh;\s*min-height:\s*max\(12rem,\s*calc\(100dvh - 360px\)\)/);
    expect(pageFold?.[0]).toMatch(/min-height:\s*100vh;\s*min-height:\s*max\(12rem,\s*100%,\s*calc\(100dvh - 360px\)\)/);
  });

  it("paints collection skeletons and the static lede while the index loads", () => {
    const html = page(createElement(PreviewCollectionsPage), "/collections");
    expect(html).toContain("preview-page--fold");
    expect(html).toContain("preview-collections preview-fold");
    expect(html.match(/preview-collection--skeleton/g)).toHaveLength(12);
    expect(html).toContain(COLLECTIONS_LEDE);
    expect(html).toContain("All collections");
    expect(html).toContain("— collections");
    expect(html).toContain("sr-only\">Loading collections…");
    expect(html).not.toContain("0 collections");
    expect(html).not.toContain("<h2>Common questions</h2>");
  });

  it("paints skin skeletons while the first page loads", () => {
    const html = page(createElement(PreviewSkinsPage), "/skins");
    expect(html).toContain("preview-page--fold");
    expect(html).toContain("preview-grid preview-fold");
    expect(html.match(/preview-skin--skeleton/g)).toHaveLength(12);
    expect(html).toContain("Live listing counts, floors, and float ranges from the production data API.");
    expect(html).toContain("— loaded");
    expect(html).toContain("sr-only\">Loading skins…");
    expect(html).not.toContain("0 loaded");
    expect(html).not.toContain("<h2>Common questions</h2>");
  });

  it("reserves the collection detail skins and the embedded trade-up list", () => {
    const html = page(createElement(PreviewCollectionPage), "/collections/2018-inferno");
    expect(html).toContain("preview-page--fold");
    expect(html).toContain("preview-allskins preview-fold");
    expect(html.match(/preview-allskins__tile/g)).toHaveLength(8);
    expect(html.match(/preview-card--skeleton/g)).toHaveLength(6);
    expect(html).toContain("— trade-ups");
    expect(html).toContain("— skins");
    expect(html).not.toContain("<h2>Common questions</h2>");
  });

  it("reserves a collection trade-up list without the board FAQ", () => {
    const html = page(createElement(PreviewCollectionTradeUps), "/trade-ups/collection/chroma");
    expect(html).toContain("preview-page--fold");
    expect(html).toContain("Ranked the same way as the board, filtered to this collection.");
    expect(html.match(/preview-card--skeleton/g)).toHaveLength(6);
    expect(html).toContain("— trade-ups");
    expect(html).not.toContain("<h2>Common questions</h2>");
  });

  it("reserves the trade-up detail header, collection row, and card while it loads", () => {
    const html = page(createElement(PreviewShare), "/trade-ups/781571674");
    expect(html).toContain("preview-page--fold");
    expect(html).toContain("preview-share-head");
    expect(html).toContain("preview-fold");
    expect(html).toContain(SHARE_LEDE);
    expect(html).toContain("preview-share-meta__hold");
    expect(html).toContain("preview-detail-collections");
    expect(html.match(/preview-card--skeleton/g)).toHaveLength(1);
    expect(html).toContain("sr-only\">Loading trade-up…");
    expect(html).not.toContain("<h2>Common questions</h2>");
    expect(css).toMatch(/\.preview-share-panel--hold\s*\{[^}]*visibility:\s*hidden/);
  });

  it("reserves an embedded list only when the parent asks, and still skips the FAQ", () => {
    const open = board({ embed: true, reserve: true, reserveSlots: 6, heading: "Chroma Trade-Ups" });
    expect(open.match(/preview-card--skeleton/g)).toHaveLength(6);
    expect(open).toContain("preview-bento--reserved");
    expect(open).not.toContain("<h2>Common questions</h2>");

    const plain = board({ embed: true, heading: "Trade-ups using this skin" });
    expect(plain).not.toContain("preview-card--skeleton");
    expect(plain).not.toContain("<h2>Common questions</h2>");
  });
});
