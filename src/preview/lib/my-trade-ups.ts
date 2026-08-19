/**
 * Old My Trade-Ups flows, expressed for the kit shell. Paths and payloads
 * match `src/pages/MyTradeUpsPage.tsx` — no new APIs, no fee math.
 */
import type { Condition, TradeUp, TradeUpInput, TradeUpOutcome } from "../../../shared/types.js";
import type { UserTradeUp } from "../../../shared/my-trade-ups-types.js";
import { VALID_MARKETPLACES } from "../../../shared/my-trade-ups-types.js";

export type AccountTab = "claims" | "purchased" | "history";

export const ACCOUNT_TABS: { key: AccountTab; label: string }[] = [
  { key: "claims", label: "Active Claims" },
  { key: "purchased", label: "Purchased" },
  { key: "history", label: "History" },
];

export const ACCOUNT_EMPTY: Record<AccountTab, { title: string; sub: string }> = {
  claims: { title: "No active claims.", sub: "Claim trade-ups from the main table to lock their listings." },
  purchased: { title: "No purchased trade-ups.", sub: "After confirming a claimed trade-up, it will appear here." },
  history: { title: "No trade-up history yet.", sub: "Executed and sold trade-ups will appear here." },
};

export const MARKETPLACE_LABELS: Record<string, string> = {
  csfloat: "CSFloat",
  skinport: "Skinport",
  buff: "Buff",
  steam_market: "Steam Market",
  other: "Other",
};

export const MARKETPLACE_OPTIONS = VALID_MARKETPLACES.map((value) => ({
  value,
  label: MARKETPLACE_LABELS[value] ?? value,
}));

export const MY_TRADE_UPS_API = {
  claims: "/api/trade-ups?my_claims=true&per_page=50",
  purchased: "/api/my-trade-ups?status=purchased",
  history: "/api/my-trade-ups?status=executed,sold",
  stats: "/api/my-trade-ups/stats",
  activeClaims: "/api/claims",
  execute: (id: number) => `/api/my-trade-ups/${id}/execute`,
  sell: (id: number) => `/api/my-trade-ups/${id}/sell`,
  remove: (id: number) => `/api/my-trade-ups/${id}`,
  claim: (id: number) => `/api/trade-ups/${id}/claim`,
  unclaim: (id: number) => `/api/trade-ups/${id}/claim`,
  confirm: (id: number) => `/api/trade-ups/${id}/confirm`,
  verify: (id: number) => `/api/verify-trade-up/${id}`,
} as const;

export interface ActiveClaimRow {
  id: number;
  trade_up_id: number;
  expires_at: string;
  claimed_at?: string;
}

export interface VerifyListingRow {
  listing_id: string;
  skin_name: string;
  status: "active" | "sold" | "delisted" | "theoretical" | "error";
  current_price?: number;
  original_price: number;
  price_changed?: boolean;
  sold_at?: string;
}

export interface VerifyPayload {
  trade_up_id?: number;
  inputs?: VerifyListingRow[];
  all_active?: boolean;
  any_unavailable?: boolean;
  any_price_changed?: boolean;
  error?: string;
  rate_limit?: { remaining: number; total: number; resetIn: number | null };
  updated_trade_up?: {
    total_cost_cents: number;
    profit_cents: number;
    roi_percentage: number;
    expected_value_cents?: number;
  };
}

export function signClass(cents: number): string {
  return cents >= 0 ? "is-plus" : "is-minus";
}

/** Dollars typed in the sell confirm → integer cents, or null if unusable. */
export function parseSalePriceCents(raw: string): number | null {
  const dollars = Number.parseFloat(raw);
  if (!Number.isFinite(dollars) || dollars <= 0) return null;
  const cents = Math.round(dollars * 100);
  return cents > 0 ? cents : null;
}

export function salePreview(costCents: number, saleCents: number): { profitCents: number; roi: number } {
  const profitCents = saleCents - costCents;
  const roi = costCents > 0 ? (profitCents / costCents) * 100 : 0;
  return { profitCents, roi };
}

export function tradeHoldStatus(purchasedAt: string): { ready: boolean; label: string } {
  const readyDate = new Date(new Date(purchasedAt).getTime() + 7 * 24 * 60 * 60 * 1000);
  const now = new Date();
  if (now >= readyDate) return { ready: true, label: "Ready to execute" };
  const diff = readyDate.getTime() - now.getTime();
  const days = Math.floor(diff / (24 * 60 * 60 * 1000));
  const hours = Math.floor((diff % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
  return { ready: false, label: `Ready in ${days}d ${hours}h` };
}

/** Map a UserTradeUp snapshot to the board TradeUp shape. Id stays the user-row id. */
export function userTradeUpToTradeUp(ut: UserTradeUp): TradeUp {
  const inputs: TradeUpInput[] = ut.snapshot_inputs.map((inp, i) => ({
    listing_id: `snapshot-${ut.id}-${i}`,
    skin_id: "",
    skin_name: inp.skin_name,
    collection_name: inp.collection_name,
    price_cents: inp.price_cents,
    float_value: inp.float_value,
    condition: inp.condition as Condition,
    source: inp.source,
    stattrak: inp.stattrak,
  }));

  const outcomes: TradeUpOutcome[] = ut.snapshot_outcomes.map((out) => ({
    skin_id: out.skin_id,
    skin_name: out.skin_name,
    collection_name: "",
    probability: out.probability,
    predicted_float: out.predicted_float,
    predicted_condition: out.condition as Condition,
    estimated_price_cents: out.price_cents,
  }));

  return {
    id: ut.id,
    type: ut.type,
    inputs,
    outcomes,
    total_cost_cents: ut.total_cost_cents,
    expected_value_cents: ut.expected_value_cents,
    profit_cents: ut.expected_value_cents - ut.total_cost_cents,
    roi_percentage: ut.roi_percentage,
    created_at: ut.purchased_at,
    chance_to_profit: ut.chance_to_profit,
    best_case_cents: ut.best_case_cents,
    worst_case_cents: ut.worst_case_cents,
  };
}

export function realListingIds(tu: Pick<TradeUp, "inputs">): string[] {
  return tu.inputs
    .map((row) => row.listing_id)
    .filter((id) => id.length > 0 && !id.startsWith("theor") && !id.startsWith("snapshot-"));
}

export function claimMinutesLeft(expiresAt: string, now = Date.now()): number {
  const diff = new Date(expiresAt).getTime() - now;
  return Math.max(0, Math.ceil(diff / 60000));
}

export function claimTimerLabel(expiresAt: string, now = Date.now()): { expired: boolean; minutes: number; label: string } {
  const minutes = claimMinutesLeft(expiresAt, now);
  if (minutes <= 0) return { expired: true, minutes: 0, label: "Expired" };
  return { expired: false, minutes, label: `${minutes}m left` };
}

export function confirmPurchaseCopy(selected: number, total: number): string {
  if (selected === total) return "Confirm all inputs purchased? This removes them from the system.";
  return `Confirm ${selected} of ${total} purchased? Unselected inputs will be released.`;
}

export function expiryByTradeUpId(rows: Array<{ trade_up_id: number; expires_at: string }>): Map<number, string> {
  return new Map(rows.map((row) => [row.trade_up_id, row.expires_at]));
}

export function formatShortDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString();
}
