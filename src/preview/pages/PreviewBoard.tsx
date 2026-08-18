import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, ExternalLink } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, XAxis, YAxis } from "recharts";
import type { TradeUp, TradeUpInput, TradeUpOutcome } from "../../../shared/types.js";
import { formatDollars, listingUrl, sourceLabel } from "../../utils/format.js";
import { ChartFigure } from "../kit/primitives/chart-figure.js";
import {
  bentoColumns,
  cdfCurve,
  chanceOfProfit,
  conditionShort,
  evDrivers,
  inputCostCents,
  inputListingHrefs,
  inputRarityColor,
  listingTotals,
  medianProfitCents,
  openGroupedListings,
  outputHref,
  outputRarityColor,
  payoffLabelIndexes,
  payoffPoints,
  percentileProfitCents,
  rarityLabel,
  splitSkinName,
  uniqueInputs,
  uniqueOutputs,
  verifyClaimHref,
  waterfallBars,
  worstBest,
  type PayoffPoint,
} from "../lib/board.js";
import { DELAY_BANNER } from "../lib/copy.js";
import { createFaceCache, faceFor, hydrateOutcomesIfNeeded, loadFaces } from "../lib/skin-images.js";

const FACE_CACHE = createFaceCache();

/** Outcome rows shown on a collapsed card before it rolls up the tail. */
const COLLAPSED_BARS = 4;

function signedDollars(cents: number): string {
  return cents > 0 ? `+${formatDollars(cents)}` : formatDollars(cents);
}

function signClass(cents: number): string {
  return cents >= 0 ? "is-plus" : "is-minus";
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

function SkinLabel({ name }: { name: string }) {
  const { weapon, finish } = splitSkinName(name);
  return (
    <span className="preview-skin__label">
      {weapon && <em>{weapon}</em>}
      <b>{finish}</b>
    </span>
  );
}

function SkinTile({
  name,
  rarity,
  variant,
  index,
  leadBadge,
  trailBadge,
  wear,
  href,
  onClick,
}: {
  name: string;
  rarity: string;
  variant: "input" | "output";
  index?: number;
  leadBadge?: string;
  trailBadge?: string;
  wear?: string;
  href?: string;
  onClick?: () => void;
}) {
  const body = (
    <>
      <span className="preview-skin__art">
        <SkinFace name={name} />
      </span>
      {index !== undefined && <span className="preview-skin__index">{String(index).padStart(2, "0")}</span>}
      {leadBadge && <span className="preview-skin__lead">{leadBadge}</span>}
      {trailBadge && <span className="preview-skin__trail">{trailBadge}</span>}
      {wear && <span className="preview-skin__wear">{wear}</span>}
      <SkinLabel name={name} />
    </>
  );
  const style = { "--skin-tint": rarity } as CSSProperties;
  const className = `preview-skin preview-skin--${variant}`;
  if (href) {
    return (
      <a
        className={className}
        style={style}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        title={name}
        onClick={(event) => event.stopPropagation()}
      >
        {body}
      </a>
    );
  }
  return (
    <button
      type="button"
      className={className}
      style={style}
      title={name}
      onClick={(event) => {
        event.stopPropagation();
        onClick?.();
      }}
    >
      {body}
    </button>
  );
}

function InputTile({
  name,
  count,
  unitPriceCents,
  condition,
  listings,
  rarity,
  onNeedExpand,
}: {
  name: string;
  count: number;
  unitPriceCents: number;
  condition?: string;
  listings: TradeUpInput[];
  rarity: string;
  onNeedExpand: () => void;
}) {
  const hrefs = inputListingHrefs(listings);
  return (
    <SkinTile
      name={name}
      rarity={rarity}
      variant="input"
      leadBadge={unitPriceCents > 0 ? formatDollars(unitPriceCents) : undefined}
      trailBadge={`×${count}`}
      wear={conditionShort(condition)}
      onClick={() => {
        if (hrefs.length === 0) {
          onNeedExpand();
          return;
        }
        const result = openGroupedListings(hrefs, (url, target) => window.open(url, target));
        if (result.blocked.length > 0) onNeedExpand();
      }}
    />
  );
}

function OutputTile({ outcome, rarity }: { outcome: TradeUpOutcome; rarity: string }) {
  return (
    <SkinTile
      name={outcome.skin_name}
      rarity={rarity}
      variant="output"
      href={outputHref(outcome)}
      leadBadge={formatDollars(outcome.estimated_price_cents)}
      trailBadge={`${Math.round(outcome.probability * 100)}%`}
      wear={conditionShort(outcome.predicted_condition)}
    />
  );
}

/**
 * Every outcome placed on one P/L axis: x is profit, dot area is probability,
 * with the break-even, EV and median reads marked on the same scale.
 */
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
  const pad = Math.max((max - min) * 0.12, 50);
  const lo = min - pad;
  const hi = max + pad;
  const [probIdx, absIdx] = payoffLabelIndexes(points);
  const maxP = Math.max(...points.map((point) => point.probability), 0.01);
  return (
    <ChartFigure
      title="Outcome payoff by probability"
      description="Each outcome placed on the profit and loss axis, sized by its probability."
      data={{
        columns: ["Outcome", "Probability %", "P/L $"],
        rows: points.map((point) => [point.name, Math.round(point.probability * 1000) / 10, point.profitCents / 100]),
      }}
    >
      <div className={`preview-payoff ${tall ? "preview-payoff--tall" : ""}`}>
        <div className="preview-payoff__wash" />
        <div className="preview-payoff__axis" />
        <div className="preview-payoff__mark is-zero" style={{ left: `${axisPercent(0, lo, hi)}%` }}>
          <span>break-even</span>
        </div>
        <div className="preview-payoff__mark is-ev" style={{ left: `${axisPercent(evCents, lo, hi)}%` }}>
          <span>EV {signedDollars(evCents)}</span>
        </div>
        {medianCents !== null && (
          <div className="preview-payoff__mark is-med" style={{ left: `${axisPercent(medianCents, lo, hi)}%` }}>
            <span>median</span>
          </div>
        )}
        {points.map((point, index) => {
          const size = 9 + (point.probability / maxP) * 13;
          const label = index === probIdx ? "over" : index === absIdx ? "under" : null;
          return (
            <div
              key={point.name}
              className={`preview-payoff__dot ${signClass(point.profitCents)}`}
              style={{
                left: `${axisPercent(point.profitCents, lo, hi)}%`,
                width: size,
                height: size,
              }}
              title={`${point.name} · ${Math.round(point.probability * 100)}% · ${signedDollars(point.profitCents)}`}
            >
              {label && (
                <em data-side={label}>
                  {Math.round(point.probability * 100)}% {signedDollars(point.profitCents)}
                </em>
              )}
            </div>
          );
        })}
        <span className="preview-payoff__end is-lo">{signedDollars(Math.round(lo))}</span>
        <span className="preview-payoff__end is-hi">{signedDollars(Math.round(hi))}</span>
      </div>
    </ChartFigure>
  );
}

function PayoffBars({ points, limit }: { points: PayoffPoint[]; limit?: number }) {
  if (points.length === 0) return null;
  const maxAbs = Math.max(1, ...points.map((point) => Math.abs(point.profitCents)));
  const ranked = [...points].sort((a, b) => b.probability - a.probability);
  const shown = limit ? ranked.slice(0, limit) : ranked;
  const hidden = ranked.length - shown.length;
  return (
    <div className="preview-paybars">
      {shown.map((point) => {
        const width = (Math.abs(point.profitCents) / maxAbs) * 50;
        return (
          <div className="preview-paybar" key={point.name}>
            <span className="preview-paybar__name" title={point.name}>{point.name}</span>
            <span className="preview-paybar__odds">{Math.round(point.probability * 100)}%</span>
            <div className="preview-paybar__track">
              <i className="preview-paybar__zero" />
              <i
                className={`preview-paybar__fill ${signClass(point.profitCents)}`}
                style={point.profitCents >= 0
                  ? { left: "50%", width: `${width}%` }
                  : { right: "50%", width: `${width}%` }}
              />
            </div>
            <span className={`preview-paybar__amt ${signClass(point.profitCents)}`}>
              {signedDollars(point.profitCents)}
            </span>
          </div>
        );
      })}
      {hidden > 0 && (
        <p className="preview-note">
          +{hidden} further outcome{hidden === 1 ? "" : "s"} — expand for the full decomposition
        </p>
      )}
    </div>
  );
}

/** Cumulative p·profit walk. Lifts first, drags after, closing on total EV. */
function EvWaterfall({ tu }: { tu: TradeUp }) {
  const { bars, totalEvCents } = waterfallBars(tu);
  if (bars.length === 0) return null;
  const levels = [0, totalEvCents, ...bars.map((bar) => bar.startCents), ...bars.map((bar) => bar.endCents)];
  const min = Math.min(...levels);
  const max = Math.max(...levels);
  const pad = Math.max((max - min) * 0.18, 40);
  const lo = min - pad;
  const hi = max + pad;
  const y = (value: number) => `${100 - axisPercent(value, lo, hi)}%`;
  const height = (a: number, b: number) => `${Math.max(Math.abs(axisPercent(a, lo, hi) - axisPercent(b, lo, hi)), 0.8)}%`;
  const columns = bars.length + 1;
  return (
    <ChartFigure
      title="EV contribution by outcome"
      description="Probability-weighted profit and loss of each outcome, walked to total EV."
      captionVisible
      captionClassName="preview-panel__title"
      data={{
        columns: ["Outcome", "Probability %", "EV contribution $"],
        rows: [
          ...bars.map((bar) => [bar.name, Math.round(bar.probability * 1000) / 10, bar.evContributionCents / 100]),
          ["Total EV", 100, totalEvCents / 100],
        ],
      }}
    >
      <div className="preview-wf" style={{ "--wf-cols": columns } as CSSProperties}>
        <div className="preview-wf__plot">
          <i className="preview-wf__grid" style={{ top: y(max) }} />
          <i className="preview-wf__zero" style={{ top: y(0) }} />
          {bars.map((bar, index) => {
            const top = Math.min(bar.startCents, bar.endCents);
            const bottom = Math.max(bar.startCents, bar.endCents);
            const up = bar.evContributionCents >= 0;
            return (
              <div className="preview-wf__col" key={`wf-${bar.name}`} style={{ "--wf-i": index } as CSSProperties}>
                <i
                  className={`preview-wf__bar ${signClass(bar.evContributionCents)}`}
                  style={{ top: y(bottom), height: height(top, bottom) }}
                  title={`${bar.name} · ${signedDollars(bar.evContributionCents)}`}
                />
                <em className="preview-wf__value" style={{ top: y(bar.endCents), transform: up ? "translateY(-100%)" : "none" }}>
                  {signedDollars(bar.evContributionCents)}
                </em>
                <i className="preview-wf__link" style={{ top: y(bar.endCents) }} />
              </div>
            );
          })}
          <div className="preview-wf__col is-total" style={{ "--wf-i": bars.length } as CSSProperties}>
            <i
              className={`preview-wf__bar is-total ${signClass(totalEvCents)}`}
              style={{ top: y(Math.max(0, totalEvCents)), height: height(0, totalEvCents) }}
            />
            <em className="preview-wf__value" style={{ top: y(Math.max(0, totalEvCents)), transform: "translateY(-100%)" }}>
              {signedDollars(totalEvCents)}
            </em>
          </div>
        </div>
        <div className="preview-wf__ticks">
          {bars.map((bar) => (
            <span key={`tick-${bar.name}`} title={bar.name}>{splitSkinName(bar.name).finish || bar.name}</span>
          ))}
          <span className="is-total">Total EV</span>
        </div>
      </div>
    </ChartFigure>
  );
}

function CdfChart({ tu, points }: { tu: TradeUp; points: PayoffPoint[] }) {
  const cdf = cdfCurve(tu);
  if (cdf.length === 0) return null;
  const data = cdf.map((point) => ({ x: point.x / 100, p: Math.round(point.p * 1000) / 10 }));
  const pProfit = Math.round(chanceOfProfit(points) * 100);
  return (
    <ChartFigure
      title="Probability of clearing a P/L"
      description={`Step curve of P(return ≥ x). Chance of profit ${pProfit}%.`}
      captionVisible
      captionClassName="preview-panel__title"
      data={{ columns: ["P/L $", "P ≥ x %"], rows: data.map((row) => [row.x, row.p]) }}
    >
      <div className="preview-cdf">
        <ResponsiveContainer width="100%" height={168}>
          <AreaChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="pv-cdf-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--series-2)" stopOpacity={0.34} />
                <stop offset="100%" stopColor="var(--series-2)" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="var(--line-soft)" />
            <XAxis
              dataKey="x"
              type="number"
              domain={["dataMin", "dataMax"]}
              tick={{ fontSize: 10, fill: "var(--text-muted)", fontFamily: "var(--font-mono)" }}
              tickFormatter={(value: number) => (value >= 0 ? `+$${value.toFixed(0)}` : `-$${Math.abs(value).toFixed(0)}`)}
              axisLine={false}
              tickLine={false}
              height={18}
            />
            <YAxis
              domain={[0, 100]}
              ticks={[0, 25, 50, 75, 100]}
              tick={{ fontSize: 10, fill: "var(--text-muted)", fontFamily: "var(--font-mono)" }}
              tickFormatter={(value: number) => `${value}%`}
              width={34}
              axisLine={false}
              tickLine={false}
            />
            <ReferenceLine x={0} stroke="var(--line-hard)" strokeDasharray="3 3" />
            <Area
              type="stepAfter"
              dataKey="p"
              stroke="var(--series-2)"
              strokeWidth={2.5}
              fill="url(#pv-cdf-fill)"
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
        <p className="preview-note">
          Break-even or better on <b>{pProfit}%</b> of rolls.
        </p>
      </div>
    </ChartFigure>
  );
}

function Readout({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: string }) {
  return (
    <div className="preview-readout">
      <em>{label}</em>
      <b className={tone}>{value}</b>
      {note && <small>{note}</small>}
    </div>
  );
}

function RankedList({ title, points, empty }: { title: string; points: PayoffPoint[]; empty: string }) {
  return (
    <div className="preview-rank">
      <p className="preview-panel__title">{title}</p>
      {points.length === 0 && <p className="preview-note">{empty}</p>}
      {points.map((point, index) => (
        <div className="preview-rank__row" key={`${title}-${point.name}`}>
          <span className="preview-rank__n">{index + 1}</span>
          <span className="preview-rank__name" title={point.name}>{point.name}</span>
          <span className="preview-rank__odds">{Math.round(point.probability * 100)}%</span>
          <span className={`preview-rank__amt ${signClass(point.evContributionCents)}`}>
            {signedDollars(point.evContributionCents)}
          </span>
        </div>
      ))}
    </div>
  );
}

function ListingRow({ input, index }: { input: TradeUpInput; index: number }) {
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
  const { weapon, finish } = splitSkinName(input.skin_name);
  return (
    <a className="preview-listing" href={href} target="_blank" rel="noopener noreferrer">
      <span className="preview-listing__n">{String(index + 1).padStart(2, "0")}</span>
      <span className="preview-listing__name">
        {weapon && <em>{weapon}</em>}
        <b>{finish}</b>
      </span>
      <span className="preview-chip" data-source={input.source}>{sourceLabel(input.source)}</span>
      <span className="preview-listing__price">{formatDollars(input.price_cents)}</span>
      <ExternalLink size={11} aria-hidden />
    </a>
  );
}

function Panel({ title, meta, children, className }: {
  title: string;
  meta?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`preview-panel ${className ?? ""}`}>
      <header className="preview-panel__head">
        <p className="preview-panel__title">{title}</p>
        {meta && <span className="preview-panel__meta">{meta}</span>}
      </header>
      {children}
    </section>
  );
}

export function TradeUpCard({
  tu,
  expanded,
  onExpand,
}: {
  tu: TradeUp;
  expanded: boolean;
  onExpand: (id: number | null) => void;
}) {
  const inputs = uniqueInputs(tu);
  const outputs = uniqueOutputs(tu);
  const points = payoffPoints(tu);
  const inColor = inputRarityColor(tu.type);
  const outColor = outputRarityColor(tu.type);
  const chance = points.length > 0 ? chanceOfProfit(points) : (tu.chance_to_profit ?? null);
  const median = medianProfitCents(points);
  const tail = percentileProfitCents(points, 0.1);
  const range = worstBest(points);
  const worst = range ? range.worst : tu.worst_case_cents ?? null;
  const best = range ? range.best : tu.best_case_cents ?? null;
  const evPnL = tu.expected_value_cents - tu.total_cost_cents;
  const { drivers, drags } = evDrivers(points, 4);
  const totals = listingTotals(tu.inputs);

  return (
    <article
      className={`preview-card ${expanded ? "preview-card--expanded preview-bento__row" : ""}`}
      style={{ "--card-tint": outColor } as CSSProperties}
    >
      <header className="preview-card__head">
        <span className="preview-rarity" style={{ "--skin-tint": outColor } as CSSProperties}>
          <i />
          {rarityLabel(tu.type)}
        </span>
        <span className="preview-card__flow">
          <span style={{ color: inColor }}>{rarityLabel(tu.type) === "Knife / Gloves" ? "Covert" : "inputs"}</span>
          <ArrowRight size={11} aria-hidden />
          <span style={{ color: outColor }}>{rarityLabel(tu.type)}</span>
        </span>
        <button
          type="button"
          className="preview-btn preview-btn--quiet"
          onClick={() => onExpand(expanded ? null : tu.id)}
        >
          {expanded ? "Collapse" : "Expand"}
        </button>
      </header>

      <div className="preview-figures">
        <div>
          <em>Cost</em>
          <b>{formatDollars(inputCostCents(tu))}</b>
        </div>
        <div>
          <em>EV</em>
          <b>{formatDollars(tu.expected_value_cents)}</b>
        </div>
        <div className="preview-figures__profit">
          <em>Profit</em>
          <b className={signClass(tu.profit_cents)}>
            {signedDollars(tu.profit_cents)}
            <small>{tu.roi_percentage >= 0 ? "+" : ""}{tu.roi_percentage.toFixed(1)}% ROI</small>
          </b>
        </div>
      </div>

      <p className="preview-substats">
        <span>Chance of profit <b>{chance === null ? "—" : `${Math.round(chance * 100)}%`}</b></span>
        <span>Median <b className={median === null ? "" : signClass(median)}>{median === null ? "—" : signedDollars(median)}</b></span>
        <span>Worst <b className={worst === null ? "" : signClass(worst)}>{worst === null ? "—" : signedDollars(worst)}</b></span>
        <span>Best <b className={best === null ? "" : signClass(best)}>{best === null ? "—" : signedDollars(best)}</b></span>
      </p>

      {points.length > 0 ? (
        <>
          <PayoffStrip points={points} evCents={evPnL} medianCents={median} tall={expanded} />
          {!expanded && <PayoffBars points={points} limit={COLLAPSED_BARS} />}
        </>
      ) : (
        <div className="preview-payoff preview-payoff--empty">
          <span className="preview-note">Outcomes loading…</span>
        </div>
      )}

      {!expanded && inputs.length > 0 && (
        <div className="preview-lane">
          <p className="preview-lane__label">
            Inputs<i style={{ background: inColor }} />
          </p>
          <div className="preview-skins preview-skins--in">
            {inputs.map((group) => (
              <InputTile
                key={group.name}
                name={group.name}
                count={group.count}
                unitPriceCents={group.unitPriceCents}
                condition={group.listings[0]?.condition}
                listings={group.listings}
                rarity={inColor}
                onNeedExpand={() => onExpand(tu.id)}
              />
            ))}
          </div>
        </div>
      )}
      {!expanded && outputs.length > 0 && (
        <div className="preview-lane">
          <p className="preview-lane__label">
            Outputs<i style={{ background: outColor }} />
          </p>
          <div className="preview-skins preview-skins--out">
            {outputs.map((outcome) => (
              <OutputTile key={outcome.skin_id + outcome.skin_name} outcome={outcome} rarity={outColor} />
            ))}
          </div>
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
            <div className="preview-expand">
              <Panel
                className="preview-expand__inputs"
                title="Inputs"
                meta={`${totals.count || inputs.reduce((sum, group) => sum + group.count, 0)} skins · ${formatDollars(inputCostCents(tu))}`}
              >
                <div className="preview-skins preview-skins--in">
                  {tu.inputs.length > 0
                    ? tu.inputs.map((row, index) => (
                        <SkinTile
                          key={`${row.listing_id}-${row.skin_name}-${index}`}
                          name={row.skin_name}
                          rarity={inColor}
                          variant="input"
                          index={index + 1}
                          leadBadge={formatDollars(row.price_cents)}
                          wear={conditionShort(row.condition)}
                          href={listingUrl(
                            row.listing_id,
                            row.skin_name,
                            row.condition,
                            row.float_value,
                            row.price_cents,
                            row.source,
                            row.marketplace_id,
                            row.stattrak,
                          )}
                        />
                      ))
                    : inputs.map((group) => (
                        <InputTile
                          key={group.name}
                          name={group.name}
                          count={group.count}
                          unitPriceCents={group.unitPriceCents}
                          condition={group.listings[0]?.condition}
                          listings={group.listings}
                          rarity={inColor}
                          onNeedExpand={() => onExpand(tu.id)}
                        />
                      ))}
                </div>
                <p className="preview-panel__title preview-panel__title--sub">Outputs</p>
                <div className="preview-skins preview-skins--out">
                  {outputs.map((outcome) => (
                    <OutputTile key={outcome.skin_id + outcome.skin_name} outcome={outcome} rarity={outColor} />
                  ))}
                </div>
              </Panel>

              <div className="preview-expand__viz">
                <div className="preview-readouts">
                  <Readout label="Expected P/L" value={signedDollars(evPnL)} note={`${tu.roi_percentage.toFixed(1)}% ROI`} tone={signClass(evPnL)} />
                  <Readout label="Median P/L" value={median === null ? "—" : signedDollars(median)} note="50th percentile" tone={median === null ? "" : signClass(median)} />
                  <Readout label="Chance of profit" value={chance === null ? "—" : `${Math.round(chance * 100)}%`} note="P(P/L > $0)" />
                  <Readout label="Worst case" value={worst === null ? "—" : signedDollars(worst)} note="lowest outcome" tone={worst === null ? "" : signClass(worst)} />
                  <Readout label="Best case" value={best === null ? "—" : signedDollars(best)} note="highest outcome" tone={best === null ? "" : signClass(best)} />
                  <Readout label="P10 tail" value={tail === null ? "—" : signedDollars(tail)} note="10% worst rolls" tone={tail === null ? "" : signClass(tail)} />
                </div>
                <div className="preview-viz-grid">
                  <div className="preview-subpanel">
                    <EvWaterfall tu={tu} />
                  </div>
                  <div className="preview-subpanel">
                    <CdfChart tu={tu} points={points} />
                  </div>
                </div>
                <div className="preview-viz-grid">
                  <div className="preview-subpanel">
                    <RankedList title="Top EV drivers" points={drivers} empty="No positive contributors." />
                  </div>
                  <div className="preview-subpanel">
                    <RankedList title="Largest drags" points={drags} empty="No negative contributors." />
                  </div>
                </div>
              </div>

              <Panel
                className="preview-expand__listings"
                title="Listings"
                meta={totals.count > 0 ? `${totals.count} · ${formatDollars(totals.totalCents)}` : "loading"}
              >
                <div className="preview-listings">
                  {tu.inputs.map((row, index) => (
                    <ListingRow key={`${row.listing_id}-${row.skin_name}-${index}`} input={row} index={index} />
                  ))}
                </div>
                <dl className="preview-totals">
                  <div>
                    <dt>Average price</dt>
                    <dd>{formatDollars(totals.averageCents)}</dd>
                  </div>
                  <div>
                    <dt>Total cost</dt>
                    <dd>{formatDollars(totals.totalCents || inputCostCents(tu))}</dd>
                  </div>
                </dl>
                <a
                  className="preview-btn preview-btn--lime preview-btn--block"
                  href={verifyClaimHref(tu.id)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Verify / Claim trade-up
                </a>
                <p className="preview-note">Opens the live trade-up on tradeupbot.app.</p>
              </Panel>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </article>
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
    <div className="preview-board">
      <header className="preview-board__head">
        <div>
          <h1>Live trade-ups</h1>
          <p>Built from listings you can buy right now on CSFloat, DMarket, Skinport, and Buff.</p>
        </div>
        <div className="preview-board__meta">
          <span>{tradeUps.length} ranked</span>
          <i />
          <span>{cols}-column</span>
        </div>
      </header>
      {isFree && (
        <p className="preview-delay">
          <span className="preview-chip preview-chip--accent">Free</span>
          {DELAY_BANNER}
        </p>
      )}
      {loading && <p className="preview-note">Loading trade-ups…</p>}
      <div className="preview-bento">
        {tradeUps.map((tu) => (
          <TradeUpCard key={tu.id} tu={tu} expanded={expandedId === tu.id} onExpand={onExpand} />
        ))}
      </div>
    </div>
  );
}

/** Warms the shared face cache for a fixed set of names (landing device mock). */
export function useFaces(names: string[]): void {
  const key = names.join("|");
  const [, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    void loadFaces(key.split("|").filter(Boolean), FACE_CACHE).then(() => {
      if (live) setTick((tick) => tick + 1);
    });
    return () => { live = false; };
  }, [key]);
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
