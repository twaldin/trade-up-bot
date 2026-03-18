import { Link } from "react-router-dom";
import { SiteFooter } from "../components/SiteFooter.js";

export function FeaturesPage() {
  return (
    <div className="min-h-screen bg-background text-foreground font-sans antialiased">
      {/* Nav */}
      <nav className="fixed top-0 z-50 w-full border-b border-border bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
          <Link to="/" className="font-bold tracking-tight hover:opacity-80 transition-opacity">
            TradeUpBot
          </Link>
          <div className="flex items-center gap-6 text-sm text-muted-foreground">
            <Link to="/pricing" className="hover:text-foreground transition-colors">Pricing</Link>
            <Link to="/blog" className="hover:text-foreground transition-colors">Blog</Link>
            <Link to="/faq" className="hover:text-foreground transition-colors">FAQ</Link>
          </div>
        </div>
      </nav>

      <main className="pt-24 pb-16">
        <div className="mx-auto max-w-4xl px-6">
          <h1 className="text-3xl sm:text-4xl font-bold mb-2">Features</h1>
          <p className="text-muted-foreground mb-12 max-w-2xl">
            Everything TradeUpBot does to find, analyze, and help you execute profitable CS2 trade-up contracts.
          </p>

          {/* Feature sections */}
          <div className="space-y-16">

            {/* Real marketplace listings */}
            <section>
              <h2 className="text-xl font-bold mb-3">Real marketplace listings</h2>
              <p className="text-sm text-muted-foreground leading-relaxed mb-4">
                Every trade-up on TradeUpBot is built from actual, currently-listed skins on three marketplaces:
                CSFloat, DMarket, and Skinport. No theoretical calculations, no idealized floats, no
                average prices. Each input links to a specific listing you can purchase right now.
              </p>
              <div className="grid sm:grid-cols-3 gap-4">
                <div className="border border-border rounded-lg p-4">
                  <div className="text-sm font-semibold mb-1">CSFloat</div>
                  <p className="text-xs text-muted-foreground">Primary source for Covert skins and sale-based output pricing. Highest-confidence price data in the ecosystem.</p>
                </div>
                <div className="border border-border rounded-lg p-4">
                  <div className="text-sm font-semibold mb-1">DMarket</div>
                  <p className="text-xs text-muted-foreground">Broad coverage across all rarity tiers at 2 requests/second continuous fetching. Fills gaps in CSFloat coverage.</p>
                </div>
                <div className="border border-border rounded-lg p-4">
                  <div className="text-sm font-semibold mb-1">Skinport</div>
                  <p className="text-xs text-muted-foreground">Passive WebSocket feed with no rate limits. Provides additional price data and listing availability.</p>
                </div>
              </div>
            </section>

            {/* Outcome analysis */}
            <section>
              <h2 className="text-xl font-bold mb-3">Outcome analysis with probability charts</h2>
              <p className="text-sm text-muted-foreground leading-relaxed mb-4">
                Expand any trade-up to see every possible output skin, its probability, estimated value,
                and whether it produces a profit or loss. The outcome distribution chart shows the full
                picture at a glance — which outcomes are likely, which are valuable, and what your
                downside looks like.
              </p>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Each outcome's value accounts for the output skin's float range, the exact output float
                your inputs would produce, the resulting condition, and marketplace seller fees. No
                surprises when you get your result.
              </p>
            </section>

            {/* Float-targeted discovery */}
            <section>
              <h2 className="text-xl font-bold mb-3">Float-targeted discovery across 45+ targets</h2>
              <p className="text-sm text-muted-foreground leading-relaxed mb-4">
                The discovery engine doesn't just test one float value and hope for the best. It evaluates
                each input combination across 45+ float targets, densely clustered around condition boundaries
                (Factory New/Minimal Wear at 0.07, Minimal Wear/Field-Tested at 0.15, etc.).
              </p>
              <p className="text-sm text-muted-foreground leading-relaxed">
                This finds the exact crossing point where an output flips from one condition to another —
                identifying opportunities that manual calculations and single-target tools miss entirely.
                Swap optimization further improves existing trade-ups by testing replacement inputs each cycle.
              </p>
            </section>

            {/* Verify system */}
            <section>
              <h2 className="text-xl font-bold mb-3">Verify system</h2>
              <p className="text-sm text-muted-foreground leading-relaxed mb-4">
                Before committing money, hit Verify to check every input listing in real time. Verify calls
                each marketplace's API to confirm that listings still exist and at what price. The trade-up's
                profit, cost, and EV update instantly based on current data.
              </p>
              <div className="flex gap-6 text-sm">
                <div>
                  <span className="text-foreground font-medium">Basic tier:</span>
                  <span className="text-muted-foreground ml-2">10 verifications/hour</span>
                </div>
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
                Pro users can claim a trade-up to hide its listings from all other TradeUpBot users for
                30 minutes. This gives you an uncontested window to purchase each input without worrying
                about another user buying them first.
              </p>
              <div className="flex gap-6 text-sm">
                <div>
                  <span className="text-foreground font-medium">Rate limit:</span>
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
                TradeUpBot discovers profitable trade-ups across every rarity tier in CS2, from
                cheap Mil-Spec inputs to high-value Knife and Glove contracts.
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
                Output pricing is CSFloat-primary — sale history from CSFloat is the highest-confidence
                price data available. DMarket and Skinport listing data fill gaps when CSFloat has
                no coverage for a particular skin or condition. Knife and glove output pricing uses a
                KNN model trained on 120,000+ price observations for float-precise estimates.
              </p>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Input pricing uses actual listing prices with marketplace-specific buyer fees applied:
                CSFloat (2.8% + $0.30), DMarket (2.5%), Skinport (0%). Seller fees are deducted from
                output estimates: CSFloat (2%), DMarket (2%), Skinport (12%). All values in the table
                reflect these real-world costs.
              </p>
            </section>

            {/* Collection browser */}
            <section>
              <h2 className="text-xl font-bold mb-3">Collection browser with knife/glove pool info</h2>
              <p className="text-sm text-muted-foreground leading-relaxed mb-4">
                Browse every CS2 collection with detailed information: which knife and glove finishes
                are in each collection's pool, how many listings exist per rarity tier, and which
                collections currently have profitable trade-ups. Filter by knife collections, glove
                collections, or profitability to narrow your focus.
              </p>
            </section>

            {/* Continuously updated */}
            <section>
              <h2 className="text-xl font-bold mb-3">Continuously updated</h2>
              <p className="text-sm text-muted-foreground leading-relaxed mb-4">
                The discovery engine runs in approximately 20-minute cycles, scanning for new listings
                and recalculating trade-ups each cycle. DMarket data is fetched continuously at 2
                requests per second in a separate process. Skinport data streams in via a live WebSocket
                connection. Between fresh discovery, swap optimization, and revival of stale trade-ups,
                the data is always moving toward the current market state.
              </p>
            </section>
          </div>

          {/* CTA */}
          <div className="mt-16 pt-10 border-t border-border text-center">
            <h2 className="text-xl font-bold mb-3">Ready to find profitable trade-ups?</h2>
            <p className="text-sm text-muted-foreground mb-6">Sign in with Steam to get started. Free tier available.</p>
            <a
              href="/auth/steam"
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
