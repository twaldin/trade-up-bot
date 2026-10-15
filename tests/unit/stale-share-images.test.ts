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

  it("removes the retired file and serves a 1200x356 share image", async () => {
    expect(existsSync(join(root, "public", "tradeuptable.jpg"))).toBe(false);
    const share = join(root, "public", "og-default.jpg");
    expect(existsSync(share)).toBe(true);
    const meta = await sharp(share).metadata();
    expect(meta.width).toBe(1200);
    expect(meta.height).toBe(356);
    expect(meta.format).toBe("jpeg");
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
    const svg = readFileSync(join(root, "assets", "neutral-art", "og-default.svg"), "utf8");
    const copy = [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((match) => match[1]).join(" ");
    expect(copy).toContain("TradeUpBot");
    expect(copy).toContain("CS2 trade-ups ranked by EV after fees");
    expect(copy.replaceAll("CS2", "")).not.toMatch(/\$|\bROI\b|\d/);
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
      const dollars = copy.match(/\$\d+(?:\.\d+)?/g) ?? [];
      expect(new Set(dollars), name).toEqual(new Set(["$10.00", "$20.00", "$100.00"]));
    }
  });

  it("describes the pricing caption as the share of outcomes above cost", () => {
    const pricing = readFileSync(join(root, "src", "pages", "PricingPage.tsx"), "utf8");
    expect(pricing).toContain("share of outcomes above cost");
    expect(pricing).not.toContain("chance to profit");
    expect(pricing).toContain('src="/og-default.jpg"');
    expect(pricing).toContain('width="1200"');
    expect(pricing).toContain('height="356"');
  });
});
