import { useState, useEffect, useCallback } from "react";
import { Button } from "@shared/components/ui/button.js";
import { TradeUpTable } from "../components/TradeUpTable.js";
import type { TradeUp, TradeUpInput, TradeUpOutcome, Condition } from "../../shared/types.js";
import type { UserTradeUp, UserTradeUpStats, SnapshotOutcome } from "../../shared/my-trade-ups-types.js";

const MARKETPLACE_LABELS: Record<string, string> = {
  csfloat: "CSFloat",
  skinport: "Skinport",
  buff: "Buff",
  steam_market: "Steam Market",
  other: "Other",
};

type Tab = "claims" | "purchased" | "history";

function cents(n: number): string {
  return (n / 100).toFixed(2);
}

function tradeHoldStatus(purchasedAt: string): { ready: boolean; label: string } {
  const readyDate = new Date(new Date(purchasedAt).getTime() + 7 * 24 * 60 * 60 * 1000);
  const now = new Date();
  if (now >= readyDate) return { ready: true, label: "Ready to execute" };
  const diff = readyDate.getTime() - now.getTime();
  const days = Math.floor(diff / (24 * 60 * 60 * 1000));
  const hours = Math.floor((diff % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
  return { ready: false, label: `Ready in ${days}d ${hours}h` };
}

/** Map a UserTradeUp (snapshot) to a TradeUp shape for TradeUpTable */
function userTradeUpToTradeUp(ut: UserTradeUp): TradeUp {
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
    id: ut.id, // user_trade_ups.id — used by action handlers
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

export default function MyTradeUpsPage() {
  const [activeTab, setActiveTab] = useState<Tab>("claims");
  const [claimTradeUps, setClaimTradeUps] = useState<TradeUp[]>([]);
  const [entries, setEntries] = useState<UserTradeUp[]>([]);
  const [stats, setStats] = useState<UserTradeUpStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState("profit");
  const [order, setOrder] = useState<"asc" | "desc">("desc");

  // Action flow state
  const [executingId, setExecutingId] = useState<number | null>(null);
  const [selectedOutcome, setSelectedOutcome] = useState<number | null>(null);
  const [sellingId, setSellingId] = useState<number | null>(null);
  const [salePrice, setSalePrice] = useState("");
  const [saleMarketplace, setSaleMarketplace] = useState("csfloat");

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      if (activeTab === "claims") {
        const res = await fetch("/api/trade-ups?my_claims=true&per_page=50", { credentials: "include" });
        const data = await res.json();
        setClaimTradeUps(data.trade_ups || []);
      } else {
        const statusParam = activeTab === "purchased" ? "purchased" : "executed,sold";
        const res = await fetch(`/api/my-trade-ups?status=${statusParam}`, { credentials: "include" });
        const data = await res.json();
        setEntries(data.trade_ups || []);
      }

      const statsRes = await fetch("/api/my-trade-ups/stats", { credentials: "include" });
      const statsData = await statsRes.json();
      setStats(statsData);
    } catch (e) {
      console.error("Failed to fetch my trade-ups", e);
    } finally {
      setLoading(false);
    }
  }, [activeTab]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Action handlers
  async function handleExecute(id: number) {
    if (selectedOutcome === null) return;
    try {
      const res = await fetch(`/api/my-trade-ups/${id}/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ outcome_index: selectedOutcome }),
      });
      if (!res.ok) {
        const data = await res.json();
        alert(data.error || "Failed to execute");
        return;
      }
      setExecutingId(null);
      setSelectedOutcome(null);
      fetchData();
    } catch {
      alert("Failed to execute trade-up");
    }
  }

  async function handleSell(id: number) {
    const priceCents = Math.round(parseFloat(salePrice) * 100);
    if (isNaN(priceCents) || priceCents <= 0) {
      alert("Enter a valid sale price");
      return;
    }
    try {
      const res = await fetch(`/api/my-trade-ups/${id}/sell`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ price_cents: priceCents, marketplace: saleMarketplace }),
      });
      if (!res.ok) {
        const data = await res.json();
        alert(data.error || "Failed to record sale");
        return;
      }
      setSellingId(null);
      setSalePrice("");
      setSaleMarketplace("csfloat");
      fetchData();
    } catch {
      alert("Failed to record sale");
    }
  }

  async function handleRemove(id: number) {
    if (!confirm("Remove this trade-up? This cannot be undone.")) return;
    try {
      const res = await fetch(`/api/my-trade-ups/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        const data = await res.json();
        alert(data.error || "Failed to remove");
        return;
      }
      fetchData();
    } catch {
      alert("Failed to remove trade-up");
    }
  }

  const handleSort = (column: string) => {
    if (sort === column) {
      setOrder(order === "desc" ? "asc" : "desc");
    } else {
      setSort(column);
      setOrder("desc");
    }
  };

  // Map entries for table display
  const mappedTradeUps = entries.map(userTradeUpToTradeUp);
  // Keep a lookup from TradeUp.id → UserTradeUp for action bar rendering
  const entryById = new Map(entries.map(e => [e.id, e]));

  // Purchased tab action bar
  const renderPurchasedActions = useCallback((tu: TradeUp) => {
    const entry = entryById.get(tu.id);
    if (!entry) return null;
    const hold = tradeHoldStatus(entry.purchased_at);
    const isExecuting = executingId === tu.id;

    if (isExecuting) {
      return (
        <div className="space-y-3">
          <h4 className="text-[0.75rem] font-medium text-foreground">Select the outcome you received</h4>
          <div className="space-y-1.5">
            {entry.snapshot_outcomes.map((out: SnapshotOutcome, i: number) => {
              const delta = out.price_cents - entry.total_cost_cents;
              return (
                <label
                  key={i}
                  className={`flex items-center gap-3 p-2 rounded-md cursor-pointer border transition-colors text-[0.75rem] ${
                    selectedOutcome === i
                      ? "border-purple-500/60 bg-purple-500/10"
                      : "border-transparent hover:bg-muted"
                  }`}
                  onClick={(e) => e.stopPropagation()}
                >
                  <input
                    type="radio"
                    name="outcome"
                    checked={selectedOutcome === i}
                    onChange={() => setSelectedOutcome(i)}
                    className="accent-purple-500"
                  />
                  <span className="text-foreground flex-1">{out.skin_name}</span>
                  <span className="text-muted-foreground">{out.condition}</span>
                  <span className={delta >= 0 ? "text-green-400" : "text-red-400"}>
                    {delta >= 0 ? "+" : ""}${cents(delta)}
                  </span>
                  <span className="text-muted-foreground">{(out.probability * 100).toFixed(1)}%</span>
                </label>
              );
            })}
          </div>
          <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
            <Button
              size="sm"
              disabled={selectedOutcome === null}
              onClick={() => handleExecute(entry.id)}
              className="bg-purple-600 hover:bg-purple-700 text-white"
            >
              Confirm Outcome
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => { setExecutingId(null); setSelectedOutcome(null); }}
            >
              Cancel
            </Button>
          </div>
        </div>
      );
    }

    return (
      <div className="flex items-center justify-between gap-2">
        <div className="text-[0.75rem] text-muted-foreground">
          <span className={hold.ready ? "text-green-400 font-medium" : ""}>
            {hold.label}
          </span>
          <span className="ml-2 text-muted-foreground/60">Purchased {new Date(entry.purchased_at).toLocaleDateString()}</span>
        </div>
        <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
          <button
            className="px-2.5 py-1 text-[0.7rem] font-semibold rounded bg-purple-950 text-purple-400 border border-purple-800 hover:bg-purple-900 hover:border-purple-400 cursor-pointer transition-colors"
            onClick={() => { setExecutingId(entry.id); setSelectedOutcome(null); }}
          >
            Mark Complete
          </button>
          <button
            className="px-2 py-1 text-[0.7rem] rounded border border-border text-muted-foreground hover:text-red-400 hover:border-red-400 cursor-pointer transition-colors"
            onClick={() => handleRemove(entry.id)}
          >
            Remove
          </button>
        </div>
      </div>
    );
  }, [executingId, selectedOutcome, entryById]);

  // History tab action bar
  const renderHistoryActions = useCallback((tu: TradeUp) => {
    const entry = entryById.get(tu.id);
    if (!entry) return null;
    const isSelling = sellingId === tu.id;

    if (isSelling) {
      const saleCents = parseFloat(salePrice) * 100;
      const saleProfit = isNaN(saleCents) ? 0 : saleCents - entry.total_cost_cents;
      const saleRoi = entry.total_cost_cents > 0 ? (saleProfit / entry.total_cost_cents) * 100 : 0;

      return (
        <div className="space-y-3" onClick={(e) => e.stopPropagation()}>
          <h4 className="text-[0.75rem] font-medium text-foreground">Record sale</h4>
          <div className="flex items-center gap-3 flex-wrap">
            <div>
              <label className="block text-[0.65rem] text-muted-foreground mb-1">Sale price ($)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={salePrice}
                onChange={(e) => setSalePrice(e.target.value)}
                placeholder="0.00"
                className="w-32 px-2.5 py-1.5 text-sm bg-background border border-border rounded-md text-foreground focus:outline-none focus:border-purple-500"
              />
            </div>
            <div>
              <label className="block text-[0.65rem] text-muted-foreground mb-1">Marketplace</label>
              <select
                value={saleMarketplace}
                onChange={(e) => setSaleMarketplace(e.target.value)}
                className="px-2.5 py-1.5 text-sm bg-background border border-border rounded-md text-foreground focus:outline-none focus:border-purple-500"
              >
                <option value="csfloat">CSFloat</option>
                <option value="skinport">Skinport</option>
                <option value="buff">Buff</option>
                <option value="steam_market">Steam Market</option>
                <option value="other">Other</option>
              </select>
            </div>
          </div>
          {salePrice && !isNaN(parseFloat(salePrice)) && (
            <div className="flex items-center gap-4 text-[0.75rem] text-muted-foreground">
              <span>Cost: ${cents(entry.total_cost_cents)}</span>
              <span>Sale: ${parseFloat(salePrice).toFixed(2)}</span>
              <span className={saleProfit >= 0 ? "text-green-400" : "text-red-400"}>
                Profit: {saleProfit >= 0 ? "+" : ""}${(saleProfit / 100).toFixed(2)}
              </span>
              <span className={saleProfit >= 0 ? "text-green-400" : "text-red-400"}>
                ROI: {saleRoi.toFixed(1)}%
              </span>
            </div>
          )}
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={!salePrice || isNaN(parseFloat(salePrice)) || parseFloat(salePrice) <= 0}
              onClick={() => handleSell(entry.id)}
              className="bg-purple-600 hover:bg-purple-700 text-white"
            >
              Confirm Sale
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => { setSellingId(null); setSalePrice(""); }}
            >
              Cancel
            </Button>
          </div>
        </div>
      );
    }

    return (
      <div className="flex items-center justify-between gap-2">
        <div className="text-[0.75rem] text-muted-foreground">
          {entry.status === "sold" ? (
            <>
              <span>Outcome: <strong className="text-foreground">{entry.outcome_skin_name}</strong></span>
              <span className="ml-2">
                Sale: <strong className="text-foreground">${cents(entry.sold_price_cents!)}</strong>
                {entry.sold_marketplace && (
                  <span className="text-muted-foreground ml-1">({MARKETPLACE_LABELS[entry.sold_marketplace] || entry.sold_marketplace})</span>
                )}
              </span>
              <span className="ml-2">
                Actual profit:{" "}
                <strong className={entry.actual_profit_cents! >= 0 ? "text-green-400" : "text-red-400"}>
                  {entry.actual_profit_cents! >= 0 ? "+" : ""}${cents(entry.actual_profit_cents!)}
                </strong>
              </span>
            </>
          ) : (
            <>
              <span>Outcome: <strong className="text-foreground">{entry.outcome_skin_name}</strong></span>
              <span className="ml-2 text-muted-foreground/60">{entry.outcome_condition}</span>
            </>
          )}
        </div>
        <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
          {entry.status === "executed" && (
            <button
              className="px-2.5 py-1 text-[0.7rem] font-semibold rounded bg-purple-950 text-purple-400 border border-purple-800 hover:bg-purple-900 hover:border-purple-400 cursor-pointer transition-colors"
              onClick={() => { setSellingId(entry.id); setSalePrice(""); setSaleMarketplace("csfloat"); }}
            >
              Mark Sold
            </button>
          )}
          <button
            className="px-2 py-1 text-[0.7rem] rounded border border-border text-muted-foreground hover:text-red-400 hover:border-red-400 cursor-pointer transition-colors"
            onClick={() => handleRemove(entry.id)}
          >
            Remove
          </button>
        </div>
      </div>
    );
  }, [sellingId, salePrice, saleMarketplace, entryById]);

  const claimCount = activeTab === "claims" ? claimTradeUps.length : 0;
  const purchasedCount = activeTab === "purchased" ? entries.length : 0;
  const historyCount = activeTab === "history" ? entries.length : 0;

  const currentTradeUps = activeTab === "claims" ? claimTradeUps : mappedTradeUps;
  const currentRenderActions = activeTab === "purchased" ? renderPurchasedActions : activeTab === "history" ? renderHistoryActions : undefined;
  const emptyMessages: Record<Tab, { title: string; sub: string }> = {
    claims: { title: "No active claims.", sub: "Claim trade-ups from the main table to lock their listings." },
    purchased: { title: "No purchased trade-ups.", sub: "After confirming a claimed trade-up, it will appear here." },
    history: { title: "No trade-up history yet.", sub: "Executed and sold trade-ups will appear here." },
  };

  return (
    <div>
      {/* Stats bar */}
      {stats && stats.total_sold > 0 && (
        <div className="flex items-center gap-3 text-sm mb-4 px-3 py-2.5 bg-card border border-border rounded-lg">
          <span>
            All-Time Profit:{" "}
            <strong className={stats.all_time_profit_cents >= 0 ? "text-green-400" : "text-red-400"}>
              ${cents(stats.all_time_profit_cents)}
            </strong>
          </span>
          <span className="text-border">|</span>
          <span>Executed: <strong className="text-foreground">{stats.total_executed}</strong></span>
          <span className="text-border">|</span>
          <span>Win Rate: <strong className="text-foreground">{stats.win_rate}%</strong></span>
          <span className="text-border">|</span>
          <span>Avg ROI: <strong className="text-foreground">{stats.avg_roi}%</strong></span>
        </div>
      )}

      {/* Tab bar */}
      <div className="flex gap-4 mb-4 border-b border-border">
        {([
          { key: "claims" as Tab, label: "Active Claims", count: claimCount },
          { key: "purchased" as Tab, label: "Purchased", count: purchasedCount },
          { key: "history" as Tab, label: "History", count: historyCount },
        ]).map(({ key, label, count }) => (
          <button
            key={key}
            onClick={() => { setActiveTab(key); setExecutingId(null); setSellingId(null); }}
            className={`px-1 pb-2 text-sm font-medium transition-colors border-b-2 -mb-px whitespace-nowrap cursor-pointer ${
              activeTab === key
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {label}
            {activeTab === key && count > 0 && (
              <span className="ml-1.5 text-xs text-muted-foreground">({count})</span>
            )}
          </button>
        ))}
      </div>

      {/* Loading */}
      {loading && (
        <div className="text-center py-8 text-muted-foreground animate-pulse">Loading...</div>
      )}

      {/* Content */}
      {!loading && currentTradeUps.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <p className="mb-2">{emptyMessages[activeTab].title}</p>
          <p className="text-sm text-muted-foreground/70">{emptyMessages[activeTab].sub}</p>
        </div>
      ) : !loading && (
        <TradeUpTable
          tradeUps={currentTradeUps}
          sort={sort}
          order={order}
          onSort={handleSort}
          tier="pro"
          showMyClaims={activeTab === "claims"}
          renderActions={currentRenderActions}
        />
      )}
    </div>
  );
}
