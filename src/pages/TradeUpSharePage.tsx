import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import type { TradeUp } from "../../shared/types.js";
import { TRADE_UP_TYPE_LABELS } from "../../shared/types.js";
import { useCurrency } from "../contexts/CurrencyContext.js";
import { OutcomeChart } from "../components/trade-up/OutcomeChart.js";
import { InputList } from "../components/trade-up/InputList.js";
import { OutcomeList } from "../components/trade-up/OutcomeList.js";
import { VerifyResults } from "../components/trade-up/VerifyResults.js";
import { SiteNav } from "../components/SiteNav.js";
import { SiteFooter } from "../components/SiteFooter.js";
import { authHref } from "../lib/ref.js";
import { trackEvent } from "../lib/analytics.js";
import {
  MY_TRADE_UPS_API,
  claimTimerLabel,
  confirmPurchaseCopy,
  realListingIds,
  type ActiveClaimRow,
  type VerifyPayload,
} from "../preview/lib/my-trade-ups.js";

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
  is_admin?: boolean;
}

function ShareClaimTimer({ expiresAt }: { expiresAt: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 15000);
    return () => window.clearInterval(id);
  }, [expiresAt]);
  const tick = claimTimerLabel(expiresAt, now);
  return <span className={`text-[0.7rem] ${tick.expired || tick.minutes <= 5 ? "text-red-400" : "text-muted-foreground"}`}>{tick.label}</span>;
}

export function TradeUpSharePage() {
  const { formatPrice } = useCurrency();
  const { id } = useParams<{ id: string }>();
  const [tu, setTu] = useState<TradeUp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [priceDetailKey, setPriceDetailKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [linkToast, setLinkToast] = useState(false);
  const [claimed, setClaimed] = useState(false);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [confirmMode, setConfirmMode] = useState(false);
  const [confirmSelected, setConfirmSelected] = useState<Set<string>>(new Set());
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<VerifyPayload | undefined>(undefined);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/auth/me", { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.steam_id) setUser(data); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/trade-ups/${id}`)
      .then(r => {
        if (!r.ok) throw new Error(r.status === 404 ? "Trade-up not found" : "Failed to load");
        return r.json();
      })
      .then(data => {
        if (cancelled) return;
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
          missing_count: data.missing_count ?? data.missing_inputs ?? 0,
          profit_streak: data.profit_streak ?? 0,
          peak_profit_cents: data.peak_profit_cents ?? 0,
          preserved_at: data.preserved_at ?? null,
          previous_inputs: data.previous_inputs ? JSON.parse(data.previous_inputs) : null,
        });
        trackEvent("tradeup_view", { tradeup_id: String(data.id) });
      })
      .catch(err => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [id]);

  useEffect(() => {
    if (!user || !id) return;
    const tradeUpId = Number(id);
    fetch(MY_TRADE_UPS_API.activeClaims, { credentials: "include" })
      .then((res) => res.ok ? res.json() : { claims: [] })
      .then((data: { claims?: ActiveClaimRow[] }) => {
        const mine = (data.claims ?? []).find((row) => row.trade_up_id === tradeUpId);
        if (mine) {
          setClaimed(true);
          setExpiresAt(mine.expires_at);
        }
      })
      .catch(() => {});
  }, [user, id]);

  const handleCopy = () => {
    navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleUnauthLinkClick = () => {
    setLinkToast(true);
    setTimeout(() => setLinkToast(false), 3000);
  };

  const readError = async (res: Response, fallback: string) => {
    try {
      const data = await res.json() as { error?: string };
      return data.error || fallback;
    } catch {
      return fallback;
    }
  };

  async function handleVerify(tuId: number) {
    setVerifying(true);
    setActionError(null);
    try {
      const res = await fetch(MY_TRADE_UPS_API.verify(tuId), { method: "POST", credentials: "include" });
      const data = await res.json() as VerifyPayload;
      if (!res.ok) {
        setActionError(data.error || "Failed to verify");
        return;
      }
      setVerifyResult(data);
      if (data.updated_trade_up) {
        setTu((prev) => prev ? {
          ...prev,
          total_cost_cents: data.updated_trade_up!.total_cost_cents,
          profit_cents: data.updated_trade_up!.profit_cents,
          roi_percentage: data.updated_trade_up!.roi_percentage,
          expected_value_cents: data.updated_trade_up!.expected_value_cents ?? prev.expected_value_cents,
        } : prev);
      }
    } catch {
      setActionError("Failed to verify");
    } finally {
      setVerifying(false);
    }
  }

  async function handleClaim(tuId: number) {
    setActionError(null);
    const res = await fetch(MY_TRADE_UPS_API.claim(tuId), { method: "POST", credentials: "include" });
    const data = await res.json() as { error?: string; claim?: { expires_at?: string } };
    if (!res.ok) {
      setActionError(data.error || "Failed to claim");
      return;
    }
    setClaimed(true);
    if (data.claim?.expires_at) setExpiresAt(data.claim.expires_at);
  }

  async function handleRelease(tuId: number) {
    if (!window.confirm("Release this claim? The listings will become available to other users again.")) return;
    setActionError(null);
    const res = await fetch(MY_TRADE_UPS_API.unclaim(tuId), { method: "DELETE", credentials: "include" });
    if (!res.ok) {
      setActionError(await readError(res, "Failed to release"));
      return;
    }
    setClaimed(false);
    setExpiresAt(null);
    setConfirmMode(false);
  }

  async function handleConfirm(current: TradeUp) {
    const listingIds = [...confirmSelected];
    const total = realListingIds(current).length;
    if (listingIds.length === 0) {
      setActionError("Select at least one listing");
      return;
    }
    if (!window.confirm(confirmPurchaseCopy(listingIds.length, total))) return;
    setActionError(null);
    const res = await fetch(MY_TRADE_UPS_API.confirm(current.id), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ listing_ids: listingIds }),
    });
    if (!res.ok) {
      setActionError(await readError(res, "Failed to confirm"));
      return;
    }
    setClaimed(false);
    setConfirmMode(false);
    setExpiresAt(null);
  }

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
  const isBasicPlus = user?.tier === "pro" || user?.tier === "admin" || !!user?.is_admin;
  const missingCount = Math.max(0, Number(tu.missing_count ?? tu.missing_inputs ?? 0));
  const realInputCount = tu.inputs.filter(i => !i.listing_id.startsWith("theor")).length || tu.inputs.length;
  const displayStatus = (() => {
    const status = tu.listing_status ?? "active";
    if (status !== "active") return status;
    if (missingCount <= 0) return "active";
    if (realInputCount > 0 && missingCount >= realInputCount) return "stale";
    return "partial";
  })();
  const displayTu: TradeUp = {
    ...tu,
    listing_status: displayStatus,
    missing_inputs: missingCount,
    missing_count: missingCount,
  };

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
              <StatCard label="Cost" value={formatPrice(tu.total_cost_cents)} />
              <StatCard
                label="Profit"
                value={formatPrice(tu.profit_cents)}
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
                <span>EV: <span className="text-foreground">{formatPrice(tu.expected_value_cents)}</span></span>
                <span>Best: <span className="text-green-500">{formatPrice(tu.best_case_cents ?? 0)}</span></span>
                <span>Worst: <span className={(tu.worst_case_cents ?? 0) < 0 ? "text-red-400" : "text-foreground"}>{formatPrice(tu.worst_case_cents ?? 0)}</span></span>
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
          {isAuthenticated && isBasicPlus && (
            <div className="flex items-center justify-between gap-2 px-4 py-3 mb-4 bg-muted/30 border border-border rounded-lg">
              <div className="text-[0.75rem] text-muted-foreground">
                {claimed
                  ? <span>You claimed this trade-up — confirm purchase or release</span>
                  : <span>Claim to lock listings for 30 min while you buy</span>}
                {actionError && <span className="ml-2 text-red-400">{actionError}</span>}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {claimed && expiresAt && <ShareClaimTimer expiresAt={expiresAt} />}
                {!claimed && (
                  <button
                    className="px-2.5 py-1 text-[0.7rem] font-semibold rounded bg-purple-950 text-purple-400 border border-purple-800 hover:bg-purple-900 cursor-pointer"
                    onClick={() => void handleClaim(tu.id)}
                  >
                    Claim
                  </button>
                )}
                {claimed && !confirmMode && (
                  <>
                    <button
                      className="px-2.5 py-1 text-[0.7rem] font-semibold rounded bg-green-950 text-green-400 border border-green-800 hover:bg-green-900 cursor-pointer"
                      onClick={() => {
                        setConfirmSelected(new Set(realListingIds(tu)));
                        setConfirmMode(true);
                      }}
                    >
                      Confirm Purchase
                    </button>
                    <button
                      className="px-2 py-1 text-[0.7rem] rounded border border-border text-muted-foreground hover:text-red-400 cursor-pointer"
                      onClick={() => void handleRelease(tu.id)}
                    >
                      Release
                    </button>
                  </>
                )}
                {claimed && confirmMode && (
                  <>
                    <span className="text-[0.7rem] text-muted-foreground">{confirmSelected.size} of {realListingIds(tu).length} selected</span>
                    <button
                      className="px-2.5 py-1 text-[0.7rem] font-semibold rounded bg-green-950 text-green-400 border border-green-800 hover:bg-green-900 cursor-pointer disabled:opacity-40"
                      disabled={confirmSelected.size === 0}
                      onClick={() => void handleConfirm(tu)}
                    >
                      {confirmSelected.size === realListingIds(tu).length ? "Confirm All" : `Confirm ${confirmSelected.size}`}
                    </button>
                    <button
                      className="px-2 py-1 text-[0.7rem] rounded border border-border text-muted-foreground cursor-pointer"
                      onClick={() => setConfirmMode(false)}
                    >
                      Cancel
                    </button>
                  </>
                )}
              </div>
            </div>
          )}

          {!isAuthenticated && (
            <div className="flex items-center justify-between px-4 py-3 mb-4 bg-muted/50 border border-border rounded-lg">
              <span className="text-sm text-muted-foreground">Sign in to verify, claim, and purchase listings</span>
              <a
                href={authHref(window.location.pathname)}
                onClick={() => trackEvent("sign_up_start", { location: "share_verify" })}
                rel="nofollow"
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-foreground text-background hover:bg-foreground/90 transition-all"
              >
                Sign in with Steam
              </a>
            </div>
          )}

          {/* Toast for unauthenticated listing link clicks */}
          {linkToast && (
            <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 bg-foreground text-background rounded-lg text-sm font-medium shadow-lg animate-in fade-in slide-in-from-bottom-4">
              <a href={authHref(window.location.pathname)} onClick={() => trackEvent("sign_up_start", { location: "share_toast" })} rel="nofollow" className="hover:underline">
                Sign in with Steam to view listing links
              </a>
            </div>
          )}

          {/* Trade-up content — same as expanded row in TradeUpTable */}
          <div className="border border-border rounded-lg overflow-hidden bg-card">
            <OutcomeChart tu={displayTu} />
            {((displayTu.peak_profit_cents ?? 0) > 0 || displayTu.listing_status !== "active") && (
              <VerifyResults tu={displayTu} />
            )}
            <div className="px-4 sm:px-5 py-4 flex flex-col gap-4">
              <InputList
                tu={displayTu}
                verifyResult={verifyResult?.inputs ? {
                  trade_up_id: verifyResult.trade_up_id ?? tu.id,
                  inputs: verifyResult.inputs,
                  all_active: verifyResult.all_active ?? false,
                  any_unavailable: verifyResult.any_unavailable ?? false,
                  any_price_changed: verifyResult.any_price_changed ?? false,
                } : undefined}
                verifying={verifying}
                onVerify={handleVerify}
                showListingLinks={isAuthenticated}
                showVerify={isBasicPlus}
                confirmMode={confirmMode}
                confirmSelected={confirmSelected}
                onConfirmToggle={(listingId) => {
                  setConfirmSelected((prev) => {
                    const next = new Set(prev);
                    if (next.has(listingId)) next.delete(listingId);
                    else next.add(listingId);
                    return next;
                  });
                }}
                onUnauthLinkClick={!isAuthenticated ? handleUnauthLinkClick : undefined}
              />
              <OutcomeList
                tu={displayTu}
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
                href={authHref("/trade-ups")}
                onClick={() => trackEvent("sign_up_start", { location: "share_bottom" })}
                rel="nofollow"
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
