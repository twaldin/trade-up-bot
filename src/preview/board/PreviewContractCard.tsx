import type { TradeUp } from "../../../shared/types.js";
import { expandInputSlots, pickHeroOutcome } from "../../../shared/preview-board.js";
import { useCurrency } from "../../contexts/CurrencyContext.js";
import { SkinRender } from "../images/SkinRender.js";

function verdictClass(cents: number): string {
  if (cents > 0) return "pv-profit";
  if (cents < 0) return "pv-loss";
  return "";
}

function chanceToProfit(tu: TradeUp): number {
  if (tu.chance_to_profit !== undefined) return tu.chance_to_profit;
  return tu.outcomes.reduce((sum, o) =>
    sum + (o.estimated_price_cents > tu.total_cost_cents ? o.probability : 0), 0);
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
  onOpen: () => void;
}) {
  const { formatPrice } = useCurrency();
  const hero = pickHeroOutcome(tu.outcomes);
  const slots = expandInputSlots(tu);
  const chance = chanceToProfit(tu);

  return (
    <button type="button" className={`pv-card${open ? " pv-card-open" : ""}`} onClick={onOpen}>
      <div className="pv-hero-skin">
        <SkinRender name={hero?.skin_name ?? "Output"} url={hero ? images.get(hero.skin_name) : null} />
      </div>
      <div className="pv-card-body">
        <div className="pv-card-name">{hero?.skin_name ?? "Output pending"}</div>
        <div className="pv-slots">
          {slots.map((name, i) => (
            <div key={`${name}-${i}`} className="pv-slot">
              <SkinRender name={name} url={name ? images.get(name) : null} />
            </div>
          ))}
        </div>
        <dl className="pv-statrow">
          <div><dt>Cost</dt><dd className="pv-tabular">{formatPrice(tu.total_cost_cents)}</dd></div>
          <div><dt>EV</dt><dd className="pv-tabular">{formatPrice(tu.expected_value_cents)}</dd></div>
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
