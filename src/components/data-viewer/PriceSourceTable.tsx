import type { PriceSourceRow } from "./types.js";
import { SOURCE_LABELS, CONDITION_ORDER } from "./types.js";
import { useCurrency } from "../../contexts/CurrencyContext.js";

interface PriceSourceTableProps {
  priceSources: PriceSourceRow[];
}

export function PriceSourceTable({ priceSources }: PriceSourceTableProps) {
  const { formatPrice } = useCurrency();
  const byCondition = new Map<string, Map<string, { price: number; volume: number }>>();
  for (const p of priceSources) {
    if (!byCondition.has(p.condition)) byCondition.set(p.condition, new Map());
    byCondition.get(p.condition)!.set(p.source, { price: p.avg_price_cents, volume: p.volume });
  }

  const sources = [...new Set(priceSources.map(p => p.source))];
  const conditions = CONDITION_ORDER.filter(c => byCondition.has(c));

  if (conditions.length === 0) {
    return <div className="py-10 text-center text-muted-foreground">No price data</div>;
  }

  return (
    <table className="w-full border-collapse text-[0.8rem]">
      <thead>
        <tr>
          <th className="text-left px-2.5 py-1.5 text-muted-foreground border-b border-border font-medium sticky top-0 bg-card z-[1]">Condition</th>
          {sources.map(s => (
            <th key={s} className="text-left px-2.5 py-1.5 text-muted-foreground border-b border-border font-medium sticky top-0 bg-card z-[1]">
              {SOURCE_LABELS[s] || s}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {conditions.map(cond => (
          <tr key={cond} className="hover:[&>td]:bg-muted">
            <td className="px-2.5 py-1 border-b border-border/70 font-medium text-muted-foreground">{cond}</td>
            {sources.map(src => {
              const data = byCondition.get(cond)?.get(src);
              if (!data || data.price === 0) {
                return <td key={src} className="px-2.5 py-1 border-b border-border/70 text-muted-foreground/40 text-center">&mdash;</td>;
              }
              return (
                <td key={src} className="px-2.5 py-1 border-b border-border/70 text-foreground/80">
                  <span className="text-green-500 font-medium">{formatPrice(data.price)}</span>
                  <span className="text-muted-foreground text-[0.7rem] ml-1">({data.volume})</span>
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
