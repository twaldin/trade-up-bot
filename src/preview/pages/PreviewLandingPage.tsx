import { Link } from "react-router-dom";
import { PreviewLogo } from "../chrome/PreviewLogo.js";
import { PreviewListingsStory } from "../landing/PreviewListingsStory.js";
import { PreviewThemeToggle } from "../theme/PreviewTheme.js";

export function PreviewLandingPage() {
  return (
    <div>
      <title>TradeUpBot — Find Profitable CS2 Trade-Ups from Real Listings</title>
      <meta name="robots" content="noindex, nofollow" />
      <header className="pv-landing-nav">
        <div className="pv-brand">
          <PreviewLogo />
          TradeUpBot
        </div>
        <div className="pv-landing-links">
          <Link to="/preview/trade-ups">Board</Link>
          <Link to="/preview/calculator">Calculator</Link>
          <Link to="/preview/account">Account</Link>
          <PreviewThemeToggle />
          <Link to="/preview/trade-ups" className="pv-btn">View Trade-Ups</Link>
        </div>
      </header>

      <section className="pv-hero pv-hero-saas">
        <div className="pv-hero-copy">
          <h1>CS2 trade-ups built from<br />real, buyable listings</h1>
          <p>
            Most calculators price trade-ups with idealized floats and average prices. TradeUpBot builds each contract from listings currently for sale.
          </p>
          <p className="pv-hero-sub">
            Every input links to a specific listing on CSFloat, DMarket, Skinport, or Buff.market, with its exact float and price. The output float is computed from your inputs, not estimated.
          </p>
          <div className="pv-hero-actions">
            <Link to="/preview/trade-ups" className="pv-btn">View Trade-Ups</Link>
            <span className="pv-muted">Free — no account needed</span>
          </div>
        </div>
        <div className="pv-stage" data-hero="pv-laptop">
          <div className="pv-laptop">
            <div className="pv-laptop-lid">
              <div className="pv-laptop-screen">
                <img src="/preview-board-laptop.png" alt="TradeUpBot trade-up dashboard" />
              </div>
            </div>
            <div className="pv-laptop-base" />
          </div>
          <div className="pv-phone">
            <img src="/preview-board-phone.png" alt="TradeUpBot dashboard on a phone" />
          </div>
        </div>
      </section>

      <PreviewListingsStory />

      <section className="pv-value">
        <h2>What you see is what you pay</h2>
        <p>Costs come from live listings, not price averages. Click any input to open the listing and buy it.</p>
        <div className="pv-value-grid">
          <div>
            <h3>Real listings</h3>
            <p>Each input links to a live listing on CSFloat, DMarket, Skinport, or Buff.market.</p>
          </div>
          <div>
            <h3>Verify before buying</h3>
            <p>Verify re-checks every input against the marketplace: still listed, and at what price. Stats update before you spend.</p>
          </div>
          <div>
            <h3>Claim to lock</h3>
            <p>Pro users can claim a trade-up for 30 minutes, hiding its listings from other TradeUpBot users while they buy.</p>
          </div>
        </div>
      </section>
    </div>
  );
}
