import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { PreviewBoard } from "../../src/preview/pages/PreviewBoard.js";
import { UNFILTERED_EMPTY_COPY } from "../../src/preview/lib/board-notice.js";
import { TRADE_UPS_FAQ } from "../../shared/trade-ups-faq.js";
import { makeTradeUp } from "../helpers/fixtures.js";

const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../src/preview/preview.css"), "utf8");

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
    expect(html).toContain("— ranked");
    expect(html).not.toContain("0 ranked");
    expect(html).toContain("<h2>Common questions</h2>");
    for (const item of TRADE_UPS_FAQ) expect(html).toContain(item.q);
  });

  it("replaces the page of skeletons with one fold-height status block when empty or failed", () => {
    const rule = css.match(/\.preview-board-status\s*\{[^}]*\}/);
    expect(rule?.[0]).toBeTruthy();
    expect(rule?.[0]).not.toMatch(/(?<!min-)height\s*:/);
    expect(rule?.[0]).toMatch(/min-height:\s*100vh;\s*min-height:\s*max\(12rem,\s*calc\(100dvh - 360px\)\)/);
    const floor = css.match(/\.preview-bento--floor\s*\{[^}]*\}/);
    expect(floor?.[0]).toMatch(/min-height:\s*100vh;\s*min-height:\s*max\(12rem,\s*calc\(100dvh - 360px\)\)/);

    for (const html of [board({ loading: false }), board({ loading: false, failed: true })]) {
      expect(html.match(/preview-card--skeleton/g)).toBeNull();
      expect(html).not.toContain("preview-bento--quiet");
      expect(html).toContain("<h2>Common questions</h2>");
      const status = html.slice(html.indexOf("preview-board-status"), html.indexOf("Common questions"));
      expect(status).toContain("preview-board-status");
      expect(status).not.toContain("preview-card");
    }

    const empty = board({ loading: false });
    const emptyStatus = empty.slice(empty.indexOf("preview-board-status"), empty.indexOf("Common questions"));
    expect(emptyStatus).toContain(UNFILTERED_EMPTY_COPY);
    expect(empty).toContain("0 ranked");

    const failed = board({ loading: false, failed: true });
    const failedStatus = failed.slice(failed.indexOf("preview-board-status"), failed.indexOf("Common questions"));
    expect(failedStatus).toContain("load trade-ups.");
    expect(failed).toContain("— ranked");
    expect(failed).not.toContain("0 ranked");
  });

  it("keeps a floor under a short first page and drops it once the page is full", () => {
    const one = board({ loading: false, tradeUps: [makeTradeUp()] });
    expect(one).toContain("preview-bento--floor");
    expect(one).not.toContain("preview-card--skeleton");
    expect(one).not.toContain("preview-board-status");

    const full = board({
      loading: false,
      tradeUps: Array.from({ length: 12 }, (_, index) => makeTradeUp({ id: index + 1 })),
    });
    expect(full).not.toContain("preview-bento--floor");
    expect(full).toContain("12 ranked");
  });

  it("does not reserve the board page inside an embedded list", () => {
    const html = board({ embed: true, heading: "Trade-ups using this skin" });
    expect(html).not.toContain("preview-card--skeleton");
    expect(html).not.toContain("Common questions");
    expect(html).toContain("preview-note\">Loading trade-ups…");
  });
});
