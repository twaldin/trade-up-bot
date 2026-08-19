/**
 * Skin and collection pages inside the preview shell. Same live `/api/skin-data`,
 * `/api/skin-by-slug`, `/api/collections` and `/api/trade-ups` routes production
 * uses, rendered on the Outlay kit instead of the old chrome.
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ExternalLink } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import type { TradeUp } from "../../../shared/types.js";
import { buildCollectionsHubJsonLd } from "../../../shared/crawler-jsonld.js";
import { formatDollars, listingUrl, sourceLabel } from "../../utils/format.js";
import { PreviewTable, type Column } from "../components/PreviewTable.js";
import { PriceScatter, type ScatterPoint } from "../components/PriceScatter.js";
import {
  collectionsHref,
  conditionShort,
  formatFloat,
  previewCollectionHref,
  previewSkinHref,
  rarityTint,
  skinsHref,
  splitSkinName,
} from "../lib/board.js";
import { createFaceCache, faceCacheKey, faceFor, loadFaces, namesFromCacheKey } from "../lib/skin-images.js";
import { cacheNames, PreviewSearch } from "../components/PreviewSearch.js";
import { chipsToSkinParams, type ParsedQuery } from "../lib/query-parse.js";
import {
  collectionSkinTotal,
  countsFromCollectionRow,
  formatCollectionSkinCopy,
  tallyCollectionSkins,
  type CollectionSkinTally,
} from "../lib/collection-skins.js";
import { PreviewBoard, usePreviewTradeUps } from "./PreviewBoard.js";

const FACE_CACHE = createFaceCache();

interface SkinRow {
  id: string;
  name: string;
  rarity: string;
  weapon: string;
  collection_name: string | null;
  listing_count: number;
  sale_count?: number;
  min_price: number | null;
}

interface SkinListing {
  id: string;
  price_cents: number;
  float_value: number | null;
  source: string;
}

interface SkinDetail {
  skin: {
    id: string;
    name: string;
    rarity: string;
    weapon: string;
    min_float: number;
    max_float: number;
    collection_name: string | null;
  };
  listings: SkinListing[];
  saleHistory?: { price_cents: number; float_value: number | null; source: string }[];
  priceSources: { source: string; condition: string; avg_price_cents: number; volume: string }[];
  stats: { totalListings: number; minPrice: number | null; maxPrice: number | null; saleCount: number };
}

const WEAR_BANDS: [string, number, number][] = [
  ["FN", 0, 0.07],
  ["MW", 0.07, 0.15],
  ["FT", 0.15, 0.38],
  ["WW", 0.38, 0.45],
  ["BS", 0.45, 1.01],
];

/** Wear band for a float, on the CS2 boundaries the engine already works to. */
export function wearBand(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return WEAR_BANDS.find(([, lo, hi]) => value >= lo && value < hi)?.[0] ?? "BS";
}

/** Cheapest observed price per condition, across whichever sources reported. */
function priceByCondition(sources: SkinDetail["priceSources"]): { condition: string; cents: number }[] {
  const best = new Map<string, number>();
  for (const row of sources ?? []) {
    if (!row.condition || row.avg_price_cents <= 0) continue;
    const current = best.get(row.condition);
    if (current === undefined || row.avg_price_cents < current) best.set(row.condition, row.avg_price_cents);
  }
  const order = ["Factory New", "Minimal Wear", "Field-Tested", "Well-Worn", "Battle-Scarred"];
  return order.filter((c) => best.has(c)).map((c) => ({ condition: c, cents: best.get(c) as number }));
}

function Face({ name, size }: { name: string; size: number }) {
  const src = faceFor(FACE_CACHE, name);
  if (!src) return <div className="preview-skin__ph" style={{ width: size, height: size * 0.7 }} />;
  return <img src={src} alt="" style={{ maxHeight: size, maxWidth: "100%" }} />;
}

function useFaceNames(names: string[]) {
  const key = faceCacheKey(names);
  const [, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    const list = namesFromCacheKey(key);
    if (list.length === 0) return;
    void loadFaces(list, FACE_CACHE).then(() => { if (live) setTick((tick) => tick + 1); });
    return () => { live = false; };
  }, [key]);
}

function SkinCard({ row }: { row: SkinRow }) {
  const { weapon, finish } = splitSkinName(row.name);
  return (
    <Link
      className="preview-skin preview-skin--card"
      style={{ "--skin-tint": rarityTint(row.rarity) } as CSSProperties}
      to={previewSkinHref(row.name)}
    >
      <span className="preview-skin__buy">
        <span className="preview-skin__art"><Face name={row.name} size={72} /></span>
        {row.min_price !== null && <span className="preview-skin__lead">{formatDollars(row.min_price)}</span>}
        <span className="preview-skin__trail">{row.listing_count.toLocaleString()}</span>
      </span>
      <span className="preview-skin__label">
        <em>{weapon} · {row.rarity}</em>
        <b>{finish}</b>
      </span>
    </Link>
  );
}

/* ------------------------------------------------------------------ /skins */

export function PreviewSkinsPage() {
  const [pages, setPages] = useState<SkinRow[][]>([]);
  const [page, setPage] = useState(1);
  const [exhausted, setExhausted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [parsed, setParsed] = useState<ParsedQuery>({ chips: [], rest: [] });
  const sentinel = useRef<HTMLDivElement>(null);

  const filters = useMemo(() => chipsToSkinParams(parsed.chips, parsed.rest), [parsed]);
  const key = `${filters.rarity ?? "all"}|${filters.search ?? ""}`;

  useEffect(() => { setPage(1); setExhausted(false); setPages([]); }, [key]);

  useEffect(() => {
    let live = true;
    setLoading(true);
    const handle = window.setTimeout(() => {
      const params = new URLSearchParams({ rarity: filters.rarity ?? "all", page: String(page) });
      if ((filters.search ?? "").length > 1) params.set("search", filters.search as string);
      fetch(`/api/skin-data?${params.toString()}`, { credentials: "include" })
        .then((res) => res.json())
        .then((data: SkinRow[] | { skins?: SkinRow[] }) => {
          if (!live) return;
          const rows = Array.isArray(data) ? data : data.skins ?? [];
          setPages((previous) => {
            const next = [...previous];
            next[page - 1] = rows;
            return next;
          });
          if (rows.length === 0) setExhausted(true);
          cacheNames(rows.map((row) => ({ name: row.name, rarity: row.rarity })));
        })
        .catch(() => { if (live) setExhausted(true); })
        .finally(() => { if (live) setLoading(false); });
    }, 200);
    return () => { live = false; window.clearTimeout(handle); };
  }, [key, page, filters.rarity, filters.search]);

  const rows = useMemo(() => {
    const flat = pages.flat().filter(Boolean);
    // Float and wear are not server-side filters, so they narrow here.
    return flat.filter((row) => {
      if (filters.maxPriceCents !== undefined && (row.min_price ?? Infinity) > filters.maxPriceCents) return false;
      return true;
    });
  }, [pages, filters.maxPriceCents]);

  useEffect(() => {
    const node = sentinel.current;
    if (!node || exhausted) return;
    let root: HTMLElement | null = node.parentElement;
    while (root) {
      const overflow = getComputedStyle(root).overflowY;
      if (overflow === "auto" || overflow === "scroll") break;
      root = root.parentElement;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting) && !loading) setPage((value) => value + 1);
    }, { root, rootMargin: "500px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [exhausted, loading]);

  useFaceNames(useMemo(() => rows.slice(0, 60).map((row) => row.name), [rows]));

  const columns: Column<SkinRow>[] = [
    {
      key: "name",
      label: "Skin",
      sortValue: (row) => row.name,
      render: (row) => <Link className="preview-link" to={previewSkinHref(row.name)}>{row.name}</Link>,
    },
    { key: "rarity", label: "Rarity", sortValue: (row) => row.rarity, render: (row) => (
      <span className="preview-chip" style={{ color: rarityTint(row.rarity) }}>{row.rarity}</span>
    ) },
    { key: "collection", label: "Collection", sortValue: (row) => row.collection_name ?? "", render: (row) =>
      row.collection_name
        ? <Link className="preview-link" to={previewCollectionHref(row.collection_name)}>{row.collection_name}</Link>
        : "—" },
    { key: "listings", label: "Listings", align: "end", sortValue: (row) => row.listing_count, render: (row) => (
      <span className="o-mono">{row.listing_count.toLocaleString()}</span>
    ) },
    { key: "price", label: "Floor", align: "end", sortValue: (row) => row.min_price ?? Number.MAX_SAFE_INTEGER, render: (row) => (
      <span className="o-mono">{row.min_price === null ? "—" : formatDollars(row.min_price)}</span>
    ) },
  ];

  return (
    <div className="preview-page">
      <header className="preview-page__head">
        <div>
          <h1>Skins</h1>
          <p>Live listing counts, floors, and float ranges from the production data API.</p>
        </div>
        <div className="preview-page__meta"><span>{rows.length} loaded</span></div>
      </header>

      <PreviewSearch
        value={search}
        onChange={setSearch}
        onParsed={setParsed}
        placeholder="covert <$700  ·  ak nightwish  ·  classified"
        examples={["covert", "ak nightwish", "classified <$50", "awp"]}
      />

      <div className="preview-grid">
        {rows.slice(0, 24).map((row) => <SkinCard key={row.id ?? row.name} row={row} />)}
      </div>

      <section className="preview-panel">
        <header className="preview-panel__head">
          <p className="o-kicker">All loaded skins</p>
          <span className="preview-panel__meta">{rows.length} rows</span>
        </header>
        <PreviewTable
          columns={columns}
          rows={rows}
          rowKey={(row, index) => row.id ?? `${row.name}-${index}`}
          initialSort="listings"
          initialDirection="desc"
          empty={loading ? "Loading skins…" : "No skin matches that search."}
        />
      </section>

      {!exhausted && (
        <div className="preview-sentinel" ref={sentinel}>
          <span className="preview-note">Loading more skins…</span>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------- shared skin stats card */

/** The skin page body. Collection rails click through here; they do not embed it. */
export function SkinStats({ name }: { name: string }) {
  const [detail, setDetail] = useState<SkinDetail | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let live = true;
    setDetail(null);
    setError(false);
    fetch(`/api/skin-data/${encodeURIComponent(name)}`, { credentials: "include" })
      .then((res) => res.json())
      .then((data: SkinDetail) => { if (live) setDetail(data); })
      .catch(() => { if (live) setError(true); });
    return () => { live = false; };
  }, [name]);

  useFaceNames(useMemo(() => [name], [name]));

  if (error) return <p className="preview-note">Could not load {name}.</p>;
  if (!detail?.skin) return <p className="preview-note">Loading {name}…</p>;

  const { skin, listings, stats } = detail;
  const { weapon, finish } = splitSkinName(skin.name);
  const byCondition = priceByCondition(detail.priceSources);
  const scatter: ScatterPoint[] = [
    ...listings.map((row) => ({ price_cents: row.price_cents, float_value: row.float_value, source: row.source })),
    ...(detail.saleHistory ?? []).map((row) => ({ price_cents: row.price_cents, float_value: row.float_value, source: row.source })),
  ];

  const columns: Column<SkinListing>[] = [
    { key: "price", label: "Price", align: "end", sortValue: (row) => row.price_cents, render: (row) => (
      <span className="o-mono">{formatDollars(row.price_cents)}</span>
    ) },
    { key: "float", label: "Float", align: "end", sortValue: (row) => row.float_value ?? 2, render: (row) => (
      <span className="o-mono" title={row.float_value === null ? undefined : String(row.float_value)}>
        {formatFloat(row.float_value) ?? "\u2014"}
      </span>
    ) },
    { key: "wear", label: "Wear", sortValue: (row) => row.float_value ?? 2, render: (row) => (
      <span className="preview-chip">{wearBand(row.float_value)}</span>
    ) },
    { key: "market", label: "Market", sortValue: (row) => row.source, render: (row) => (
      <span className="preview-chip">{sourceLabel(row.source)}</span>
    ) },
    { key: "open", label: "", align: "end", render: (row) => (
      <a
        className="preview-link"
        href={listingUrl(row.id, skin.name, undefined, row.float_value ?? undefined, row.price_cents, row.source)}
        target="_blank"
        rel="noopener noreferrer"
      >
        Buy <ExternalLink size={10} aria-hidden />
      </a>
    ) },
  ];

  return (
    <div className="preview-split">
      <div className="preview-stack">
        <section className="preview-hero-skin" style={{ "--skin-tint": rarityTint(skin.rarity) } as CSSProperties}>
          <Face name={skin.name} size={150} />
          <p className="o-kicker">{weapon} · {finish}</p>
          <dl className="preview-totals">
            <div><dt>Float range</dt><dd>{formatFloat(skin.min_float)} – {formatFloat(skin.max_float)}</dd></div>
            <div><dt>Cheapest</dt><dd>{stats.minPrice === null ? "—" : formatDollars(stats.minPrice)}</dd></div>
            <div><dt>Highest</dt><dd>{stats.maxPrice === null ? "—" : formatDollars(stats.maxPrice)}</dd></div>
            <div><dt>Listings</dt><dd>{stats.totalListings.toLocaleString()}</dd></div>
          </dl>
        </section>
        {byCondition.length > 0 && (
          <section className="preview-panel">
            <header className="preview-panel__head">
              <p className="o-kicker">Price by condition</p>
              <span className="preview-panel__meta">cheapest source</span>
            </header>
            <div className="preview-rows">
              {byCondition.map((row) => (
                <div className="preview-row" key={row.condition}>
                  <span className="preview-chip">{conditionShort(row.condition)}</span>
                  <span className="preview-row__name">{row.condition}</span>
                  <span className="preview-row__num">{formatDollars(row.cents)}</span>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>

      <div className="preview-stack">
        <section className="preview-subpanel">
          <header className="preview-panel__head">
            <p className="o-kicker">Float against price</p>
            <span className="preview-panel__meta">click a series to hide it</span>
          </header>
          <PriceScatter points={scatter} />
        </section>
        <section className="preview-panel">
          <header className="preview-panel__head">
            <p className="o-kicker">Live listings</p>
            <span className="preview-panel__meta">{listings.length.toLocaleString()} on the market</span>
          </header>
          <PreviewTable
            columns={columns}
            rows={listings.slice(0, 60)}
            rowKey={(row) => row.id}
            initialSort="price"
            initialDirection="asc"
            empty="No live listings right now."
          />
        </section>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ /skins/:slug */

export function PreviewSkinPage() {
  const { slug = "" } = useParams();
  const [name, setName] = useState<string | null>(null);
  const [meta, setMeta] = useState<{ rarity: string; collection: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setName(null);
    setMeta(null);
    setError(null);
    fetch(`/api/skin-by-slug/${encodeURIComponent(slug)}`, { credentials: "include" })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("not found"))))
      .then(async (data: { name: string }) => {
        if (!live) return;
        setName(data.name);
        const res = await fetch(`/api/skin-data/${encodeURIComponent(data.name)}`, { credentials: "include" });
        const detail = await res.json() as SkinDetail;
        if (live && detail?.skin) {
          setMeta({ rarity: detail.skin.rarity, collection: detail.skin.collection_name });
        }
      })
      .catch(() => { if (live) setError("That skin is not in the live dataset."); });
    return () => { live = false; };
  }, [slug]);

  if (error) {
    return (
      <div className="preview-page">
        <header className="preview-page__head"><div><h1>Skin</h1><p>{error}</p></div></header>
        <Link className="preview-btn" to={skinsHref()}>Back to skins</Link>
      </div>
    );
  }
  if (!name) return <div className="preview-page"><p className="preview-note">Loading skin…</p></div>;

  const { weapon, finish } = splitSkinName(name);
  return (
    <div className="preview-page">
      <header className="preview-page__head">
        <div>
          <h1>{finish}</h1>
          <p>
            {weapon}
            {meta?.rarity ? ` · ${meta.rarity}` : ""}
            {meta?.collection && (
              <>
                {" · "}
                <Link className="preview-link" to={previewCollectionHref(meta.collection)}>{meta.collection}</Link>
              </>
            )}
          </p>
        </div>
      </header>
      <SkinStats name={name} />
    </div>
  );
}

/* ------------------------------------------------------------- collections */

interface CollectionRow {
  name: string;
  skin_count: number;
  listing_count: number;
  covert_count: number;
  has_knives: boolean;
  has_gloves: boolean;
}

const RARITY_ORDER = ["Covert", "Classified", "Restricted", "Mil-Spec Grade", "Industrial Grade", "Consumer Grade"];
const COLLECTION_SKIN_LIMIT = 200;
const COLLECTION_FETCH_CONCURRENCY = 6;

function parseSkinRows(data: SkinRow[] | { skins?: SkinRow[] }): SkinRow[] {
  return Array.isArray(data) ? data : data.skins ?? [];
}

async function fetchCollectionSkins(name: string): Promise<SkinRow[]> {
  const params = new URLSearchParams({
    rarity: "all",
    collection: name,
    limit: String(COLLECTION_SKIN_LIMIT),
  });
  const res = await fetch(`/api/skin-data?${params.toString()}`, { credentials: "include" });
  return parseSkinRows(await res.json() as SkinRow[] | { skins?: SkinRow[] });
}

async function mapPool<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (queue.length > 0) {
      const current = queue.shift();
      if (current === undefined) return;
      await fn(current);
    }
  });
  await Promise.all(workers);
}

type CollectionSkinBundle = { faces: SkinRow[]; tally: CollectionSkinTally };

function useCollectionSkins(names: string[]) {
  const [byCollection, setByCollection] = useState<Record<string, CollectionSkinBundle>>({});
  const fetched = useRef(new Set<string>());
  const mounted = useRef(true);
  const key = names.join("\u0000");
  useEffect(() => () => { mounted.current = false; }, []);
  useEffect(() => {
    const list = key.split("\u0000").filter((name) => name && !fetched.current.has(name));
    if (list.length === 0) return;
    for (const name of list) fetched.current.add(name);
    void mapPool(list, COLLECTION_FETCH_CONCURRENCY, async (name) => {
      try {
        const rows = await fetchCollectionSkins(name);
        const tally = tallyCollectionSkins(rows);
        const faces = [...rows]
          .sort((a, b) => RARITY_ORDER.indexOf(a.rarity) - RARITY_ORDER.indexOf(b.rarity))
          .slice(0, 4);
        if (!mounted.current) return;
        setByCollection((prev) => ({ ...prev, [name]: { faces, tally } }));
        await loadFaces(faces.map((row) => row.name), FACE_CACHE);
        if (mounted.current) setByCollection((prev) => ({ ...prev }));
      } catch {
        fetched.current.delete(name);
      }
    });
  }, [key]);
  return byCollection;
}

export function PreviewCollectionsPage() {
  const [rows, setRows] = useState<CollectionRow[]>([]);
  const [search, setSearch] = useState("");
  const [visible, setVisible] = useState(12);
  const sentinel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    fetch("/api/collections", { credentials: "include" })
      .then((res) => res.json())
      .then((data: CollectionRow[]) => {
        if (!live) return;
        const list = Array.isArray(data) ? data : [];
        setRows(list);
        cacheNames(list.map((row) => ({ name: row.name, kind: "collection" as const })));
      })
      .catch(() => { if (live) setRows([]); });
    return () => { live = false; };
  }, []);

  const term = search.trim().toLowerCase();
  const filtered = useMemo(
    () => (term ? rows.filter((row) => row.name.toLowerCase().includes(term)) : rows),
    [rows, term],
  );
  useEffect(() => { setVisible(12); }, [term]);

  // The API returns every collection at once, so paging is local.
  useEffect(() => {
    const node = sentinel.current;
    if (!node || visible >= filtered.length) return;
    let root: HTMLElement | null = node.parentElement;
    while (root) {
      const overflow = getComputedStyle(root).overflowY;
      if (overflow === "auto" || overflow === "scroll") break;
      root = root.parentElement;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setVisible((value) => value + 12);
    }, { root, rootMargin: "500px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [visible, filtered.length]);

  const shown = filtered.slice(0, visible);
  const skinNames = useMemo(() => {
    const names = new Set(shown.map((row) => row.name));
    for (const row of rows) {
      if (row.has_knives || row.has_gloves) names.add(row.name);
    }
    return [...names];
  }, [shown, rows]);
  const skins = useCollectionSkins(skinNames);

  const skinCopy = (row: CollectionRow) =>
    formatCollectionSkinCopy(countsFromCollectionRow(row, skins[row.name]?.tally ?? null));

  const columns: Column<CollectionRow>[] = [
    { key: "name", label: "Collection", sortValue: (row) => row.name, render: (row) => (
      <Link className="preview-link" to={previewCollectionHref(row.name)}>{row.name}</Link>
    ) },
    { key: "skins", label: "Skins", align: "end", sortValue: (row) =>
      collectionSkinTotal(countsFromCollectionRow(row, skins[row.name]?.tally ?? null)), render: (row) => (
      <span className="o-mono">{skinCopy(row)}</span>
    ) },
    { key: "covert", label: "Coverts", align: "end", sortValue: (row) => row.covert_count, render: (row) => (
      <span className="o-mono">{row.covert_count}</span>
    ) },
    { key: "listings", label: "Listings", align: "end", sortValue: (row) => row.listing_count, render: (row) => (
      <span className="o-mono">{row.listing_count.toLocaleString()}</span>
    ) },
    { key: "rare", label: "Rare pool", render: (row) => (
      <>
        {row.has_knives && <span className="preview-chip">knives</span>}
        {row.has_gloves && <span className="preview-chip">gloves</span>}
        {!row.has_knives && !row.has_gloves && "—"}
      </>
    ) },
  ];

  return (
    <div className="preview-page">
      <title>CS2 Collections — Browse All Weapon Cases & Collections | TradeUpBot</title>
      <meta name="description" content="Browse all CS2 collections. See skins, float ranges, and trade-up opportunities for every weapon case and collection." />
      <meta name="robots" content="index, follow" />
      <link rel="canonical" href="https://tradeupbot.app/collections" />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(buildCollectionsHubJsonLd([])) }} />
      <header className="preview-page__head">
        <div>
          <h1>Collections</h1>
          <p>CS2 collections group weapon skins by the case, operation, map, or themed release where those skins entered the game. Each collection contains skins across rarity tiers, and those rarity tiers determine which inputs and outputs can appear in a trade-up.</p>
        </div>
        <div className="preview-page__meta"><span>{rows.length} collections</span></div>
      </header>

      <PreviewSearch
        value={search}
        onChange={setSearch}
        placeholder="Search a collection"
        examples={["dreams", "kilowatt", "recoil"]}
      />

      <div className="preview-collections">
        {shown.map((row) => (
          <Link key={row.name} className="preview-collection" to={previewCollectionHref(row.name)}>
            <span className="preview-collection__cluster">
              {(skins[row.name]?.faces ?? []).map((skin) => (
                <i key={skin.name} style={{ "--skin-tint": rarityTint(skin.rarity) } as CSSProperties}>
                  <Face name={skin.name} size={46} />
                </i>
              ))}
              {(skins[row.name]?.faces ?? []).length === 0 && <em className="preview-note">loading skins…</em>}
            </span>
            <b>{row.name}</b>
            <span className="preview-collection__meta">
              {skinCopy(row)} · {row.listing_count.toLocaleString()} listings
            </span>
          </Link>
        ))}
        {shown.length === 0 && <p className="preview-note">Loading collections…</p>}
      </div>

      <section className="preview-panel">
        <header className="preview-panel__head">
          <p className="o-kicker">All collections</p>
          <span className="preview-panel__meta">{filtered.length} rows</span>
        </header>
        <PreviewTable
          columns={columns}
          rows={filtered}
          rowKey={(row) => row.name}
          initialSort="listings"
          initialDirection="desc"
          empty="No collection matches that search."
        />
      </section>

      {visible < filtered.length && (
        <div className="preview-sentinel" ref={sentinel}>
          <span className="preview-note">Loading more collections…</span>
        </div>
      )}
    </div>
  );
}

export function PreviewCollectionPage() {
  const { name = "" } = useParams();
  const [title, setTitle] = useState<string | null>(null);
  const [skins, setSkins] = useState<SkinRow[]>([]);

  useEffect(() => {
    let live = true;
    fetch("/api/collections", { credentials: "include" })
      .then((res) => res.json())
      .then((data: CollectionRow[]) => {
        const match = (Array.isArray(data) ? data : []).find(
          (row) => previewCollectionHref(row.name).endsWith(`/${name}`),
        );
        if (!live || !match) return null;
        setTitle(match.name);
        return fetchCollectionSkins(match.name);
      })
      .then((rows) => {
        if (!live || !rows) return;
        setSkins([...rows].sort((a, b) => RARITY_ORDER.indexOf(a.rarity) - RARITY_ORDER.indexOf(b.rarity)));
      })
      .catch(() => { if (live) setSkins([]); });
    return () => { live = false; };
  }, [name]);

  // Every skin in the collection, not a six-tile strip.
  useFaceNames(useMemo(() => skins.map((row) => row.name), [skins]));
  useEffect(() => { cacheNames(skins.map((row) => ({ name: row.name, rarity: row.rarity }))); }, [skins]);

  const board = usePreviewTradeUps({ collection: title ?? undefined, perPage: 6 });

  const columns: Column<SkinRow>[] = [
    { key: "name", label: "Skin", sortValue: (row) => row.name, render: (row) => (
      <Link className="preview-link" to={previewSkinHref(row.name)}>{row.name}</Link>
    ) },
    { key: "rarity", label: "Rarity", sortValue: (row) => RARITY_ORDER.indexOf(row.rarity), render: (row) => (
      <span className="preview-chip" style={{ color: rarityTint(row.rarity) }}>{row.rarity}</span>
    ) },
    { key: "listings", label: "Listings", align: "end", sortValue: (row) => row.listing_count, render: (row) => (
      <span className="o-mono">{row.listing_count.toLocaleString()}</span>
    ) },
    { key: "price", label: "Floor", align: "end", sortValue: (row) => row.min_price ?? Number.MAX_SAFE_INTEGER, render: (row) => (
      <span className="o-mono">{row.min_price === null ? "—" : formatDollars(row.min_price)}</span>
    ) },
  ];

  return (
    <div className="preview-page">
      <header className="preview-page__head">
        <div>
          <nav className="preview-crumb" aria-label="Breadcrumb">
            <Link className="preview-link" to={collectionsHref()}>Collections</Link>
            <span aria-hidden>/</span>
            <span>{title ?? "Collection"}</span>
          </nav>
          <h1>{title ?? "Collection"}</h1>
          <p>{formatCollectionSkinCopy(tallyCollectionSkins(skins))} · every skin in the collection, and the trade-ups the loop found inside it.</p>
        </div>
        <div className="preview-page__meta"><span>{board.tradeUps.length} trade-ups</span></div>
      </header>

      {skins.length > 0 && (
        <section className="preview-panel">
          <header className="preview-panel__head">
            <p className="o-kicker">Every skin in this collection</p>
            <span className="preview-panel__meta">{skins.length} skins</span>
          </header>
          <div className="preview-allskins">
            {skins.map((row) => (
              <Link
                key={row.id ?? row.name}
                to={previewSkinHref(row.name)}
                className="preview-allskins__tile"
                style={{ "--skin-tint": rarityTint(row.rarity) } as CSSProperties}
                title={row.name}
              >
                <Face name={row.name} size={52} />
                <b>{splitSkinName(row.name).finish}</b>
              </Link>
            ))}
          </div>
        </section>
      )}

      {title && (
        <PreviewBoard
          tradeUps={board.tradeUps}
          loading={board.loading}
          isFree={board.isFree}
          expandedId={board.expandedId}
          onExpand={board.onExpand}
          query={board.query}
          onQuery={board.onQuery}
          loadMore={board.loadMore}
          exhausted={board.exhausted}
          collection={title}
          heading="Trade-ups from this collection"
          lede="Ranked the same way as the board, filtered to this collection."
          embed
        />
      )}

      <section className="preview-panel">
        <header className="preview-panel__head">
          <p className="o-kicker">Skins in this collection</p>
          <span className="preview-panel__meta">{skins.length} rows</span>
        </header>
        <PreviewTable
          columns={columns}
          rows={skins}
          rowKey={(row, index) => row.id ?? `${row.name}-${index}`}
          initialSort="rarity"
          initialDirection="asc"
          empty="No skins loaded for this collection."
        />
      </section>
    </div>
  );
}
