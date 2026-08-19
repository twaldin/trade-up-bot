import { useCallback, useRef, useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import type { TradeUp, TradeUpOutcome } from "../../../shared/types.js";
import { emptyCalculatorSlots, type CalculatorExampleSlot } from "../../../shared/calculator-example.js";
import { formatDollars } from "../../utils/format.js";
import {
  conditionShort,
  formatFloat,
  outputHref,
  outputRarityColor,
  previewSkinHref,
  splitSkinName,
} from "../lib/board.js";

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

  const profit = result ? result.profit_cents : 0;

  return (
    <div className="preview-page">
      <header className="preview-page__head">
        <div>
          <h1>Calculator</h1>
          <p>Same live calculator API as production. Add skins, then evaluate the trade-up.</p>
        </div>
      </header>
      <div className="preview-toolbar">
        <input
          className="preview-input"
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
        <div className="preview-rows">
          {results.slice(0, 8).map((item) => (
            <button type="button" key={item.name} className="preview-row" onClick={() => addResult(item)}>
              <span className="preview-row__name">{item.name}</span>
              <span className="preview-chip">{item.rarity}</span>
              <span className="preview-row__num">
                {item.floor_price_cents === null ? "—" : formatDollars(item.floor_price_cents)}
              </span>
            </button>
          ))}
        </div>
      )}
      <section className="preview-panel">
        <header className="preview-panel__head">
          <p className="o-kicker">Inputs</p>
          <span className="preview-panel__meta">{slots.filter((slot) => slot.resolved).length} / 10</span>
        </header>
        <div className="preview-listings">
          {slots.filter((slot) => slot.resolved).map((slot, i) => (
            <div key={`${slot.skinName}-${i}`} className="preview-listing">
              <span className="preview-listing__n">{String(i + 1).padStart(2, "0")}</span>
              <span className="preview-listing__name"><b>{slot.skinName}</b></span>
              <span className="preview-chip">input</span>
              <span className="preview-listing__float">
                {formatFloat(parseFloat(slot.floatValue)) ?? "—"}
              </span>
              <span className="preview-listing__price">{formatDollars(parseInt(slot.priceCents, 10) || 0)}</span>
              <span />
            </div>
          ))}
          {slots.every((slot) => !slot.resolved) && (
            <p className="preview-note">Search a skin above, or load the worked example.</p>
          )}
        </div>
      </section>
      {error && <p className="preview-error">{error}</p>}
      {result && (
        <div className="preview-readouts">
          <Readout label="Cost" value={formatDollars(result.total_cost_cents)} />
          <Readout label="Expected value" value={formatDollars(result.expected_value_cents)} />
          <Readout label="Profit" value={formatDollars(profit)} tone={profit >= 0 ? "is-plus" : "is-minus"} />
          <Readout label="Chance of profit" value={stats ? `${Math.round(stats.chance_to_profit * 100)}%` : "—"} />
        </div>
      )}
      {result && (
        <div className="preview-skins preview-skins--out">
          {result.outcomes.map((outcome: TradeUpOutcome) => (
            <div
              key={outcome.skin_id + outcome.skin_name}
              className="preview-skin preview-skin--output"
              style={{ "--skin-tint": outputRarityColor(result.type) } as CSSProperties}
            >
              <a
                className="preview-skin__buy"
                href={outputHref(outcome)}
                target="_blank"
                rel="noopener noreferrer"
                title={`Buy ${outcome.skin_name} on the marketplace`}
              >
                <span className="preview-skin__art" />
                <span className="preview-skin__lead">{formatDollars(outcome.estimated_price_cents)}</span>
                <span className="preview-skin__trail">{Math.round(outcome.probability * 100)}%</span>
              </a>
              <Link className="preview-skin__label" to={previewSkinHref(outcome.skin_name)}>
                <em>
                  {conditionShort(outcome.predicted_condition)} {formatFloat(outcome.predicted_float)}
                </em>
                <b>{splitSkinName(outcome.skin_name).finish}</b>
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Readout({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="preview-readout">
      <em>{label}</em>
      <b className={tone}>{value}</b>
    </div>
  );
}
