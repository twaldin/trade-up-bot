import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { formatDollars, conditionColor, conditionLabel } from "../utils/format.js";

interface SkinSummary {
  id: string;
  name: string;
  rarity: string;
  weapon: string;
  min_float: number;
  max_float: number;
  collection_name: string | null;
  listing_count: number;
  sale_count: number;
  new_listings: number;
  new_sales: number;
  min_price: number | null;
  avg_price: number | null;
  max_price: number | null;
  min_float_seen: number | null;
  max_float_seen: number | null;
  prices: Record<string, Record<string, number>>;
}

interface SkinDetail {
  skin: { id: string; name: string; rarity: string; weapon: string; min_float: number; max_float: number; collection_name: string | null };
  listings: { id: string; price_cents: number; float_value: number; created_at: string; staleness_checked_at: string | null; phase: string | null; source: string }[];
  floatBuckets: { float_min: number; float_max: number; avg_price_cents: number; listing_count: number }[];
  priceSources: { source: string; condition: string; avg_price_cents: number; volume: number }[];
  saleHistory: { price_cents: number; float_value: number; sold_at: string }[];
  stats: { totalListings: number; checkedListings: number; minPrice: number | null; maxPrice: number | null; saleCount: number };
}

type SortDir = "asc" | "desc";

function CollectionLinks({ collectionName, onNavigate, compact }: {
  collectionName: string | null;
  onNavigate?: (name: string) => void;
  compact?: boolean; // true = sidebar (show dropdown for 3+), false = full list
}) {
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  if (!collectionName) return <span className="dv-collection">—</span>;

  const cols = collectionName.split(",").map(c => c.trim()).filter(Boolean);

  const renderLink = (name: string, key: number) => (
    <span key={key}>
      {key > 0 && ", "}
      <span
        className={`dv-collection ${onNavigate ? "dv-collection-link" : ""}`}
        onClick={onNavigate ? (e) => { e.stopPropagation(); onNavigate(name); } : undefined}
      >{name}</span>
    </span>
  );

  // Full mode: always show all links
  if (!compact) return <>{cols.map((c, i) => renderLink(c, i))}</>;

  // Compact mode: single collection, show inline
  if (cols.length <= 1) return <>{cols.map((c, i) => renderLink(c, i))}</>;

  // Compact mode: 2+ collections → show "(N collections)" with dropdown
  return (
    <div className="collection-dropdown-wrap" ref={dropdownRef}>
      <span
        className="dv-collection dv-collection-link collection-dropdown-trigger"
        onClick={(e) => { e.stopPropagation(); setOpen(o => !o); }}
      >({cols.length} collections)</span>
      {open && (
        <div className="collection-dropdown-menu">
          {cols.map((c, i) => (
            <div
              key={i}
              className="collection-dropdown-item"
              onClick={(e) => { e.stopPropagation(); if (onNavigate) onNavigate(c); setOpen(false); }}
            >{c}</div>
          ))}
        </div>
      )}
    </div>
  );
}

const SOURCE_LABELS: Record<string, string> = {
  csfloat_sales: "CSFloat Sales",
  csfloat_ref: "CSFloat Ref",
  listing: "Listing Floor",
  skinport: "Skinport",
};

const CONDITION_ORDER = ["Factory New", "Minimal Wear", "Field-Tested", "Well-Worn", "Battle-Scarred"];

type SeriesKey = "csfloat" | "dmarket" | "skinport" | "sales" | "buckets";

function ScatterChart({ listings, saleHistory, floatBuckets, minFloat, maxFloat, fullscreen, visible }: {
  listings: SkinDetail["listings"];
  saleHistory: SkinDetail["saleHistory"];
  floatBuckets: SkinDetail["floatBuckets"];
  minFloat: number;
  maxFloat: number;
  fullscreen?: boolean;
  visible: Record<SeriesKey, boolean>;
}) {
  const W = fullscreen ? 1200 : 700;
  const H = fullscreen ? 600 : 300;
  const PAD = { top: 25, right: 25, bottom: 40, left: 70 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const dotR = fullscreen ? 4.5 : 3.5;

  const allPrices = useMemo(() => {
    const p: number[] = [];
    const visibleListings = listings.filter(l => {
      const src = l.source || 'csfloat';
      if (src === 'csfloat' && visible.csfloat) return true;
      if (src === 'dmarket' && visible.dmarket) return true;
      if (src === 'skinport' && visible.skinport) return true;
      return false;
    });
    p.push(...visibleListings.map(l => l.price_cents));
    if (visible.sales) p.push(...(saleHistory || []).map(s => s.price_cents));
    if (visible.buckets) p.push(...floatBuckets.map(b => b.avg_price_cents));
    return p.filter(v => v > 0).sort((a, b) => a - b);
  }, [listings, saleHistory, floatBuckets, visible]);

  if (allPrices.length === 0) return <div className="chart-empty">No pricing data (enable series in legend)</div>;

  const p95 = allPrices[Math.floor(allPrices.length * 0.95)];
  const maxPrice = Math.min(p95 * 1.2, allPrices[allPrices.length - 1]);
  const minPrice = 0;

  const floatMin = Math.max(0, minFloat - 0.01);
  const floatMax = Math.min(1, maxFloat + 0.01);

  const x = (f: number) => PAD.left + ((f - floatMin) / (floatMax - floatMin)) * plotW;
  const y = (p: number) => PAD.top + plotH - ((Math.min(p, maxPrice) - minPrice) / (maxPrice - minPrice)) * plotH;

  const boundaries = [0.07, 0.15, 0.38, 0.45].filter(b => b > floatMin && b < floatMax);

  const yTicks = fullscreen ? 8 : 5;
  const yTickStep = maxPrice / yTicks;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="scatter-chart" style={fullscreen ? { width: "100%", maxWidth: "none" } : undefined}>
      {/* Grid */}
      {Array.from({ length: yTicks + 1 }, (_, i) => {
        const price = i * yTickStep;
        return (
          <g key={`ytick-${i}`}>
            <line x1={PAD.left} y1={y(price)} x2={W - PAD.right} y2={y(price)} stroke="#1e1e30" strokeWidth={1} />
            <text x={PAD.left - 5} y={y(price) + 4} textAnchor="end" fill="#888" fontSize={fullscreen ? 12 : 10}>
              {formatDollars(price)}
            </text>
          </g>
        );
      })}

      {/* Condition boundaries */}
      {boundaries.map(b => (
        <g key={`boundary-${b}`}>
          <line x1={x(b)} y1={PAD.top} x2={x(b)} y2={PAD.top + plotH} stroke="#444" strokeWidth={1} strokeDasharray="3,3" />
          <text x={x(b)} y={PAD.top + plotH + 15} textAnchor="middle" fill="#888" fontSize={fullscreen ? 12 : 10}>{b.toFixed(2)}</text>
        </g>
      ))}

      {/* X axis labels */}
      <text x={PAD.left} y={PAD.top + plotH + 30} fill="#888" fontSize={10}>{floatMin.toFixed(2)}</text>
      <text x={W - PAD.right} y={PAD.top + plotH + 30} textAnchor="end" fill="#888" fontSize={10}>{floatMax.toFixed(2)}</text>
      <text x={PAD.left + plotW / 2} y={PAD.top + plotH + 30} textAnchor="middle" fill="#666" fontSize={10}>Float Value</text>

      {/* Float bucket avg price bars (rendered first = background) */}
      {visible.buckets && floatBuckets.filter(b => b.avg_price_cents > 0).map((b, i) => {
        const x1 = x(Math.max(b.float_min, floatMin));
        const x2 = x(Math.min(b.float_max, floatMax));
        const yTop = y(b.avg_price_cents);
        return (
          <g key={`bucket-${i}`}>
            <rect x={x1} y={yTop} width={x2 - x1} height={PAD.top + plotH - yTop} fill="#60a5fa" opacity={0.08} />
            <line x1={x1} y1={yTop} x2={x2} y2={yTop} stroke="#60a5fa" strokeWidth={2} opacity={0.4} strokeDasharray="4,3" />
          </g>
        );
      })}

      {/* Data points */}
      {visible.sales && (saleHistory || []).map((s, i) => (
        <g key={`sale-${i}`} transform={`translate(${x(s.float_value)},${y(s.price_cents)})`}>
          <rect x={-3} y={-3} width={6} height={6} transform="rotate(45)" fill="#e879f9" opacity={0.35} />
          <title>{`Sale: ${formatDollars(s.price_cents)} @ ${s.float_value.toFixed(6)} (${s.sold_at})`}</title>
        </g>
      ))}

      {/* CSFloat listings (green dots) */}
      {visible.csfloat && listings.filter(l => !l.source || l.source === 'csfloat').map((l, i) => (
        <circle key={`csfloat-${i}`} cx={x(l.float_value)} cy={y(l.price_cents)}
          r={dotR} fill="#22c55e"
          stroke={l.staleness_checked_at ? "#fff" : "none"} strokeWidth={0.5}
          opacity={0.8}>
          <title>{`CSFloat: ${formatDollars(l.price_cents)} @ ${l.float_value.toFixed(6)} (${conditionLabel(l.float_value)})${l.staleness_checked_at ? " ✓" : ""}`}</title>
        </circle>
      ))}

      {/* DMarket listings (blue dots) */}
      {visible.dmarket && listings.filter(l => l.source === 'dmarket').map((l, i) => (
        <circle key={`dmarket-${i}`} cx={x(l.float_value)} cy={y(l.price_cents)}
          r={dotR} fill="#60a5fa"
          opacity={0.7}>
          <title>{`DMarket: ${formatDollars(l.price_cents)} @ ${l.float_value.toFixed(6)} (${conditionLabel(l.float_value)})`}</title>
        </circle>
      ))}

      {/* Skinport listings (orange dots) */}
      {visible.skinport && listings.filter(l => l.source === 'skinport').map((l, i) => (
        <circle key={`skinport-${i}`} cx={x(l.float_value)} cy={y(l.price_cents)}
          r={dotR} fill="#f59e0b"
          opacity={0.7}>
          <title>{`Skinport: ${formatDollars(l.price_cents)} @ ${l.float_value.toFixed(6)} (${conditionLabel(l.float_value)})`}</title>
        </circle>
      ))}

      {/* Bucket labels — LAST so they render on top of data points */}
      {visible.buckets && floatBuckets.filter(b => b.avg_price_cents > 0).map((b, i) => {
        const cx = (x(Math.max(b.float_min, floatMin)) + x(Math.min(b.float_max, floatMax))) / 2;
        const cy = y(b.avg_price_cents) - 5;
        const label = formatDollars(b.avg_price_cents);
        const tw = label.length * 5.5 + 6;
        return (
          <g key={`blabel-${i}`}>
            <rect x={cx - tw / 2} y={cy - 8} width={tw} height={13} rx={2} fill="#0e0e18" opacity={0.85} />
            <text x={cx} y={cy} textAnchor="middle" fill="#60a5fa" fontSize={9} fontWeight={600}>{label}</text>
          </g>
        );
      })}

      {/* Axes */}
      <line x1={PAD.left} y1={PAD.top} x2={PAD.left} y2={PAD.top + plotH} stroke="#333" strokeWidth={1} />
      <line x1={PAD.left} y1={PAD.top + plotH} x2={W - PAD.right} y2={PAD.top + plotH} stroke="#333" strokeWidth={1} />
    </svg>
  );
}

function SortableTable<T>({ columns, data, defaultSort, defaultLimit = 20, id }: {
  columns: { key: string; label: string; render: (row: T) => React.ReactNode; sortValue?: (row: T) => number | string; align?: "right" }[];
  data: T[];
  defaultSort?: { key: string; dir: SortDir };
  defaultLimit?: number;
  id: string;
}) {
  const [sortKey, setSortKey] = useState(defaultSort?.key ?? columns[0].key);
  const [sortDir, setSortDir] = useState<SortDir>(defaultSort?.dir ?? "asc");
  const [expanded, setExpanded] = useState(false);

  const sorted = useMemo(() => {
    const col = columns.find(c => c.key === sortKey);
    if (!col?.sortValue) return data;
    return [...data].sort((a, b) => {
      const va = col.sortValue!(a);
      const vb = col.sortValue!(b);
      const cmp = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb));
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [data, sortKey, sortDir, columns]);

  const displayed = expanded ? sorted : sorted.slice(0, defaultLimit);

  const toggleSort = (key: string) => {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
  };

  return (
    <div>
      <div className="listings-scroll">
        <table className="price-source-table sortable-table">
          <thead>
            <tr>
              {columns.map(col => (
                <th key={col.key} onClick={() => col.sortValue && toggleSort(col.key)}
                  className={col.sortValue ? "sortable-th" : ""} style={col.align ? { textAlign: col.align } : undefined}>
                  {col.label}
                  {col.sortValue && sortKey === col.key && <span className="sort-arrow">{sortDir === "asc" ? " ▲" : " ▼"}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {displayed.map((row, i) => (
              <tr key={`${id}-${i}`}>
                {columns.map(col => (
                  <td key={col.key} style={col.align ? { textAlign: col.align } : undefined}>{col.render(row)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data.length > defaultLimit && (
        <button className="expand-btn" onClick={() => setExpanded(e => !e)}>
          {expanded ? `Show less (${defaultLimit})` : `Show all ${data.length} rows`}
        </button>
      )}
    </div>
  );
}

function PriceSourceTable({ priceSources }: { priceSources: SkinDetail["priceSources"] }) {
  const byCondition = new Map<string, Map<string, { price: number; volume: number }>>();
  for (const p of priceSources) {
    if (!byCondition.has(p.condition)) byCondition.set(p.condition, new Map());
    byCondition.get(p.condition)!.set(p.source, { price: p.avg_price_cents, volume: p.volume });
  }

  const sources = [...new Set(priceSources.map(p => p.source))];
  const conditions = CONDITION_ORDER.filter(c => byCondition.has(c));

  if (conditions.length === 0) return <div className="chart-empty">No price data</div>;

  return (
    <table className="price-source-table">
      <thead>
        <tr>
          <th>Condition</th>
          {sources.map(s => <th key={s}>{SOURCE_LABELS[s] || s}</th>)}
        </tr>
      </thead>
      <tbody>
        {conditions.map(cond => (
          <tr key={cond}>
            <td className="cond-label">{cond}</td>
            {sources.map(src => {
              const data = byCondition.get(cond)?.get(src);
              if (!data || data.price === 0) return <td key={src} className="no-data">—</td>;
              return (
                <td key={src}>
                  <span className="price-val">{formatDollars(data.price)}</span>
                  <span className="volume-badge">({data.volume})</span>
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SkinDetailPanel({ skinName, stattrak, onClose, onNavigateCollection }: { skinName: string; stattrak?: boolean; onClose: () => void; onNavigateCollection?: (name: string) => void }) {
  const [detail, setDetail] = useState<SkinDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [chartFullscreen, setChartFullscreen] = useState(false);
  const [visible, setVisible] = useState<Record<SeriesKey, boolean>>({
    csfloat: true, dmarket: true, skinport: true, sales: true, buckets: true,
  });

  useEffect(() => {
    setLoading(true);
    const stParam = stattrak ? "&stattrak=1" : "";
    fetch(`/api/skin-data/${encodeURIComponent(skinName)}?_=${Date.now()}${stParam}`)
      .then(r => r.json())
      .then(setDetail)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [skinName, stattrak]);

  const toggleSeries = (key: SeriesKey) => {
    setVisible(v => ({ ...v, [key]: !v[key] }));
  };

  // Compute listing floor per bucket from actual data (must be before early returns for hooks rule)
  const bucketFloors = useMemo(() => {
    if (!detail) return [];
    const { listings: ls, floatBuckets: fb, saleHistory: sh } = detail;
    if (fb.length === 0 || ls.length === 0) return fb;
    return fb.map(b => {
      const inBucket = ls.filter(l => l.float_value >= b.float_min && l.float_value < b.float_max);
      const sales = (sh || []).filter(s => s.float_value >= b.float_min && s.float_value < b.float_max);
      const listingFloor = inBucket.length > 0 ? Math.min(...inBucket.map(l => l.price_cents)) : 0;
      const saleMedian = sales.length >= 2 ? [...sales].sort((a, b) => a.price_cents - b.price_cents)[Math.floor(sales.length / 2)].price_cents : 0;
      const bestPrice = listingFloor > 0 && saleMedian > 0 ? Math.min(listingFloor, saleMedian) : (listingFloor || saleMedian || b.avg_price_cents);
      return { ...b, avg_price_cents: bestPrice, listing_count: inBucket.length + sales.length };
    });
  }, [detail]);

  if (loading) return <div className="detail-panel"><div className="loading-text">Loading...</div></div>;
  if (!detail) return <div className="detail-panel"><div className="loading-text">Failed to load</div></div>;

  const { skin, listings, floatBuckets, priceSources, saleHistory, stats } = detail;

  const condDist: Record<string, number> = {};
  for (const l of listings) {
    const c = conditionLabel(l.float_value);
    condDist[c] = (condDist[c] || 0) + 1;
  }

  type ListingRow = SkinDetail["listings"][0];
  type SaleRow = SkinDetail["saleHistory"][0];

  const csfloatCount = listings.filter(l => !l.source || l.source === 'csfloat').length;
  const dmarketCount = listings.filter(l => l.source === 'dmarket').length;
  const skinportCount = listings.filter(l => l.source === 'skinport').length;

  const legendItems: { key: SeriesKey; label: string; color: string; shape: "dot" | "diamond" | "line"; count: number }[] = [
    { key: "csfloat", label: "CSFloat", color: "#22c55e", shape: "dot", count: csfloatCount },
    ...(dmarketCount > 0 ? [{ key: "dmarket" as SeriesKey, label: "DMarket", color: "#60a5fa", shape: "dot" as const, count: dmarketCount }] : []),
    ...(skinportCount > 0 ? [{ key: "skinport" as SeriesKey, label: "Skinport", color: "#f59e0b", shape: "dot" as const, count: skinportCount }] : []),
    { key: "sales", label: "Sales", color: "#e879f9", shape: "diamond", count: stats.saleCount || (saleHistory || []).length },
    { key: "buckets", label: "Bucket Floor", color: "#60a5fa", shape: "line", count: bucketFloors.filter(b => b.avg_price_cents > 0).length },
  ];

  const chartContent = (fs: boolean) => (
    <>
      <div className="chart-legend">
        {legendItems.map(item => (
          <span key={item.key}
            className={`legend-item ${visible[item.key] ? "" : "legend-disabled"}`}
            onClick={() => toggleSeries(item.key)}>
            <span className={`legend-${item.shape}`} style={item.shape === "dot" ? { background: item.color } : undefined} />
            {item.label} ({item.count})
          </span>
        ))}
        {!fs && (
          <span className="legend-item legend-fullscreen" onClick={() => setChartFullscreen(true)}>
            ⛶ Fullscreen
          </span>
        )}
      </div>
      <ScatterChart
        listings={listings} saleHistory={saleHistory || []}
        floatBuckets={bucketFloors} minFloat={skin.min_float} maxFloat={skin.max_float}
        fullscreen={fs} visible={visible}
      />
    </>
  );

  return (
    <div className="detail-panel">
      {/* Fullscreen overlay */}
      {chartFullscreen && (
        <div className="chart-fullscreen-overlay" onClick={() => setChartFullscreen(false)}>
          <div className="chart-fullscreen-inner" onClick={e => e.stopPropagation()}>
            <div className="detail-header">
              <h2>{skin.name} — Float vs Price</h2>
              <button className="close-btn" onClick={() => setChartFullscreen(false)}>×</button>
            </div>
            {chartContent(true)}
          </div>
        </div>
      )}

      <div className="detail-header">
        <div>
          <h2>{skin.name}</h2>
          <span className="detail-meta">
            <CollectionLinks collectionName={skin.collection_name} onNavigate={onNavigateCollection} /> · Float {skin.min_float.toFixed(2)}–{skin.max_float.toFixed(2)} · {skin.rarity}
          </span>
        </div>
        <button className="close-btn" onClick={onClose}>×</button>
      </div>

      {/* Stats row */}
      <div className="stat-cards">
        {[
          { value: stats.totalListings, label: "Listings" },
          { value: stats.saleCount || 0, label: "Sales" },
          { value: stats.minPrice ? formatDollars(stats.minPrice) : "—", label: "Floor" },
          { value: stats.maxPrice ? formatDollars(stats.maxPrice) : "—", label: "Ceiling" },
        ].map((s, i) => (
          <div key={i} className="stat-card">
            <div className="stat-value">{s.value}</div>
            <div className="stat-label">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Condition distribution */}
      <div className="cond-dist">
        {["FN", "MW", "FT", "WW", "BS"].map(c => (
          <span key={c} className="cond-chip" style={{ opacity: condDist[c] ? 1 : 0.3 }}>
            {c}: {condDist[c] || 0}
          </span>
        ))}
      </div>

      {/* Scatter chart */}
      <div className="chart-section">
        <h3>Float vs Price</h3>
        {chartContent(false)}
      </div>

      {/* Price source comparison */}
      <div className="chart-section">
        <h3>Price Sources</h3>
        <PriceSourceTable priceSources={priceSources} />
      </div>

      {/* Recent Sales */}
      {saleHistory && saleHistory.length > 0 && (
        <div className="chart-section">
          <h3>Sale History ({stats.saleCount || saleHistory.length})</h3>
          <SortableTable<SaleRow>
            id="sales"
            data={saleHistory}
            defaultSort={{ key: "sold_at", dir: "desc" }}
            defaultLimit={25}
            columns={[
              { key: "price", label: "Price", render: r => formatDollars(r.price_cents), sortValue: r => r.price_cents },
              { key: "float", label: "Float", render: r => <span style={{ color: conditionColor(r.float_value) }}>{r.float_value.toFixed(6)}</span>, sortValue: r => r.float_value },
              { key: "cond", label: "Cond", render: r => conditionLabel(r.float_value), sortValue: r => r.float_value },
              { key: "sold_at", label: "Sold", render: r => <span className="sale-date">{new Date(r.sold_at).toLocaleDateString()}</span>, sortValue: r => new Date(r.sold_at).getTime() },
            ]}
          />
        </div>
      )}

      {/* Float bucket detail */}
      {bucketFloors.length > 0 && (
        <div className="chart-section">
          <h3>Float Buckets (Floor Pricing)</h3>
          <SortableTable
            id="buckets"
            data={bucketFloors}
            defaultLimit={10}
            columns={[
              { key: "range", label: "Range", render: (b: typeof floatBuckets[0]) => `${b.float_min.toFixed(2)} – ${b.float_max.toFixed(2)}`, sortValue: (b: typeof floatBuckets[0]) => b.float_min },
              { key: "price", label: "Floor Price", render: (b: typeof floatBuckets[0]) => b.avg_price_cents > 0 ? formatDollars(b.avg_price_cents) : "—", sortValue: (b: typeof floatBuckets[0]) => b.avg_price_cents },
              { key: "count", label: "Data Points", render: (b: typeof floatBuckets[0]) => b.listing_count, sortValue: (b: typeof floatBuckets[0]) => b.listing_count },
            ]}
          />
        </div>
      )}

      {/* Listings */}
      <div className="chart-section">
        <h3>Listings ({listings.length})</h3>
        <SortableTable<ListingRow>
          id="listings"
          data={listings}
          defaultSort={{ key: "price", dir: "asc" }}
          defaultLimit={25}
          columns={[
            { key: "price", label: "Price", render: r => formatDollars(r.price_cents), sortValue: r => r.price_cents },
            { key: "float", label: "Float", render: r => <span style={{ color: conditionColor(r.float_value) }}>{r.float_value.toFixed(6)}</span>, sortValue: r => r.float_value },
            { key: "cond", label: "Cond", render: r => conditionLabel(r.float_value), sortValue: r => r.float_value },
            { key: "source", label: "Source", render: r => <span className={`source-badge source-${r.source || 'csfloat'}`}>{(r.source || 'csfloat').toUpperCase()}</span>, sortValue: r => r.source || 'csfloat' },
            { key: "verified", label: "Verified", render: r => r.staleness_checked_at ? "✓" : "—" },
            { key: "created", label: "Listed", render: r => <span className="sale-date">{new Date(r.created_at).toLocaleDateString()}</span>, sortValue: r => new Date(r.created_at).getTime() },
          ]}
        />
      </div>
    </div>
  );
}

interface DaemonEvent {
  id: number;
  event_type: string;
  summary: string;
  detail: string | null;
  created_at: string;
}

const EVENT_COLORS: Record<string, string> = {
  listing_sold: "#22c55e",
  listings_fetched: "#60a5fa",
  sale_history: "#e879f9",
  calc_complete: "#f59e0b",
  staleness_check: "#888",
  stale_purged: "#ef4444",
  phase: "#555",
};

function LiveFeed() {
  const [events, setEvents] = useState<DaemonEvent[]>([]);
  const [expanded, setExpanded] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const lastCreatedRef = useRef<string>("");

  useEffect(() => {
    let mounted = true;
    const poll = async () => {
      try {
        const params = new URLSearchParams({ limit: "150" });
        if (lastCreatedRef.current) {
          params.set("since", lastCreatedRef.current);
        }
        const res = await fetch(`/api/daemon-events?${params}`);
        const data = await res.json();
        if (!mounted) return;
        if (data.events?.length > 0) {
          setEvents(prev => {
            const merged = [...prev, ...data.events];
            const seen = new Set<number>();
            const deduped = merged.filter((e: DaemonEvent) => {
              if (seen.has(e.id)) return false;
              seen.add(e.id);
              return true;
            });
            return deduped.slice(-200);
          });
          lastCreatedRef.current = data.events[data.events.length - 1].created_at;
        }
      } catch {}
    };
    poll();
    const iv = setInterval(poll, 3000);
    return () => { mounted = false; clearInterval(iv); };
  }, []);

  // Auto-scroll the feed panel (not the page) when new events arrive
  useEffect(() => {
    if (expanded && panelRef.current) {
      const el = panelRef.current;
      el.scrollTop = el.scrollHeight;
    }
  }, [events, expanded]);

  const latest = events[events.length - 1];

  return (
    <div className="live-feed">
      <div className="live-feed-bar" onClick={() => setExpanded(e => !e)}>
        <span className="live-feed-dot" />
        <span className="live-feed-label">LIVE</span>
        {latest && (
          <span className="live-feed-latest" style={{ color: EVENT_COLORS[latest.event_type] || "#666" }}>
            {latest.summary}
          </span>
        )}
        <span className="live-feed-toggle">{expanded ? "▼" : "▶"} {events.length}</span>
      </div>
      {expanded && (
        <div className="live-feed-panel" ref={panelRef}>
          {events.map(e => (
            <div key={e.id} className="live-feed-line">
              <span className="live-feed-time">
                {new Date(e.created_at + "Z").toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </span>
              <span style={{ color: EVENT_COLORS[e.event_type] || "#666", minWidth: 110, flexShrink: 0 }}>
                [{e.event_type.replace(/_/g, " ")}]
              </span>
              <span className="live-feed-summary">{e.summary}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function DataViewer({ onNavigateCollection, collectionFilter, initialSearch, outputCollection }: { onNavigateCollection?: (name: string) => void; collectionFilter?: string; initialSearch?: string; outputCollection?: string } = {}) {
  const [skins, setSkins] = useState<SkinSummary[]>([]);
  const [search, setSearch] = useState(initialSearch || "");
  const [appliedSearch, setAppliedSearch] = useState(initialSearch || "");
  const [selectedSkin, setSelectedSkin] = useState<string | null>(initialSearch || null);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<"listing_count" | "sale_count" | "min_price" | "name">("listing_count");
  const [rarity, setRarity] = useState<"Covert" | "Classified" | "knife_glove" | "">(collectionFilter ? "" : "");
  const [stattrak, setStattrak] = useState(false);
  const isEmbedded = !!(collectionFilter || outputCollection);
  const [lastViewedAt] = useState<string>(() => localStorage.getItem("dv_lastViewedAt") || new Date().toISOString());
  const [newListings, setNewListings] = useState(0);
  const [newSales, setNewSales] = useState(0);

  // Cache fetched data per tab so switching is instant
  const cacheRef = useRef<Map<string, { skins: SkinSummary[]; newListings: number; newSales: number }>>(new Map());

  const fetchSkins = useCallback(async () => {
    const cacheKey = `${rarity}|${appliedSearch}|${collectionFilter || ""}|${outputCollection || ""}|${stattrak}`;
    const cached = cacheRef.current.get(cacheKey);
    if (cached) {
      // Show cached data immediately — no loading spinner
      setSkins(cached.skins);
      setNewListings(cached.newListings);
      setNewSales(cached.newSales);
      setLoading(false);
    } else {
      setLoading(true);
    }
    try {
      const params = new URLSearchParams();
      if (appliedSearch) params.set("search", appliedSearch);
      if (rarity && !outputCollection) params.set("rarity", rarity);
      if (collectionFilter) params.set("collection", collectionFilter);
      if (outputCollection) params.set("outputCollection", outputCollection);
      if (stattrak) params.set("stattrak", "1");
      const res = await fetch(`/api/skin-data?${params}`);
      const data = await res.json();
      // Fetch freshness counts
      const fp = new URLSearchParams({ since: lastViewedAt });
      if (rarity) fp.set("tab", rarity);
      const fr = await fetch(`/api/data-freshness?${fp}`);
      const fd = await fr.json();
      const nl = fd.newListings || 0;
      const ns = fd.newSales || 0;
      // Update cache and state
      cacheRef.current.set(cacheKey, { skins: data, newListings: nl, newSales: ns });
      setSkins(data);
      setNewListings(nl);
      setNewSales(ns);
    } catch {}
    setLoading(false);
  }, [appliedSearch, rarity, lastViewedAt, collectionFilter, outputCollection, stattrak]);

  useEffect(() => { fetchSkins(); }, [fetchSkins]);

  const applySearch = () => {
    setAppliedSearch(search);
    setSelectedSkin(null);
  };

  const sorted = useMemo(() => {
    const filtered = skins;
    return [...filtered].sort((a, b) => {
      if (sortBy === "listing_count") return (b.listing_count || 0) - (a.listing_count || 0);
      if (sortBy === "sale_count") return (b.sale_count || 0) - (a.sale_count || 0);
      if (sortBy === "min_price") return (a.min_price || 999999) - (b.min_price || 999999);
      return a.name.localeCompare(b.name);
    });
  }, [skins, sortBy]);

  const totalListings = skins.reduce((s, sk) => s + (sk.listing_count || 0), 0);
  const totalSales = skins.reduce((s, sk) => s + (sk.sale_count || 0), 0);
  const skinsWithListings = skins.filter(s => s.listing_count > 0).length;

  const markSeen = () => {
    const now = new Date().toISOString();
    localStorage.setItem("dv_lastViewedAt", now);
    setNewListings(0);
    setNewSales(0);
  };

  return (
    <div className="data-viewer">
      {/* Live data feed — only on main standalone viewer */}
      {!collectionFilter && !outputCollection && <LiveFeed />}

      {/* Collection header */}
      {collectionFilter && (
        <div className="dv-collection-header">
          <h2>{collectionFilter}</h2>
        </div>
      )}

      {/* Stats bar */}
      <div className="dv-stats-bar">
        <span>{skins.length} skins</span>
        <span>{skinsWithListings} with listings</span>
        <span>
          {totalListings.toLocaleString()} listings
          {newListings > 0 && <span className="dv-new-badge"> +{newListings} new!</span>}
        </span>
        <span>
          {totalSales.toLocaleString()} sales
          {newSales > 0 && <span className="dv-new-badge"> +{newSales} new!</span>}
        </span>
        {(newListings > 0 || newSales > 0) && (
          <button className="dv-mark-seen" onClick={markSeen}>✓ seen</button>
        )}
      </div>

      {/* Rarity tabs + Search + Sort */}
      <div className="dv-controls">
        {!isEmbedded && (
          <div className="dv-rarity-tabs">
            {([["Covert", "Covert (Inputs)"], ["Classified", "Classified (Inputs)"], ["knife_glove", "Knives/Gloves (Outputs)"], ["", "All"]] as const).map(([val, label]) => (
              <button key={val} className={rarity === val ? "toggle-active" : ""} onClick={() => { setRarity(val as typeof rarity); setSelectedSkin(null); }}>
                {label}
              </button>
            ))}
            <span className="dv-st-divider">|</span>
            <button
              className={stattrak ? "toggle-active st-toggle" : "st-toggle"}
              onClick={() => { setStattrak(st => !st); setSelectedSkin(null); }}
            >
              StatTrak™
            </button>
          </div>
        )}
        <div className="dv-search-row">
          <input
            type="text"
            className="dv-search"
            placeholder="Search skins..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={e => e.key === "Enter" && applySearch()}
          />
          <button className="apply-btn" onClick={applySearch}>Search</button>
          <div className="dv-sort">
            <span>Sort:</span>
            {(["listing_count", "sale_count", "min_price", "name"] as const).map(s => (
              <button key={s} className={sortBy === s ? "toggle-active" : ""} onClick={() => setSortBy(s)}>
                {s === "listing_count" ? "Listings" : s === "sale_count" ? "Sales" : s === "min_price" ? "Price" : "Name"}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="dv-layout">
        <div className="dv-skin-list">
          {loading ? (
            <div className="loading-text">Loading skins...</div>
          ) : (
            sorted.map(skin => (
              <div
                key={skin.id}
                className={`dv-skin-row ${selectedSkin === skin.name ? "dv-skin-selected" : ""}`}
                onClick={() => setSelectedSkin(skin.name)}
              >
                <div className="dv-skin-name">{skin.name}</div>
                <div className="dv-skin-meta">
                  <CollectionLinks collectionName={skin.collection_name} onNavigate={onNavigateCollection} compact />
                  <span className="dv-listing-count">
                    {skin.listing_count || 0} listings
                    {skin.new_listings > 0 && <span className="dv-new-count"> (+{skin.new_listings})</span>}
                  </span>
                  <span className="dv-sale-count" style={{ color: skin.sale_count > 0 ? "#e879f9" : "#555" }}>
                    {skin.sale_count || 0} sales
                    {skin.new_sales > 0 && <span className="dv-new-count"> (+{skin.new_sales})</span>}
                  </span>
                  {skin.min_price != null && skin.min_price > 0 && <span className="dv-floor">{formatDollars(skin.min_price)}</span>}
                </div>
                {skin.prices && Object.keys(skin.prices).length > 0 && (
                  <div className="dv-price-chips">
                    {CONDITION_ORDER.filter(c => skin.prices[c]).map(c => {
                      const best = skin.prices[c];
                      const price = best.csfloat_sales || best.listing || best.csfloat_ref || best.skinport;
                      if (!price) return null;
                      return (
                        <span key={c} className="dv-price-chip">
                          {c.split(" ").map(w => w[0]).join("")}: {formatDollars(price)}
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        <div className="dv-detail">
          {selectedSkin ? (
            <SkinDetailPanel skinName={selectedSkin} stattrak={stattrak} onClose={() => setSelectedSkin(null)} onNavigateCollection={onNavigateCollection} />
          ) : (
            <div className="dv-placeholder">
              Select a skin to view detailed pricing and float data
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

