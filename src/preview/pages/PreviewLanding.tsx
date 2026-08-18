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

export function PreviewLanding({ stats }: { stats: GlobalStats | null }) {
  const [pinRef] = useScrollProgress<HTMLElement>("cover");

  return (
    <main id="main">
      <section className="preview-hero">
        <p className="o-arrive" style={{ color: "var(--text-muted)", fontSize: 12, "--stagger": 0 } as CSSProperties}>
          Spend management · live listings
        </p>
        <h1 className="o-arrive" style={{ "--stagger": 1 } as CSSProperties}>{PREVIEW_HEADLINE}</h1>
        <p className="o-arrive mt-5 text-[1.05rem] leading-relaxed" style={{ "--stagger": 2 } as CSSProperties}>
          {PREVIEW_LEDE}
        </p>
        <p className="o-arrive mt-3 text-sm" style={{ "--stagger": 3 } as CSSProperties}>
          {PREVIEW_SUBLEDE}
        </p>
        <div className="o-arrive mt-7 flex flex-wrap gap-3" style={{ "--stagger": 4 } as CSSProperties}>
          <Link to="/preview/trade-ups" className="preview-btn preview-btn--lime">
            Open the console →
          </Link>
          <a href="#faq" className="preview-btn preview-btn--ghost">Read the controls brief</a>
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

      <div className="preview-laptop px-6">
        <Laptop>
          <DeviceScreen />
        </Laptop>
      </div>
      <div className="preview-phone px-6">
        <Phone>
          <DeviceScreen compact />
        </Phone>
      </div>

      <section className="preview-section" style={{ background: "var(--panel)" }}>
        <h2 className="text-3xl font-semibold tracking-tight mb-3">{PREVIEW_VALUE_HEADLINE}</h2>
        <p className="max-w-2xl" style={{ color: "var(--text-muted)" }}>
          Costs come from live listings, not price averages. Click any input to open the listing and buy it.
        </p>
        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {[
            ["Real listings", "Each input links to a live listing on CSFloat, DMarket, Skinport, or Buff.market."],
            ["Verify before buying", "Verify re-checks every input against the marketplace: still listed, and at what price."],
            ["Claim to lock", "Pro users can claim a trade-up for 30 minutes, hiding its listings from other TradeUpBot users while they buy."],
          ].map(([title, body]) => (
            <article key={title} className="preview-card min-h-0">
              <h3 className="font-semibold">{title}</h3>
              <p className="mt-2 text-sm" style={{ color: "var(--text-muted)" }}>{body}</p>
            </article>
          ))}
        </div>
      </section>

      <section ref={pinRef} className="preview-section" id="how">
        <h2 className="text-3xl font-semibold tracking-tight mb-10">How it works</h2>
        <div className="grid gap-8 md:grid-cols-3">
          {[
            ["01", "Scan", "Listings pulled from CSFloat, DMarket, Skinport, and Buff.market every cycle. Continuous DMarket coverage at 2 req/s."],
            ["02", "Discover", "Algorithms test thousands of input combinations at 45+ float targets. Swap optimization improves results each cycle."],
            ["03", "Claim", "Pro users see results instantly. Claim a trade-up to hide its listings from other TradeUpBot users for 30 minutes while you buy."],
          ].map(([n, title, desc]) => (
            <div key={n}>
              <div className="text-xs mb-2" style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>{n}</div>
              <h3 className="font-semibold mb-2">{title}</h3>
              <p className="text-sm leading-relaxed" style={{ color: "var(--text-muted)" }}>{desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="faq" className="preview-section preview-faq">
        <h2 className="text-3xl font-semibold tracking-tight mb-8">Frequently Asked Questions</h2>
        {PREVIEW_FAQ.map((item) => (
          <details key={item.q}>
            <summary>{item.q}</summary>
            <p className="mt-3 text-sm leading-relaxed" style={{ color: "var(--text-muted)" }}>{item.a}</p>
          </details>
        ))}
      </section>
    </main>
  );
}
