import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ManageSubscription } from "../components/ManageSubscription.js";
import { PreviewSeo } from "../components/PreviewSeo.js";
import { SteamInterstitial, useSteamInterstitial } from "../components/SteamInterstitial.js";
import { authHref } from "../../lib/ref.js";
import { trackEvent } from "../../lib/analytics.js";
import { trackPricingView } from "../../lib/conversions.js";
import { fetchPricingSession } from "../lib/auth-state.js";
import { hasProAccess } from "../lib/billing.js";
import { runCheckout } from "../lib/checkout.js";
import { PLAN_FOR, PRO_FEATURES, PRO_PRICE, type BillingInterval } from "../lib/pro-pricing.js";
import { seoPage } from "../lib/seo-pages.js";

const seo = seoPage("/pricing");

const IconCheck = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const IconX = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const login = () => {
  trackEvent("sign_up_start", { location: "pricing" });
  window.location.href = authHref(window.location.pathname);
};

const COMPARE = [
  { feature: "Trade-ups visible", free: "Unlimited", pro: "Unlimited" },
  { feature: "Data freshness", free: "3-hour delay", pro: "Real-time" },
  { feature: "Outcome details", free: true, pro: true },
  { feature: "Sort columns", free: true, pro: true },
  { feature: "Filters & search", free: true, pro: true },
  { feature: "Pagination", free: true, pro: true },
  { feature: "Direct listing links", free: true, pro: true },
  { feature: "Verify availability", free: false, pro: "20/hr" },
  { feature: "Claim system", free: false, pro: "10/hr" },
  { feature: "Active claims", free: false, pro: "Up to 5" },
  { feature: "Collection browser", free: true, pro: true },
  { feature: "Price analytics", free: true, pro: true },
] as const;

const FAQ = [
  {
    q: "Can I cancel anytime?",
    a: "Yes. You can cancel your subscription at any time with Manage subscription, here on Pricing or on My trade-ups, once you're signed in. Your access continues until the end of the current billing period. No cancellation fees.",
  },
  {
    q: "What payment methods are accepted?",
    a: "All major credit and debit cards (Visa, Mastercard, American Express) through Stripe. Card details never touch our servers.",
  },
  {
    q: "Is there a free trial for Pro?",
    a: "No separate trial. The Free tier has no time limit: full filters and listing links, with trade-up data delayed 3 hours. Upgrade when you want real-time data, verification, and claims.",
  },
  {
    q: "What do the data delays mean?",
    a: "Free users see trade-up data delayed 3 hours — contracts whose inputs sell in the meantime drop out. Pro users see everything immediately, before the best listings get bought.",
  },
  {
    q: "Do claims reserve listings on the marketplace?",
    a: "No. Claims only hide trade-up listings from other TradeUpBot users. Other buyers on CSFloat, DMarket, Skinport, or Buff.market who aren't using TradeUpBot can still purchase the listings. Claims reduce your competition, but don't guarantee availability.",
  },
  {
    q: "What happens if a claimed listing gets sold?",
    a: "If a listing in your claimed trade-up is sold by someone outside TradeUpBot, the claim remains active but the trade-up may no longer be executable. Always verify a trade-up after claiming it and before purchasing inputs.",
  },
] as const;

function Cell({ value }: { value: string | boolean }) {
  if (value === true) return <span className="preview-plan__ok"><IconCheck /></span>;
  if (value === false) return <span className="preview-plan__no"><IconX /></span>;
  return <span>{value}</span>;
}

export function PreviewPricing() {
  const [user, setUser] = useState<{ tier: string; lifetime?: boolean; steam_id?: string } | null | undefined>(undefined);
  const [billing, setBilling] = useState<BillingInterval>("monthly");
  const [checkoutError, setCheckoutError] = useState<{ message: string; manage: boolean } | null>(null);
  const interstitial = useSteamInterstitial();

  useEffect(() => { trackPricingView(); }, []);

  useEffect(() => {
    let cancelled = false;
    void fetchPricingSession().then((session) => {
      if (!cancelled) setUser(session);
    });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="preview-market">
      <PreviewSeo title={seo.title} description={seo.description} canonical="https://tradeupbot.app/pricing" jsonLd={seo.jsonLd} />
      <header className="preview-page__head">
        <div>
          <h1>TradeUpBot Pricing</h1>
          <p>Start free. Upgrade when the 3-hour delay costs you trade-ups.</p>
        </div>
      </header>

      <div className="preview-tabs" role="tablist" aria-label="Billing interval">
        {(["monthly", "yearly", "lifetime"] as BillingInterval[]).map((interval) => (
          <button
            key={interval}
            type="button"
            role="tab"
            className="o-tab"
            aria-selected={billing === interval}
            data-state={billing === interval ? "active" : "inactive"}
            onClick={() => { setBilling(interval); setCheckoutError(null); }}
          >
            {interval === "yearly" ? "Yearly · save 28%" : interval === "lifetime" ? "Lifetime · best value" : "Monthly"}
          </button>
        ))}
      </div>

      <div className="preview-plans">
        <section className="preview-panel preview-plan">
          <p className="o-kicker">Free</p>
          <p className="preview-plan__price">$0</p>
          <p className="preview-note">Full access to all trade-ups with filters, sorting, and listing links. 3-hour data delay.</p>
          <ul className="preview-plan__list">
            <li><IconCheck /> Unlimited trade-ups</li>
            <li><IconCheck /> Full filters, search, sorting</li>
            <li><IconCheck /> Direct listing links</li>
            <li><IconCheck /> Full outcome details and chart</li>
            <li><IconCheck /> 3-hour data delay</li>
            <li><IconCheck /> Collection browser</li>
            <li><IconCheck /> Price analytics</li>
            <li className="is-off"><IconX /> No verification</li>
            <li className="is-off"><IconX /> No claims</li>
          </ul>
          <button type="button" className="preview-btn preview-btn--block" onClick={login}>Get started</button>
        </section>

        <section className="preview-panel preview-plan preview-plan--pro">
          <p className="o-kicker">Pro</p>
          {billing === "monthly" && <p className="preview-plan__price">{PRO_PRICE.monthly.amount}<span>{PRO_PRICE.monthly.unit}</span></p>}
          {billing === "yearly" && (
            <p className="preview-plan__price">{PRO_PRICE.yearly.amount}<span>{PRO_PRICE.yearly.unit}</span><em>{PRO_PRICE.yearly.note}</em></p>
          )}
          {billing === "lifetime" && <p className="preview-plan__price">{PRO_PRICE.lifetime.amount}<span>{PRO_PRICE.lifetime.unit}</span></p>}
          <p className="preview-note">Real-time data, claim system, and full analytics.</p>
          <ul className="preview-plan__list">
            <li><IconCheck /> Everything in Free</li>
            {PRO_FEATURES.map((feature) => (
              <li key={feature}><IconCheck /> {feature}</li>
            ))}
          </ul>
          <button
            type="button"
            className="preview-btn preview-btn--lime preview-btn--block"
            disabled={user === undefined || hasProAccess(user)}
            onClick={(event) => {
              if (user === undefined || hasProAccess(user)) return;
              if (user) {
                void runCheckout(PLAN_FOR[billing]).then((result) => {
                  if (!result.ok) setCheckoutError({ message: result.error || "Checkout failed", manage: result.status === 409 });
                });
              } else interstitial.open({ surface: "pricing_go_pro", billing }, event.currentTarget);
            }}
          >
            {user === undefined ? "Checking…" : hasProAccess(user) ? "Current plan" : "Go Pro"}
          </button>
          {checkoutError && (
            <p className="preview-note preview-note--loss" role="alert">
              {checkoutError.message}
              {checkoutError.manage && <> <ManageSubscription className="preview-link" /></>}
            </p>
          )}
          {hasProAccess(user) && (
            <ManageSubscription className="preview-btn preview-btn--block" />
          )}
        </section>
      </div>

      <section className="preview-panel">
        <header className="preview-panel__head">
          <p className="o-kicker">Compare</p>
        </header>
        <div className="preview-tablewrap">
          <table className="o-table preview-table">
            <thead>
              <tr>
                <th>Feature</th>
                <th>Free</th>
                <th>Pro</th>
              </tr>
            </thead>
            <tbody>
              {COMPARE.map((row) => (
                <tr key={row.feature}>
                  <td>{row.feature}</td>
                  <td><Cell value={row.free} /></td>
                  <td><Cell value={row.pro} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="preview-faq">
        <p className="o-kicker">Pricing FAQ</p>
        {FAQ.map((item) => (
          <details key={item.q}>
            <summary>{item.q}</summary>
            <p>{item.a}</p>
          </details>
        ))}
      </section>

      <section className="preview-shots">
        <p className="o-kicker">See it in action</p>
        <h2>Product screenshots from the TradeUpBot dashboard.</h2>
        <figure className="preview-shot">
          <img src="/tradeuptable.jpg" alt="Trade-up table" width="1200" height="356" loading="lazy" />
          <figcaption>Trade-up table with expected profit, EV, share of outcomes above cost, and direct listing links</figcaption>
        </figure>
        <figure className="preview-shot">
          <picture>
            <source type="image/webp" srcSet="/expanded-375w.webp 375w, /expanded-768w.webp 768w, /expanded-1280w.webp 1280w" sizes="(max-width: 1024px) 100vw, 1024px" />
            <img src="/expanded-1280w.jpg" srcSet="/expanded-375w.jpg 375w, /expanded-768w.jpg 768w, /expanded-1280w.jpg 1280w" sizes="(max-width: 1024px) 100vw, 1024px" alt="Expanded trade-up with outcomes" width="2596" height="1822" loading="lazy" />
          </picture>
          <figcaption>Expanded trade-up showing every possible outcome with probabilities and values</figcaption>
        </figure>
        <figure className="preview-shot">
          <picture>
            <source type="image/webp" srcSet="/dataviewer-375w.webp 375w, /dataviewer-768w.webp 768w, /dataviewer-1280w.webp 1280w" sizes="(max-width: 1024px) 100vw, 1024px" />
            <img src="/dataviewer-1280w.jpg" srcSet="/dataviewer-375w.jpg 375w, /dataviewer-768w.jpg 768w, /dataviewer-1280w.jpg 1280w" sizes="(max-width: 1024px) 100vw, 1024px" alt="Price data viewer" width="2434" height="1498" loading="lazy" />
          </picture>
          <figcaption>Price data viewer with float vs price scatter chart across all marketplaces</figcaption>
        </figure>
        <figure className="preview-shot">
          <picture>
            <source type="image/webp" srcSet="/collections-375w.webp 375w, /collections-768w.webp 768w, /collections-1280w.webp 1280w" sizes="(max-width: 1024px) 100vw, 1024px" />
            <img src="/collections-1280w.jpg" srcSet="/collections-375w.jpg 375w, /collections-768w.jpg 768w, /collections-1280w.jpg 1280w" sizes="(max-width: 1024px) 100vw, 1024px" alt="Collection browser" width="2624" height="1608" loading="lazy" />
          </picture>
          <figcaption>Collection browser with knife/glove pool info, listing counts, and expected-profit filters</figcaption>
        </figure>
      </section>

      <div className="preview-toolbar">
        <Link className="preview-btn preview-btn--lime" to="/trade-ups">Find Real Tradeups -&gt;</Link>
        <Link className="preview-btn" to="/features">Compare features</Link>
      </div>

      <SteamInterstitial {...interstitial.dialog} />
    </div>
  );
}
