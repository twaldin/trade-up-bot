/**
 * Skin and collection pages inside the preview shell. Same live `/api/skin-data`,
 * `/api/skin-by-slug`, `/api/collections` and `/api/trade-ups` routes production
 * uses, rendered on the Outlay kit instead of the old chrome.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ExternalLink, Search } from "lucide-react";
import { Link, useParams } from "react-router-dom";
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
import { createFaceCache, faceFor, faceOrderKey, loadFaces, namesFromCacheKey } from "../lib/skin-images.js";
import { cacheNames, PreviewSearch } from "../components/PreviewSearch.js";
import { chipsToSkinParams, listingMatchesQuery, parseQuery, type ParsedQuery } from "../lib/query-parse.js";
import {
  collectionSkinTotal,
  countsFromCollectionRow,
  formatCollectionSkinCopy,
  tallyCollectionSkins,
  type CollectionSkinTally,
} from "../lib/collection-skins.js";
import { PreviewBoard, usePreviewTradeUps } from "./PreviewBoard.js";
import {
  RATE_LIMIT_MANUAL_COPY,
  SLOW_DOWN_COPY,
  applyRateLimit,
  browseErrorKind,
  canLoadMore,
  cursorFor,
  fetchBrowseJson,
  isAbortError,
  isRateLimitError,
  pageIsShort,
  retryAfterOf,
  retryDelayMs,
  startCursor,
  type PageCursor,
} from "../lib/page-fetch.js";
import { useBrowseHeld, useBrowseJson } from "../lib/use-browse-json.js";

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

function WearCell({ value }: { value: number | null }) {
  const band = wearBand(value);
  const pct = value === null || !Number.isFinite(value) ? null : Math.min(100, Math.max(0, value * 100));
  return (
    <span className="preview-wear">
      {pct !== null && (
        <span className="preview-wear__bar" aria-hidden>
          <i style={{ width: `${pct}%` }} />
        </span>
      )}
      <span className="preview-chip">{band}</span>
    </span>
  );
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
  const key = faceOrderKey(names);
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
        <span className="preview-skin__art"><Face name={row.name} size={96} /></span>
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

/** Matches `/api/skin-data` default limit. Do not send `limit=` — the cache key omits it. */
const SKIN_INDEX_PAGE_SIZE = 100;

const SKIN_INDEX_TTL_MS = 5 * 60_000;
const SKIN_SEARCH_DEBOUNCE_MS = 200;

export function PreviewSkinsPage() {
  // Pages are tagged with the key they belong to, so a new search keeps showing
  // the last good grid until its own first page lands.
  const [pages, setPages] = useState<{ key: string; pages: SkinRow[][] }>({ key: "", pages: [] });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [parsed, setParsed] = useState<ParsedQuery>({ chips: [], rest: [] });
  const [backoffUntil, setBackoffUntil] = useState(0);
  const [throttle, setThrottle] = useState<string | null>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const inFlightRef = useRef(false);
  const attemptRef = useRef(0);

  const filters = useMemo(() => chipsToSkinParams(parsed.chips, parsed.rest), [parsed]);
  const key = `${filters.rarity ?? "all"}|${filters.search ?? ""}`;
  const [cursorState, setCursor] = useState<PageCursor>(() => startCursor(key));
  const { page, exhausted, retry } = cursorFor(cursorState, key);
  const mountedKey = useRef(key);

  useEffect(() => {
    attemptRef.current = 0;
    setBackoffUntil(0);
    setThrottle(null);
  }, [key]);

  useEffect(() => {
    let live = true;
    const controller = new AbortController();
    inFlightRef.current = true;
    setLoading(true);
    const handle = window.setTimeout(() => {
      const params = new URLSearchParams({ rarity: filters.rarity ?? "all", page: String(page) });
      if ((filters.search ?? "").length > 1) params.set("search", filters.search as string);
      fetchBrowseJson<SkinRow[] | { skins?: SkinRow[] }>(`/api/skin-data?${params.toString()}`, {
        signal: controller.signal,
        ttlMs: SKIN_INDEX_TTL_MS,
      })
        .then((data) => {
          if (!live) return;
          const rows = Array.isArray(data) ? data : data.skins ?? [];
          setPages((previous) => {
            const next = previous.key === key ? [...previous.pages] : [];
            next[page - 1] = rows;
            return { key, pages: next };
          });
          if (pageIsShort(rows.length, SKIN_INDEX_PAGE_SIZE)) {
            setCursor((previous) => ({ ...cursorFor(previous, key), exhausted: true }));
          }
          attemptRef.current = 0;
          setThrottle(null);
          cacheNames(rows.map((row) => ({ name: row.name, rarity: row.rarity })));
        })
        .catch((err: unknown) => {
          if (!live || isAbortError(err)) return;
          if (isRateLimitError(err)) {
            const next = applyRateLimit(attemptRef.current, Date.now(), { retryAfterMs: retryAfterOf(err), random: Math.random });
            attemptRef.current = next.attempt;
            setBackoffUntil(next.backoffUntil);
            setThrottle(SLOW_DOWN_COPY);
            return;
          }
          setCursor((previous) => ({ ...cursorFor(previous, key), exhausted: true }));
        })
        .finally(() => {
          if (!live) return;
          inFlightRef.current = false;
          setLoading(false);
        });
    }, page === 1 && key !== mountedKey.current ? SKIN_SEARCH_DEBOUNCE_MS : 0);
    return () => {
      live = false;
      window.clearTimeout(handle);
      controller.abort();
      inFlightRef.current = false;
    };
  }, [key, page, retry, filters.rarity, filters.search]);

  const rows = useMemo(() => {
    const flat = pages.pages.flat().filter(Boolean);
    return flat.filter((row) => {
      if (filters.maxPriceCents !== undefined && (row.min_price ?? Infinity) > filters.maxPriceCents) return false;
      return true;
    });
  }, [pages, filters.maxPriceCents]);

  // Once the wait is over, ask for the throttled page again rather than skipping it.
  useEffect(() => {
    if (!backoffUntil) return;
    const wait = Math.max(0, backoffUntil - Date.now());
    const handle = window.setTimeout(() => {
      setThrottle(null);
      setBackoffUntil(0);
      setCursor((previous) => {
        const current = cursorFor(previous, key);
        return { ...current, retry: current.retry + 1 };
      });
    }, wait);
    return () => window.clearTimeout(handle);
  }, [backoffUntil, key]);

  const loadMore = useCallback(() => {
    if (!canLoadMore({
      inFlight: inFlightRef.current || loading,
      exhausted,
      backoffUntil,
      now: Date.now(),
    })) return;
    inFlightRef.current = true;
    setCursor((previous) => {
      const current = cursorFor(previous, key);
      return { ...current, page: current.page + 1 };
    });
  }, [loading, exhausted, backoffUntil, key]);

  const held = useBrowseHeld();
  const notice = throttle ?? (held ? SLOW_DOWN_COPY : null);

  useEffect(() => {
    const node = sentinel.current;
    if (!node || exhausted || notice) return;
    let root: HTMLElement | null = node.parentElement;
    while (root) {
      const overflow = getComputedStyle(root).overflowY;
      if (overflow === "auto" || overflow === "scroll") break;
      root = root.parentElement;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) loadMore();
    }, { root, rootMargin: "500px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [exhausted, loadMore, notice]);

  // The API's page size is not fixed (a warmed cache can hand page 1 back with
  // 200 rows), so ask for exactly what the grid renders, in the order it renders.
  useFaceNames(useMemo(() => rows.map((row) => row.name), [rows]));

  return (
    <div className="preview-page">
      <title>CS2 Skin Prices & Float Data — All Skins | TradeUpBot</title>
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
        placeholder="Search skins…"
        examples={["covert", "ak nightwish", "classified <$50", "awp"]}
      />

      <div className="preview-grid">
        {rows.map((row) => <SkinCard key={row.id ?? row.name} row={row} />)}
      </div>
      {loading && rows.length === 0 && <p className="preview-note">Loading skins…</p>}
      {!loading && !notice && rows.length === 0 && <p className="preview-note">No skin matches that search.</p>}

      {!exhausted && !notice && (
        <div className="preview-sentinel" ref={sentinel}>
          <span className="preview-note">Loading more skins…</span>
        </div>
      )}
      {notice && <p className="preview-note">{notice}</p>}
    </div>
  );
}

/* ---------------------------------------------------- shared skin stats card */

const LISTING_PAGE = 40;
/** Matches the server's 60s `skin_detail:` cache, so a revisit inside it is free. */
const SKIN_DETAIL_TTL_MS = 60_000;
const SKIN_SLUG_TTL_MS = 10 * 60_000;

function skinDetailUrl(name: string): string {
  return `/api/skin-data/${encodeURIComponent(name)}`;
}

/** The skin page body. Collection rails click through here; they do not embed it. */
export function SkinStats({ name, board }: { name: string; board?: ReactNode }) {
  const { data: detail, error, throttled } = useBrowseJson<SkinDetail>(skinDetailUrl(name), SKIN_DETAIL_TTL_MS);
  const [listingQuery, setListingQuery] = useState("");
  const [listingVisible, setListingVisible] = useState(LISTING_PAGE);
  const [pane, setPane] = useState<"listings" | "tradeups">("listings");
  const listingSentinel = useRef<HTMLDivElement>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
  const panesRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setListingQuery("");
    setListingVisible(LISTING_PAGE);
  }, [name]);

  useFaceNames(useMemo(() => [name], [name]));

  const listingParsed = useMemo(() => parseQuery(listingQuery), [listingQuery]);
  const filteredListings = useMemo(() => {
    const list = detail?.listings ?? [];
    return list.filter((row) => listingMatchesQuery(row, listingParsed, wearBand(row.float_value)));
  }, [detail, listingParsed]);

  useEffect(() => { setListingVisible(LISTING_PAGE); }, [listingQuery]);

  useEffect(() => {
    const node = listingSentinel.current;
    if (!node || listingVisible >= filteredListings.length) return;
    let root: HTMLElement | null = node.parentElement;
    while (root) {
      const overflow = getComputedStyle(root).overflowY;
      if (overflow === "auto" || overflow === "scroll") break;
      root = root.parentElement;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setListingVisible((value) => value + LISTING_PAGE);
      }
    }, { root, rootMargin: "240px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [listingVisible, filteredListings.length]);

  if (error) return <p className="preview-note">Could not load {name}.</p>;
  if (!detail?.skin) return <p className="preview-note">{throttled ? SLOW_DOWN_COPY : `Loading ${name}…`}</p>;

  const { skin, listings, stats } = detail;
  const { weapon, finish } = splitSkinName(skin.name);
  const byCondition = priceByCondition(detail.priceSources);
  const scatter: ScatterPoint[] = [
    ...listings.map((row) => ({ price_cents: row.price_cents, float_value: row.float_value, source: row.source })),
    ...(detail.saleHistory ?? []).map((row) => ({ price_cents: row.price_cents, float_value: row.float_value, source: row.source })),
  ];
  const shownListings = filteredListings.slice(0, listingVisible);

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
      <WearCell value={row.float_value} />
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

  const showPane = (next: "listings" | "tradeups") => {
    setPane(next);
    const panes = panesRef.current;
    const tabs = tabsRef.current;
    if (panes && tabs && panes.getBoundingClientRect().top < tabs.getBoundingClientRect().bottom) {
      panes.scrollIntoView({ block: "start" });
    }
  };

  return (
    <div className="preview-skin-detail">
      <div className="preview-tabs preview-skin-tabs" role="tablist" aria-label="Skin detail" ref={tabsRef}>
        <button
          type="button"
          role="tab"
          className="o-tab"
          aria-selected={pane === "listings"}
          data-state={pane === "listings" ? "active" : "inactive"}
          data-pane="listings"
          onClick={() => showPane("listings")}
        >
          Listings
        </button>
        <button
          type="button"
          role="tab"
          className="o-tab"
          aria-selected={pane === "tradeups"}
          data-state={pane === "tradeups" ? "active" : "inactive"}
          data-pane="tradeups"
          onClick={() => showPane("tradeups")}
        >
          Trade-ups
        </button>
      </div>

      <div className="preview-skin-detail__meta">
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

      <section className="preview-subpanel preview-skin-detail__chart">
        <header className="preview-panel__head">
          <p className="o-kicker">Float against price</p>
          <span className="preview-panel__meta">click a series to hide it</span>
        </header>
        <PriceScatter points={scatter} />
      </section>

      <div className="preview-skin-stage">
        <div className="preview-skin-panes" data-pane={pane} ref={panesRef}>
          <section className="preview-panel preview-skin-pane preview-skin-pane--listings">
            <header className="preview-panel__head">
              <p className="o-kicker">Live listings</p>
              <span className="preview-panel__meta">
                {shownListings.length.toLocaleString()}
                {filteredListings.length !== listings.length ? ` / ${filteredListings.length.toLocaleString()}` : ""}
                {" of "}
                {listings.length.toLocaleString()}
              </span>
            </header>
            <label className="preview-field preview-field--search preview-listings-search">
              <Search size={12} aria-hidden />
              <input
                className="preview-field__input"
                value={listingQuery}
                placeholder="Search listings…"
                onChange={(event) => setListingQuery(event.target.value)}
              />
            </label>
            <PreviewTable
              columns={columns}
              rows={shownListings}
              rowKey={(row) => row.id}
              initialSort="price"
              initialDirection="asc"
              empty="No live listings match that search."
              dense
              fit
            />
            {listingVisible < filteredListings.length && (
              <div className="preview-sentinel" ref={listingSentinel}>
                <span className="preview-note">Loading more listings…</span>
              </div>
            )}
          </section>
          <section className="preview-skin-pane preview-skin-pane--board">
            {board}
          </section>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ /skins/:slug */

export function PreviewSkinPage() {
  const { slug = "" } = useParams();
  const bySlug = useBrowseJson<{ name: string }>(`/api/skin-by-slug/${encodeURIComponent(slug)}`, SKIN_SLUG_TTL_MS);
  const name = bySlug.data?.name ?? null;
  // Same URL SkinStats reads, so the header and the stats card share one request.
  const detail = useBrowseJson<SkinDetail>(name ? skinDetailUrl(name) : null, SKIN_DETAIL_TTL_MS);
  const meta = detail.data?.skin
    ? { rarity: detail.data.skin.rarity, collection: detail.data.skin.collection_name }
    : null;
  const error = bySlug.error ? "That skin is not in the live dataset." : null;
  const board = usePreviewTradeUps({ skin: name ?? undefined, perPage: 6, enabled: Boolean(name) });

  if (error) {
    return (
      <div className="preview-page">
        <header className="preview-page__head"><div><h1>Skin</h1><p>{error}</p></div></header>
        <Link className="preview-btn" to={skinsHref()}>Back to skins</Link>
      </div>
    );
  }
  if (!name) {
    return <div className="preview-page"><p className="preview-note">{bySlug.throttled ? SLOW_DOWN_COPY : "Loading skin…"}</p></div>;
  }

  const { weapon, finish } = splitSkinName(name);
  return (
    <div className="preview-page">
      <title>{`${name} — CS2 Price, Float Range & Trade-Ups | TradeUpBot`}</title>
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
      <SkinStats
        name={name}
        board={
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
            throttle={board.throttle}
            retryReady={board.retryReady}
            failed={board.failed}
            refreshing={board.refreshing}
            onRetry={board.retry}
            heading="Trade-ups using this skin"
            lede="Ranked the same way as the board, filtered to this skin as an input or an output."
            lockedSkin={name}
            embed
          />
        }
      />
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
/** Visible cards are queued first; knife/glove tallies for the table trail behind them. */
const COLLECTION_FETCH_CONCURRENCY = 3;
const COLLECTION_TTL_MS = 10 * 60_000;
const COLLECTIONS_TTL_MS = 5 * 60_000;
/** Faces for collections that land close together go out as one batch. */
const COLLECTION_FACE_FLUSH_MS = 150;
const NO_COLLECTIONS: CollectionRow[] = [];

function parseSkinRows(data: SkinRow[] | { skins?: SkinRow[] }): SkinRow[] {
  return Array.isArray(data) ? data : data.skins ?? [];
}

async function fetchCollectionSkins(name: string, signal?: AbortSignal): Promise<SkinRow[]> {
  const params = new URLSearchParams({
    rarity: "all",
    collection: name,
    limit: String(COLLECTION_SKIN_LIMIT),
  });
  return parseSkinRows(await fetchBrowseJson<SkinRow[] | { skins?: SkinRow[] }>(`/api/skin-data?${params.toString()}`, {
    signal,
    ttlMs: COLLECTION_TTL_MS,
  }));
}

function useCollectionsIndex(): { rows: CollectionRow[]; throttled: boolean } {
  const { data, throttled } = useBrowseJson<CollectionRow[]>("/api/collections", COLLECTIONS_TTL_MS);
  return { rows: Array.isArray(data) ? data : NO_COLLECTIONS, throttled };
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
  const pendingFaces = useRef(new Set<string>());
  const faceTimer = useRef(0);
  const key = names.join("\u0000");
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      window.clearTimeout(faceTimer.current);
      faceTimer.current = 0;
    };
  }, []);
  const queueFaces = useCallback((faceNames: string[]) => {
    for (const faceName of faceNames) pendingFaces.current.add(faceName);
    if (faceTimer.current) return;
    faceTimer.current = window.setTimeout(() => {
      faceTimer.current = 0;
      const batch = [...pendingFaces.current];
      pendingFaces.current.clear();
      void loadFaces(batch, FACE_CACHE).then(() => {
        if (mounted.current) setByCollection((prev) => ({ ...prev }));
      });
    }, COLLECTION_FACE_FLUSH_MS);
  }, []);
  useEffect(() => {
    const list = key.split("\u0000").filter((name) => name && !fetched.current.has(name));
    if (list.length === 0) return;
    for (const name of list) fetched.current.add(name);
    void mapPool(list, COLLECTION_FETCH_CONCURRENCY, async (name) => {
      try {
        if (!mounted.current) {
          fetched.current.delete(name);
          return;
        }
        const rows = await fetchCollectionSkins(name);
        const tally = tallyCollectionSkins(rows);
        const faces = [...rows]
          .sort((a, b) => RARITY_ORDER.indexOf(a.rarity) - RARITY_ORDER.indexOf(b.rarity))
          .slice(0, 4);
        if (!mounted.current) {
          fetched.current.delete(name);
          return;
        }
        setByCollection((prev) => ({ ...prev, [name]: { faces, tally } }));
        queueFaces(faces.map((row) => row.name));
      } catch {
        fetched.current.delete(name);
      }
    });
  }, [key, queueFaces]);
  return byCollection;
}

export function PreviewCollectionsPage() {
  const { rows, throttled: indexThrottled } = useCollectionsIndex();
  const [search, setSearch] = useState("");
  const [visible, setVisible] = useState(12);
  const sentinel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    cacheNames(rows.map((row) => ({ name: row.name, kind: "collection" as const })));
  }, [rows]);

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
        {shown.length === 0 && (
          <p className="preview-note">{indexThrottled ? SLOW_DOWN_COPY : "Loading collections…"}</p>
        )}
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
  const index = useCollectionsIndex();
  const title = index.rows.find((row) => previewCollectionHref(row.name).endsWith(`/${name}`))?.name ?? null;
  const [skins, setSkins] = useState<SkinRow[]>([]);
  const [skinsStatus, setSkinsStatus] = useState<"loading" | "ok" | "throttled" | "failed">("loading");
  const [skinsRetry, setSkinsRetry] = useState(0);
  const [skinsScheduled, setSkinsScheduled] = useState(false);
  const skinsAttempts = useRef(0);

  const skinsScope = useRef(title);
  useLayoutEffect(() => {
    if (skinsScope.current === title) return;
    skinsScope.current = title;
    skinsAttempts.current = 0;
    setSkinsScheduled(false);
    setSkins([]);
    setSkinsStatus("loading");
  }, [title]);

  useEffect(() => {
    if (!title) return;
    const controller = new AbortController();
    let timer = 0;
    fetchCollectionSkins(title, controller.signal)
      .then((rows) => {
        skinsAttempts.current = 0;
        setSkinsScheduled(false);
        setSkins([...rows].sort((a, b) => RARITY_ORDER.indexOf(a.rarity) - RARITY_ORDER.indexOf(b.rarity)));
        setSkinsStatus("ok");
      })
      .catch((err: unknown) => {
        const kind = browseErrorKind(err);
        if (kind === "aborted") return;
        if (kind === "throttled") {
          setSkinsStatus("throttled");
          if (skinsAttempts.current >= 1) {
            setSkinsScheduled(false);
            return;
          }
          skinsAttempts.current += 1;
          setSkinsScheduled(true);
          timer = window.setTimeout(() => setSkinsRetry((n) => n + 1), retryDelayMs());
          return;
        }
        setSkinsStatus("failed");
      });
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [title, skinsRetry]);

  const unknown = !title && index.rows.length > 0;
  const waitingOnIndex = !title && !unknown;
  const skinsCopy = (() => {
    if (waitingOnIndex && index.throttled) return SLOW_DOWN_COPY;
    if (unknown) return "That collection is not in the live dataset.";
    if (skinsStatus === "ok") return formatCollectionSkinCopy(tallyCollectionSkins(skins));
    if (skinsStatus === "throttled") return skinsScheduled ? SLOW_DOWN_COPY : RATE_LIMIT_MANUAL_COPY;
    if (skinsStatus === "failed") return "Couldn't load this collection's skins.";
    return "Loading skins…";
  })();
  const heading = title ?? (unknown ? "Collection not found" : "Loading collection…");

  // Every skin in the collection, not a six-tile strip.
  useFaceNames(useMemo(() => skins.map((row) => row.name), [skins]));
  useEffect(() => { cacheNames(skins.map((row) => ({ name: row.name, rarity: row.rarity }))); }, [skins]);

  const board = usePreviewTradeUps({ collection: title ?? undefined, perPage: 6, enabled: Boolean(title) });
  const tradeUpCount = board.throttle && board.tradeUps.length === 0 ? "— trade-ups" : `${board.tradeUps.length} trade-ups`;

  return (
    <div className="preview-page">
      <title>{title ? `${title.replace(/^The\s+/i, "").replace(/\s+Collection$/i, "")} Collection — CS2 Skins, Prices & Trade-Ups | TradeUpBot` : "CS2 Collections | TradeUpBot"}</title>
      <header className="preview-page__head">
        <div>
          <nav className="preview-crumb" aria-label="Breadcrumb">
            <Link className="preview-link" to={collectionsHref()}>Collections</Link>
            <span aria-hidden>/</span>
            <span>{heading}</span>
          </nav>
          <h1>{heading}</h1>
          <p>
            {unknown || (waitingOnIndex && index.throttled) || skinsStatus === "throttled" || skinsStatus === "failed"
              ? skinsCopy
              : `${skinsCopy} · every skin in the collection, and the trade-ups the loop found inside it.`}
          </p>
        </div>
        <div className="preview-page__meta"><span>{tradeUpCount}</span></div>
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
          throttle={board.throttle}
          retryReady={board.retryReady}
          failed={board.failed}
          refreshing={board.refreshing}
          onRetry={board.retry}
          collection={title}
          heading="Trade-ups from this collection"
          lede="Ranked the same way as the board, filtered to this collection."
          embed
        />
      )}
    </div>
  );
}
