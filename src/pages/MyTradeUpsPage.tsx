import { useState, useEffect } from "react";
import { Button } from "@shared/components/ui/button.js";
import type { UserTradeUp, UserTradeUpStats, SnapshotInput, SnapshotOutcome } from "../../shared/my-trade-ups-types.js";

const TYPE_COLORS: Record<string, string> = {
  covert_knife: "border-yellow-500/40 bg-yellow-500/10 text-yellow-500",
  classified_covert: "border-red-500/40 bg-red-500/10 text-red-500",
  restricted_classified: "border-pink-500/40 bg-pink-500/10 text-pink-500",
  milspec_restricted: "border-purple-500/40 bg-purple-500/10 text-purple-500",
  industrial_milspec: "border-blue-500/40 bg-blue-500/10 text-blue-500",
  consumer_industrial: "border-sky-400/40 bg-sky-400/10 text-sky-400",
};

const TYPE_LABELS: Record<string, string> = {
  covert_knife: "Knife/Gloves",
  classified_covert: "Covert",
  restricted_classified: "Classified",
  milspec_restricted: "Mil-Spec",
  industrial_milspec: "Industrial",
  consumer_industrial: "Consumer",
};

const MARKETPLACE_LABELS: Record<string, string> = {
  csfloat: "CSFloat",
  skinport: "Skinport",
  buff: "Buff",
  steam_market: "Steam Market",
  other: "Other",
};

interface Claim {
  id: number;
  trade_up_id: number;
  claimed_at: string;
  expires_at: string;
  trade_up: {
    total_cost_cents: number;
    profit_cents: number;
    roi_percentage: number;
    type: string;
    chance_to_profit: number;
  };
}

type Tab = "claims" | "purchased" | "history";

function cents(n: number): string {
  return (n / 100).toFixed(2);
}

function TypeBadge({ type }: { type: string }) {
  const color = TYPE_COLORS[type] || "border-muted-foreground/40 bg-muted text-muted-foreground";
  const label = TYPE_LABELS[type] || type;
  return (
    <span className={`px-2 py-0.5 text-[10px] font-medium rounded-full border ${color}`}>
      {label}
    </span>
  );
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

export default function MyTradeUpsPage() {
  const [activeTab, setActiveTab] = useState<Tab>("purchased");
  const [entries, setEntries] = useState<UserTradeUp[]>([]);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [stats, setStats] = useState<UserTradeUpStats | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  // Action flow state
  const [executingId, setExecutingId] = useState<number | null>(null);
  const [selectedOutcome, setSelectedOutcome] = useState<number | null>(null);
  const [sellingId, setSellingId] = useState<number | null>(null);
  const [salePrice, setSalePrice] = useState("");
  const [saleMarketplace, setSaleMarketplace] = useState("csfloat");
  const [removing, setRemoving] = useState<number | null>(null);

  useEffect(() => {
    fetchData();
  }, [activeTab]);

  async function fetchData() {
    setLoading(true);
    try {
      if (activeTab === "claims") {
        const res = await fetch("/api/claims", { credentials: "include" });
        const data = await res.json();
        setClaims(data.claims || []);
      } else {
        const statusParam = activeTab === "purchased" ? "purchased" : "executed,sold";
        const res = await fetch(`/api/my-trade-ups?status=${statusParam}`, { credentials: "include" });
        const data = await res.json();
        setEntries(data.trade_ups || []);
      }

      // Always fetch stats
      const statsRes = await fetch("/api/my-trade-ups/stats", { credentials: "include" });
      const statsData = await statsRes.json();
      setStats(statsData);
    } catch (e) {
      console.error("Failed to fetch my trade-ups", e);
    } finally {
      setLoading(false);
    }
  }

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

  async function handleSell(id: number, costCents: number) {
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
      setRemoving(null);
      fetchData();
    } catch {
      alert("Failed to remove trade-up");
    }
  }

  // Tab counts
  const claimCount = activeTab === "claims" ? claims.length : 0;
  const purchasedCount = activeTab === "purchased" ? entries.length : 0;
  const historyCount = activeTab === "history" ? entries.length : 0;

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
            onClick={() => { setActiveTab(key); setExpandedId(null); setExecutingId(null); setSellingId(null); }}
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

      {/* Claims tab */}
      {!loading && activeTab === "claims" && (
        claims.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <p className="mb-2">No active claims.</p>
            <p className="text-sm text-muted-foreground/70">Claim trade-ups from the main table to lock their listings.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {claims.map((claim) => {
              const expiresAt = new Date(claim.expires_at);
              const now = new Date();
              const diffMs = expiresAt.getTime() - now.getTime();
              const minsLeft = Math.max(0, Math.ceil(diffMs / 60000));

              return (
                <div key={claim.id} className="bg-card border border-border rounded-lg p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <TypeBadge type={claim.trade_up.type} />
                      <span className="text-sm">
                        Cost: <strong className="text-foreground">${cents(claim.trade_up.total_cost_cents)}</strong>
                      </span>
                      <span className="text-sm">
                        Profit: <strong className={claim.trade_up.profit_cents >= 0 ? "text-green-400" : "text-red-400"}>
                          ${cents(claim.trade_up.profit_cents)}
                        </strong>
                      </span>
                      <span className="text-sm">
                        ROI: <strong className="text-foreground">{claim.trade_up.roi_percentage.toFixed(1)}%</strong>
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={`text-xs ${minsLeft <= 5 ? "text-red-400" : "text-muted-foreground"}`}>
                        expires in {minsLeft}m
                      </span>
                      <a
                        href={`/dashboard?type=all`}
                        className="text-xs text-purple-400 hover:text-purple-300"
                      >
                        View on table
                      </a>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )
      )}

      {/* Purchased tab */}
      {!loading && activeTab === "purchased" && (
        entries.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <p className="mb-2">No purchased trade-ups.</p>
            <p className="text-sm text-muted-foreground/70">After confirming a claimed trade-up, it will appear here.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {entries.map((entry) => {
              const hold = tradeHoldStatus(entry.purchased_at);
              const isExpanded = expandedId === entry.id;
              const isExecuting = executingId === entry.id;

              return (
                <div key={entry.id} className="bg-card border border-border rounded-lg">
                  {/* Card header — clickable to expand */}
                  <button
                    onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                    className="w-full text-left p-4 cursor-pointer"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3 flex-wrap">
                        <TypeBadge type={entry.type} />
                        <span className="text-sm">
                          Cost: <strong className="text-foreground">${cents(entry.total_cost_cents)}</strong>
                        </span>
                        <span className="text-sm">
                          EV: <strong className="text-foreground">${cents(entry.expected_value_cents)}</strong>
                        </span>
                        <span className="text-sm">
                          ROI: <strong className={entry.roi_percentage >= 0 ? "text-green-400" : "text-red-400"}>
                            {entry.roi_percentage.toFixed(1)}%
                          </strong>
                        </span>
                        <span className="text-sm">
                          Profit chance: <strong className="text-foreground">{(entry.chance_to_profit * 100).toFixed(0)}%</strong>
                        </span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className={`text-xs ${hold.ready ? "text-green-400" : "text-muted-foreground"}`}>
                          {hold.label}
                        </span>
                        <span className="text-muted-foreground text-xs">{isExpanded ? "▲" : "▼"}</span>
                      </div>
                    </div>
                  </button>

                  {/* Expanded content */}
                  {isExpanded && (
                    <div className="border-t border-border p-4 space-y-4">
                      {/* Inputs */}
                      <div>
                        <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Inputs</h4>
                        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                          {entry.snapshot_inputs.map((inp: SnapshotInput, i: number) => (
                            <div key={i} className="bg-muted rounded-md p-2 text-xs">
                              <div className="font-medium text-foreground truncate" title={inp.skin_name}>{inp.skin_name}</div>
                              <div className="text-muted-foreground">{inp.condition} ({inp.float_value.toFixed(6)})</div>
                              <div className="text-foreground">${cents(inp.price_cents)} <span className="text-muted-foreground">({inp.source})</span></div>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Outcomes */}
                      <div>
                        <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Outcomes</h4>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                          {entry.snapshot_outcomes.map((out: SnapshotOutcome, i: number) => {
                            const delta = out.price_cents - entry.total_cost_cents;
                            return (
                              <div key={i} className="bg-muted rounded-md p-2 text-xs">
                                <div className="font-medium text-foreground truncate" title={out.skin_name}>{out.skin_name}</div>
                                <div className="text-muted-foreground">{out.condition} ({out.predicted_float.toFixed(6)})</div>
                                <div className="flex justify-between">
                                  <span className="text-foreground">${cents(out.price_cents)}</span>
                                  <span className={delta >= 0 ? "text-green-400" : "text-red-400"}>
                                    {delta >= 0 ? "+" : ""}${cents(delta)}
                                  </span>
                                </div>
                                <div className="text-muted-foreground">{(out.probability * 100).toFixed(1)}% chance</div>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* Execute flow */}
                      {isExecuting ? (
                        <div className="border border-purple-500/30 bg-purple-500/5 rounded-lg p-4 space-y-3">
                          <h4 className="text-sm font-medium text-foreground">Select the outcome you received</h4>
                          <div className="space-y-1.5">
                            {entry.snapshot_outcomes.map((out: SnapshotOutcome, i: number) => {
                              const delta = out.price_cents - entry.total_cost_cents;
                              return (
                                <label
                                  key={i}
                                  className={`flex items-center gap-3 p-2.5 rounded-md cursor-pointer border transition-colors ${
                                    selectedOutcome === i
                                      ? "border-purple-500/60 bg-purple-500/10"
                                      : "border-transparent hover:bg-muted"
                                  }`}
                                >
                                  <input
                                    type="radio"
                                    name="outcome"
                                    checked={selectedOutcome === i}
                                    onChange={() => setSelectedOutcome(i)}
                                    className="accent-purple-500"
                                  />
                                  <span className="text-sm text-foreground flex-1">{out.skin_name}</span>
                                  <span className="text-xs text-muted-foreground">{out.condition}</span>
                                  <span className={`text-xs ${delta >= 0 ? "text-green-400" : "text-red-400"}`}>
                                    {delta >= 0 ? "+" : ""}${cents(delta)}
                                  </span>
                                  <span className="text-xs text-muted-foreground">{(out.probability * 100).toFixed(1)}%</span>
                                </label>
                              );
                            })}
                          </div>
                          <div className="flex gap-2">
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
                      ) : (
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            onClick={() => { setExecutingId(entry.id); setSelectedOutcome(null); }}
                            className="bg-purple-600 hover:bg-purple-700 text-white"
                          >
                            Mark Trade-Up Complete
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-red-400 hover:text-red-300 border-red-500/30 hover:border-red-500/50"
                            onClick={() => handleRemove(entry.id)}
                          >
                            Remove
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )
      )}

      {/* History tab */}
      {!loading && activeTab === "history" && (
        entries.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <p className="mb-2">No trade-up history yet.</p>
            <p className="text-sm text-muted-foreground/70">Executed and sold trade-ups will appear here.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {entries.map((entry) => {
              const isSelling = sellingId === entry.id;
              const saleCents = parseFloat(salePrice) * 100;
              const saleProfit = isNaN(saleCents) ? 0 : saleCents - entry.total_cost_cents;
              const saleRoi = entry.total_cost_cents > 0 ? (saleProfit / entry.total_cost_cents) * 100 : 0;

              return (
                <div key={entry.id} className="bg-card border border-border rounded-lg p-4">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-3 flex-wrap">
                      <TypeBadge type={entry.type} />
                      {entry.status === "sold" ? (
                        <>
                          <span className="text-sm">
                            Outcome: <strong className="text-foreground">{entry.outcome_skin_name}</strong>
                          </span>
                          <span className="text-sm">
                            Cost: <strong className="text-foreground">${cents(entry.total_cost_cents)}</strong>
                          </span>
                          <span className="text-sm">
                            Sale: <strong className="text-foreground">${cents(entry.sold_price_cents!)}</strong>
                            {entry.sold_marketplace && (
                              <span className="text-muted-foreground ml-1">({MARKETPLACE_LABELS[entry.sold_marketplace] || entry.sold_marketplace})</span>
                            )}
                          </span>
                          <span className="text-sm">
                            Profit:{" "}
                            <strong className={entry.actual_profit_cents! >= 0 ? "text-green-400" : "text-red-400"}>
                              {entry.actual_profit_cents! >= 0 ? "+" : ""}${cents(entry.actual_profit_cents!)}
                            </strong>
                          </span>
                          <span className="text-sm">
                            ROI:{" "}
                            <strong className={entry.actual_profit_cents! >= 0 ? "text-green-400" : "text-red-400"}>
                              {entry.total_cost_cents > 0 ? ((entry.actual_profit_cents! / entry.total_cost_cents) * 100).toFixed(1) : 0}%
                            </strong>
                          </span>
                        </>
                      ) : (
                        <>
                          <span className="text-sm">
                            Outcome: <strong className="text-foreground">{entry.outcome_skin_name}</strong>
                          </span>
                          <span className="text-sm">
                            {entry.outcome_condition}
                          </span>
                          <span className="text-sm">
                            Cost: <strong className="text-foreground">${cents(entry.total_cost_cents)}</strong>
                          </span>
                        </>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      {entry.status === "executed" && !isSelling && (
                        <>
                          <Button
                            size="sm"
                            onClick={() => { setSellingId(entry.id); setSalePrice(""); setSaleMarketplace("csfloat"); }}
                            className="bg-purple-600 hover:bg-purple-700 text-white"
                          >
                            Mark Sold
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-red-400 hover:text-red-300 border-red-500/30 hover:border-red-500/50"
                            onClick={() => handleRemove(entry.id)}
                          >
                            Remove
                          </Button>
                        </>
                      )}
                      {entry.status === "sold" && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-red-400 hover:text-red-300 border-red-500/30 hover:border-red-500/50"
                          onClick={() => handleRemove(entry.id)}
                        >
                          Remove
                        </Button>
                      )}
                    </div>
                  </div>

                  {/* Sell flow */}
                  {isSelling && (
                    <div className="mt-3 border border-purple-500/30 bg-purple-500/5 rounded-lg p-4 space-y-3">
                      <h4 className="text-sm font-medium text-foreground">Record sale</h4>
                      <div className="flex items-center gap-3 flex-wrap">
                        <div>
                          <label className="block text-xs text-muted-foreground mb-1">Sale price ($)</label>
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
                          <label className="block text-xs text-muted-foreground mb-1">Marketplace</label>
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

                      {/* Live preview */}
                      {salePrice && !isNaN(parseFloat(salePrice)) && (
                        <div className="flex items-center gap-4 text-sm text-muted-foreground">
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
                          onClick={() => handleSell(entry.id, entry.total_cost_cents)}
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
                  )}
                </div>
              );
            })}
          </div>
        )
      )}
    </div>
  );
}
