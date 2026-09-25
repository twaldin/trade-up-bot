import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { makeTradeUp } from "../helpers/fixtures.js";
import { HeroProof } from "../../src/preview/pages/PreviewLanding.js";
import { pickHeroTradeUp } from "../../src/preview/lib/hero-proof.js";
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

  it("shows a neutral placeholder chip and an em-dash price when nothing is eligible", () => {
    const html = render({ tu: null, loading: false, isFree: true });
    expect(html).not.toContain("preview-proof__skeleton");
    expect(html).not.toContain("Loading the top trade-up on the board");
    expect(html).toContain("preview-listing--placeholder");
    expect(html).toContain("preview-chip--placeholder");
    expect(html).toContain("preview-listing__price");
    expect(html).toContain("—");
    expect(html).not.toContain("$0.00");
    expect(html).not.toMatch(/<b>0<\/b>/);
    expect(html).toContain("The board is refreshing");
    expect(html).toContain('href="/trade-ups"');
  });

  it("skips hidden, redacted, and stale rows and keeps the first eligible trade-up", () => {
    const hidden = makeTradeUp({
      id: 1,
      inputs: makeTradeUp().inputs.map((row) => ({ ...row, listing_id: "hidden" })),
    });
    const redacted = makeTradeUp({ id: 2, inputs_redacted: true });
    const stale = makeTradeUp({ id: 3, listing_status: "stale" });
    const eligible = makeTradeUp({ id: 4 });
    expect(pickHeroTradeUp([hidden, redacted, stale, eligible])?.id).toBe(4);
    expect(pickHeroTradeUp([hidden, redacted, stale])).toBeNull();

    const skipped = render({ tu: pickHeroTradeUp([hidden, redacted, stale]), loading: false, isFree: true });
    expect(skipped).toContain("preview-chip--placeholder");
    expect(skipped).toContain("preview-listing__price");
    expect(skipped).not.toContain("$0.00");
    expect(skipped).not.toContain('href="/trade-ups/1"');
  });

  it("renders the receipt once a buyable row is in hand", () => {
    const html = render({ tu: makeTradeUp({ id: 7 }), loading: false, isFree: false });
    expect(html).not.toContain("preview-proof__skeleton");
    expect(html).toContain('href="/trade-ups/7"');
    expect(html).toContain("preview-proof__kpis");
  });
});
