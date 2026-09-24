import { useCallback, useRef, useState } from "react";
import type { TradeUp } from "../../../shared/types.js";
import { emptyCalculatorSlots, type CalculatorExampleSlot } from "../../../shared/calculator-example.js";
import { formatDollars } from "../../utils/format.js";
import { formatFloat, outputRarityColor, rarityLabel, uniqueOutputs } from "../lib/board.js";
import { CALCULATOR_FEE_LINE } from "../lib/fees.js";
import { FeeLine } from "../components/FeeLine.js";
import { OutputTile, signedDollars, warmBoardFaces } from "./PreviewBoard.js";

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

const EXAMPLE_UNAVAILABLE = "The example is not available right now. Search a skin to build one instead.";

export function PreviewCalculator() {
  const [slots, setSlots] = useState<CalculatorExampleSlot[]>(emptyCalculatorSlots());
  const [isExample, setIsExample] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TradeUp | null>(null);
  const [stats, setStats] = useState<CalculatorStats | null>(null);
  // Faces land in the board's module-level cache, so a bump is what repaints the art.
  const [, setFaceTick] = useState(0);
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
    setIsExample(false);
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

  const evaluate = async (source: CalculatorExampleSlot[]) => {
    setLoading(true);
    setError(null);
    setResult(null);
    setStats(null);
    const inputs = source
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
      const tradeUp = data.trade_up;
      setResult(tradeUp);
      setStats(data.stats ?? null);
      void warmBoardFaces(tradeUp.outcomes.map((outcome) => outcome.skin_name))
        .then(() => setFaceTick((tick) => tick + 1));
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  };

  const loadExample = async () => {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/calculator/example", { credentials: "include" });
      const data = await res.json() as { inputs?: CalculatorExampleSlot[] };
      if (!res.ok || !data.inputs?.length) {
        setError(EXAMPLE_UNAVAILABLE);
        setLoading(false);
        return;
      }
      setSlots(data.inputs);
      setIsExample(true);
      await evaluate(data.inputs);
    } catch {
      setError(EXAMPLE_UNAVAILABLE);
      setLoading(false);
    }
  };

  const calculate = () => evaluate(slots);

  const clear = () => {
    setSlots(emptyCalculatorSlots());
    setIsExample(false);
    setResult(null);
    setStats(null);
    setError(null);
  };

  const filled = slots.filter((slot) => slot.resolved);
  const profit = result ? result.profit_cents : 0;

  return (
    <div className="preview-page">
      <header className="preview-page__head">
        <div>
          <h1>Calculator</h1>
          <p>Add 10 skins of one rarity, or 5 Coverts for a knife or glove roll, then evaluate the trade-up.</p>
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
        {filled.length > 0 && (
          <button type="button" className="preview-btn" onClick={() => void loadExample()} disabled={loading}>
            Load example
          </button>
        )}
        <button
          type="button"
          className={`preview-btn ${filled.length > 0 ? "preview-btn--lime" : ""}`}
          onClick={() => void calculate()}
          disabled={loading || filled.length === 0}
        >
          {loading ? "Evaluating…" : "Evaluate"}
        </button>
        <button type="button" className="preview-btn" onClick={clear}>
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
          <span className="preview-panel__meta">
            {isExample && <span className="preview-chip">Example</span>}
            {filled.length} / 10
          </span>
        </header>
        <div className="preview-listings">
          {filled.map((slot, i) => (
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
          {filled.length === 0 && (
            <div className="preview-calc-empty">
              <p className="preview-note">
                See a full trade-up first: the example loads ten current listings from the board and evaluates them.
              </p>
              <button
                type="button"
                className="preview-btn preview-btn--lime"
                onClick={() => void loadExample()}
                disabled={loading}
              >
                {loading ? "Loading…" : "Load example"}
              </button>
              <p className="preview-note">Or search a skin above to build your own.</p>
            </div>
          )}
        </div>
      </section>
      {error && <p className="preview-error">{error}</p>}
      {result && (
        <div className="preview-readouts">
          <Readout label="Cost" value={formatDollars(result.total_cost_cents)} />
          <Readout label="Expected value" value={formatDollars(result.expected_value_cents)} />
          <Readout label="Profit" value={signedDollars(profit)} tone={profit >= 0 ? "is-plus" : "is-minus"} />
          <Readout label="Chance of profit" value={stats ? `${Math.round(stats.chance_to_profit * 100)}%` : "—"} />
        </div>
      )}
      <FeeLine line={CALCULATOR_FEE_LINE} />
      {result && (
        <section className="preview-flow__side">
          <p className="preview-lane__label">
            {rarityLabel(result.type)} outputs
            <i style={{ background: outputRarityColor(result.type) }} />
          </p>
          <div className="preview-skins preview-skins--out preview-skins--calc">
            {uniqueOutputs(result).map((outcome) => (
              <OutputTile
                key={outcome.skin_id + outcome.skin_name}
                outcome={outcome}
                rarity={outputRarityColor(result.type)}
                costCents={result.total_cost_cents}
              />
            ))}
          </div>
        </section>
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
