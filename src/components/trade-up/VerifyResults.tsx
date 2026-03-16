import type { TradeUp } from "../../../shared/types.js";
import { formatDollars, timeAgo, condAbbr, listingUrl } from "../../utils/format.js";

interface VerifyResultsProps {
  tu: TradeUp;
}

export function VerifyResults({ tu }: VerifyResultsProps) {
  // Status info bar for stale/partial/revived trade-ups
  if ((tu.peak_profit_cents ?? 0) <= 0 && tu.listing_status === 'active') return null;

  return (
    <div className="my-2 px-1">
      {tu.listing_status === 'stale' && (
        <div className="text-[0.78rem] px-2.5 py-1.5 rounded mb-1 leading-relaxed bg-red-950/50 border-l-[3px] border-l-red-500 text-red-300">
          <strong className="mr-1">Stale</strong> &mdash; {tu.missing_inputs || tu.inputs.length}/{tu.inputs.length} input listings gone
          {tu.preserved_at && <span className="text-muted-foreground"> (since {timeAgo(tu.preserved_at)})</span>}
          . Waiting for replacement listings. Auto-purges after 2 days.
        </div>
      )}
      {tu.listing_status === 'partial' && (
        <div className="text-[0.78rem] px-2.5 py-1.5 rounded mb-1 leading-relaxed bg-yellow-950/50 border-l-[3px] border-l-yellow-500 text-yellow-200">
          <strong className="mr-1">Partial</strong> &mdash; {tu.missing_inputs}/{tu.inputs.length} input listings missing
          {tu.preserved_at && <span className="text-muted-foreground"> (since {timeAgo(tu.preserved_at)})</span>}
        </div>
      )}
      {(tu.peak_profit_cents ?? 0) > 0 && tu.profit_cents <= 0 && tu.listing_status === 'active' && (
        <div className="text-[0.78rem] px-2.5 py-1.5 rounded mb-1 leading-relaxed bg-blue-950/50 border-l-[3px] border-l-blue-500 text-blue-300">
          <strong className="mr-1">Revived</strong> &mdash; Was {formatDollars(tu.peak_profit_cents!)} profit, now {formatDollars(tu.profit_cents)}. Replacement listings cost {formatDollars(Math.abs(tu.profit_cents))} more than needed to break even.
        </div>
      )}
      {(tu.peak_profit_cents ?? 0) > 0 && tu.profit_cents > 0 && tu.peak_profit_cents! > tu.profit_cents && (
        <div className="text-[0.78rem] px-2.5 py-1.5 rounded mb-1 leading-relaxed bg-violet-950/50 border-l-[3px] border-l-violet-400 text-violet-300">
          <strong className="mr-1">Declined</strong> &mdash; Peak was {formatDollars(tu.peak_profit_cents!)}, now {formatDollars(tu.profit_cents)}
        </div>
      )}
      {/* Input replacement diff */}
      {tu.previous_inputs && tu.previous_inputs.replaced.length > 0 && (
        <div className="bg-card border border-border rounded mt-1 px-2.5 py-2 text-[0.78rem]">
          <div className="mb-1.5 pb-1 border-b border-border">
            <strong>Replaced Inputs</strong>
            <span className="text-muted-foreground">
              {" "}cost {formatDollars(tu.previous_inputs.old_cost_cents)} &rarr; {formatDollars(tu.total_cost_cents)}
              {" "}({formatDollars(tu.total_cost_cents - tu.previous_inputs.old_cost_cents)} change)
            </span>
          </div>
          {tu.previous_inputs.replaced.map((r, i) => (
            <div key={i} className={`flex flex-col gap-0.5 py-1 ${i > 0 ? 'border-t border-border/70' : ''}`}>
              <div className="flex items-center gap-1.5 opacity-60 line-through">
                <span className="inline-block text-[0.6rem] font-bold px-1 py-px rounded-sm w-7 text-center bg-red-950 text-red-300">OLD</span>
                <a
                  href={listingUrl(r.old.listing_id, r.old.skin_name, r.old.condition, r.old.float_value)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-foreground no-underline border-b border-dotted border-muted-foreground/50 transition-colors hover:text-blue-400 hover:border-blue-400"
                  onClick={e => e.stopPropagation()}
                >{r.old.skin_name}</a>
                <span className="text-muted-foreground text-[0.75rem]">({condAbbr(r.old.condition)}, {r.old.float_value.toFixed(4)})</span>
                <span className="text-muted-foreground">{formatDollars(r.old.price_cents)}</span>
              </div>
              {r.new && (
                <div className="flex items-center gap-1.5 pl-1">
                  <span className="inline-block text-[0.6rem] font-bold px-1 py-px rounded-sm w-7 text-center bg-green-950 text-green-300">NEW</span>
                  <a
                    href={listingUrl(r.new.listing_id, r.new.skin_name, r.new.condition, r.new.float_value)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-foreground no-underline border-b border-dotted border-muted-foreground/50 transition-colors hover:text-blue-400 hover:border-blue-400"
                    onClick={e => e.stopPropagation()}
                  >{r.new.skin_name}</a>
                  <span className="text-muted-foreground text-[0.75rem]">({condAbbr(r.new.condition)}, {r.new.float_value.toFixed(4)})</span>
                  <span className="text-muted-foreground">{formatDollars(r.new.price_cents)}</span>
                  <span className={r.new.price_cents <= r.old.price_cents ? "text-green-500 text-[0.72rem]" : "text-red-500 text-[0.72rem]"}>
                    ({r.new.price_cents <= r.old.price_cents ? "" : "+"}{formatDollars(r.new.price_cents - r.old.price_cents)})
                  </span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
