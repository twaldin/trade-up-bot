import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { Badge } from "@shared/components/ui/badge.js";
import { Button } from "@shared/components/ui/button.js";
import { Input } from "@shared/components/ui/input.js";
import { condAbbr, listingUrl, sourceLabel, sourceColor } from "../utils/format.js";
import { useCurrency } from "../contexts/CurrencyContext.js";

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

function AutocompleteInput({ placeholder, items, selected, onAdd }: {
  placeholder: string;
  items: string[];
  selected: string[];
  onAdd: (value: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const filtered = useMemo(() => {
    const available = items.filter(i => !selected.includes(i));
    if (!query) return available.slice(0, 50);
    const q = normalizeSearch(query);
    const words = q.split(" ").filter(Boolean);
    return available
      .filter(i => {
        const normalized = normalizeSearch(i);
        return words.every(w => normalized.includes(w));
      })
      .slice(0, 50);
  }, [items, query, selected]);

  return (
    <div className="relative w-[200px]" ref={ref}>
      <Input
        type="text"
        className="h-8 text-sm"
        placeholder={placeholder}
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
      />
      {open && filtered.length > 0 && (
        <div className="absolute top-full left-0 right-0 z-[200] bg-popover border border-border border-t-0 rounded-b-md max-h-60 overflow-y-auto shadow-lg">
          {filtered.map(item => (
            <div
              key={item}
              className="flex justify-between items-center px-2.5 py-1.5 cursor-pointer text-xs text-popover-foreground hover:bg-accent transition-colors"
              onMouseDown={(e) => { e.preventDefault(); onAdd(item); setQuery(""); setOpen(false); }}
            >
              <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{item}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MarketPill({ selected, onChange }: {
  selected: string[];
  onChange: (v: string[]) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const hasValue = selected.length > 0;

  useEffect(() => {
    if (!expanded) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setExpanded(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [expanded]);

  const summary = hasValue
    ? selected.map(m => MARKETS.find(x => x.value === m)?.label || m).join(", ")
    : "any";

  return (
    <div className="relative" ref={ref}>
      <button
        className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-full border whitespace-nowrap transition-colors cursor-pointer ${
          hasValue
            ? "border-blue-500/40 bg-blue-500/10 text-blue-400"
            : "border-border text-muted-foreground hover:border-muted-foreground/50 hover:text-foreground"
        }`}
        onClick={() => setExpanded(e => !e)}
      >
        <span className="font-medium">Market</span>
        <span className={`text-[0.72rem] ${hasValue ? "text-blue-400" : "text-muted-foreground/60"}`}>{summary}</span>
      </button>
      {expanded && (
        <div className="absolute top-[calc(100%+4px)] left-0 z-[200] bg-popover border border-border rounded-md p-3 min-w-[180px] shadow-lg">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-foreground">Market</span>
            <button className="text-muted-foreground hover:text-foreground text-sm cursor-pointer leading-none px-1" onClick={() => setExpanded(false)}>×</button>
          </div>
          <div className="flex flex-col gap-2">
            {MARKETS.map(m => (
              <label key={m.value} className="flex items-center gap-2 text-xs text-popover-foreground cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={selected.includes(m.value)}
                  onChange={(e) => {
                    const next = e.target.checked
                      ? [...selected, m.value]
                      : selected.filter(x => x !== m.value);
                    onChange(next);
                  }}
                  className="rounded border-border"
                />
                {m.label}
              </label>
            ))}
          </div>
          {hasValue && (
            <button className="mt-2 text-[0.68rem] text-muted-foreground hover:text-foreground cursor-pointer" onClick={() => onChange([])}>Clear</button>
          )}
        </div>
      )}
    </div>
  );
}

function MinDiffPill({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const hasValue = !!value;

  useEffect(() => {
    if (!expanded) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setExpanded(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [expanded]);

  return (
    <div className="relative" ref={ref}>
      <button
        className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-full border whitespace-nowrap transition-colors cursor-pointer ${
          hasValue
            ? "border-blue-500/40 bg-blue-500/10 text-blue-400"
            : "border-border text-muted-foreground hover:border-muted-foreground/50 hover:text-foreground"
        }`}
        onClick={() => setExpanded(e => !e)}
      >
        <span className="font-medium">Min Diff</span>
        <span className={`text-[0.72rem] ${hasValue ? "text-blue-400" : "text-muted-foreground/60"}`}>
          {hasValue ? `$${value}` : "any"}
        </span>
      </button>
      {expanded && (
        <div className="absolute top-[calc(100%+4px)] left-0 z-[200] bg-popover border border-border rounded-md p-3 min-w-[180px] shadow-lg">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-foreground">Min Difference ($)</span>
            <button className="text-muted-foreground hover:text-foreground text-sm cursor-pointer leading-none px-1" onClick={() => setExpanded(false)}>×</button>
          </div>
          <Input
            type="number"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="0.00"
            step={0.01}
            min={0}
            className="h-7 text-xs [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none [-moz-appearance:textfield]"
          />
          {hasValue && (
            <button className="mt-2 text-[0.68rem] text-muted-foreground hover:text-foreground cursor-pointer" onClick={() => onChange("")}>Clear</button>
          )}
        </div>
      )}
    </div>
  );
}

function SortIndicator({ column, sort, order }: { column: string; sort: string; order: "asc" | "desc" }) {
  if (sort !== column) return <span className="text-muted-foreground/30 ml-1">↕</span>;
  return <span className="text-foreground ml-1">{order === "asc" ? "↑" : "↓"}</span>;
}

export function ListingSniperPage() {
  const { formatPrice } = useCurrency();
  const [searchParams, setSearchParams] = useSearchParams();

  const [listings, setListings] = useState<SniperListing[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState(() => searchParams.get("sort") || "diff_pct");
  const [order, setOrder] = useState<"asc" | "desc">(() => (searchParams.get("order") as "asc" | "desc") || "desc");
  const [page, setPage] = useState(() => parseInt(searchParams.get("page") || "1"));
  const perPage = 50;

  const [filters, setFilters] = useState<SniperFilters>(() => {
    const f = { ...EMPTY_FILTERS };
    const skin = searchParams.get("skin");
    if (skin) f.skins = skin.split("||");
    const col = searchParams.get("collection");
    if (col) f.collections = col.split("|");
    const markets = searchParams.get("markets");
    if (markets) f.markets = markets.split(",");
    const minDiff = searchParams.get("min_diff");
    if (minDiff) f.minDiff = String(parseInt(minDiff) / 100);
    return f;
  });

  const [skinOptions, setSkinOptions] = useState<string[]>([]);
  const [collectionOptions, setCollectionOptions] = useState<string[]>([]);

  useEffect(() => {
    fetch("/api/listing-sniper/filter-options")
      .then(r => r.json())
      .then(data => {
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
      const data = await res.json();
      setListings(data.listings || []);
      setTotal(data.total || 0);
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      console.error("Failed to fetch sniper listings:", err);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [filters, sort, order, page, perPage]);

  useEffect(() => {
    fetchListings();
    return () => { if (abortRef.current) abortRef.current.abort(); };
  }, [fetchListings]);

  const handleSort = (column: string) => {
    if (sort === column) {
      setOrder(order === "desc" ? "asc" : "desc");
    } else {
      setSort(column);
      setOrder("desc");
    }
    setPage(1);
  };

  const handleFiltersChange = useCallback((f: SniperFilters) => {
    setFilters(f);
    setPage(1);
  }, []);

  const totalPages = Math.ceil(total / perPage);

  const hasActiveFilters = filters.skins.length > 0 || filters.collections.length > 0 ||
    filters.markets.length > 0 || !!filters.minDiff;

  const numericCols = [
    { key: "listed_price", label: "Listed" },
    { key: "estimated_price", label: "Est. Value" },
    { key: "diff_cents", label: "Diff $" },
    { key: "diff_pct", label: "Diff %" },
  ];

  return (
    <>
      <Helmet>
        <title>Listing Sniper | TradeUpBot</title>
      </Helmet>

      <div className="mb-4">
        <h1 className="text-2xl font-bold text-foreground">Listing Sniper</h1>
        <p className="text-sm text-muted-foreground mt-1">Listings priced below estimated market value, sorted by discount percentage.</p>
      </div>

      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="flex gap-2.5 items-center flex-wrap">
            <div className="flex gap-2 shrink-0">
              <AutocompleteInput
                placeholder="Filter by skin..."
                items={skinOptions}
                selected={filters.skins}
                onAdd={(s) => handleFiltersChange({ ...filters, skins: [...filters.skins, s] })}
              />
              <AutocompleteInput
                placeholder="Filter by collection..."
                items={collectionOptions}
                selected={filters.collections}
                onAdd={(s) => handleFiltersChange({ ...filters, collections: [...filters.collections, s] })}
              />
            </div>
            <MarketPill
              selected={filters.markets}
              onChange={(v) => handleFiltersChange({ ...filters, markets: v })}
            />
            <MinDiffPill
              value={filters.minDiff}
              onChange={(v) => handleFiltersChange({ ...filters, minDiff: v })}
            />
          </div>
        </div>
      </div>

      {hasActiveFilters && (
        <div className="flex gap-1.5 flex-wrap mb-2 items-center">
          {filters.skins.map(s => (
            <Badge key={s} variant="secondary" className="gap-1 text-[0.72rem] font-normal">
              Skin: {s}
              <button className="text-muted-foreground hover:text-destructive text-sm leading-none p-0" onClick={() => handleFiltersChange({ ...filters, skins: filters.skins.filter(x => x !== s) })}>×</button>
            </Badge>
          ))}
          {filters.collections.map(c => (
            <Badge key={c} variant="secondary" className="gap-1 text-[0.72rem] font-normal">
              Collection: {c}
              <button className="text-muted-foreground hover:text-destructive text-sm leading-none p-0" onClick={() => handleFiltersChange({ ...filters, collections: filters.collections.filter(x => x !== c) })}>×</button>
            </Badge>
          ))}
          {filters.markets.length > 0 && (
            <Badge variant="secondary" className="gap-1 text-[0.72rem] font-normal">
              Market: {filters.markets.map(m => MARKETS.find(x => x.value === m)?.label || m).join(", ")}
              <button className="text-muted-foreground hover:text-destructive text-sm leading-none p-0" onClick={() => handleFiltersChange({ ...filters, markets: [] })}>×</button>
            </Badge>
          )}
          {filters.minDiff && (
            <Badge variant="secondary" className="gap-1 text-[0.72rem] font-normal">
              Min Diff: ${filters.minDiff}
              <button className="text-muted-foreground hover:text-destructive text-sm leading-none p-0" onClick={() => handleFiltersChange({ ...filters, minDiff: "" })}>×</button>
            </Badge>
          )}
          <Button variant="ghost" size="sm" className="h-5 text-[0.7rem] px-2.5 text-muted-foreground hover:text-destructive" onClick={() => handleFiltersChange({ ...EMPTY_FILTERS })}>
            Clear All
          </Button>
        </div>
      )}

      <div className="flex items-center gap-2 mb-1.5 min-h-[20px]">
        {total > 0 && (
          <span className={`text-xs text-muted-foreground whitespace-nowrap ${loading ? "opacity-50" : ""}`}>
            {total.toLocaleString()} underpriced listings found
          </span>
        )}
        {loading && <span className="text-xs text-muted-foreground animate-pulse">Loading...</span>}
      </div>

      {!loading && listings.length === 0 ? (
        <div className="text-center py-16 px-5 text-muted-foreground">
          <div className="text-4xl mb-3 opacity-50">&#x1F3AF;</div>
          <p className="mb-2">No underpriced listings found.</p>
          <p className="text-sm text-muted-foreground/70">
            Try adjusting filters, or the KNN model may not have sufficient data for the selected skins.
          </p>
        </div>
      ) : (
        <div className={loading ? "opacity-50 pointer-events-none transition-opacity" : "transition-opacity"}>
          {/* Mobile card view */}
          <div className="md:hidden flex flex-col gap-2">
            {listings.map(listing => (
              <div key={listing.id} className="border border-border rounded-md p-3 text-xs">
                <div className="flex items-start justify-between gap-2 mb-1">
                  <div>
                    <span className="font-medium text-foreground">{listing.skin_name}</span>
                    {listing.stattrak && <span className="ml-1 text-orange-400 text-[0.65rem]">ST</span>}
                    <div className="text-muted-foreground mt-0.5">
                      {condAbbr(listing.condition)} · {listing.float_value.toFixed(4)}
                    </div>
                  </div>
                  <span
                    className="px-1.5 py-0.5 rounded text-[0.65rem] font-medium text-white shrink-0"
                    style={{ backgroundColor: sourceColor(listing.source) }}
                  >
                    {sourceLabel(listing.source)}
                  </span>
                </div>
                <div className="flex gap-4 mt-1.5 flex-wrap">
                  <div>
                    <div className="text-muted-foreground/70 mb-0.5">Listed</div>
                    <div className="font-mono text-foreground">{formatPrice(listing.listed_price_cents)}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground/70 mb-0.5">Est. Value</div>
                    <div className="font-mono text-muted-foreground">{formatPrice(listing.estimated_price_cents)}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground/70 mb-0.5">Diff</div>
                    <div className="font-mono text-green-400 font-semibold">
                      +{formatPrice(listing.diff_cents)} (+{listing.diff_pct.toFixed(1)}%)
                    </div>
                  </div>
                </div>
                <div className="mt-2">
                  <a
                    href={listingUrl(listing.id, listing.skin_name, listing.condition, listing.float_value, listing.listed_price_cents, listing.source, listing.marketplace_id ?? undefined, listing.stattrak)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-400 hover:text-blue-300 text-[0.7rem]"
                  >
                    View listing →
                  </a>
                </div>
              </div>
            ))}
          </div>

          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="text-left pb-2 pr-4 font-medium">Skin</th>
                  {numericCols.map(col => (
                    <th
                      key={col.key}
                      className="text-right pb-2 pr-4 font-medium cursor-pointer hover:text-foreground select-none whitespace-nowrap"
                      onClick={() => handleSort(col.key)}
                    >
                      {col.label}
                      <SortIndicator column={col.key} sort={sort} order={order} />
                    </th>
                  ))}
                  <th className="text-left pb-2 pr-4 font-medium">Source</th>
                  <th className="pb-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {listings.map(listing => (
                  <tr key={listing.id} className="border-b border-border/30 hover:bg-muted/30 transition-colors">
                    <td className="py-2.5 pr-4">
                      <div className="flex flex-col">
                        <span className="font-medium text-foreground">
                          {listing.skin_name}
                          {listing.stattrak && <span className="ml-1 text-orange-400 text-[0.65rem]">ST</span>}
                        </span>
                        <span className="text-muted-foreground text-[0.7rem]">
                          {condAbbr(listing.condition)} · {listing.float_value.toFixed(4)}
                        </span>
                      </div>
                    </td>
                    <td className="py-2.5 pr-4 text-right font-mono text-foreground">
                      {formatPrice(listing.listed_price_cents)}
                    </td>
                    <td className="py-2.5 pr-4 text-right font-mono text-muted-foreground">
                      {formatPrice(listing.estimated_price_cents)}
                    </td>
                    <td className="py-2.5 pr-4 text-right font-mono text-green-400">
                      +{formatPrice(listing.diff_cents)}
                    </td>
                    <td className="py-2.5 pr-4 text-right font-mono font-semibold text-green-400">
                      +{listing.diff_pct.toFixed(1)}%
                    </td>
                    <td className="py-2.5 pr-4">
                      <span
                        className="px-1.5 py-0.5 rounded text-[0.65rem] font-medium text-white"
                        style={{ backgroundColor: sourceColor(listing.source) }}
                      >
                        {sourceLabel(listing.source)}
                      </span>
                    </td>
                    <td className="py-2.5 text-right">
                      <a
                        href={listingUrl(listing.id, listing.skin_name, listing.condition, listing.float_value, listing.listed_price_cents, listing.source, listing.marketplace_id ?? undefined, listing.stattrak)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-400 hover:text-blue-300 text-[0.7rem] whitespace-nowrap"
                      >
                        →
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex gap-2 justify-center items-center mt-4 text-sm text-muted-foreground">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                Prev
              </Button>
              <span>
                Page {page} of {totalPages} ({total.toLocaleString()} results)
              </span>
              <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
                Next
              </Button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
