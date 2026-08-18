import { Link } from "react-router-dom";
import { PreviewHeroMock } from "../mock/PreviewHeroMock.js";

export function PreviewLandingPage() {
  return (
    <div>
      <title>Preview — TradeUpBot</title>
      <meta name="robots" content="noindex, nofollow" />
      <header className="pv-landing-nav">
        <div className="pv-brand">
          <span className="pv-brand-mark" />
          TradeUpBot
        </div>
        <div style={{ display: "flex", gap: 16, alignItems: "center", fontSize: 13 }}>
          <Link to="/preview/trade-ups" className="pv-muted">Board</Link>
          <Link to="/preview/calculator" className="pv-muted">Calculator</Link>
          <Link to="/preview/account" className="pv-muted">Account</Link>
          <Link to="/preview/trade-ups" className="pv-btn">Open the board →</Link>
        </div>
      </header>

      <section className="pv-hero">
        <div className="pv-kicker">CS2 trade-up contracts</div>
        <h1>See the ten skins before they become one.</h1>
        <p>
          TradeUpBot ranks live 10-to-1 contracts from CSFloat, DMarket, Skinport, and Buff.
          Deterministic output float. Profit you can actually take — not a pasted dashboard.
        </p>
        <div className="pv-hero-actions">
          <Link to="/preview/trade-ups" className="pv-btn">Open the board →</Link>
          <Link to="/preview/calculator" className="pv-btn pv-btn-ghost">Open the calculator</Link>
        </div>
      </section>

      <dl className="pv-metrics">
        <div><dt>Inputs</dt><dd>10 skins</dd></div>
        <div><dt>Output</dt><dd>1 skin</dd></div>
        <div><dt>Tiers</dt><dd>6 rarities</dd></div>
        <div><dt>Feeds</dt><dd>Live listings</dd></div>
      </dl>

      <div className="pv-stage" data-hero="pv-laptop">
        <PreviewHeroMock />
      </div>
    </div>
  );
}
