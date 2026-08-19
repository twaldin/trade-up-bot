/**
 * Float × price scatter for a skin, the same view the production skin page
 * draws, on the same `/api/skin-data/:name` payload. Each source is its own
 * series and every series can be switched off; "All" and "None" reset it.
 */
import { useMemo, useState } from "react";
import {
  CartesianGrid,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import { formatDollars } from "../../utils/format.js";
import { formatFloat } from "../lib/board.js";

export interface ScatterPoint {
  price_cents: number;
  float_value: number | null;
  source: string;
}

export type SeriesKey = "csfloat" | "dmarket" | "skinport" | "buff" | "sales";

interface Series {
  key: SeriesKey;
  label: string;
  colorVar: string;
  match: (source: string) => boolean;
}

/** Sale rows arrive under several source names; they are one series here. */
const SALE_SOURCES = /sale/i;

export const SERIES: Series[] = [
  { key: "csfloat", label: "CSFloat", colorVar: "var(--series-1)", match: (s) => s === "csfloat" },
  { key: "dmarket", label: "DMarket", colorVar: "var(--series-2)", match: (s) => s === "dmarket" || s === "listing_dmarket" },
  { key: "skinport", label: "Skinport", colorVar: "var(--series-4)", match: (s) => s === "skinport" || s === "listing_skinport" },
  { key: "buff", label: "Buff", colorVar: "var(--series-5)", match: (s) => s === "buff" },
  { key: "sales", label: "Sales", colorVar: "var(--profit-edge)", match: (s) => SALE_SOURCES.test(s) },
];

export function seriesFor(source: string): SeriesKey | null {
  return SERIES.find((series) => series.match(source))?.key ?? null;
}

/** Groups rows into the series that actually have data, dropping floatless rows. */
export function groupBySeries(points: ScatterPoint[]): Record<SeriesKey, ScatterPoint[]> {
  const groups = Object.fromEntries(SERIES.map((s) => [s.key, [] as ScatterPoint[]])) as Record<SeriesKey, ScatterPoint[]>;
  for (const point of points) {
    if (typeof point.float_value !== "number" || !Number.isFinite(point.float_value)) continue;
    const key = seriesFor(point.source);
    if (key) groups[key].push(point);
  }
  return groups;
}

export type ScatterPlotPoint = {
  x: number;
  y: number;
  priceCents: number;
  clipped: boolean;
};

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const index = (sorted.length - 1) * q;
  const lo = Math.floor(index);
  const hi = Math.ceil(index);
  const low = sorted[lo];
  const high = sorted[hi];
  if (low === undefined) return 0;
  if (high === undefined || lo === hi) return low;
  return low * (hi - index) + high * (index - lo);
}

function niceCeil(value: number): number {
  if (!(value > 0)) return 1;
  const exp = 10 ** Math.floor(Math.log10(value));
  const n = value / exp;
  const nice = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return Number((nice * exp).toFixed(10));
}

/**
 * Y-axis ceiling in dollars that keeps the bulk price cloud readable when a
 * handful of stale / trophy asks would otherwise smear the floor. Scale-only:
 * listing prices and EV math stay untouched.
 */
export function scatterYMaxDollars(priceCents: number[]): number {
  const dollars = priceCents
    .filter((cents) => Number.isFinite(cents) && cents > 0)
    .map((cents) => cents / 100)
    .sort((a, b) => a - b);
  if (dollars.length === 0) return 1;
  const max = dollars[dollars.length - 1];
  if (max === undefined) return 1;
  if (dollars.length < 12) {
    const median = quantile(dollars, 0.5);
    return niceCeil(max > median * 8 ? median * 5 : max);
  }
  const median = quantile(dollars, 0.5);
  const p95 = quantile(dollars, 0.95);
  const p99 = quantile(dollars, 0.99);
  const bulk = Math.max(p95 * 1.2, Math.min(p99, median * 3));
  return niceCeil(max > bulk * 1.75 ? bulk : max);
}

export function scatterPlotPoint(priceCents: number, yMaxDollars: number): ScatterPlotPoint {
  const dollars = priceCents / 100;
  const clipped = dollars > yMaxDollars;
  return {
    x: 0,
    y: clipped ? yMaxDollars : dollars,
    priceCents,
    clipped,
  };
}

function ScatterDot(props: {
  cx?: number;
  cy?: number;
  fill?: string;
  payload?: ScatterPlotPoint;
}) {
  const { cx, cy, fill, payload } = props;
  if (typeof cx !== "number" || typeof cy !== "number") return null;
  if (payload?.clipped) {
    return (
      <polygon
        points={`${cx},${cy - 5} ${cx + 4.5},${cy + 3.5} ${cx - 4.5},${cy + 3.5}`}
        fill={fill}
        stroke="var(--canvas)"
        strokeWidth={1}
      />
    );
  }
  return (
    <circle
      cx={cx}
      cy={cy}
      r={3.5}
      fill={fill}
      stroke="var(--canvas)"
      strokeWidth={1}
    />
  );
}

export function PriceScatter({ points }: { points: ScatterPoint[] }) {
  const groups = useMemo(() => groupBySeries(points), [points]);
  const available = SERIES.filter((series) => groups[series.key].length > 0);
  const [off, setOff] = useState<Set<SeriesKey>>(new Set());

  if (available.length === 0) {
    return <p className="preview-note">No float-tagged listings or sales to plot yet.</p>;
  }

  const shown = available.filter((series) => !off.has(series.key));
  const shownPoints = shown.flatMap((series) => groups[series.key]);
  const yMax = scatterYMaxDollars(shownPoints.map((point) => point.price_cents));
  const clippedCount = shownPoints.filter((point) => point.price_cents / 100 > yMax).length;
  const toggle = (key: SeriesKey) =>
    setOff((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <figure className="preview-figure">
      <div className="preview-legend">
        {available.map((series) => (
          <button
            key={series.key}
            type="button"
            className="preview-legend__item"
            data-off={off.has(series.key) ? "true" : undefined}
            onClick={() => toggle(series.key)}
          >
            <i style={{ background: series.colorVar }} />
            {series.label}
            <em>{groups[series.key].length}</em>
          </button>
        ))}
        <span className="preview-legend__spacer" />
        <button type="button" className="preview-btn preview-btn--quiet" onClick={() => setOff(new Set())}>All</button>
        <button
          type="button"
          className="preview-btn preview-btn--quiet"
          onClick={() => setOff(new Set(available.map((series) => series.key)))}
        >
          None
        </button>
      </div>
      <div className="preview-plot" role="img" aria-label="Float against price for every live listing and recorded sale">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 10, right: 12, left: 4, bottom: 4 }}>
            <CartesianGrid stroke="var(--line-hard)" strokeOpacity={0.55} />
            <XAxis
              type="number"
              dataKey="x"
              domain={[0, 1]}
              ticks={[0, 0.07, 0.15, 0.38, 0.45, 1]}
              tickFormatter={(value: number) => value.toFixed(2)}
              tick={{ fontSize: 10, fill: "var(--text)", fontFamily: "var(--font-mono)" }}
              axisLine={{ stroke: "var(--line-hard)" }}
              tickLine={{ stroke: "var(--line-hard)" }}
              height={22}
            />
            <YAxis
              type="number"
              dataKey="y"
              domain={[0, yMax]}
              allowDataOverflow
              tickFormatter={(value: number) => `$${value.toFixed(0)}`}
              tick={{ fontSize: 10, fill: "var(--text)", fontFamily: "var(--font-mono)" }}
              axisLine={{ stroke: "var(--line-hard)" }}
              tickLine={{ stroke: "var(--line-hard)" }}
              width={48}
            />
            <ZAxis range={[48, 48]} />
            <Tooltip
              cursor={{ stroke: "var(--text)" }}
              contentStyle={{
                background: "var(--overlay)",
                border: "1px solid var(--line-hard)",
                borderRadius: "var(--r-panel)",
                fontSize: 11,
                color: "var(--text)",
              }}
              formatter={(value, name, item) => {
                const payload = item.payload;
                if (name === "y") {
                  return [
                    formatDollars(payload.priceCents),
                    payload.clipped ? "price (off-scale)" : "price",
                  ];
                }
                const amount = typeof value === "number" ? value : Number(value);
                return [formatFloat(amount) ?? "—", "float"];
              }}
            />
            {shown.map((series) => (
              <Scatter
                key={series.key}
                name={series.label}
                data={groups[series.key].map((point) => {
                  const plotted = scatterPlotPoint(point.price_cents, yMax);
                  return {
                    ...plotted,
                    x: point.float_value as number,
                  };
                })}
                fill={series.colorVar}
                fillOpacity={1}
                stroke="var(--canvas)"
                strokeWidth={1}
                shape={ScatterDot}
                isAnimationActive={false}
              />
            ))}
          </ScatterChart>
        </ResponsiveContainer>
      </div>
      {clippedCount > 0 && (
        <figcaption className="preview-note">
          {clippedCount} off-scale {clippedCount === 1 ? "ask sits" : "asks sit"} at the top of the axis.
        </figcaption>
      )}
    </figure>
  );
}
