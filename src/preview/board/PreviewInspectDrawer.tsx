import { useState } from "react";
import type { TradeUp } from "../../../shared/types.js";
import { useCurrency } from "../../contexts/CurrencyContext.js";
import { listingUrl, sourceLabel } from "../../utils/format.js";
import { authHref } from "../../lib/ref.js";
import { trackEvent } from "../../lib/analytics.js";
import { OutcomeChart } from "../../components/trade-up/OutcomeChart.js";
import { Button } from "../../../shared/components/ui/button.js";
import { chanceToProfit, groupInputSkins, rarityForTradeUpRole, uniqueOutcomes } from "../../../shared/preview-board.js";
import { PreviewSkinTile } from "../tiles/PreviewSkinTile.js";
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
  const inputRarity = rarityForTradeUpRole(tu.type, "input");
  const outputRarity = rarityForTradeUpRole(tu.type, "output");

  return (
    <div className="pv-card-details">
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
        <div className="pv-tile-row">
          {inputs.map(skin => (
            <PreviewSkinTile
              key={skin.name}
              name={skin.name}
              url={images.get(skin.name)}
              badge={`×${skin.count}`}
              rarity={inputRarity}
              size="in"
            />
          ))}
        </div>
        <div className="pv-listing-links">
          {tu.inputs.map(input => (
            <a
              key={input.listing_id}
              className="pv-listing-row"
              href={listingUrl(input.listing_id, input.skin_name, input.condition, input.float_value, input.price_cents, input.source, input.marketplace_id, input.stattrak)}
              target="_blank"
              rel="noopener noreferrer"
            >
              <span className="pv-src">{sourceLabel(input.source)}</span>
              <span>{input.skin_name}</span>
              <span className="pv-tabular">{formatPrice(input.price_cents)}</span>
            </a>
          ))}
        </div>
      </div>

      <div className="pv-inspect-block">
        <div className="pv-kicker">Outputs</div>
        {outputs.length === 0 ? (
          <p className="pv-muted pv-face-missing">Outcome faces not loaded for this contract.</p>
        ) : (
          <div className="pv-tile-row">
            {outputs.map(outcome => (
              <PreviewSkinTile
                key={outcome.skin_id + outcome.skin_name}
                name={outcome.skin_name}
                url={images.get(outcome.skin_name)}
                badge={`${(outcome.probability * 100).toFixed(0)}%`}
                rarity={outputRarity}
                size="out"
              />
            ))}
          </div>
        )}
        <PreviewOddsChart tu={tu} />
      </div>

      <div className="pv-card-actions">
        {!signedIn ? (
          <Button type="button" onClick={() => setSignInOpen(true)}>Sign in to claim</Button>
        ) : tu.profit_cents > 0 && !claimed && !claimedByOther ? (
          <Button
            type="button"
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
          </Button>
        ) : null}
        {claimed && (
          <Button
            type="button"
            variant="outline"
            onClick={async () => {
              const res = await fetch(`/api/trade-ups/${tu.id}/claim`, { method: "DELETE", credentials: "include" });
              if (res.ok) onReleased();
            }}
          >
            Release{claimExpiresAt ? "" : ""}
          </Button>
        )}
        {isPro && (
          <Button type="button" variant="outline" disabled={verifying} onClick={onVerify}>
            {verifying ? "Verifying…" : `Verify${verifyLimit ? ` (${verifyLimit.remaining})` : ""}`}
          </Button>
        )}
      </div>
      {verifyResult && (
        <div className={verifyResult.all_active ? "pv-profit" : "pv-loss"}>
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
    </div>
  );
}
