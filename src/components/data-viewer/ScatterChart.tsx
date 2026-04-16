import { useMemo } from "react";
import { conditionLabel } from "../../utils/format.js";
import { useCurrency } from "../../contexts/CurrencyContext.js";
import type { ListingRow, SaleRow, FloatBucket, SeriesKey } from "./types.js";
import { SERIES_COLORS } from "./types.js";

interface ScatterChartProps {
  listings: ListingRow[];
  saleHistory: SaleRow[];
  floatBuckets: FloatBucket[];
  minFloat: number;
  maxFloat: number;
  fullscreen?: boolean;
  visible: Record<SeriesKey, boolean>;
  xDomainMin?: number;
  xDomainMax?: number;
}

export function ScatterChart({ listings, saleHistory, floatBuckets, minFloat, maxFloat, fullscreen, visible, xDomainMin, xDomainMax }: ScatterChartProps) {
  const { formatPrice } = useCurrency();
  const W = fullscreen ? 1200 : 700;
  const H = fullscreen ? 600 : 300;
  const PAD = { top: 25, right: 25, bottom: 40, left: 70 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const dotR = fullscreen ? 4.5 : 3.5;

  const allPrices = useMemo(() => {
    const p: number[] = [];
    const visibleListings = listings.filter(l => {
      const src = l.source || "csfloat";
      if (src === "csfloat" && visible.csfloat) return true;
      if (src === "dmarket" && visible.dmarket) return true;
      if (src === "skinport" && visible.skinport) return true;
      if (src === "buff" && visible.buff) return true;
      return false;
    });
    p.push(...visibleListings.map(l => l.price_cents));
    const visibleSales = (saleHistory || []).filter(s => {
      const src = s.source || "sale";
      if ((src === "sale" || src === "listing" || src === "listing_dmarket" || src === "listing_skinport") && visible.csfloat_sales) return true;
      if (src === "skinport_sale" && visible.skinport_sales) return true;
      if (src === "buff_sale" && visible.buff_sales) return true;
      return false;
    });
    p.push(...visibleSales.map(s => s.price_cents));
    if (visible.buckets) p.push(...floatBuckets.map(b => b.avg_price_cents));
    return p.filter(v => v > 0).sort((a, b) => a - b);
  }, [listings, saleHistory, floatBuckets, visible]);

  if (allPrices.length === 0) {
    return <div className="py-10 text-center text-muted-foreground">No pricing data (enable series in legend)</div>;
  }

  const p95 = allPrices[Math.floor(allPrices.length * 0.95)];
  const maxPrice = Math.min(p95 * 1.2, allPrices[allPrices.length - 1]);
  const minPrice = 0;

  const floatMin = xDomainMin !== undefined ? xDomainMin : Math.max(0, minFloat - 0.01);
  const floatMax = xDomainMax !== undefined ? xDomainMax : Math.min(1, maxFloat + 0.01);

  const x = (f: number) => PAD.left + ((f - floatMin) / (floatMax - floatMin)) * plotW;
  const y = (p: number) => PAD.top + plotH - ((Math.min(p, maxPrice) - minPrice) / (maxPrice - minPrice)) * plotH;

  const boundaries = [0.07, 0.15, 0.38, 0.45].filter(b => b > floatMin && b < floatMax);
  const yTicks = fullscreen ? 8 : 5;
  const yTickStep = maxPrice / yTicks;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full max-w-[700px] bg-background border border-border/70 rounded"
      style={fullscreen ? { width: "100%", maxWidth: "none" } : undefined}
    >
      {/* Y-axis grid lines and labels */}
      {Array.from({ length: yTicks + 1 }, (_, i) => {
        const price = i * yTickStep;
        return (
          <g key={`ytick-${i}`}>
            <line x1={PAD.left} y1={y(price)} x2={W - PAD.right} y2={y(price)} className="stroke-border" strokeWidth={1} />
            <text x={PAD.left - 5} y={y(price) + 4} textAnchor="end" className="fill-muted-foreground" fontSize={fullscreen ? 12 : 10}>
              {formatPrice(price)}
            </text>
          </g>
        );
      })}

      {/* Condition boundary lines */}
      {boundaries.map(b => (
        <g key={`boundary-${b}`}>
          <line x1={x(b)} y1={PAD.top} x2={x(b)} y2={PAD.top + plotH} className="stroke-border" strokeWidth={1} strokeDasharray="3,3" />
          <text x={x(b)} y={PAD.top + plotH + 15} textAnchor="middle" className="fill-muted-foreground" fontSize={fullscreen ? 12 : 10}>
            {b.toFixed(2)}
          </text>
        </g>
      ))}

      {/* X axis labels */}
      <text x={PAD.left} y={PAD.top + plotH + 30} className="fill-muted-foreground" fontSize={10}>
        {floatMin.toFixed(2)}
      </text>
      <text x={W - PAD.right} y={PAD.top + plotH + 30} textAnchor="end" className="fill-muted-foreground" fontSize={10}>
        {floatMax.toFixed(2)}
      </text>
      <text x={PAD.left + plotW / 2} y={PAD.top + plotH + 30} textAnchor="middle" className="fill-muted-foreground/70" fontSize={10}>
        Float Value
      </text>

      {/* Float bucket average price bars (background layer) */}
      {visible.buckets && floatBuckets.filter(b => b.avg_price_cents > 0).map((b, i) => {
        const x1 = x(Math.max(b.float_min, floatMin));
        const x2 = x(Math.min(b.float_max, floatMax));
        const yTop = y(b.avg_price_cents);
        return (
          <g key={`bucket-${i}`}>
            <rect x={x1} y={yTop} width={x2 - x1} height={PAD.top + plotH - yTop} fill={SERIES_COLORS.buckets} opacity={0.08} />
            <line x1={x1} y1={yTop} x2={x2} y2={yTop} stroke={SERIES_COLORS.buckets} strokeWidth={2} opacity={0.5} strokeDasharray="4,3" />
          </g>
        );
      })}

      {/* CSFloat Sales */}
      {visible.csfloat_sales && (saleHistory || [])
        .filter(s => !s.source || s.source === "sale" || s.source === "listing" || s.source === "listing_dmarket" || s.source === "listing_skinport")
        .map((s, i) => (
        <g key={`csf-sale-${i}`} transform={`translate(${x(s.float_value)},${y(s.price_cents)})`}>
          <rect x={-3} y={-3} width={6} height={6} transform="rotate(45)" fill={SERIES_COLORS.csfloat_sales} opacity={0.45} />
          <title>{`CSFloat Sale: ${formatPrice(s.price_cents)} @ ${s.float_value.toFixed(6)} (${s.sold_at})`}</title>
        </g>
      ))}

      {/* Skinport Sales */}
      {visible.skinport_sales && (saleHistory || [])
        .filter(s => s.source === "skinport_sale")
        .map((s, i) => (
        <g key={`sp-sale-${i}`} transform={`translate(${x(s.float_value)},${y(s.price_cents)})`}>
          <rect x={-3} y={-3} width={6} height={6} transform="rotate(45)" fill={SERIES_COLORS.skinport_sales} opacity={0.45} />
          <title>{`Skinport Sale: ${formatPrice(s.price_cents)} @ ${s.float_value.toFixed(6)} (${s.sold_at})`}</title>
        </g>
      ))}

      {/* Buff Sales */}
      {visible.buff_sales && (saleHistory || [])
        .filter(s => s.source === "buff_sale")
        .map((s, i) => (
        <g key={`buff-sale-${i}`} transform={`translate(${x(s.float_value)},${y(s.price_cents)})`}>
          <rect x={-3} y={-3} width={6} height={6} transform="rotate(45)" fill={SERIES_COLORS.buff_sales} opacity={0.45} />
          <title>{`Buff Sale: ${formatPrice(s.price_cents)} @ ${s.float_value.toFixed(6)} (${s.sold_at})`}</title>
        </g>
      ))}

      {/* CSFloat listings (blue dots) */}
      {visible.csfloat && listings.filter(l => !l.source || l.source === "csfloat").map((l, i) => (
        <circle
          key={`csfloat-${i}`}
          cx={x(l.float_value)} cy={y(l.price_cents)}
          r={dotR} fill={SERIES_COLORS.csfloat}
          stroke={l.staleness_checked_at ? "currentColor" : "none"}
          className="text-foreground/50"
          strokeWidth={0.5}
          opacity={0.8}
        >
          <title>{`CSFloat: ${formatPrice(l.price_cents)} @ ${l.float_value.toFixed(6)} (${conditionLabel(l.float_value)})${l.staleness_checked_at ? " [verified]" : ""}`}</title>
        </circle>
      ))}

      {/* DMarket listings (purple dots) */}
      {visible.dmarket && listings.filter(l => l.source === "dmarket").map((l, i) => (
        <circle
          key={`dmarket-${i}`}
          cx={x(l.float_value)} cy={y(l.price_cents)}
          r={dotR} fill={SERIES_COLORS.dmarket}
          opacity={0.7}
        >
          <title>{`DMarket: ${formatPrice(l.price_cents)} @ ${l.float_value.toFixed(6)} (${conditionLabel(l.float_value)})`}</title>
        </circle>
      ))}

      {/* Skinport listings (orange dots) */}
      {visible.skinport && listings.filter(l => l.source === "skinport").map((l, i) => (
        <circle
          key={`skinport-${i}`}
          cx={x(l.float_value)} cy={y(l.price_cents)}
          r={dotR} fill={SERIES_COLORS.skinport}
          opacity={0.7}
        >
          <title>{`Skinport: ${formatPrice(l.price_cents)} @ ${l.float_value.toFixed(6)} (${conditionLabel(l.float_value)})`}</title>
        </circle>
      ))}

      {/* Buff listings (burnt orange dots) */}
      {visible.buff && listings.filter(l => l.source === "buff").map((l, i) => (
        <circle
          key={`buff-${i}`}
          cx={x(l.float_value)} cy={y(l.price_cents)}
          r={dotR} fill={SERIES_COLORS.buff}
          opacity={0.7}
        >
          <title>{`Buff: ${formatPrice(l.price_cents)} @ ${l.float_value.toFixed(6)} (${conditionLabel(l.float_value)})`}</title>
        </circle>
      ))}

      {/* Bucket price labels (topmost layer) */}
      {visible.buckets && floatBuckets.filter(b => b.avg_price_cents > 0).map((b, i) => {
        const cx = (x(Math.max(b.float_min, floatMin)) + x(Math.min(b.float_max, floatMax))) / 2;
        const cy = y(b.avg_price_cents) - 5;
        const label = formatPrice(b.avg_price_cents);
        const tw = label.length * 5.5 + 6;
        return (
          <g key={`blabel-${i}`}>
            <rect x={cx - tw / 2} y={cy - 8} width={tw} height={13} rx={2} className="fill-background" opacity={0.85} />
            <text x={cx} y={cy} textAnchor="middle" fill={SERIES_COLORS.buckets} fontSize={9} fontWeight={600}>{label}</text>
          </g>
        );
      })}

      {/* Axes */}
      <line x1={PAD.left} y1={PAD.top} x2={PAD.left} y2={PAD.top + plotH} className="stroke-border" strokeWidth={1} />
      <line x1={PAD.left} y1={PAD.top + plotH} x2={W - PAD.right} y2={PAD.top + plotH} className="stroke-border" strokeWidth={1} />
    </svg>
  );
}
