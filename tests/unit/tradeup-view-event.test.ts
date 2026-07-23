import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));
const tableSource = readFileSync(join(__dir, "../../src/components/TradeUpTable.tsx"), "utf-8");

describe("tradeup_view instrumentation on the main table", () => {
  it("fires tradeup_view when a row is expanded (not only on the share page)", () => {
    expect(tableSource).toContain('trackEvent("tradeup_view"');
  });

  it("fires on expand only, inside handleExpand after the collapse early-return", () => {
    const handler = tableSource.slice(tableSource.indexOf("const handleExpand"));
    const collapseReturn = handler.indexOf("setExpandedId(null); return;");
    const track = handler.indexOf('trackEvent("tradeup_view"');
    expect(collapseReturn).toBeGreaterThan(-1);
    expect(track).toBeGreaterThan(collapseReturn);
  });

  it("tags the event with the trade-up id and a list location", () => {
    expect(tableSource).toMatch(/trackEvent\("tradeup_view", \{ tradeup_id: String\(tuId\), location: "list" \}\)/);
  });
});
