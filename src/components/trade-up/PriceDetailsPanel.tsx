import { useState, useEffect, memo } from "react";
import { formatDollars, timeAgo } from "../../utils/format.js";

interface PriceDetails {
  cached_price: { price: number; source: string } | null;
  price_data: { source: string; median_price_cents: number; min_price_cents: number; volume: number; updated_at: string }[];
  listings: { price_cents: number; float_value: number; created_at: string }[];
  recent_sales: { price_cents: number; float_value: number; sold_at: string }[];
}

interface PriceDetailsPanelProps {
  skinName: string;
  condition: string;
}

export const PriceDetailsPanel = memo(function PriceDetailsPanel({ skinName, condition }: PriceDetailsPanelProps) {
  const [data, setData] = useState<PriceDetails | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    setData(null);
    fetch(`/api/price-details?skin_name=${encodeURIComponent(skinName)}&condition=${encodeURIComponent(condition)}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [skinName, condition]);

  if (loading) return <div className="mt-1.5 rounded-md border border-border bg-card px-2.5 py-2 text-[0.72rem]">Loading...</div>;
  if (!data) return <div className="mt-1.5 rounded-md border border-border bg-card px-2.5 py-2 text-[0.72rem]">No data</div>;

  return (
    <div className="mt-1.5 rounded-md border border-border bg-card px-2.5 py-2 text-[0.72rem]" onClick={e => e.stopPropagation()}>
      {data.cached_price && (
        <div className="flex justify-between border-b border-border py-0.5 pb-1.5 mb-0.5 text-foreground">
          <span>Used: <strong>{formatDollars(data.cached_price.price)}</strong></span>
          <span className="text-blue-400 text-[0.68rem]">{data.cached_price.source}</span>
        </div>
      )}
      {data.price_data.map((pd, i) => (
        <div key={i} className="flex justify-between py-0.5 text-muted-foreground">
          <span>{pd.source}: {formatDollars(pd.median_price_cents || pd.min_price_cents)}</span>
          <span className="text-muted-foreground/50 text-[0.68rem]">{pd.volume > 0 ? `${pd.volume} vol` : ""} {timeAgo(pd.updated_at)}</span>
        </div>
      ))}
      {data.listings.length > 0 && (
        <div className="flex justify-between py-0.5 text-muted-foreground">
          <span>Listing floor: {formatDollars(data.listings[0].price_cents)}</span>
          <span className="text-muted-foreground/50 text-[0.68rem]">{data.listings.length} listings</span>
        </div>
      )}
      {data.recent_sales.length > 0 && (
        <div className="flex justify-between py-0.5 text-muted-foreground">
          <span>Recent sale: {formatDollars(data.recent_sales[0].price_cents)}</span>
          <span className="text-muted-foreground/50 text-[0.68rem]">{timeAgo(data.recent_sales[0].sold_at)}</span>
        </div>
      )}
    </div>
  );
});
