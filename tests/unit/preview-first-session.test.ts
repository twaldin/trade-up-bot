import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const dir = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(resolve(dir, rel), "utf8");

const board = read("../../src/preview/pages/PreviewBoard.tsx");
const calc = read("../../src/preview/pages/PreviewCalculator.tsx");
const css = read("../../src/preview/preview.css");

function collapsedCardline(source: string): string {
  const start = source.indexOf('className="preview-cardline"');
  const end = source.indexOf("</p>", start);
  return source.slice(start, end);
}

describe("collapsed board cards invite open and Verify", () => {
  const line = collapsedCardline(board);

  it("puts a Details hint and a Verify link on the one stat line", () => {
    expect(line).toContain("preview-cardline__open");
    expect(line).toContain("Details");
    expect(line).toContain("preview-cardline__verify");
    expect(line).toContain("verifyClaimHref(tu.id)");
    expect(line).toMatch(/target="_blank"/);
    expect(line).toContain("onClick={stop}");
  });

  it("does not bring back a header band or a visible expand button", () => {
    expect(board).not.toContain("preview-card__head");
    expect(line).not.toContain("<button");
    const buttons = [...board.matchAll(/<button[\s\S]*?className="([^"]+)"/g)].map((m) => m[1]);
    expect(buttons).not.toContain("preview-card__expand");
  });

  it("gives Verify a 24px touch target and a new-tab label", () => {
    expect(line).toContain('aria-label="Verify trade-up (opens in new tab)"');
    expect(css).toMatch(/\.preview-cardline__verify\s*\{[^}]*min-height: 24px/);
  });

  it("only offers Details on cards that can expand, and never expands a static one", () => {
    expect(board).toContain("expandable = true");
    expect(board).toMatch(/\{expandable && \(\s*<span className="preview-cardline__open"/);
    expect(board).toMatch(/const toggle = \(\) => \{\s*if \(!expandable\) return;/);
    expect(board).toMatch(/const open = \(\) => \{\s*if \(expandable\) onExpand\(tu\.id\);/);
    expect(board).toContain("onNeedExpand={open}");
  });

  it("keeps landing peek cards static so they cannot collapse the hero card", () => {
    const landing = read("../../src/preview/pages/PreviewLanding.tsx");
    const peek = landing.slice(landing.indexOf("{peek.map("), landing.indexOf("preview-peek__graph"));
    expect(peek).toContain("expandable={false}");
  });

  it("styles the hint and the link from kit tokens", () => {
    expect(css).toContain(".preview-cardline__open");
    expect(css).toContain(".preview-cardline__verify");
    expect(css).toMatch(/\.preview-card:hover \.preview-cardline__open/);
  });
});

describe("calculator first session", () => {
  it("offers Load example as the lime call to action in the empty state", () => {
    const empty = calc.slice(calc.indexOf("preview-calc-empty"));
    expect(empty).toContain("preview-btn--lime");
    expect(empty).toContain("Load example");
  });

  it("evaluates the example straight away so the payoff shows on one click", () => {
    const load = calc.slice(calc.indexOf("const loadExample"), calc.indexOf("const calculate"));
    expect(load).toContain("/api/calculator/example");
    expect(load).toContain("await evaluate(data.inputs)");
  });

  it("reads the example through the kit rate-limit path instead of a bare res.json()", () => {
    const load = calc.slice(calc.indexOf("const loadExample"), calc.indexOf("const calculate"));
    expect(load).toContain("readPagedJson");
    expect(load).toContain("isRateLimitError(err)");
    expect(load).toContain("SLOW_DOWN_COPY");
    expect(load).not.toContain("res.json()");
  });

  it("colours calculator profit with the shared tone, so break-even stays neutral", () => {
    expect(calc).toContain("tone={signClass(profit)}");
    expect(calc).not.toContain('profit >= 0 ? "is-plus"');
  });

  it("does not fetch or run the example on first render", () => {
    expect(calc).not.toMatch(/useEffect\([\s\S]{0,200}\/api\/calculator\/example/);
    expect(calc).toContain("useState<CalculatorExampleSlot[]>(emptyCalculatorSlots())");
  });

  it("labels loaded inputs as an example and keeps the example 404's wording off the page", () => {
    expect(calc).toMatch(/>\s*Example\s*</);
    const load = calc.slice(calc.indexOf("const loadExample"), calc.indexOf("const calculate"));
    expect(load).not.toContain("data.error");
    expect(calc).not.toMatch(/production/i);
  });

  it("renders the board's output tile, with signed $ delta and odds", () => {
    expect(calc).toContain("<OutputTile");
    expect(calc).toContain("costCents={result.total_cost_cents}");
    expect(calc).toContain("uniqueOutputs(result)");
    expect(board).toMatch(/export function OutputTile/);
  });

  it("keeps the Cost / EV / Profit / Chance strip", () => {
    for (const label of ["Cost", "Expected value", "Profit", "Chance of profit"]) {
      expect(calc).toContain(`label="${label}"`);
    }
  });
});
