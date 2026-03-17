import { useState, useEffect, useMemo } from "react";
import { formatDollars, conditionLabel, conditionColor } from "../../utils/format.js";
import { Button } from "@shared/components/ui/button.js";
import type { SkinDetail, SeriesKey, ListingRow, SaleRow, FloatBucket } from "./types.js";
import { SERIES_COLORS } from "./types.js";
import { ScatterChart } from "./ScatterChart.js";
import { PriceSourceTable } from "./PriceSourceTable.js";
import { SortableTable } from "./SortableTable.js";
import { CollectionLinks } from "./CollectionLinks.js";

interface SkinDetailPanelProps {
  skinName: string;
  stattrak?: boolean;
  onClose: () => void;
  onNavigateCollection?: (name: string) => void;
}

// Loading placeholder
function Skeleton({ className }: { className?: string }) {
  return <div className={`animate-pulse bg-muted rounded ${className ?? ""}`} />;
}

function LoadingSkeleton() {
  return (
    <div className="bg-card border border-border rounded-md p-4 space-y-4">
      <div className="flex justify-between items-start">
        <div className="space-y-2">
          <Skeleton className="h-6 w-64" />
          <Skeleton className="h-4 w-48" />
        </div>
        <Skeleton className="h-6 w-6 rounded" />
      </div>
      <div className="flex gap-2">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-16 w-20 rounded-md" />
        ))}
      </div>
      <Skeleton className="h-[300px] w-full rounded" />
      <Skeleton className="h-40 w-full rounded" />
    </div>
  );
}

export function SkinDetailPanel({ skinName, stattrak, onClose, onNavigateCollection }: SkinDetailPanelProps) {
  const [detail, setDetail] = useState<SkinDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [chartFullscreen, setChartFullscreen] = useState(false);
  const [visible, setVisible] = useState<Record<SeriesKey, boolean>>({
    csfloat: true, dmarket: true, skinport: true, sales: true, buckets: true,
  });
  const [sourceFilters, setSourceFilters] = useState<Record<string, boolean>>({
    csfloat: true, dmarket: true, skinport: true,
  });
  const [selectedPhase, setSelectedPhase] = useState<string | null>(null);

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

  const toggleSourceFilter = (source: string) => {
    setSourceFilters(f => ({ ...f, [source]: !f[source] }));
  };

  // Build condition-level ref price lines from CSFloat ref data (replaces bucket floors)
  const bucketFloors = useMemo(() => {
    if (!detail) return [];
    const condBounds = [
      { name: "FN", float_min: 0, float_max: 0.07 },
      { name: "MW", float_min: 0.07, float_max: 0.15 },
      { name: "FT", float_min: 0.15, float_max: 0.38 },
      { name: "WW", float_min: 0.38, float_max: 0.45 },
      { name: "BS", float_min: 0.45, float_max: 1.0 },
    ];
    const refs = (detail.priceSources || []).filter((p: any) => p.source === "csfloat_ref" && p.avg_price_cents > 0);
    const condMap: Record<string, string> = { "Factory New": "FN", "Minimal Wear": "MW", "Field-Tested": "FT", "Well-Worn": "WW", "Battle-Scarred": "BS" };
    return condBounds.map(b => {
      const ref = refs.find((r: any) => condMap[r.condition] === b.name);
      return {
        ...b,
        label: b.name,
        avg_price_cents: ref ? ref.avg_price_cents : 0,
        listing_count: ref ? ref.volume : 0,
      };
    });
  }, [detail]);

  const allListings = detail?.listings ?? [];
  const allSaleHistory = detail?.saleHistory ?? [];

  // Doppler phase detection — must be before any early returns (Rules of Hooks)
  const isDoppler = detail?.skin?.name?.includes("Doppler") ?? false;
  const phases = useMemo(() => {
    if (!isDoppler || !allListings.length) return [];
    const phaseSet = new Map<string, number>();
    for (const l of allListings) {
      if (l.phase) {
        const norm = l.phase.replace(/^phase-(\d)$/i, "Phase $1").replace(/^(\w)/, c => c.toUpperCase());
        phaseSet.set(norm, (phaseSet.get(norm) || 0) + 1);
      }
    }
    return [...phaseSet.entries()]
      .sort((a, b) => {
        const aNum = a[0].match(/Phase (\d)/)?.[1];
        const bNum = b[0].match(/Phase (\d)/)?.[1];
        if (aNum && bNum) return Number(aNum) - Number(bNum);
        if (aNum) return -1;
        if (bNum) return 1;
        return a[0].localeCompare(b[0]);
      })
      .map(([name, count]) => ({ name, count }));
  }, [allListings, isDoppler]);

  const listings = useMemo(() => {
    if (!selectedPhase) return allListings;
    return allListings.filter(l => {
      if (!l.phase) return false;
      const norm = l.phase.replace(/^phase-(\d)$/i, "Phase $1").replace(/^(\w)/, c => c.toUpperCase());
      return norm === selectedPhase;
    });
  }, [allListings, selectedPhase]);

  const saleHistory = useMemo(() => {
    if (!selectedPhase) return allSaleHistory;
    // Use phase-specific observations if available, otherwise empty
    const phaseSaleData = (detail as any)?.phaseSales?.[selectedPhase];
    return phaseSaleData ?? [];
  }, [allSaleHistory, selectedPhase, detail]);

  if (loading) return <LoadingSkeleton />;
  if (!detail) {
    return (
      <div className="bg-card border border-border rounded-md p-4">
        <div className="py-10 text-center text-muted-foreground">Failed to load skin data. Try selecting the skin again.</div>
      </div>
    );
  }

  const { skin, stats } = detail;
  // Use phase-specific prices when a Doppler phase is selected
  const priceSources = selectedPhase && detail.phasePrices?.[selectedPhase]
    ? detail.phasePrices[selectedPhase]
    : detail.priceSources;

  const condDist: Record<string, number> = {};
  for (const l of listings) {
    const c = conditionLabel(l.float_value);
    condDist[c] = (condDist[c] || 0) + 1;
  }

  const csfloatCount = listings.filter(l => !l.source || l.source === "csfloat").length;
  const dmarketCount = listings.filter(l => l.source === "dmarket").length;
  const skinportCount = listings.filter(l => l.source === "skinport").length;

  const legendItems: { key: SeriesKey; label: string; color: string; shape: "dot" | "diamond" | "line"; count: number }[] = [
    { key: "csfloat", label: "CSFloat", color: SERIES_COLORS.csfloat, shape: "dot", count: csfloatCount },
    ...(dmarketCount > 0 ? [{ key: "dmarket" as SeriesKey, label: "DMarket", color: SERIES_COLORS.dmarket, shape: "dot" as const, count: dmarketCount }] : []),
    ...(skinportCount > 0 ? [{ key: "skinport" as SeriesKey, label: "Skinport", color: SERIES_COLORS.skinport, shape: "dot" as const, count: skinportCount }] : []),
    { key: "sales", label: "Sales", color: SERIES_COLORS.sales, shape: "diamond", count: stats.saleCount || (saleHistory || []).length },
    { key: "buckets", label: "CSFloat Ref", color: SERIES_COLORS.buckets, shape: "line", count: bucketFloors.filter(b => b.avg_price_cents > 0).length },
  ];

  // Unified listings filtered by source checkboxes
  const filteredListings = listings.filter(l => {
    const src = l.source || "csfloat";
    return sourceFilters[src] !== false;
  });

  // Source counts for filter checkboxes
  const sourceOptions = [
    { key: "csfloat", label: "CSFloat", count: csfloatCount, colorClass: "text-blue-500 bg-blue-500/10" },
    ...(dmarketCount > 0 ? [{ key: "dmarket", label: "DMarket", count: dmarketCount, colorClass: "text-purple-400 bg-purple-400/10" }] : []),
    ...(skinportCount > 0 ? [{ key: "skinport", label: "Skinport", count: skinportCount, colorClass: "text-yellow-500 bg-yellow-500/10" }] : []),
  ];

  const chartContent = (fs: boolean) => (
    <>
      <div className="flex gap-2.5 text-[0.72rem] text-muted-foreground mb-1.5 flex-wrap items-center">
        {legendItems.map(item => (
          <span
            key={item.key}
            className={`cursor-pointer inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded transition-[opacity,background] select-none hover:bg-accent ${visible[item.key] ? "" : "opacity-35 line-through"}`}
            onClick={() => toggleSeries(item.key)}
          >
            {item.shape === "dot" && (
              <span className="inline-block w-2 h-2 rounded-full mr-0.5" style={{ background: item.color }} />
            )}
            {item.shape === "diamond" && (
              <span className="inline-block w-2 h-2 rotate-45 mr-1 opacity-60" style={{ background: item.color }} />
            )}
            {item.shape === "line" && (
              <span className="inline-block w-4 h-0.5 mr-1 align-middle opacity-50" style={{ background: item.color }} />
            )}
            {item.label} ({item.count})
          </span>
        ))}
        {!fs && (
          <span
            className="cursor-pointer inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded select-none ml-auto text-blue-400 text-xs hover:bg-accent"
            onClick={() => setChartFullscreen(true)}
          >
            Fullscreen
          </span>
        )}
      </div>
      <ScatterChart
        listings={listings}
        saleHistory={saleHistory || []}
        floatBuckets={bucketFloors}
        minFloat={skin.min_float}
        maxFloat={skin.max_float}
        fullscreen={fs}
        visible={visible}
      />
    </>
  );

  return (
    <div className="bg-card border border-border rounded-md p-4">
      {/* Fullscreen overlay */}
      {chartFullscreen && (
        <div className="fixed inset-0 w-screen h-screen bg-black/85 z-[1000] flex items-center justify-center p-6" onClick={() => setChartFullscreen(false)}>
          <div className="bg-card border border-border rounded-lg p-5 w-full max-w-[1300px] max-h-[90vh] overflow-y-auto [&_svg]:!max-w-none" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-start mb-4">
              <h2 className="text-lg text-foreground">{skin.name} &mdash; Float vs Price</h2>
              <Button variant="outline" size="icon-xs" onClick={() => setChartFullscreen(false)}>&times;</Button>
            </div>
            {chartContent(true)}
          </div>
        </div>
      )}

      <div className="flex justify-between items-start mb-4">
        <div>
          <h2 className="text-lg text-foreground">{skin.name}</h2>
          <span className="text-[0.8rem] text-muted-foreground">
            <CollectionLinks collectionName={skin.collection_name} onNavigate={onNavigateCollection} /> &middot; Float {skin.min_float.toFixed(2)}&ndash;{skin.max_float.toFixed(2)} &middot; {skin.rarity}
          </span>
        </div>
        <Button variant="outline" size="icon-xs" onClick={onClose}>&times;</Button>
      </div>

      {/* Doppler phase tabs */}
      {isDoppler && phases.length > 0 && (
        <div className="flex items-center gap-1.5 mb-3 flex-wrap">
          <button
            className={`px-3 py-1 text-xs font-medium rounded-full border transition-colors cursor-pointer ${
              !selectedPhase ? "border-foreground/40 bg-foreground/10 text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setSelectedPhase(null)}
          >
            All ({allListings.length})
          </button>
          {phases.map(p => {
            const isGem = ["Sapphire", "Ruby", "Emerald", "Black Pearl"].includes(p.name);
            const phaseColors: Record<string, string> = {
              "Phase 1": "border-blue-400/40 bg-blue-400/10 text-blue-400",
              "Phase 2": "border-green-400/40 bg-green-400/10 text-green-400",
              "Phase 3": "border-cyan-400/40 bg-cyan-400/10 text-cyan-400",
              "Phase 4": "border-purple-400/40 bg-purple-400/10 text-purple-400",
              "Sapphire": "border-blue-500/40 bg-blue-500/10 text-blue-500",
              "Ruby": "border-red-500/40 bg-red-500/10 text-red-500",
              "Emerald": "border-emerald-500/40 bg-emerald-500/10 text-emerald-500",
              "Black Pearl": "border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-500",
            };
            const cls = phaseColors[p.name] || "border-foreground/40 bg-foreground/10 text-foreground";
            return (
              <button
                key={p.name}
                className={`px-3 py-1 text-xs font-medium rounded-full border transition-colors cursor-pointer ${
                  selectedPhase === p.name ? cls : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
                onClick={() => setSelectedPhase(selectedPhase === p.name ? null : p.name)}
              >
                {isGem ? p.name : p.name.replace("Phase ", "P")} ({p.count})
              </button>
            );
          })}
        </div>
      )}

      {/* Condition distribution */}
      <div className="flex gap-3 mb-4 flex-wrap">
        {["FN", "MW", "FT", "WW", "BS"].map(c => (
          <span key={c} className="text-[0.8rem] text-foreground/70 flex items-center gap-1" style={{ opacity: condDist[c] ? 1 : 0.3 }}>
            {c}: {condDist[c] || 0}
          </span>
        ))}
      </div>

      {/* Scatter chart */}
      <div className="mb-5">
        <h3 className="text-[0.9rem] text-foreground/70 mb-2 pb-1 border-b border-border/70">Float vs Price</h3>
        {chartContent(false)}
      </div>

      {/* Price source comparison */}
      <div className="mb-5">
        <h3 className="text-[0.9rem] text-foreground/70 mb-2 pb-1 border-b border-border/70">Price Sources</h3>
        <PriceSourceTable priceSources={priceSources} />
      </div>

      {/* Recent Sales */}
      {saleHistory && saleHistory.length > 0 && (
        <div className="mb-5">
          <h3 className="text-[0.9rem] text-foreground/70 mb-2 pb-1 border-b border-border/70">Sale History ({stats.saleCount || saleHistory.length})</h3>
          <SortableTable<SaleRow>
            id="sales"
            data={saleHistory}
            defaultSort={{ key: "sold_at", dir: "desc" }}
            defaultLimit={25}
            columns={[
              { key: "price", label: "Price", render: r => formatDollars(r.price_cents), sortValue: r => r.price_cents },
              { key: "float", label: "Float", render: r => <span style={{ color: conditionColor(r.float_value) }}>{r.float_value.toFixed(6)}</span>, sortValue: r => r.float_value },
              { key: "cond", label: "Cond", render: r => conditionLabel(r.float_value), sortValue: r => r.float_value },
              { key: "sold_at", label: "Sold", render: r => <span className="text-muted-foreground text-[0.8rem]">{new Date(r.sold_at).toLocaleDateString()}</span>, sortValue: r => new Date(r.sold_at).getTime() },
            ]}
          />
        </div>
      )}

      {/* Float bucket detail */}
      {bucketFloors.length > 0 && (
        <div className="mb-5">
          <h3 className="text-[0.9rem] text-foreground/70 mb-2 pb-1 border-b border-border/70">CSFloat Ref Prices</h3>
          <SortableTable<FloatBucket>
            id="buckets"
            data={bucketFloors}
            defaultLimit={10}
            columns={[
              { key: "range", label: "Range", render: b => `${b.float_min.toFixed(2)} \u2013 ${b.float_max.toFixed(2)}`, sortValue: b => b.float_min },
              { key: "price", label: "Floor Price", render: b => b.avg_price_cents > 0 ? formatDollars(b.avg_price_cents) : "\u2014", sortValue: b => b.avg_price_cents },
              { key: "count", label: "Data Points", render: b => b.listing_count, sortValue: b => b.listing_count },
            ]}
          />
        </div>
      )}

      {/* Unified Listings table */}
      <div className="mb-5">
        <h3 className="text-[0.9rem] text-foreground/70 mb-2 pb-1 border-b border-border/70">
          Listings ({filteredListings.length}{filteredListings.length !== listings.length ? ` of ${listings.length}` : ""})
        </h3>

        {/* Source filter checkboxes */}
        {sourceOptions.length > 1 && (
          <div className="flex gap-2 mb-2 flex-wrap items-center">
            <span className="text-[0.75rem] text-muted-foreground mr-1">Sources:</span>
            {sourceOptions.map(opt => (
              <label
                key={opt.key}
                className={`inline-flex items-center gap-1.5 cursor-pointer text-[0.75rem] px-2 py-0.5 rounded border border-border select-none transition-opacity ${sourceFilters[opt.key] !== false ? "opacity-100" : "opacity-40"}`}
              >
                <input
                  type="checkbox"
                  checked={sourceFilters[opt.key] !== false}
                  onChange={() => toggleSourceFilter(opt.key)}
                  className="sr-only"
                />
                <span className={`text-[9px] font-semibold px-1.5 py-px rounded uppercase ${opt.colorClass}`}>{opt.label}</span>
                <span className="text-muted-foreground">({opt.count})</span>
              </label>
            ))}
          </div>
        )}

        <SortableTable<ListingRow>
          id="listings"
          data={filteredListings}
          defaultSort={{ key: "price", dir: "asc" }}
          defaultLimit={25}
          columns={[
            { key: "price", label: "Price", render: r => formatDollars(r.price_cents), sortValue: r => r.price_cents },
            { key: "float", label: "Float", render: r => <span style={{ color: conditionColor(r.float_value) }}>{r.float_value.toFixed(6)}</span>, sortValue: r => r.float_value },
            { key: "cond", label: "Cond", render: r => conditionLabel(r.float_value), sortValue: r => r.float_value },
            { key: "source", label: "Source", render: r => {
              const src = r.source || "csfloat";
              const colors: Record<string, string> = {
                csfloat: "text-blue-500 bg-blue-500/10",
                dmarket: "text-purple-400 bg-purple-400/10",
                skinport: "text-yellow-500 bg-yellow-500/10",
              };
              return <span className={`text-[9px] font-semibold px-1.5 py-px rounded uppercase ${colors[src] || ""}`}>{src.toUpperCase()}</span>;
            }, sortValue: r => r.source || "csfloat" },
            { key: "verified", label: "Verified", render: r => r.staleness_checked_at ? "\u2713" : "\u2014" },
            { key: "created", label: "Listed", render: r => <span className="text-muted-foreground text-[0.8rem]">{new Date(r.created_at).toLocaleDateString()}</span>, sortValue: r => new Date(r.created_at).getTime() },
          ]}
        />
      </div>
    </div>
  );
}
