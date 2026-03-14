import { useState, useEffect, useMemo } from "react";
import { formatDollars } from "../utils/format.js";

interface CollectionInfo {
  name: string;
  skin_count: number;
  covert_count: number;
  listing_count: number;
  sale_count: number;
  profitable_count: number;
  best_profit_cents: number;
  knife_type_count: number;
  glove_type_count: number;
  finish_count: number;
  has_knives: boolean;
  has_gloves: boolean;
}

export function CollectionListViewer({ onSelectCollection }: { onSelectCollection: (name: string) => void }) {
  const [collections, setCollections] = useState<CollectionInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "knives" | "gloves" | "profitable">("all");

  useEffect(() => {
    fetch("/api/collections")
      .then(r => r.json())
      .then(setCollections)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    let result = collections.filter(c => c.covert_count > 0);
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(c => c.name.toLowerCase().includes(q));
    }
    if (filter === "knives") result = result.filter(c => c.has_knives);
    else if (filter === "gloves") result = result.filter(c => c.has_gloves);
    else if (filter === "profitable") result = result.filter(c => c.profitable_count > 0);
    return result;
  }, [collections, search, filter]);

  if (loading) return <div className="loading-text">Loading collections...</div>;

  return (
    <div className="data-viewer">
      <div className="dv-controls">
        <div className="dv-rarity-tabs">
          {([["all", "All"], ["knives", "Knives"], ["gloves", "Gloves"], ["profitable", "Profitable"]] as const).map(([val, label]) => (
            <button key={val} className={filter === val ? "toggle-active" : ""} onClick={() => setFilter(val)}>
              {label}
            </button>
          ))}
        </div>
        <div className="dv-search-row">
          <input
            type="text"
            className="dv-search"
            placeholder="Search collections..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>
      <div className="collection-grid">
        {filtered.map(c => (
          <div key={c.name} className="collection-card" onClick={() => onSelectCollection(c.name)}>
            <div className="collection-card-name">{c.name}</div>
            <div className="collection-card-stats">
              <span>{c.skin_count} skins</span>
              <span>{c.covert_count} covert</span>
              <span className="dv-listing-count">{c.listing_count.toLocaleString()} listings</span>
              {c.sale_count > 0 && <span className="dv-sale-count">{c.sale_count.toLocaleString()} sales</span>}
            </div>
            {(c.has_knives || c.has_gloves) && (
              <div className="collection-card-pool">
                {c.has_knives && (
                  <span className="pool-badge knife-badge">{c.knife_type_count} knife{c.knife_type_count !== 1 ? "s" : ""}</span>
                )}
                {c.has_gloves && (
                  <span className="pool-badge glove-badge">{c.glove_type_count} glove{c.glove_type_count !== 1 ? "s" : ""}</span>
                )}
                {c.finish_count > 0 && (
                  <span className="pool-badge finish-badge">{c.finish_count} finishes</span>
                )}
              </div>
            )}
            {!c.has_knives && !c.has_gloves && (
              <div className="collection-card-pool">
                <span className="pool-badge no-pool-badge">No case pool</span>
              </div>
            )}
            {c.profitable_count > 0 && (
              <div className="collection-card-profit">
                <span className="profit-positive">{c.profitable_count} profitable</span>
                <span className="collection-card-best">best {formatDollars(c.best_profit_cents)}</span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
