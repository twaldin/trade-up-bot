import type { CSSProperties } from "react";
import { Link } from "react-router-dom";
import { DeviceScreen } from "../components/DeviceScreen.js";
import { Laptop } from "../kit/ledger/laptop.js";
import { Phone } from "../kit/orbit/phone.js";
import { useScrollProgress } from "../kit/lib/motion.js";
import {
  PREVIEW_FAQ,
  PREVIEW_HEADLINE,
  PREVIEW_LEDE,
  PREVIEW_SUBLEDE,
  PREVIEW_VALUE_HEADLINE,
} from "../lib/copy.js";

interface GlobalStats {
  total_trade_ups: number;
  profitable_trade_ups: number;
  total_data_points: number;
  total_cycles: number;
}

const VALUE = [
  ["Real listings", "Each input links to a live listing on CSFloat, DMarket, Skinport, or Buff.market."],
  ["Verify before buying", "Verify re-checks every input against the marketplace: still listed, and at what price."],
  ["Claim to lock", "Pro users can claim a trade-up for 30 minutes, hiding its listings from other TradeUpBot users while they buy."],
] as const;

const STEPS = [
  ["01", "Scan", "Listings pulled from CSFloat, DMarket, Skinport, and Buff.market every cycle. Continuous DMarket coverage at 2 req/s."],
  ["02", "Discover", "Algorithms test thousands of input combinations at 45+ float targets. Swap optimization improves results each cycle."],
  ["03", "Claim", "Pro users see results instantly. Claim a trade-up to hide its listings from other TradeUpBot users for 30 minutes while you buy."],
] as const;

export function PreviewLanding({
  stats,
  mode = "dark",
}: {
  stats: GlobalStats | null;
  mode?: "light" | "dark";
}) {
  const [pinRef] = useScrollProgress<HTMLElement>("cover");

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
          <Link to="/preview/trade-ups" className="preview-btn preview-btn--lime preview-btn--lg">
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
          {VALUE.map(([title, body]) => (
            <article key={title} className="preview-tile">
              <h3>{title}</h3>
              <p>{body}</p>
            </article>
          ))}
        </div>
      </section>

      <section ref={pinRef} className="preview-section" id="how">
        <p className="o-kicker">Pipeline</p>
        <h2>How it works</h2>
        <div className="preview-steps">
          {STEPS.map(([n, title, desc]) => (
            <div key={n} className="preview-step">
              <span className="preview-step__n">{n}</span>
              <h3>{title}</h3>
              <p>{desc}</p>
            </div>
          ))}
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
      </section>
    </main>
  );
}
