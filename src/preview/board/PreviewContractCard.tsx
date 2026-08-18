import type { ReactNode } from "react";
import type { TradeUp } from "../../../shared/types.js";
import {
  chanceToProfit,
  groupInputSkins,
  rarityForTradeUpRole,
  uniqueOutcomes,
} from "../../../shared/preview-board.js";
import { useCurrency } from "../../contexts/CurrencyContext.js";
import { PreviewSkinTile } from "../tiles/PreviewSkinTile.js";
import { PreviewOddsChart } from "./PreviewOddsChart.js";

function verdictClass(cents: number): string {
  if (cents > 0) return "pv-profit";
  if (cents < 0) return "pv-loss";
  return "";
}

export function PreviewContractCard({
  tu,
  images,
  open,
  onOpen,
  details,
}: {
  tu: TradeUp;
  images: Map<string, string | null>;
  open: boolean;
  onOpen?: () => void;
  details?: ReactNode;
}) {
  const { formatPrice } = useCurrency();
  const inputs = groupInputSkins(tu);
  const outputs = uniqueOutcomes(tu.outcomes);
  const chance = chanceToProfit(tu);
  const interactive = typeof onOpen === "function";
  const inputRarity = rarityForTradeUpRole(tu.type, "input");
  const outputRarity = rarityForTradeUpRole(tu.type, "output");

  return (
    <article className={`pv-card${open ? " pv-card-open" : ""}`}>
      <button
        type="button"
        className="pv-card-hit"
        onClick={onOpen}
        disabled={!interactive}
        aria-expanded={open}
      >
        <div className="pv-card-skins">
          <div className="pv-card-section">
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
          </div>
          <div className="pv-card-section">
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
          </div>
        </div>

        <div className="pv-card-metrics">
          <PreviewOddsChart tu={tu} />
          <dl className="pv-statrow">
            <div><dt>Cost</dt><dd className="pv-tabular">{formatPrice(tu.total_cost_cents)}</dd></div>
            <div>
              <dt>Profit</dt>
              <dd className={`pv-tabular ${verdictClass(tu.profit_cents)}`}>{formatPrice(tu.profit_cents)}</dd>
            </div>
            <div>
              <dt>Chance</dt>
              <dd className="pv-tabular">{(chance * 100).toFixed(0)}%</dd>
            </div>
          </dl>
        </div>
      </button>
      <div className={`pv-card-expand${open ? " pv-card-expand-open" : ""}`}>
        <div className="pv-card-expand-inner">
          {open ? details : null}
        </div>
      </div>
    </article>
  );
}
