import { useState, useEffect } from "react";
import { Helmet } from "react-helmet-async";
import { SiteNav } from "../components/SiteNav.js";
import { SiteFooter } from "../components/SiteFooter.js";

const IconCheck = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const IconX = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-30">
    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

function PricingFaqItem({ question, children }: { question: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border border-border rounded-lg">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-5 py-4 text-left cursor-pointer hover:bg-muted/50 transition-colors rounded-lg"
      >
        <span className="text-sm font-medium text-foreground pr-4">{question}</span>
        <span className="text-muted-foreground shrink-0 text-lg leading-none">
          {open ? "\u2212" : "+"}
        </span>
      </button>
      {open && (
        <div className="px-5 pb-4 text-sm text-muted-foreground leading-relaxed space-y-2">
          {children}
        </div>
      )}
    </div>
  );
}

const login = () => { window.location.href = `/auth/steam?return=${encodeURIComponent(window.location.pathname)}`; };

const subscribe = async (plan: string) => {
  const res = await fetch("/api/subscribe", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ plan }) });
  const data = await res.json();
  if (data.url) window.location.href = data.url;
};

const Btn = ({ children, variant = 'primary', className = '', onClick }: {
  children: React.ReactNode; variant?: 'primary' | 'outline'; className?: string; onClick?: () => void;
}) => {
  const styles = {
    primary: "bg-foreground text-background hover:bg-foreground/90",
    outline: "border border-border text-muted-foreground hover:text-foreground hover:border-foreground/30",
  };
  return (
    <button onClick={onClick} className={`inline-flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-medium rounded-lg transition-all cursor-pointer ${styles[variant]} ${className}`}>
      {children}
    </button>
  );
};

type BillingInterval = "monthly" | "yearly" | "lifetime";

export function PricingPage() {
  const [user, setUser] = useState<{ tier: string; lifetime?: boolean } | null>(null);
  const [billing, setBilling] = useState<BillingInterval>("monthly");
  useEffect(() => {
    fetch("/api/auth/me", { credentials: "include" }).then(r => r.ok ? r.json() : null).then(setUser).catch(() => {});
  }, []);

  const planForInterval: Record<BillingInterval, string> = {
    monthly: "pro",
    yearly: "pro-yearly",
    lifetime: "pro-lifetime",
  };

  return (
    <div className="min-h-screen bg-background text-foreground font-sans antialiased">
      <Helmet>
        <title>Pricing — TradeUpBot CS2 Trade-Up Plans</title>
        <meta name="description" content="Free and Pro plans for TradeUpBot. Start finding profitable CS2 trade-ups for free, upgrade for real-time data and full marketplace access." />
        <link rel="canonical" href="https://tradeupbot.app/pricing" />
        <meta property="og:title" content="Pricing — TradeUpBot CS2 Trade-Up Plans" />
        <meta property="og:description" content="Free and Pro plans. Start finding profitable CS2 trade-ups for free." />
        <meta property="og:url" content="https://tradeupbot.app/pricing" />
        <meta property="og:type" content="website" />
      </Helmet>
      <SiteNav />

      <main className="pt-24 pb-16">
        <div className="mx-auto max-w-4xl px-6">
          <h1 className="text-3xl sm:text-4xl font-bold mb-2 text-center">Pricing</h1>
          <p className="text-muted-foreground mb-12 text-center">
            Start free. Upgrade when you're ready to act on opportunities.
          </p>

          {/* Billing interval toggle */}
          <div className="flex justify-center mb-8">
            <div className="inline-flex items-center gap-1 bg-muted/50 border border-border rounded-lg p-1 text-sm">
              {(["monthly", "yearly", "lifetime"] as BillingInterval[]).map((interval) => (
                <button
                  key={interval}
                  onClick={() => setBilling(interval)}
                  className={`relative px-4 py-1.5 rounded-md font-medium transition-all cursor-pointer capitalize ${
                    billing === interval
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {interval === "yearly" && (
                    <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 text-[10px] font-semibold text-green-500 bg-green-500/10 px-1.5 py-0.5 rounded-full whitespace-nowrap">
                      Save 28%
                    </span>
                  )}
                  {interval === "lifetime" && (
                    <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 text-[10px] font-semibold text-amber-500 bg-amber-500/10 px-1.5 py-0.5 rounded-full whitespace-nowrap">
                      Best value
                    </span>
                  )}
                  {interval.charAt(0).toUpperCase() + interval.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {/* Tier cards */}
          <div className="grid md:grid-cols-2 gap-6 mb-16">
            {/* Free */}
            <div className="rounded-xl border border-border p-6 flex flex-col">
              <div className="mb-6">
                <div className="text-sm text-muted-foreground mb-1">Free</div>
                <div className="text-3xl font-bold">$0</div>
                <p className="text-xs text-muted-foreground mt-2">Full access to all trade-ups with filters, sorting, and listing links. 3-hour data delay.</p>
              </div>
              <ul className="space-y-2.5 mb-6 flex-1 text-sm">
                <li className="flex items-center gap-2 text-muted-foreground"><IconCheck /> Unlimited trade-ups</li>
                <li className="flex items-center gap-2 text-muted-foreground"><IconCheck /> Full filters, search, sorting</li>
                <li className="flex items-center gap-2 text-muted-foreground"><IconCheck /> Direct listing links</li>
                <li className="flex items-center gap-2 text-muted-foreground"><IconCheck /> Full outcome details and chart</li>
                <li className="flex items-center gap-2 text-muted-foreground"><IconCheck /> 3-hour data delay</li>
                <li className="flex items-center gap-2 text-muted-foreground"><IconCheck /> Collection browser</li>
                <li className="flex items-center gap-2 text-muted-foreground"><IconCheck /> Price analytics</li>
                <li className="flex items-center gap-2 text-muted-foreground/40"><IconX /> No verification</li>
                <li className="flex items-center gap-2 text-muted-foreground/40"><IconX /> No claims</li>
              </ul>
              <Btn variant="outline" onClick={login} className="w-full">Get started</Btn>
            </div>

            {/* Pro */}
            <div className="rounded-xl border border-foreground/20 p-6 flex flex-col bg-foreground/[0.03]">
              <div className="mb-6">
                <div className="text-sm text-green-500 mb-1">Pro</div>
                {billing === "monthly" && (
                  <div className="text-3xl font-bold">$6.99<span className="text-sm text-muted-foreground font-normal">/mo</span></div>
                )}
                {billing === "yearly" && (
                  <div className="text-3xl font-bold">$5<span className="text-sm text-muted-foreground font-normal">/mo</span>
                    <span className="ml-2 text-xs text-green-500 font-normal">billed $59.99/year</span>
                  </div>
                )}
                {billing === "lifetime" && (
                  <div className="text-3xl font-bold">$74.99<span className="text-sm text-muted-foreground font-normal"> one-time</span></div>
                )}
                <p className="text-xs text-muted-foreground mt-2">Real-time data, claim system, and full analytics. The price of one CS2 case key.</p>
              </div>
              <ul className="space-y-2.5 mb-6 flex-1 text-sm">
                <li className="flex items-center gap-2 text-muted-foreground"><IconCheck /> Everything in Free</li>
                <li className="flex items-center gap-2"><IconCheck /> Real-time data (no delay)</li>
                <li className="flex items-center gap-2"><IconCheck /> Claim system (30 min lock)</li>
                <li className="flex items-center gap-2 text-muted-foreground"><IconCheck /> Up to 5 active claims</li>
                <li className="flex items-center gap-2 text-muted-foreground"><IconCheck /> Verify availability (20/hr)</li>
                <li className="flex items-center gap-2 text-muted-foreground"><IconCheck /> Claims (10/hr)</li>
              </ul>
              <Btn onClick={() => user ? subscribe(planForInterval[billing]) : login()} className="w-full">
                {user?.tier === "pro" ? "Current plan" : "Go Pro"}
              </Btn>
            </div>
          </div>

          {/* Feature comparison table */}
          <h2 className="text-xl font-bold mb-6 text-center">Feature comparison</h2>
          <div className="border border-border rounded-xl overflow-hidden mb-16">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Feature</th>
                  <th className="text-center px-4 py-3 font-medium text-muted-foreground">Free</th>
                  <th className="text-center px-4 py-3 font-medium text-green-500">Pro</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {[
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
                ].map((row, i) => (
                  <tr key={i} className="hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-3 text-foreground">{row.feature}</td>
                    <td className="px-4 py-3 text-center">
                      {row.free === true ? <span className="inline-flex justify-center"><IconCheck /></span> :
                       row.free === false ? <span className="inline-flex justify-center"><IconX /></span> :
                       <span className="text-muted-foreground">{row.free}</span>}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {row.pro === true ? <span className="inline-flex justify-center"><IconCheck /></span> :
                       row.pro === false ? <span className="inline-flex justify-center"><IconX /></span> :
                       <span className="text-muted-foreground">{row.pro}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pricing FAQ */}
          <h2 className="text-xl font-bold mb-6 text-center">Pricing FAQ</h2>
          <div className="space-y-3 max-w-3xl mx-auto">
            <PricingFaqItem question="Can I cancel anytime?">
              <p>
                Yes. You can cancel your subscription at any time from your account menu. Your access
                continues until the end of the current billing period. No cancellation fees.
              </p>
            </PricingFaqItem>

            <PricingFaqItem question="What payment methods are accepted?">
              <p>
                We accept all major credit and debit cards (Visa, Mastercard, American Express) through
                Stripe. All payments are processed securely — we never see or store your card details.
              </p>
            </PricingFaqItem>

            <PricingFaqItem question="Is there a free trial for Pro?">
              <p>
                There's no separate trial — the Free tier itself serves as a permanent trial. You can
                use the Free tier for as long as you want to explore the platform. When you're ready
                to act on trade-ups with real-time data, upgrade to Pro.
              </p>
            </PricingFaqItem>

            <PricingFaqItem question="What do the data delays mean?">
              <p>
                Free users see trade-ups 3 hours after they're discovered. Pro users see them immediately.
                Shorter delays mean you can act on opportunities before other users see them.
              </p>
            </PricingFaqItem>

            <PricingFaqItem question="Do claims reserve listings on the marketplace?">
              <p>
                No. Claims only hide trade-up listings from other TradeUpBot users. Other buyers on
                CSFloat, DMarket, or Skinport who aren't using TradeUpBot can still purchase the listings.
                Claims reduce your competition, but don't guarantee availability.
              </p>
            </PricingFaqItem>

            <PricingFaqItem question="What happens if a claimed listing gets sold?">
              <p>
                If a listing in your claimed trade-up is sold by someone outside TradeUpBot, the claim
                remains active but the trade-up may no longer be executable. Always verify a trade-up
                after claiming it and before purchasing inputs.
              </p>
            </PricingFaqItem>
          </div>

          {/* See it in action */}
          <div className="mt-20 pt-10 border-t border-border">
            <h2 className="text-xl font-bold mb-2 text-center">See it in action</h2>
            <p className="text-muted-foreground text-center mb-10 text-sm">
              Product screenshots from the TradeUpBot dashboard.
            </p>
            <div className="space-y-8">
              <div>
                <img src="/tradeuptable.png" alt="Trade-up table" className="rounded-lg border border-border shadow-lg w-full" />
                <p className="text-xs text-muted-foreground text-center mt-3">Trade-up table with profit, EV, chance to profit, and direct listing links</p>
              </div>
              <div>
                <img src="/expanded.png" alt="Expanded trade-up with outcomes" className="rounded-lg border border-border shadow-lg w-full" />
                <p className="text-xs text-muted-foreground text-center mt-3">Expanded trade-up showing every possible outcome with probabilities and values</p>
              </div>
              <div>
                <img src="/dataviewer.png" alt="Price data viewer" className="rounded-lg border border-border shadow-lg w-full" />
                <p className="text-xs text-muted-foreground text-center mt-3">Price data viewer with float vs price scatter chart across all marketplaces</p>
              </div>
              <div>
                <img src="/collections.png" alt="Collection browser" className="rounded-lg border border-border shadow-lg w-full" />
                <p className="text-xs text-muted-foreground text-center mt-3">Collection browser with knife/glove pool info, listing counts, and profitability filters</p>
              </div>
            </div>
          </div>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
