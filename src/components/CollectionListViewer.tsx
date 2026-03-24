import { useState, useEffect, useMemo } from "react";
import { Helmet } from "react-helmet-async";
import { formatDollars } from "../utils/format.js";
import { Input } from "@shared/components/ui/input.js";
import { Badge } from "@shared/components/ui/badge.js";
import { Card, CardContent } from "@shared/components/ui/card.js";

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

const FILTER_OPTIONS = [
  ["all", "All"],
  ["knives", "Knives"],
  ["gloves", "Gloves"],
  ["profitable", "Profitable"],
] as const;

export function CollectionListViewer({ onSelectCollection }: { onSelectCollection: (name: string) => void }) {
  const [collections, setCollections] = useState<CollectionInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
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

  if (loading) {
    return (
      <div className="py-10 text-center text-muted-foreground">
        Loading collections...
      </div>
    );
  }

  return (
    <div className="mt-4">
      <Helmet>
        <title>CS2 Collections — Browse All Trade-Up Collections | TradeUpBot</title>
        <meta name="description" content="Browse all CS2 weapon collections. See skin counts, listing data, and profitable trade-up opportunities for every collection." />
        <link rel="canonical" href="https://tradeupbot.app/collections" />
      </Helmet>
      <div className="flex gap-2 items-center mb-3 flex-wrap">
        <div className="flex gap-0 w-fit">
          {FILTER_OPTIONS.map(([val, label], i) => (
            <button
              key={val}
              className={`px-5 py-2 text-sm border border-border transition-colors cursor-pointer ${
                i === 0 ? "rounded-l-md" : ""
              } ${i === FILTER_OPTIONS.length - 1 ? "rounded-r-md" : ""} ${
                i > 0 ? "border-l-0" : ""
              } ${
                filter === val
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
              onClick={() => setFilter(val)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="relative min-w-[200px] flex-1">
          <Input
            type="text"
            placeholder="Search collections..."
            value={search}
            onChange={e => { setSearch(e.target.value); setShowSuggestions(true); }}
            onFocus={() => setShowSuggestions(true)}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
            className="w-full"
          />
          {showSuggestions && search.length >= 1 && (() => {
            const q = search.toLowerCase();
            const matches = collections.filter(c => c.name.toLowerCase().includes(q)).slice(0, 8);
            if (matches.length === 0) return null;
            return (
              <div className="absolute top-full left-0 right-0 z-[200] bg-popover border border-border rounded-b-md max-h-48 overflow-y-auto shadow-lg">
                {matches.map(c => (
                  <div
                    key={c.name}
                    className="px-3 py-1.5 text-xs cursor-pointer hover:bg-accent transition-colors flex justify-between"
                    onMouseDown={e => { e.preventDefault(); onSelectCollection(c.name); setShowSuggestions(false); }}
                  >
                    <span className="text-foreground">{c.name}</span>
                    <span className="text-muted-foreground">{c.listing_count} listings</span>
                  </div>
                ))}
              </div>
            );
          })()}
        </div>
      </div>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-2.5 py-1">
        {filtered.map(c => (
          <Card
            key={c.name}
            size="sm"
            className="cursor-pointer transition-colors hover:ring-muted-foreground/30 py-0!"
            onClick={() => onSelectCollection(c.name)}
          >
            <CardContent className="py-3">
              <div className="font-semibold text-sm mb-1.5 text-foreground">
                {c.name}
              </div>

              <div className="flex gap-2.5 text-[0.72rem] text-muted-foreground mb-1.5">
                <span>{c.skin_count} skins</span>
                <span>{c.covert_count} covert</span>
                <span className="text-blue-400">{c.listing_count.toLocaleString()} listings</span>
                {c.sale_count > 0 && (
                  <span className="text-amber-500">{c.sale_count.toLocaleString()} sales</span>
                )}
              </div>

              {(c.has_knives || c.has_gloves) && (
                <div className="flex gap-1.5 flex-wrap mb-1">
                  {c.has_knives && (
                    <Badge
                      variant="outline"
                      className="text-[0.65rem] bg-blue-400/10 text-blue-400 border-blue-400/25"
                    >
                      {c.knife_type_count} knife{c.knife_type_count !== 1 ? "s" : ""}
                    </Badge>
                  )}
                  {c.has_gloves && (
                    <Badge
                      variant="outline"
                      className="text-[0.65rem] bg-fuchsia-400/10 text-fuchsia-400 border-fuchsia-400/25"
                    >
                      {c.glove_type_count} glove{c.glove_type_count !== 1 ? "s" : ""}
                    </Badge>
                  )}
                  {c.finish_count > 0 && (
                    <Badge
                      variant="outline"
                      className="text-[0.65rem] bg-amber-500/10 text-amber-500 border-amber-500/20"
                    >
                      {c.finish_count} finishes
                    </Badge>
                  )}
                </div>
              )}

              {!c.has_knives && !c.has_gloves && (
                <div className="flex gap-1.5 flex-wrap mb-1">
                  <Badge
                    variant="outline"
                    className="text-[0.65rem] bg-muted text-muted-foreground border-border"
                  >
                    No case pool
                  </Badge>
                </div>
              )}

              {c.profitable_count > 0 && (
                <div className="flex gap-2 items-center text-[0.72rem]">
                  <span className="text-green-500 font-semibold">
                    {c.profitable_count} profitable
                  </span>
                  <span className="text-muted-foreground">
                    best {formatDollars(c.best_profit_cents)}
                  </span>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
