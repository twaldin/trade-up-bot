import { Link } from "react-router-dom";
import { PreviewSeo } from "../components/PreviewSeo.js";
import { seoPage } from "../lib/seo-pages.js";

const TERMS = seoPage("/terms");
const PRIVACY = seoPage("/privacy");

export function PreviewTerms() {
  return (
    <div className="preview-market">
      <PreviewSeo title={TERMS.title} description={TERMS.description} canonical="https://tradeupbot.app/terms" />
      <header className="preview-page__head">
        <div>
          <h1>Terms of Service</h1>
          <p>Last updated: March 2026</p>
        </div>
      </header>
      <article className="preview-doc">
        <h2>1. Service Description</h2>
        <p>TradeUpBot is a trade-up contract analysis tool for Counter-Strike 2. The platform identifies potentially profitable trade-up contracts by analyzing real marketplace listings across CSFloat, DMarket, and Skinport.</p>
        <p>TradeUpBot is an informational tool only. It does not execute trades, hold inventory, or manage funds on your behalf. All purchasing decisions and transactions are made by you directly on third-party marketplaces.</p>

        <h2>2. Disclaimer</h2>
        <div className="preview-panel">
          <p className="o-kicker">Important Notice</p>
          <p>All prices displayed on TradeUpBot are <strong>estimates</strong> based on marketplace data including sale history, current listings, and algorithmic extrapolation. These prices may not reflect the actual price you will pay or receive when transacting on any marketplace.</p>
          <p>TradeUpBot is <strong>not responsible for any financial losses</strong> incurred from trade-up contracts informed by our analysis. Past performance and displayed profitability metrics do not guarantee future results.</p>
          <p>This service does not constitute financial, investment, or trading advice. Use TradeUpBot at your own risk.</p>
        </div>

        <h2>3. Trade Lock Warning</h2>
        <p>Items purchased from third-party marketplaces (CSFloat, DMarket, Skinport) are subject to trade lock periods imposed by Valve/Steam. During these lock periods, items cannot be used in trade-up contracts. Market prices may change significantly during the lock period, affecting the profitability of any planned trade-up.</p>
        <p>You are solely responsible for understanding and accounting for trade lock periods when planning trade-ups.</p>

        <h2>4. No Guarantee of Profit</h2>
        <p>Trade-ups labeled as "profitable" on TradeUpBot are based on current estimated prices, which are subject to change at any time. Factors that may cause actual results to differ include:</p>
        <ul>
          <li>Price fluctuations between viewing and purchasing inputs</li>
          <li>Price changes during trade lock periods</li>
          <li>Listings being sold or delisted before you can purchase them</li>
          <li>Differences between estimated and actual marketplace fees</li>
          <li>Receiving lower-value outcomes on probabilistic trade-ups</li>
          <li>Marketplace-specific pricing variations</li>
        </ul>

        <h2>5. Payment Terms</h2>
        <p>TradeUpBot offers free and paid subscription tiers. Paid subscriptions are billed monthly through Stripe. By subscribing, you agree to recurring monthly charges until you cancel.</p>
        <p>You may cancel your subscription at any time through the account menu or by contacting support. Cancellation takes effect at the end of the current billing period. No refunds are provided for partial billing periods.</p>
        <p>Subscription prices are subject to change with 30 days notice.</p>

        <h2>6. Steam Authentication</h2>
        <p>TradeUpBot uses Steam OpenID for authentication. When you sign in, we receive and store your Steam ID and public display name. We do not receive, store, or have access to your Steam password, inventory, or wallet.</p>

        <h2>7. Account Termination</h2>
        <p>We reserve the right to suspend or terminate accounts that:</p>
        <ul>
          <li>Abuse rate limits or attempt to circumvent access controls</li>
          <li>Use automated tools to scrape or extract data from the platform</li>
          <li>Engage in activity that disrupts the service for other users</li>
          <li>Violate these Terms of Service</li>
        </ul>
        <p>You may delete your account and associated data at any time by contacting us.</p>

        <h2>8. Limitation of Liability</h2>
        <p>To the maximum extent permitted by applicable law, TradeUpBot and its operators shall not be liable for any indirect, incidental, special, consequential, or punitive damages, including but not limited to loss of profits, data, or goodwill, arising from:</p>
        <ul>
          <li>Your use of or inability to use the service</li>
          <li>Any trade-up contracts executed based on information from the service</li>
          <li>Inaccurate, incomplete, or outdated pricing data</li>
          <li>Third-party marketplace outages, changes, or fee modifications</li>
          <li>Unauthorized access to your account</li>
        </ul>
        <p>The total liability of TradeUpBot for any claim arising from use of the service shall not exceed the amount you paid for the service in the 12 months preceding the claim.</p>

        <h2>9. Age Requirement</h2>
        <p>You must be at least 13 years of age to use TradeUpBot, consistent with Steam's minimum age requirement. If you are under 18, you should review these terms with a parent or guardian.</p>

        <h2>10. Changes to Terms</h2>
        <p>We may update these Terms of Service from time to time. Continued use of the service after changes constitutes acceptance of the revised terms. Material changes will be communicated through the platform.</p>

        <h2>11. Contact</h2>
        <p>For questions about these terms, contact us via Discord or through the platform's support channels.</p>
      </article>
      <div className="preview-toolbar">
        <Link className="preview-btn" to="/privacy">Privacy Policy</Link>
        <Link className="preview-btn" to="/faq">FAQ</Link>
      </div>
    </div>
  );
}

export function PreviewPrivacy() {
  return (
    <div className="preview-market">
      <PreviewSeo title={PRIVACY.title} description={PRIVACY.description} canonical="https://tradeupbot.app/privacy" />
      <header className="preview-page__head">
        <div>
          <h1>Privacy Policy</h1>
          <p>Last updated: March 2026</p>
        </div>
      </header>
      <article className="preview-doc">
        <h2>What We Collect</h2>
        <p>When you sign in and use TradeUpBot, we collect and store the following information:</p>
        <ul>
          <li><strong>Steam ID</strong> — your unique Steam identifier, received via Steam OpenID authentication</li>
          <li><strong>Display name</strong> — your public Steam display name</li>
          <li><strong>Avatar URL</strong> — your public Steam profile avatar</li>
          <li><strong>Email address</strong> — provided to us by Stripe when you subscribe to a paid plan</li>
          <li><strong>Subscription status</strong> — your current plan tier and billing status</li>
          <li><strong>Usage data</strong> — claims, verifications, and feature usage for rate limiting</li>
        </ul>

        <h2>What We Do Not Collect</h2>
        <p>TradeUpBot does not collect, store, or have access to:</p>
        <ul>
          <li><strong>Steam password</strong> — authentication is handled entirely by Steam OpenID; we never see your password</li>
          <li><strong>Steam inventory data</strong> — we do not access or read your Steam inventory</li>
          <li><strong>Payment card details</strong> — all payment processing is handled by Stripe; card numbers never touch our servers</li>
          <li><strong>Marketplace credentials</strong> — we do not store your CSFloat, DMarket, or Skinport login details</li>
        </ul>

        <h2>Cookies</h2>
        <p>TradeUpBot uses a single session cookie for authentication. This cookie identifies your login session and is required for the service to function. We do not use tracking cookies, advertising cookies, or third-party analytics cookies.</p>

        <h2>Third-Party Services</h2>
        <p>TradeUpBot integrates with the following third-party services:</p>
        <div className="preview-tiles">
          <article className="preview-tile">
            <h3>Stripe</h3>
            <p>Payment processing for subscriptions. Stripe receives your payment information directly and shares your email address with us for account management. See Stripe's privacy policy at <a href="https://stripe.com/privacy" target="_blank" rel="noopener noreferrer">stripe.com/privacy</a>.</p>
          </article>
          <article className="preview-tile">
            <h3>Steam (Valve)</h3>
            <p>Authentication via Steam OpenID. We receive your public Steam ID and display name. See Valve's privacy policy at <a href="https://store.steampowered.com/privacy_agreement/" target="_blank" rel="noopener noreferrer">store.steampowered.com/privacy_agreement</a>.</p>
          </article>
          <article className="preview-tile">
            <h3>CSFloat, DMarket, Skinport</h3>
            <p>Market data sources for skin listings and pricing. We fetch public marketplace data from these services. Your TradeUpBot account is not linked to accounts on these platforms.</p>
          </article>
        </div>

        <h2>Data Retention</h2>
        <p>Your account data (Steam ID, display name, subscription status) is retained for as long as your account is active. If you cancel your subscription, your account data remains available should you choose to resubscribe.</p>
        <p>You may request deletion of all your account data at any time by contacting us via Discord. Upon request, we will delete your account information within 30 days.</p>

        <h2>Data Security</h2>
        <p>We implement reasonable security measures to protect your data, including encrypted connections (HTTPS), secure session management, and limited data retention. However, no method of electronic transmission or storage is 100% secure.</p>

        <h2>Changes to This Policy</h2>
        <p>We may update this privacy policy from time to time. Changes will be reflected by updating the "Last updated" date at the top of this page. Continued use of the service constitutes acceptance of the updated policy.</p>

        <h2>Contact</h2>
        <p>For privacy-related inquiries, data deletion requests, or questions about how your information is handled, please reach out via Discord or through the platform's support channels.</p>
      </article>
      <div className="preview-toolbar">
        <Link className="preview-btn" to="/terms">Terms of Service</Link>
        <Link className="preview-btn" to="/features">Features</Link>
      </div>
    </div>
  );
}
