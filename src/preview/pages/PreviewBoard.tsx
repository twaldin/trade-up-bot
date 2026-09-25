import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, ChevronDown, ChevronUp, ExternalLink } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, XAxis, YAxis } from "recharts";
import type { TradeUp, TradeUpInput, TradeUpOutcome } from "../../../shared/types.js";
import { tradeUpPair } from "../../../shared/copy.js";
import { TRADE_UPS_DOCUMENT_TITLE } from "../../../shared/types.js";
import { formatDollars, sourceLabel } from "../../utils/format.js";
import { collectionSlugFromPath, trackTradeUpDetailOpen, trackVerifyClick } from "../../lib/conversions.js";
import {
  bentoColumns,
  cdfCurve,
  chanceOfProfit,
  conditionShort,
  evDrivers,
  formatFloat,
  formatOdds,
  inputCostCents,
  inputListingHref,
  inputListingHrefs,
  inputRarityColor,
  inputRarityLabel,
  listingTotals,
  medianProfitCents,
  openGroupedListings,
  outputHref,
  outputRarityColor,
  payoffPoints,
  percentileProfitCents,
  previewSkinHref,
  rarityLabel,
  reorderForExpanded,
  signClass,
  splitSkinName,
  uniqueInputs,
  uniqueOutputs,
  verifyClaimHref,
  waterfallBars,
  worstBest,
  type PayoffPoint,
} from "../lib/board.js";
import {
  boardQueryString,
  DEFAULT_QUERY,
  isDefaultQuery,
  PreviewFilters,
  type BoardQuery,
} from "../components/PreviewFilters.js";
import { BoardNotice } from "../components/BoardNotice.js";
import { EXPECTED_PL_TOOLTIP, ExpectedPlHelp, showExpectedPlHelp } from "../components/ExpectedPlHelp.js";
import { boardNotice } from "../lib/board-notice.js";
import { readBoardLocation, replaceBoardUrl } from "../lib/board-url.js";
import { TYPING_IDLE_MS } from "../lib/empty-suggestions.js";
import { useLoosenProbe } from "../lib/use-loosen-probe.js";
import { cacheNames, PreviewSearch } from "../components/PreviewSearch.js";
import { chipsToBoardParams, parseQuery, type ParsedQuery } from "../lib/query-parse.js";
import { boardListUrl, loadBoardRows } from "../lib/board-load.js";
import {
  applyRateLimit,
  RATE_LIMIT_MANUAL_COPY,
  noteRateLimited,
  rateLimitCopy,
  canLoadMore,
  pageIsShort,
  reachedTotal,
  readPagedJson,
} from "../lib/page-fetch.js";
import {
  DELAY_BANNER,
  LABEL_AFTER_FEES,
  LABEL_EXPECTED_PL,
  LABEL_EXPECTED_VALUE,
  LABEL_ABOVE_COST,
  NOTE_OF_OUTCOMES,
  NOTE_WORST_OUTCOMES,
} from "../lib/copy.js";
import { TRADE_UPS_FAQ } from "../../../shared/trade-ups-faq.js";
import { boardFeeLine } from "../lib/fees.js";
import { FeeLine } from "../components/FeeLine.js";
import { hydrateBoardCard, type HydratedTradeUp } from "../lib/board-hydrate.js";
import { createFaceCache, faceFor, loadFaces } from "../lib/skin-images.js";

const FACE_CACHE = createFaceCache();

/** Filter and sort edits wait this long so a burst becomes one list request. */
export const FILTER_SETTLE_MS = 350;

/** Shared with the my-trade-ups page so claim cards and table faces share one cache. */
export function warmBoardFaces(names: string[]): Promise<void> {
  return loadFaces(names, FACE_CACHE).then(() => undefined);
}

export function boardFaceFor(name: string): string | null {
  return faceFor(FACE_CACHE, name);
}

export function signedDollars(cents: number): string {
  return cents > 0 ? `+${formatDollars(cents)}` : formatDollars(cents);
}

function axisPercent(value: number, lo: number, hi: number): number {
  const span = hi - lo;
  if (span <= 0) return 50;
  return ((value - lo) / span) * 100;
}

function stop(event: { stopPropagation: () => void }) {
  event.stopPropagation();
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

/**
 * A tile is two targets: the art buys this exact float on its marketplace, the
 * name opens the skin data page inside the preview shell.
 */
function SkinTile({
  name,
  rarity,
  variant,
  index,
  lead,
  trail,
  wear,
  float,
  delta,
  deltaTone,
  buyHref,
  onBuy,
  hot,
  onHover,
}: {
  name: string;
  rarity: string;
  variant: "input" | "output";
  index?: number;
  lead?: string;
  trail?: string;
  wear?: string;
  float?: string | null;
  delta?: string;
  deltaTone?: string;
  buyHref?: string;
  onBuy?: () => void;
  hot?: boolean;
  onHover?: (name: string | null) => void;
}) {
  const { weapon, finish } = splitSkinName(name);
  const art = (
    <>
      <span className="preview-skin__art">
        <SkinFace name={name} />
      </span>
      {index !== undefined && <span className="preview-skin__index">{String(index).padStart(2, "0")}</span>}
      {lead && <span className="preview-skin__lead">{lead}</span>}
      {trail && <span className="preview-skin__trail">{trail}</span>}
      {float && <span className="preview-skin__float">{float}</span>}
      {wear && <span className="preview-skin__wear">{wear}</span>}
    </>
  );
  return (
    <div
      className={`preview-skin preview-skin--${variant} ${hot ? "is-hot" : ""}`}
      style={{ "--skin-tint": rarity } as CSSProperties}
      onMouseEnter={() => onHover?.(name)}
      onMouseLeave={() => onHover?.(null)}
    >
      {buyHref ? (
        <a
          className="preview-skin__buy"
          href={buyHref}
          target="_blank"
          rel="noopener noreferrer"
          title={`Buy this float on the marketplace — ${name}`}
          onClick={stop}
        >
          {art}
        </a>
      ) : (
        <button
          type="button"
          className="preview-skin__buy"
          title={`Open the live listings for ${name}`}
          onClick={(event) => {
            stop(event);
            onBuy?.();
          }}
        >
          {art}
        </button>
      )}
      <Link
        className="preview-skin__label"
        to={previewSkinHref(name)}
        title={`${name} — skin data`}
        onClick={stop}
      >
        <em>{weapon}</em>
        <b>{finish}</b>
        {delta && <span className={`preview-skin__delta ${deltaTone ?? ""}`}>{delta}</span>}
      </Link>
    </div>
  );
}

function InputTile({
  group,
  rarity,
  onNeedExpand,
  hot,
  onHover,
}: {
  group: ReturnType<typeof uniqueInputs>[number];
  rarity: string;
  onNeedExpand: () => void;
  hot?: boolean;
  onHover?: (name: string | null) => void;
}) {
  const hrefs = inputListingHrefs(group.listings);
  const float = formatFloat(group.avgFloat);
  const wear = conditionShort(group.condition ?? undefined);
  return (
    <SkinTile
      name={group.name}
      rarity={rarity}
      variant="input"
      lead={group.unitPriceCents > 0 ? formatDollars(group.unitPriceCents) : undefined}
      trail={`×${group.count}`}
      wear={wear}
      float={float}
      hot={hot}
      onHover={onHover}
      onBuy={() => {
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

export function OutputTile({
  outcome,
  rarity,
  costCents,
  hot,
  onHover,
}: {
  outcome: TradeUpOutcome;
  rarity: string;
  costCents: number;
  hot?: boolean;
  onHover?: (name: string | null) => void;
}) {
  const float = formatFloat(outcome.predicted_float);
  const wear = conditionShort(outcome.predicted_condition);
  const delta = outcome.estimated_price_cents - costCents;
  return (
    <SkinTile
      name={outcome.skin_name}
      rarity={rarity}
      variant="output"
      buyHref={outputHref(outcome)}
      lead={formatDollars(outcome.estimated_price_cents)}
      trail={formatOdds(outcome.probability)}
      delta={signedDollars(delta)}
      deltaTone={signClass(delta)}
      wear={wear}
      float={float}
      hot={hot}
      onHover={onHover}
    />
  );
}

function FlowRow({
  inputLabel,
  outputLabel,
  inputColor,
  outputColor,
  inputs,
  outputs,
}: {
  inputLabel: string;
  outputLabel: string;
  inputColor: string;
  outputColor: string;
  inputs: ReactNode;
  outputs: ReactNode;
}) {
  return (
    <div className="preview-flow">
      <section className="preview-flow__side">
        <p className="preview-lane__label">{inputLabel}<i style={{ background: inputColor }} /></p>
        <div className="preview-skins preview-skins--in">{inputs}</div>
      </section>
      <span className="preview-flow__arrow" aria-hidden>
        <ArrowRight size={14} />
      </span>
      <section className="preview-flow__side">
        <p className="preview-lane__label">{outputLabel}<i style={{ background: outputColor }} /></p>
        <div className="preview-skins preview-skins--out">{outputs}</div>
      </section>
    </div>
  );
}

function Figure({ label, note, children }: { label: string; note?: ReactNode; children: ReactNode }) {
  return (
    <figure className="preview-figure">
      <figcaption className="o-kicker">{label}</figcaption>
      {children}
      {note && <p className="preview-note">{note}</p>}
    </figure>
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
  return (
    <Figure
      label="EV contribution (p × P/L)"
      note={<>Each bar is its outcome's probability times its profit or loss, walked to the expected profit.</>}
    >
      <div
        className="preview-wf"
        style={{ "--wf-cols": bars.length + 1 } as CSSProperties}
        role="img"
        aria-label={`Probability-weighted contribution of each outcome, closing on an expected profit of ${signedDollars(totalEvCents)}`}
      >
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
          <div className="preview-wf__col" style={{ "--wf-i": bars.length } as CSSProperties}>
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
            <span key={`tick-${bar.name}`} title={bar.name}>
              <i className="preview-wf__face"><SkinFace name={bar.name} /></i>
              {splitSkinName(bar.name).finish || bar.name}
            </span>
          ))}
          <span className="is-total">Expected profit</span>
        </div>
      </div>
    </Figure>
  );
}

function CdfChart({ tu, points }: { tu: TradeUp; points: PayoffPoint[] }) {
  const cdf = cdfCurve(tu);
  if (cdf.length === 0) return null;
  const data = cdf.map((point) => ({ x: point.x / 100, p: Math.round(point.p * 1000) / 10 }));
  const pProfit = formatOdds(chanceOfProfit(points));
  const xs = data.map((row) => row.x);
  const span = Math.max(...xs) - Math.min(...xs);
  // A $0.60-wide P/L range rounded to whole dollars prints "+$9" four times.
  const decimals = span >= 40 ? 0 : span >= 4 ? 1 : 2;
  const money = (value: number) => `${value < 0 ? "-" : "+"}$${Math.abs(value).toFixed(decimals)}`;
  return (
    <Figure
      label="Probability of clearing a P/L"
      note={<>Above cost in <b>{pProfit}</b> of outcomes.</>}
    >
      <div className="preview-cdf" role="img" aria-label={`Share of outcomes at or above each profit-and-loss level. ${pProfit} of outcomes are above cost.`}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 14, right: 10, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="pv-cdf-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.5} />
                <stop offset="100%" stopColor="var(--accent)" stopOpacity={0.04} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="var(--line-soft)" />
            <XAxis
              dataKey="x"
              type="number"
              domain={["dataMin", "dataMax"]}
              tick={{ fontSize: 10, fill: "var(--text-muted)", fontFamily: "var(--font-mono)" }}
              tickFormatter={money}
              axisLine={false}
              tickLine={false}
              height={18}
              minTickGap={24}
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
            <ReferenceLine x={0} stroke="var(--loss)" strokeDasharray="3 3" />
            <Area
              type="stepAfter"
              dataKey="p"
              stroke="var(--profit-edge)"
              strokeWidth={2.5}
              fill="url(#pv-cdf-fill)"
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </Figure>
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
      <p className="o-kicker">{title}</p>
      {points.length === 0 && <p className="preview-note">{empty}</p>}
      {points.map((point, index) => (
        <div className="preview-rank__row" key={`${title}-${point.name}`}>
          <span className="preview-rank__n">{index + 1}</span>
          <i className="preview-rank__face"><SkinFace name={point.name} /></i>
          <Link className="preview-rank__name" to={previewSkinHref(point.name)} title={point.name} onClick={stop}>
            {point.name}
          </Link>
          <span className="preview-rank__odds">{formatOdds(point.probability)}</span>
          <span className={`preview-rank__amt ${signClass(point.evContributionCents)}`}>
            {signedDollars(point.evContributionCents)}
          </span>
        </div>
      ))}
    </div>
  );
}

function ListingRow({ input, index }: { input: TradeUpInput; index: number }) {
  const href = inputListingHref(input);
  const { weapon, finish } = splitSkinName(input.skin_name);
  const float = formatFloat(input.float_value);
  const body = (
    <>
      <span className="preview-listing__n">{String(index + 1).padStart(2, "0")}</span>
      <span className="preview-listing__name">
        {weapon && <em>{weapon}</em>}
        <b>{finish}</b>
      </span>
      {input.source ? <span className="preview-chip">{sourceLabel(input.source)}</span> : null}
      <span className="preview-listing__float">{float ?? "—"}</span>
      {typeof input.price_cents === "number" ? (
        <span className="preview-listing__price">{formatDollars(input.price_cents)}</span>
      ) : null}
      {href ? <ExternalLink size={11} aria-hidden /> : null}
    </>
  );
  if (!href) return <div className="preview-listing">{body}</div>;
  return (
    <a
      className="preview-listing"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={stop}
      title={typeof input.float_value === "number" ? `Float ${input.float_value}` : undefined}
    >
      {body}
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
        <p className="o-kicker">{title}</p>
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
  expandable = true,
}: {
  tu: HydratedTradeUp;
  expanded: boolean;
  onExpand: (id: number | null) => void;
  /** False for teaser cards that share expand state with another card they must not disturb. */
  expandable?: boolean;
}) {
  const [hot, setHot] = useState<string | null>(null);
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
  const orderedInputs = [...tu.inputs].sort((a, b) => a.skin_name.localeCompare(b.skin_name));
  const inputsRedacted = tu.inputs_redacted === true || tu.inputs.some((row) => row.listing_id === "hidden");
  const reportOpen = () => {
    trackTradeUpDetailOpen({ collectionSlug: collectionSlugFromPath(window.location.pathname) });
  };
  const toggle = () => {
    if (!expandable) return;
    if (!expanded) reportOpen();
    onExpand(expanded ? null : tu.id);
  };
  const open = () => {
    if (!expandable) return;
    if (!expanded) reportOpen();
    onExpand(tu.id);
  };

  return (
    <article
      className={`preview-card ${expanded ? "preview-card--expanded preview-bento__row" : ""} ${expandable ? "" : "preview-card--static"}`}
      onClick={toggle}
    >
      {expandable && (
        <button type="button" className="sr-only" aria-expanded={expanded} onClick={(event) => { stop(event); toggle(); }}>
          {expanded ? "Collapse" : "Expand"} the {tradeUpPair(tu.type ?? "", tu.outcomes)} trade-up
        </button>
      )}

      {/* Clicking the card toggles it, but the tiles own most of that surface,
          so an expanded card carries one quiet way out. */}
      {expanded && (
        <button
          type="button"
          className="preview-collapse"
          onClick={(event) => { stop(event); toggle(); }}
        >
          <ChevronUp size={12} aria-hidden />
          Collapse
        </button>
      )}

      {inputsRedacted && (
        <div className="preview-notice" role="status" onClick={stop}>
          <p className="preview-note">This trade-up is inside the 3-hour free delay. Upgrade to Pro to see listing links and exact floats.</p>
          <a href="/pricing" className="preview-btn preview-btn--quiet">View Plans</a>
        </div>
      )}

      {(inputs.length > 0 || outputs.length > 0) && (
        <FlowRow
          inputLabel={`${inputRarityLabel(tu.type)} inputs`}
          outputLabel={`${rarityLabel(tu.type)} outputs`}
          inputColor={inColor}
          outputColor={outColor}
          inputs={inputs.map((group) => (
            <InputTile
              key={group.name}
              group={group}
              rarity={inColor}
              hot={hot === group.name}
              onHover={setHot}
              onNeedExpand={open}
            />
          ))}
          outputs={outputs.map((outcome) => (
            <OutputTile
              key={outcome.skin_id + outcome.skin_name}
              outcome={outcome}
              rarity={outColor}
              costCents={tu.total_cost_cents}
              hot={hot === outcome.skin_name}
              onHover={setHot}
            />
          ))}
        />
      )}

      {!expanded && (
        <p className="preview-cardline">
          Cost <b>{formatDollars(inputCostCents(tu))}</b>
          <i />
          <b className={signClass(tu.profit_cents)} title={EXPECTED_PL_TOOLTIP}>
            {signedDollars(tu.profit_cents)} / {tu.roi_percentage >= 0 ? "+" : ""}{tu.roi_percentage.toFixed(1)}%
          </b>
          {chance !== null && (
            <>
              <i />
              {formatOdds(chance)} above cost
            </>
          )}
          <span className="preview-cardline__actions">
            {expandable && (
              <span className="preview-cardline__open" aria-hidden>
                Details
                <ChevronDown size={12} />
              </span>
            )}
            <a
              className="preview-cardline__verify"
              href={verifyClaimHref(tu.id)}
              target="_blank"
              rel="noopener noreferrer"
              title="Open this trade-up to re-check that its listings are still live"
              aria-label="Verify trade-up (opens in new tab)"
              onClick={(event) => { trackVerifyClick("board_card"); stop(event); }}
            >
              Verify
              <ExternalLink size={10} aria-hidden />
            </a>
          </span>
        </p>
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
              <div className="preview-expand__viz">
                <div className="preview-readouts">
                  <Readout label="Cost" value={formatDollars(inputCostCents(tu))} note={`${totals.count || 10} listings`} />
                  <Readout label={LABEL_EXPECTED_VALUE} value={formatDollars(tu.expected_value_cents)} note={LABEL_AFTER_FEES} />
                  <Readout label={LABEL_EXPECTED_PL} value={signedDollars(evPnL)} note={`${tu.roi_percentage.toFixed(1)}% ROI`} tone={signClass(evPnL)} />
                  <Readout label="Median P/L" value={median === null ? "—" : signedDollars(median)} note="50th percentile" tone={median === null ? "" : signClass(median)} />
                  <Readout label={LABEL_ABOVE_COST} value={chance === null ? "—" : formatOdds(chance)} note={NOTE_OF_OUTCOMES} />
                  <Readout label="Worst case" value={worst === null ? "—" : signedDollars(worst)} note="lowest outcome" tone={worst === null ? "" : signClass(worst)} />
                  <Readout label="Best case" value={best === null ? "—" : signedDollars(best)} note="highest outcome" tone={best === null ? "" : signClass(best)} />
                  <Readout label="P10 tail" value={tail === null ? "—" : signedDollars(tail)} note={NOTE_WORST_OUTCOMES} tone={tail === null ? "" : signClass(tail)} />
                </div>
                {showExpectedPlHelp(evPnL, chance) && <ExpectedPlHelp />}
                <FeeLine line={boardFeeLine(tu.inputs.map((row) => row.source))} className="preview-fees--strip" />
                <div className="preview-viz-grid">
                  <div className="preview-subpanel">
                    <EvWaterfall tu={tu} />
                  </div>
                  <div className="preview-subpanel">
                    <CdfChart tu={tu} points={points} />
                  </div>
                </div>
                <div className="preview-subpanel preview-subpanel--split">
                  <RankedList title="Top EV drivers" points={drivers} empty="No outcome adds EV." />
                  <RankedList title="Largest drags" points={drags} empty="No outcome costs EV." />
                </div>
              </div>

              <Panel
                className="preview-expand__listings"
                title="Listings"
                meta={totals.count > 0 ? `${totals.count} · ${formatDollars(totals.totalCents)}` : "loading"}
              >
                <div className="preview-listings">
                  {orderedInputs.map((row, index) => (
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
                  onClick={(event) => { trackVerifyClick("expanded"); stop(event); }}
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

function rankedMeta(throttled: boolean, count: number): string {
  if (throttled && count === 0) return "—";
  return `${count} ranked`;
}

export function PreviewBoard({
  tradeUps,
  loading,
  isFree,
  onExpand,
  expandedId,
  query,
  onQuery,
  search,
  onSearch,
  onParsed,
  loadMore,
  exhausted,
  throttle,
  retryReady = false,
  failed,
  refreshing = false,
  onRetry,
  onClearFilters,
  heading = "Live trade-ups",
  lede = "Built from listings you can buy right now on CSFloat, DMarket, Skinport, and Buff.",
  collection,
  lockedSkin,
  embed = false,
}: {
  tradeUps: HydratedTradeUp[];
  loading: boolean;
  isFree: boolean;
  expandedId: number | null;
  onExpand: (id: number | null) => void;
  query?: BoardQuery;
  onQuery?: (next: BoardQuery) => void;
  search?: string;
  onSearch?: (next: string) => void;
  onParsed?: (parsed: ParsedQuery) => void;
  loadMore?: () => void;
  exhausted?: boolean;
  throttle?: string | null;
  /** True once the automatic 429 retry has been spent. Shows the Retry button. */
  retryReady?: boolean;
  failed?: boolean;
  /** Page-1 filter change still showing the previous rows. */
  refreshing?: boolean;
  onRetry?: () => void;
  onClearFilters?: () => void;
  heading?: string;
  lede?: string;
  collection?: string;
  lockedSkin?: string;
  embed?: boolean;
}) {
  const [width, setWidth] = useState(typeof window === "undefined" ? 1280 : window.innerWidth);
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const cols = bentoColumns(width);
  const [typing, setTyping] = useState(false);
  const typingTimer = useRef(0);
  const onKeystroke = useCallback(() => {
    setTyping(true);
    window.clearTimeout(typingTimer.current);
    typingTimer.current = window.setTimeout(() => setTyping(false), TYPING_IDLE_MS);
  }, []);
  useEffect(() => () => window.clearTimeout(typingTimer.current), []);
  const filtered = Boolean(query && !isDefaultQuery(query)) || Boolean(search?.trim());
  const clearFilters = onClearFilters ?? (onQuery ? () => onQuery(DEFAULT_QUERY) : undefined);
  const cardsThrottled = tradeUps.some((tu) => tu.hydrateThrottled === true);
  const notice = boardNotice({
    loading,
    rows: tradeUps.length,
    throttled: Boolean(throttle) || cardsThrottled,
    failed: Boolean(failed),
    filtered,
  });
  const suggestion = useLoosenProbe({
    enabled: notice === "filtered-empty",
    typing,
    query,
    text: search ?? "",
    collection,
    skin: lockedSkin,
  });
  const showRetry = notice === "error" || (notice === "throttled" && (retryReady || cardsThrottled));
  const noticeNode = (
    <BoardNotice
      notice={notice}
      onClearFilters={clearFilters}
      onRetry={showRetry ? onRetry : undefined}
      suggestion={suggestion}
      onApplySuggestion={suggestion && onQuery ? () => {
        onQuery(suggestion.query);
        if (suggestion.text !== (search ?? "")) onSearch?.(suggestion.text);
      } : undefined}
      message={throttle ?? undefined}
      detail={notice === "throttled" && Boolean(throttle) && tradeUps.length > 0 ? "Showing the previous results." : undefined}
    />
  );
  const expandedIndex = tradeUps.findIndex((tu) => tu.id === expandedId);
  const ordered = expandedIndex >= 0 ? reorderForExpanded(tradeUps, expandedIndex, cols) : tradeUps;

  // Page in as the sentinel comes into view. The console shell is the scroller,
  // not the window, so the observer has to be rooted on it.
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = sentinel.current;
    if (!node || !loadMore) return;
    let root: HTMLElement | null = node.parentElement;
    while (root) {
      const overflow = getComputedStyle(root).overflowY;
      if (overflow === "auto" || overflow === "scroll") break;
      root = root.parentElement;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) loadMore();
    }, { root, rootMargin: "600px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [loadMore]);

  return (
    <div className={embed ? "preview-board-embed" : "preview-page"}>
      {!embed && <title>{TRADE_UPS_DOCUMENT_TITLE}</title>}
      {embed ? (
        <header className="preview-panel__head">
          <p className="o-kicker">{heading}</p>
          <span className="preview-panel__meta">{rankedMeta(Boolean(throttle), tradeUps.length)}</span>
        </header>
      ) : (
        <header className="preview-page__head">
          <div>
            <h1>{heading}</h1>
            <p>{lede}</p>
          </div>
          <div className="preview-page__meta">
            <span>{rankedMeta(Boolean(throttle), tradeUps.length)}</span>
            <i />
            <span>{cols}-column</span>
          </div>
        </header>
      )}
      {onSearch && !embed && (
        <PreviewSearch
          value={search ?? ""}
          onChange={onSearch}
          onParsed={onParsed}
          onKeyDown={onKeystroke}
          placeholder="Search trade-ups…"
          examples={["covert <0.03 <$700", "ak nightwish", "classified <$50", "dreams nightmares"]}
        />
      )}
      {query && onQuery && (
        <PreviewFilters
          query={query}
          onChange={onQuery}
          onClear={clearFilters}
          canClear={filtered}
          collection={collection}
          lockedSkin={lockedSkin}
          onKeyDown={onKeystroke}
        />
      )}
      {isFree && (
        <div className="preview-delay">
          <span className="preview-delay__label">Free tier</span>
          <p>{DELAY_BANNER}</p>
          <a className="preview-delay__cta" href="/pricing">See Pro</a>
        </div>
      )}
      {!embed && <FeeLine line={boardFeeLine()} caveat />}
      {loading && tradeUps.length === 0 && notice !== "throttled" && <p className="preview-note">Loading trade-ups…</p>}
      {refreshing && <p className="preview-note" role="status" aria-live="polite">Updating trade-ups…</p>}
      {noticeNode}
      <div className={`preview-bento${refreshing ? " preview-bento--stale" : ""}`} aria-busy={refreshing || undefined}>
        {ordered.map((tu) => (
          <TradeUpCard key={tu.id} tu={tu} expanded={expandedId === tu.id} onExpand={onExpand} />
        ))}
      </div>
      {loadMore && !exhausted && !notice && (
        <div className="preview-sentinel" ref={sentinel}>
          <span className="preview-note">Loading more trade-ups…</span>
        </div>
      )}
      {exhausted && tradeUps.length > 0 && !notice && (
        <p className="preview-note">That is every trade-up matching these filters.</p>
      )}
      {!embed && (
        <section className="preview-panel">
          <h2>Common questions</h2>
          {TRADE_UPS_FAQ.map((item) => (
            <div key={item.q}>
              <h3>{item.q}</h3>
              <p>{item.a}</p>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

function skinNames(rows: TradeUp[]): string[] {
  return rows.flatMap((tu) => [
    ...tu.inputs.map((row) => row.skin_name),
    ...tu.outcomes.map((outcome) => outcome.skin_name),
  ]);
}

export function usePreviewTradeUps(options: {
  collection?: string;
  skin?: string;
  perPage?: number;
  enabled?: boolean;
} = {}) {
  const { collection, skin, perPage = 12, enabled = true } = options;
  const [tradeUps, setTradeUps] = useState<HydratedTradeUp[]>([]);
  const [loading, setLoading] = useState(true);
  const [isFree, setIsFree] = useState(true);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [query, setQuery] = useState<BoardQuery>(() => readBoardLocation(typeof window === "undefined" ? null : window.location).query);
  const [search, setSearch] = useState(() => readBoardLocation(typeof window === "undefined" ? null : window.location).text);
  const [parsed, setParsed] = useState<ParsedQuery>(() => parseQuery(readBoardLocation(typeof window === "undefined" ? null : window.location).text));
  // Page and end-of-list belong to one filter key, so a new key reads page 1 on
  // the same render and never requests the previous filter's page number.
  const [cursor, setCursor] = useState({ key: "", page: 1 });
  const [endKey, setEndKey] = useState<string | null>(null);
  const [backoffUntil, setBackoffUntil] = useState(0);
  const [throttle, setThrottle] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [rowsKey, setRowsKey] = useState<string | null>(null);
  const [retryReady, setRetryReady] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  const [total, setTotal] = useState<number | null>(null);
  const [totalProfitable, setTotalProfitable] = useState(0);
  const inFlightRef = useRef(false);
  const attemptRef = useRef(0);
  // Faces land in a module-level cache, so a bump is what repaints the art.
  const [faceTick, setFaceTick] = useState(0);

  useEffect(() => {
    if (collection || skin || typeof window === "undefined") return;
    replaceBoardUrl({ query, text: search }, window.location, window.history);
  }, [query, search, collection, skin]);

  const semantic = useMemo(() => chipsToBoardParams(parsed.chips, parsed.rest), [parsed]);
  const params = new URLSearchParams(boardQueryString(query, perPage));
  for (const [keyName, value] of Object.entries(semantic)) {
    if (value) params.set(keyName, value);
  }
  if (collection) params.set("collection", collection);
  if (skin) params.set("skin", skin);
  const key = params.toString();
  const scope = `${collection ?? ""}\0${skin ?? ""}`;
  // Only filter/sort edits settle. A new scope (collection/skin resolved or changed) applies at once.
  const [settled, setSettled] = useState({ key, scope });
  const settledKey = settled.scope === scope ? settled.key : key;
  useEffect(() => {
    if (settled.key === key && settled.scope === scope) return;
    if (settled.scope !== scope) { setSettled({ key, scope }); return; }
    const handle = window.setTimeout(() => setSettled({ key, scope }), FILTER_SETTLE_MS);
    return () => window.clearTimeout(handle);
  }, [key, scope, settled]);
  const page = cursor.key === settledKey ? cursor.page : 1;
  const exhausted = endKey === settledKey;
  const scopeRef = useRef(scope);
  useLayoutEffect(() => {
    if (scopeRef.current === scope) return;
    scopeRef.current = scope;
    setTradeUps([]);
    setLoading(enabled);
    setThrottle(null);
    setRetryReady(false);
    setBackoffUntil(0);
    attemptRef.current = 0;
  }, [scope, enabled]);

  // A filter change starts a new list at page 1. The cursor must be rewritten,
  // not only read as page 1 while its key mismatches: otherwise clearing back
  // to the previous key revives the page number from before the filter.
  useEffect(() => {
    setCursor({ key: settledKey, page: 1 });
    setEndKey(null);
    attemptRef.current = 0;
    setBackoffUntil(0);
    setThrottle(null);
  }, [settledKey]);

  useEffect(() => {
    if (!enabled) {
      inFlightRef.current = false;
      setLoading(false);
      return;
    }
    let live = true;
    const controller = new AbortController();
    inFlightRef.current = true;
    setFailed(false);
    void loadBoardRows<TradeUp>({
      append: page > 1,
      isLive: () => live && !controller.signal.aborted,
      fetchRows: async () => {
        const res = await fetch(boardListUrl(settledKey, page), {
          credentials: "include",
          signal: controller.signal,
        });
        const data = await readPagedJson<{ trade_ups?: TradeUp[]; tier?: string; total?: number; total_profitable?: number }>(res);
        if (live && page === 1 && typeof data.total === "number") {
          setTotal(data.total);
          setTotalProfitable(typeof data.total_profitable === "number" ? data.total_profitable : 0);
        }
        return { rows: data.trade_ups ?? [], isFree: (data.tier ?? "free") === "free", total: data.total };
      },
      hydrate: (tu) => controller.signal.aborted ? Promise.resolve(tu) : hydrateBoardCard(tu),
      namesOf: skinNames,
      warmFaces: (names) => loadFaces(names, FACE_CACHE),
      emit: {
        rows: (next) => {
          if (!live) return;
          attemptRef.current = 0;
          setRetryReady(false);
          setTradeUps(next as HydratedTradeUp[]);
          if (page === 1) setRowsKey(settledKey);
        },
        isFree: setIsFree,
        loading: setLoading,
        facesReady: () => { if (live) setFaceTick((tick) => tick + 1); },
        pageSize: (count, total) => {
          if (!live) return;
          if (pageIsShort(count, perPage) || reachedTotal(page, perPage, total)) setEndKey(settledKey);
        },
        rateLimited: (retryAfterMs) => {
          if (!live) return;
          noteRateLimited(retryAfterMs);
          // One automatic retry. A second 429 stays on the notice until Retry.
          if (attemptRef.current >= 1) {
            setThrottle(RATE_LIMIT_MANUAL_COPY);
            setRetryReady(true);
            return;
          }
          setThrottle(rateLimitCopy(retryAfterMs));
          setRetryReady(false);
          const next = applyRateLimit(attemptRef.current, Date.now(), { retryAfterMs });
          attemptRef.current = next.attempt;
          setBackoffUntil(next.backoffUntil);
        },
        failed: () => { if (live) setFailed(true); },
      },
    }).finally(() => {
      if (live) inFlightRef.current = false;
    });
    return () => {
      live = false;
      controller.abort();
    };
  }, [settledKey, page, perPage, enabled, reloadTick]);

  useEffect(() => {
    cacheNames(tradeUps.flatMap((tu) => skinNames([tu]).map((name) => ({ name }))));
  }, [tradeUps]);

  useEffect(() => {
    if (!backoffUntil) return;
    const wait = Math.max(0, backoffUntil - Date.now());
    // Re-ask for the page that was throttled rather than skipping past it.
    const handle = window.setTimeout(() => {
      setThrottle(null);
      setBackoffUntil(0);
      setReloadTick((tick) => tick + 1);
    }, wait);
    return () => window.clearTimeout(handle);
  }, [backoffUntil]);

  const refreshing = loading && page === 1 && tradeUps.length > 0 && rowsKey !== settledKey;

  const loadMore = useCallback(() => {
    if (!canLoadMore({
      inFlight: inFlightRef.current || loading,
      exhausted: exhausted || failed,
      backoffUntil,
      now: Date.now(),
    })) return;
    inFlightRef.current = true;
    setCursor({ key: settledKey, page: page + 1 });
  }, [loading, exhausted, failed, backoffUntil, settledKey, page]);

  const retry = useCallback(() => {
    setFailed(false);
    setThrottle(null);
    setRetryReady(false);
    attemptRef.current = 0;
    setReloadTick((tick) => tick + 1);
  }, []);

  const clearFilters = useCallback(() => {
    setQuery(DEFAULT_QUERY);
    setSearch("");
    setParsed({ chips: [], rest: [] });
  }, []);

  const onExpand = useCallback(async (id: number | null) => {
    setExpandedId(id);
    if (id == null) return;
    const current = tradeUps.find((t) => t.id === id);
    if (!current) return;
    const withInputs = await hydrateBoardCard(current);
    setTradeUps((prev) => prev.map((tu) => (tu.id === id ? withInputs : tu)));
    void loadFaces(skinNames([withInputs]), FACE_CACHE)
      .then(() => setFaceTick((tick) => tick + 1));
  }, [tradeUps]);

  return useMemo(
    () => ({
      tradeUps, loading, refreshing, isFree, expandedId, onExpand,
      total, totalProfitable,
      query, onQuery: setQuery,
      search, onSearch: setSearch, onParsed: setParsed,
      loadMore, exhausted, throttle, retryReady,
      failed, retry, clearFilters,
    }),
    [tradeUps, loading, refreshing, isFree, expandedId, onExpand, query, search, loadMore, exhausted, throttle, retryReady, failed, retry,
      clearFilters, faceTick, total, totalProfitable],
  );
}
