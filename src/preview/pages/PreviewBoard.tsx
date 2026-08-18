import { AnimatePresence, motion } from "motion/react";
import { ExternalLink } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Area, AreaChart, ResponsiveContainer } from "recharts";
import type { TradeUp, TradeUpInput, TradeUpOutcome } from "../../../shared/types.js";
import { formatDollars, listingUrl, sourceLabel } from "../../utils/format.js";
import { ChartFigure } from "../kit/primitives/chart-figure.js";
import {
  bentoColumns,
  groupedInputs,
  inputListingHref,
  outcomeHref,
  primaryOutcome,
  profitFill,
  profitLossSeries,
  rarityColor,
  tileClick,
} from "../lib/board.js";
import { DELAY_BANNER } from "../lib/copy.js";
import { createFaceCache, faceFor, hydrateOutcomesIfNeeded, loadFaces } from "../lib/skin-images.js";

const FACE_CACHE = createFaceCache();

function SkinTile({
  name,
  count,
  href,
  color,
  kind,
}: {
  name: string;
  count?: number;
  href: string;
  color: string;
  kind: "input" | "output";
}) {
  const src = faceFor(FACE_CACHE, name);
  const click = tileClick(kind, href);
  return (
    <a
      className="preview-skin"
      href={click.action === "none" ? undefined : click.href}
      target={kind === "input" ? "_blank" : undefined}
      rel={kind === "input" ? "noopener noreferrer" : undefined}
      onClick={(e) => e.stopPropagation()}
    >
      {src ? (
        <img
          src={src}
          alt=""
          onError={(event) => {
            event.currentTarget.style.visibility = "hidden";
          }}
        />
      ) : (
        <div style={{ width: 160, height: 120 }} />
      )}
      <div className="preview-skin__name" style={{ color }}>
        {name}
        {count && count > 1 ? ` ×${count}` : ""}
      </div>
    </a>
  );
}

function ProfitSpark({ profitCents }: { profitCents: number }) {
  const data = profitLossSeries(profitCents);
  const fill = profitFill(profitCents);
  const tone = fill === "lime" ? "#d7fe52" : "#2a2a28";
  return (
    <ChartFigure
      title="Profit and loss"
      description={`Current profit ${formatDollars(profitCents)}.`}
      data={{ columns: ["Step", "P/L"], rows: data.map((d) => [d.i, d.v]) }}
    >
      <div style={{ height: 100 }}>
        <ResponsiveContainer width="100%" height={100}>
          <AreaChart data={data} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id={`pl-${fill}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={tone} stopOpacity={0.45} />
                <stop offset="100%" stopColor={tone} stopOpacity={0} />
              </linearGradient>
            </defs>
            <Area type="monotone" dataKey="v" stroke={tone} strokeWidth={2} fill={`url(#pl-${fill})`} isAnimationActive={false} />
          </AreaChart>
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
      <div className="preview-section" style={{ paddingTop: 24 }}>
        <div className="flex items-end justify-between gap-4 mb-6">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Live contracts</h1>
            <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
              Built from buyable listings on CSFloat, DMarket, Skinport, and Buff. {cols}-column bento.
            </p>
          </div>
        </div>
        {loading && <p style={{ color: "var(--text-muted)" }}>Loading contracts…</p>}
        <div className="preview-bento">
          {tradeUps.map((tu) => {
            const expanded = expandedId === tu.id;
            const outcome = primaryOutcome(tu.outcomes);
            const groups = tu.inputs.length > 0
              ? groupedInputs(tu.inputs)
              : (tu.input_summary?.skins ?? []).map((s) => ({
                  name: s.name,
                  count: s.count,
                  sample: {
                    listing_id: "",
                    skin_id: "",
                    skin_name: s.name,
                    collection_name: "",
                    price_cents: 0,
                    float_value: 0,
                    condition: s.condition as TradeUpInput["condition"],
                    source: "csfloat",
                  } satisfies TradeUpInput,
                }));
            const color = rarityColor(tu.type);
            return (
              <article
                key={tu.id}
                className={`preview-card ${expanded ? "preview-card--expanded preview-bento__row" : ""}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="preview-card__price">{formatDollars(outcome?.estimated_price_cents ?? tu.expected_value_cents)}</div>
                  <div className="preview-card__odds">
                    {outcome ? `${Math.round(outcome.probability * 100)}%` : `${tu.outcome_count ?? 0} outs`}
                    {groups[0]?.count ? ` · ×${groups[0].count}` : ""}
                  </div>
                </div>
                <SkinTile
                  name={outcome?.skin_name ?? groups[0]?.name ?? "Trade-up"}
                  href={outcome ? outcomeHref(tu.id, outcome.skin_name) : "#"}
                  color={color}
                  kind="output"
                />
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {groups.slice(0, 2).map((g) => (
                    <SkinTile
                      key={g.name}
                      name={g.name}
                      count={g.count}
                      href={g.sample.listing_id ? inputListingHref(g.sample) : "#"}
                      color={color}
                      kind="input"
                    />
                  ))}
                </div>
                <ProfitSpark profitCents={tu.profit_cents} />
                <div className="mt-2 flex items-center justify-between gap-2">
                  <span className="text-sm" style={{ color: tu.profit_cents >= 0 ? "var(--accent-text)" : "var(--text-muted)" }}>
                    {formatDollars(tu.profit_cents)} · {tu.roi_percentage.toFixed(1)}% ROI
                  </span>
                  <button
                    type="button"
                    className="preview-btn"
                    onClick={() => onExpand(expanded ? null : tu.id)}
                  >
                    {expanded ? "Collapse" : "Expand"}
                  </button>
                </div>
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
                        {tu.inputs.map((input) => (
                          <ListingRow key={input.listing_id + input.skin_name} input={input} />
                        ))}
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <a className="preview-btn preview-btn--lime" href={`/trade-ups/${tu.id}`}>Verify / Claim</a>
                        {tu.outcomes.slice(0, 4).map((o: TradeUpOutcome) => (
                          <a key={o.skin_id + o.skin_name} className="preview-btn" href={outcomeHref(tu.id, o.skin_name)}>
                            {o.skin_name}
                          </a>
                        ))}
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
      const hydrated = await Promise.all(rows.map((tu) => hydrateOutcomesIfNeeded(tu)));
      const names = hydrated.flatMap((tu) => [
        ...(tu.input_summary?.skins.map((s) => s.name) ?? []),
        ...tu.outcomes.map((o) => o.skin_name),
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
    let inputs = withOutcomes.inputs;
    if (inputs.length === 0) {
      try {
        const res = await fetch(`/api/trade-up/${id}/inputs`, { credentials: "include" });
        if (res.ok) {
          const data = await res.json() as { inputs?: TradeUpInput[] };
          inputs = data.inputs ?? [];
        }
      } catch { /* keep list */ }
    }
    const names = [
      ...inputs.map((i) => i.skin_name),
      ...withOutcomes.outcomes.map((o) => o.skin_name),
    ];
    await loadFaces(names, FACE_CACHE);
    setTradeUps((prev) => prev.map((tu) => (tu.id === id ? { ...withOutcomes, inputs } : tu)));
  }, [tradeUps]);

  return useMemo(() => ({ tradeUps, loading, isFree, expandedId, onExpand }), [tradeUps, loading, isFree, expandedId, onExpand]);
}
