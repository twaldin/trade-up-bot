import { useState } from "react";
import type { TradeUp } from "../../../shared/types.js";
import { useCurrency } from "../../contexts/CurrencyContext.js";
import { listingUrl, sourceLabel } from "../../utils/format.js";
import { authHref } from "../../lib/ref.js";
import { trackEvent } from "../../lib/analytics.js";
import { OutcomeChart } from "../../components/trade-up/OutcomeChart.js";
import { chanceToProfit, groupInputSkins, uniqueOutcomes } from "../../../shared/preview-board.js";
import { SkinRender } from "../images/SkinRender.js";
import { PreviewModal } from "../chrome/PreviewModal.js";
import { PreviewOddsChart } from "./PreviewOddsChart.js";

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
  const inputs = groupInputSkins(tu);
  const outputs = uniqueOutcomes(tu.outcomes);
  const chance = chanceToProfit(tu);
  const atLimit = claimLimit && claimLimit.remaining <= 0;

  return (
    <aside className="pv-inspect">
      <div className="pv-inspect-head">
        <div className="pv-kicker">Inspect · {tu.id}</div>
        <div className="pv-card-name">Contract</div>
      </div>

      <dl className="pv-statrow">
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

      <div className="pv-inspect-block">
        <div className="pv-kicker">Inputs</div>
        <div className="pv-grouped">
          {inputs.map(skin => (
            <div key={skin.name} className="pv-grouped-item">
              <div className="pv-thumb">
                <SkinRender name={skin.name} url={images.get(skin.name)} />
              </div>
              <div className="pv-grouped-meta">
                <div className="pv-grouped-name">{skin.name}</div>
                <div className="pv-tabular pv-muted">×{skin.count}</div>
              </div>
            </div>
          ))}
        </div>
        <div className="pv-listing-links">
          {tu.inputs.map(input => (
            <a
              key={input.listing_id}
              href={listingUrl(input.listing_id, input.skin_name, input.condition, input.float_value, input.price_cents, input.source, input.marketplace_id, input.stattrak)}
              target="_blank"
              rel="noopener noreferrer"
            >
              <span>{input.skin_name}</span>
              <span className="pv-muted">{sourceLabel(input.source)} · {formatPrice(input.price_cents)}</span>
            </a>
          ))}
        </div>
      </div>

      <div className="pv-inspect-block">
        <div className="pv-kicker">Outputs</div>
        {outputs.length === 0 ? (
          <p className="pv-muted pv-face-missing">Outcome faces not loaded for this contract.</p>
        ) : (
          <div className="pv-grouped">
            {outputs.map(outcome => (
              <div key={outcome.skin_id + outcome.skin_name} className="pv-grouped-item">
                <div className="pv-thumb">
                  <SkinRender name={outcome.skin_name} url={images.get(outcome.skin_name)} />
                </div>
                <div className="pv-grouped-meta">
                  <div className="pv-grouped-name">{outcome.skin_name}</div>
                  <div className="pv-tabular pv-muted">{(outcome.probability * 100).toFixed(0)}% · {formatPrice(outcome.estimated_price_cents)}</div>
                </div>
              </div>
            ))}
          </div>
        )}
        <PreviewOddsChart tu={tu} />
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
            Pro users can claim a trade-up for 30 minutes, hiding its listings from other TradeUpBot users while they buy.
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
