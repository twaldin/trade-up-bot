import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { makeTradeUp } from "../helpers/fixtures.js";
import { HeroProof } from "../../src/preview/pages/PreviewLanding.js";
import type { TradeUp } from "../../shared/types.js";

function render(props: { tu: TradeUp | null; loading: boolean; isFree: boolean }): string {
  return renderToStaticMarkup(
    <MemoryRouter>
      <HeroProof {...props} />
    </MemoryRouter>,
  );
}

describe("hero proof panel states", () => {
  it("holds the panel shape with skeleton blocks while the board loads", () => {
    const html = render({ tu: null, loading: true, isFree: true });
    expect(html).toContain("preview-proof__skeleton");
    expect(html).toContain("Loading the top trade-up on the board");
    expect(html).not.toContain("The board is refreshing");
  });

  it("drops the skeleton once loading failed, leaving the status line and the board link", () => {
    const html = render({ tu: null, loading: false, isFree: true });
    expect(html).not.toContain("preview-proof__skeleton");
    expect(html).not.toContain("Loading the top trade-up on the board");
    expect(html).toContain("The board is refreshing");
    expect(html).toContain('href="/trade-ups"');
  });

  it("renders the receipt once a buyable row is in hand", () => {
    const html = render({ tu: makeTradeUp({ id: 7 }), loading: false, isFree: false });
    expect(html).not.toContain("preview-proof__skeleton");
    expect(html).toContain('href="/trade-ups/7"');
    expect(html).toContain("preview-proof__kpis");
  });
});
