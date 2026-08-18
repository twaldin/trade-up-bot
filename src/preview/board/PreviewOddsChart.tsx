import type { TradeUp } from "../../../shared/types.js";
import { profitLossSplit } from "../../../shared/preview-board.js";

export function PreviewOddsChart({ tu }: { tu: TradeUp }) {
  const split = profitLossSplit(tu);
  const profitPct = Math.round(split.profit * 100);
  const lossPct = Math.round(split.loss * 100);

  return (
    <div className="pv-odds" aria-label="Profit versus loss">
      <div
        className="pv-donut"
        title={`Profit ${profitPct}% · Loss ${lossPct}%`}
        style={{
          background: `conic-gradient(var(--pv-lime) 0 ${profitPct}%, var(--pv-charcoal) ${profitPct}% 100%)`,
        }}
      />
      <div className="pv-donut-legend">
        <span className="pv-profit">Profit {profitPct}%</span>
        <span className="pv-loss">Loss {lossPct}%</span>
      </div>
    </div>
  );
}
