import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import type { TradeUp } from "../../shared/types.js";
import { TRADE_UP_TYPE_LABELS } from "../../shared/types.js";
import { formatDollars } from "../utils/format.js";
import { OutcomeChart } from "../components/trade-up/OutcomeChart.js";
import { InputList } from "../components/trade-up/InputList.js";
import { OutcomeList } from "../components/trade-up/OutcomeList.js";
import { VerifyResults } from "../components/trade-up/VerifyResults.js";
import { SiteNav } from "../components/SiteNav.js";
import { SiteFooter } from "../components/SiteFooter.js";

const TYPE_COLORS: Record<string, string> = {
  covert_knife: "text-yellow-500 border-yellow-500/30 bg-yellow-500/10",
  classified_covert: "text-red-500 border-red-500/30 bg-red-500/10",
  restricted_classified: "text-pink-500 border-pink-500/30 bg-pink-500/10",
  milspec_restricted: "text-purple-500 border-purple-500/30 bg-purple-500/10",
  industrial_milspec: "text-blue-500 border-blue-500/30 bg-blue-500/10",
  consumer_industrial: "text-sky-400 border-sky-400/30 bg-sky-400/10",
  staircase: "text-yellow-500 border-yellow-500/30 bg-yellow-500/10",
};

interface AuthUser {
  steam_id: string;
  tier: string;
}

export function TradeUpSharePage() {
  const { id } = useParams<{ id: string }>();
  const [tu, setTu] = useState<TradeUp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [priceDetailKey, setPriceDetailKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [linkToast, setLinkToast] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me", { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.steam_id) setUser(data); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    fetch(`/api/trade-ups/${id}`)
      .then(r => {
        if (!r.ok) throw new Error(r.status === 404 ? "Trade-up not found" : "Failed to load");
        return r.json();
      })
      .then(data => {
        const outcomes = data.outcomes || (data.outcomes_json ? JSON.parse(data.outcomes_json) : []);
        setTu({
          id: data.id,
          type: data.type,
          total_cost_cents: data.total_cost_cents,
          expected_value_cents: data.expected_value_cents,
          profit_cents: data.profit_cents,
          roi_percentage: data.roi_percentage,
          created_at: data.created_at,
          is_theoretical: data.is_theoretical === true || data.is_theoretical === 1,
          inputs: data.inputs || [],
          input_summary: { skins: [], collections: [], input_count: data.inputs?.length ?? 0 },
          outcomes,
          chance_to_profit: data.chance_to_profit ?? 0,
          best_case_cents: data.best_case_cents ?? 0,
          worst_case_cents: data.worst_case_cents ?? 0,
          outcome_count: outcomes.length,
          listing_status: data.listing_status ?? "active",
          missing_inputs: data.missing_inputs ?? 0,
          profit_streak: data.profit_streak ?? 0,
          peak_profit_cents: data.peak_profit_cents ?? 0,
          preserved_at: data.preserved_at ?? null,
          previous_inputs: data.previous_inputs ? JSON.parse(data.previous_inputs) : null,
        });
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [id]);

  const handleCopy = () => {
    navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleUnauthLinkClick = () => {
    setLinkToast(true);
    setTimeout(() => setLinkToast(false), 3000);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background text-foreground font-sans antialiased">
        <SiteNav />
        <div className="flex items-center justify-center h-[60vh] text-muted-foreground animate-pulse">Loading trade-up...</div>
        <SiteFooter />
      </div>
    );
  }

  if (error || !tu) {
    return (
      <div className="min-h-screen bg-background text-foreground font-sans antialiased">
        <SiteNav />
        <div className="flex flex-col items-center justify-center h-[60vh] gap-4">
          <div className="text-4xl opacity-50">404</div>
          <p className="text-muted-foreground">{error || "Trade-up not found"}</p>
          <a href="/" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Back to home</a>
        </div>
        <SiteFooter />
      </div>
    );
  }

  const tuType = tu.type || "";
  const typeLabel = TRADE_UP_TYPE_LABELS[tuType] || tuType;
  const typeColor = TYPE_COLORS[tuType] || "text-foreground border-border bg-muted";
  const isAuthenticated = !!user;
  const isBasicPlus = user?.tier === "pro" || user?.tier === "admin";

  return (
    <div className="min-h-screen bg-background text-foreground font-sans antialiased">
      <SiteNav />

      <main className="pt-20 pb-16">
        <div className="mx-auto max-w-4xl px-4 sm:px-6">

          {/* Stats header */}
          <div className="mb-6">
            <div className="flex items-center gap-3 mb-4">
              <span className={`px-3 py-1 text-sm font-medium rounded-full border ${typeColor}`}>
                {typeLabel}
              </span>
              <span className="text-xs text-muted-foreground">Trade-Up #{tu.id}</span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatCard label="Cost" value={formatDollars(tu.total_cost_cents)} />
              <StatCard
                label="Profit"
                value={formatDollars(tu.profit_cents)}
                className={tu.profit_cents > 0 ? "text-green-500" : "text-red-400"}
              />
              <StatCard
                label="ROI"
                value={`${tu.roi_percentage?.toFixed(1)}%`}
                className={tu.roi_percentage > 0 ? "text-green-500" : "text-red-400"}
              />
              <StatCard
                label="Chance to Profit"
                value={`${Math.round((tu.chance_to_profit ?? 0) * 100)}%`}
                className={(tu.chance_to_profit ?? 0) >= 0.5 ? "text-green-500" : (tu.chance_to_profit ?? 0) >= 0.25 ? "text-yellow-500" : "text-red-400"}
              />
            </div>

            <div className="flex items-center gap-3 mt-3">
              <div className="flex gap-4 text-xs text-muted-foreground">
                <span>EV: <span className="text-foreground">{formatDollars(tu.expected_value_cents)}</span></span>
                <span>Best: <span className="text-green-500">{formatDollars(tu.best_case_cents ?? 0)}</span></span>
                <span>Worst: <span className={(tu.worst_case_cents ?? 0) < 0 ? "text-red-400" : "text-foreground"}>{formatDollars(tu.worst_case_cents ?? 0)}</span></span>
              </div>
              <div className="ml-auto">
                <button
                  onClick={handleCopy}
                  className="px-3 py-1.5 text-[0.72rem] rounded border border-border text-muted-foreground hover:text-foreground hover:border-foreground/30 cursor-pointer transition-colors"
                >
                  {copied ? "Copied!" : "Copy Link"}
                </button>
              </div>
            </div>
          </div>

          {/* Sign in CTA for unauthenticated users */}
          {!isAuthenticated && (
            <div className="flex items-center justify-between px-4 py-3 mb-4 bg-muted/50 border border-border rounded-lg">
              <span className="text-sm text-muted-foreground">Sign in to verify, claim, and purchase listings</span>
              <a
                href={`/auth/steam?return=${encodeURIComponent(window.location.pathname)}`}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-foreground text-background hover:bg-foreground/90 transition-all"
              >
                Sign in with Steam
              </a>
            </div>
          )}

          {/* Toast for unauthenticated listing link clicks */}
          {linkToast && (
            <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 bg-foreground text-background rounded-lg text-sm font-medium shadow-lg animate-in fade-in slide-in-from-bottom-4">
              <a href={`/auth/steam?return=${encodeURIComponent(window.location.pathname)}`} className="hover:underline">
                Sign in with Steam to view listing links
              </a>
            </div>
          )}

          {/* Trade-up content — same as expanded row in TradeUpTable */}
          <div className="border border-border rounded-lg overflow-hidden bg-card">
            <OutcomeChart tu={tu} />
            {((tu.peak_profit_cents ?? 0) > 0 || tu.listing_status !== 'active') && (
              <VerifyResults tu={tu} />
            )}
            <div className="px-4 sm:px-5 py-4 flex flex-col gap-4">
              <InputList
                tu={tu}
                verifying={false}
                onVerify={() => {}}
                showListingLinks={isAuthenticated}
                showVerify={isBasicPlus}
                onUnauthLinkClick={!isAuthenticated ? handleUnauthLinkClick : undefined}
              />
              <OutcomeList
                tu={tu}
                priceDetailKey={priceDetailKey}
                onTogglePriceDetail={setPriceDetailKey}
              />
            </div>
          </div>

          {/* Bottom CTA */}
          {!isAuthenticated && (
            <div className="text-center mt-8">
              <p className="text-sm text-muted-foreground mb-3">Find more profitable trade-ups on TradeUpBot</p>
              <a
                href={`/auth/steam?return=/dashboard`}
                className="inline-flex items-center gap-2 px-6 py-2.5 text-sm font-medium rounded-lg bg-foreground text-background hover:bg-foreground/90 transition-all"
              >
                Sign in with Steam
              </a>
            </div>
          )}

        </div>
      </main>

      <SiteFooter />
    </div>
  );
}

function StatCard({ label, value, className = "" }: { label: string; value: string; className?: string }) {
  return (
    <div className="border border-border rounded-lg px-3 py-2">
      <div className="text-[0.65rem] text-muted-foreground uppercase tracking-wide mb-0.5">{label}</div>
      <div className={`text-lg font-semibold ${className || "text-foreground"}`}>{value}</div>
    </div>
  );
}
