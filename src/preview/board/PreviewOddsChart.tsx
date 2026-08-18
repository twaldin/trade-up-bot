import type { TradeUp } from "../../../shared/types.js";
import { outcomeSegmentClass, profitLossSplit, uniqueOutcomes } from "../../../shared/preview-board.js";

export function PreviewOddsChart({ tu }: { tu: TradeUp }) {
  const split = profitLossSplit(tu);
  const outcomes = uniqueOutcomes(tu.outcomes);
  const profitPct = Math.round(split.profit * 100);
  const lossPct = Math.round(split.loss * 100);

  return (
    <div className="pv-odds" aria-label="Profit versus loss and per-outcome odds">
      <div className="pv-split" title={`Profit ${profitPct}% · Loss ${lossPct}%`}>
        {split.profit > 0 && (
          <span className="pv-split-profit" style={{ width: `${Math.max(2, profitPct)}%` }} />
        )}
        {split.loss > 0 && (
          <span className="pv-split-loss" style={{ width: `${Math.max(2, lossPct)}%` }} />
        )}
      </div>
      <div className="pv-split-legend">
        <span className="pv-profit">Profit {profitPct}%</span>
        <span className="pv-loss">Loss {lossPct}%</span>
      </div>
      {outcomes.length > 0 && (
        <div className="pv-outcome-stack" title="Per-outcome probability">
          {outcomes.map(outcome => (
            <span
              key={outcome.skin_id + outcome.skin_name}
              className={outcomeSegmentClass(outcome, tu.total_cost_cents)}
              style={{ width: `${Math.max(2, outcome.probability * 100)}%` }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
