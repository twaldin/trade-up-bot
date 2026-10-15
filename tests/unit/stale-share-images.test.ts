/**
 * Stale board screenshots must not stay on the site. The retired share
 * filename may appear in tests that forbid it, and nowhere else.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import sharp from "sharp";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const RETIRED = ["tradeuptable.jpg"];
const SKIP_DIRS = new Set(["node_modules", "dist", ".git", "coverage"]);
const TEXT_EXT = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs", ".html", ".css", ".svg", ".md", ".json"]);

function filesUnder(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) filesUnder(abs, out);
    else out.push(abs);
  }
  return out;
}

describe("retired share images", () => {
  it("does not reference the retired screenshot filenames outside tests", () => {
    const hits: string[] = [];
    for (const abs of filesUnder(root)) {
      const rel = relative(root, abs);
      if (rel.endsWith(".test.ts") || rel.endsWith(".test.tsx")) continue;
      if (!TEXT_EXT.has(extname(abs))) continue;
      const text = readFileSync(abs, "utf8");
      for (const name of RETIRED) {
        if (text.includes(name)) hits.push(`${rel}: ${name}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it("removes the retired file and serves a 1200x630 share image", async () => {
    expect(existsSync(join(root, "public", "tradeuptable.jpg"))).toBe(false);
    const share = join(root, "public", "og-default.jpg");
    expect(existsSync(share)).toBe(true);
    const meta = await sharp(share).metadata();
    expect(meta.width).toBe(1200);
    expect(meta.height).toBe(630);
    expect(meta.format).toBe("jpeg");
    const banner = await sharp(join(root, "public", "pricing-banner.jpg")).metadata();
    expect(banner.width).toBe(1200);
    expect(banner.height).toBe(356);
  });

  it("keeps the device stills at the frame pixel size", async () => {
    const expected: Record<string, [number, number]> = {
      "board-desktop-dark.webp": [2880, 1872],
      "board-desktop-light.webp": [2880, 1872],
      "board-mobile-dark.webp": [780, 1688],
      "board-mobile-light.webp": [780, 1688],
    };
    for (const [name, [width, height]] of Object.entries(expected)) {
      const meta = await sharp(join(root, "public", "preview", name)).metadata();
      expect(meta.width, name).toBe(width);
      expect(meta.height, name).toBe(height);
      expect(meta.format, name).toBe("webp");
    }
  });

  it("keeps dollar amounts, counts, and board rows off the share image source", () => {
    for (const name of ["og-default.svg", "pricing-banner.svg"]) {
      const svg = readFileSync(join(root, "assets", "neutral-art", name), "utf8");
      const copy = [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((match) => match[1]).join(" ");
      expect(copy, name).toContain("TradeUpBot");
      expect(copy, name).toContain("CS2 trade-ups ranked by EV after fees");
      expect(copy.replaceAll("CS2", ""), name).not.toMatch(/\$|\bROI\b|\d/);
    }
  });

  it("labels device stills as an illustrative example and uses only sample figures", () => {
    const banned = /chance|odds|jackpot|gamble|\bbet\b|lucky|\broll\b|bankroll|risk-free|\bwin\b/i;
    for (const name of [
      "board-desktop-dark.svg",
      "board-desktop-light.svg",
      "board-mobile-dark.svg",
      "board-mobile-light.svg",
    ]) {
      const svg = readFileSync(join(root, "assets", "neutral-art", name), "utf8");
      const copy = [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((match) => match[1]).join("\n");
      expect(copy, name).toContain("Illustrative example");
      expect(copy, name).not.toMatch(banned);
      expect(copy, name).not.toMatch(/105[,.]?638|4[,.]?593|53\.14|3\.21|\b199\b/);
      expect(copy, name).toContain("$140.00");
      expect(copy, name).toContain("Expected profit +$20.00");
      expect(copy, name).toContain("ROI 20%");
      expect(copy, name).toContain("ROI 10%");
      expect(svg, name).not.toMatch(/#eb4b4b|#ff5470|#c81e45|#ab2e26/i);
    }
    // Desktop main card: 0.5*140 + 0.3*100 + 0.2*100 = 120, profit 20, ROI 20/100.
    expect(0.5 * 140 + 0.3 * 100 + 0.2 * 100 - 100).toBe(20);
    expect(20 / 100).toBe(0.2);
    // Mobile main card: 0.5*140 + 0.5*100 = 120. Slim rows: 10*10 = 100.
    expect(0.5 * 140 + 0.5 * 100 - 100).toBe(20);
    expect(10 / 100).toBe(0.1);
    const desktop = readFileSync(join(root, "assets", "neutral-art", "board-desktop-dark.svg"), "utf8");
    const panelHeight = Number(desktop.match(/<rect x="20" y="68" width="1400" height="(\d+)"/)?.[1]);
    expect(panelHeight).toBeLessThanOrEqual(380);
  });

  it("keeps the pricing slot at 1200x356 and describes the banner", () => {
    for (const rel of ["src/pages/PricingPage.tsx", "src/preview/pages/PreviewPricing.tsx"]) {
      const pricing = readFileSync(join(root, rel), "utf8");
      expect(pricing, rel).toContain('src="/pricing-banner.jpg"');
      expect(pricing, rel).toContain('alt="TradeUpBot — CS2 trade-ups ranked by EV after fees"');
      expect(pricing, rel).toContain("TradeUpBot wordmark and tagline.");
      expect(pricing, rel).toContain('width="1200"');
      expect(pricing, rel).toContain('height="356"');
      expect(pricing, rel).not.toContain("/og-default.jpg");
      expect(pricing, rel).not.toContain("Trade-up table");
    }
  });

  it("calls the device still an illustrative example", () => {
    const device = readFileSync(join(root, "src/preview/components/DeviceScreen.tsx"), "utf8");
    expect(device).toContain("Illustrative example of the TradeUpBot board.");
    expect(device).not.toMatch(/live capture|real capture|live listings/i);
  });
});
