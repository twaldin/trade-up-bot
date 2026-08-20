import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { buildSeoHtml, renderCollectionsHub } from "../../server/seo.js";
import {
  buildCollectionsHubJsonLd,
  buildHomepageJsonLd,
} from "../../shared/crawler-jsonld.js";
import { STATIC_SEO_PAGES } from "../../server/static-seo-pages.js";

const __dir = dirname(fileURLToPath(import.meta.url));
const serverSource = readFileSync(join(__dir, "../../server/index.ts"), "utf-8");
const seoSource = readFileSync(join(__dir, "../../server/seo.ts"), "utf-8");
const previewAppSource = readFileSync(join(__dir, "../../src/preview/PreviewApp.tsx"), "utf-8");
const previewChromeSource = readFileSync(join(__dir, "../../src/preview/PreviewChrome.tsx"), "utf-8");
const previewShellSource = readFileSync(join(__dir, "../../src/preview/PreviewShell.tsx"), "utf-8");
const collectionsPageSource = readFileSync(join(__dir, "../../src/preview/pages/PreviewSkins.tsx"), "utf-8");

function graphTypes(jsonLd: Record<string, unknown>): string[] {
  const graph = jsonLd["@graph"];
  if (!Array.isArray(graph)) return [];
  return graph.map((node) => String((node as { "@type"?: string })["@type"]));
}

describe("kit landing crawler HTML after cutover", () => {
  it("ports the old homepage WebSite + Organization JSON-LD", () => {
    const jsonLd = buildHomepageJsonLd();
    expect(jsonLd["@context"]).toBe("https://schema.org");
    expect(graphTypes(jsonLd)).toEqual(["WebSite", "Organization"]);

    const graph = jsonLd["@graph"] as Array<Record<string, unknown>>;
    const website = graph[0];
    const org = graph[1];
    expect(website.name).toBe("TradeUpBot");
    expect(website.url).toBe("https://tradeupbot.app");
    expect(website.potentialAction).toEqual({
      "@type": "SearchAction",
      target: "https://tradeupbot.app/skins?search={search_term_string}",
      "query-input": "required name=search_term_string",
    });
    expect(org.name).toBe("TradeUpBot");
    expect(org.logo).toBe("https://tradeupbot.app/favicon.svg");
  });

  it("kit landing emits robots index,follow and the homepage JSON-LD", () => {
    expect(previewChromeSource).toContain('name="robots"');
    expect(previewChromeSource).toContain("index, follow");
    expect(previewChromeSource).toContain("application/ld+json");
    expect(previewChromeSource).toContain("buildHomepageJsonLd");
    expect(previewChromeSource).toContain('href="https://tradeupbot.app/"');
    expect(previewAppSource).toContain("PreviewChrome");
    expect(previewAppSource).not.toMatch(/noindex/);
    expect(previewChromeSource).not.toMatch(/noindex/);
    expect(previewShellSource).not.toMatch(/noindex/);
  });

  it("homepage route injects crawler head onto the prerendered kit HTML", () => {
    expect(serverSource).toContain("ensureHomepageCrawlerHead");
    expect(seoSource).toContain("buildHomepageJsonLd");
    expect(seoSource).toContain("ensureHomepageCrawlerHead");
  });
});

describe("collections hub crawler HTML after cutover", () => {
  const collections = [
    { name: "Dreams & Nightmares", slug: "dreams-nightmares" },
    { name: "Fracture", slug: "fracture" },
  ];

  it("emits CollectionPage + ItemList + BreadcrumbList JSON-LD from the existing hub list", () => {
    const jsonLd = buildCollectionsHubJsonLd(collections);
    expect(jsonLd.map((block) => block["@type"])).toEqual([
      "CollectionPage",
      "ItemList",
      "BreadcrumbList",
    ]);
    const list = jsonLd[1];
    const elements = list.itemListElement as Array<{ url: string; name: string }>;
    expect(elements[0]).toMatchObject({
      name: "Dreams & Nightmares",
      url: "https://tradeupbot.app/collections/dreams-nightmares",
    });
  });

  it("crawler HTML includes robots index,follow, JSON-LD, and the existing hub description", () => {
    const bodyHtml = renderCollectionsHub(collections);
    const html = buildSeoHtml({
      title: "CS2 Collections — Browse All Weapon Cases & Collections | TradeUpBot",
      description: "Browse CS2 collections with skins, float ranges, and trade-up opportunities.",
      url: "https://tradeupbot.app/collections",
      robots: "index, follow",
      bodyHtml,
      jsonLd: buildCollectionsHubJsonLd(collections),
    });

    expect(html).toContain('name="robots" content="index, follow"');
    expect(html).toContain("application/ld+json");
    expect(html).toContain('"@type":"CollectionPage"');
    expect(bodyHtml).toContain("CS2 collections group weapon skins");
    expect(bodyHtml).not.toMatch(/testimonial/i);
  });

  it("threads collections JSON-LD and the existing hub body into the /collections handlers", () => {
    expect(serverSource).toContain("buildCollectionsHubJsonLd");
    expect(serverSource).toMatch(/app\.get\("\/collections"[\s\S]*jsonLd:\s*buildCollectionsHubJsonLd/);
    expect(serverSource).toMatch(/app\.get\("\/collections"[\s\S]*bodyHtml:\s*renderCollectionsHub/);
  });

  it("kit collections page keeps index,follow and JSON-LD in first HTML", () => {
    expect(collectionsPageSource).toContain('name="robots"');
    expect(collectionsPageSource).toContain("index, follow");
    expect(collectionsPageSource).toContain("application/ld+json");
    expect(collectionsPageSource).not.toMatch(/noindex/);
  });
});

describe("existing money-page SEO checks stay in force", () => {
  it("does not drop calculator SoftwareApplication + FAQPage + BreadcrumbList", () => {
    const page = STATIC_SEO_PAGES.find((entry) => entry.path === "/calculator");
    expect(page?.jsonLd?.map((block) => block["@type"])).toEqual([
      "SoftwareApplication",
      "FAQPage",
      "BreadcrumbList",
    ]);
    expect(serverSource).toContain("jsonLd: staticPage.jsonLd");
  });

  it("does not drop /skins CollectionPage + ItemList or /trade-ups JSON-LD", () => {
    expect(serverSource).toContain('"@type": "CollectionPage"');
    expect(serverSource).toContain('"@type": "ItemList"');
    expect(serverSource).toContain('app.get("/trade-ups"');
    expect(serverSource).toContain('"@type": "WebApplication"');
  });
});
