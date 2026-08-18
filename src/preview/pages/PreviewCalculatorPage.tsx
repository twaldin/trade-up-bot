import { useCallback, useEffect, useRef, useState } from "react";
import type { TradeUp } from "../../../shared/types.js";
import {
  emptyCalculatorSlots,
  type CalculatorExampleSlot,
} from "../../../shared/calculator-example.js";
import { useCurrency } from "../../contexts/CurrencyContext.js";
import { trackEvent } from "../../lib/analytics.js";
import { OutcomeChart } from "../../components/trade-up/OutcomeChart.js";
import { collectPreviewSkinNames, uniqueOutcomes } from "../../../shared/preview-board.js";
import { useSkinImages } from "../../hooks/useSkinImages.js";
import { SkinRender } from "../images/SkinRender.js";

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

const EMPTY_INPUT: InputSlot = { skinName: "", floatValue: "", priceCents: "", resolved: null };

function rarityInputCount(rarity: string): number {
  return rarity === "Covert" ? 5 : 10;
}

function SkinSearchInput({
  value,
  resolved,
  onSelect,
  onClear,
}: {
  value: string;
  resolved: SearchResult | null;
  onSelect: (result: SearchResult) => void;
  onClear: () => void;
}) {
  const { formatPrice } = useCurrency();
  const [query, setQuery] = useState(value);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const debounceRef = useRef<number | undefined>(undefined);
  const abortRef = useRef<AbortController | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => () => {
    clearTimeout(debounceRef.current);
    abortRef.current?.abort();
  }, []);

  useEffect(() => { setQuery(value); }, [value]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setIsOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const search = useCallback((q: string) => {
    abortRef.current?.abort();
    if (q.length < 2) {
      setResults([]);
      setIsOpen(false);
      return;
    }
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    fetch(`/api/calculator/search?q=${encodeURIComponent(q)}`, { signal: ctrl.signal })
      .then(r => r.json())
      .then(data => {
        if (ctrl.signal.aborted) return;
        setResults(data.results || []);
        setIsOpen(true);
      })
      .catch(() => {});
  }, []);

  return (
    <div className="pv-search" ref={containerRef}>
      <div style={{ display: "flex", gap: 6 }}>
        <input
          className="pv-field"
          value={query}
          onChange={e => {
            setQuery(e.target.value);
            if (resolved) onClear();
            clearTimeout(debounceRef.current);
            debounceRef.current = window.setTimeout(() => search(e.target.value), 250);
          }}
          placeholder="Search skin"
        />
        {resolved && (
          <button type="button" className="pv-btn pv-btn-ghost" onClick={onClear}>x</button>
        )}
      </div>
      {isOpen && results.length > 0 && (
        <div className="pv-search-list">
          {results.map((r, i) => (
            <button
              key={`${r.name}-${r.collection_name}-${i}`}
              type="button"
              onClick={() => { setQuery(r.name); setIsOpen(false); onSelect(r); }}
            >
              {r.name}
              <div className="pv-muted">
                {r.collection_name}
                {r.floor_price_cents ? ` · ${formatPrice(r.floor_price_cents)}` : ""}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function PreviewCalculatorPage() {
  const { formatPrice } = useCurrency();
  const [inputs, setInputs] = useState<InputSlot[]>([{ ...EMPTY_INPUT }]);
  const [result, setResult] = useState<TradeUp | null>(null);
  const [stats, setStats] = useState<CalculatorStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exampleLoading, setExampleLoading] = useState(false);
  const [exampleLoaded, setExampleLoaded] = useState(false);

  const detectedRarity = inputs.find(i => i.resolved)?.resolved?.rarity ?? null;
  const requiredCount = detectedRarity ? rarityInputCount(detectedRarity) : null;
  const resolvedCount = inputs.filter(i => i.resolved && i.floatValue && i.priceCents).length;
  const resultImages = useSkinImages(result ? collectPreviewSkinNames([result]) : []);

  const handleChange = useCallback((index: number, update: Partial<InputSlot>) => {
    setInputs(prev => {
      const next = [...prev];
      next[index] = { ...next[index], ...update };
      return next;
    });
    setResult(null);
    setStats(null);
    setError(null);
  }, []);

  const loadExample = async () => {
    setExampleLoading(true);
    setError(null);
    setResult(null);
    setStats(null);

    try {
      const res = await fetch("/api/calculator/example");
      const data = await res.json() as { error?: string; inputs?: CalculatorExampleSlot[] };
      if (!res.ok || !data.inputs?.length) {
        setError(data.error || "Could not load example");
        setExampleLoaded(false);
        return;
      }
      setInputs(data.inputs);
      setExampleLoaded(true);
    } catch {
      setError("Could not load example");
      setExampleLoaded(false);
    } finally {
      setExampleLoading(false);
    }
  };

  const clearAll = () => {
    setInputs(emptyCalculatorSlots());
    setResult(null);
    setStats(null);
    setError(null);
    setExampleLoaded(false);
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
      trackEvent("calculator_run", {
        inputs: validInputs.length,
        profitable: (data.trade_up?.profit_cents ?? 0) > 0,
      });
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  };

  const calcOutputs = result ? uniqueOutcomes(result.outcomes) : [];

  return (
    <div>
      <title>Calculator Preview — TradeUpBot</title>
      <meta name="robots" content="noindex, nofollow" />
      <h1 className="pv-page-title">CS2 Trade-Up Calculator</h1>
      <p className="pv-muted pv-page-lead">
        Add skins to predict trade-up outcomes, EV, profit, and probabilities.
      </p>

      <div className="pv-calc-grid">
        {inputs.map((slot, i) => (
          <div key={i} className="pv-panel">
            <div className="pv-kicker" style={{ marginBottom: 8 }}>Input {i + 1}</div>
            <SkinSearchInput
              value={slot.skinName}
              resolved={slot.resolved}
              onSelect={result => handleChange(i, {
                skinName: result.name,
                resolved: result,
                priceCents: slot.priceCents || (result.floor_price_cents ? String(result.floor_price_cents) : ""),
                floatValue: slot.floatValue || result.min_float.toFixed(4),
              })}
              onClear={() => handleChange(i, { skinName: "", resolved: null })}
            />
            {slot.resolved && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}>
                <label className="pv-muted" style={{ fontSize: 11 }}>
                  Float
                  <input className="pv-field" value={slot.floatValue} onChange={e => handleChange(i, { floatValue: e.target.value })} />
                </label>
                <label className="pv-muted" style={{ fontSize: 11 }}>
                  Price (cents)
                  <input className="pv-field" value={slot.priceCents} onChange={e => handleChange(i, { priceCents: e.target.value })} />
                </label>
              </div>
            )}
          </div>
        ))}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "16px 0" }}>
        <button type="button" className="pv-btn pv-btn-ghost" onClick={() => setInputs(prev => [...prev, { ...EMPTY_INPUT }])}>+ Add input</button>
        <button type="button" className="pv-btn pv-btn-ghost" onClick={loadExample} disabled={exampleLoading}>
          {exampleLoading ? "Loading example..." : "Load example"}
        </button>
        <button type="button" className="pv-btn pv-btn-ghost" onClick={clearAll}>Clear</button>
        {requiredCount && <span className="pv-muted" style={{ alignSelf: "center", fontSize: 12 }}>{resolvedCount}/{requiredCount}</span>}
        <button type="button" className="pv-btn" onClick={calculate} disabled={loading || resolvedCount === 0}>
          {loading ? "Calculating..." : "Calculate"}
        </button>
      </div>

      {exampleLoaded && <p className="pv-muted" style={{ fontSize: 13 }}>Example loaded from live listings. Run Calculate to evaluate it.</p>}
      {error && <div className="pv-loss" style={{ marginBottom: 12 }}>{error}</div>}

      {result && stats && (
        <div>
          <div className="pv-grouped" style={{ marginBottom: 12 }}>
            {calcOutputs.map(outcome => (
              <div key={outcome.skin_id + outcome.skin_name} className="pv-grouped-item">
                <div className="pv-thumb">
                  <SkinRender name={outcome.skin_name} url={resultImages.get(outcome.skin_name)} />
                </div>
                <div className="pv-grouped-meta">
                  <div className="pv-grouped-name">{outcome.skin_name}</div>
                  <div className="pv-tabular pv-muted">{(outcome.probability * 100).toFixed(0)}%</div>
                </div>
              </div>
            ))}
          </div>
          <dl className="pv-statrow" style={{ marginBottom: 16 }}>
            <div><dt>Cost</dt><dd className="pv-tabular">{formatPrice(result.total_cost_cents)}</dd></div>
            <div><dt>EV</dt><dd className="pv-tabular">{formatPrice(result.expected_value_cents)}</dd></div>
            <div>
              <dt>Profit</dt>
              <dd className={`pv-tabular ${result.profit_cents > 0 ? "pv-profit" : result.profit_cents < 0 ? "pv-loss" : ""}`}>
                {formatPrice(result.profit_cents)}
              </dd>
            </div>
            <div><dt>Chance</dt><dd className="pv-tabular">{(stats.chance_to_profit * 100).toFixed(1)}%</dd></div>
          </dl>
          <div className="pv-outcome-grid">
            {result.outcomes.map(o => (
              <div key={o.skin_id + o.skin_name} className="pv-rule" style={{ padding: 8 }}>
                <div className="pv-slot" style={{ aspectRatio: "4/3" }}>
                  <SkinRender name={o.skin_name} url={resultImages.get(o.skin_name)} />
                </div>
                <div style={{ fontSize: 11, marginTop: 6 }}>{o.skin_name}</div>
              </div>
            ))}
          </div>
          <details className="pv-disclose">
            <summary>Distribution</summary>
            <OutcomeChart tu={result} />
          </details>
        </div>
      )}
    </div>
  );
}
