import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { TradeUp } from "../../../shared/types.js";
import { TRADE_UP_TYPE_LABELS } from "../../../shared/types.js";
import { formatDollars } from "../../utils/format.js";
import { authHref } from "../../lib/ref.js";
import { trackEvent } from "../../lib/analytics.js";
import { PreviewSeo } from "../components/PreviewSeo.js";
import {
  MY_TRADE_UPS_API,
  claimTimerLabel,
  confirmPurchaseCopy,
  realListingIds,
  type ActiveClaimRow,
  type VerifyPayload,
} from "../lib/my-trade-ups.js";
import { TradeUpCard } from "./PreviewBoard.js";

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
  return <span className={`preview-timer ${tick.expired || tick.minutes <= 5 ? "is-minus" : ""}`}>{tick.label}</span>;
}

export function PreviewShare() {
  const { id } = useParams<{ id: string }>();
  const [tu, setTu] = useState<TradeUp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [copied, setCopied] = useState(false);
  const [claimed, setClaimed] = useState(false);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [confirmMode, setConfirmMode] = useState(false);
  const [confirmSelected, setConfirmSelected] = useState<Set<string>>(new Set());
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<VerifyPayload | undefined>(undefined);
  const [actionError, setActionError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  useEffect(() => {
    fetch("/api/auth/me", { credentials: "include" })
      .then((res) => res.ok ? res.json() : null)
      .then((data) => { if (data?.steam_id) setUser(data); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/trade-ups/${id}`)
      .then((res) => {
        if (!res.ok) throw new Error(res.status === 404 ? "Trade-up not found" : "Failed to load");
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        const outcomes = data.outcomes || (data.outcomes_json ? JSON.parse(data.outcomes_json) : []);
        const next: TradeUp = {
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
        };
        setTu(next);
        setExpandedId(next.id);
        trackEvent("tradeup_view", { tradeup_id: String(data.id) });
      })
      .catch((err: Error) => { if (!cancelled) setError(err.message); })
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

  const typeLabel = tu?.type ? (TRADE_UP_TYPE_LABELS[tu.type] || tu.type) : "Trade-up";
  const profit = tu ? (tu.profit_cents / 100).toFixed(2) : "0.00";
  const chance = tu ? Math.round((tu.chance_to_profit ?? 0) * 100) : 0;
  const roi = tu ? (tu.roi_percentage?.toFixed(1) ?? "0") : "0";
  const title = tu
    ? `${typeLabel} Trade-Up — $${profit} profit (${chance}% chance) | TradeUpBot`
    : "Trade-up | TradeUpBot";
  const h1 = tu
    ? `${typeLabel} Trade-Up — $${profit} Profit (${roi}% ROI)`
    : "Trade-up";
  const isAuthenticated = !!user;
  const isBasicPlus = user?.tier === "pro" || user?.tier === "admin" || !!user?.is_admin;
  const realIds = tu ? realListingIds(tu) : [];

  return (
    <div className="preview-page">
      <PreviewSeo
        title={title}
        description={tu ? `$${formatDollars(tu.total_cost_cents).slice(1)} cost, ${roi}% ROI. Found on TradeUpBot.` : "Trade-up detail on TradeUpBot."}
        canonical={id ? `https://tradeupbot.app/trade-ups/${id}` : "https://tradeupbot.app/trade-ups"}
      />
      <header className="preview-page__head">
        <div>
          <nav className="preview-crumb" aria-label="Breadcrumb">
            <Link className="preview-link" to="/trade-ups">Board</Link>
            <span aria-hidden>/</span>
            <span>{tu ? `#${tu.id}` : "Trade-up"}</span>
          </nav>
          <h1>{loading ? "Loading trade-up…" : error || !tu ? (error || "Trade-up not found") : h1}</h1>
          <p>Same verify, claim, confirm, and release flow as the live board. Expected value on the card is the probability-weighted output; Expected P/L is that value minus cost.</p>
        </div>
        {tu && (
          <div className="preview-page__meta">
            <span>{typeLabel}</span>
            <i />
            <button type="button" className="preview-btn preview-btn--quiet" onClick={() => {
              void navigator.clipboard.writeText(window.location.href);
              setCopied(true);
              window.setTimeout(() => setCopied(false), 2000);
            }}>
              {copied ? "Copied" : "Copy link"}
            </button>
          </div>
        )}
      </header>

      {loading && <p className="preview-note">Loading…</p>}
      {(error || (!loading && !tu)) && (
        <section className="preview-panel">
          <p className="preview-note">{error || "Trade-up not found"}</p>
          <Link className="preview-btn" to="/trade-ups">Back to the board</Link>
        </section>
      )}

      {tu && !isAuthenticated && (
        <section className="preview-panel">
          <p className="preview-note">Sign in to verify, claim, and purchase listings</p>
          <a
            className="preview-btn preview-btn--lime"
            href={authHref(window.location.pathname)}
            onClick={() => trackEvent("sign_up_start", { location: "share_verify" })}
            rel="nofollow"
          >
            Sign in with Steam
          </a>
        </section>
      )}

      {tu && isAuthenticated && isBasicPlus && (
        <section className="preview-panel">
          <header className="preview-panel__head">
            <p className="o-kicker">{claimed ? "Your claim" : "Claim"}</p>
            {claimed && expiresAt && <ShareClaimTimer expiresAt={expiresAt} />}
          </header>
          <p className="preview-note">
            {claimed
              ? "You claimed this trade-up — confirm purchase or release"
              : "Claim to lock listings for 30 min while you buy"}
          </p>
          {actionError && <p className="preview-note preview-note--loss">{actionError}</p>}
          <div className="preview-toolbar">
            <button type="button" className="preview-btn" disabled={verifying} onClick={() => void handleVerify(tu.id)}>
              {verifying ? "Verifying…" : "Verify"}
            </button>
            {!claimed && (
              <button type="button" className="preview-btn preview-btn--lime" onClick={() => void handleClaim(tu.id)}>
                Claim
              </button>
            )}
            {claimed && !confirmMode && (
              <>
                <button
                  type="button"
                  className="preview-btn preview-btn--lime"
                  onClick={() => {
                    setConfirmSelected(new Set(realIds));
                    setConfirmMode(true);
                  }}
                >
                  Confirm Purchase
                </button>
                <button type="button" className="preview-btn" onClick={() => void handleRelease(tu.id)}>
                  Release
                </button>
              </>
            )}
            {claimed && confirmMode && (
              <>
                <span className="preview-note">{confirmSelected.size} of {realIds.length} selected</span>
                <button
                  type="button"
                  className="preview-btn preview-btn--lime"
                  disabled={confirmSelected.size === 0}
                  onClick={() => void handleConfirm(tu)}
                >
                  {confirmSelected.size === realIds.length ? "Confirm All" : `Confirm ${confirmSelected.size}`}
                </button>
                <button type="button" className="preview-btn" onClick={() => setConfirmMode(false)}>Cancel</button>
              </>
            )}
          </div>
          {confirmMode && (
            <div className="preview-picks">
              {tu.inputs.filter((row) => realListingIds({ inputs: [row] }).length > 0).map((row) => (
                <label key={row.listing_id} className={`preview-pick ${confirmSelected.has(row.listing_id) ? "is-on" : ""}`}>
                  <input
                    type="checkbox"
                    checked={confirmSelected.has(row.listing_id)}
                    onChange={() => {
                      setConfirmSelected((prev) => {
                        const next = new Set(prev);
                        if (next.has(row.listing_id)) next.delete(row.listing_id);
                        else next.add(row.listing_id);
                        return next;
                      });
                    }}
                  />
                  <span className="preview-outcome__name">{row.skin_name}</span>
                  <span className="preview-chip">{row.condition}</span>
                  <span className="o-mono">{row.float_value.toFixed(4)}</span>
                  <span className="o-mono">{formatDollars(row.price_cents)}</span>
                </label>
              ))}
            </div>
          )}
          {verifyResult?.inputs && (
            <div className="preview-verify">
              <p className="o-kicker">Verify</p>
              {verifyResult.inputs.map((row) => (
                <div key={row.listing_id} className="preview-pick">
                  <span className="preview-chip">{row.status}</span>
                  <span className="preview-outcome__name">{row.skin_name}</span>
                  <span className="o-mono">{formatDollars(row.original_price)}</span>
                  {row.price_changed && row.current_price != null && (
                    <span className="o-mono">{formatDollars(row.current_price)}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {tu && (
        <TradeUpCard tu={tu} expanded={expandedId === tu.id} onExpand={setExpandedId} />
      )}
    </div>
  );
}
