import { useState } from "react";
import { Helmet } from "react-helmet-async";
import { Link } from "react-router-dom";
import { SiteNav } from "../components/SiteNav.js";
import { SiteFooter } from "../components/SiteFooter.js";

function BlogLink({ slug, title }: { slug: string; title: string }) {
  return (
    <Link to={`/blog/${slug}`} className="inline-flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition-colors mt-2">
      Read more: {title} &rarr;
    </Link>
  );
}

function FaqItem({ question, children }: { question: string; children: React.ReactNode }) {
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

export function FaqPage() {
  return (
    <div className="min-h-screen bg-background text-foreground font-sans antialiased">
      <Helmet>
        <title>FAQ — TradeUpBot CS2 Trade-Up Questions</title>
        <meta name="description" content="Common questions about TradeUpBot, CS2 trade-up contracts, float mechanics, marketplace pricing, and how the platform works." />
        <link rel="canonical" href="https://tradeupbot.app/faq" />
        <meta property="og:title" content="FAQ — TradeUpBot CS2 Trade-Up Questions" />
        <meta property="og:description" content="Common questions about TradeUpBot and CS2 trade-up contracts." />
        <meta property="og:url" content="https://tradeupbot.app/faq" />
        <meta property="og:type" content="website" />
        <script type="application/ld+json">{JSON.stringify({
          "@context": "https://schema.org",
          "@type": "FAQPage",
          "mainEntity": [
            {
              "@type": "Question",
              "name": "What is a CS2 trade-up contract?",
              "acceptedAnswer": {
                "@type": "Answer",
                "text": "A trade-up contract is an in-game mechanic in Counter-Strike 2 where you exchange 10 weapon skins of the same rarity tier for 1 skin of the next higher rarity tier. The output skin comes from the same collection(s) as your inputs. The float value (wear) of the output is determined by a formula based on the float values of all 10 inputs. For Knife/Glove trade-ups, you exchange 5 Covert-rarity skins for 1 Knife or Glove from the matching case collections."
              }
            },
            {
              "@type": "Question",
              "name": "How does TradeUpBot find profitable trade-ups?",
              "acceptedAnswer": {
                "@type": "Answer",
                "text": "Unlike other tools that use theoretical calculations with idealized float values, TradeUpBot builds every trade-up from real, buyable listings on CSFloat, DMarket, and Skinport. Our engine continuously scans marketplace listings, tests thousands of input combinations across 45+ float targets, and evaluates the expected profit and probability of each outcome. Every trade-up you see on the platform links to actual listings you can purchase right now, with exact floats, exact prices, and deterministic outcomes."
              }
            },
            {
              "@type": "Question",
              "name": "What does \"chance to profit\" mean?",
              "acceptedAnswer": {
                "@type": "Answer",
                "text": "A trade-up contract can produce different output skins depending on which collections your inputs come from. Each possible output has a probability based on the proportion of inputs from its collection. \"Chance to profit\" is the summed probability of all outcomes where the output value exceeds the total input cost. For example, a trade-up with 70% chance to profit means that 70% of the possible outcomes (weighted by probability) would result in a net gain. TradeUpBot keeps trade-ups with over 25% chance to profit, even if the overall expected value is slightly negative."
              }
            },
            {
              "@type": "Question",
              "name": "How accurate are the prices?",
              "acceptedAnswer": {
                "@type": "Answer",
                "text": "Prices are estimates based on real marketplace data. Output prices are primarily derived from CSFloat sale history (the most reliable source), with DMarket and Skinport listing data used as gap-fill when CSFloat data is unavailable. Input prices are the actual listing prices on each marketplace, including applicable buyer fees. Prices can change between when you view a trade-up and when you purchase the listings. Always verify a trade-up before buying to check current availability and pricing."
              }
            },
            {
              "@type": "Question",
              "name": "What does \"Verify\" do?",
              "acceptedAnswer": {
                "@type": "Answer",
                "text": "Verify checks whether all the input listings for a trade-up are still available on their respective marketplaces and at what price. This gives you up-to-the-moment confirmation before you commit to buying. If a listing has been sold or delisted, verification will flag it so you know the trade-up may no longer be viable."
              }
            },
            {
              "@type": "Question",
              "name": "What does \"Claim\" do?",
              "acceptedAnswer": {
                "@type": "Answer",
                "text": "Claiming a trade-up (Pro tier only) hides its listings from other TradeUpBot users for 30 minutes, giving you time to purchase the inputs without competition. You can have up to 5 active claims at once. Claims expire automatically after 30 minutes if not completed."
              }
            },
            {
              "@type": "Question",
              "name": "How often is data updated?",
              "acceptedAnswer": {
                "@type": "Answer",
                "text": "Data is updated continuously. The discovery engine runs in approximately 20-minute cycles, scanning for new listings and recalculating trade-ups each cycle. DMarket listings are fetched continuously at 2 requests per second in a separate process. Skinport data streams in via a live WebSocket connection."
              }
            },
            {
              "@type": "Question",
              "name": "What marketplaces are supported?",
              "acceptedAnswer": {
                "@type": "Answer",
                "text": "TradeUpBot sources input listings from three marketplaces: CSFloat (primary source for Covert skins and sale-based pricing), DMarket (broad coverage across all rarity tiers at 2 req/s), and Skinport (passive WebSocket feed, no rate limits). Each marketplace has different buyer fees which are factored into the total input cost calculations."
              }
            },
            {
              "@type": "Question",
              "name": "Why are some trade-ups marked as stale or partial?",
              "acceptedAnswer": {
                "@type": "Answer",
                "text": "Listings on marketplaces are constantly being bought and delisted. When one or more inputs in a trade-up are no longer available, the trade-up is marked as partial (some inputs missing) or stale (not updated in recent cycles). The engine attempts to find replacement listings each cycle, but availability depends on market conditions."
              }
            },
            {
              "@type": "Question",
              "name": "What's the difference between Free and Pro?",
              "acceptedAnswer": {
                "@type": "Answer",
                "text": "Free — Unlimited trade-ups with full filters, search, sorting, listing links, and outcome details. 3-hour data delay. No verification or claims. Pro ($6.99/mo) — Everything in Free plus real-time data (no delay), availability verification (20/hr), and claims (10/hr, up to 5 active)."
              }
            },
            {
              "@type": "Question",
              "name": "Can I lose money on a trade-up?",
              "acceptedAnswer": {
                "@type": "Answer",
                "text": "Yes. While TradeUpBot identifies trade-ups with favorable expected values, there is always risk involved: prices are estimates and can change before you sell the output; items purchased from marketplaces have trade lock periods during which prices may shift; you may receive a lower-value outcome (especially on trade-ups with less than 100% chance to profit); and marketplace fees reduce your effective return. TradeUpBot is an analysis tool, not financial advice. Never invest more than you can afford to lose."
              }
            },
            {
              "@type": "Question",
              "name": "What are the rate limits?",
              "acceptedAnswer": {
                "@type": "Answer",
                "text": "Rate limits apply to Pro tier actions. Verify: 20/hour. Claim: 10/hour (up to 5 active claims). These limits exist to ensure fair access and prevent abuse of marketplace APIs."
              }
            }
          ]
        })}</script>
      </Helmet>
      <SiteNav />

      <main className="pt-24 pb-16">
        <div className="mx-auto max-w-3xl px-6">
          <h1 className="text-3xl sm:text-4xl font-bold mb-2">Frequently Asked Questions</h1>
          <p className="text-muted-foreground mb-10">
            Common questions about TradeUpBot, trade-up contracts, and how the platform works.
          </p>

          <div className="space-y-3">
            <FaqItem question="What is a CS2 trade-up contract?">
              <p>
                A trade-up contract is an in-game mechanic in Counter-Strike 2 where you exchange
                10 weapon skins of the same rarity tier for 1 skin of the next higher rarity tier.
                The output skin comes from the same collection(s) as your inputs. The float value
                (wear) of the output is determined by a formula based on the float values of all
                10 inputs.
              </p>
              <p>
                For Knife/Glove trade-ups, you exchange 5 Covert-rarity skins for 1 Knife or Glove
                from the matching case collections.
              </p>
              <BlogLink slug="how-cs2-trade-ups-work" title="How Trade-Up Contracts Work" />
              <br />
              <BlogLink slug="cs2-trade-up-float-values-guide" title="Float Values Guide" />
            </FaqItem>

            <FaqItem question="How does TradeUpBot find profitable trade-ups?">
              <p>
                Unlike other tools that use theoretical calculations with idealized float values,
                TradeUpBot builds every trade-up from real, buyable listings on CSFloat, DMarket,
                and Skinport. Our engine continuously scans marketplace listings, tests thousands
                of input combinations across 45+ float targets, and evaluates the expected profit
                and probability of each outcome.
              </p>
              <p>
                Every trade-up you see on the platform links to actual listings you can purchase
                right now, with exact floats, exact prices, and deterministic outcomes.
              </p>
              <BlogLink slug="profitable-trade-ups-theory-vs-reality" title="Theory vs Reality" />
            </FaqItem>

            <FaqItem question='What does "chance to profit" mean?'>
              <p>
                A trade-up contract can produce different output skins depending on which
                collections your inputs come from. Each possible output has a probability
                based on the proportion of inputs from its collection. "Chance to profit" is
                the summed probability of all outcomes where the output value exceeds the
                total input cost.
              </p>
              <p>
                For example, a trade-up with 70% chance to profit means that 70% of the
                possible outcomes (weighted by probability) would result in a net gain.
                TradeUpBot keeps trade-ups with over 25% chance to profit, even if the
                overall expected value is slightly negative.
              </p>
              <BlogLink slug="cs2-trade-up-probability-expected-value" title="Probability and Expected Value Guide" />
            </FaqItem>

            <FaqItem question="How accurate are the prices?">
              <p>
                Prices are estimates based on real marketplace data. Output prices are primarily
                derived from CSFloat sale history (the most reliable source), with DMarket and
                Skinport listing data used as gap-fill when CSFloat data is unavailable.
                Input prices are the actual listing prices on each marketplace, including
                applicable buyer fees.
              </p>
              <p>
                Prices can change between when you view a trade-up and when you purchase the
                listings. Always verify a trade-up before buying to check current availability
                and pricing.
              </p>
              <BlogLink slug="cs2-trade-up-marketplace-fees" title="How Marketplace Fees Affect Profits" />
            </FaqItem>

            <FaqItem question='What does "Verify" do?'>
              <p>
                Verify checks whether all the input listings for a trade-up are still available
                on their respective marketplaces and at what price. This gives you up-to-the-moment
                confirmation before you commit to buying. If a listing has been sold or delisted,
                verification will flag it so you know the trade-up may no longer be viable.
              </p>
            </FaqItem>

            <FaqItem question='What does "Claim" do?'>
              <p>
                Claiming a trade-up (Pro tier only) hides its listings from other TradeUpBot users
                for 30 minutes, giving you time to purchase the inputs without competition. You can
                have up to 5 active claims at once. Claims expire automatically after 30 minutes
                if not completed.
              </p>
            </FaqItem>

            <FaqItem question="How often is data updated?">
              <p>
                Data is updated continuously. The discovery engine runs in approximately 20-minute
                cycles, scanning for new listings and recalculating trade-ups each cycle.
                DMarket listings are fetched continuously at 2 requests per second in a separate
                process. Skinport data streams in via a live WebSocket connection.
              </p>
            </FaqItem>

            <FaqItem question="What marketplaces are supported?">
              <p>
                TradeUpBot sources input listings from three marketplaces:
              </p>
              <ul className="list-disc list-inside ml-2 space-y-1">
                <li><strong className="text-foreground">CSFloat</strong> — primary source for Covert skins and sale-based pricing</li>
                <li><strong className="text-foreground">DMarket</strong> — broad coverage across all rarity tiers at 2 req/s</li>
                <li><strong className="text-foreground">Skinport</strong> — passive WebSocket feed, no rate limits</li>
              </ul>
              <p>
                Each marketplace has different buyer fees which are factored into the total
                input cost calculations.
              </p>
              <BlogLink slug="cs2-trade-up-marketplace-fees" title="Marketplace Fees Breakdown" />
            </FaqItem>

            <FaqItem question="Why are some trade-ups marked as stale or partial?">
              <p>
                Listings on marketplaces are constantly being bought and delisted. When one or
                more inputs in a trade-up are no longer available, the trade-up is marked as
                partial (some inputs missing) or stale (not updated in recent cycles). The engine
                attempts to find replacement listings each cycle, but availability depends on
                market conditions.
              </p>
            </FaqItem>

            <FaqItem question="What's the difference between Free and Pro?">
              <p>
                <strong className="text-foreground">Free</strong> — Unlimited trade-ups with full filters, search, sorting, listing
                links, and outcome details. 3-hour data delay. No verification or claims.
              </p>
              <p>
                <strong className="text-foreground">Pro ($6.99/mo)</strong> — Everything in Free plus real-time data (no delay),
                availability verification (20/hr), and claims (10/hr, up to 5 active).
              </p>
              <BlogLink slug="how-to-use-tradeupbot" title="How to Use TradeUpBot" />
            </FaqItem>

            <FaqItem question="Can I lose money on a trade-up?">
              <p>
                <strong className="text-foreground">Yes.</strong> While TradeUpBot identifies trade-ups with favorable expected
                values, there is always risk involved:
              </p>
              <ul className="list-disc list-inside ml-2 space-y-1">
                <li>Prices are estimates and can change before you sell the output</li>
                <li>Items purchased from marketplaces have trade lock periods during which prices may shift</li>
                <li>You may receive a lower-value outcome (especially on trade-ups with less than 100% chance to profit)</li>
                <li>Marketplace fees reduce your effective return</li>
              </ul>
              <p>
                TradeUpBot is an analysis tool, not financial advice. Never invest more than
                you can afford to lose.
              </p>
              <BlogLink slug="profitable-trade-ups-theory-vs-reality" title="Understanding Trade-Up Risks" />
            </FaqItem>

            <FaqItem question="What are the rate limits?">
              <p>
                Rate limits apply to Pro tier actions:
              </p>
              <ul className="list-disc list-inside ml-2 space-y-1">
                <li><strong className="text-foreground">Verify</strong> — 20/hour</li>
                <li><strong className="text-foreground">Claim</strong> — 10/hour (up to 5 active claims)</li>
              </ul>
              <p>
                These limits exist to ensure fair access and prevent abuse of marketplace APIs.
              </p>
            </FaqItem>
          </div>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
