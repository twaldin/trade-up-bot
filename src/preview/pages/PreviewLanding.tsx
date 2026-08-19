import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import { DeviceScreen } from "../components/DeviceScreen.js";
import { PriceScatter, type ScatterPoint } from "../components/PriceScatter.js";
import { Laptop } from "../kit/ledger/laptop.js";
import { Phone } from "../kit/orbit/phone.js";
import { usePointerTilt, useScrollProgress } from "../kit/lib/motion.js";
import { blogMeta } from "../../data/blog-meta.js";
import {
  formatFloat,
  inputListingHref,
  inputRarityColor,
  outputRarityColor,
  previewSkinHref,
  splitSkinName,
  storyRailInputs,
  uniqueInputs,
  uniqueOutputs,
} from "../lib/board.js";
import {
  PREVIEW_FAQ,
  PREVIEW_HEADLINE,
  PREVIEW_HOW,
  PREVIEW_LEDE,
  PREVIEW_SUBLEDE,
  PREVIEW_VALUE,
  PREVIEW_VALUE_HEADLINE,
} from "../lib/copy.js";
import { faqEntities, seoPage } from "../lib/seo-pages.js";
import { formatDollars, sourceLabel } from "../../utils/format.js";
import { boardFaceFor, TradeUpCard, usePreviewTradeUps } from "./PreviewBoard.js";

interface GlobalStats {
  total_trade_ups: number;
  profitable_trade_ups: number;
  total_data_points: number;
  total_cycles: number;
}

const LEFTOVER_FAQ = faqEntities(seoPage("/faq"));
const BLOG_TEASERS = blogMeta.slice(0, 4);

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

export function PreviewLanding({
  stats,
  mode = "dark",
}: {
  stats: GlobalStats | null;
  mode?: "light" | "dark";
}) {
  const [pinRef] = useScrollProgress<HTMLElement>("cover");
  const [deckRef] = useScrollProgress<HTMLDivElement>("cover");
  const tiltRef = usePointerTilt<HTMLDivElement>();
  const live = usePreviewTradeUps({ perPage: 3 });
  const featured = live.tradeUps[0] ?? null;
  const collapsed = live.tradeUps[1] ?? null;
  const peek = live.tradeUps.slice(1, 3);

  useEffect(() => {
    if (!featured || live.expandedId != null) return;
    live.onExpand(featured.id);
  }, [featured, live.expandedId, live.onExpand]);

  const floatSkins = useMemo(() => {
    if (!featured) return [];
    const inTint = inputRarityColor(featured.type);
    const outTint = outputRarityColor(featured.type);
    const inputs = uniqueInputs(featured).map((group) => ({
      name: group.name,
      tint: inTint,
      role: "in" as const,
    }));
    const outputs = uniqueOutputs(featured).map((outcome) => ({
      name: outcome.skin_name,
      tint: outTint,
      role: "out" as const,
    }));
    return [...inputs, ...outputs].slice(0, 6);
  }, [featured]);

  const graphName = featured ? uniqueOutputs(featured)[0]?.skin_name ?? null : null;
  const listingRows = featured ? storyRailInputs(featured) : [];

  return (
    <main id="main">
      <section className="preview-hero">
        <p className="o-kicker o-arrive" style={{ "--stagger": 0 } as CSSProperties}>
          Live listings · CSFloat · DMarket · Skinport · Buff.market
        </p>
        <h1 className="o-arrive" style={{ "--stagger": 1 } as CSSProperties}>{PREVIEW_HEADLINE}</h1>
        <p className="preview-hero__lede o-arrive" style={{ "--stagger": 2 } as CSSProperties}>
          {PREVIEW_LEDE}
        </p>
        <p className="preview-hero__sub o-arrive" style={{ "--stagger": 3 } as CSSProperties}>
          {PREVIEW_SUBLEDE}
        </p>
        <div className="preview-toolbar o-arrive" style={{ "--stagger": 4 } as CSSProperties}>
          <Link to="/trade-ups" className="preview-btn preview-btn--lime preview-btn--lg">
            Open the console
          </Link>
          <a href="#how" className="preview-btn preview-btn--lg">How it works</a>
        </div>
        {stats && (
          <div className="preview-stats o-arrive" style={{ "--stagger": 5 } as CSSProperties}>
            <div><b>{stats.total_trade_ups.toLocaleString()}</b><span>trade-ups</span></div>
            <div><b>{stats.profitable_trade_ups.toLocaleString()}</b><span>profitable</span></div>
            <div><b>{stats.total_data_points.toLocaleString()}</b><span>data points</span></div>
            <div><b>{stats.total_cycles}</b><span>cycles analyzed</span></div>
          </div>
        )}
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
        {listingRows.length > 0 && (
          <div className="preview-listings preview-listings--story">
            {listingRows.map((row, index) => {
              const { weapon, finish } = splitSkinName(row.skin_name);
              return (
                <a
                  key={`${row.listing_id}-${index}`}
                  className="preview-listing"
                  href={inputListingHref(row)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <span className="preview-listing__n">{String(index + 1).padStart(2, "0")}</span>
                  <span className="preview-listing__name">
                    {weapon && <em>{weapon}</em>}
                    <b>{finish}</b>
                  </span>
                  <span className="preview-chip">{sourceLabel(row.source)}</span>
                  <span className="preview-listing__float">{formatFloat(row.float_value) ?? "—"}</span>
                  <span className="preview-listing__price">{formatDollars(row.price_cents)}</span>
                </a>
              );
            })}
          </div>
        )}
      </section>

      <section className="preview-section">
        <p className="o-kicker">Live trade-up</p>
        <h2>The card, expanded</h2>
        <p className="preview-section__lede">
          KPI row, output tiles with price and odds, and the float-versus-price graph language — not a screenshot.
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
              <TradeUpCard tu={collapsed} expanded={false} onExpand={live.onExpand} />
            )}
          </div>
        )}
        {live.loading && !featured && <p className="preview-note">Loading trade-ups…</p>}
      </section>

      <section className="preview-section preview-section--band">
        <p className="o-kicker">Skins</p>
        <h2>Stacked from the live inputs</h2>
        <p className="preview-section__lede">
          Faces take the rarity tint of that skin. Lime stays profit, never a rarity.
        </p>
        <div
          ref={(node) => {
            deckRef.current = node;
            tiltRef.current = node;
          }}
          className="preview-floatdeck"
        >
          {floatSkins.map((skin, index) => {
            const { weapon, finish } = splitSkinName(skin.name);
            return (
              <Link
                key={`${skin.role}-${skin.name}`}
                className="preview-floatcard"
                to={previewSkinHref(skin.name)}
                style={{
                  "--skin-tint": skin.tint,
                  "--i": index,
                  "--n": floatSkins.length,
                } as CSSProperties}
              >
                <span className="preview-floatcard__art"><Face name={skin.name} /></span>
                <span className="preview-floatcard__meta">
                  <em>{weapon}</em>
                  <b>{finish}</b>
                </span>
              </Link>
            );
          })}
        </div>
      </section>

      <section ref={pinRef} className="preview-section" id="how">
        <p className="o-kicker">Pipeline</p>
        <h2>How it works</h2>
        <p className="preview-section__lede">
          Scan, discover, target the float, price it, then verify and claim. The expanded card is the same detail the console opens.
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
        <p className="o-kicker">Board + graph</p>
        <h2>A peek at the live board</h2>
        <p className="preview-section__lede">
          Collapsed cards from the first page, and the same float-versus-price scatter the skin page draws.
        </p>
        <div className="preview-peek">
          <div className="preview-peek__board">
            {peek.map((tu) => (
              <TradeUpCard
                key={tu.id}
                tu={tu}
                expanded={false}
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
      </section>

      <section id="pricing" className="preview-section">
        <p className="o-kicker">Pricing</p>
        <h2>Free, then Pro at $6.99</h2>
        <p className="preview-section__lede">
          Start free. Upgrade when the 3-hour delay costs you trade-ups.
        </p>
        <div className="preview-tiles preview-tiles--plans">
          <article className="preview-tile">
            <h3>Free</h3>
            <p className="preview-plan__price">$0</p>
            <p>Full access to all trade-ups with filters, sorting, and listing links. 3-hour data delay.</p>
          </article>
          <article className="preview-tile preview-tile--pro">
            <h3>Pro</h3>
            <p className="preview-plan__price">$6.99<span>/mo</span></p>
            <p>Real-time data, claim system, and full analytics.</p>
          </article>
        </div>
        <div className="preview-toolbar">
          <Link className="preview-btn preview-btn--lime" to="/pricing">Compare plans</Link>
        </div>
      </section>

      <section id="blog" className="preview-section preview-section--band">
        <p className="o-kicker">Blog</p>
        <h2>Guides from the live set</h2>
        <p className="preview-section__lede">
          Titles and links from existing posts. Nothing invented.
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
