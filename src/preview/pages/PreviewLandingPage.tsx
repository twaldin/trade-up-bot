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
          <Link to="/preview/trade-ups" className="pv-btn pv-btn-ghost">Board</Link>
          <Link to="/preview/calculator" className="pv-btn pv-btn-ghost">Calculator</Link>
          <Link to="/preview/account" className="pv-btn pv-btn-ghost">Account</Link>
          <PreviewThemeToggle />
          <Link to="/preview/trade-ups" className="pv-btn">View Trade-Ups</Link>
        </div>
      </header>

      <section className="pv-hero pv-hero-saas">
        <div className="pv-hero-copy">
          <div className="pv-kicker">CS2 trade-up contracts</div>
          <h1>CS2 trade-ups built from<br />real, buyable listings</h1>
          <p>
            Most calculators price trade-ups with idealized floats and average prices. TradeUpBot builds each contract from listings currently for sale.
          </p>
          <p className="pv-hero-sub">
            Every input links to a specific listing on CSFloat, DMarket, Skinport, or Buff.market, with its exact float and price. The output float is computed from your inputs, not estimated.
          </p>
          <div className="pv-hero-actions">
            <Link to="/preview/trade-ups" className="pv-btn">View Trade-Ups</Link>
            <Link to="/preview/calculator" className="pv-btn pv-btn-ghost">CS2 Trade-Up Calculator</Link>
            <span className="pv-muted">Free — no account needed</span>
          </div>
        </div>
        <div className="pv-stage" data-hero="pv-laptop">
          <div className="pv-mac">
            <div className="pv-mac-lid">
              <span className="pv-mac-camera" />
              <div className="pv-mac-screen">
                <img src="/preview-board-laptop.png" alt="TradeUpBot trade-up dashboard" />
              </div>
            </div>
            <div className="pv-mac-base">
              <div className="pv-mac-deck" />
              <div className="pv-mac-pad" />
            </div>
          </div>
          <div className="pv-phone">
            <div className="pv-phone-bezel">
              <img src="/preview-board-phone.png" alt="TradeUpBot dashboard on a phone" />
            </div>
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

      <section className="pv-value">
        <h2>Outcome analysis</h2>
        <p>Every possible outcome with its probability, value after seller fees, and the exact inputs to buy.</p>
        <h2 style={{ marginTop: 28 }}>Price intelligence</h2>
        <p>Float vs price scatter charts with data from CSFloat, DMarket, Skinport, and sale history across every condition.</p>
      </section>

      <section className="pv-value">
        <h2>How it works</h2>
        <div className="pv-value-grid">
          <div>
            <div className="pv-kicker">01</div>
            <h3>Scan</h3>
            <p>Listings pulled from CSFloat, DMarket, Skinport, and Buff.market every cycle. Continuous DMarket coverage at 2 req/s.</p>
          </div>
          <div>
            <div className="pv-kicker">02</div>
            <h3>Discover</h3>
            <p>Algorithms test thousands of input combinations at 45+ float targets. Swap optimization improves results each cycle.</p>
          </div>
          <div>
            <div className="pv-kicker">03</div>
            <h3>Claim</h3>
            <p>Pro users see results instantly. Claim a trade-up to hide its listings from other TradeUpBot users for 30 minutes while you buy.</p>
          </div>
        </div>
      </section>

      <section className="pv-value">
        <h2>All rarity tiers</h2>
        <p>From cheap Consumer skins to Knife/Glove contracts.</p>
        <div className="pv-tier-list">
          <div>Knife / Gloves — 5 Covert → Knife or Glove</div>
          <div>Covert — 10 Classified → Covert</div>
          <div>Classified — 10 Restricted → Classified</div>
          <div>Restricted — 10 Mil-Spec → Restricted</div>
          <div>Mil-Spec — 10 Industrial → Mil-Spec</div>
          <div>Industrial — 10 Consumer → Industrial</div>
        </div>
      </section>
    </div>
  );
}
