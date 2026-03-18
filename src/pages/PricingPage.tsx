import { useState } from "react";
import { Link } from "react-router-dom";
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

const login = () => { window.location.href = '/auth/steam'; };

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

export function PricingPage() {
  return (
    <div className="min-h-screen bg-background text-foreground font-sans antialiased">
      {/* Nav */}
      <nav className="fixed top-0 z-50 w-full border-b border-border bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
          <Link to="/" className="font-bold tracking-tight hover:opacity-80 transition-opacity">
            TradeUpBot
          </Link>
          <div className="flex items-center gap-6 text-sm text-muted-foreground">
            <Link to="/features" className="hover:text-foreground transition-colors">Features</Link>
            <Link to="/blog" className="hover:text-foreground transition-colors">Blog</Link>
            <Link to="/faq" className="hover:text-foreground transition-colors">FAQ</Link>
          </div>
        </div>
      </nav>

      <main className="pt-24 pb-16">
        <div className="mx-auto max-w-4xl px-6">
          <h1 className="text-3xl sm:text-4xl font-bold mb-2 text-center">Pricing</h1>
          <p className="text-muted-foreground mb-12 text-center">
            Start free. Upgrade when you're ready to act on opportunities.
          </p>

          {/* Tier cards */}
          <div className="grid md:grid-cols-3 gap-6 mb-16">
            {/* Free */}
            <div className="rounded-xl border border-border p-6 flex flex-col">
              <div className="mb-6">
                <div className="text-sm text-muted-foreground mb-1">Free</div>
                <div className="text-3xl font-bold">$0</div>
                <p className="text-xs text-muted-foreground mt-2">Explore the platform and see how trade-ups work. No credit card required.</p>
              </div>
              <ul className="space-y-2.5 mb-6 flex-1 text-sm">
                <li className="flex items-center gap-2 text-muted-foreground"><IconCheck /> 10 sample trade-ups per tier</li>
                <li className="flex items-center gap-2 text-muted-foreground"><IconCheck /> Full outcome details and chart</li>
                <li className="flex items-center gap-2 text-muted-foreground"><IconCheck /> Sort by any column</li>
                <li className="flex items-center gap-2 text-muted-foreground"><IconCheck /> 3-hour data delay</li>
                <li className="flex items-center gap-2 text-muted-foreground/40"><IconX /> No listing links</li>
                <li className="flex items-center gap-2 text-muted-foreground/40"><IconX /> No filters or search</li>
                <li className="flex items-center gap-2 text-muted-foreground/40"><IconX /> No verification</li>
                <li className="flex items-center gap-2 text-muted-foreground/40"><IconX /> No claims</li>
              </ul>
              <Btn variant="outline" onClick={login} className="w-full">Get started</Btn>
            </div>

            {/* Basic */}
            <div className="rounded-xl border border-border p-6 flex flex-col">
              <div className="mb-6">
                <div className="text-sm mb-1">Basic</div>
                <div className="text-3xl font-bold">$5<span className="text-sm text-muted-foreground font-normal">/mo</span></div>
                <p className="text-xs text-muted-foreground mt-2">Unlimited access with a 30-minute delay on new discoveries. Full filtering and verification.</p>
              </div>
              <ul className="space-y-2.5 mb-6 flex-1 text-sm">
                <li className="flex items-center gap-2 text-muted-foreground"><IconCheck /> Unlimited trade-ups</li>
                <li className="flex items-center gap-2 text-muted-foreground"><IconCheck /> 30-min delay on new finds</li>
                <li className="flex items-center gap-2 text-muted-foreground"><IconCheck /> Filters, search, pagination</li>
                <li className="flex items-center gap-2 text-muted-foreground"><IconCheck /> Direct listing links</li>
                <li className="flex items-center gap-2 text-muted-foreground"><IconCheck /> Verify availability (10/hr)</li>
                <li className="flex items-center gap-2 text-muted-foreground"><IconCheck /> All rarity tiers</li>
                <li className="flex items-center gap-2 text-muted-foreground/40"><IconX /> No real-time data</li>
                <li className="flex items-center gap-2 text-muted-foreground/40"><IconX /> No claims</li>
              </ul>
              <Btn variant="outline" onClick={login} className="w-full">Subscribe</Btn>
            </div>

            {/* Pro */}
            <div className="rounded-xl border border-foreground/20 p-6 flex flex-col bg-foreground/[0.03]">
              <div className="mb-6">
                <div className="text-sm text-green-500 mb-1">Pro</div>
                <div className="text-3xl font-bold">$15<span className="text-sm text-muted-foreground font-normal">/mo</span></div>
                <p className="text-xs text-muted-foreground mt-2">Real-time data, claim system, and full analytics. For serious trade-up operators.</p>
              </div>
              <ul className="space-y-2.5 mb-6 flex-1 text-sm">
                <li className="flex items-center gap-2 text-muted-foreground"><IconCheck /> Everything in Basic</li>
                <li className="flex items-center gap-2"><IconCheck /> Real-time data (no delay)</li>
                <li className="flex items-center gap-2"><IconCheck /> Claim system (30 min lock)</li>
                <li className="flex items-center gap-2 text-muted-foreground"><IconCheck /> Up to 5 active claims</li>
                <li className="flex items-center gap-2 text-muted-foreground"><IconCheck /> Verify availability (20/hr)</li>
                <li className="flex items-center gap-2 text-muted-foreground"><IconCheck /> Claims (10/hr)</li>
                <li className="flex items-center gap-2 text-muted-foreground"><IconCheck /> Collection browser</li>
                <li className="flex items-center gap-2 text-muted-foreground"><IconCheck /> Price analytics</li>
              </ul>
              <Btn onClick={login} className="w-full">Go Pro</Btn>
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
                  <th className="text-center px-4 py-3 font-medium">Basic</th>
                  <th className="text-center px-4 py-3 font-medium text-green-500">Pro</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {[
                  { feature: "Trade-ups visible", free: "10 per tier", basic: "Unlimited", pro: "Unlimited" },
                  { feature: "Data freshness", free: "3-hour delay", basic: "30-min delay", pro: "Real-time" },
                  { feature: "Outcome details", free: true, basic: true, pro: true },
                  { feature: "Sort columns", free: true, basic: true, pro: true },
                  { feature: "Filters & search", free: false, basic: true, pro: true },
                  { feature: "Pagination", free: false, basic: true, pro: true },
                  { feature: "Direct listing links", free: false, basic: true, pro: true },
                  { feature: "Verify availability", free: false, basic: "10/hr", pro: "20/hr" },
                  { feature: "Claim system", free: false, basic: false, pro: "10/hr" },
                  { feature: "Active claims", free: false, basic: false, pro: "Up to 5" },
                  { feature: "Collection browser", free: false, basic: false, pro: true },
                  { feature: "Price analytics", free: false, basic: false, pro: true },
                ].map((row, i) => (
                  <tr key={i} className="hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-3 text-foreground">{row.feature}</td>
                    <td className="px-4 py-3 text-center">
                      {row.free === true ? <span className="inline-flex justify-center"><IconCheck /></span> :
                       row.free === false ? <span className="inline-flex justify-center"><IconX /></span> :
                       <span className="text-muted-foreground">{row.free}</span>}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {row.basic === true ? <span className="inline-flex justify-center"><IconCheck /></span> :
                       row.basic === false ? <span className="inline-flex justify-center"><IconX /></span> :
                       <span className="text-muted-foreground">{row.basic}</span>}
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

            <PricingFaqItem question="Can I switch between plans?">
              <p>
                Yes. You can upgrade or downgrade at any time. When upgrading, you're charged the
                prorated difference for the remainder of your billing period. When downgrading, the
                change takes effect at the start of your next billing period.
              </p>
            </PricingFaqItem>

            <PricingFaqItem question="Is there a free trial for paid plans?">
              <p>
                There's no separate trial — the Free tier itself serves as a permanent trial. You can
                use the Free tier for as long as you want to explore the platform. When you're ready
                to act on trade-ups with full data, upgrade to Basic or Pro.
              </p>
            </PricingFaqItem>

            <PricingFaqItem question="What does '30-minute delay' mean on Basic?">
              <p>
                Basic tier users see trade-ups 30 minutes after they're discovered. Pro users see them
                immediately. This means Pro users have a window to claim and act on the highest-profit
                trade-ups before Basic users see them.
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
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
