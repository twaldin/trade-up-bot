/**
 * Skin data pages inside the preview shell. Same live `/api/skin-data` routes
 * production uses, rendered on Outlay instead of the old chrome.
 */
import { useEffect, useMemo, useState } from "react";
import { ExternalLink } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { toSlug } from "../../../shared/slugs.js";
import { formatDollars, listingUrl, sourceLabel } from "../../utils/format.js";
import {
  conditionShort,
  formatFloat,
  previewCollectionHref,
  previewSkinHref,
  rarityTint,
  splitSkinName,
} from "../lib/board.js";
import { createFaceCache, faceCacheKey, faceFor, loadFaces, namesFromCacheKey } from "../lib/skin-images.js";

const FACE_CACHE = createFaceCache();

interface SkinRow {
  id: string;
  name: string;
  rarity: string;
  weapon: string;
  collection_name: string | null;
  listing_count: number;
  min_price: number | null;
  min_float_seen: number | null;
  max_float_seen: number | null;
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
  priceSources: { source: string; condition: string; avg_price_cents: number; volume: string }[];
  stats: { totalListings: number; minPrice: number | null; maxPrice: number | null; saleCount: number };
}

const WEAR_BANDS: [string, number, number][] = [
  ["FN", 0, 0.07],
  ["MW", 0.07, 0.15],
  ["FT", 0.15, 0.38],
  ["WW", 0.38, 0.45],
  ["BS", 0.45, 1],
];

/** Wear band for a float, the CS2 boundaries the engine already works to. */
export function wearBand(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return WEAR_BANDS.find(([, lo, hi]) => value >= lo && value < hi)?.[0] ?? "BS";
}

/** Cheapest observed price per condition, across whichever sources reported. */
function priceByCondition(sources: SkinDetail["priceSources"]): { condition: string; cents: number }[] {
  const best = new Map<string, number>();
  for (const row of sources) {
    if (!row.condition || row.avg_price_cents <= 0) continue;
    const current = best.get(row.condition);
    if (current === undefined || row.avg_price_cents < current) best.set(row.condition, row.avg_price_cents);
  }
  const order = ["Factory New", "Minimal Wear", "Field-Tested", "Well-Worn", "Battle-Scarred"];
  return order
    .filter((condition) => best.has(condition))
    .map((condition) => ({ condition, cents: best.get(condition) as number }));
}

function Face({ name, size }: { name: string; size: number }) {
  const src = faceFor(FACE_CACHE, name);
  if (!src) return <div className="preview-skin__ph" style={{ width: size, height: size }} />;
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

export function PreviewSkinsPage() {
  const [rows, setRows] = useState<SkinRow[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    setLoading(true);
    const url = `/api/skin-data?rarity=all&page=1${search.length > 1 ? `&search=${encodeURIComponent(search)}` : ""}`;
    const handle = window.setTimeout(() => {
      fetch(url, { credentials: "include" })
        .then((res) => res.json())
        .then((data: SkinRow[] | { skins?: SkinRow[] }) => {
          if (!live) return;
          setRows(Array.isArray(data) ? data : data.skins ?? []);
        })
        .catch(() => { if (live) setRows([]); })
        .finally(() => { if (live) setLoading(false); });
    }, 220);
    return () => { live = false; window.clearTimeout(handle); };
  }, [search]);

  const shown = rows.slice(0, 48);
  useFaceNames(useMemo(() => shown.map((row) => row.name), [shown]));

  return (
    <div className="preview-page">
      <header className="preview-page__head">
        <div>
          <h1>Skins</h1>
          <p>Live listing counts, floors, and observed float ranges from the production data API.</p>
        </div>
        <div className="preview-page__meta">
          <span>{rows.length} loaded</span>
        </div>
      </header>
      <div className="preview-toolbar">
        <input
          className="preview-input"
          value={search}
          placeholder="Search a skin"
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>
      {loading && <p className="preview-note">Loading skins…</p>}
      <div className="preview-grid">
        {shown.map((row) => {
          const { weapon, finish } = splitSkinName(row.name);
          const tint = rarityTint(row.rarity);
          return (
            <Link
              key={row.id}
              className="preview-skin preview-skin--card"
              style={{ "--skin-tint": tint } as React.CSSProperties}
              to={previewSkinHref(row.name)}
            >
              <span className="preview-skin__art">
                <Face name={row.name} size={56} />
              </span>
              {row.min_price !== null && <span className="preview-skin__lead">{formatDollars(row.min_price)}</span>}
              <span className="preview-skin__trail">{row.listing_count.toLocaleString()}</span>
              <span className="preview-skin__label">
                <em>{weapon} · {row.rarity}</em>
                <b>{finish}</b>
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

export function PreviewSkinPage() {
  const { slug = "" } = useParams();
  const [detail, setDetail] = useState<SkinDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setDetail(null);
    setError(null);
    fetch(`/api/skin-by-slug/${encodeURIComponent(slug)}`, { credentials: "include" })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("not found"))))
      .then((data: { name: string }) =>
        fetch(`/api/skin-data/${encodeURIComponent(data.name)}`, { credentials: "include" }))
      .then((res) => res.json())
      .then((data: SkinDetail) => { if (live) setDetail(data); })
      .catch(() => { if (live) setError("That skin is not in the live dataset."); });
    return () => { live = false; };
  }, [slug]);

  useFaceNames(useMemo(() => (detail ? [detail.skin.name] : []), [detail]));

  if (error) {
    return (
      <div className="preview-page">
        <header className="preview-page__head">
          <div>
            <h1>Skin</h1>
            <p>{error}</p>
          </div>
        </header>
        <Link className="preview-btn" to="/preview/skins">Back to skins</Link>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="preview-page">
        <p className="preview-note">Loading skin…</p>
      </div>
    );
  }

  const { skin, listings, stats } = detail;
  const { weapon, finish } = splitSkinName(skin.name);
  const tint = rarityTint(skin.rarity);
  const cheapest = listings.slice(0, 24);
  const byCondition = priceByCondition(detail.priceSources ?? []);

  return (
    <div className="preview-page">
      <header className="preview-page__head">
        <div>
          <h1>{finish}</h1>
          <p>
            {weapon} · {skin.rarity}
            {skin.collection_name && (
              <>
                {" · "}
                <Link className="preview-link" to={previewCollectionHref(skin.collection_name)}>
                  {skin.collection_name}
                </Link>
              </>
            )}
          </p>
        </div>
        <div className="preview-page__meta">
          <span>{stats.totalListings.toLocaleString()} listings</span>
          <i />
          <span>{stats.saleCount.toLocaleString()} sales</span>
        </div>
      </header>

      <div className="preview-split">
        <div className="preview-stack">
          <section
            className="preview-hero-skin"
            style={{ "--skin-tint": tint } as React.CSSProperties}
          >
            <Face name={skin.name} size={150} />
            <dl className="preview-totals">
              <div><dt>Float range</dt><dd>{formatFloat(skin.min_float)} – {formatFloat(skin.max_float)}</dd></div>
              <div><dt>Cheapest</dt><dd>{stats.minPrice === null ? "—" : formatDollars(stats.minPrice)}</dd></div>
              <div><dt>Highest</dt><dd>{stats.maxPrice === null ? "—" : formatDollars(stats.maxPrice)}</dd></div>
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

        <section className="preview-panel">
          <header className="preview-panel__head">
            <p className="o-kicker">Cheapest live listings</p>
            <span className="preview-panel__meta">price · float</span>
          </header>
          <div className="preview-listings">
            {cheapest.map((listing, index) => (
              <a
                key={listing.id}
                className="preview-listing"
                href={listingUrl(
                  listing.id,
                  skin.name,
                  undefined,
                  listing.float_value ?? undefined,
                  listing.price_cents,
                  listing.source,
                )}
                target="_blank"
                rel="noopener noreferrer"
                title={listing.float_value === null ? undefined : `Float ${listing.float_value}`}
              >
                <span className="preview-listing__n">{String(index + 1).padStart(2, "0")}</span>
                <span className="preview-listing__name"><b>{wearBand(listing.float_value)}</b></span>
                <span className="preview-chip">{sourceLabel(listing.source)}</span>
                <span className="preview-listing__float">{formatFloat(listing.float_value) ?? "—"}</span>
                <span className="preview-listing__price">{formatDollars(listing.price_cents)}</span>
                <ExternalLink size={11} aria-hidden />
              </a>
            ))}
            {cheapest.length === 0 && <p className="preview-note">No live listings right now.</p>}
          </div>
        </section>
      </div>
    </div>
  );
}

interface CollectionRow {
  name: string;
  skin_count: number;
  listing_count: number;
  covert_count: number;
  has_knives: boolean;
  has_gloves: boolean;
}

export function PreviewCollectionsPage() {
  const [rows, setRows] = useState<CollectionRow[]>([]);

  useEffect(() => {
    let live = true;
    fetch("/api/collections", { credentials: "include" })
      .then((res) => res.json())
      .then((data: CollectionRow[]) => { if (live) setRows(Array.isArray(data) ? data : []); })
      .catch(() => { if (live) setRows([]); });
    return () => { live = false; };
  }, []);

  return (
    <div className="preview-page">
      <header className="preview-page__head">
        <div>
          <h1>Collections</h1>
          <p>Every collection the discovery loop can build a trade-up from.</p>
        </div>
        <div className="preview-page__meta"><span>{rows.length} collections</span></div>
      </header>
      <div className="preview-rows">
        {rows.map((row) => (
          <Link key={row.name} className="preview-row" to={previewCollectionHref(row.name)}>
            <span className="preview-row__name">{row.name}</span>
            {row.has_knives && <span className="preview-chip">knives</span>}
            {row.has_gloves && <span className="preview-chip">gloves</span>}
            <span className="preview-row__num">{row.skin_count} skins</span>
            <span className="preview-row__num">{row.listing_count.toLocaleString()} listings</span>
          </Link>
        ))}
        {rows.length === 0 && <p className="preview-note">Loading collections…</p>}
      </div>
    </div>
  );
}

export function PreviewCollectionPage() {
  const { name = "" } = useParams();
  const [rows, setRows] = useState<SkinRow[]>([]);
  const [title, setTitle] = useState<string | null>(null);

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
        return fetch(`/api/skin-data?rarity=all&collection=${encodeURIComponent(match.name)}`, { credentials: "include" });
      })
      .then((res) => (res ? res.json() : []))
      .then((data: SkinRow[] | { skins?: SkinRow[] }) => {
        if (!live) return;
        setRows(Array.isArray(data) ? data : data.skins ?? []);
      })
      .catch(() => { if (live) setRows([]); });
    return () => { live = false; };
  }, [name]);

  useFaceNames(useMemo(() => rows.slice(0, 40).map((row) => row.name), [rows]));

  return (
    <div className="preview-page">
      <header className="preview-page__head">
        <div>
          <h1>{title ?? "Collection"}</h1>
          <p>Skins in this collection, with live listing counts and floors.</p>
        </div>
        <div className="preview-page__meta"><span>{rows.length} skins</span></div>
      </header>
      <div className="preview-grid">
        {rows.slice(0, 40).map((row) => {
          const { weapon, finish } = splitSkinName(row.name);
          return (
            <Link
              key={row.id ?? toSlug(row.name)}
              className="preview-skin preview-skin--card"
              style={{ "--skin-tint": rarityTint(row.rarity) } as React.CSSProperties}
              to={previewSkinHref(row.name)}
            >
              <span className="preview-skin__art">
                <Face name={row.name} size={56} />
              </span>
              {row.min_price !== null && <span className="preview-skin__lead">{formatDollars(row.min_price)}</span>}
              <span className="preview-skin__label">
                <em>{weapon} · {row.rarity}</em>
                <b>{finish}</b>
              </span>
            </Link>
          );
        })}
        {rows.length === 0 && <p className="preview-note">Loading skins…</p>}
      </div>
    </div>
  );
}
