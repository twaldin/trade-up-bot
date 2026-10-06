import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { PreviewSeo } from "../components/PreviewSeo.js";
import { formatOdds, rarityLabel } from "../lib/board.js";
import { boardFeeLine } from "../lib/fees.js";
import { REPRICE_CAVEAT, SIGN_IN_TO_CLAIM } from "../lib/copy.js";
import { authHref } from "../../lib/ref.js";
import { trackEvent } from "../../lib/analytics.js";
import { trackCtaClick, trackSteamContinue, trackUpgradeCta } from "../../lib/conversions.js";
import { boardDelaySentence, useBoardDelay } from "../lib/board-delay.js";
import { formatDollars } from "../../utils/format.js";
import {
  INTENT_MIN_PROFIT_CENTS,
  TRADE_UP_TIERS,
  TRADE_UP_TIERS_PATH,
  intentBoardHref,
  intentPageForPath,
  renderIntentDocument,
  tierPath,
  type IntentRow,
  type IntentSnapshot,
} from "../lib/intent-landings.js";

function profitText(cents: number): string {
  return cents > 0 ? `+${formatDollars(cents)}` : formatDollars(cents);
}

function useBoardRows(type: string | null): { rows: IntentRow[] | null; failed: boolean } {
  const [rows, setRows] = useState<IntentRow[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (type === null) return;
    let live = true;
    setRows(null);
    setFailed(false);
    const params = new URLSearchParams({
      per_page: "8",
      sort: "profit",
      order: "desc",
      min_profit: String(INTENT_MIN_PROFIT_CENTS),
    });
    if (type) params.set("type", type);
    fetch(`/api/trade-ups?${params.toString()}`, { credentials: "include" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { trade_ups?: IntentRow[] } | null) => {
        if (!live) return;
        if (!data || !Array.isArray(data.trade_ups)) {
          setFailed(true);
          setRows([]);
          return;
        }
        setRows(data.trade_ups.map((row) => ({
          id: row.id,
          type: row.type,
          total_cost_cents: row.total_cost_cents,
          profit_cents: row.profit_cents,
          roi_percentage: row.roi_percentage,
          chance_to_profit: row.chance_to_profit ?? 0,
        })));
      })
      .catch(() => {
        if (!live) return;
        setFailed(true);
        setRows([]);
      });
    return () => { live = false; };
  }, [type]);

  return { rows, failed };
}

function useActiveCounts(): { active: number; profitable: number } | null {
  const [counts, setCounts] = useState<{ active: number; profitable: number } | null>(null);
  useEffect(() => {
    let live = true;
    fetch("/api/global-stats", { credentials: "include" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { active_trade_ups?: number; active_profitable_trade_ups?: number } | null) => {
        if (!live || !data) return;
        if (typeof data.active_trade_ups !== "number" || typeof data.active_profitable_trade_ups !== "number") return;
        setCounts({ active: data.active_trade_ups, profitable: data.active_profitable_trade_ups });
      })
      .catch(() => {});
    return () => { live = false; };
  }, []);
  return counts;
}

function FeeLine() {
  const fee = boardFeeLine();
  return <p>{fee.cost} {fee.outcomes} {REPRICE_CAVEAT}</p>;
}

function CountLine({ counts }: { counts: { active: number; profitable: number } | null }) {
  if (!counts) return null;
  return (
    <p>
      {counts.active.toLocaleString("en-US")} active trade-ups, {counts.profitable.toLocaleString("en-US")} with positive expected profit after fees.
    </p>
  );
}

function LiveTable({ rows, failed, showTier }: { rows: IntentRow[] | null; failed: boolean; showTier: boolean }) {
  if (rows === null) return <p className="preview-note">Loading the live board…</p>;
  if (rows.length === 0) {
    return (
      <p>
        {failed ? "The live list did not load. " : "No active trade-ups above $1 expected P/L in this list right now. "}
        <Link className="preview-link" to="/trade-ups">Open the live board</Link>.
      </p>
    );
  }
  return (
    <div className="preview-tablewrap preview-tablewrap--fit">
      <table className="preview-table preview-table--dense preview-table--fit">
        <thead>
          <tr>
            <th>Trade-up</th>
            {showTier && <th>Tier</th>}
            <th>Cost</th>
            <th>Expected P/L</th>
            <th>ROI</th>
            <th>Above cost</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td><Link className="preview-link" to={`/trade-ups/${row.id}`}>#{row.id}</Link></td>
              {showTier && <td>{rarityLabel(row.type)}</td>}
              <td>{formatDollars(row.total_cost_cents)}</td>
              <td className={row.profit_cents >= 0 ? "is-plus" : "is-minus"}>{profitText(row.profit_cents)}</td>
              <td>{Number.isFinite(row.roi_percentage) ? `${row.roi_percentage.toFixed(1)}%` : ""}</td>
              <td>{formatOdds(row.chance_to_profit)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function IntentCta({ location }: { location: string }) {
  const delaySentence = boardDelaySentence(useBoardDelay());
  return (
    <section className="preview-panel">
      <header className="preview-panel__head">
        <p className="o-kicker">Start free</p>
      </header>
      {delaySentence && <p className="preview-note">{delaySentence}</p>}
      <p className="preview-note">{SIGN_IN_TO_CLAIM}</p>
      <div className="preview-toolbar">
        <a
          className="preview-btn preview-btn--lime"
          href={authHref("/trade-ups")}
          rel="nofollow"
          onClick={() => {
            trackSteamContinue();
            trackEvent("sign_up_start", { location });
          }}
        >
          Sign in with Steam
        </a>
        <Link className="preview-btn" to="/pricing" onClick={() => trackUpgradeCta("intent_pro")}>
          See Pro plans
        </Link>
        <Link className="preview-btn" to="/trade-ups" onClick={() => trackCtaClick("intent_board")}>
          Open the live board
        </Link>
      </div>
    </section>
  );
}

export function PreviewIntent() {
  const { pathname } = useLocation();
  const page = intentPageForPath(pathname);
  const counts = useActiveCounts();
  const listType = !page || page.kind === "index" ? null : (page.tier?.type ?? "");
  const board = useBoardRows(listType);

  if (!page) {
    return (
      <div className="preview-market">
        <PreviewSeo
          title="Trade-up tier not found | TradeUpBot"
          description="That trade-up tier is not on TradeUpBot."
          canonical="https://tradeupbot.app/trade-ups/tiers"
          robots="noindex, follow"
        />
        <header className="preview-page__head">
          <div>
            <h1>Tier not found</h1>
            <p><Link className="preview-link" to={TRADE_UP_TIERS_PATH}>See trade-ups by rarity</Link></p>
          </div>
        </header>
      </div>
    );
  }

  const snapshot: IntentSnapshot = {
    active: counts?.active ?? null,
    profitable: counts?.profitable ?? null,
    top: [],
    byType: {},
  };
  const doc = renderIntentDocument(page, snapshot);
  const ctaLocation = page.kind === "best" ? "best_trade_ups" : "trade_up_tiers";

  return (
    <div className="preview-market">
      <PreviewSeo title={page.title} description={page.description} canonical={doc.url} jsonLd={doc.jsonLd} />
      <header className="preview-page__head">
        <div>
          <nav className="preview-crumb" aria-label="Breadcrumb">
            <Link className="preview-link" to="/trade-ups">Trade-Ups</Link>
            <span aria-hidden>/</span>
            {page.kind === "best" ? <span>Best right now</span> : (
              page.kind === "index" ? <span>By rarity</span> : (
                <>
                  <Link className="preview-link" to={TRADE_UP_TIERS_PATH}>By rarity</Link>
                  <span aria-hidden>/</span>
                  <span>{page.h1}</span>
                </>
              )
            )}
          </nav>
          <h1>{page.h1}</h1>
        </div>
      </header>

      <section className="preview-doc">
        {page.kind === "best" && (
          <>
            <p>These are the active trade-ups with the highest expected P/L after fees. Expected P/L is the probability-weighted value of the outputs minus the input cost. It is an average across the draw, so one trade-up can still come back below cost.</p>
            <CountLine counts={counts} />
            <FeeLine />
            <LiveTable rows={board.rows} failed={board.failed} showTier />
          </>
        )}
        {page.kind === "index" && (
          <>
            <p>A CS2 trade-up exchanges skins of one rarity for one skin of the next rarity. Gun tiers take 10 inputs. Knife and glove trade-ups take 5 Covert inputs. The output skin is not a fixed result: the collections you put in set the shares.</p>
            <CountLine counts={counts} />
            <FeeLine />
            {TRADE_UP_TIERS.map((tier) => (
              <div key={tier.slug}>
                <h2><Link className="preview-link" to={tierPath(tier.slug)}>{tier.h1}</Link></h2>
                <p>{tier.points[0]}</p>
              </div>
            ))}
          </>
        )}
        {page.kind === "tier" && page.tier && (
          <>
            <p>{page.tier.inputCount} {page.tier.inputRarity} skins in. Output: {page.tier.outputName}.</p>
            {page.tier.points.map((point) => <p key={point}>{point}</p>)}
            <CountLine counts={counts} />
            <p>The table is this tier only, above $1 expected P/L, listings still active.</p>
            <FeeLine />
            <LiveTable rows={board.rows} failed={board.failed} showTier={false} />
          </>
        )}

        <h2>Common questions</h2>
        {doc.faq.map((item) => (
          <div key={item.q}>
            <h3>{item.q}</h3>
            <p>{item.a}</p>
          </div>
        ))}

        <h2>Related</h2>
        <ul>
          <li><Link className="preview-link" to="/best-cs2-trade-ups">Best CS2 trade-ups right now</Link></li>
          <li><Link className="preview-link" to={TRADE_UP_TIERS_PATH}>Trade-ups by rarity</Link></li>
          <li>
            <Link className="preview-link" to={page.tier ? intentBoardHref(page.tier.type) : intentBoardHref()}>
              {page.tier ? `Open ${page.tier.h1} on the board` : "Open the board sorted by expected P/L"}
            </Link>
          </li>
          <li><Link className="preview-link" to="/calculator">CS2 trade-up calculator</Link></li>
          <li><Link className="preview-link" to="/collections">Browse collections</Link></li>
          <li><Link className="preview-link" to="/trade-ups/collection/dreams-nightmares">Dreams & Nightmares trade-ups</Link></li>
          <li><Link className="preview-link" to="/blog/how-cs2-trade-ups-work/">How CS2 trade-ups work</Link></li>
          <li><Link className="preview-link" to="/blog/cs2-trade-up-marketplace-fees/">Marketplace fees</Link></li>
        </ul>
      </section>

      <IntentCta location={ctaLocation} />
    </div>
  );
}
