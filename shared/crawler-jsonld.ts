export interface CollectionHubItem {
  name: string;
  slug: string;
}

const HOMEPAGE_URL = "https://tradeupbot.app";

/**
 * Old homepage schema (WebSite + Organization + SearchAction), ported onto the
 * kit landing. SearchAction targets /skins — /data now redirects there.
 */
export function buildHomepageJsonLd(): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        name: "TradeUpBot",
        url: HOMEPAGE_URL,
        description: "Real-time CS2 trade-up contract analyzer. Find profitable trade-ups from real marketplace listings.",
        potentialAction: {
          "@type": "SearchAction",
          target: `${HOMEPAGE_URL}/skins?search={search_term_string}`,
          "query-input": "required name=search_term_string",
        },
      },
      {
        "@type": "Organization",
        name: "TradeUpBot",
        url: HOMEPAGE_URL,
        logo: `${HOMEPAGE_URL}/favicon.svg`,
        description: "CS2 trade-up contract analysis platform using real marketplace data from CSFloat, DMarket, Skinport, and Buff.market.",
      },
    ],
  };
}

const FALLBACK_COLLECTION_JSONLD: CollectionHubItem[] = [
  { name: "Dreams & Nightmares", slug: "dreams-nightmares" },
  { name: "Norse", slug: "norse" },
  { name: "Gallery", slug: "gallery" },
  { name: "Spectrum", slug: "spectrum" },
  { name: "Chroma", slug: "chroma" },
  { name: "Prisma", slug: "prisma" },
  { name: "Clutch", slug: "clutch" },
  { name: "Recoil", slug: "recoil" },
  { name: "Fracture", slug: "fracture" },
  { name: "Gamma", slug: "gamma" },
  { name: "Operation Broken Fang", slug: "operation-broken-fang" },
  { name: "Operation Riptide", slug: "operation-riptide" },
];

export function buildCollectionsHubJsonLd(collections: CollectionHubItem[]): Record<string, unknown>[] {
  const seen = new Set<string>();
  const items = [...collections, ...FALLBACK_COLLECTION_JSONLD].filter((collection) => {
    if (seen.has(collection.slug)) return false;
    seen.add(collection.slug);
    return true;
  }).slice(0, 12);

  return [
    {
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      name: "CS2 Skin Collections",
      description: "Browse CS2 collections with skins, float ranges, and trade-up opportunities.",
      url: `${HOMEPAGE_URL}/collections`,
    },
    {
      "@context": "https://schema.org",
      "@type": "ItemList",
      name: "CS2 Collections",
      numberOfItems: items.length,
      itemListElement: items.map((collection, index) => ({
        "@type": "ListItem",
        position: index + 1,
        name: collection.name,
        url: `${HOMEPAGE_URL}/collections/${collection.slug}`,
      })),
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: `${HOMEPAGE_URL}/` },
        { "@type": "ListItem", position: 2, name: "Collections", item: `${HOMEPAGE_URL}/collections` },
      ],
    },
  ];
}
