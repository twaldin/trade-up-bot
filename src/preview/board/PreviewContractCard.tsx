import type { TradeUp } from "../../../shared/types.js";
import {
  chanceToProfit,
  groupInputSkins,
  uniqueOutcomes,
} from "../../../shared/preview-board.js";
import { useCurrency } from "../../contexts/CurrencyContext.js";
import { SkinRender } from "../images/SkinRender.js";
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
}: {
  tu: TradeUp;
  images: Map<string, string | null>;
  open: boolean;
  onOpen?: () => void;
}) {
  const { formatPrice } = useCurrency();
  const inputs = groupInputSkins(tu);
  const outputs = uniqueOutcomes(tu.outcomes);
  const chance = chanceToProfit(tu);
  const interactive = typeof onOpen === "function";

  return (
    <button
      type="button"
      className={`pv-card${open ? " pv-card-open" : ""}`}
      onClick={onOpen}
      disabled={!interactive}
    >
      <div className="pv-card-body">
        <div className="pv-card-section">
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
        </div>

        <div className="pv-card-section">
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
                    <div className="pv-tabular pv-muted">{(outcome.probability * 100).toFixed(0)}%</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

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
  );
}
