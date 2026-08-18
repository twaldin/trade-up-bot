import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));
const page = readFileSync(join(__dir, "../../src/pages/CalculatorPage.tsx"), "utf-8");
const seo = readFileSync(join(__dir, "../../server/static-seo-pages.ts"), "utf-8");

describe("calculator Load example control", () => {
  it("adds a Load example control on /calculator only", () => {
    expect(page).toContain("Load example");
    expect(page).toContain("/api/calculator/example");
  });

  it("does not prefill or auto-run on first load", () => {
    expect(page).toContain("useState<InputSlot[]>([{ ...EMPTY_INPUT }])");
    expect(page).not.toMatch(/useEffect\([^)]*\/api\/calculator\/example/);
    const calculateFn = page.slice(page.indexOf("const calculate = async"));
    expect(calculateFn).toContain('trackEvent("calculator_run"');
    const loadExampleFn = page.slice(page.indexOf("loadExample"));
    const nextFn = loadExampleFn.search(/\n  const [a-zA-Z]/);
    const loadBody = nextFn === -1 ? loadExampleFn : loadExampleFn.slice(0, nextFn);
    expect(loadBody).not.toContain("calculator_run");
    expect(loadBody).not.toContain("calculate(");
  });

  it("Clear returns the empty cents widget and keeps price fields in cents", () => {
    expect(page).toMatch(/>\s*Clear\s*</);
    expect(page).toContain("emptyCalculatorSlots()");
    expect(page).toContain("Price (cents)");
  });

  it("labels the loaded contract as an example without profit claims", () => {
    expect(page).toMatch(/Example/);
    expect(page.toLowerCase()).not.toContain("guaranteed profit");
    expect(page.toLowerCase()).not.toContain("we ran this");
  });

  it("preserves crawler-facing calculator SEO copy", () => {
    expect(page).toContain("CS2 Trade-Up Calculator — Float & Profit | TradeUpBot");
    expect(page).toContain("How CS2 Trade-Up Math Works");
    expect(seo).toContain("Why most CS2 trade-up calculators are wrong");
    expect(seo).toContain("exact predicted output float");
  });
});
