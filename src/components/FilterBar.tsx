import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Badge } from "@shared/components/ui/badge.js";
import { Button } from "@shared/components/ui/button.js";
import { Input } from "@shared/components/ui/input.js";

interface FilterOptions {
  skins: { name: string; input: boolean; output: boolean }[];
  collections: { name: string; count: number }[];
}

export interface Filters {
  skins: string[];
  collections: string[];
  minProfit: string;
  maxProfit: string;
  minRoi: string;
  maxRoi: string;
  minCost: string;
  maxCost: string;
  minChance: string;
  maxChance: string;
  maxLoss: string;
  minWin: string;
}

export const EMPTY_FILTERS: Filters = {
  skins: [],
  collections: [],
  minProfit: "",
  maxProfit: "",
  minRoi: "",
  maxRoi: "",
  minCost: "",
  maxCost: "",
  minChance: "",
  maxChance: "",
  maxLoss: "",
  minWin: "",
};

export function filtersToParams(f: Filters): URLSearchParams {
  const params = new URLSearchParams();
  if (f.skins.length) params.set("skin", f.skins.join("||"));
  if (f.collections.length) params.set("collection", f.collections.join("|"));
  if (f.minProfit) params.set("min_profit", String(Math.round(parseFloat(f.minProfit) * 100)));
  if (f.maxProfit) params.set("max_profit", String(Math.round(parseFloat(f.maxProfit) * 100)));
  if (f.minRoi) params.set("min_roi", f.minRoi);
  if (f.maxRoi) params.set("max_roi", f.maxRoi);
  if (f.minCost) params.set("min_cost", String(Math.round(parseFloat(f.minCost) * 100)));
  if (f.maxCost) params.set("max_cost", String(Math.round(parseFloat(f.maxCost) * 100)));
  if (f.minChance) params.set("min_chance", f.minChance);
  if (f.maxChance) params.set("max_chance", f.maxChance);
  if (f.maxLoss) params.set("max_loss", String(Math.round(parseFloat(f.maxLoss) * 100)));
  if (f.minWin) params.set("min_win", String(Math.round(parseFloat(f.minWin) * 100)));
  return params;
}

export function hasActiveFilters(f: Filters): boolean {
  return f.skins.length > 0 || f.collections.length > 0 ||
    !!(f.minProfit || f.maxProfit || f.minRoi || f.maxRoi ||
       f.minCost || f.maxCost || f.minChance || f.maxChance ||
       f.maxLoss || f.minWin);
}

function AutocompleteInput({ placeholder, items, selected, onAdd, onRemove, renderItem }: {
  placeholder: string;
  items: { label: string; sublabel?: string }[];
  selected: string[];
  onAdd: (value: string) => void;
  onRemove: (value: string) => void;
  renderItem?: (item: { label: string; sublabel?: string }) => React.ReactNode;
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
    const available = items.filter(i => !selected.includes(i.label));
    if (!query) return available.slice(0, 50);
    const q = query.toLowerCase();
    return available
      .filter(i => i.label.toLowerCase().includes(q))
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
              key={item.label}
              className="flex justify-between items-center px-2.5 py-1.5 cursor-pointer text-xs text-popover-foreground hover:bg-accent transition-colors"
              onMouseDown={(e) => { e.preventDefault(); onAdd(item.label); setQuery(""); setOpen(false); }}
            >
              {renderItem ? renderItem(item) : (
                <>
                  <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{item.label}</span>
                  {item.sublabel && <span className="text-muted-foreground text-[0.7rem] ml-2 shrink-0">{item.sublabel}</span>}
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RangeFilter({ label, minVal, maxVal, onMinChange, onMaxChange, step, unit }: {
  label: string;
  minVal: string;
  maxVal: string;
  onMinChange: (v: string) => void;
  onMaxChange: (v: string) => void;
  step: number;
  unit: string;
  sliderMin?: number;
  sliderMax?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const hasValue = !!(minVal || maxVal);

  // Click outside to dismiss
  useEffect(() => {
    if (!expanded) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setExpanded(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [expanded]);

  const summary = hasValue
    ? `${minVal ? `${unit}${minVal}` : "any"} – ${maxVal ? `${unit}${maxVal}` : "any"}`
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
        <span className="font-medium">{label}</span>
        <span className={`text-[0.72rem] ${hasValue ? "text-blue-400" : "text-muted-foreground/60"}`}>{summary}</span>
      </button>
      {expanded && (
        <div className="absolute top-[calc(100%+4px)] left-0 z-[200] bg-popover border border-border rounded-md p-3 min-w-[220px] shadow-lg">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-foreground">{label}</span>
            <button
              className="text-muted-foreground hover:text-foreground text-sm cursor-pointer leading-none px-1"
              onClick={() => setExpanded(false)}
            >×</button>
          </div>
          <div className="flex gap-2">
            <label className="flex flex-col gap-1 text-[0.72rem] text-muted-foreground flex-1">
              <span>Min</span>
              <Input type="number" value={minVal} onChange={(e) => onMinChange(e.target.value)}
                placeholder={unit || "any"} step={step} className="h-7 text-xs [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none [-moz-appearance:textfield]" />
            </label>
            <label className="flex flex-col gap-1 text-[0.72rem] text-muted-foreground flex-1">
              <span>Max</span>
              <Input type="number" value={maxVal} onChange={(e) => onMaxChange(e.target.value)}
                placeholder={unit || "any"} step={step} className="h-7 text-xs [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none [-moz-appearance:textfield]" />
            </label>
          </div>
          {hasValue && (
            <button
              className="mt-2 text-[0.68rem] text-muted-foreground hover:text-foreground cursor-pointer"
              onClick={() => { onMinChange(""); onMaxChange(""); }}
            >Clear</button>
          )}
        </div>
      )}
    </div>
  );
}

function FilterChips({ filters, onUpdate }: { filters: Filters; onUpdate: (f: Filters) => void }) {
  const chips: { label: string; onRemove: () => void }[] = [];

  for (const s of filters.skins) {
    chips.push({ label: `Skin: ${s}`, onRemove: () => onUpdate({ ...filters, skins: filters.skins.filter(x => x !== s) }) });
  }
  for (const c of filters.collections) {
    chips.push({ label: `Collection: ${c}`, onRemove: () => onUpdate({ ...filters, collections: filters.collections.filter(x => x !== c) }) });
  }
  if (filters.minProfit || filters.maxProfit) {
    const lbl = `Profit: ${filters.minProfit ? `$${filters.minProfit}` : "any"} – ${filters.maxProfit ? `$${filters.maxProfit}` : "any"}`;
    chips.push({ label: lbl, onRemove: () => onUpdate({ ...filters, minProfit: "", maxProfit: "" }) });
  }
  if (filters.minRoi || filters.maxRoi) {
    const lbl = `ROI: ${filters.minRoi ? `${filters.minRoi}%` : "any"} – ${filters.maxRoi ? `${filters.maxRoi}%` : "any"}`;
    chips.push({ label: lbl, onRemove: () => onUpdate({ ...filters, minRoi: "", maxRoi: "" }) });
  }
  if (filters.minCost || filters.maxCost) {
    const lbl = `Cost: ${filters.minCost ? `$${filters.minCost}` : "any"} – ${filters.maxCost ? `$${filters.maxCost}` : "any"}`;
    chips.push({ label: lbl, onRemove: () => onUpdate({ ...filters, minCost: "", maxCost: "" }) });
  }
  if (filters.minChance || filters.maxChance) {
    const lbl = `Chance: ${filters.minChance ? `${filters.minChance}%` : "any"} – ${filters.maxChance ? `${filters.maxChance}%` : "any"}`;
    chips.push({ label: lbl, onRemove: () => onUpdate({ ...filters, minChance: "", maxChance: "" }) });
  }
  if (filters.maxLoss) {
    chips.push({ label: `Max Loss: $${filters.maxLoss}`, onRemove: () => onUpdate({ ...filters, maxLoss: "" }) });
  }
  if (filters.minWin) {
    chips.push({ label: `Min Best Win: $${filters.minWin}`, onRemove: () => onUpdate({ ...filters, minWin: "" }) });
  }

  if (chips.length === 0) return null;

  return (
    <div className="flex gap-1.5 flex-wrap mt-2 mb-1 items-center">
      {chips.map((chip, i) => (
        <Badge key={i} variant="secondary" className="gap-1 text-[0.72rem] font-normal">
          {chip.label}
          <button
            className="text-muted-foreground hover:text-destructive text-sm leading-none p-0"
            onClick={chip.onRemove}
          >
            &times;
          </button>
        </Badge>
      ))}
      <Button variant="ghost" size="sm" className="h-5 text-[0.7rem] px-2.5 text-muted-foreground hover:text-destructive" onClick={() => onUpdate({ ...EMPTY_FILTERS })}>
        Clear All
      </Button>
    </div>
  );
}

export function FilterBar({ filters, onFiltersChange }: {
  filters: Filters;
  onFiltersChange: (f: Filters) => void;
}) {
  const [options, setOptions] = useState<FilterOptions>({ skins: [], collections: [] });

  useEffect(() => {
    fetch("/api/filter-options")
      .then(r => r.json())
      .then(setOptions)
      .catch(() => {});
  }, []);

  const skinItems = useMemo(() => {
    const mapped = options.skins.map(s => ({
      label: s.name,
      sublabel: s.input && s.output ? "input & output" : s.input ? "input" : "output",
    }));
    mapped.sort((a, b) => {
      const aOut = a.sublabel === "output";
      const bOut = b.sublabel === "output";
      if (aOut !== bOut) return aOut ? -1 : 1;
      return a.label.localeCompare(b.label);
    });
    return mapped;
  }, [options.skins]);

  const collectionItems = useMemo(() =>
    options.collections.map(c => ({
      label: c.name,
      sublabel: `${c.count} trade-ups`,
    })),
    [options.collections]
  );

  const update = useCallback((patch: Partial<Filters>) => {
    onFiltersChange({ ...filters, ...patch });
  }, [filters, onFiltersChange]);

  return (
    <div>
      <div className="flex gap-2.5 items-start flex-wrap">
        <div className="flex gap-2 shrink-0">
          <AutocompleteInput
            placeholder="Filter by skin..."
            items={skinItems}
            selected={filters.skins}
            onAdd={(s) => update({ skins: [...filters.skins, s] })}
            onRemove={(s) => update({ skins: filters.skins.filter(x => x !== s) })}
          />
          <AutocompleteInput
            placeholder="Filter by collection..."
            items={collectionItems}
            selected={filters.collections}
            onAdd={(c) => update({ collections: [...filters.collections, c] })}
            onRemove={(c) => update({ collections: filters.collections.filter(x => x !== c) })}
          />
        </div>

        <div className="flex gap-1.5 flex-wrap flex-1">
          <RangeFilter label="Profit" unit="$" step={1}
            minVal={filters.minProfit} maxVal={filters.maxProfit}
            onMinChange={(v) => update({ minProfit: v })} onMaxChange={(v) => update({ maxProfit: v })} />
          <RangeFilter label="ROI" unit="%" step={1}
            minVal={filters.minRoi} maxVal={filters.maxRoi}
            onMinChange={(v) => update({ minRoi: v })} onMaxChange={(v) => update({ maxRoi: v })} />
          <RangeFilter label="Cost" unit="$" step={10}
            minVal={filters.minCost} maxVal={filters.maxCost}
            onMinChange={(v) => update({ minCost: v })} onMaxChange={(v) => update({ maxCost: v })} />
          <RangeFilter label="Chance" unit="%" step={5}
            minVal={filters.minChance} maxVal={filters.maxChance}
            onMinChange={(v) => update({ minChance: v })} onMaxChange={(v) => update({ maxChance: v })} />
          <RangeFilter label="Max Loss" unit="$" step={10}
            minVal={filters.maxLoss} maxVal=""
            onMinChange={(v) => update({ maxLoss: v })} onMaxChange={() => {}} />
          <RangeFilter label="Best Win" unit="$" step={10}
            minVal={filters.minWin} maxVal=""
            onMinChange={(v) => update({ minWin: v })} onMaxChange={() => {}} />
        </div>
      </div>
      <FilterChips filters={filters} onUpdate={onFiltersChange} />
    </div>
  );
}
