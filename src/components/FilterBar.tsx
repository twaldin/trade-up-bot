import { useState, useEffect, useRef, useCallback, useMemo } from "react";

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
    <div className="ac-wrap" ref={ref}>
      <input
        type="text"
        className="ac-input"
        placeholder={placeholder}
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
      />
      {open && filtered.length > 0 && (
        <div className="ac-dropdown">
          {filtered.map(item => (
            <div
              key={item.label}
              className="ac-item"
              onMouseDown={(e) => { e.preventDefault(); onAdd(item.label); setQuery(""); setOpen(false); }}
            >
              {renderItem ? renderItem(item) : (
                <>
                  <span className="ac-item-label">{item.label}</span>
                  {item.sublabel && <span className="ac-item-sub">{item.sublabel}</span>}
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RangeFilter({ label, minVal, maxVal, onMinChange, onMaxChange, step, unit, sliderMin, sliderMax }: {
  label: string;
  minVal: string;
  maxVal: string;
  onMinChange: (v: string) => void;
  onMaxChange: (v: string) => void;
  step: number;
  unit: string;
  sliderMin: number;
  sliderMax: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasValue = !!(minVal || maxVal);

  const summary = hasValue
    ? `${minVal ? `${unit}${minVal}` : "any"} – ${maxVal ? `${unit}${maxVal}` : "any"}`
    : "any";

  return (
    <div className="rf-wrap">
      <button className={`rf-trigger ${hasValue ? "rf-active" : ""}`} onClick={() => setExpanded(e => !e)}>
        <span className="rf-label">{label}</span>
        <span className="rf-summary">{summary}</span>
      </button>
      {expanded && (
        <div className="rf-panel">
          <div className="rf-inputs">
            <label>
              <span>Min</span>
              <input type="number" value={minVal} onChange={(e) => onMinChange(e.target.value)}
                placeholder="any" step={step} />
            </label>
            <label>
              <span>Max</span>
              <input type="number" value={maxVal} onChange={(e) => onMaxChange(e.target.value)}
                placeholder="any" step={step} />
            </label>
          </div>
          <div className="rf-slider-row">
            <input type="range" className="rf-slider"
              min={sliderMin} max={sliderMax} step={step}
              value={minVal ? parseFloat(minVal) : sliderMin}
              onChange={(e) => onMinChange(e.target.value === String(sliderMin) ? "" : e.target.value)}
            />
            <input type="range" className="rf-slider"
              min={sliderMin} max={sliderMax} step={step}
              value={maxVal ? parseFloat(maxVal) : sliderMax}
              onChange={(e) => onMaxChange(e.target.value === String(sliderMax) ? "" : e.target.value)}
            />
          </div>
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
    <div className="filter-chips">
      {chips.map((chip, i) => (
        <span key={i} className="filter-chip">
          {chip.label}
          <button className="filter-chip-x" onClick={chip.onRemove}>&times;</button>
        </span>
      ))}
      <button className="filter-clear-all" onClick={() => onUpdate({ ...EMPTY_FILTERS })}>Clear All</button>
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
    // Sort output skins first (★ knife/glove names), then inputs
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
    <div className="filter-bar">
      {/* Active filter chips */}
      <FilterChips filters={filters} onUpdate={onFiltersChange} />

      {/* Filter controls row */}
      <div className="filter-controls">
        {/* Autocomplete filters */}
        <div className="filter-ac-group">
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

        {/* Range filters */}
        <div className="filter-ranges">
          <RangeFilter label="Profit" unit="$" step={1}
            minVal={filters.minProfit} maxVal={filters.maxProfit}
            onMinChange={(v) => update({ minProfit: v })} onMaxChange={(v) => update({ maxProfit: v })}
            sliderMin={-500} sliderMax={500} />
          <RangeFilter label="ROI" unit="" step={1}
            minVal={filters.minRoi} maxVal={filters.maxRoi}
            onMinChange={(v) => update({ minRoi: v })} onMaxChange={(v) => update({ maxRoi: v })}
            sliderMin={-100} sliderMax={100} />
          <RangeFilter label="Cost" unit="$" step={10}
            minVal={filters.minCost} maxVal={filters.maxCost}
            onMinChange={(v) => update({ minCost: v })} onMaxChange={(v) => update({ maxCost: v })}
            sliderMin={0} sliderMax={2000} />
          <RangeFilter label="Chance" unit="" step={5}
            minVal={filters.minChance} maxVal={filters.maxChance}
            onMinChange={(v) => update({ minChance: v })} onMaxChange={(v) => update({ maxChance: v })}
            sliderMin={0} sliderMax={100} />
          <RangeFilter label="Max Loss" unit="$" step={10}
            minVal={filters.maxLoss} maxVal=""
            onMinChange={(v) => update({ maxLoss: v })} onMaxChange={() => {}}
            sliderMin={0} sliderMax={1000} />
          <RangeFilter label="Best Win" unit="$" step={10}
            minVal={filters.minWin} maxVal=""
            onMinChange={(v) => update({ minWin: v })} onMaxChange={() => {}}
            sliderMin={0} sliderMax={5000} />
        </div>
      </div>
    </div>
  );
}
