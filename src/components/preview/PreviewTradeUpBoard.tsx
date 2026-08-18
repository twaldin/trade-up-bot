import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TradeUp } from "../../../shared/types.js";
import { TRADE_UP_TYPE_LABELS } from "../../../shared/types.js";
import { useCurrency } from "../../contexts/CurrencyContext.js";
import { OutcomeChart } from "../trade-up/OutcomeChart.js";
import { InputList } from "../trade-up/InputList.js";
import { OutcomeList } from "../trade-up/OutcomeList.js";
import { VerifyResults } from "../trade-up/VerifyResults.js";
import { trackEvent } from "../../lib/analytics.js";
import { authHref } from "../../lib/ref.js";
import { collectSkinNames, distinctiveSkinNames, isUsableImageUrl } from "../../utils/skin-image.js";
import { useSkinImages } from "../../hooks/useSkinImages.js";

interface RateLimitInfo {
  remaining: number;
  total: number;
  resetIn: number | null;
}

interface VerifyResult {
  trade_up_id: number;
  inputs: {
    listing_id: string;
    skin_name: string;
    status: "active" | "sold" | "delisted" | "theoretical" | "error";
    current_price?: number;
    original_price: number;
    price_changed?: boolean;
    sold_at?: string;
  }[];
  all_active: boolean;
  any_unavailable: boolean;
  any_price_changed: boolean;
}

interface Props {
  tradeUps: TradeUp[];
  total: number;
  totalProfitable: number;
  page: number;
  perPage: number;
  loading: boolean;
  tier: string;
  signedIn: boolean;
  claimLimit: RateLimitInfo | null;
  verifyLimit: RateLimitInfo | null;
  onClaimLimitUpdate: (limit: RateLimitInfo) => void;
  onVerifyLimitUpdate: (limit: RateLimitInfo) => void;
  onNavigateSkin: (skinName: string) => void;
  onNavigateCollection: (name: string) => void;
}

function verdictClass(cents: number): string {
  if (cents > 0) return "text-green-500";
  if (cents < 0) return "text-red-500";
  return "text-neutral-400";
}

function chanceToProfit(tu: TradeUp): number {
  if (tu.chance_to_profit !== undefined) return tu.chance_to_profit;
  return tu.outcomes.reduce((sum, o) =>
    sum + (o.estimated_price_cents > tu.total_cost_cents ? o.probability : 0), 0);
}

function getMissingCount(tu: TradeUp): number {
  return Math.max(0, Number(tu.missing_count ?? tu.missing_inputs ?? 0));
}

function SkinThumb({ name, url }: { name: string; url: string | null | undefined }) {
  if (isUsableImageUrl(url)) {
    return (
      <img
        src={url}
        alt={name}
        title={name}
        width={40}
        height={40}
        className="h-10 w-10 object-contain bg-transparent"
      />
    );
  }
  return (
    <span
      className="inline-block h-10 w-10 border border-white/15 rounded-[2px] bg-transparent"
      title={name}
      aria-label="No skin image"
    />
  );
}

function PreviewKpiStrip({
  found,
  profitable,
  page,
  totalPages,
  showing,
}: {
  found: number;
  profitable: number;
  page: number;
  totalPages: number;
  showing: number;
}) {
  const items = [
    { label: "Found", value: found >= 10001 ? "10,000+" : found.toLocaleString() },
    { label: "Profitable", value: profitable.toLocaleString() },
    { label: "Page", value: totalPages > 0 ? `${page} / ${totalPages}` : "—" },
    { label: "On page", value: showing.toLocaleString() },
  ];
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 border border-white/15 rounded-[2px]">
      {items.map((item, i) => (
        <div
          key={item.label}
          className={`px-3 py-2 ${i > 0 ? "md:border-l border-white/15" : ""} ${i % 2 === 1 ? "border-l border-white/15 md:border-l" : ""} ${i > 1 ? "border-t md:border-t-0 border-white/15" : ""}`}
        >
          <div className="text-[10px] uppercase tracking-wide text-neutral-500">{item.label}</div>
          <div className="text-lg font-semibold tabular-nums text-white">{item.value}</div>
        </div>
      ))}
    </div>
  );
}

export function PreviewTradeUpBoard({
  tradeUps,
  total,
  totalProfitable,
  page,
  perPage,
  loading,
  tier,
  signedIn,
  claimLimit,
  verifyLimit,
  onClaimLimitUpdate,
  onVerifyLimitUpdate,
  onNavigateSkin,
  onNavigateCollection,
}: Props) {
  const { formatPrice } = useCurrency();
  const isPro = tier === "pro" || tier === "admin";
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [priceDetailKey, setPriceDetailKey] = useState<string | null>(null);
  const [verifying, setVerifying] = useState<number | null>(null);
  const [verifyResults, setVerifyResults] = useState<Map<number, VerifyResult>>(new Map());
  const [priceOverrides, setPriceOverrides] = useState<Map<number, { total_cost_cents: number; profit_cents: number; roi_percentage: number }>>(new Map());
  const [claimedIds, setClaimedIds] = useState<Set<number>>(() => {
    const ids = new Set<number>();
    for (const tu of tradeUps) if (tu.claimed_by_me) ids.add(tu.id);
    return ids;
  });
  const [claimExpiries, setClaimExpiries] = useState<Map<number, string>>(() => {
    const map = new Map<number, string>();
    for (const tu of tradeUps) if (tu.claim_expires_at) map.set(tu.id, tu.claim_expires_at);
    return map;
  });
  const [upgradeMsg, setUpgradeMsg] = useState<number | null>(null);
  const [loadedOutcomes, setLoadedOutcomes] = useState<Map<number, TradeUp["outcomes"]>>(new Map());
  const [loadedInputs, setLoadedInputs] = useState<Map<number, TradeUp["inputs"]>>(new Map());
  const inflightDetails = useRef(new Set<string>());

  useEffect(() => {
    const ids = new Set<number>();
    const expiries = new Map<number, string>();
    for (const tu of tradeUps) {
      if (tu.claimed_by_me) ids.add(tu.id);
      if (tu.claim_expires_at) expiries.set(tu.id, tu.claim_expires_at);
    }
    setClaimedIds(ids);
    setClaimExpiries(prev => {
      const merged = new Map(prev);
      for (const [id, exp] of expiries) merged.set(id, exp);
      return merged;
    });
    if (selectedId != null && !tradeUps.some(tu => tu.id === selectedId)) {
      setSelectedId(tradeUps[0]?.id ?? null);
    } else if (selectedId == null && tradeUps[0]) {
      setSelectedId(tradeUps[0].id);
    }
  }, [tradeUps, selectedId]);

  const handleSelect = useCallback(async (tuId: number) => {
    setSelectedId(tuId);
    trackEvent("tradeup_view", { tradeup_id: String(tuId), location: "preview_list" });
    const promises: Promise<void>[] = [];
    const outcomesKey = `o:${tuId}`;
    if (!loadedOutcomes.has(tuId) && !inflightDetails.current.has(outcomesKey)) {
      inflightDetails.current.add(outcomesKey);
      promises.push(
        fetch(`/api/trade-up/${tuId}/outcomes`).then(async res => {
          if (res.ok) {
            const data = await res.json();
            setLoadedOutcomes(prev => new Map(prev).set(tuId, data.outcomes || []));
          }
        }).catch(() => {}).finally(() => { inflightDetails.current.delete(outcomesKey); })
      );
    }
    const inputsKey = `i:${tuId}`;
    if (!loadedInputs.has(tuId) && !inflightDetails.current.has(inputsKey)) {
      inflightDetails.current.add(inputsKey);
      promises.push(
        fetch(`/api/trade-up/${tuId}/inputs`).then(async res => {
          if (res.ok) {
            const data = await res.json();
            setLoadedInputs(prev => new Map(prev).set(tuId, data.inputs || []));
          }
        }).catch(() => {}).finally(() => { inflightDetails.current.delete(inputsKey); })
      );
    }
    await Promise.all(promises);
  }, [loadedOutcomes, loadedInputs]);

  useEffect(() => {
    if (selectedId != null && tradeUps.some(tu => tu.id === selectedId)) {
      void handleSelect(selectedId);
    }
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleVerify = useCallback(async (tuId: number) => {
    setVerifying(tuId);
    try {
      const res = await fetch(`/api/verify-trade-up/${tuId}`, { method: "POST", credentials: "include" });
      const data = await res.json();
      if (data.rate_limit) onVerifyLimitUpdate(data.rate_limit);
      if (res.status === 429) {
        alert(data.error);
        return;
      }
      if (res.ok) {
        setVerifyResults(prev => new Map(prev).set(tuId, data));
        if (data.updated_trade_up) {
          setPriceOverrides(prev => new Map(prev).set(tuId, {
            total_cost_cents: data.updated_trade_up.total_cost_cents,
            profit_cents: data.updated_trade_up.profit_cents,
            roi_percentage: data.updated_trade_up.roi_percentage,
          }));
        }
      }
    } catch { /* network error */ }
    finally { setVerifying(null); }
  }, [onVerifyLimitUpdate]);

  const prepared = useMemo(() => tradeUps.map(rawTu => {
    const override = priceOverrides.get(rawTu.id);
    const tu = {
      ...rawTu,
      inputs: loadedInputs.get(rawTu.id) ?? rawTu.inputs,
      outcomes: loadedOutcomes.get(rawTu.id) ?? rawTu.outcomes,
      ...(override ? { total_cost_cents: override.total_cost_cents, profit_cents: override.profit_cents, roi_percentage: override.roi_percentage } : {}),
    };
    return tu;
  }), [tradeUps, priceOverrides, loadedInputs, loadedOutcomes]);

  const imageNames = useMemo(() => collectSkinNames(prepared), [prepared]);
  const images = useSkinImages(imageNames);
  const selected = prepared.find(tu => tu.id === selectedId) ?? null;
  const totalPages = Math.ceil(total / perPage);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        document.querySelector<HTMLInputElement>("[data-preview-trade-ups] input")?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-end">
          <button
            type="button"
            className="inline-flex items-center gap-1.5 h-8 px-2 text-[11px] text-neutral-400 border border-white/15 rounded-[2px] hover:text-white"
            onClick={() => document.querySelector<HTMLInputElement>("[data-preview-trade-ups] input")?.focus()}
          >
            Filters
            <kbd className="border border-white/20 px-1 py-px rounded-[2px] text-[10px]">⌘K</kbd>
          </button>
        </div>
        <PreviewKpiStrip
          found={total}
          profitable={totalProfitable}
          page={page}
          totalPages={totalPages}
          showing={tradeUps.length}
        />
      </div>

      <div className={`flex flex-col lg:flex-row border border-white/15 rounded-[2px] ${loading ? "opacity-50 pointer-events-none" : ""}`}>
        <div className="lg:w-[42%] lg:border-r border-white/15 max-h-[28rem] lg:max-h-[min(70vh,44rem)] overflow-y-auto">
          {prepared.map(tu => {
            const rail = distinctiveSkinNames(tu);
            const selectedRow = tu.id === selectedId;
            const missing = getMissingCount(tu);
            const stale = (tu.listing_status === "stale") || (tu.listing_status === "active" && missing > 0 && missing >= (tu.input_summary?.input_count ?? tu.inputs.length));
            const leftRule = stale ? "border-l-red-500" : selectedRow ? "border-l-white/70" : "border-l-transparent";
            const summary = tu.input_summary?.skins ?? [];
            const label = summary.length
              ? summary.map(s => `${s.count}× ${s.name}`).join(" · ")
              : (TRADE_UP_TYPE_LABELS[tu.type ?? ""] ?? tu.type ?? "Contract");
            return (
              <button
                key={tu.id}
                type="button"
                onClick={() => { void handleSelect(tu.id); }}
                className={`w-full h-10 px-2 flex items-center gap-2 border-b border-white/10 border-l-2 ${leftRule} text-left cursor-pointer ${selectedRow ? "bg-white/6" : "hover:bg-white/3"}`}
              >
                <span className="flex items-center gap-0.5 shrink-0">
                  {rail.map(name => (
                    <SkinThumb key={name} name={name} url={images.get(name)} />
                  ))}
                </span>
                <span className="min-w-0 flex-1 truncate text-[12px] text-neutral-300">{label}</span>
                <span className={`shrink-0 text-[12px] font-semibold tabular-nums ${verdictClass(tu.profit_cents)}`}>
                  {formatPrice(tu.profit_cents)}
                </span>
                <span className={`hidden sm:inline shrink-0 text-[11px] tabular-nums ${verdictClass(tu.roi_percentage)}`}>
                  {tu.roi_percentage.toFixed(1)}%
                </span>
                <span className="hidden md:inline shrink-0 text-[11px] tabular-nums text-neutral-500">
                  {(chanceToProfit(tu) * 100).toFixed(0)}%
                </span>
                <span className="hidden lg:inline shrink-0 text-[11px] tabular-nums text-neutral-500">
                  {formatPrice(tu.total_cost_cents)}
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex-1 min-w-0 bg-black">
          {selected ? (
            <PreviewInspectPane
              tu={selected}
              signedIn={signedIn}
              isPro={isPro}
              claimed={claimedIds.has(selected.id)}
              claimedByOther={!!selected.claimed_by_other && !claimedIds.has(selected.id)}
              claimExpiresAt={claimExpiries.get(selected.id)}
              showUpgrade={upgradeMsg === selected.id}
              claimLimit={claimLimit}
              verifyLimit={verifyLimit}
              verifying={verifying === selected.id}
              verifyResult={verifyResults.get(selected.id)}
              priceDetailKey={priceDetailKey}
              onTogglePriceDetail={setPriceDetailKey}
              onVerify={() => { void handleVerify(selected.id); }}
              onNavigateSkin={onNavigateSkin}
              onNavigateCollection={onNavigateCollection}
              onAskUpgrade={() => setUpgradeMsg(selected.id)}
              onClaimed={(expiresAt) => {
                setClaimedIds(prev => new Set(prev).add(selected.id));
                if (expiresAt) setClaimExpiries(prev => new Map(prev).set(selected.id, expiresAt));
              }}
              onReleased={() => {
                setClaimedIds(prev => {
                  const next = new Set(prev);
                  next.delete(selected.id);
                  return next;
                });
              }}
              onClaimLimitUpdate={onClaimLimitUpdate}
            />
          ) : (
            <div className="px-4 py-10 text-sm text-neutral-500">Pick a contract to inspect inputs, outcomes, verify, and claim.</div>
          )}
        </div>
      </div>
    </div>
  );
}

function PreviewInspectPane({
  tu,
  signedIn,
  isPro,
  claimed,
  claimedByOther,
  claimExpiresAt,
  showUpgrade,
  claimLimit,
  verifyLimit,
  verifying,
  verifyResult,
  priceDetailKey,
  onTogglePriceDetail,
  onVerify,
  onNavigateSkin,
  onAskUpgrade,
  onClaimed,
  onReleased,
  onClaimLimitUpdate,
}: {
  tu: TradeUp;
  signedIn: boolean;
  isPro: boolean;
  claimed: boolean;
  claimedByOther: boolean;
  claimExpiresAt?: string;
  showUpgrade: boolean;
  claimLimit: RateLimitInfo | null;
  verifyLimit: RateLimitInfo | null;
  verifying: boolean;
  verifyResult?: VerifyResult;
  priceDetailKey: string | null;
  onTogglePriceDetail: (key: string | null) => void;
  onVerify: () => void;
  onNavigateSkin: (skinName: string) => void;
  onNavigateCollection: (name: string) => void;
  onAskUpgrade: () => void;
  onClaimed: (expiresAt?: string) => void;
  onReleased: () => void;
  onClaimLimitUpdate: (limit: RateLimitInfo) => void;
}) {
  const [claimLoading, setClaimLoading] = useState(false);
  const missingCount = getMissingCount(tu);
  const realInputCount = tu.inputs.filter(i => !i.listing_id.startsWith("theor")).length || tu.input_summary?.input_count || tu.inputs.length;
  const displayStatus: TradeUp["listing_status"] = (() => {
    const status = tu.listing_status ?? "active";
    if (status !== "active") return status;
    if (missingCount <= 0) return "active";
    if (realInputCount > 0 && missingCount >= realInputCount) return "stale";
    return "partial";
  })();
  const displayTu = {
    ...tu,
    listing_status: displayStatus,
    missing_inputs: missingCount,
    missing_count: missingCount,
  };
  const atLimit = claimLimit && claimLimit.remaining <= 0;
  const resetMin = claimLimit?.resetIn ? Math.ceil(claimLimit.resetIn / 60) : null;

  return (
    <div className="bg-black">
      {!signedIn && (
        <div className="flex items-center justify-between gap-3 px-3 py-2 border-b border-white/10 text-xs text-neutral-300">
          <span>Claim these listings before someone else does.</span>
          <a
            href={authHref(typeof window !== "undefined" ? window.location.pathname : "/preview/trade-ups")}
            rel="nofollow"
            onClick={() => trackEvent("sign_up_start", { location: "preview_inspect" })}
            className="font-medium text-white whitespace-nowrap"
          >
            Sign in with Steam →
          </a>
        </div>
      )}

      {tu.profit_cents > 0 && (
        <div className="px-3 py-2 border-b border-white/10">
          {showUpgrade && (
            <div className="flex items-center justify-between mb-1.5 px-3 py-2 border border-white/15 rounded-[2px] text-[0.75rem] text-neutral-200">
              <span>Upgrade to Pro to claim trade-ups and lock listings while you buy</span>
              <button
                className="text-white font-medium cursor-pointer whitespace-nowrap ml-3"
                onClick={async () => {
                  const r = await fetch("/api/subscribe", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ plan: "pro" }) });
                  const d = await r.json();
                  if (d.url) window.location.href = d.url;
                }}
              >
                Upgrade →
              </button>
            </div>
          )}
          <div className="flex items-center justify-between gap-2">
            <div className="text-[0.75rem] text-neutral-500">
              {claimed
                ? <span className="text-neutral-200">You claimed this trade-up — confirm or release to keep data fresh</span>
                : claimedByOther
                  ? <span>Claimed by another user</span>
                  : <span>Claim to lock listings for 30 min while you buy</span>}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {!claimed && !claimedByOther && (
                isPro
                  ? (
                    <button
                      disabled={claimLoading || !!atLimit}
                      className="px-2 py-1 text-[0.7rem] font-semibold rounded-[2px] border border-white/20 text-white hover:bg-white/5 cursor-pointer disabled:opacity-50"
                      onClick={async () => {
                        setClaimLoading(true);
                        try {
                          const res = await fetch(`/api/trade-ups/${tu.id}/claim`, { method: "POST", credentials: "include" });
                          const data = await res.json();
                          if (data.rate_limit) onClaimLimitUpdate(data.rate_limit);
                          if (data.error) alert(data.error);
                          else onClaimed(data.claim?.expires_at);
                        } catch {
                          alert("Failed to claim");
                        } finally {
                          setClaimLoading(false);
                        }
                      }}
                    >
                      {claimLoading ? "..." : atLimit ? `Limit (${resetMin}m)` : `Claim${claimLimit ? ` (${claimLimit.remaining}/${claimLimit.total})` : ""}`}
                    </button>
                  )
                  : (
                    <button
                      className="px-2 py-1 text-[0.7rem] font-semibold rounded-[2px] border border-white/20 text-white hover:bg-white/5 cursor-pointer"
                      onClick={onAskUpgrade}
                    >
                      Claim
                    </button>
                  )
              )}
              {claimed && (
                <>
                  {claimExpiresAt && <span className="text-[0.65rem] text-neutral-500">{claimExpiresAt}</span>}
                  <button
                    className="px-2 py-1 text-[0.7rem] rounded-[2px] border border-white/15 text-neutral-400 hover:text-red-400 cursor-pointer"
                    onClick={async () => {
                      if (!confirm("Release this claim? The listings will become available to other users again.")) return;
                      const res = await fetch(`/api/trade-ups/${tu.id}/claim`, { method: "DELETE", credentials: "include" });
                      if (res.ok) onReleased();
                    }}
                  >
                    Release
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      <OutcomeChart tu={displayTu} />
      {((displayTu.peak_profit_cents ?? 0) > 0 || displayTu.listing_status !== "active") && (
        <VerifyResults tu={displayTu} />
      )}
      <div className="px-4 sm:px-5 py-4 flex flex-col gap-4">
        <InputList
          tu={displayTu}
          verifyResult={verifyResult}
          verifying={verifying}
          onVerify={() => onVerify()}
          onNavigateSkin={onNavigateSkin}
          showListingLinks={true}
          showVerify={isPro}
          verifyLimit={verifyLimit}
        />
        <OutcomeList
          tu={displayTu}
          priceDetailKey={priceDetailKey}
          onTogglePriceDetail={onTogglePriceDetail}
          onNavigateSkin={onNavigateSkin}
        />
      </div>
    </div>
  );
}
