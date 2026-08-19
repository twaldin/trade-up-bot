import { STATIC_SEO_PAGES, type StaticSeoPage } from "../../../server/static-seo-pages.js";

export function seoPage(path: string): StaticSeoPage {
  const page = STATIC_SEO_PAGES.find((entry) => entry.path === path);
  if (!page) throw new Error(`missing static SEO page ${path}`);
  return page;
}

export function faqEntities(page: StaticSeoPage): { q: string; a: string }[] {
  const faq = (page.jsonLd ?? []).find((block) => block["@type"] === "FAQPage");
  const entities = faq?.mainEntity;
  if (!Array.isArray(entities)) return [];
  return entities.map((item) => {
    const row = item as { name?: string; acceptedAnswer?: { text?: string } };
    return { q: row.name ?? "", a: row.acceptedAnswer?.text ?? "" };
  }).filter((item) => item.q && item.a);
}
