import type { CSSProperties } from "react";
import { Link } from "react-router-dom";
import { PreviewSeo } from "../components/PreviewSeo.js";
import { authHref } from "../../lib/ref.js";
import { trackEvent } from "../../lib/analytics.js";
import { rarityTint } from "../lib/board.js";
import { seoPage } from "../lib/seo-pages.js";

const seo = seoPage("/features");

const MARKETS = [
  ["CSFloat", "Primary source for Covert skins and sale-based output pricing. Sale history gives the most reliable price signal."],
  ["DMarket", "Broad coverage across all rarity tiers at 2 requests/second continuous fetching. Fills gaps in CSFloat coverage."],
  ["Skinport", "Passive WebSocket feed with no rate limits. Provides additional price data and listing availability."],
  ["Buff.market", "Buy-now listings fetched continuously in a separate process. Extends input coverage beyond the other three."],
] as const;

const TIERS = [
  { name: "Knife / Gloves", rarity: "Extraordinary", desc: "5 Covert inputs produce 1 Knife or Glove from the matching case collection pool" },
  { name: "Covert", rarity: "Covert", desc: "10 Classified inputs produce 1 Covert gun skin" },
  { name: "Classified", rarity: "Classified", desc: "10 Restricted inputs produce 1 Classified gun skin" },
  { name: "Restricted", rarity: "Restricted", desc: "10 Mil-Spec inputs produce 1 Restricted gun skin" },
  { name: "Mil-Spec", rarity: "Mil-Spec", desc: "10 Industrial inputs produce 1 Mil-Spec gun skin" },
  { name: "Industrial", rarity: "Industrial Grade", desc: "10 Consumer inputs produce 1 Industrial gun skin" },
] as const;

export function PreviewFeatures() {
  return (
    <div className="preview-market">
      <PreviewSeo title={seo.title} description={seo.description} canonical="https://tradeupbot.app/features" />
      <header className="preview-page__head">
        <div>
          <h1>TradeUpBot Features</h1>
          <p>How TradeUpBot finds, prices, and verifies profitable CS2 trade-up contracts.</p>
        </div>
      </header>

      <section className="preview-doc">
        <h2>Real marketplace listings</h2>
        <p>Every trade-up is built from skins currently listed on CSFloat, DMarket, Skinport, and Buff.market. Each input links to a specific listing with its actual float and price, so the cost you see is the cost you pay.</p>
        <div className="preview-tiles">
          {MARKETS.map(([title, body]) => (
            <article key={title} className="preview-tile">
              <h3>{title}</h3>
              <p>{body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="preview-doc">
        <h2>Outcome analysis with probability charts</h2>
        <p>Expand any trade-up to see every possible output skin, its probability, its estimated value, and its profit or loss. The distribution chart shows which outcomes are likely and how deep the downside runs.</p>
        <p>Each outcome's value accounts for the exact output float your inputs would produce, the resulting wear condition, and marketplace seller fees.</p>
      </section>

      <section className="preview-doc">
        <h2>Float-targeted discovery across 45+ targets</h2>
        <p>Each input combination is evaluated at 45+ float targets, clustered around condition boundaries (Factory New/Minimal Wear at 0.07, Minimal Wear/Field-Tested at 0.15, and so on).</p>
        <p>That locates the crossing point where an output flips to a better condition, which single-target calculators miss. Swap optimization retests replacement inputs on existing trade-ups each cycle.</p>
      </section>

      <section className="preview-doc">
        <h2>Verify system</h2>
        <p>Before spending money, hit Verify. It calls each marketplace's API to confirm every input listing still exists and at what price. The trade-up's cost, profit, and ROI update from the response.</p>
        <p><b>Pro tier:</b> 20 verifications/hour</p>
      </section>

      <section className="preview-doc">
        <h2>Claim system</h2>
        <p>Pro users can claim a trade-up to hide its listings from all other TradeUpBot users for 30 minutes. Anyone shopping the marketplace directly can still buy the inputs — a claim removes your TradeUpBot competition, not the listings themselves.</p>
        <p><b>Pro rate:</b> 10 claims/hour · <b>Active claims:</b> Up to 5 simultaneously · <b>Duration:</b> 30 minutes, auto-expires</p>
      </section>

      <section className="preview-doc">
        <h2>All rarity tiers covered</h2>
        <p>TradeUpBot discovers trade-ups in every CS2 rarity tier, from Consumer inputs costing cents to Knife and Glove contracts.</p>
        <div className="preview-stack">
          {TIERS.map((tier) => (
            <div key={tier.name} className="preview-pick" style={{ "--skin-tint": rarityTint(tier.rarity) } as CSSProperties}>
              <b style={{ color: rarityTint(tier.rarity) }}>{tier.name}</b>
              <span className="preview-note">{tier.desc}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="preview-doc">
        <h2>Price intelligence from 3 data sources</h2>
        <p>Output pricing uses CSFloat sale history first. DMarket and Skinport listing data fill gaps when CSFloat has no coverage for a skin or condition. Knife and glove output pricing uses a KNN model trained on 120,000+ price observations for float-precise estimates.</p>
        <p>Input pricing uses actual listing prices with marketplace-specific buyer fees applied: CSFloat (2.8% + $0.30), DMarket (2.5%), Skinport (0%). Seller fees are deducted from output estimates: CSFloat (2%), DMarket (2%), Skinport (8%). All values in the table reflect these real-world costs.</p>
      </section>

      <section className="preview-doc">
        <h2>Collection browser with knife/glove pool info</h2>
        <p>Browse every CS2 collection: which knife and glove finishes are in its pool, how many listings exist per rarity tier, and which collections currently have profitable trade-ups. Filter by knives, gloves, or profitability.</p>
      </section>

      <section className="preview-doc">
        <h2>Continuously updated</h2>
        <p>The discovery engine runs in roughly 20-minute cycles, scanning new listings and recalculating trade-ups. DMarket is fetched continuously at 2 requests per second in a separate process; Skinport streams in over a live WebSocket. Each cycle also runs swap optimization on existing trade-ups and rebuilds ones whose listings sold.</p>
      </section>

      <section className="preview-panel">
        <header className="preview-panel__head">
          <p className="o-kicker">Start free</p>
        </header>
        <p className="preview-note">Sign in with Steam. The free tier shows trade-up data on a 3-hour delay; contracts whose inputs sell in the meantime drop out.</p>
        <div className="preview-toolbar">
          <a
            className="preview-btn preview-btn--lime"
            href={authHref("/trade-ups")}
            onClick={() => trackEvent("sign_up_start", { location: "features_cta" })}
            rel="nofollow"
          >
            Sign in with Steam
          </a>
          <Link className="preview-btn" to="/trade-ups">Open the live trade-up table</Link>
        </div>
      </section>
    </div>
  );
}
