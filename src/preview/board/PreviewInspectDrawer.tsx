import { useState } from "react";
import type { TradeUp } from "../../../shared/types.js";
import { useCurrency } from "../../contexts/CurrencyContext.js";
import { listingUrl, sourceLabel } from "../../utils/format.js";
import { authHref } from "../../lib/ref.js";
import { trackEvent } from "../../lib/analytics.js";
import { OutcomeChart } from "../../components/trade-up/OutcomeChart.js";
import { expandInputSlots, pickHeroOutcome } from "../../../shared/preview-board.js";
import { SkinRender } from "../images/SkinRender.js";
import { PreviewModal } from "../chrome/PreviewModal.js";

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
}

export function PreviewInspectDrawer({
  tu,
  images,
  signedIn,
  isPro,
  claimed,
  claimedByOther,
  claimExpiresAt,
  claimLimit,
  verifyLimit,
  verifying,
  verifyResult,
  onVerify,
  onClaimed,
  onReleased,
  onClaimLimitUpdate,
  onAskUpgrade,
}: {
  tu: TradeUp;
  images: Map<string, string | null>;
  signedIn: boolean;
  isPro: boolean;
  claimed: boolean;
  claimedByOther: boolean;
  claimExpiresAt?: string;
  claimLimit: RateLimitInfo | null;
  verifyLimit: RateLimitInfo | null;
  verifying: boolean;
  verifyResult?: VerifyResult;
  onVerify: () => void;
  onClaimed: (expiresAt?: string) => void;
  onReleased: () => void;
  onClaimLimitUpdate: (limit: RateLimitInfo) => void;
  onAskUpgrade: () => void;
}) {
  const { formatPrice } = useCurrency();
  const [signInOpen, setSignInOpen] = useState(false);
  const [claimLoading, setClaimLoading] = useState(false);
  const hero = pickHeroOutcome(tu.outcomes);
  const slots = expandInputSlots(tu);
  const chance = tu.chance_to_profit ?? tu.outcomes.reduce((sum, o) =>
    sum + (o.estimated_price_cents > tu.total_cost_cents ? o.probability : 0), 0);
  const atLimit = claimLimit && claimLimit.remaining <= 0;

  return (
    <aside className="pv-inspect">
      <div style={{ padding: 14, borderBottom: "1px solid #262626" }}>
        <div className="pv-kicker">Inspect · {tu.id}</div>
        <div className="pv-card-name" style={{ marginTop: 8 }}>{hero?.skin_name ?? "Contract"}</div>
      </div>

      <div className="pv-hero-skin" style={{ height: 140 }}>
        <SkinRender name={hero?.skin_name ?? "Output"} url={hero ? images.get(hero.skin_name) : null} />
      </div>

      <dl className="pv-statrow" style={{ padding: 14 }}>
        <div><dt>Cost</dt><dd className="pv-tabular">{formatPrice(tu.total_cost_cents)}</dd></div>
        <div><dt>EV</dt><dd className="pv-tabular">{formatPrice(tu.expected_value_cents)}</dd></div>
        <div>
          <dt>Profit</dt>
          <dd className={`pv-tabular ${tu.profit_cents > 0 ? "pv-profit" : tu.profit_cents < 0 ? "pv-loss" : ""}`}>
            {formatPrice(tu.profit_cents)}
          </dd>
        </div>
        <div><dt>Chance</dt><dd className="pv-tabular">{(chance * 100).toFixed(0)}%</dd></div>
      </dl>

      <div style={{ padding: "0 14px 14px" }}>
        <div className="pv-kicker" style={{ marginBottom: 8 }}>Inputs</div>
        <div className="pv-slots">
          {slots.map((name, i) => (
            <div key={`${name}-${i}`} className="pv-slot">
              <SkinRender name={name} url={name ? images.get(name) : null} />
            </div>
          ))}
        </div>
        <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
          {tu.inputs.map(input => (
            <a
              key={input.listing_id}
              href={listingUrl(input.listing_id, input.skin_name, input.condition, input.float_value, input.price_cents, input.source, input.marketplace_id, input.stattrak)}
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontSize: 12, display: "flex", justifyContent: "space-between", gap: 8 }}
            >
              <span>{input.skin_name}</span>
              <span className="pv-muted">{sourceLabel(input.source)} · {formatPrice(input.price_cents)}</span>
            </a>
          ))}
        </div>
      </div>

      <div style={{ padding: "0 14px 14px" }}>
        <div className="pv-kicker" style={{ marginBottom: 8 }}>Outcomes</div>
        <div className="pv-prob" aria-label="Outcome probabilities">
          {tu.outcomes.map(o => (
            <span
              key={o.skin_id + o.skin_name}
              className={o.estimated_price_cents > tu.total_cost_cents ? "pv-win" : "pv-lose"}
              style={{ width: `${Math.max(2, o.probability * 100)}%` }}
              title={`${o.skin_name} ${(o.probability * 100).toFixed(1)}%`}
            />
          ))}
        </div>
        <div className="pv-outcome-grid" style={{ marginTop: 10 }}>
          {tu.outcomes.map(o => (
            <div key={o.skin_id + o.skin_name} className="pv-rule" style={{ padding: 8 }}>
              <div className="pv-slot" style={{ aspectRatio: "4/3" }}>
                <SkinRender name={o.skin_name} url={images.get(o.skin_name)} />
              </div>
              <div style={{ fontSize: 11, marginTop: 6 }}>{o.skin_name}</div>
              <div className="pv-muted pv-tabular" style={{ fontSize: 11 }}>
                {(o.probability * 100).toFixed(0)}% · {formatPrice(o.estimated_price_cents)}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ padding: 14, borderTop: "1px solid #262626", display: "flex", gap: 8, flexWrap: "wrap" }}>
        {!signedIn ? (
          <button type="button" className="pv-btn" onClick={() => setSignInOpen(true)}>Sign in to claim</button>
        ) : tu.profit_cents > 0 && !claimed && !claimedByOther ? (
          <button
            type="button"
            className="pv-btn"
            disabled={claimLoading || !!atLimit}
            onClick={async () => {
              if (!isPro) { onAskUpgrade(); return; }
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
            {claimLoading ? "…" : atLimit ? "Limit" : `Claim${claimLimit ? ` (${claimLimit.remaining}/${claimLimit.total})` : ""}`}
          </button>
        ) : null}
        {claimed && (
          <button
            type="button"
            className="pv-btn pv-btn-ghost"
            onClick={async () => {
              const res = await fetch(`/api/trade-ups/${tu.id}/claim`, { method: "DELETE", credentials: "include" });
              if (res.ok) onReleased();
            }}
          >
            Release{claimExpiresAt ? "" : ""}
          </button>
        )}
        {isPro && (
          <button type="button" className="pv-btn pv-btn-ghost" disabled={verifying} onClick={onVerify}>
            {verifying ? "Verifying…" : `Verify${verifyLimit ? ` (${verifyLimit.remaining})` : ""}`}
          </button>
        )}
      </div>
      {verifyResult && (
        <div style={{ padding: "0 14px 14px", fontSize: 12 }} className={verifyResult.all_active ? "pv-profit" : "pv-loss"}>
          {verifyResult.all_active ? "All listings active" : "Some listings moved"}
        </div>
      )}

      <details className="pv-disclose">
        <summary>Distribution</summary>
        <OutcomeChart tu={tu} />
      </details>

      {signInOpen && (
        <PreviewModal title="Sign in with Steam" onClose={() => setSignInOpen(false)}>
          <p className="pv-muted" style={{ fontSize: 13, lineHeight: 1.5 }}>
            Claim locks the ten listings for 30 minutes while you buy. Preview uses the same Steam auth as production.
          </p>
          <a
            href={authHref("/preview/trade-ups")}
            rel="nofollow"
            className="pv-btn"
            style={{ marginTop: 14 }}
            onClick={() => trackEvent("sign_up_start", { location: "preview_inspect_modal" })}
          >
            Continue with Steam
          </a>
        </PreviewModal>
      )}
    </aside>
  );
}
