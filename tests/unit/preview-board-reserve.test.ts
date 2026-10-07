import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { PreviewBoard } from "../../src/preview/pages/PreviewBoard.js";
import { UNFILTERED_EMPTY_COPY } from "../../src/preview/lib/board-notice.js";
import { TRADE_UPS_FAQ } from "../../shared/trade-ups-faq.js";
import { makeTradeUp } from "../helpers/fixtures.js";

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

function reservedBlock(html: string): string {
  const start = html.indexOf("preview-bento");
  const end = html.indexOf("Common questions");
  return html.slice(start, end);
}

describe("trade-up board reserves the first page", () => {
  it("paints skeleton cards and the FAQ while the first page loads", () => {
    const html = board();
    const block = reservedBlock(html);
    expect(html.match(/preview-card--skeleton/g)).toHaveLength(12);
    expect(block).toContain("preview-bento--reserved");
    expect(block).not.toContain("preview-bento--quiet");
    expect(block).not.toContain("$");
    expect(block).not.toMatch(/>\s*\d/);
    expect(html).toContain("Loading trade-ups…");
    expect(html).toContain("sr-only\">Loading trade-ups…");
    expect(html).toContain("preview-page__meta--board");
    expect(html).toContain("<h2>Common questions</h2>");
    for (const item of TRADE_UPS_FAQ) expect(html).toContain(item.q);
  });

  it("keeps the reserved slots when the board is empty or failed", () => {
    const empty = board({ loading: false });
    expect(empty.match(/preview-card--skeleton/g)).toHaveLength(12);
    expect(empty).toContain("preview-bento--quiet");
    expect(empty).toContain(UNFILTERED_EMPTY_COPY);
    expect(empty).toContain("<h2>Common questions</h2>");

    const failed = board({ loading: false, failed: true });
    expect(failed.match(/preview-card--skeleton/g)).toHaveLength(12);
    expect(failed).toContain("preview-bento--quiet");
    expect(failed).toContain("load trade-ups.");
    expect(failed).toContain("<h2>Common questions</h2>");
  });

  it("drops the placeholders once real cards are on the board", () => {
    const html = board({ loading: false, tradeUps: [makeTradeUp()] });
    expect(html).not.toContain("preview-card--skeleton");
    expect(html).not.toContain("preview-bento--reserved");
    expect(html).toContain("<h2>Common questions</h2>");
  });

  it("does not reserve the board page inside an embedded list", () => {
    const html = board({ embed: true, heading: "Trade-ups using this skin" });
    expect(html).not.toContain("preview-card--skeleton");
    expect(html).not.toContain("Common questions");
    expect(html).toContain("preview-note\">Loading trade-ups…");
  });
});
