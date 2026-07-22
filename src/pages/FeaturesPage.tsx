import { SiteNav } from "../components/SiteNav.js";
import { SiteFooter } from "../components/SiteFooter.js";
import { authHref } from "../lib/ref.js";
import { trackEvent } from "../lib/analytics.js";

export function FeaturesPage() {
  return (
    <div className="min-h-screen bg-background text-foreground font-sans antialiased">
      <title>Features — TradeUpBot CS2 Trade-Up Analyzer</title>
      <meta name="description" content="Real marketplace listings, multi-market pricing, float calculations, profit analysis, and more. See how TradeUpBot finds profitable CS2 trade-up contracts." />
      <link rel="canonical" href="https://tradeupbot.app/features" />
      <meta property="og:title" content="Features — TradeUpBot CS2 Trade-Up Analyzer" />
      <meta property="og:description" content="Real marketplace listings, multi-market pricing, float calculations, profit analysis, and more." />
      <meta property="og:url" content="https://tradeupbot.app/features" />
      <meta property="og:type" content="website" />
      <SiteNav />

      <main className="pt-24 pb-16">
        <div className="mx-auto max-w-4xl px-6">
          <h1 className="text-3xl sm:text-4xl font-bold mb-2">Features</h1>
          <p className="text-muted-foreground mb-12 max-w-2xl">
            How TradeUpBot finds, prices, and verifies profitable CS2 trade-up contracts.
          </p>

          {/* Feature sections */}
          <div className="space-y-16">

            {/* Real marketplace listings */}
            <section>
              <h2 className="text-xl font-bold mb-3">Real marketplace listings</h2>
              <p className="text-sm text-muted-foreground leading-relaxed mb-4">
                Every trade-up is built from skins currently listed on CSFloat, DMarket, Skinport, and Buff.market.
                Each input links to a specific listing with its actual float and price, so the cost
                you see is the cost you pay.
              </p>
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="border border-border rounded-lg p-4">
                  <div className="text-sm font-semibold mb-1">CSFloat</div>
                  <p className="text-xs text-muted-foreground">Primary source for Covert skins and sale-based output pricing. Sale history gives the most reliable price signal.</p>
                </div>
                <div className="border border-border rounded-lg p-4">
                  <div className="text-sm font-semibold mb-1">DMarket</div>
                  <p className="text-xs text-muted-foreground">Broad coverage across all rarity tiers at 2 requests/second continuous fetching. Fills gaps in CSFloat coverage.</p>
                </div>
                <div className="border border-border rounded-lg p-4">
                  <div className="text-sm font-semibold mb-1">Skinport</div>
                  <p className="text-xs text-muted-foreground">Passive WebSocket feed with no rate limits. Provides additional price data and listing availability.</p>
                </div>
                <div className="border border-border rounded-lg p-4">
                  <div className="text-sm font-semibold mb-1">Buff.market</div>
                  <p className="text-xs text-muted-foreground">Buy-now listings fetched continuously in a separate process. Extends input coverage beyond the other three.</p>
                </div>
              </div>
            </section>

            {/* Outcome analysis */}
            <section>
              <h2 className="text-xl font-bold mb-3">Outcome analysis with probability charts</h2>
              <p className="text-sm text-muted-foreground leading-relaxed mb-4">
                Expand any trade-up to see every possible output skin, its probability, its estimated
                value, and its profit or loss. The distribution chart shows which outcomes are likely
                and how deep the downside runs.
              </p>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Each outcome's value accounts for the exact output float your inputs would produce,
                the resulting wear condition, and marketplace seller fees.
              </p>
            </section>

            {/* Float-targeted discovery */}
            <section>
              <h2 className="text-xl font-bold mb-3">Float-targeted discovery across 45+ targets</h2>
              <p className="text-sm text-muted-foreground leading-relaxed mb-4">
                Each input combination is evaluated at 45+ float targets, clustered around condition
                boundaries (Factory New/Minimal Wear at 0.07, Minimal Wear/Field-Tested at 0.15, and so on).
              </p>
              <p className="text-sm text-muted-foreground leading-relaxed">
                That locates the crossing point where an output flips to a better condition, which
                single-target calculators miss. Swap optimization retests replacement inputs on
                existing trade-ups each cycle.
              </p>
            </section>

            {/* Verify system */}
            <section>
              <h2 className="text-xl font-bold mb-3">Verify system</h2>
              <p className="text-sm text-muted-foreground leading-relaxed mb-4">
                Before spending money, hit Verify. It calls each marketplace's API to confirm every
                input listing still exists and at what price. The trade-up's cost, profit, and ROI
                update from the response.
              </p>
              <div className="flex gap-6 text-sm">
                <div>
                  <span className="text-foreground font-medium">Pro tier:</span>
                  <span className="text-muted-foreground ml-2">20 verifications/hour</span>
                </div>
              </div>
            </section>

            {/* Claim system */}
            <section>
              <h2 className="text-xl font-bold mb-3">Claim system</h2>
              <p className="text-sm text-muted-foreground leading-relaxed mb-4">
                Pro users can claim a trade-up to hide its listings from all other TradeUpBot users
                for 30 minutes. Anyone shopping the marketplace directly can still buy the inputs —
                a claim removes your TradeUpBot competition, not the listings themselves.
              </p>
              <div className="flex gap-6 text-sm flex-wrap">
                <div>
                  <span className="text-foreground font-medium">Pro rate:</span>
                  <span className="text-muted-foreground ml-2">10 claims/hour</span>
                </div>
                <div>
                  <span className="text-foreground font-medium">Active claims:</span>
                  <span className="text-muted-foreground ml-2">Up to 5 simultaneously</span>
                </div>
                <div>
                  <span className="text-foreground font-medium">Duration:</span>
                  <span className="text-muted-foreground ml-2">30 minutes, auto-expires</span>
                </div>
              </div>
            </section>

            {/* All rarity tiers */}
            <section>
              <h2 className="text-xl font-bold mb-3">All rarity tiers covered</h2>
              <p className="text-sm text-muted-foreground leading-relaxed mb-4">
                TradeUpBot discovers trade-ups in every CS2 rarity tier, from Consumer inputs
                costing cents to Knife and Glove contracts.
              </p>
              <div className="space-y-2">
                {[
                  { name: "Knife / Gloves", cls: "border-yellow-500/30 text-yellow-500", desc: "5 Covert inputs produce 1 Knife or Glove from the matching case collection pool" },
                  { name: "Covert", cls: "border-red-500/30 text-red-500", desc: "10 Classified inputs produce 1 Covert gun skin" },
                  { name: "Classified", cls: "border-pink-500/30 text-pink-500", desc: "10 Restricted inputs produce 1 Classified gun skin" },
                  { name: "Restricted", cls: "border-purple-500/30 text-purple-500", desc: "10 Mil-Spec inputs produce 1 Restricted gun skin" },
                  { name: "Mil-Spec", cls: "border-blue-500/30 text-blue-500", desc: "10 Industrial inputs produce 1 Mil-Spec gun skin" },
                  { name: "Industrial", cls: "border-sky-400/30 text-sky-400", desc: "10 Consumer inputs produce 1 Industrial gun skin" },
                ].map((t, i) => (
                  <div key={i} className={`flex items-center justify-between py-3 px-4 rounded-lg border ${t.cls}`}>
                    <span className="text-sm font-medium">{t.name}</span>
                    <span className="text-xs text-muted-foreground">{t.desc}</span>
                  </div>
                ))}
              </div>
            </section>

            {/* Price intelligence */}
            <section>
              <h2 className="text-xl font-bold mb-3">Price intelligence from 3 data sources</h2>
              <p className="text-sm text-muted-foreground leading-relaxed mb-4">
                Output pricing uses CSFloat sale history first. DMarket and Skinport listing data
                fill gaps when CSFloat has no coverage for a skin or condition. Knife and glove
                output pricing uses a KNN model trained on 120,000+ price observations for
                float-precise estimates.
              </p>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Input pricing uses actual listing prices with marketplace-specific buyer fees applied:
                CSFloat (2.8% + $0.30), DMarket (2.5%), Skinport (0%). Seller fees are deducted from
                output estimates: CSFloat (2%), DMarket (2%), Skinport (8%). All values in the table
                reflect these real-world costs.
              </p>
            </section>

            {/* Collection browser */}
            <section>
              <h2 className="text-xl font-bold mb-3">Collection browser with knife/glove pool info</h2>
              <p className="text-sm text-muted-foreground leading-relaxed mb-4">
                Browse every CS2 collection: which knife and glove finishes are in its pool, how many
                listings exist per rarity tier, and which collections currently have profitable
                trade-ups. Filter by knives, gloves, or profitability.
              </p>
            </section>

            {/* Continuously updated */}
            <section>
              <h2 className="text-xl font-bold mb-3">Continuously updated</h2>
              <p className="text-sm text-muted-foreground leading-relaxed mb-4">
                The discovery engine runs in roughly 20-minute cycles, scanning new listings and
                recalculating trade-ups. DMarket is fetched continuously at 2 requests per second in
                a separate process; Skinport streams in over a live WebSocket. Each cycle also runs
                swap optimization on existing trade-ups and rebuilds ones whose listings sold.
              </p>
            </section>
          </div>

          {/* CTA */}
          <div className="mt-16 pt-10 border-t border-border text-center">
            <h2 className="text-xl font-bold mb-3">Start free</h2>
            <p className="text-sm text-muted-foreground mb-6">Sign in with Steam. The free tier shows trade-up data on a 3-hour delay; contracts whose inputs sell in the meantime drop out.</p>
            <a
              href={authHref("/trade-ups")}
              onClick={() => trackEvent("sign_up_start", { location: "features_cta" })}
              rel="nofollow"
              className="inline-flex items-center gap-2 px-6 py-2.5 text-sm font-medium rounded-lg bg-foreground text-background hover:bg-foreground/90 transition-all"
            >
              Sign in with Steam
            </a>
          </div>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
