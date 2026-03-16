import { useState, useCallback, useRef, useEffect } from "react";
import type { TradeUp } from "../../shared/types.js";
import { formatDollars, condAbbr } from "../utils/format.js";
import { OutcomeChart } from "../components/trade-up/OutcomeChart.js";
import { OutcomeList } from "../components/trade-up/OutcomeList.js";
import { Button } from "../../shared/components/ui/button.js";
import { Badge } from "../../shared/components/ui/badge.js";

interface SearchResult {
  name: string;
  weapon: string;
  rarity: string;
  min_float: number;
  max_float: number;
  collection_name: string;
  floor_price_cents: number | null;
}

interface InputSlot {
  skinName: string;
  floatValue: string;
  priceCents: string;
  resolved: SearchResult | null;
}

interface CalculatorStats {
  chance_to_profit: number;
  best_case_cents: number;
  worst_case_cents: number;
}

const RARITY_COLORS: Record<string, string> = {
  "Covert": "text-red-400",
  "Classified": "text-pink-400",
  "Restricted": "text-purple-400",
  "Mil-Spec": "text-blue-400",
  "Industrial Grade": "text-cyan-400",
  "Consumer Grade": "text-gray-400",
};

const EMPTY_INPUT: InputSlot = { skinName: "", floatValue: "", priceCents: "", resolved: null };

function rarityInputCount(rarity: string): number {
  return rarity === "Covert" ? 5 : 10;
}

function SkinSearchInput({
  value,
  resolved,
  onSelect,
  onClear,
  placeholder,
}: {
  value: string;
  resolved: SearchResult | null;
  onSelect: (result: SearchResult) => void;
  onClear: () => void;
  placeholder: string;
}) {
  const [query, setQuery] = useState(value);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setQuery(value);
  }, [value]);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const search = useCallback((q: string) => {
    if (q.length < 2) {
      setResults([]);
      setIsOpen(false);
      return;
    }
    setLoading(true);
    fetch(`/api/calculator/search?q=${encodeURIComponent(q)}`)
      .then(r => r.json())
      .then(data => {
        setResults(data.results || []);
        setIsOpen(true);
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  }, []);

  const handleChange = (val: string) => {
    setQuery(val);
    if (resolved) onClear();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(val), 250);
  };

  const handleSelect = (result: SearchResult) => {
    setQuery(result.name);
    setIsOpen(false);
    onSelect(result);
  };

  return (
    <div ref={containerRef} className="relative">
      <div className="flex items-center gap-1.5">
        <input
          type="text"
          value={query}
          onChange={e => handleChange(e.target.value)}
          onFocus={() => { if (results.length > 0 && !resolved) setIsOpen(true); }}
          placeholder={placeholder}
          className="flex-1 h-8 px-2 text-sm rounded-md border border-border bg-background text-foreground placeholder:text-muted-foreground/50 outline-none focus:border-ring"
        />
        {resolved && (
          <button
            onClick={onClear}
            className="shrink-0 w-6 h-6 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors text-xs"
            title="Clear"
          >
            x
          </button>
        )}
        {loading && <span className="text-muted-foreground text-xs animate-pulse">...</span>}
      </div>
      {isOpen && results.length > 0 && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 max-h-64 overflow-y-auto rounded-md border border-border bg-popover shadow-md">
          {results.map((r, i) => (
            <button
              key={`${r.name}-${r.collection_name}-${i}`}
              className="w-full px-2.5 py-1.5 text-left text-sm hover:bg-accent transition-colors flex flex-col"
              onClick={() => handleSelect(r)}
            >
              <span className={`font-medium ${RARITY_COLORS[r.rarity] || "text-foreground"}`}>{r.name}</span>
              <span className="text-[0.7rem] text-muted-foreground">
                {r.collection_name}
                {r.floor_price_cents ? ` -- floor ${formatDollars(r.floor_price_cents)}` : ""}
                <span className="ml-2">float [{r.min_float.toFixed(2)}-{r.max_float.toFixed(2)}]</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function InputSlotRow({
  slot,
  index,
  detectedRarity,
  onChange,
  onRemove,
  canRemove,
}: {
  slot: InputSlot;
  index: number;
  detectedRarity: string | null;
  onChange: (index: number, update: Partial<InputSlot>) => void;
  onRemove: (index: number) => void;
  canRemove: boolean;
}) {
  const handleSelect = (result: SearchResult) => {
    const update: Partial<InputSlot> = {
      skinName: result.name,
      resolved: result,
    };
    // Auto-fill price from floor if available and no price set yet
    if (result.floor_price_cents && !slot.priceCents) {
      update.priceCents = String(result.floor_price_cents);
    }
    // Auto-fill float to min_float if not set
    if (!slot.floatValue) {
      update.floatValue = result.min_float.toFixed(4);
    }
    onChange(index, update);
  };

  const handleClear = () => {
    onChange(index, { skinName: "", resolved: null });
  };

  const rarityMismatch = detectedRarity && slot.resolved && slot.resolved.rarity !== detectedRarity;

  return (
    <div className={`rounded-md border px-3 py-2.5 ${rarityMismatch ? "border-red-500/50 bg-red-950/20" : "border-border bg-card"}`}>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs text-muted-foreground font-medium">Input #{index + 1}</span>
        <div className="flex items-center gap-1.5">
          {slot.resolved && (
            <Badge variant="outline" className={`text-[0.6rem] py-0 h-4 ${RARITY_COLORS[slot.resolved.rarity] || ""}`}>
              {slot.resolved.rarity}
            </Badge>
          )}
          {rarityMismatch && (
            <span className="text-[0.65rem] text-red-400">Rarity mismatch</span>
          )}
          {canRemove && (
            <button
              onClick={() => onRemove(index)}
              className="text-xs text-muted-foreground hover:text-red-400 transition-colors px-1"
              title="Remove input"
            >
              x
            </button>
          )}
        </div>
      </div>

      <SkinSearchInput
        value={slot.skinName}
        resolved={slot.resolved}
        onSelect={handleSelect}
        onClear={handleClear}
        placeholder="Search skin name..."
      />

      {slot.resolved && (
        <div className="flex gap-2 mt-2">
          <div className="flex-1">
            <label className="text-[0.65rem] text-muted-foreground block mb-0.5">Float Value</label>
            <input
              type="number"
              step="0.0001"
              min={slot.resolved.min_float}
              max={slot.resolved.max_float}
              value={slot.floatValue}
              onChange={e => onChange(index, { floatValue: e.target.value })}
              className="w-full h-7 px-2 text-sm rounded-md border border-border bg-background text-foreground outline-none focus:border-ring"
              placeholder={`${slot.resolved.min_float} - ${slot.resolved.max_float}`}
            />
          </div>
          <div className="flex-1">
            <label className="text-[0.65rem] text-muted-foreground block mb-0.5">Price (cents)</label>
            <input
              type="number"
              step="1"
              min="1"
              value={slot.priceCents}
              onChange={e => onChange(index, { priceCents: e.target.value })}
              className="w-full h-7 px-2 text-sm rounded-md border border-border bg-background text-foreground outline-none focus:border-ring"
              placeholder="e.g. 32000"
            />
            {slot.priceCents && (
              <span className="text-[0.65rem] text-muted-foreground mt-0.5 block">
                {formatDollars(parseInt(slot.priceCents) || 0)}
              </span>
            )}
          </div>
        </div>
      )}

      {slot.resolved && (
        <div className="text-[0.65rem] text-muted-foreground/60 mt-1">
          {slot.resolved.collection_name} -- {slot.resolved.weapon}
          {slot.floatValue && ` -- ${condAbbr(floatToConditionLocal(parseFloat(slot.floatValue)))}`}
        </div>
      )}
    </div>
  );
}

function floatToConditionLocal(f: number): string {
  if (f < 0.07) return "Factory New";
  if (f < 0.15) return "Minimal Wear";
  if (f < 0.38) return "Field-Tested";
  if (f < 0.45) return "Well-Worn";
  return "Battle-Scarred";
}

export function CalculatorPage() {
  const [inputs, setInputs] = useState<InputSlot[]>([{ ...EMPTY_INPUT }]);
  const [result, setResult] = useState<TradeUp | null>(null);
  const [stats, setStats] = useState<CalculatorStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [priceDetailKey, setPriceDetailKey] = useState<string | null>(null);

  // Detect rarity from first resolved input
  const detectedRarity = inputs.find(i => i.resolved)?.resolved?.rarity ?? null;
  const requiredCount = detectedRarity ? rarityInputCount(detectedRarity) : null;
  const resolvedCount = inputs.filter(i => i.resolved && i.floatValue && i.priceCents).length;

  const handleChange = useCallback((index: number, update: Partial<InputSlot>) => {
    setInputs(prev => {
      const next = [...prev];
      next[index] = { ...next[index], ...update };
      return next;
    });
    // Clear results when inputs change
    setResult(null);
    setStats(null);
    setError(null);
  }, []);

  const handleRemove = useCallback((index: number) => {
    setInputs(prev => {
      if (prev.length <= 1) return prev;
      return prev.filter((_, i) => i !== index);
    });
    setResult(null);
    setStats(null);
  }, []);

  const addInput = () => {
    setInputs(prev => [...prev, { ...EMPTY_INPUT }]);
  };

  const fillToRequired = () => {
    if (!requiredCount) return;
    const needed = requiredCount - inputs.length;
    if (needed <= 0) return;
    setInputs(prev => [...prev, ...Array.from({ length: needed }, () => ({ ...EMPTY_INPUT }))]);
  };

  const duplicateLast = () => {
    const lastResolved = [...inputs].reverse().find(i => i.resolved);
    if (lastResolved) {
      setInputs(prev => [...prev, { ...lastResolved }]);
    } else {
      addInput();
    }
  };

  const calculate = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    setStats(null);

    const validInputs = inputs
      .filter(i => i.resolved && i.floatValue && i.priceCents)
      .map(i => ({
        skinName: i.skinName,
        floatValue: parseFloat(i.floatValue),
        priceCents: parseInt(i.priceCents),
      }));

    if (validInputs.length === 0) {
      setError("Add at least one complete input (skin, float, price)");
      setLoading(false);
      return;
    }

    try {
      const res = await fetch("/api/calculator", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inputs: validInputs }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || data.errors?.join(", ") || "Evaluation failed");
        setLoading(false);
        return;
      }

      setResult(data.trade_up);
      setStats(data.stats);
    } catch (err) {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Trade-Up Calculator</h2>
          <p className="text-sm text-muted-foreground">
            Add skins to predict trade-up outcomes, EV, profit, and probabilities.
          </p>
        </div>
        {detectedRarity && (
          <div className="text-sm text-muted-foreground">
            <span className={RARITY_COLORS[detectedRarity]}>{detectedRarity}</span> trade-up
            {requiredCount && (
              <span className="ml-1">
                ({resolvedCount}/{requiredCount} inputs)
              </span>
            )}
          </div>
        )}
      </div>

      {/* Input slots */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-2 mb-4">
        {inputs.map((slot, i) => (
          <InputSlotRow
            key={i}
            slot={slot}
            index={i}
            detectedRarity={detectedRarity}
            onChange={handleChange}
            onRemove={handleRemove}
            canRemove={inputs.length > 1}
          />
        ))}
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2 mb-6">
        <Button variant="outline" size="sm" onClick={addInput}>
          + Add Input
        </Button>
        <Button variant="outline" size="sm" onClick={duplicateLast}>
          + Duplicate Last
        </Button>
        {requiredCount && inputs.length < requiredCount && (
          <Button variant="outline" size="sm" onClick={fillToRequired}>
            Fill to {requiredCount}
          </Button>
        )}
        <div className="flex-1" />
        <Button
          onClick={calculate}
          disabled={loading || resolvedCount === 0}
          size="sm"
        >
          {loading ? "Calculating..." : "Calculate"}
        </Button>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-md border border-red-500/50 bg-red-950/30 px-4 py-3 mb-4 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Results */}
      {result && stats && (
        <div className="space-y-4">
          {/* Summary stats */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
            <StatCard
              label="Total Cost"
              value={formatDollars(result.total_cost_cents)}
              className="text-foreground"
            />
            <StatCard
              label="Expected Value"
              value={formatDollars(result.expected_value_cents)}
              className={result.expected_value_cents >= result.total_cost_cents ? "text-green-400" : "text-red-400"}
            />
            <StatCard
              label="Profit (EV)"
              value={formatDollars(result.profit_cents)}
              className={result.profit_cents >= 0 ? "text-green-400" : "text-red-400"}
            />
            <StatCard
              label="ROI"
              value={`${result.roi_percentage.toFixed(1)}%`}
              className={result.roi_percentage >= 0 ? "text-green-400" : "text-red-400"}
            />
            <StatCard
              label="Chance to Profit"
              value={`${(stats.chance_to_profit * 100).toFixed(1)}%`}
              className={stats.chance_to_profit >= 0.5 ? "text-green-400" : "text-amber-400"}
            />
            <StatCard
              label="Outcomes"
              value={String(result.outcomes.length)}
              className="text-foreground"
            />
          </div>

          {/* Best/Worst case */}
          <div className="flex gap-4 text-sm text-muted-foreground px-1">
            <span>
              Best case: <strong className="text-green-400">{formatDollars(stats.best_case_cents)}</strong>
            </span>
            <span>
              Worst case: <strong className="text-red-400">{formatDollars(stats.worst_case_cents)}</strong>
            </span>
          </div>

          {/* Outcome chart */}
          <div className="rounded-lg border border-border bg-card">
            <OutcomeChart tu={result} />
          </div>

          {/* Outcome list */}
          <div className="rounded-lg border border-border bg-card p-4">
            <OutcomeList
              tu={result}
              priceDetailKey={priceDetailKey}
              onTogglePriceDetail={setPriceDetailKey}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, className }: { label: string; value: string; className: string }) {
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2">
      <div className="text-[0.65rem] text-muted-foreground uppercase tracking-wide mb-0.5">{label}</div>
      <div className={`text-base font-semibold ${className}`}>{value}</div>
    </div>
  );
}
