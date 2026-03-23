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
  initialRarity?: string;
}

export function DataViewer({ onNavigateCollection, collectionFilter, initialSearch, outputCollection, initialRarity }: DataViewerProps) {
  const [skins, setSkins] = useState<SkinSummary[]>([]);
  const [search, setSearch] = useState(initialSearch || "");
  const [appliedSearch, setAppliedSearch] = useState(initialSearch || "");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedSkin, setSelectedSkin] = useState<string | null>(initialSearch || null);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<"listing_count" | "sale_count" | "min_price" | "name">("listing_count");
  const [rarity, setRarity] = useState<string>(initialRarity ?? (collectionFilter ? "" : "all"));
  const [stattrak, setStattrak] = useState(false);
  const isEmbedded = !!(collectionFilter || outputCollection);
  const [lastViewedAt] = useState<string>(() => localStorage.getItem("dv_lastViewedAt") || new Date().toISOString());
  const [newListings, setNewListings] = useState(0);
  const [newSales, setNewSales] = useState(0);

  const [suggestions, setSuggestions] = useState<{ name: string; weapon: string; rarity: string; collection_name: string | null }[]>([]);
  const suggestTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cacheRef = useRef<Map<string, { skins: SkinSummary[]; newListings: number; newSales: number }>>(new Map());

  // Debounced server-side search suggestions
  useEffect(() => {
    if (search.length < 2 || !showSuggestions) {
      setSuggestions([]);
      return;
    }
    if (suggestTimerRef.current) clearTimeout(suggestTimerRef.current);
    suggestTimerRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/skin-suggestions?q=${encodeURIComponent(search)}`);
        const data = await res.json();
        setSuggestions(data.results || []);
      } catch {
        setSuggestions([]);
      }
    }, 250);
    return () => {
      if (suggestTimerRef.current) clearTimeout(suggestTimerRef.current);
    };
  }, [search, showSuggestions]);

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
      if (rarity) params.set("rarity", rarity);
      if (collectionFilter) params.set("collection", collectionFilter);
      if (outputCollection) params.set("outputCollection", outputCollection);
      if (stattrak) params.set("stattrak", "1");
      params.set("limit", "200");
      const fp = new URLSearchParams({ since: lastViewedAt });
      if (rarity) fp.set("tab", rarity);
      // Fetch skin data + freshness in parallel (was sequential)
      const [res, fr] = await Promise.all([
        fetch(`/api/skin-data?${params}`),
        fetch(`/api/data-freshness?${fp}`),
      ]);
      const [data, fd] = await Promise.all([res.json(), fr.json()]);
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

      {/* Rarity pills + Search + Sort */}
      {!isEmbedded && (
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          {([
            { value: "all", label: "All", color: "" },
            { value: "Covert", label: "Covert", color: "border-red-500/40 bg-red-500/10 text-red-500" },
            { value: "Classified", label: "Classified", color: "border-pink-500/40 bg-pink-500/10 text-pink-500" },
            { value: "Restricted", label: "Restricted", color: "border-purple-500/40 bg-purple-500/10 text-purple-500" },
            { value: "Mil-Spec", label: "Mil-Spec", color: "border-blue-500/40 bg-blue-500/10 text-blue-500" },
            { value: "Industrial Grade", label: "Industrial", color: "border-sky-400/40 bg-sky-400/10 text-sky-400" },
            { value: "knife_glove", label: "Knife/Glove", color: "border-yellow-500/40 bg-yellow-500/10 text-yellow-500" },
          ]).map(t => (
            <button
              key={t.value}
              className={`px-4 py-1.5 text-sm font-medium rounded-full border transition-colors cursor-pointer ${
                rarity === t.value
                  ? (t.color || "border-foreground/40 bg-foreground/10 text-foreground")
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => { setRarity(t.value); setSelectedSkin(null); }}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}
      <div className="flex gap-2 items-center mb-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Input
            type="text"
            placeholder="Search by name, weapon, collection..."
            className="w-full"
            value={search}
            onChange={e => { setSearch(e.target.value); setShowSuggestions(true); }}
            onKeyDown={e => { if (e.key === "Enter") { applySearch(); setShowSuggestions(false); } }}
            onFocus={() => setShowSuggestions(true)}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
          />
          {showSuggestions && suggestions.length > 0 && (
            <div className="absolute top-full left-0 right-0 z-[200] bg-popover border border-border rounded-b-md max-h-48 overflow-y-auto shadow-lg">
              {suggestions.map(s => (
                <div
                  key={s.name}
                  className="px-3 py-1.5 text-xs cursor-pointer hover:bg-accent transition-colors"
                  onMouseDown={e => { e.preventDefault(); setSearch(s.name); setAppliedSearch(s.name); setSelectedSkin(s.name); setShowSuggestions(false); }}
                >
                  <span className="text-foreground">{s.name}</span>
                  {s.collection_name && <span className="text-muted-foreground ml-2 text-[0.65rem]">{s.collection_name}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
        <Button variant="outline" size="default" onClick={() => { applySearch(); setShowSuggestions(false); }}>Search</Button>
        <div className="flex gap-1 items-center text-[0.8rem] text-muted-foreground">
          <span>Sort:</span>
          {(["listing_count", "sale_count", "min_price", "name"] as const).map(s => (
            <button
              key={s}
              className={`px-2.5 py-1 text-xs rounded-full cursor-pointer transition-colors ${
                sortBy === s
                  ? "bg-foreground text-background font-medium"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => setSortBy(s)}
            >
              {s === "listing_count" ? "Listings" : s === "sale_count" ? "Sales" : s === "min_price" ? "Price" : "Name"}
            </button>
          ))}
        </div>
      </div>

      {/* Desktop: side-by-side grid */}
      <div className="hidden md:grid grid-cols-[360px_1fr] gap-3 min-h-[600px]">
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

      {/* Mobile: stacked, detail replaces list when selected */}
      <div className="md:hidden">
        {selectedSkin ? (
          <div>
            <button
              className="mb-2 px-3 py-1.5 text-xs rounded border border-border text-muted-foreground hover:text-foreground cursor-pointer"
              onClick={() => setSelectedSkin(null)}
            >
              ← Back to skins
            </button>
            <SkinDetailPanel
              skinName={selectedSkin}
              stattrak={stattrak}
              onClose={() => setSelectedSkin(null)}
              onNavigateCollection={onNavigateCollection}
            />
          </div>
        ) : (
          <div className="bg-card border border-border rounded-md overflow-y-auto max-h-[70vh]">
            <SkinList
              skins={sorted}
              selectedSkin={selectedSkin}
              onSelectSkin={setSelectedSkin}
              loading={loading}
              onNavigateCollection={onNavigateCollection}
            />
          </div>
        )}
      </div>
    </div>
  );
}
