import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TradeUp } from "../../../shared/types.js";
import { collectPreviewSkinNames } from "../../../shared/preview-board.js";
import { useSkinImages } from "../../hooks/useSkinImages.js";
import { PreviewContractCard } from "./PreviewContractCard.js";
import { PreviewInspectDrawer } from "./PreviewInspectDrawer.js";

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
  }[];
  all_active: boolean;
  any_unavailable: boolean;
  any_price_changed: boolean;
}

interface Props {
  tradeUps: TradeUp[];
  loading: boolean;
  tier: string;
  signedIn: boolean;
  claimLimit: RateLimitInfo | null;
  verifyLimit: RateLimitInfo | null;
  onClaimLimitUpdate: (limit: RateLimitInfo) => void;
  onVerifyLimitUpdate: (limit: RateLimitInfo) => void;
  inspectable?: boolean;
}

export function PreviewTradeUpBoard({
  tradeUps,
  loading,
  tier,
  signedIn,
  claimLimit,
  verifyLimit,
  onClaimLimitUpdate,
  onVerifyLimitUpdate,
  inspectable = true,
}: Props) {
  const isPro = tier === "pro" || tier === "admin";
  const [selectedId, setSelectedId] = useState<number | null>(null);
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
      setSelectedId(null);
    }
  }, [tradeUps, selectedId]);

  const handleSelect = useCallback(async (tuId: number) => {
    setSelectedId(current => (current === tuId ? null : tuId));
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
        }).catch(() => {}).finally(() => { inflightDetails.current.delete(outcomesKey); }),
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
        }).catch(() => {}).finally(() => { inflightDetails.current.delete(inputsKey); }),
      );
    }
    await Promise.all(promises);
  }, [loadedOutcomes, loadedInputs]);

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
    return {
      ...rawTu,
      inputs: loadedInputs.get(rawTu.id) ?? rawTu.inputs,
      outcomes: loadedOutcomes.get(rawTu.id) ?? rawTu.outcomes,
      ...(override ? {
        total_cost_cents: override.total_cost_cents,
        profit_cents: override.profit_cents,
        roi_percentage: override.roi_percentage,
      } : {}),
    };
  }), [tradeUps, priceOverrides, loadedInputs, loadedOutcomes]);

  const imageNames = useMemo(() => collectPreviewSkinNames(prepared), [prepared]);
  const images = useSkinImages(imageNames);

  return (
    <div className={`pv-board${loading ? " pv-faint" : ""}`}>
      <div className="pv-cards">
        {prepared.map(tu => (
          <PreviewContractCard
            key={tu.id}
            tu={tu}
            images={images}
            open={inspectable && tu.id === selectedId}
            onOpen={inspectable ? () => { void handleSelect(tu.id); } : undefined}
            details={inspectable && tu.id === selectedId ? (
              <PreviewInspectDrawer
                tu={tu}
                images={images}
                signedIn={signedIn}
                isPro={isPro}
                claimed={claimedIds.has(tu.id)}
                claimedByOther={!!tu.claimed_by_other && !claimedIds.has(tu.id)}
                claimExpiresAt={claimExpiries.get(tu.id)}
                claimLimit={claimLimit}
                verifyLimit={verifyLimit}
                verifying={verifying === tu.id}
                verifyResult={verifyResults.get(tu.id)}
                onVerify={() => { void handleVerify(tu.id); }}
                onAskUpgrade={() => setUpgradeMsg(tu.id)}
                onClaimed={(expiresAt) => {
                  setClaimedIds(prev => new Set(prev).add(tu.id));
                  if (expiresAt) setClaimExpiries(prev => new Map(prev).set(tu.id, expiresAt));
                }}
                onReleased={() => {
                  setClaimedIds(prev => {
                    const next = new Set(prev);
                    next.delete(tu.id);
                    return next;
                  });
                }}
                onClaimLimitUpdate={onClaimLimitUpdate}
              />
            ) : undefined}
          />
        ))}
      </div>
      {upgradeMsg != null && (
        <p className="pv-muted">Upgrade to Pro to claim listings while you buy.</p>
      )}
    </div>
  );
}
