import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { PreviewSeo } from "../components/PreviewSeo.js";
import { PreviewTable, type Column } from "../components/PreviewTable.js";
import { condAbbr, formatDollars, listingUrl, sourceLabel } from "../../utils/format.js";

interface SniperListing {
  id: string;
  skin_name: string;
  condition: string;
  float_value: number;
  listed_price_cents: number;
  estimated_price_cents: number;
  diff_cents: number;
  diff_pct: number;
  source: string;
  marketplace_id: string | null;
  stattrak: boolean;
}

interface SniperFilters {
  skins: string[];
  collections: string[];
  markets: string[];
  minDiff: string;
}

const EMPTY_FILTERS: SniperFilters = {
  skins: [],
  collections: [],
  markets: [],
  minDiff: "",
};

const MARKETS = [
  { value: "csfloat", label: "CSFloat" },
  { value: "dmarket", label: "DMarket" },
  { value: "buff", label: "Buff" },
  { value: "skinport", label: "Skinport" },
];

function normalizeSearch(text: string): string {
  return text.replace(/★/g, "").replace(/\|/g, "").replace(/\s+/g, " ").trim().toLowerCase();
}

function AutocompleteInput({
  placeholder,
  items,
  selected,
  onAdd,
}: {
  placeholder: string;
  items: string[];
  selected: string[];
  onAdd: (value: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const filtered = useMemo(() => {
    const available = items.filter((item) => !selected.includes(item));
    if (!query) return available.slice(0, 50);
    const words = normalizeSearch(query).split(" ").filter(Boolean);
    return available
      .filter((item) => {
        const normalized = normalizeSearch(item);
        return words.every((word) => normalized.includes(word));
      })
      .slice(0, 50);
  }, [items, query, selected]);

  return (
    <div className="preview-auto" ref={ref}>
      <input
        className="preview-input"
        type="text"
        placeholder={placeholder}
        value={query}
        onChange={(event) => { setQuery(event.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
      />
      {open && filtered.length > 0 && (
        <div className="preview-menu">
          {filtered.map((item) => (
            <button
              key={item}
              type="button"
              className="preview-menu__item"
              onMouseDown={(event) => { event.preventDefault(); onAdd(item); setQuery(""); setOpen(false); }}
            >
              {item}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function PreviewSniper() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [listings, setListings] = useState<SniperListing[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState(() => searchParams.get("sort") || "diff_pct");
  const [order, setOrder] = useState<"asc" | "desc">(() => (searchParams.get("order") as "asc" | "desc") || "desc");
  const [page, setPage] = useState(() => parseInt(searchParams.get("page") || "1", 10));
  const perPage = 50;
  const [filters, setFilters] = useState<SniperFilters>(() => {
    const next = { ...EMPTY_FILTERS };
    const skin = searchParams.get("skin");
    if (skin) next.skins = skin.split("||");
    const col = searchParams.get("collection");
    if (col) next.collections = col.split("|");
    const markets = searchParams.get("markets");
    if (markets) next.markets = markets.split(",");
    const minDiff = searchParams.get("min_diff");
    if (minDiff) next.minDiff = String(parseInt(minDiff, 10) / 100);
    return next;
  });
  const [skinOptions, setSkinOptions] = useState<string[]>([]);
  const [collectionOptions, setCollectionOptions] = useState<string[]>([]);

  useEffect(() => {
    fetch("/api/listing-sniper/filter-options")
      .then((res) => res.json())
      .then((data: { skins?: string[]; collections?: string[] }) => {
        setSkinOptions(data.skins || []);
        setCollectionOptions(data.collections || []);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const params = new URLSearchParams();
    if (filters.skins.length) params.set("skin", filters.skins.join("||"));
    if (filters.collections.length) params.set("collection", filters.collections.join("|"));
    if (filters.markets.length) params.set("markets", filters.markets.join(","));
    if (filters.minDiff) params.set("min_diff", String(Math.round(parseFloat(filters.minDiff) * 100)));
    if (sort !== "diff_pct") params.set("sort", sort);
    if (order !== "desc") params.set("order", order);
    if (page > 1) params.set("page", String(page));
    setSearchParams(params, { replace: true });
  }, [filters, sort, order, page, setSearchParams]);

  const abortRef = useRef<AbortController | null>(null);

  const fetchListings = useCallback(async () => {
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.skins.length) params.set("skin", filters.skins.join("||"));
      if (filters.collections.length) params.set("collection", filters.collections.join("|"));
      if (filters.markets.length) params.set("markets", filters.markets.join(","));
      if (filters.minDiff) params.set("min_diff", String(Math.round(parseFloat(filters.minDiff) * 100)));
      params.set("sort", sort);
      params.set("order", order);
      params.set("page", String(page));
      params.set("per_page", String(perPage));
      const res = await fetch(`/api/listing-sniper?${params}`, {
        credentials: "include",
        signal: controller.signal,
      });
      const data = await res.json() as { listings?: SniperListing[]; total?: number };
      setListings(data.listings || []);
      setTotal(data.total || 0);
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [filters, sort, order, page]);

  useEffect(() => {
    void fetchListings();
    return () => { abortRef.current?.abort(); };
  }, [fetchListings]);

  const handleFiltersChange = useCallback((next: SniperFilters) => {
    setFilters(next);
    setPage(1);
  }, []);

  const totalPages = Math.ceil(total / perPage);
  const hasActiveFilters = filters.skins.length > 0 || filters.collections.length > 0
    || filters.markets.length > 0 || !!filters.minDiff;

  const columns: Column<SniperListing>[] = [
    { key: "skin", label: "Skin", sortValue: (row) => row.skin_name, render: (row) => (
      <>
        <span>{row.skin_name}{row.stattrak ? " ST" : ""}</span>
        <span className="preview-note">{condAbbr(row.condition)} · {row.float_value.toFixed(4)}</span>
      </>
    ) },
    { key: "listed_price", label: "Listed", align: "end", sortValue: (row) => row.listed_price_cents, render: (row) => (
      <span className="o-mono">{formatDollars(row.listed_price_cents)}</span>
    ) },
    { key: "estimated_price", label: "Est. Value", align: "end", sortValue: (row) => row.estimated_price_cents, render: (row) => (
      <span className="o-mono">{formatDollars(row.estimated_price_cents)}</span>
    ) },
    { key: "diff_cents", label: "Diff $", align: "end", sortValue: (row) => row.diff_cents, render: (row) => (
      <span className="o-mono is-plus">+{formatDollars(row.diff_cents)}</span>
    ) },
    { key: "diff_pct", label: "Diff %", align: "end", sortValue: (row) => row.diff_pct, render: (row) => (
      <span className="o-mono is-plus">+{row.diff_pct.toFixed(1)}%</span>
    ) },
    { key: "source", label: "Source", sortValue: (row) => row.source, render: (row) => (
      <span className="preview-chip">{sourceLabel(row.source)}</span>
    ) },
    { key: "link", label: "", render: (row) => (
      <a
        className="preview-link"
        href={listingUrl(row.id, row.skin_name, row.condition, row.float_value, row.listed_price_cents, row.source, row.marketplace_id ?? undefined, row.stattrak)}
        target="_blank"
        rel="noopener noreferrer"
      >
        View listing
      </a>
    ) },
  ];

  return (
    <div className="preview-page">
      <PreviewSeo
        title="Listing Sniper | TradeUpBot"
        description="Listings priced below estimated market value, sorted by discount percentage."
        canonical="https://tradeupbot.app/listing-sniper"
      />
      <header className="preview-page__head">
        <div>
          <h1>Listing Sniper</h1>
          <p>Listings priced below estimated market value, sorted by discount percentage.</p>
        </div>
        <div className="preview-page__meta">
          {total > 0 && <span>{total.toLocaleString()} underpriced listings found</span>}
        </div>
      </header>

      <div className="preview-toolbar">
        <AutocompleteInput
          placeholder="Filter by skin..."
          items={skinOptions}
          selected={filters.skins}
          onAdd={(skin) => handleFiltersChange({ ...filters, skins: [...filters.skins, skin] })}
        />
        <AutocompleteInput
          placeholder="Filter by collection..."
          items={collectionOptions}
          selected={filters.collections}
          onAdd={(collection) => handleFiltersChange({ ...filters, collections: [...filters.collections, collection] })}
        />
        <div className="preview-pills">
          {MARKETS.map((market) => {
            const on = filters.markets.includes(market.value);
            return (
              <button
                key={market.value}
                type="button"
                className={`preview-chip ${on ? "is-on" : ""}`}
                onClick={() => {
                  const markets = on
                    ? filters.markets.filter((value) => value !== market.value)
                    : [...filters.markets, market.value];
                  handleFiltersChange({ ...filters, markets });
                }}
              >
                {market.label}
              </button>
            );
          })}
        </div>
        <label className="preview-field">
          Min Diff
          <input
            className="preview-field__num"
            type="number"
            min="0"
            step="0.01"
            placeholder="0.00"
            value={filters.minDiff}
            onChange={(event) => handleFiltersChange({ ...filters, minDiff: event.target.value })}
          />
        </label>
      </div>

      {hasActiveFilters && (
        <div className="preview-toolbar">
          {filters.skins.map((skin) => (
            <button key={skin} type="button" className="preview-chip is-on" onClick={() => handleFiltersChange({ ...filters, skins: filters.skins.filter((row) => row !== skin) })}>
              Skin: {skin} ×
            </button>
          ))}
          {filters.collections.map((collection) => (
            <button key={collection} type="button" className="preview-chip is-on" onClick={() => handleFiltersChange({ ...filters, collections: filters.collections.filter((row) => row !== collection) })}>
              Collection: {collection} ×
            </button>
          ))}
          {filters.minDiff && (
            <button type="button" className="preview-chip is-on" onClick={() => handleFiltersChange({ ...filters, minDiff: "" })}>
              Min Diff: ${filters.minDiff} ×
            </button>
          )}
          <button type="button" className="preview-btn preview-btn--quiet" onClick={() => handleFiltersChange({ ...EMPTY_FILTERS })}>
            Clear All
          </button>
        </div>
      )}

      {loading && <p className="preview-note">Loading...</p>}

      {!loading && listings.length === 0 ? (
        <div className="preview-empty">
          <p>No underpriced listings found.</p>
          <p className="preview-note">Widen the filters or lower the min diff. Skins without enough sale data have no price estimate and never appear here.</p>
        </div>
      ) : (
        <PreviewTable
          columns={columns}
          rows={listings}
          rowKey={(row) => row.id}
          initialSort={sort}
          initialDirection={order}
          empty="No underpriced listings found."
        />
      )}

      {totalPages > 1 && (
        <div className="preview-toolbar">
          <button type="button" className="preview-btn" disabled={page <= 1} onClick={() => setPage(page - 1)}>Prev</button>
          <span className="preview-note">Page {page} of {totalPages} ({total.toLocaleString()} results)</span>
          <button type="button" className="preview-btn" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Next</button>
        </div>
      )}
    </div>
  );
}
