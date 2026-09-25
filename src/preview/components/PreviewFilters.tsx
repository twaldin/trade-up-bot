/**
 * Board filter bar. Every control maps to a query parameter `/api/trade-ups`
 * already accepts — nothing here is a new server capability.
 */
import { Search, X } from "lucide-react";
import { rarityLabel } from "../lib/board.js";
import { LABEL_ABOVE_COST_PCT, LABEL_EXPECTED_PL, LABEL_MIN_ABOVE_COST } from "../lib/copy.js";

export interface BoardQuery {
  sort: string;
  order: "asc" | "desc";
  type: string;
  skin: string;
  minProfit: string;
  minChance: string;
  maxCost: string;
}

export const DEFAULT_QUERY: BoardQuery = {
  sort: "trade_up_score",
  order: "desc",
  type: "",
  skin: "",
  minProfit: "",
  minChance: "",
  maxCost: "",
};

export const BOARD_SORTS: [string, string][] = [
  ["trade_up_score", "Score"],
  ["profit", LABEL_EXPECTED_PL],
  ["roi", "ROI"],
  ["cost", "Cost"],
  ["chance", LABEL_ABOVE_COST_PCT],
  ["created", "Newest"],
];

export const BOARD_TYPES = [
  "consumer_industrial",
  "industrial_milspec",
  "milspec_restricted",
  "restricted_classified",
  "classified_covert",
  "covert_knife",
];

/** Only the keys the API understands, and only when the user set them. */
export function boardQueryString(query: BoardQuery, perPage = 12): string {
  const params = new URLSearchParams({
    per_page: String(perPage),
    sort: query.sort,
    order: query.order,
  });
  if (query.type) params.set("type", query.type);
  if (query.skin.trim()) params.set("skin", query.skin.trim());
  if (query.minProfit) params.set("min_profit", String(Math.round(Number(query.minProfit) * 100)));
  if (query.minChance) params.set("min_chance", query.minChance);
  if (query.maxCost) params.set("max_cost", String(Math.round(Number(query.maxCost) * 100)));
  return params.toString();
}

export function isDefaultQuery(query: BoardQuery): boolean {
  return (Object.keys(DEFAULT_QUERY) as (keyof BoardQuery)[])
    .every((key) => query[key] === DEFAULT_QUERY[key]);
}

export function PreviewFilters({
  query,
  onChange,
  onClear,
  canClear,
  collection,
  lockedSkin,
  onKeyDown,
  onBlur,
}: {
  query: BoardQuery;
  onChange: (next: BoardQuery) => void;
  /** Resets everything the board filters by, search chips included. */
  onClear?: () => void;
  canClear?: boolean;
  collection?: string;
  lockedSkin?: string;
  onKeyDown?: () => void;
  /** Ends a typing burst so the next edit is its own history entry. */
  onBlur?: () => void;
}) {
  const set = <K extends keyof BoardQuery>(key: K, value: BoardQuery[K]) =>
    onChange({ ...query, [key]: value });

  return (
    <div className="preview-filters">
      {!lockedSkin && (
        <label className="preview-field preview-field--search">
          <Search size={12} aria-hidden />
          <input
            className="preview-field__input"
            value={query.skin}
            placeholder={collection ? `Search in ${collection}` : "Search a skin"}
            onChange={(event) => set("skin", event.target.value)}
            onKeyDown={onKeyDown}
            onBlur={onBlur}
          />
        </label>
      )}

      <label className="preview-field">
        <span>Tier</span>
        <select className="preview-field__select" value={query.type} onChange={(event) => set("type", event.target.value)}>
          <option value="">All</option>
          {BOARD_TYPES.map((type) => (
            <option key={type} value={type}>{rarityLabel(type)}</option>
          ))}
        </select>
      </label>

      <label className="preview-field">
        <span>Sort</span>
        <select className="preview-field__select" value={query.sort} onChange={(event) => set("sort", event.target.value)}>
          {BOARD_SORTS.map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </label>

      <button
        type="button"
        className="preview-btn preview-btn--quiet"
        onClick={() => set("order", query.order === "desc" ? "asc" : "desc")}
        title="Sort direction"
      >
        {query.order === "desc" ? "High → low" : "Low → high"}
      </button>

      <label className="preview-field">
        <span>Min {LABEL_EXPECTED_PL} $</span>
        <input
          className="preview-field__num"
          inputMode="decimal"
          value={query.minProfit}
          placeholder="0"
          onChange={(event) => set("minProfit", event.target.value.replace(/[^\d.]/g, ""))}
          onKeyDown={onKeyDown}
          onBlur={onBlur}
        />
      </label>

      <label className="preview-field">
        <span>{LABEL_MIN_ABOVE_COST}</span>
        <input
          className="preview-field__num"
          inputMode="numeric"
          value={query.minChance}
          placeholder="0"
          onChange={(event) => set("minChance", event.target.value.replace(/[^\d]/g, ""))}
          onKeyDown={onKeyDown}
          onBlur={onBlur}
        />
      </label>

      <label className="preview-field">
        <span>Max cost $</span>
        <input
          className="preview-field__num"
          inputMode="decimal"
          value={query.maxCost}
          placeholder="∞"
          onChange={(event) => set("maxCost", event.target.value.replace(/[^\d.]/g, ""))}
          onKeyDown={onKeyDown}
          onBlur={onBlur}
        />
      </label>

      {(canClear ?? !isDefaultQuery(query)) && (
        <button type="button" className="preview-btn preview-btn--quiet" onClick={onClear ?? (() => onChange(DEFAULT_QUERY))}>
          <X size={11} aria-hidden />
          Clear
        </button>
      )}
    </div>
  );
}
