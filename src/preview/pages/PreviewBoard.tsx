import { AnimatePresence, motion } from "motion/react";
import { ExternalLink } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Bar, BarChart, ResponsiveContainer, XAxis, YAxis } from "recharts";
import type { TradeUp, TradeUpInput, TradeUpOutcome } from "../../../shared/types.js";
import { formatDollars, listingUrl, sourceLabel } from "../../utils/format.js";
import { ChartFigure } from "../kit/primitives/chart-figure.js";
import {
  bentoColumns,
  inputCostCents,
  inputListingHrefs,
  inputQty,
  oddsBarSegments,
  openGroupedListings,
  outputHref,
  rarityColor,
  rarityLabel,
  uniqueInputs,
  uniqueOutputs,
  verifyClaimHref,
} from "../lib/board.js";
import { DELAY_BANNER } from "../lib/copy.js";
import { createFaceCache, faceFor, hydrateOutcomesIfNeeded, loadFaces } from "../lib/skin-images.js";

const FACE_CACHE = createFaceCache();

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
  listings,
  color,
  onNeedExpand,
}: {
  name: string;
  count: number;
  listings: TradeUpInput[];
  color: string;
  onNeedExpand: () => void;
}) {
  const hrefs = inputListingHrefs(listings);
  return (
    <button
      type="button"
      className="preview-skin preview-skin--input"
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
      onClick={(event) => event.stopPropagation()}
    >
      <span className="preview-skin__price">{formatDollars(outcome.estimated_price_cents)}</span>
      <span className="preview-skin__odds">{Math.round(outcome.probability * 100)}%</span>
      <SkinFace name={outcome.skin_name} />
      <span className="preview-skin__name" style={{ color }}>{outcome.skin_name}</span>
    </a>
  );
}

function OddsBar({ tu }: { tu: TradeUp }) {
  const segs = oddsBarSegments(tu);
  if (segs.length === 0) return null;
  const row: Record<string, string | number> = { label: "odds" };
  for (const seg of segs) row[seg.key] = seg.probability;
  return (
    <ChartFigure
      title="Odds"
      description={segs.map((seg) => `${seg.name} ${Math.round(seg.probability * 100)}%`).join(", ")}
      captionVisible
      captionClassName="preview-oddsbar__label"
      data={{
        columns: ["Outcome", "Odds"],
        rows: segs.map((seg) => [seg.name, seg.probability]),
      }}
    >
      <div className="preview-oddsbar">
        <ResponsiveContainer width="100%" height={72}>
          <BarChart data={[row]} layout="vertical" margin={{ top: 8, right: 4, left: 4, bottom: 8 }} barSize={18}>
            <XAxis type="number" hide domain={[0, 1]} />
            <YAxis type="category" dataKey="label" hide />
            {segs.map((seg) => (
              <Bar key={seg.key} dataKey={seg.key} stackId="odds" fill={seg.color} isAnimationActive={false} />
            ))}
          </BarChart>
        </ResponsiveContainer>
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
            <h1 className="text-2xl font-semibold tracking-tight">Live contracts</h1>
            <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
              Built from buyable listings on CSFloat, DMarket, Skinport, and Buff. {cols}-column bento.
            </p>
          </div>
        </div>
        {loading && <p style={{ color: "var(--text-muted)" }}>Loading contracts…</p>}
        <div className="preview-bento">
          {tradeUps.map((tu) => {
            const expanded = expandedId === tu.id;
            const inputs = uniqueInputs(tu);
            const outputs = uniqueOutputs(tu);
            const color = rarityColor(tu.type);
            const profitPositive = tu.profit_cents >= 0;
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
                <div className="preview-kpis">
                  <div className="preview-kpi">
                    <em>Cost</em>
                    <b>{formatDollars(inputCostCents(tu))}</b>
                  </div>
                  <div className="preview-kpi">
                    <em>Qty</em>
                    <b>×{inputQty(tu)}</b>
                  </div>
                  <div className="preview-kpi">
                    <em>EV</em>
                    <b>{formatDollars(tu.expected_value_cents)}</b>
                  </div>
                  <div className="preview-kpi">
                    <em>Profit</em>
                    <b style={{ color: profitPositive ? "var(--accent-text)" : "var(--text-muted)" }}>
                      {formatDollars(tu.profit_cents)}
                      <small> {tu.roi_percentage.toFixed(1)}% ROI</small>
                    </b>
                  </div>
                </div>
                {inputs.length > 0 && (
                  <div className="preview-skins preview-skins--in">
                    {inputs.map((group) => (
                      <InputTile
                        key={group.name}
                        name={group.name}
                        count={group.count}
                        listings={group.listings}
                        color={color}
                        onNeedExpand={() => onExpand(tu.id)}
                      />
                    ))}
                  </div>
                )}
                {outputs.length > 0 && (
                  <div className="preview-skins preview-skins--out">
                    {outputs.map((outcome) => (
                      <OutputTile key={outcome.skin_id + outcome.skin_name} outcome={outcome} color={color} />
                    ))}
                  </div>
                )}
                <OddsBar tu={tu} />
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
        ...tu.inputs.map((input) => input.skin_name),
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
