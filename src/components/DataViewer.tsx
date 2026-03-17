import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Input } from "@shared/components/ui/input.js";
import { Button } from "@shared/components/ui/button.js";
import type { SkinSummary } from "./data-viewer/types.js";
import { SkinList } from "./data-viewer/SkinList.js";
import { SkinDetailPanel } from "./data-viewer/SkinDetailPanel.js";
import { LiveFeed } from "./data-viewer/LiveFeed.js";

interface DataViewerProps {
  onNavigateCollection?: (name: string) => void;
  collectionFilter?: string;
  initialSearch?: string;
  outputCollection?: string;
}

export function DataViewer({ onNavigateCollection, collectionFilter, initialSearch, outputCollection }: DataViewerProps) {
  const [skins, setSkins] = useState<SkinSummary[]>([]);
  const [search, setSearch] = useState(initialSearch || "");
  const [appliedSearch, setAppliedSearch] = useState(initialSearch || "");
  const [selectedSkin, setSelectedSkin] = useState<string | null>(initialSearch || null);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<"listing_count" | "sale_count" | "min_price" | "name">("listing_count");
  const [rarity, setRarity] = useState<string>(collectionFilter ? "" : "all");
  const [stattrak, setStattrak] = useState(false);
  const isEmbedded = !!(collectionFilter || outputCollection);
  const [lastViewedAt] = useState<string>(() => localStorage.getItem("dv_lastViewedAt") || new Date().toISOString());
  const [newListings, setNewListings] = useState(0);
  const [newSales, setNewSales] = useState(0);

  const cacheRef = useRef<Map<string, { skins: SkinSummary[]; newListings: number; newSales: number }>>(new Map());

  const fetchSkins = useCallback(async () => {
    const cacheKey = `${rarity}|${appliedSearch}|${collectionFilter || ""}|${outputCollection || ""}|${stattrak}`;
    const cached = cacheRef.current.get(cacheKey);
    if (cached) {
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
      params.set("limit", "200"); // Paginated — fast even for "all" tab
      const res = await fetch(`/api/skin-data?${params}`);
      const data = await res.json();
      const fp = new URLSearchParams({ since: lastViewedAt });
      if (rarity) fp.set("tab", rarity);
      const fr = await fetch(`/api/data-freshness?${fp}`);
      const fd = await fr.json();
      const nl = fd.newListings || 0;
      const ns = fd.newSales || 0;
      cacheRef.current.set(cacheKey, { skins: data, newListings: nl, newSales: ns });
      setSkins(data);
      setNewListings(nl);
      setNewSales(ns);
    } catch { /* ignore fetch errors */ }
    setLoading(false);
  }, [appliedSearch, rarity, lastViewedAt, collectionFilter, outputCollection, stattrak]);

  useEffect(() => { fetchSkins(); }, [fetchSkins]);

  const applySearch = () => {
    setAppliedSearch(search);
    setSelectedSkin(null);
  };

  // Client-side filtering: search matches name, weapon, collection, or rarity
  const filtered = useMemo(() => {
    if (!appliedSearch) return skins;
    const q = appliedSearch.toLowerCase();
    return skins.filter(s =>
      s.name.toLowerCase().includes(q) ||
      s.weapon.toLowerCase().includes(q) ||
      (s.collection_name && s.collection_name.toLowerCase().includes(q)) ||
      s.rarity.toLowerCase().includes(q)
    );
  }, [skins, appliedSearch]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      if (sortBy === "listing_count") return (b.listing_count || 0) - (a.listing_count || 0);
      if (sortBy === "sale_count") return (b.sale_count || 0) - (a.sale_count || 0);
      if (sortBy === "min_price") return (a.min_price || 999999) - (b.min_price || 999999);
      return a.name.localeCompare(b.name);
    });
  }, [filtered, sortBy]);

  const totalListings = skins.reduce((s, sk) => s + (sk.listing_count || 0), 0);
  const skinsWithListings = skins.filter(s => s.listing_count > 0).length;

  const markSeen = () => {
    const now = new Date().toISOString();
    localStorage.setItem("dv_lastViewedAt", now);
    setNewListings(0);
    setNewSales(0);
  };

  return (
    <div className="mt-4">
      {/* Live data feed -- only on main standalone viewer */}
      {!collectionFilter && !outputCollection && <LiveFeed />}

      {/* Collection header */}
      {collectionFilter && (
        <div className="flex items-center gap-3 px-3 py-2">
          <h2 className="text-lg font-medium">{collectionFilter}</h2>
        </div>
      )}

      {/* Stats bar */}
      {!loading && skins.length > 0 && (
        <div className="flex gap-5 px-3 py-2 bg-card border border-border rounded-md text-sm text-muted-foreground mb-3">
          <span className="text-foreground/70">{skins.length} skins</span>
          <span className="text-foreground/70">{skinsWithListings} with listings</span>
          <span className="text-foreground/70">
            {totalListings.toLocaleString()} listings
            {newListings > 0 && <span className="text-green-500 font-semibold"> +{newListings} new!</span>}
          </span>
          {(newListings > 0 || newSales > 0) && (
            <Button variant="ghost" size="xs" className="text-muted-foreground hover:text-green-500" onClick={markSeen}>seen</Button>
          )}
        </div>
      )}

      {/* Rarity tabs + Search + Sort */}
      <div className="flex gap-2 items-center mb-3 flex-wrap">
        {!isEmbedded && (
          <div className="flex gap-1 mb-2 items-center">
            {([
              ["all", "All"],
              ["Covert", "Covert"],
              ["Classified", "Classified"],
              ["Restricted", "Restricted"],
              ["Mil-Spec", "Mil-Spec"],
              ["Extraordinary", "Knives/Gloves"],
            ] as const).map(([val, label]) => (
              <Button
                key={val}
                variant={rarity === val ? "default" : "outline"}
                size="sm"
                className={rarity === val ? "bg-blue-700 border-blue-700 text-white hover:bg-blue-600" : ""}
                onClick={() => { setRarity(val); setSelectedSkin(null); }}
              >
                {label}
              </Button>
            ))}
            <span className="text-muted-foreground/40 mx-1 select-none">|</span>
          </div>
        )}
        <div className="flex gap-2 items-center flex-wrap">
          <Input
            type="text"
            placeholder="Search by name, weapon, collection, or rarity..."
            className="flex-1 min-w-[200px]"
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={e => e.key === "Enter" && applySearch()}
          />
          <Button variant="outline" size="default" onClick={applySearch}>Search</Button>
          <div className="flex gap-1 items-center text-[0.8rem] text-muted-foreground">
            <span>Sort:</span>
            {(["listing_count", "sale_count", "min_price", "name"] as const).map(s => (
              <Button
                key={s}
                variant={sortBy === s ? "default" : "outline"}
                size="xs"
                className={sortBy === s ? "bg-secondary text-blue-400 border-blue-400 hover:bg-secondary" : "text-muted-foreground"}
                onClick={() => setSortBy(s)}
              >
                {s === "listing_count" ? "Listings" : s === "sale_count" ? "Sales" : s === "min_price" ? "Price" : "Name"}
              </Button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-[360px_1fr] gap-3 min-h-[600px]">
        <div className="bg-card border border-border rounded-md overflow-y-auto max-h-[80vh]">
          <SkinList
            skins={sorted}
            selectedSkin={selectedSkin}
            onSelectSkin={setSelectedSkin}
            loading={loading}
            onNavigateCollection={onNavigateCollection}
          />
        </div>

        <div className="min-h-[400px]">
          {selectedSkin ? (
            <SkinDetailPanel
              skinName={selectedSkin}
              stattrak={stattrak}
              onClose={() => setSelectedSkin(null)}
              onNavigateCollection={onNavigateCollection}
            />
          ) : (
            <div className="flex items-center justify-center h-[300px] text-muted-foreground text-[0.9rem] bg-card border border-border rounded-md">
              {loading
                ? <div className="animate-pulse">Loading skin data...</div>
                : "Select a skin to view detailed pricing and float data"
              }
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
