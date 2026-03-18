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
    title: "Finding Profitable Trade-Ups: Theory vs Reality",
    excerpt: "Why theoretical trade-up calculators overstate profits, and what actually matters when you're putting real money on the line.",
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
    title: "The Complete Guide to CS2 Trade-Up Float Values",
    excerpt: "Deep dive into float mechanics: the adjusted float formula, why different skins with the same condition have different trade-up value, and float targeting strategies.",
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

<p><strong>Input listings.</strong> The specific marketplace listings that make up this trade-up. Each input shows the skin name, float value, condition, price, and which marketplace it's listed on. On Basic and Pro tiers, each input links directly to the marketplace listing so you can buy it.</p>

<p><strong>Trade-up metadata.</strong> Collection breakdown, output float calculation, and the mathematical details behind the contract.</p>

<h2>Subscription Tiers</h2>

<p><strong>Free tier</strong> gives you 10 sample trade-ups per rarity tier. You can see full outcome details and sort columns, but there are no listing links, no filters, and data has a 3-hour delay. It's enough to explore the platform and understand how trade-ups work, but not enough to act on opportunities before they disappear.</p>

<p><strong>Basic ($5/mo)</strong> unlocks unlimited trade-ups with a 30-minute delay on new discoveries. You get filters (search by collection, skin name, price range), pagination, direct listing links to buy inputs, and the Verify feature at 10 checks per hour. This is the tier for people who want to do trade-ups regularly but don't need to be first.</p>

<p><strong>Pro ($15/mo)</strong> adds real-time data with no delay — you see trade-ups the moment they're discovered. The Claim system lets you lock a trade-up's listings for 30 minutes so no other TradeUpBot user can see them while you're purchasing. You get 20 verifications per hour, 10 claims per hour, up to 5 active claims at once, the collection browser with knife/glove pool info, and price analytics.</p>

<h2>Using Verify</h2>

<p>Before buying anything, hit the Verify button on a trade-up. Verify calls each marketplace's API to check whether the input listings still exist and at what price. The trade-up's profit, cost, and EV update in real time based on current data.</p>

<p>This matters because marketplace listings are live inventory. A listing that existed 20 minutes ago when the discovery engine found it might already be sold. Verification catches this before you commit money. If a listing is gone, the trade-up is flagged so you know it's no longer executable as shown.</p>

<p>Basic users get 10 verifications per hour. Pro users get 20. Use them on trade-ups you're seriously considering, not as a browsing tool.</p>

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
];

export function getPostBySlug(slug: string): BlogPost | undefined {
  return blogPosts.find((p) => p.slug === slug);
}
