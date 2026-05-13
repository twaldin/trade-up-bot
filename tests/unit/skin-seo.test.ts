import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));
const serverSource = readFileSync(join(__dir, "../../server/index.ts"), "utf-8");

describe("skin page SEO crawler HTML", () => {
  it("uses the required skin title template", () => {
    expect(serverSource).toContain("`${skinName} — CS2 Price, Float Range & Trade-Ups | TradeUpBot`");
  });

  it("includes collection and listing context in the meta description", () => {
    expect(serverSource).toContain("collectionSummaryForDescription");
    expect(serverSource).toContain("listingSummaryForDescription");
  });

  it("renders float range text with the value immediately after the label", () => {
    expect(serverSource).toContain("<strong>Float Range:</strong> ${floatRangeText}");
  });

  it("emits Product and BreadcrumbList JSON-LD for skin pages", () => {
    expect(serverSource).toContain('"@type": "Product"');
    expect(serverSource).toContain('"@type": "BreadcrumbList"');
    expect(serverSource).toContain('priceCurrency: "USD"');
  });
});
