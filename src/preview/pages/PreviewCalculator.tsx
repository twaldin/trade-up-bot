import { useCallback, useRef, useState } from "react";
import type { TradeUp, TradeUpOutcome } from "../../../shared/types.js";
import { emptyCalculatorSlots, type CalculatorExampleSlot } from "../../../shared/calculator-example.js";
import { formatDollars } from "../../utils/format.js";
import { outputHref } from "../lib/board.js";

interface SearchResult {
  name: string;
  weapon: string;
  rarity: string;
  min_float: number;
  max_float: number;
  collection_name: string;
  floor_price_cents: number | null;
}

interface CalculatorStats {
  chance_to_profit: number;
  best_case_cents: number;
  worst_case_cents: number;
}

export function PreviewCalculator() {
  const [slots, setSlots] = useState<CalculatorExampleSlot[]>(emptyCalculatorSlots());
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TradeUp | null>(null);
  const [stats, setStats] = useState<CalculatorStats | null>(null);
  const debounceRef = useRef<number | undefined>(undefined);

  const search = useCallback((q: string) => {
    if (q.length < 2) {
      setResults([]);
      return;
    }
    fetch(`/api/calculator/search?q=${encodeURIComponent(q)}`, { credentials: "include" })
      .then((res) => res.json())
      .then((data: { results?: SearchResult[] }) => setResults(data.results ?? []))
      .catch(() => setResults([]));
  }, []);

  const addResult = (item: SearchResult) => {
    setSlots((prev) => {
      const next = [...prev];
      const empty = next.findIndex((slot) => !slot.resolved);
      const row: CalculatorExampleSlot = {
        skinName: item.name,
        floatValue: String(((item.min_float + item.max_float) / 2).toFixed(4)),
        priceCents: String(item.floor_price_cents ?? 0),
        resolved: item,
      };
      if (empty >= 0) next[empty] = row;
      else next.push(row);
      return next;
    });
    setQuery("");
    setResults([]);
  };

  const loadExample = async () => {
    setError(null);
    const res = await fetch("/api/calculator/example", { credentials: "include" });
    const data = await res.json() as { error?: string; inputs?: CalculatorExampleSlot[] };
    if (!res.ok || !data.inputs?.length) {
      setError(data.error || "Could not load example");
      return;
    }
    setSlots(data.inputs);
  };

  const calculate = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    setStats(null);
    const inputs = slots
      .filter((slot) => slot.resolved && slot.floatValue && slot.priceCents)
      .map((slot) => ({
        skinName: slot.skinName,
        floatValue: parseFloat(slot.floatValue),
        priceCents: parseInt(slot.priceCents, 10),
      }));
    try {
      const res = await fetch("/api/calculator", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inputs }),
      });
      const data = await res.json() as { error?: string; errors?: string[]; trade_up?: TradeUp; stats?: CalculatorStats };
      if (!res.ok || !data.trade_up) {
        setError(data.error || data.errors?.join(", ") || "Evaluation failed");
        return;
      }
      setResult(data.trade_up);
      setStats(data.stats ?? null);
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="preview-board">
      <h1 className="text-2xl font-semibold tracking-tight">Calculator</h1>
      <p className="text-sm mt-1 mb-4" style={{ color: "var(--text-muted)" }}>
        Same live calculator API as production. Add skins, then evaluate the contract.
      </p>
      <div className="flex flex-wrap gap-2 mb-4">
        <input
          className="o-input"
          style={{ minWidth: 240 }}
          value={query}
          placeholder="Search a skin"
          onChange={(event) => {
            setQuery(event.target.value);
            window.clearTimeout(debounceRef.current);
            debounceRef.current = window.setTimeout(() => search(event.target.value), 250);
          }}
        />
        <button type="button" className="preview-btn" onClick={() => void loadExample()}>Load example</button>
        <button type="button" className="preview-btn preview-btn--lime" onClick={() => void calculate()} disabled={loading}>
          {loading ? "Evaluating…" : "Evaluate"}
        </button>
        <button type="button" className="preview-btn" onClick={() => { setSlots(emptyCalculatorSlots()); setResult(null); setStats(null); }}>
          Clear
        </button>
      </div>
      {results.length > 0 && (
        <ul className="preview-listings mb-4">
          {results.slice(0, 8).map((item) => (
            <li key={item.name}>
              <button type="button" className="preview-listing w-full text-left" onClick={() => addResult(item)}>
                <span>{item.name}</span>
                <span className="ml-auto" style={{ color: "var(--text-muted)" }}>{item.rarity}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="preview-listings mb-4">
        {slots.filter((slot) => slot.resolved).map((slot, i) => (
          <div key={`${slot.skinName}-${i}`} className="preview-listing">
            <span className="truncate">{slot.skinName}</span>
            <span className="tabular-nums">{slot.floatValue}</span>
            <span className="ml-auto tabular-nums">{formatDollars(parseInt(slot.priceCents, 10) || 0)}</span>
          </div>
        ))}
      </div>
      {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
      {result && (
        <div className="preview-kpis mb-4">
          <div className="preview-kpi"><em>Cost</em><b>{formatDollars(result.total_cost_cents)}</b></div>
          <div className="preview-kpi"><em>EV</em><b>{formatDollars(result.expected_value_cents)}</b></div>
          <div className="preview-kpi"><em>Profit</em><b>{formatDollars(result.profit_cents)}</b></div>
          <div className="preview-kpi"><em>Chance</em><b>{stats ? `${Math.round(stats.chance_to_profit * 100)}%` : "—"}</b></div>
        </div>
      )}
      {result && (
        <div className="preview-skins preview-skins--out">
          {result.outcomes.map((outcome: TradeUpOutcome) => (
            <a
              key={outcome.skin_id + outcome.skin_name}
              className="preview-skin preview-skin--output"
              href={outputHref(outcome)}
              target="_blank"
              rel="noopener noreferrer"
            >
              <span className="preview-skin__price">{formatDollars(outcome.estimated_price_cents)}</span>
              <span className="preview-skin__odds">{Math.round(outcome.probability * 100)}%</span>
              <span className="preview-skin__name">{outcome.skin_name}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
