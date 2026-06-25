export interface StaticSeoPage {
  path: string;
  title: string;
  description: string;
  bodyHtml: string;
  jsonLd?: Record<string, unknown>[];
}

export const STATIC_SEO_PAGES: StaticSeoPage[] = [
  {
    path: "/calculator",
    title: "Free CS2 Trade-Up Calculator — Profit, Float & EV | TradeUpBot",
    description: "Free online CS2 trade-up calculator and simulator. Enter 10 skins to calculate profit, expected value, float outcomes, ROI and chance to profit — with live CSFloat, DMarket and Skinport pricing.",
    bodyHtml: `<h1>CS2 Trade-Up Calculator</h1><p>The TradeUpBot CS2 trade-up calculator helps players estimate contract cost, expected value, output float, and potential profit before buying 10 inputs. Use it to compare rarity tiers, understand condition boundaries, and avoid contracts where marketplace fees erase the expected return.</p><p>Trade-up math depends on input skin prices, output probabilities, collection weighting, and the adjusted float formula. TradeUpBot pairs calculator logic with live listings from CSFloat, DMarket, and Skinport so you can move from theory to real buyable opportunities.</p><p><a href="/trade-ups">Browse live profitable trade-ups</a> or <a href="/skins">research CS2 skin prices and float ranges</a>.</p>
<h2>What the calculator does</h2>
<p>Enter up to 10 input skins — with their collection, rarity, exact float value, and current buy price — and the calculator outputs: expected value (EV), net profit after marketplace fees, return on investment (ROI), chance to profit, output float, and the full probability distribution across every possible output skin. Fees for CSFloat (2.8% + $0.30 buyer, 2% seller), DMarket (2.5% buyer, 2% seller), and Skinport (0% buyer, 8% seller) are applied automatically based on which marketplace each listing comes from.</p>
<h2>Calculator, simulator, or generator?</h2>
<p>Whether you call it a CS2 trade-up calculator, trade-up simulator, or trade-up generator, the tool does the same job: model a contract before you spend money. TradeUpBot uses all three terms because players search for each one — the underlying math (collection weighting, adjusted float formula, fee-adjusted profit) is identical regardless of the label.</p>
<h2>How to use it</h2>
<ol>
<li><strong>Choose a rarity tier.</strong> Inputs can be any rarity from Consumer Grade to Covert. The calculator detects the rarity from your first resolved input. Standard contracts take 10 same-rarity inputs; Covert inputs feed knife/glove contracts which take 5 inputs instead.</li>
<li><strong>Add each input skin.</strong> Enter the skin name, collection, exact float value, and the listing price from CSFloat, DMarket, or Skinport. Use real listing prices — not averages — because exact float determines output condition.</li>
<li><strong>Review the output pool and float.</strong> The calculator shows every possible output skin with its probability and estimated value at the predicted float. Check that profitable outputs land safely inside the condition boundary you need (e.g., under 0.07 for Factory New).</li>
<li><strong>Compare EV and chance-to-profit.</strong> Positive EV means the contract earns on average. High chance-to-profit means most individual attempts finish green. Small bankrolls usually benefit more from high chance-to-profit; larger bankrolls can tolerate lower-probability positive-EV plays.</li>
</ol>
<h2>Why most CS2 trade-up calculators are wrong</h2>
<p>A trade-up's output float is a single deterministic number — the average of the ten inputs' adjusted floats mapped onto the output skin's range. Most calculators then price that output at its <em>condition average</em>: the blended price of every Field-Tested (or Minimal Wear, etc.) sale. But a 0.16 Field-Tested and a 0.37 Field-Tested are both "Field-Tested" and rarely sell for the same price — the cleaner-looking float trades higher. Pricing the output at a condition average ignores the exact float the contract actually produces.</p>
<p>TradeUpBot prices the <strong>exact predicted output float</strong> instead. It finds real sales at floats near the contract's deterministic output and prices from those, not from a condition midpoint. Example: a contract predicts a 0.16 output float. A condition-average model values it at the Field-Tested blend; nearest real sales around 0.16 can trade noticeably higher because the skin reads as near-Minimal-Wear. That gap is often the difference between a contract that looks break-even and one that is genuinely profitable — which is why a float-exact calculator and a condition-average calculator can disagree on the very same ten inputs.</p>
<p>See this on <a href="/trade-ups">live profitable trade-ups</a>, research a skin's float-to-price curve on <a href="/skins">skin price pages</a>, or read <a href="/blog/profitable-trade-ups-theory-vs-reality/">theory vs reality</a>.</p>
<section><h2>FAQ</h2>
<h3>Are marketplace fees included in the calculator?</h3>
<p>Yes. The calculator adds buyer-side fees to each input's cost and deducts seller-side fees from each output's value. CSFloat buyer fee is 2.8% plus $0.30 flat. DMarket buyer fee is 2.5%. Skinport has no buyer fee. CSFloat and DMarket both charge 2% seller fees; Skinport charges 8%.</p>
<h3>How precise is the float calculation?</h3>
<p>The calculator uses the same deterministic formula CS2 uses: each input's adjusted float (normalized within its own min–max range) is averaged, then mapped onto each possible output skin's float range. Results are exact given the input floats you enter. Replacing one input with a different float changes the output condition prediction.</p>
<h3>Which CS2 collections are eligible for trade-ups?</h3>
<p>Any collection that contains skins at both the input rarity and the next higher rarity is eligible. Collections with no next-rarity skins cannot be used. The calculator validates collection eligibility automatically when you select inputs.</p></section>`,
    jsonLd: [
      {
        "@context": "https://schema.org",
        "@type": "SoftwareApplication",
        name: "TradeUpBot CS2 Trade-Up Calculator",
        applicationCategory: "UtilityApplication",
        operatingSystem: "Web",
        url: "https://tradeupbot.app/calculator",
        description: "Free CS2 trade-up calculator that computes expected value, profit, output float, ROI, and chance to profit from 10 input skins using live marketplace pricing.",
        offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      },
      {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: [
          { "@type": "Question", name: "Are marketplace fees included in the calculator?", acceptedAnswer: { "@type": "Answer", text: "Yes. The calculator adds buyer-side fees to each input's cost and deducts seller-side fees from each output's value. CSFloat buyer fee is 2.8% plus $0.30 flat. DMarket buyer fee is 2.5%. Skinport has no buyer fee. CSFloat and DMarket both charge 2% seller fees; Skinport charges 8%." } },
          { "@type": "Question", name: "How precise is the float calculation?", acceptedAnswer: { "@type": "Answer", text: "The calculator uses the same deterministic formula CS2 uses: each input's adjusted float (normalized within its own min–max range) is averaged, then mapped onto each possible output skin's float range. Results are exact given the input floats you enter. Replacing one input with a different float changes the output condition prediction." } },
          { "@type": "Question", name: "Which CS2 collections are eligible for trade-ups?", acceptedAnswer: { "@type": "Answer", text: "Any collection that contains skins at both the input rarity and the next higher rarity is eligible. Collections with no next-rarity skins cannot be used. The calculator validates collection eligibility automatically when you select inputs." } },
        ],
      },
      {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: "https://tradeupbot.app/" },
          { "@type": "ListItem", position: 2, name: "Calculator", item: "https://tradeupbot.app/calculator" },
        ],
      },
    ],
  },
  {
    path: "/faq",
    title: "CS2 Trade-Up FAQ — Profit, Float Values & Marketplaces | TradeUpBot",
    description: "Answers to common CS2 trade-up questions about profitability, float values, marketplaces, fees, and TradeUpBot data.",
    bodyHtml: `<h1>CS2 Trade-Up FAQ</h1><p>CS2 trade-up contracts exchange 10 skins of one rarity for one skin of the next rarity. Profit depends on buying inputs below market value, predicting the output condition from the average adjusted float, and selling the result after marketplace fees. TradeUpBot tracks real listings and prices the exact output float so traders can evaluate contracts with current data.</p>
<section>
<h2>Common Questions</h2>
<h3>Is CS2 trade-up profit real or just theoretical?</h3>
<p>Profit is real but conditional. TradeUpBot builds every trade-up from actual buyable listings on CSFloat, DMarket, and Skinport, then prices the exact output float from real sales rather than a condition average. A contract is profitable only if the output sells for more than your ten inputs cost after marketplace fees — and listings can sell or move before you act, so verify before buying.</p>
<h3>How is the output float of a trade-up determined?</h3>
<p>The output float is deterministic: each input's float is normalized within its own min–max range, the ten normalized values are averaged, and that average is mapped onto the output skin's float range. Change one input's float and the predicted output condition can change. This is why exact input floats — not condition averages — decide whether a contract lands in Factory New, Minimal Wear, or Field-Tested.</p>
<h3>What marketplace fees does TradeUpBot account for?</h3>
<p>TradeUpBot applies each marketplace's real fees: CSFloat charges a 2.8% + $0.30 buyer fee and 2% seller fee; DMarket charges 2.5% buyer and 2% seller; Skinport charges no buyer fee and 8% seller; Buff charges 3.5% + $0.15 buyer and 2.5% seller. Fees are applied per listing based on where each skin is bought or sold.</p>
<h3>What does "chance to profit" mean?</h3>
<p>A trade-up can produce different output skins, each with a probability set by how many inputs come from its collection. Chance to profit is the summed probability of the outcomes whose output value exceeds your total input cost. A 70% chance to profit means 70% of the probability-weighted outcomes finish in the green.</p>
<h3>Why does TradeUpBot disagree with other trade-up calculators?</h3>
<p>Most calculators price an output at its condition average — the blended price of every skin in that wear band. TradeUpBot prices the exact predicted output float from nearest real sales, so a clean 0.16 Field-Tested is valued differently from a worn 0.37 Field-Tested. That float-exact pricing is the core difference and is why the same ten inputs can look profitable here and break-even elsewhere.</p>
<h3>How often is the data updated?</h3>
<p>TradeUpBot continuously scans marketplace listings and refreshes trade-ups throughout the day. Free users see contracts on a delay; Pro users see them immediately. Always use Verify before buying to confirm a contract's inputs are still listed at the expected prices.</p>
</section>
<p><a href="/trade-ups">See profitable CS2 trade-ups</a>, <a href="/calculator">open the calculator</a>, and <a href="/blog/how-cs2-trade-ups-work/">learn how trade-ups work</a>.</p>`,
    jsonLd: [
      {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: [
          { "@type": "Question", name: "Is CS2 trade-up profit real or just theoretical?", acceptedAnswer: { "@type": "Answer", text: "Profit is real but conditional. TradeUpBot builds every trade-up from actual buyable listings on CSFloat, DMarket, and Skinport, then prices the exact output float from real sales rather than a condition average. A contract is profitable only if the output sells for more than your ten inputs cost after marketplace fees — and listings can sell or move before you act, so verify before buying." } },
          { "@type": "Question", name: "How is the output float of a trade-up determined?", acceptedAnswer: { "@type": "Answer", text: "The output float is deterministic: each input's float is normalized within its own min–max range, the ten normalized values are averaged, and that average is mapped onto the output skin's float range. Change one input's float and the predicted output condition can change. This is why exact input floats — not condition averages — decide whether a contract lands in Factory New, Minimal Wear, or Field-Tested." } },
          { "@type": "Question", name: "What marketplace fees does TradeUpBot account for?", acceptedAnswer: { "@type": "Answer", text: "TradeUpBot applies each marketplace's real fees: CSFloat charges a 2.8% + $0.30 buyer fee and 2% seller fee; DMarket charges 2.5% buyer and 2% seller; Skinport charges no buyer fee and 8% seller; Buff charges 3.5% + $0.15 buyer and 2.5% seller. Fees are applied per listing based on where each skin is bought or sold." } },
          { "@type": "Question", name: "What does \"chance to profit\" mean?", acceptedAnswer: { "@type": "Answer", text: "A trade-up can produce different output skins, each with a probability set by how many inputs come from its collection. Chance to profit is the summed probability of the outcomes whose output value exceeds your total input cost. A 70% chance to profit means 70% of the probability-weighted outcomes finish in the green." } },
          { "@type": "Question", name: "Why does TradeUpBot disagree with other trade-up calculators?", acceptedAnswer: { "@type": "Answer", text: "Most calculators price an output at its condition average — the blended price of every skin in that wear band. TradeUpBot prices the exact predicted output float from nearest real sales, so a clean 0.16 Field-Tested is valued differently from a worn 0.37 Field-Tested. That float-exact pricing is the core difference and is why the same ten inputs can look profitable here and break-even elsewhere." } },
          { "@type": "Question", name: "How often is the data updated?", acceptedAnswer: { "@type": "Answer", text: "TradeUpBot continuously scans marketplace listings and refreshes trade-ups throughout the day. Free users see contracts on a delay; Pro users see them immediately. Always use Verify before buying to confirm a contract's inputs are still listed at the expected prices." } },
        ],
      },
      {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: "https://tradeupbot.app/" },
          { "@type": "ListItem", position: 2, name: "FAQ", item: "https://tradeupbot.app/faq" },
        ],
      },
    ],
  },
  {
    path: "/features",
    title: "TradeUpBot Features — Live CS2 Trade-Up Analysis Tools",
    description: "Explore TradeUpBot features for CS2 trade-up discovery, verification, claims, float pricing, and collection analysis.",
    bodyHtml: `<h1>TradeUpBot Features</h1><p>TradeUpBot discovers profitable CS2 trade-up contracts from real marketplace listings instead of theoretical price sheets. The platform combines live input listings, output probabilities, adjusted float calculations, marketplace fees, and price history to rank contracts by profit, ROI, and chance to profit.</p><p>Key features include real-time trade-up tables, input verification, claim windows, collection trade-up pages, CS2 skin price pages, float-aware pricing, and marketplace-aware fee calculations across CSFloat, DMarket, and Skinport.</p><p><a href="/trade-ups">Open the live trade-up table</a>, <a href="/collections">browse CS2 collections</a>, or <a href="/calculator">use the calculator</a>.</p>`,
  },
  {
    path: "/pricing",
    title: "TradeUpBot Pricing — CS2 Trade-Up Tools for Every Trader",
    description: "Compare TradeUpBot plans for CS2 trade-up discovery, listing verification, claim limits, and live marketplace data.",
    bodyHtml: `<h1>TradeUpBot Pricing</h1><p>TradeUpBot pricing is designed around how often you evaluate CS2 trade-up contracts. Free access helps traders explore delayed profitable opportunities, while Pro unlocks faster data, verification, claims, and higher limits for active marketplace research.</p><p>Every plan is built around the same core data model: real listings, integer-cent pricing, marketplace fees, deterministic output float calculations, and collection-weighted output probabilities. Upgrade when you need fresher opportunities, more verification checks, and faster access to profitable contracts.</p>
<h2>Plans</h2>
<ul>
<li><strong>Free — $0:</strong> Browse profitable CS2 trade-ups on a delay, with float data and skin pages.</li>
<li><strong>Pro — $6.99/month:</strong> Real-time trade-ups, listing verification, the claim system, and full analytics.</li>
<li><strong>Pro Yearly — $59.99/year:</strong> The same Pro access billed annually (about $5/month).</li>
<li><strong>Pro Lifetime — $74.99 once:</strong> Lifetime Pro access for a single one-time payment.</li>
</ul>
<p><a href="/features">Compare TradeUpBot features</a> or <a href="/trade-ups">preview live CS2 trade-ups</a>.</p>`,
    jsonLd: [
      {
        "@context": "https://schema.org",
        "@type": "Product",
        name: "TradeUpBot",
        description: "CS2 trade-up discovery with float-exact pricing from real CSFloat, DMarket, Skinport, and Buff listings.",
        brand: { "@type": "Brand", name: "TradeUpBot" },
        offers: [
          { "@type": "Offer", name: "Free", price: "0", priceCurrency: "USD", description: "Browse profitable CS2 trade-ups on a delay, with float data and skin pages." },
          { "@type": "Offer", name: "Pro Monthly", price: "6.99", priceCurrency: "USD", description: "Real-time trade-ups, listing verification, the claim system, and full analytics, billed monthly." },
          { "@type": "Offer", name: "Pro Yearly", price: "59.99", priceCurrency: "USD", description: "The same Pro access billed annually." },
          { "@type": "Offer", name: "Pro Lifetime", price: "74.99", priceCurrency: "USD", description: "Lifetime Pro access for a single one-time payment." },
        ],
      },
      {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: "https://tradeupbot.app/" },
          { "@type": "ListItem", position: 2, name: "Pricing", item: "https://tradeupbot.app/pricing" },
        ],
      },
    ],
  },
  {
    path: "/terms",
    title: "Terms of Service — TradeUpBot",
    description: "TradeUpBot terms for using CS2 trade-up analysis, marketplace data, subscriptions, and related tools.",
    bodyHtml: `<h1>Terms of Service</h1><p>TradeUpBot provides CS2 trade-up analysis, market data, educational content, and tools for estimating expected value, float outcomes, and potential profitability. The service does not guarantee profit, marketplace availability, or future prices. Listings can sell or change before a user acts.</p><p>Users are responsible for reviewing marketplace terms, understanding risks, and verifying input listings before purchase. TradeUpBot calculations are informational and depend on available data from third-party marketplaces, including CSFloat, DMarket, and Skinport.</p><p><a href="/privacy">Read the privacy policy</a> or <a href="/faq">review common CS2 trade-up questions</a>.</p>`,
  },
  {
    path: "/privacy",
    title: "Privacy Policy — TradeUpBot",
    description: "TradeUpBot privacy information for accounts, subscriptions, sessions, analytics, and CS2 trade-up tool usage.",
    bodyHtml: `<h1>Privacy Policy</h1><p>TradeUpBot uses account, session, subscription, and analytics information to operate CS2 trade-up tools, protect access limits, process payments, and improve marketplace data quality. The site focuses on trade-up analysis and does not sell personal information as a standalone product.</p><p>Operational data may include authentication identifiers, tier status, verification usage, claim activity, and standard web analytics. Marketplace listing and pricing data are used to calculate trade-up opportunities, skin pages, collection pages, and sitemap content for crawlers.</p><p><a href="/terms">Read the terms of service</a> or <a href="/features">learn about TradeUpBot features</a>.</p>`,
  },
];
