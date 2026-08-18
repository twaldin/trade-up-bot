import { AnimatePresence, motion } from "motion/react";
import { ExternalLink } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { TradeUp, TradeUpInput, TradeUpOutcome } from "../../../shared/types.js";
import { formatDollars, listingUrl, sourceLabel } from "../../utils/format.js";
import { ChartFigure } from "../kit/primitives/chart-figure.js";
import {
  bentoColumns,
  cdfCurve,
  chanceOfProfit,
  evWaterfall,
  inputCostCents,
  inputListingHrefs,
  inputRarityColor,
  medianProfitCents,
  openGroupedListings,
  outputHref,
  outputRarityColor,
  payoffLabelIndexes,
  payoffPoints,
  rarityLabel,
  uniqueInputs,
  uniqueOutputs,
  verifyClaimHref,
  worstBest,
  type PayoffPoint,
} from "../lib/board.js";
import { DELAY_BANNER } from "../lib/copy.js";
import { createFaceCache, faceFor, hydrateOutcomesIfNeeded, loadFaces } from "../lib/skin-images.js";

const FACE_CACHE = createFaceCache();

function signedDollars(cents: number): string {
  return cents > 0 ? `+${formatDollars(cents)}` : formatDollars(cents);
}

function axisPercent(value: number, lo: number, hi: number): number {
  const span = hi - lo;
  if (span <= 0) return 50;
  return ((value - lo) / span) * 100;
}

function SkinFace({ name }: { name: string }) {
  const src = faceFor(FACE_CACHE, name);
  if (src) {
    return (
      <img
        src={src}
        alt=""
        onError={(event) => {
          event.currentTarget.style.visibility = "hidden";
        }}
      />
    );
  }
  return <div className="preview-skin__ph" />;
}

function InputTile({
  name,
  count,
  unitPriceCents,
  listings,
  color,
  onNeedExpand,
}: {
  name: string;
  count: number;
  unitPriceCents: number;
  listings: TradeUpInput[];
  color: string;
  onNeedExpand: () => void;
}) {
  const hrefs = inputListingHrefs(listings);
  return (
    <button
      type="button"
      className="preview-skin preview-skin--input"
      style={{ "--skin-tint": color } as CSSProperties}
      onClick={(event) => {
        event.stopPropagation();
        if (hrefs.length === 0) {
          onNeedExpand();
          return;
        }
        const result = openGroupedListings(hrefs, (url, target) => window.open(url, target));
        if (result.blocked.length > 0) onNeedExpand();
      }}
    >
      <span className="preview-skin__qty">×{count}</span>
      {unitPriceCents > 0 && <span className="preview-skin__unit">{formatDollars(unitPriceCents)}</span>}
      <SkinFace name={name} />
      <span className="preview-skin__name" style={{ color }}>{name}</span>
    </button>
  );
}

function OutputTile({
  outcome,
  color,
}: {
  outcome: TradeUpOutcome;
  color: string;
}) {
  const href = outputHref(outcome);
  return (
    <a
      className="preview-skin preview-skin--output"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      style={{ "--skin-tint": color } as CSSProperties}
      onClick={(event) => event.stopPropagation()}
    >
      <span className="preview-skin__price">{formatDollars(outcome.estimated_price_cents)}</span>
      <span className="preview-skin__odds">{Math.round(outcome.probability * 100)}%</span>
      <SkinFace name={outcome.skin_name} />
      <span className="preview-skin__name" style={{ color }}>{outcome.skin_name}</span>
    </a>
  );
}

function PayoffStrip({
  points,
  evCents,
  medianCents,
  tall = false,
}: {
  points: PayoffPoint[];
  evCents: number;
  medianCents: number | null;
  tall?: boolean;
}) {
  if (points.length === 0) return null;
  const profits = points.map((point) => point.profitCents);
  const min = Math.min(0, evCents, medianCents ?? 0, ...profits);
  const max = Math.max(0, evCents, medianCents ?? 0, ...profits);
  const pad = Math.max((max - min) * 0.1, 50);
  const lo = min - pad;
  const hi = max + pad;
  const labels = new Set(payoffLabelIndexes(points));
  const maxP = Math.max(...points.map((point) => point.probability), 0.01);
  return (
    <div className={`preview-payoff ${tall ? "preview-payoff--tall" : ""}`} role="img" aria-label="Payoff strip">
      <div className="preview-payoff__axis" />
      <div className="preview-payoff__mark is-zero" style={{ left: `${axisPercent(0, lo, hi)}%` }}>
        <span>$0</span>
      </div>
      <div className="preview-payoff__mark is-ev" style={{ left: `${axisPercent(evCents, lo, hi)}%` }}>
        <span>EV</span>
      </div>
      {medianCents !== null && (
        <div className="preview-payoff__mark is-med" style={{ left: `${axisPercent(medianCents, lo, hi)}%` }}>
          <span>Med</span>
        </div>
      )}
      {points.map((point, index) => {
        const size = 7 + (point.probability / maxP) * 11;
        return (
          <div
            key={point.name}
            className={`preview-payoff__dot ${point.profitCents >= 0 ? "is-plus" : "is-minus"}`}
            style={{
              left: `${axisPercent(point.profitCents, lo, hi)}%`,
              width: size,
              height: size,
            }}
            title={`${point.name} ${Math.round(point.probability * 100)}% ${signedDollars(point.profitCents)}`}
          >
            {labels.has(index) && (
              <em>{Math.round(point.probability * 100)}% {signedDollars(point.profitCents)}</em>
            )}
          </div>
        );
      })}
    </div>
  );
}

function PayoffBars({ points }: { points: PayoffPoint[] }) {
  if (points.length === 0) return null;
  const maxAbs = Math.max(1, ...points.map((point) => Math.abs(point.profitCents)));
  return (
    <div className="preview-paybars">
      {points.map((point) => {
        const width = (Math.abs(point.profitCents) / maxAbs) * 50;
        return (
          <div className="preview-paybar" key={point.name}>
            <span className="preview-paybar__name">{point.name}</span>
            <span className="preview-paybar__odds">{Math.round(point.probability * 100)}%</span>
            <div className="preview-paybar__track">
              <i className="preview-paybar__zero" />
              <i
                className={`preview-paybar__fill ${point.profitCents >= 0 ? "is-plus" : "is-minus"}`}
                style={point.profitCents >= 0
                  ? { left: "50%", width: `${width}%` }
                  : { right: "50%", width: `${width}%` }}
              />
            </div>
            <span className={`preview-paybar__amt ${point.profitCents >= 0 ? "is-plus" : "is-minus"}`}>
              {signedDollars(point.profitCents)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function EvWaterfall({ tu }: { tu: TradeUp }) {
  const wf = evWaterfall(tu);
  if (wf.steps.length === 0) return null;
  const maxAbs = Math.max(1, ...wf.steps.map((step) => Math.abs(step.evContributionCents)), Math.abs(wf.totalEvCents));
  return (
    <div className="preview-waterfall">
      <p className="o-kicker">EV decomposition</p>
      {wf.steps.map((step) => {
        const width = (Math.abs(step.evContributionCents) / maxAbs) * 50;
        return (
          <div className="preview-paybar" key={`ev-${step.name}`}>
            <span className="preview-paybar__name">{step.name}</span>
            <span className="preview-paybar__odds">{Math.round(step.probability * 100)}%</span>
            <div className="preview-paybar__track">
              <i className="preview-paybar__zero" />
              <i
                className={`preview-paybar__fill ${step.evContributionCents >= 0 ? "is-plus" : "is-minus"}`}
                style={step.evContributionCents >= 0
                  ? { left: "50%", width: `${width}%` }
                  : { right: "50%", width: `${width}%` }}
              />
            </div>
            <span className={`preview-paybar__amt ${step.evContributionCents >= 0 ? "is-plus" : "is-minus"}`}>
              {signedDollars(step.evContributionCents)}
            </span>
          </div>
        );
      })}
      <div className="preview-paybar preview-paybar--total">
        <span className="preview-paybar__name">TOTAL EV</span>
        <span className="preview-paybar__odds" />
        <div className="preview-paybar__track">
          <i className="preview-paybar__zero" />
          <i
            className={`preview-paybar__fill ${wf.totalEvCents >= 0 ? "is-plus" : "is-minus"}`}
            style={wf.totalEvCents >= 0
              ? { left: "50%", width: `${(Math.abs(wf.totalEvCents) / maxAbs) * 50}%` }
              : { right: "50%", width: `${(Math.abs(wf.totalEvCents) / maxAbs) * 50}%` }}
          />
        </div>
        <span className={`preview-paybar__amt ${wf.totalEvCents >= 0 ? "is-plus" : "is-minus"}`}>
          {signedDollars(wf.totalEvCents)}
        </span>
      </div>
      {wf.concentrationNote && <p className="preview-waterfall__note">{wf.concentrationNote}</p>}
    </div>
  );
}

function CdfChart({ tu }: { tu: TradeUp }) {
  const cdf = cdfCurve(tu);
  if (cdf.length === 0) return null;
  const data = cdf.map((point) => ({ x: point.x / 100, p: Math.round(point.p * 1000) / 10 }));
  const pProfit = Math.round(chanceOfProfit(payoffPoints(tu)) * 100);
  return (
    <ChartFigure
      title="P(return ≥ x)"
      description={`Chance of profit ${pProfit}%.`}
      captionVisible
      captionClassName="preview-oddsbar__label"
      data={{ columns: ["P/L $", "P ≥ x %"], rows: data.map((row) => [row.x, row.p]) }}
    >
      <div className="preview-cdf">
        <ResponsiveContainer width="100%" height={120}>
          <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--line-soft)" />
            <XAxis dataKey="x" tick={{ fontSize: 11, fill: "var(--text-muted)" }} axisLine={false} tickLine={false} />
            <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: "var(--text-muted)" }} width={28} axisLine={false} tickLine={false} />
            <Tooltip />
            <ReferenceLine x={0} stroke="var(--text-muted)" strokeDasharray="3 3" />
            <Line type="stepAfter" dataKey="p" stroke="var(--text)" strokeWidth={2} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
        <p className="preview-waterfall__note">P(profit ≥ 0) {pProfit}%</p>
      </div>
    </ChartFigure>
  );
}

function ListingRow({ input }: { input: TradeUpInput }) {
  const href = listingUrl(
    input.listing_id,
    input.skin_name,
    input.condition,
    input.float_value,
    input.price_cents,
    input.source,
    input.marketplace_id,
    input.stattrak,
  );
  return (
    <a className="preview-listing" href={href} target="_blank" rel="noopener noreferrer">
      <span className="preview-btn" style={{ minHeight: 22, padding: "2px 6px" }}>{sourceLabel(input.source)}</span>
      <span className="truncate">{input.skin_name}</span>
      <span className="ml-auto tabular-nums">{formatDollars(input.price_cents)}</span>
      <ExternalLink size={12} />
    </a>
  );
}

export function PreviewBoard({
  tradeUps,
  loading,
  isFree,
  onExpand,
  expandedId,
}: {
  tradeUps: TradeUp[];
  loading: boolean;
  isFree: boolean;
  expandedId: number | null;
  onExpand: (id: number | null) => void;
}) {
  const [width, setWidth] = useState(typeof window === "undefined" ? 1280 : window.innerWidth);
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const cols = bentoColumns(width);

  return (
    <div>
      {isFree && <div className="preview-delay">{DELAY_BANNER}</div>}
      <div className="preview-board">
        <div className="flex items-end justify-between gap-4 mb-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Live trade-ups</h1>
            <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
              Built from buyable listings on CSFloat, DMarket, Skinport, and Buff. {cols}-column bento.
            </p>
          </div>
        </div>
        {loading && <p style={{ color: "var(--text-muted)" }}>Loading trade-ups…</p>}
        <div className="preview-bento">
          {tradeUps.map((tu) => {
            const expanded = expandedId === tu.id;
            const inputs = uniqueInputs(tu);
            const outputs = uniqueOutputs(tu);
            const points = payoffPoints(tu);
            const inColor = inputRarityColor(tu.type);
            const outColor = outputRarityColor(tu.type);
            const profitPositive = tu.profit_cents >= 0;
            const chance = points.length > 0 ? chanceOfProfit(points) : (tu.chance_to_profit ?? null);
            const median = medianProfitCents(points);
            const range = worstBest(points);
            const evPnL = tu.expected_value_cents - tu.total_cost_cents;
            return (
              <article
                key={tu.id}
                className={`preview-card ${expanded ? "preview-card--expanded preview-bento__row" : ""}`}
              >
                <div className="preview-card__head">
                  <span className="o-kicker">{rarityLabel(tu.type)}</span>
                  <button
                    type="button"
                    className="preview-btn"
                    onClick={() => onExpand(expanded ? null : tu.id)}
                  >
                    {expanded ? "Collapse" : "Expand"}
                  </button>
                </div>
                <p className="preview-inline">
                  <span>Cost {formatDollars(inputCostCents(tu))}</span>
                  <span>EV {formatDollars(tu.expected_value_cents)}</span>
                  <span style={{ color: profitPositive ? "var(--accent-text)" : "var(--text-muted)" }}>
                    Profit {formatDollars(tu.profit_cents)} · {tu.roi_percentage.toFixed(1)}% ROI
                  </span>
                </p>
                <p className="preview-inline preview-inline--muted">
                  {chance === null
                    ? "Chance of profit —"
                    : `Chance of profit ${Math.round(chance * 100)}%`}
                  {median === null ? " · Median P/L —" : ` · Median P/L ${signedDollars(median)}`}
                  {range
                    ? ` · Worst ${signedDollars(range.worst)} / Best ${signedDollars(range.best)}`
                    : tu.worst_case_cents !== undefined && tu.best_case_cents !== undefined
                      ? ` · Worst ${signedDollars(tu.worst_case_cents)} / Best ${signedDollars(tu.best_case_cents)}`
                      : ""}
                </p>
                {points.length > 0 ? (
                  <>
                    <PayoffStrip points={points} evCents={evPnL} medianCents={median} tall={expanded} />
                    <PayoffBars points={points} />
                  </>
                ) : (
                  <p className="preview-inline preview-inline--muted">Outcomes loading…</p>
                )}
                {inputs.length > 0 && (
                  <div className="preview-skins preview-skins--in">
                    {inputs.map((group) => (
                      <InputTile
                        key={group.name}
                        name={group.name}
                        count={group.count}
                        unitPriceCents={group.unitPriceCents}
                        listings={group.listings}
                        color={inColor}
                        onNeedExpand={() => onExpand(tu.id)}
                      />
                    ))}
                  </div>
                )}
                {outputs.length > 0 && (
                  <div className="preview-skins preview-skins--out">
                    {outputs.map((outcome) => (
                      <OutputTile key={outcome.skin_id + outcome.skin_name} outcome={outcome} color={outColor} />
                    ))}
                  </div>
                )}
                <AnimatePresence initial={false}>
                  {expanded && (
                    <motion.div
                      key="expand"
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
                      style={{ overflow: "hidden" }}
                    >
                      {points.length > 0 && (
                        <div className="preview-expand">
                          <EvWaterfall tu={tu} />
                          <CdfChart tu={tu} />
                        </div>
                      )}
                      <div className="preview-listings">
                        {tu.inputs.map((row) => (
                          <ListingRow key={row.listing_id + row.skin_name} input={row} />
                        ))}
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <a
                          className="preview-btn preview-btn--lime"
                          href={verifyClaimHref(tu.id)}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Verify / Claim
                        </a>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </article>
            );
          })}
        </div>
      </div>
    </div>
  );
}

async function hydrateInputsIfNeeded(tu: TradeUp): Promise<TradeUp> {
  if (tu.inputs.length > 0) return tu;
  try {
    const res = await fetch(`/api/trade-up/${tu.id}/inputs`, { credentials: "include" });
    if (!res.ok) return tu;
    const data = await res.json() as { inputs?: TradeUpInput[] };
    return { ...tu, inputs: data.inputs ?? [] };
  } catch {
    return tu;
  }
}

export function usePreviewTradeUps() {
  const [tradeUps, setTradeUps] = useState<TradeUp[]>([]);
  const [loading, setLoading] = useState(true);
  const [isFree, setIsFree] = useState(true);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/trade-ups?per_page=12&sort=trade_up_score&order=desc", { credentials: "include" });
      const data = await res.json() as { trade_ups?: TradeUp[]; tier?: string };
      const rows = data.trade_ups ?? [];
      setIsFree((data.tier ?? "free") === "free");
      setTradeUps(rows);
      const summaryNames = rows.flatMap((tu) => tu.input_summary?.skins.map((s) => s.name) ?? []);
      await loadFaces(summaryNames, FACE_CACHE);
      const hydrated = await Promise.all(rows.map(async (tu) => {
        const withOutcomes = await hydrateOutcomesIfNeeded(tu);
        return hydrateInputsIfNeeded(withOutcomes);
      }));
      const names = hydrated.flatMap((tu) => [
        ...tu.inputs.map((row) => row.skin_name),
        ...tu.outcomes.map((outcome) => outcome.skin_name),
      ]);
      await loadFaces(names, FACE_CACHE);
      setTradeUps(hydrated);
    } catch {
      setTradeUps([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const onExpand = useCallback(async (id: number | null) => {
    setExpandedId(id);
    if (id == null) return;
    const current = tradeUps.find((t) => t.id === id);
    if (!current) return;
    const withOutcomes = await hydrateOutcomesIfNeeded(current);
    const withInputs = await hydrateInputsIfNeeded(withOutcomes);
    const names = [
      ...withInputs.inputs.map((i) => i.skin_name),
      ...withInputs.outcomes.map((o) => o.skin_name),
    ];
    await loadFaces(names, FACE_CACHE);
    setTradeUps((prev) => prev.map((tu) => (tu.id === id ? withInputs : tu)));
  }, [tradeUps]);

  return useMemo(() => ({ tradeUps, loading, isFree, expandedId, onExpand }), [tradeUps, loading, isFree, expandedId, onExpand]);
}
