import { Helmet } from "react-helmet-async";
import { SiteNav } from "../components/SiteNav.js";
import { SiteFooter } from "../components/SiteFooter.js";

export function TermsPage() {
  return (
    <div className="min-h-screen bg-background text-foreground font-sans antialiased">
      <Helmet>
        <title>Terms of Service — TradeUpBot</title>
        <meta name="description" content="Terms of service for TradeUpBot, the CS2 trade-up contract analysis platform." />
        <link rel="canonical" href="https://tradeupbot.app/terms" />
      </Helmet>
      <SiteNav />

      <main className="pt-24 pb-16">
        <div className="mx-auto max-w-3xl px-6">
          <h1 className="text-3xl sm:text-4xl font-bold mb-2">Terms of Service</h1>
          <p className="text-muted-foreground mb-10">Last updated: March 2026</p>

          <div className="space-y-8 text-sm text-muted-foreground leading-relaxed">
            <section>
              <h2 className="text-lg font-semibold text-foreground mb-3">1. Service Description</h2>
              <p>
                TradeUpBot is a trade-up contract analysis tool for Counter-Strike 2. The platform
                identifies potentially profitable trade-up contracts by analyzing real marketplace
                listings across CSFloat, DMarket, and Skinport.
              </p>
              <p className="mt-2">
                TradeUpBot is an informational tool only. It does not execute trades, hold
                inventory, or manage funds on your behalf. All purchasing decisions and
                transactions are made by you directly on third-party marketplaces.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-foreground mb-3">2. Disclaimer</h2>
              <div className="border border-yellow-500/30 bg-yellow-500/5 rounded-lg p-4">
                <p className="font-medium text-yellow-500 mb-2">Important Notice</p>
                <p>
                  All prices displayed on TradeUpBot are <strong className="text-foreground">estimates</strong> based
                  on marketplace data including sale history, current listings, and algorithmic
                  extrapolation. These prices may not reflect the actual price you will pay or
                  receive when transacting on any marketplace.
                </p>
                <p className="mt-2">
                  TradeUpBot is <strong className="text-foreground">not responsible for any financial losses</strong> incurred
                  from trade-up contracts informed by our analysis. Past performance and displayed
                  profitability metrics do not guarantee future results.
                </p>
                <p className="mt-2">
                  This service does not constitute financial, investment, or trading advice.
                  Use TradeUpBot at your own risk.
                </p>
              </div>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-foreground mb-3">3. Trade Lock Warning</h2>
              <p>
                Items purchased from third-party marketplaces (CSFloat, DMarket, Skinport) are
                subject to trade lock periods imposed by Valve/Steam. During these lock periods,
                items cannot be used in trade-up contracts. Market prices may change significantly
                during the lock period, affecting the profitability of any planned trade-up.
              </p>
              <p className="mt-2">
                You are solely responsible for understanding and accounting for trade lock
                periods when planning trade-ups.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-foreground mb-3">4. No Guarantee of Profit</h2>
              <p>
                Trade-ups labeled as "profitable" on TradeUpBot are based on current estimated
                prices, which are subject to change at any time. Factors that may cause actual
                results to differ include:
              </p>
              <ul className="list-disc list-inside ml-2 mt-2 space-y-1">
                <li>Price fluctuations between viewing and purchasing inputs</li>
                <li>Price changes during trade lock periods</li>
                <li>Listings being sold or delisted before you can purchase them</li>
                <li>Differences between estimated and actual marketplace fees</li>
                <li>Receiving lower-value outcomes on probabilistic trade-ups</li>
                <li>Marketplace-specific pricing variations</li>
              </ul>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-foreground mb-3">5. Payment Terms</h2>
              <p>
                TradeUpBot offers free and paid subscription tiers. Paid subscriptions are billed
                monthly through Stripe. By subscribing, you agree to recurring monthly charges
                until you cancel.
              </p>
              <p className="mt-2">
                You may cancel your subscription at any time through the account menu or by
                contacting support. Cancellation takes effect at the end of the current billing
                period. No refunds are provided for partial billing periods.
              </p>
              <p className="mt-2">
                Subscription prices are subject to change with 30 days notice.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-foreground mb-3">6. Steam Authentication</h2>
              <p>
                TradeUpBot uses Steam OpenID for authentication. When you sign in, we receive
                and store your Steam ID and public display name. We do not receive, store, or
                have access to your Steam password, inventory, or wallet.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-foreground mb-3">7. Account Termination</h2>
              <p>
                We reserve the right to suspend or terminate accounts that:
              </p>
              <ul className="list-disc list-inside ml-2 mt-2 space-y-1">
                <li>Abuse rate limits or attempt to circumvent access controls</li>
                <li>Use automated tools to scrape or extract data from the platform</li>
                <li>Engage in activity that disrupts the service for other users</li>
                <li>Violate these Terms of Service</li>
              </ul>
              <p className="mt-2">
                You may delete your account and associated data at any time by contacting us.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-foreground mb-3">8. Limitation of Liability</h2>
              <p>
                To the maximum extent permitted by applicable law, TradeUpBot and its operators
                shall not be liable for any indirect, incidental, special, consequential, or
                punitive damages, including but not limited to loss of profits, data, or
                goodwill, arising from:
              </p>
              <ul className="list-disc list-inside ml-2 mt-2 space-y-1">
                <li>Your use of or inability to use the service</li>
                <li>Any trade-up contracts executed based on information from the service</li>
                <li>Inaccurate, incomplete, or outdated pricing data</li>
                <li>Third-party marketplace outages, changes, or fee modifications</li>
                <li>Unauthorized access to your account</li>
              </ul>
              <p className="mt-2">
                The total liability of TradeUpBot for any claim arising from use of the service
                shall not exceed the amount you paid for the service in the 12 months preceding
                the claim.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-foreground mb-3">9. Age Requirement</h2>
              <p>
                You must be at least 13 years of age to use TradeUpBot, consistent with Steam's
                minimum age requirement. If you are under 18, you should review these terms with
                a parent or guardian.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-foreground mb-3">10. Changes to Terms</h2>
              <p>
                We may update these Terms of Service from time to time. Continued use of the
                service after changes constitutes acceptance of the revised terms. Material
                changes will be communicated through the platform.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-foreground mb-3">11. Contact</h2>
              <p>
                For questions about these terms, contact us via Discord or through the
                platform's support channels.
              </p>
            </section>
          </div>
        </div>
      </main>

      {/* Footer */}
      <SiteFooter />
    </div>
  );
}
