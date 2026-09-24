import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import { Check } from "lucide-react";
import { DeviceScreen } from "../components/DeviceScreen.js";
import { PriceScatter, type ScatterPoint } from "../components/PriceScatter.js";
import { Laptop } from "../kit/ledger/laptop.js";
import { Phone } from "../kit/orbit/phone.js";
import { useScrollProgress } from "../kit/lib/motion.js";
import { blogMeta } from "../../data/blog-meta.js";
import {
  formatFloat,
  inputListingHref,
  outputRarityColor,
  previewSkinHref,
  splitSkinName,
  uniqueOutputs,
} from "../lib/board.js";
import { FeeLine } from "../components/FeeLine.js";
import { heroProof, pickHeroTradeUp } from "../lib/hero-proof.js";
import { boardFeeLine } from "../lib/fees.js";
import { PRO_PRICE, proPriceLine } from "../lib/pro-pricing.js";
import type { TradeUp } from "../../../shared/types.js";
import {
  DELAY_BANNER,
  PREVIEW_CTA_CALCULATOR,
  PREVIEW_CTA_NOTE,
  PREVIEW_CTA_PRIMARY,
  PREVIEW_FAQ,
  PREVIEW_HEADLINE,
  PREVIEW_HOW,
  PREVIEW_LEDE,
  PREVIEW_PLAN_FREE,
  PREVIEW_PLAN_PRO,
  PREVIEW_PRO_PRICES,
  PREVIEW_SUBLEDE,
  PREVIEW_VALUE,
  PREVIEW_VALUE_HEADLINE,
} from "../lib/copy.js";
import { faqEntities, seoPage } from "../lib/seo-pages.js";
import { formatDollars, sourceLabel } from "../../utils/format.js";
import {
  formatLandingStat,
  visibleLandingStatTiles,
  type BoardCountSource,
  type LandingStatCounts,
} from "../lib/landing-stats.js";
import { boardFaceFor, TradeUpCard, usePreviewTradeUps } from "./PreviewBoard.js";

const LEFTOVER_FAQ = faqEntities(seoPage("/faq"));
const BLOG_TEASERS = blogMeta.filter((post) => post.slug !== "how-to-use-tradeupbot").slice(0, 4);

function Face({ name }: { name: string }) {
  const src = boardFaceFor(name);
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

function LandingGraph({ name }: { name: string }) {
  const [points, setPoints] = useState<ScatterPoint[] | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`/api/skin-data/${encodeURIComponent(name)}`, { credentials: "include" })
      .then((res) => res.json())
      .then((data: { listings?: ScatterPoint[]; saleHistory?: ScatterPoint[] }) => {
        if (!live) return;
        setPoints([
          ...(data.listings ?? []),
          ...(data.saleHistory ?? []),
        ]);
      })
      .catch(() => {
        if (live) setPoints([]);
      });
    return () => { live = false; };
  }, [name]);

  if (points === null) return <p className="preview-note">Loading float against price…</p>;
  return <PriceScatter points={points} />;
}

function signedDollars(cents: number): string {
  return cents > 0 ? `+${formatDollars(cents)}` : formatDollars(cents);
}

function toneOf(cents: number): string {
  return cents >= 0 ? "is-plus" : "is-minus";
}

function Kpi({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: string }) {
  return (
    <div className="preview-readout">
      <em>{label}</em>
      <b className={tone}>{value}</b>
      {note && <small>{note}</small>}
    </div>
  );
}

const SKELETON_ROWS = Array.from({ length: 10 }, (_, index) => index);

export function HeroProof({ tu, loading, isFree }: { tu: TradeUp | null; loading: boolean; isFree: boolean }) {
  const proof = heroProof(tu);
  const outTint = outputRarityColor(tu?.type);
  return (
    <aside
      className="preview-proof o-lifted o-arrive"
      style={{ "--stagger": 3 } as CSSProperties}
      aria-label="Top trade-up on the board"
      aria-busy={!proof && loading}
    >
      <header className="preview-proof__head">
        <p className="o-panel-title">Top trade-up on the board</p>
        {proof && <span className="preview-panel__meta">{proof.route}</span>}
      </header>
      <p className="preview-proof__caption">{PREVIEW_SUBLEDE}</p>
      {proof ? (
        <>
          <div className="preview-listings preview-listings--story">
            <p className="preview-proof__label">{proof.listings.length} input listings</p>
            {proof.listings.map((row, index) => {
              const { weapon, finish } = splitSkinName(row.skin_name);
              const href = inputListingHref(row);
              const body = (
                <>
                  <span className="preview-listing__n">{String(index + 1).padStart(2, "0")}</span>
                  <span className="preview-listing__name">
                    {weapon && <em>{weapon}</em>}
                    <b>{finish}</b>
                  </span>
                  {row.source ? <span className="preview-chip">{sourceLabel(row.source)}</span> : null}
                  <span className="preview-listing__float">{formatFloat(row.float_value) ?? "—"}</span>
                  {typeof row.price_cents === "number" ? (
                    <span className="preview-listing__price">{formatDollars(row.price_cents)}</span>
                  ) : null}
                </>
              );
              if (!href) {
                return <div key={`${row.listing_id}-${index}`} className="preview-listing">{body}</div>;
              }
              return (
                <a
                  key={`${row.listing_id}-${index}`}
                  className="preview-listing"
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {body}
                </a>
              );
            })}
          </div>
          <div className="preview-proof__outs">
            <p className="preview-proof__label">Can return</p>
            {proof.outcomes.map((row) => {
              const { weapon, finish } = splitSkinName(row.name);
              const share = row.probability < 0.01 ? "<1%" : `${Math.round(row.probability * 100)}%`;
              return (
                <Link
                  key={row.name}
                  className="preview-proof__out"
                  to={previewSkinHref(row.name)}
                  style={{ "--skin-tint": outTint } as CSSProperties}
                >
                  <span className="preview-proof__art"><Face name={row.name} /></span>
                  <span className="preview-listing__name">
                    {weapon && <em>{weapon}</em>}
                    <b>{finish}</b>
                  </span>
                  <span className="preview-proof__odds">{share}</span>
                  <span className="preview-listing__price">{formatDollars(row.priceCents)}</span>
                  <span className={`preview-proof__delta ${toneOf(row.profitCents)}`}>{signedDollars(row.profitCents)}</span>
                </Link>
              );
            })}
            {proof.hiddenOutcomes > 0 && (
              <p className="preview-note">
                +{proof.hiddenOutcomes} more {proof.hiddenOutcomes === 1 ? "outcome" : "outcomes"} on the trade-up page
              </p>
            )}
          </div>
          <div className="preview-proof__kpis">
            <Kpi label="Cost" value={formatDollars(proof.costCents)} />
            <Kpi label="Expected value (after fees)" value={formatDollars(proof.evCents)} />
            <Kpi
              label="Expected P/L"
              value={signedDollars(proof.profitCents)}
              tone={toneOf(proof.profitCents)}
            />
            <Kpi label="P(P/L > $0)" value={proof.chance === null ? "—" : `${Math.round(proof.chance * 100)}%`} />
          </div>
          <FeeLine line={boardFeeLine(proof.listings.map((row) => row.source))} />
          <footer className="preview-proof__foot">
            <Link to={`/trade-ups/${proof.id}`} className="preview-btn">Open this trade-up</Link>
            {isFree && (
              <p className="preview-note">
                {DELAY_BANNER} <Link to="/pricing">See Pro</Link>
              </p>
            )}
          </footer>
        </>
      ) : loading ? (
        <>
          <div className="preview-proof__skeleton" aria-hidden>
            {SKELETON_ROWS.map((index) => <span key={index} />)}
          </div>
          <div className="preview-proof__skeleton preview-proof__skeleton--outs" aria-hidden>
            <span />
            <span />
          </div>
          <div className="preview-proof__skeleton preview-proof__skeleton--kpis" aria-hidden>
            <span />
          </div>
          <p className="preview-note preview-proof__status">Loading the top trade-up on the board…</p>
        </>
      ) : (
        <p className="preview-note preview-proof__status">
          The board is refreshing. <Link to="/trade-ups">Open the board</Link>.
        </p>
      )}
    </aside>
  );
}

export function PreviewLanding({
  stats,
  mode = "dark",
  onBoardCounts,
}: {
  stats: LandingStatCounts | null;
  mode?: "light" | "dark";
  /** Hero trade-up totals come from this teaser response. No second count query. */
  onBoardCounts?: (counts: BoardCountSource) => void;
}) {
  const [pinRef] = useScrollProgress<HTMLElement>("cover");
  const live = usePreviewTradeUps({ perPage: 5 });

  useEffect(() => {
    if (!onBoardCounts || live.total == null) return;
    onBoardCounts({ total: live.total, total_profitable: live.totalProfitable });
  }, [live.total, live.totalProfitable, onBoardCounts]);
  const hero = pickHeroTradeUp(live.tradeUps);
  // Wait for the hero pick so the expanded card below never swaps mid-load.
  const rest = hero || !live.loading ? live.tradeUps.filter((tu) => tu.id !== hero?.id) : [];
  const featured = rest[0] ?? null;
  const collapsed = rest[1] ?? null;
  const peek = rest.slice(2, 4);

  // Follows the featured card if the hero pick shifts it, but never overrides
  // a card the visitor opened or closed themselves.
  const autoExpandedRef = useRef<number | null>(null);
  useEffect(() => {
    if (!featured || autoExpandedRef.current === featured.id) return;
    if (live.expandedId != null && live.expandedId !== autoExpandedRef.current) return;
    autoExpandedRef.current = featured.id;
    live.onExpand(featured.id);
  }, [featured, live.expandedId, live.onExpand]);

  const graphName = featured ? uniqueOutputs(featured)[0]?.skin_name ?? null : null;
  const statTiles = visibleLandingStatTiles(stats);

  return (
    <main id="main">
      <section className="preview-hero">
        <div className="preview-hero__copy">
          <p className="o-kicker o-arrive" style={{ "--stagger": 0 } as CSSProperties}>
            Listings · CSFloat · DMarket · Skinport · Buff.market
          </p>
          <h1 className="o-arrive" style={{ "--stagger": 1 } as CSSProperties}>{PREVIEW_HEADLINE}</h1>
          <p className="preview-hero__lede o-arrive" style={{ "--stagger": 2 } as CSSProperties}>
            {PREVIEW_LEDE}
          </p>
          <div className="preview-toolbar o-arrive" style={{ "--stagger": 3 } as CSSProperties}>
            <Link to="/trade-ups" className="preview-btn preview-btn--lime preview-btn--lg">
              {PREVIEW_CTA_PRIMARY}
            </Link>
            <Link to="/calculator" className="preview-btn preview-btn--lg">
              {PREVIEW_CTA_CALCULATOR}
            </Link>
            <span className="preview-hero__note">{PREVIEW_CTA_NOTE}</span>
          </div>
          {statTiles.length > 0 && (
            <div className="preview-stats o-arrive" style={{ "--stagger": 4 } as CSSProperties}>
              {statTiles.map((tile) => (
                <div key={tile.key}>
                  <b>{formatLandingStat(tile.value)}</b>
                  <span>{tile.label}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <HeroProof tu={hero} loading={live.loading} isFree={live.isFree} />
      </section>

      <div className="preview-laptop">
        <Laptop>
          <DeviceScreen mode={mode} />
        </Laptop>
      </div>
      <div className="preview-phone">
        <Phone>
          <DeviceScreen compact mode={mode} />
        </Phone>
      </div>

      <section className="preview-section preview-section--band">
        <p className="o-kicker">What you get</p>
        <h2>{PREVIEW_VALUE_HEADLINE}</h2>
        <p className="preview-section__lede">
          Costs come from live listings, not price averages. Click any input to open the listing and buy it.
        </p>
        <div className="preview-tiles">
          {PREVIEW_VALUE.map(([title, body]) => (
            <article key={title} className="preview-tile">
              <h3>{title}</h3>
              <p>{body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="preview-section">
        <p className="o-kicker">Live trade-up</p>
        <h2>One trade-up, fully opened</h2>
        <p className="preview-section__lede">
          The next trade-up on the board, opened the way the board opens it: every outcome with its probability and price after fees, the expected-value walk, the share of outcomes above each P/L, and the listings to buy.
        </p>
        {featured && (
          <div className="preview-live">
            <div className="preview-live__hero preview-card--expanded">
              <TradeUpCard
                tu={featured}
                expanded={live.expandedId === featured.id}
                onExpand={live.onExpand}
              />
            </div>
            {collapsed && live.expandedId !== collapsed.id && (
              <TradeUpCard tu={collapsed} expanded={false} expandable={false} onExpand={live.onExpand} />
            )}
          </div>
        )}
        {live.loading && !featured && <p className="preview-note">Loading trade-ups…</p>}
        {featured && (
          <div className="preview-toolbar preview-live__next">
            <Link to={`/trade-ups/${featured.id}`} className="preview-btn preview-btn--lg">
              Open this trade-up
            </Link>
            <Link to="/trade-ups" className="preview-btn preview-btn--lg">
              {PREVIEW_CTA_PRIMARY}
            </Link>
          </div>
        )}
      </section>

      <section ref={pinRef} className="preview-section" id="how">
        <p className="o-kicker">Pipeline</p>
        <h2>How it works</h2>
        <p className="preview-section__lede">
          Scan, discover, then verify and claim before you buy.
        </p>
        <div className="preview-steps preview-steps--pipeline">
          {PREVIEW_HOW.map((step) => (
            <div key={step.n} className="preview-step">
              <span className="preview-step__n">{step.n}</span>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="preview-section preview-section--band">
        <p className="o-kicker">The board</p>
        <h2>A peek at the live board</h2>
        <p className="preview-section__lede">
          The next trade-ups on the board, beside real listings and sales for the top output skin plotted by float and price.
        </p>
        <div className="preview-peek">
          <div className="preview-peek__board">
            {peek.map((tu) => (
              <TradeUpCard
                key={tu.id}
                tu={tu}
                expanded={false}
                expandable={false}
                onExpand={live.onExpand}
              />
            ))}
          </div>
          <div className="preview-peek__graph preview-panel">
            <header className="preview-panel__head">
              <p className="o-kicker">Float against price</p>
              {graphName && <span className="preview-panel__meta">{graphName}</span>}
            </header>
            {graphName ? <LandingGraph name={graphName} /> : <p className="preview-note">No output skin to plot yet.</p>}
          </div>
        </div>
        <div className="preview-toolbar">
          <Link to="/trade-ups" className="preview-btn">{PREVIEW_CTA_PRIMARY}</Link>
        </div>
      </section>

      <section id="pricing" className="preview-section">
        <p className="o-kicker">Pricing</p>
        <h2>Free, then Pro at {proPriceLine("monthly")}</h2>
        <p className="preview-section__lede">
          Start free. Upgrade when the 3-hour delay costs you trade-ups.
        </p>
        <div className="preview-tiles preview-tiles--plans">
          <article className="preview-tile preview-tile--plan">
            <h3>Free</h3>
            <p className="preview-plan__price">$0</p>
            <ul className="preview-plan__list">
              {PREVIEW_PLAN_FREE.map((item) => (
                <li key={item}><Check size={12} aria-hidden />{item}</li>
              ))}
            </ul>
            <Link className="preview-btn preview-btn--block" to="/trade-ups">Browse free</Link>
          </article>
          <article className="preview-tile preview-tile--pro preview-tile--plan">
            <h3>Pro</h3>
            <p className="preview-plan__price">{PRO_PRICE.monthly.amount}<span>{PRO_PRICE.monthly.unit}</span></p>
            <ul className="preview-plan__list">
              {PREVIEW_PLAN_PRO.map((item) => (
                <li key={item}><Check size={12} aria-hidden />{item}</li>
              ))}
            </ul>
            <p className="preview-note">{PREVIEW_PRO_PRICES}</p>
            <Link className="preview-btn preview-btn--lime preview-btn--block" to="/pricing">Compare plans</Link>
          </article>
        </div>
      </section>

      <section id="blog" className="preview-section preview-section--band">
        <p className="o-kicker">Blog</p>
        <h2>Trade-up guides</h2>
        <p className="preview-section__lede">
          How trade-ups, float values, and marketplace fees work, with the numbers behind them.
        </p>
        <div className="preview-posts preview-posts--tease">
          {BLOG_TEASERS.map((post) => (
            <Link key={post.slug} className="preview-panel preview-post" to={`/blog/${post.slug}/`}>
              <p className="preview-note">
                <time dateTime={post.publishedAt}>{post.publishedAt}</time>
                {" · "}
                {post.readTime}
              </p>
              <h3>{post.title}</h3>
              <p>{post.excerpt}</p>
            </Link>
          ))}
        </div>
        <div className="preview-toolbar">
          <Link className="preview-btn" to="/blog">All guides</Link>
        </div>
      </section>

      <section id="faq" className="preview-section preview-faq">
        <p className="o-kicker">FAQ</p>
        <h2>Frequently asked questions</h2>
        {PREVIEW_FAQ.map((item) => (
          <details key={item.q}>
            <summary>{item.q}</summary>
            <p>{item.a}</p>
          </details>
        ))}
        {LEFTOVER_FAQ.map((item) => (
          <details key={item.q}>
            <summary>{item.q}</summary>
            <p>{item.a}</p>
          </details>
        ))}
        <div className="preview-toolbar">
          <Link className="preview-btn" to="/faq">Full FAQ</Link>
        </div>
      </section>
    </main>
  );
}
