export interface BlogPost {
  slug: string;
  title: string;
  excerpt: string;
  content: string;
  publishedAt: string;
  readTime: string;
  author: string;
}

export const blogPosts: BlogPost[] = [
  {
    slug: "how-cs2-trade-ups-work",
    title: "How CS2 Trade-Up Contracts Actually Work",
    excerpt: "The real mechanics behind trade-up contracts: input rules, float calculation formula, condition boundaries, and the mistakes that cost people money.",
    publishedAt: "2026-03-15",
    readTime: "6 min read",
    author: "TradeUpBot Team",
    content: `
<p>Trade-up contracts are one of the few ways to consistently extract value from the CS2 skin market without relying on case opening luck. But most people get the mechanics wrong, and that costs them money.</p>

<h2>The Basic Mechanic</h2>

<p>You feed 10 weapon skins of the same rarity tier into a trade-up contract, and you get back 1 skin of the next higher rarity. Mil-Spec inputs produce a Restricted output. Restricted inputs produce Classified. And so on up the chain.</p>

<p>Knife and glove trade-ups are the exception: you only need 5 Covert skins, and the output is a knife or glove from the matching case collection pool.</p>

<p>The key constraint: <strong>all 10 inputs must be the same rarity</strong>, but they can come from different collections. This is where strategy comes in. The output skin is randomly selected from the next-rarity skins in all collections represented by your inputs, weighted by how many inputs came from each collection.</p>

<p>If you use 7 skins from the Fracture Collection and 3 from the Prisma Collection, you have a 70% chance of getting a Fracture output and 30% chance of a Prisma output. That weighting is the foundation of every profitable trade-up.</p>

<h2>The Float Formula</h2>

<p>This is where most people's understanding breaks down. The output float is not simply the average of your input floats. The actual formula is:</p>

<p><code>output_float = (avg_adjusted_float * (max_float - min_float)) + min_float</code></p>

<p>Where <code>avg_adjusted_float</code> is the average of each input's adjusted float value:</p>

<p><code>adjusted_float = (input_float - input_min_float) / (input_max_float - input_min_float)</code></p>

<p>The <code>min_float</code> and <code>max_float</code> in the output formula refer to the output skin's float range, not the inputs. Most weapon skins have a range of 0.00 to 1.00, but many don't. An AWP | Asiimov has a minimum float of 0.18 and maximum of 1.00. A Glock-18 | Fade ranges from 0.00 to 0.08.</p>

<p>This means the same set of inputs can produce wildly different output floats depending on which output skin you get. A set of inputs that produces a 0.04 float on a standard 0.00-1.00 skin might produce a 0.21 float on an Asiimov — pushing it from Field-Tested into Battle-Scarred territory.</p>

<h2>Why Condition Boundaries Matter</h2>

<p>CS2 has five wear conditions with hard float boundaries:</p>

<ul>
<li><strong>Factory New</strong>: 0.00 - 0.07</li>
<li><strong>Minimal Wear</strong>: 0.07 - 0.15</li>
<li><strong>Field-Tested</strong>: 0.15 - 0.38</li>
<li><strong>Well-Worn</strong>: 0.38 - 0.45</li>
<li><strong>Battle-Scarred</strong>: 0.45 - 1.00</li>
</ul>

<p>A skin at float 0.0699 is Factory New. A skin at float 0.0701 is Minimal Wear. The visual difference is invisible, but the price difference can be 2-5x or more. This is the single most important concept in trade-up profitability.</p>

<p>When you're selecting inputs, you're targeting a specific output float. If you need the output to be Factory New, you need that float under 0.07. Getting it to 0.0695 instead of 0.0705 can be the difference between a $200 output and a $50 output.</p>

<h2>Collection Rules</h2>

<p>The output skin must exist at the next rarity tier within the same collection as the input. If a collection has no skins at the next tier, you can't use skins from that collection in a trade-up. Each collection contributes its proportional share of possible outcomes.</p>

<p>This is why some collections are vastly more valuable for trade-ups than others. A collection where the next-tier skins are all high-value gives you good outcomes regardless of which one you hit. A collection with one expensive skin and four cheap ones is a gamble.</p>

<h2>Common Mistakes</h2>

<p><strong>Using average market prices instead of actual listing prices.</strong> Steam Community Market averages include outliers and don't reflect what you'll actually pay. A skin listed at $8.50 average might have the specific float you need listed at $12.</p>

<p><strong>Ignoring marketplace fees.</strong> CSFloat charges a 2% seller fee, DMarket has a 2% seller fee plus 2.5% buyer fee, and Skinport takes 12% from sellers. If your trade-up has a 5% expected profit margin, fees can flip it to a loss.</p>

<p><strong>Not accounting for float ranges of the output skin.</strong> Running a trade-up calculator with generic float values and assuming the output will be Factory New, then getting Minimal Wear because the output skin has a non-standard float range.</p>

<p><strong>Assuming listings will still be available.</strong> Marketplace listings are live inventory. By the time you calculate a trade-up, find all 10 inputs, and start buying, some may already be sold. Always verify before purchasing.</p>

<h2>The Bottom Line</h2>

<p>Trade-ups are deterministic math. Given the exact float values of your inputs and the float range of the output skin, you can calculate the exact output float before you commit. There's no hidden RNG in the float calculation — only in which output skin you receive when multiple collections are involved. The profitable trade-ups come from understanding this math and finding inputs where the numbers work in your favor.</p>
`,
  },
  {
    slug: "profitable-trade-ups-theory-vs-reality",
    title: "Why Most CS2 Trade-Up Calculators Are Wrong — Theory vs. Real Listings",
    excerpt: "Theoretical calculators promise big profits — then reality hits. Here's the exact reason theory-only tools consistently overstate returns, and why checking real marketplace listings before you commit changes everything.",
    publishedAt: "2026-03-16",
    readTime: "7 min read",
    author: "TradeUpBot Team",
    content: `
<p>Most trade-up calculators on the internet work the same way: you pick a target output, the tool suggests which input skins to use, and it tells you the expected profit. The number looks great. Then you try to actually do the trade-up and the profit evaporates.</p>

<p>We built TradeUpBot specifically because we kept running into this problem. Here's what goes wrong and why real-listing-based discovery is the only approach that works.</p>

<h2>The Theoretical Calculator Problem</h2>

<p>A typical trade-up calculator does this: you want a Factory New AK-47 | Vulcan output. The calculator says "use these 10 Mil-Spec skins from the Operation Phoenix collection, average price $3 each, total cost $30, expected output value $85, profit $55."</p>

<p>Sounds amazing. Here's what actually happens:</p>

<p><strong>The float values are fabricated.</strong> The calculator assumes you can find inputs at some ideal float — usually something like 0.005 or 0.01. In reality, the cheapest available listings for that skin might have floats of 0.04 to 0.06. That difference alone can push your output from Factory New (0.069) to Minimal Wear (0.075), dropping the output value by 60% or more.</p>

<p>We saw this firsthand when testing a theory engine early in TradeUpBot's development. The theoretical calculator identified a trade-up with $2,778 expected profit. Looked incredible. When we checked against real listings with actual float values, the same trade-up had an expected profit of $99. The theory was using float 0.005 inputs that simply didn't exist at the assumed price. Real inputs with purchasable floats of 0.04-0.06 produced Minimal Wear outputs instead of Factory New.</p>

<h2>The Price Gap</h2>

<p>Theoretical calculators typically use "average" prices — some blend of recent sales, Steam Community Market medians, or reference prices from third-party sites. These averages are dangerously misleading for two reasons.</p>

<p>First, the average price for a skin doesn't tell you what you'll pay for one with the specific float you need. Low-float Factory New skins can cost 3-10x the average FN price. The calculator says "$8 per input" but the floats you need cost $22 each.</p>

<p>Second, average output prices are equally misleading. A skin's "average" Factory New price might be $150, but that includes 0.01 float sales alongside 0.069 float sales. Your trade-up output at 0.065 float will sell closer to $120, not $150.</p>

<h2>Marketplace Fees Are Real</h2>

<p>Every marketplace takes a cut, and the cuts add up fast on thin-margin trade-ups.</p>

<p>On the buy side (what you pay for inputs):</p>
<ul>
<li>CSFloat: 2.8% + $0.30 deposit fee</li>
<li>DMarket: 2.5% buyer fee</li>
<li>Skinport: no buyer fee</li>
</ul>

<p>On the sell side (what you lose when selling the output):</p>
<ul>
<li>CSFloat: 2% seller fee</li>
<li>DMarket: 2% seller fee</li>
<li>Skinport: 12% seller fee</li>
</ul>

<p>Consider a trade-up with $100 total input cost and $115 expected output value. Looks like $15 profit. But after 2.5% buyer fees on inputs ($2.50) and 2% seller fee on output ($2.30), your actual profit is $10.20. On a worse outcome, fees can easily erase the entire margin.</p>

<p>Most theoretical calculators ignore fees entirely, or only account for one marketplace.</p>

<h2>Trade Lock Risk</h2>

<p>When you buy skins from a marketplace, they're trade-locked for 7 days. You can't use them in a trade-up contract until the lock expires. During those 7 days, prices move. A trade-up that was profitable when you started buying inputs might be breakeven or negative by the time you can execute it.</p>

<p>This is particularly nasty with knife and glove trade-ups, where Covert inputs can cost $30-100+ each. You're tying up $150-500 for a week, exposed to price movement the entire time.</p>

<p>There's no way to eliminate this risk, but you can manage it. Trade-ups with higher profit margins give you more buffer. Trade-ups with 100% chance to profit (only one possible output, and it's worth more than the inputs) eliminate outcome variance even if prices shift slightly.</p>

<h2>The Availability Problem</h2>

<p>This is the one that kills the most trade-ups in practice. You find 10 perfect inputs, start buying them one by one, and listing #4 has already been sold by someone else. Now you're stuck with 3 skins you bought specifically for this trade-up, and the contract no longer works with available replacements.</p>

<p>Theoretical calculators don't even acknowledge this problem because they don't work with real listings. They assume you can always find the inputs you need at the prices you want.</p>

<h2>What Actually Works</h2>

<p>The only reliable approach is to start from real, currently-available listings and work forward. Not "what inputs would theoretically produce a profitable trade-up" but "given the listings that actually exist right now on CSFloat, DMarket, and Skinport, which combinations are profitable?"</p>

<p>This is fundamentally different from theoretical calculation. Instead of picking a target output and working backward to ideal inputs, you scan actual marketplace inventory, test real float values against the output formula, and calculate profit using actual listing prices with fees included.</p>

<p>The trade-offs are real: discovery-based systems find fewer opportunities than theory-based ones claim to find. But the ones they find are actually executable. A theoretical calculator might show 500 "profitable" trade-ups. A discovery engine scanning real listings might find 50. But those 50 can actually be bought and executed at a profit, while 480 of the theoretical 500 would lose money or can't be assembled.</p>

<p>That's the approach we took with TradeUpBot. Every trade-up links to real listings with real floats and real prices. The profit calculations include marketplace fees. And the verification system lets you confirm everything is still available before you commit a single dollar.</p>
`,
  },
  {
    slug: "cs2-trade-up-float-values-guide",
    title: "CS2 Trade-Up Float Formula Explained — How Adjusted Floats Actually Work",
    excerpt: "Learn exactly how the adjusted float formula determines your output float — and why two Factory New inputs at the same price can produce wildly different results. Includes float targeting strategies you can apply immediately.",
    publishedAt: "2026-03-17",
    readTime: "7 min read",
    author: "TradeUpBot Team",
    content: `
<p>Float values are the entire game in trade-up contracts. Two Factory New skins at $10 each can have completely different trade-up value depending on their exact float. Understanding this is the difference between consistent profits and random losses.</p>

<h2>Float Values Explained</h2>

<p>Every CS2 skin has a float value between 0 and 1 that determines its visual wear. Lower float means less wear. The float is set permanently when the skin is unboxed or dropped — it never changes.</p>

<p>But not every skin uses the full 0-1 range. Each skin has a defined minimum and maximum float. An AK-47 | Redline has a range of 0.10 to 0.70 — it can never be Factory New or Battle-Scarred. A Desert Eagle | Blaze ranges from 0.00 to 0.08 — it can only be Factory New or Minimal Wear.</p>

<p>These float ranges matter enormously for trade-ups because the output float calculation uses the output skin's range, not your inputs' ranges.</p>

<h2>The Adjusted Float Formula</h2>

<p>When calculating the output float, the game first "normalizes" each input float to a 0-1 scale relative to that input skin's float range. This is the adjusted float:</p>

<p><code>adjusted = (float - min_float) / (max_float - min_float)</code></p>

<p>For a skin with range 0.00-1.00 and float 0.05, the adjusted float is simply 0.05. But for a skin with range 0.00-0.08 and float 0.05, the adjusted float is 0.05/0.08 = 0.625. That same 0.05 float represents very different things depending on the skin's range.</p>

<p>The game averages all 10 adjusted floats, then maps the result back to the output skin's range:</p>

<p><code>output_float = (avg_adjusted * (out_max - out_min)) + out_min</code></p>

<p>This two-step normalization is why the same input skins can produce wildly different output floats depending on which output skin you're targeting. And it's why some input skins are far more valuable for trade-ups than others, even at the same condition and price.</p>

<h2>Why Different Skins With the Same Condition Have Different Trade-Up Value</h2>

<p>Take two Factory New skins, both at float 0.03, both costing $5. Skin A has a float range of 0.00 to 1.00. Skin B has a float range of 0.00 to 0.08.</p>

<p>Skin A's adjusted float: 0.03 / 1.00 = 0.03<br/>
Skin B's adjusted float: 0.03 / 0.08 = 0.375</p>

<p>Skin A contributes a very low adjusted float to the average — great for getting a Factory New output. Skin B contributes a much higher adjusted float — it's pulling the output toward Minimal Wear or worse, despite being Factory New itself.</p>

<p>This is counterintuitive. You'd think a Factory New input always helps produce a Factory New output. It doesn't. A Factory New skin with a narrow float range (like 0.00-0.08) has a high adjusted float relative to its range and will push the output float higher than you'd expect.</p>

<p>The best trade-up inputs are skins with <strong>wide float ranges and low actual floats</strong>. A skin with range 0.00-1.00 and float 0.01 has an adjusted float of just 0.01. That's pulling the output hard toward the minimum.</p>

<h2>Condition Boundaries: Where the Money Is</h2>

<p>The five wear conditions have specific float boundaries:</p>

<table>
<thead><tr><th>Condition</th><th>Float Range</th></tr></thead>
<tbody>
<tr><td>Factory New (FN)</td><td>0.00 - 0.07</td></tr>
<tr><td>Minimal Wear (MW)</td><td>0.07 - 0.15</td></tr>
<tr><td>Field-Tested (FT)</td><td>0.15 - 0.38</td></tr>
<tr><td>Well-Worn (WW)</td><td>0.38 - 0.45</td></tr>
<tr><td>Battle-Scarred (BS)</td><td>0.45 - 1.00</td></tr>
</tbody>
</table>

<p>The price jump at each boundary is where trade-up profits come from. A skin at float 0.0699 (Factory New) vs 0.0701 (Minimal Wear) — the visual difference is literally invisible. But the price difference can be massive. On popular skins, Factory New can be worth 2x, 5x, or even 10x the Minimal Wear price.</p>

<p>The FN/MW boundary at 0.07 is the most profitable one. The MW/FT boundary at 0.15 is the second most important. The FT/WW and WW/BS boundaries matter less because the price jumps are usually smaller.</p>

<h2>Float Targeting Strategies</h2>

<p>Given the formula, you work backward from the output float you want. If you need the output under 0.07 for Factory New, you calculate what average adjusted float is required, then find inputs that achieve it.</p>

<p>For an output skin with range 0.00-1.00, you need avg_adjusted under 0.07. For a skin with range 0.00-0.50, you need avg_adjusted under 0.14 (because 0.14 * 0.50 = 0.07). The narrower the output skin's range, the more forgiving the trade-up is.</p>

<p>The best targets for profitable trade-ups are output skins where:</p>

<ul>
<li>The Factory New version is worth significantly more than Minimal Wear</li>
<li>The output skin's float range starts at or near 0.00</li>
<li>Cheap input skins with wide float ranges exist in the same collection or compatible collections</li>
</ul>

<p>TradeUpBot's discovery engine tests 45+ float targets per combination, densely clustered around condition boundaries. Instead of checking one float and hoping for the best, it finds the exact crossing point where an output flips from one condition to another. This is how it identifies opportunities that manual calculations miss.</p>

<h2>Practical Considerations</h2>

<p><strong>You need exact floats, not conditions.</strong> Two "Factory New" skins can have floats of 0.001 and 0.069. Their trade-up value is completely different. Never select inputs based on condition alone — always check the exact float value.</p>

<p><strong>Mixed collections add outcome variance.</strong> When your inputs span multiple collections, you're introducing randomness in which output skin you receive. Each possible output may have different float ranges, meaning the same average adjusted float produces different output floats (and different conditions) depending on which skin you get. Plan for every possible outcome, not just the best one.</p>

<p><strong>Small float differences in inputs compound.</strong> Replacing one input skin with a float 0.02 lower reduces the average adjusted float by 0.002 (in a 10-input trade-up). That might not sound like much, but when you're right at the 0.07 boundary, 0.002 is the difference between FN and MW — and potentially hundreds of dollars in output value.</p>

<p><strong>Check input float ranges before buying.</strong> A "cheap" input that looks like a great deal might have a narrow float range that gives it a high adjusted float, dragging your output toward a worse condition. Always calculate the adjusted float, not just the raw float.</p>
`,
  },
  {
    slug: "how-to-use-tradeupbot",
    title: "How to Find Profitable CS2 Trade-Ups with TradeUpBot",
    excerpt: "A practical walkthrough of TradeUpBot: browsing trade-ups, reading the table, using Verify and Claim, and getting the most out of each subscription tier.",
    publishedAt: "2026-03-18",
    readTime: "5 min read",
    author: "TradeUpBot Team",
    content: `
<p>TradeUpBot finds profitable CS2 trade-up contracts by scanning real marketplace listings across CSFloat, DMarket, and Skinport. This guide walks through the platform from sign-up to executing your first trade-up.</p>

<h2>Getting Started</h2>

<p>Head to <a href="https://tradeupbot.app">tradeupbot.app</a> and sign in with your Steam account. There's no registration form — Steam authentication is the only login method. Once signed in, you're on the Free tier with access to 10 sample trade-ups per rarity tier. No credit card required.</p>

<p>The main interface is the trade-up table. Across the top, you'll see tier tabs: All, Knife/Gloves, Covert, Classified, Restricted, and Mil-Spec. Each tab shows trade-ups for that rarity tier. Click a tab to filter.</p>

<h2>Reading the Trade-Up Table</h2>

<p>Each row in the table represents a complete, executable trade-up contract built from real listings. Here's what each column tells you:</p>

<ul>
<li><strong>Profit</strong> — Expected profit in dollars, accounting for marketplace fees on both buying inputs and selling the output. Green means positive expected value.</li>
<li><strong>ROI</strong> — Return on investment as a percentage. A 25% ROI on a $40 cost means $10 expected profit.</li>
<li><strong>Chance</strong> — The probability that the trade-up produces a profitable outcome. A trade-up can have positive expected value but only 30% chance to profit if the profitable outcome is rare but very valuable.</li>
<li><strong>Cost</strong> — Total cost to buy all input listings, including marketplace buyer fees.</li>
<li><strong>EV</strong> — Expected value of the output, weighted across all possible outcomes by probability.</li>
<li><strong>Best / Worst</strong> — The highest-value and lowest-value possible outcomes with their probabilities. This gives you the range of what could happen.</li>
</ul>

<p>The default sort is by profit, but sorting by chance-to-profit is often more practical. A trade-up with 90% chance to profit and $5 expected profit is a safer bet than one with 15% chance and $40 expected profit — unless you're willing to absorb losses on the misses.</p>

<h2>Expanding a Trade-Up</h2>

<p>Click any row to expand it. The expanded view shows three things:</p>

<p><strong>Outcome distribution chart.</strong> A horizontal bar chart showing every possible output skin, its probability, its estimated value, and whether it's profitable (green) or not (red). This is the core of the trade-up — you can see exactly what you're betting on.</p>

<p><strong>Input listings.</strong> The specific marketplace listings that make up this trade-up. Each input shows the skin name, float value, condition, price, and which marketplace it's listed on. Each input links directly to the marketplace listing so you can buy it.</p>

<p><strong>Trade-up metadata.</strong> Collection breakdown, output float calculation, and the mathematical details behind the contract.</p>

<h2>Subscription Tiers</h2>

<p><strong>Free tier</strong> gives you unlimited trade-ups with full filters, search, sorting, and direct listing links. Data has a 3-hour delay — enough to explore the platform and understand how trade-ups work, but not enough to act on opportunities before they disappear.</p>

<p><strong>Pro ($6.99/mo)</strong> adds real-time data with no delay — you see trade-ups the moment they're discovered. The Claim system lets you lock a trade-up's listings for 30 minutes so no other TradeUpBot user can see them while you're purchasing. You get 20 verifications per hour, 10 claims per hour, and up to 5 active claims at once.</p>

<h2>Using Verify</h2>

<p>Before buying anything, hit the Verify button on a trade-up. Verify calls each marketplace's API to check whether the input listings still exist and at what price. The trade-up's profit, cost, and EV update in real time based on current data.</p>

<p>This matters because marketplace listings are live inventory. A listing that existed 20 minutes ago when the discovery engine found it might already be sold. Verification catches this before you commit money. If a listing is gone, the trade-up is flagged so you know it's no longer executable as shown.</p>

<p>Pro users get 20 verifications per hour. Use them on trade-ups you're seriously considering, not as a browsing tool.</p>

<h2>Using Claim</h2>

<p>Claim is Pro-only. When you claim a trade-up, its input listings are hidden from all other TradeUpBot users for 30 minutes. This gives you an uncontested window to purchase each input from the marketplace.</p>

<p>Claims are limited: 10 per hour, with up to 5 active at once. They expire automatically after 30 minutes. The claim doesn't reserve the listing on the marketplace itself — other buyers outside TradeUpBot can still purchase them. But it eliminates competition from other TradeUpBot users, which is the primary threat for high-profit trade-ups.</p>

<p>The workflow: find a promising trade-up, verify it to confirm availability, claim it, then go buy each input from the linked marketplace listings.</p>

<h2>Tips for Finding the Best Trade-Ups</h2>

<p><strong>Sort by chance-to-profit for consistent returns.</strong> Trade-ups with 80%+ chance to profit will win most of the time. The profit per trade-up is usually modest ($5-20), but the consistency adds up. This is the lower-variance strategy.</p>

<p><strong>Sort by profit for highest upside.</strong> The top-profit trade-ups often have lower chance-to-profit — maybe 30-50%. But when they hit, the payout is significant. This works if you're doing enough volume that the expected value plays out over many attempts.</p>

<p><strong>Check the Best/Worst columns together.</strong> A trade-up where the worst outcome still breaks even is fundamentally different from one where the worst outcome loses 80% of your cost. The chance-to-profit number alone doesn't capture this — look at the actual downside.</p>

<p><strong>Verify before every purchase.</strong> Prices move. Listings sell. A trade-up that was +$15 profit when discovered might be +$3 by the time you verify it. Verification takes seconds and saves you from buying into a trade-up that's no longer worth it.</p>

<p><strong>Use filters to focus.</strong> If you have a budget of $50, filter by cost range. If you only want knife trade-ups, use the tier tab. If you're interested in a specific collection, search for it. The less noise in your view, the faster you find actionable opportunities.</p>

<p>For more detailed answers to common questions, check the <a href="/faq">FAQ page</a>.</p>
`,
  },
  {
    slug: "cs2-trade-up-marketplace-fees",
    title: "CS2 Trade-Up Fees: How Marketplace Costs Eat Your Profits",
    excerpt: "A breakdown of CSFloat, DMarket, and Skinport fee structures — and why ignoring them turns profitable trade-ups into losses.",
    publishedAt: "2026-03-19",
    readTime: "5 min read",
    author: "TradeUpBot Team",
    content: `
<p>Marketplace fees are the single most overlooked factor in trade-up profitability. A trade-up that looks like $10 profit on paper can become $3 after fees — or go negative entirely. Every marketplace charges differently, on different sides of the transaction, and the math changes depending on whether you're buying inputs or selling outputs.</p>

<h2>The Three Fee Structures</h2>

<p><strong>CSFloat</strong> charges 2% on the seller side and hits buyers with a 2.8% deposit fee plus a flat $0.30 per transaction. That flat fee is a killer on cheap skins. A $5 input costs you $5.44 after fees ($5 * 1.028 + $0.30). A $50 input costs $51.70 ($50 * 1.028 + $0.30). The $0.30 flat fee is 6% overhead on a $5 skin but only 0.6% on a $50 one. This makes CSFloat relatively expensive for low-cost inputs and reasonable for higher-value ones.</p>

<p><strong>DMarket</strong> takes 2% from sellers and 2.5% from buyers, no flat fee. A $5 input costs $5.13. A $50 input costs $51.25. Clean percentage-based math with no penalty for small transactions.</p>

<p><strong>Skinport</strong> charges 0% to buyers and 12% to sellers. Buying inputs on Skinport is as cheap as it gets — you pay the listed price, period. But selling on Skinport is brutal. A $100 output nets you only $88 after the 12% seller fee.</p>

<h2>Cheapest Marketplace Depends on Which Side You're On</h2>

<p>For buying inputs, Skinport wins at every price point: $50 costs $50. DMarket is next: $50 costs $51.25. CSFloat is most expensive: $50 costs $51.70.</p>

<p>For selling outputs, the ranking flips completely. CSFloat and DMarket both take 2% — a $100 output nets you $98 on either. Skinport takes 12% — that same output nets you $88. The difference is $10 on a single skin.</p>

<p>The optimal strategy is obvious: buy inputs on Skinport (0% buyer fee), sell outputs on CSFloat or DMarket (2% seller fee). TradeUpBot calculates this automatically when showing profit — every input's buyer fee is included based on which marketplace it's listed on, and output values are adjusted for seller fees.</p>

<h2>How Fees Eat a Real Trade-Up</h2>

<p>Here's a concrete example. You find a Classified-to-Covert trade-up with 10 inputs averaging $8 each and an expected output value of $95.</p>

<p>Raw math: $95 output - $80 inputs = $15 profit. Looks solid.</p>

<p>Now add fees. Say 6 inputs are from DMarket and 4 from CSFloat:</p>

<ul>
<li>6 DMarket inputs at $8: $8 * 1.025 * 6 = $49.20</li>
<li>4 CSFloat inputs at $8: ($8 * 1.028 + $0.30) * 4 = $34.11</li>
<li>Total input cost with fees: $83.31</li>
</ul>

<p>Output sold on CSFloat with 2% seller fee: $95 * 0.98 = $93.10</p>

<p>Actual profit: $93.10 - $83.31 = $9.79. That $15 "profit" is now under $10. And this assumes you get the expected output — if you hit a lower-value outcome, fees push you further into the red.</p>

<p>If you had to sell on Skinport instead (maybe CSFloat doesn't have enough buyer demand for your output skin), that 12% fee changes things dramatically: $95 * 0.88 = $83.60. Profit: $83.60 - $83.31 = $0.29. Essentially breakeven.</p>

<h2>The Flat Fee Problem on Cheap Inputs</h2>

<p>CSFloat's $0.30 flat fee creates a hidden tax on Mil-Spec and Restricted trade-ups where inputs cost $1-5 each. Ten inputs at $2 each on CSFloat: ($2 * 1.028 + $0.30) * 10 = $23.56. The raw cost was $20, so fees added $3.56 — a 17.8% overhead. On the same $2 inputs from DMarket: $2 * 1.025 * 10 = $20.50, just 2.5% overhead.</p>

<p>For cheap inputs, the $0.30 flat fee makes CSFloat significantly more expensive than DMarket or Skinport. This is one reason TradeUpBot's discovery engine pulls Mil-Spec and Restricted listings primarily from DMarket — the fee structure makes it the better source for low-value skins.</p>

<h2>Fees Compress Thin Margins</h2>

<p>Most gun-skin trade-ups (non-knife) operate on thin margins: 5-15% ROI before fees. A 10% ROI trade-up with $80 input cost has $8 of raw profit. After ~$3.50 in buyer fees and ~$2 in seller fees, you're left with $2.50 actual profit. That's 3.1% real ROI.</p>

<p>Knife trade-ups have larger absolute margins but the same fee percentages. A $400 knife trade-up with 15% raw profit ($60) keeps about $45 after fees. The percentages hurt the same way, but at least the dollar amounts are worth the effort.</p>

<p>This is exactly why TradeUpBot includes all fees in every calculation. The profit number you see on the trade-up table is net profit after buying fees on every input and selling fees on the output. When it says $12 profit, it means $12 in your pocket, not $12 before someone takes a cut.</p>

<h2>Cross-Marketplace Arbitrage</h2>

<p>Fee differences create opportunities beyond trade-ups. The same skin is often priced differently across CSFloat, DMarket, and Skinport — partly because sellers price to account for their marketplace's fee structure. A seller on Skinport knows they're losing 12%, so they list higher. A seller on CSFloat only loses 2%, so they can list lower and still net the same amount.</p>

<p>For trade-up inputs, this means the "cheapest" listing isn't always on the marketplace with the lowest sticker price. A skin listed at $9.50 on Skinport (total cost: $9.50) is cheaper than the same skin at $9.00 on CSFloat (total cost: $9.00 * 1.028 + $0.30 = $9.55). Always compare total cost after fees, not listing price.</p>

<p>TradeUpBot handles this automatically. When it selects inputs for a trade-up, it's comparing total acquisition cost across all three marketplaces, not raw listing prices. The cheapest listing price is not always the cheapest input.</p>
`,
  },
  {
    slug: "best-cs2-collections-knife-trade-ups-2026",
    title: "7 Best CS2 Collections for Knife Trade-Ups in 2026 (With Real Profit Data)",
    excerpt: "Not all knife trade-up collections are equal. We ranked the top 7 using real listing data — profit margins, knife pool size, and input availability — so you know which cases are actually worth building around right now.",
    publishedAt: "2026-03-20",
    readTime: "6 min read",
    author: "TradeUpBot Team",
    content: `
<p>Knife trade-ups are the highest-stakes contracts in CS2: 5 Covert inputs, typically $30-150 each, for a shot at a knife or glove that could be worth $200 to $10,000+. The collection you build your trade-up around determines everything — which knives are possible, how many outcomes dilute your odds, and what the floor looks like when you miss.</p>

<h2>How Knife Outputs Work</h2>

<p>Knife and glove trade-ups use 5 Covert inputs (not 10 like gun trade-ups). The output comes from the knife/glove pool associated with the case that contains the input's collection. Every CS2 case maps to a specific set of knife finishes. If your Covert skin comes from the Fracture Collection (part of the Fracture Case), the knife outputs are the Fracture Case knife pool: Skeleton Knife, Nomad Knife, Survival Knife, and Paracord Knife, each available in every knife finish (Fade, Doppler, Crimson Web, etc.).</p>

<p>The critical detail: all 5 inputs must come from collections whose cases share the same knife pool. You can mix collections from different cases only if those cases have identical knife pools — which rarely happens. In practice, most knife trade-ups use 5 Covert skins from collections within the same case.</p>

<h2>Collection Structure Matters</h2>

<p>Each case has a fixed number of Covert skins across its collections. Cases with fewer Covert skins mean each available Covert listing covers a larger share of the input pool, making it easier to build trade-ups. Cases with many Covert skins spread your options thin — more listings to search, but also more variation in what's available at reasonable prices.</p>

<p>The number of knife types in the pool is equally important. A case with 4 knife types and 10 finishes each has 40 possible knife outputs (times 5 conditions). A case with 2 knife types has 20. Fewer knife types means each individual knife has higher probability — which matters when you're targeting a specific high-value outcome.</p>

<h2>Standout Collections for Knife Trade-Ups</h2>

<p><strong>Chroma Collections (Chroma, Chroma 2, Chroma 3).</strong> These cases share the same knife pool: Bayonet, Flip Knife, Gut Knife, Huntsman Knife, and Butterfly Knife — but with the addition of Chroma-exclusive finishes like Doppler, Tiger Tooth, Damascus Steel, Rust Coat, and Ultraviolet. The Doppler knives (especially Phase 2 and Phase 4) command strong premiums. Butterfly Knife Doppler Phase 2 in Factory New regularly trades above $2,500. The downside is that 5 knife types means outcome probability is spread across a wide pool.</p>

<p><strong>Prisma Collection (Prisma Case).</strong> Prisma's knife pool includes the Navaja, Stiletto, Talon, and Ursus knives. Talon Knife finishes in Factory New — especially Crimson Web and Fade — are high-value targets. The Covert skins in this collection (like the AK-47 | Asiimov) tend to have reasonable listing availability on DMarket and CSFloat. Navaja and Ursus are the downside outcomes, often worth less than the inputs.</p>

<p><strong>Danger Zone Collection (Danger Zone Case).</strong> This case introduced the Classic Knife alongside the existing pool. The Classic Knife in Factory New commands a premium over most other knife types due to its clean aesthetic. Collections from the Danger Zone Case have relatively accessible Covert skins, making input acquisition more practical.</p>

<p><strong>Arms Deal Collection (CS:GO Weapon Case).</strong> One of the oldest collections. The knife pool here is the classic set: Karambit, M9 Bayonet, Bayonet, Flip Knife, and Gut Knife. Karambit and M9 Bayonet finishes are consistently among the highest-value knives in the game. The Karambit Fade FN trades in the $1,500-3,000 range. The risk is that Gut Knife finishes are often worth less than a Covert input set, creating ugly worst-case outcomes.</p>

<h2>Glove Collections: Different Math</h2>

<p>Glove trade-ups follow the same 5-input Covert structure, but the output pool is sport gloves, driver gloves, hand wraps, moto gloves, specialist gloves, or hydra gloves — depending on the case. Glove outputs tend to have lower peak values than top-tier knives. A Specialist Gloves | Crimson Kimono in Factory New is valuable, but the median glove output is typically worth less than the median knife output from a comparable case.</p>

<p>The upside: glove cases sometimes have fewer total output finishes than knife cases, which concentrates probability. If a glove case has 3 glove types with 8 finishes each (24 outputs), versus a knife case with 5 knife types and 10 finishes each (50 outputs), each individual glove outcome has roughly double the probability. Higher concentration means you can more reliably land specific outcomes.</p>

<p>Glove cases also tend to have slightly cheaper Covert inputs on average. The combination of lower input costs and more concentrated probability can produce trade-ups with better chance-to-profit metrics, even if the peak payout is lower. For risk-adjusted returns, gloves can outperform knives.</p>

<h2>Float Ranges and Output Conditions</h2>

<p>Not all knife finishes use the full 0.00-1.00 float range. Fade has a range of 0.00 to 0.08 — it can only be Factory New or Minimal Wear. Doppler ranges from 0.00 to 0.08 as well. Crimson Web goes from 0.06 to 0.80, meaning Factory New Crimson Web is extremely tight (0.06 to 0.07).</p>

<p>These output float ranges directly affect trade-up targeting. When you aim for a Factory New Doppler output, the requirement is lenient: you just need an output float under 0.07, and the output skin's max float is only 0.08, so even moderately low-float inputs will get there. Crimson Web Factory New is the opposite extreme: the skin's minimum float is 0.06, so the FN window is 0.06 to 0.07 — impossibly narrow for most input combinations.</p>

<p>This is why Doppler knives show up disproportionately in profitable knife trade-ups. The float range makes Factory New achievable without needing unrealistically low-float inputs. Crimson Web FN, by contrast, requires near-perfect inputs and remains one of the hardest trade-up targets in the game.</p>

<h2>Multi-Collection vs Single-Collection Trade-Ups</h2>

<p>A single-collection knife trade-up uses 5 Covert skins from the same collection. The output is exclusively knives from that case's pool. Probability is straightforward: each knife finish has equal weight.</p>

<p>A multi-collection trade-up mixes Coverts from different collections within the same case. This works when a case contains multiple collections (some operations added sub-collections). The advantage is more available Covert listings to choose from, which can lower input costs. The disadvantage is that some collection combos introduce gun-skin Exotic outputs alongside knives, diluting the knife probability.</p>

<p>In practice, the best knife trade-ups tend to use collections where the Covert skins are cheap relative to the knife pool's expected value. If a collection's Covert skin trades at $35 and the average knife output is worth $250, the math works. If the Covert input costs $120, you need the average knife output to justify $600+ in total inputs — which limits you to pools with mostly high-value knife types.</p>

<p>TradeUpBot's discovery engine evaluates all of this automatically. It scans every available Covert listing, tests each valid 5-input combination against the full knife output pool (including per-phase Doppler pricing), and only surfaces trade-ups where the expected value exceeds total input cost after fees.</p>
`,
  },
  {
    slug: "cs2-trade-up-probability-expected-value",
    title: "Understanding CS2 Trade-Up Probability and Expected Value",
    excerpt: "How outcome probabilities are calculated, what expected value actually tells you, and why chance-to-profit matters more than EV for most traders.",
    publishedAt: "2026-03-21",
    readTime: "6 min read",
    author: "TradeUpBot Team",
    content: `
<p>Every trade-up contract is a bet. You know the possible outcomes, you know the probabilities, and you can calculate the expected value before you commit. But most traders fixate on EV and ignore the metric that actually determines whether they make money: chance-to-profit.</p>

<h2>How Trade-Up Probabilities Work</h2>

<p>When you submit 10 inputs spanning multiple collections, the game picks one output skin from the next rarity tier. The probability of each outcome is proportional to how many inputs came from that skin's collection.</p>

<p>Say you use 7 inputs from Collection A (which has 2 skins at the next rarity: Skin X and Skin Y) and 3 inputs from Collection B (which has 1 skin at the next rarity: Skin Z). The weights are:</p>

<ul>
<li>Collection A total probability: 7/10 = 70%</li>
<li>Collection B total probability: 3/10 = 30%</li>
</ul>

<p>Within Collection A, each next-rarity skin gets an equal share: Skin X = 35%, Skin Y = 35%. Collection B has only one option: Skin Z = 30%.</p>

<p>This weighting is deterministic. There's no hidden RNG on top of it — the game generates a random number, maps it to these weights, and you get that outcome. Over enough trade-ups, your results will converge on these exact probabilities.</p>

<h2>Expected Value: The Formula</h2>

<p>Expected value is the probability-weighted average of all outcomes minus your input cost. The formula:</p>

<p><code>EV = sum(probability_i * output_value_i) - total_input_cost</code></p>

<p>Using our example above, suppose Skin X is worth $120, Skin Y is worth $40, Skin Z is worth $200, and your total input cost is $80:</p>

<p><code>EV = (0.35 * $120) + (0.35 * $40) + (0.30 * $200) - $80</code><br/>
<code>EV = $42 + $14 + $60 - $80 = $36</code></p>

<p>Positive EV. On average, this trade-up returns $36 profit per attempt. Run it 100 times and you'd expect roughly $3,600 in total profit. That's the theory.</p>

<h2>Why EV Alone Is Misleading</h2>

<p>That $36 EV number hides important information. Look at the individual outcomes:</p>

<ul>
<li>Skin X ($120): 35% chance, profit = $40</li>
<li>Skin Y ($40): 35% chance, profit = -$40 (loss)</li>
<li>Skin Z ($200): 30% chance, profit = $120</li>
</ul>

<p>Chance to profit: 65% (Skin X + Skin Z). Chance to lose: 35% (Skin Y). The expected value is positive, but you lose money more than one-third of the time. If you run this trade-up once and hit Skin Y, you're down $40. The $36 EV is real, but it only materializes over many repetitions.</p>

<p>Now consider a different trade-up: 100% chance of one output worth $84, input cost $80. EV = $4. Boring. But you literally cannot lose. Every single execution makes $4. For someone doing one trade-up, the $4 guaranteed profit beats the $36 EV gamble that has a 35% chance of losing $40.</p>

<h2>Chance-to-Profit: The Practical Metric</h2>

<p>Chance-to-profit measures the probability that the trade-up produces an output worth more than your total input cost. It doesn't care how much you profit or lose — just whether the result is green or red.</p>

<p>A trade-up with 90% chance to profit is one where 9 out of 10 outcomes are worth more than your inputs. You might profit $5 on the good outcomes and lose $30 on the bad one, with EV of +$1.50. The EV is tiny, but you almost always come out ahead.</p>

<p>A trade-up with 20% chance to profit but high EV is the opposite: most attempts lose money, but the rare win is big enough to pull the average positive. This is a lottery ticket with favorable odds. Mathematically sound, emotionally brutal.</p>

<p>Neither metric alone tells the full story. You need both.</p>

<h2>Risk Profiles: Lottery vs Grinder</h2>

<p><strong>The Lottery profile</strong>: low chance-to-profit (15-35%), high EV. These trade-ups have one or two expensive outcomes and several cheap ones. You lose most of the time, but the wins are large. A knife trade-up where 4 out of 5 possible outputs are worth less than your inputs, but the 5th is a $3,000 Karambit Fade, fits this profile. EV might be +$80, but you're losing money 80% of the time.</p>

<p>This works if you have the bankroll to absorb repeated losses and the volume to let expected value converge. Ten attempts at $200 each ($2,000 total outlay) with 20% chance to profit and +$80 EV should net ~$800 profit over those 10 attempts — but you might need to survive 6-7 losses in a row before hitting a winner. Can your bankroll handle that?</p>

<p><strong>The Grinder profile</strong>: high chance-to-profit (75-100%), modest EV. These trade-ups have most or all outcomes above breakeven. Individual profits are small — $3 to $15 typically — but losses are rare. A Classified-to-Covert trade-up where 8 of 10 outcomes are profitable and the other 2 lose only a few dollars fits here.</p>

<p>This works for smaller bankrolls and traders who want predictable income. Ten Grinder trade-ups at $50 each ($500 outlay) with 85% chance to profit and +$5 EV should net ~$50 with very low variance. You won't get rich quickly, but you won't go broke either.</p>

<h2>When Negative EV Trade-Ups Make Sense</h2>

<p>This sounds contradictory, but negative EV trade-ups can be rational under specific conditions.</p>

<p>Suppose a trade-up has -$5 EV but 60% chance to profit, with the following outcome distribution: 60% chance of +$15 profit, 40% chance of -$35 loss. Expected value is (0.6 * $15) + (0.4 * -$35) = $9 - $14 = -$5. The math says don't do it.</p>

<p>But what if the 40% loss outcome produces a skin you actually want to keep and use? Or what if the $15 profit outcome produces a skin with high trade velocity that you can flip immediately, while the loss outcome is a skin that will eventually recover in value? Context matters beyond raw EV.</p>

<p>TradeUpBot flags trade-ups with negative EV but above 25% chance to profit, specifically because some of them have profiles worth considering. A trade-up with -$3 EV but 70% chance to profit and a worst-case loss of only $8 is a mild gamble with mostly good outcomes. The expected value is slightly negative, but the actual experience of running it is usually positive.</p>

<p>The opposite is also true: positive EV doesn't automatically make a trade-up worth doing. A +$50 EV trade-up with 5% chance to profit and $500 input cost means you lose money 95% of the time and need to do it 20+ times for the EV to converge. Unless you have $10,000+ allocated to this single trade-up type, the variance will eat you alive.</p>

<h2>Putting It Together</h2>

<p>The best trade-ups score well on both metrics: positive EV and high chance-to-profit. These are rare, which is why discovery engines exist — manually finding trade-ups where most outcomes are profitable AND the expected value is meaningfully positive requires evaluating thousands of listing combinations.</p>

<p>When you have to choose between the two metrics, let your bankroll decide. Large bankroll with high volume? Optimize for EV. You'll weather the variance. Small bankroll, doing a few trade-ups per week? Optimize for chance-to-profit. Consistency beats expected value when you can't afford a losing streak.</p>

<p>TradeUpBot lets you sort by either metric. Sort by profit (EV) to find the highest-upside plays. Sort by chance to find the most consistent ones. Expand any trade-up to see the full outcome distribution — every possible output, its probability, and whether it's above or below breakeven. That distribution is the trade-up. Everything else is just a summary of it.</p>
`,
  },
];

export function getPostBySlug(slug: string): BlogPost | undefined {
  return blogPosts.find((p) => p.slug === slug);
}
