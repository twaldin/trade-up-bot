export interface StaticSeoPage {
  path: string;
  title: string;
  description: string;
  bodyHtml: string;
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
<li><strong>Choose a rarity tier.</strong> Select the input rarity (Mil-Spec, Restricted, Classified, or Covert for knife/glove). All 10 inputs must share the same rarity.</li>
<li><strong>Add each input skin.</strong> Enter the skin name, collection, exact float value, and the listing price from CSFloat, DMarket, or Skinport. Use real listing prices — not averages — because exact float determines output condition.</li>
<li><strong>Review the output pool and float.</strong> The calculator shows every possible output skin with its probability and estimated value at the predicted float. Check that profitable outputs land safely inside the condition boundary you need (e.g., under 0.07 for Factory New).</li>
<li><strong>Compare EV and chance-to-profit.</strong> Positive EV means the contract earns on average. High chance-to-profit means most individual attempts finish green. Small bankrolls usually benefit more from high chance-to-profit; larger bankrolls can tolerate lower-probability positive-EV plays.</li>
</ol>
<section><h2>FAQ</h2>
<h3>Are marketplace fees included in the calculator?</h3>
<p>Yes. The calculator adds buyer-side fees to each input's cost and deducts seller-side fees from each output's value. CSFloat buyer fee is 2.8% plus $0.30 flat. DMarket buyer fee is 2.5%. Skinport has no buyer fee. CSFloat and DMarket both charge 2% seller fees; Skinport charges 8%.</p>
<h3>How precise is the float calculation?</h3>
<p>The calculator uses the same deterministic formula CS2 uses: each input's adjusted float (normalized within its own min–max range) is averaged, then mapped onto each possible output skin's float range. Results are exact given the input floats you enter. Replacing one input with a different float changes the output condition prediction.</p>
<h3>Which CS2 collections are eligible for trade-ups?</h3>
<p>Any collection that contains skins at both the input rarity and the next higher rarity is eligible. Collections with no next-rarity skins cannot be used. The calculator validates collection eligibility automatically when you select inputs.</p></section>`,
  },
  {
    path: "/faq",
    title: "CS2 Trade-Up FAQ — Profit, Float Values & Marketplaces | TradeUpBot",
    description: "Answers to common CS2 trade-up questions about profitability, float values, marketplaces, fees, and TradeUpBot data.",
    bodyHtml: `<h1>CS2 Trade-Up FAQ</h1><p>CS2 trade-up contracts exchange 10 skins of one rarity for one skin of the next rarity. Profit depends on buying inputs below market value, predicting the output condition from the average adjusted float, and selling the result after marketplace fees. TradeUpBot tracks real listings and calculates expected value so traders can evaluate contracts with current data.</p><h2>Common Questions</h2><p>Use the trade-up list to compare profit, ROI, chance to profit, input cost, and output distribution. Use skin pages to inspect float ranges, active listings, collection links, and price data. Use collection pages to discover which cases currently support profitable contracts.</p><p><a href="/trade-ups">See profitable CS2 trade-ups</a> and <a href="/blog/how-cs2-trade-ups-work/">learn how trade-ups work</a>.</p>`,
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
    bodyHtml: `<h1>TradeUpBot Pricing</h1><p>TradeUpBot pricing is designed around how often you evaluate CS2 trade-up contracts. Free access helps traders explore delayed profitable opportunities, while paid tiers unlock faster data, verification, claims, and higher limits for active marketplace research.</p><p>Every plan is built around the same core data model: real listings, integer-cent pricing, marketplace fees, deterministic output float calculations, and collection-weighted output probabilities. Upgrade when you need fresher opportunities, more verification checks, and faster access to profitable contracts.</p><p><a href="/features">Compare TradeUpBot features</a> or <a href="/trade-ups">preview live CS2 trade-ups</a>.</p>`,
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
