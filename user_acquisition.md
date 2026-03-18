# User Acquisition Strategy

Post-launch playbook for growing TradeUpBot's user base. Consolidates all existing ideas from `growth_strategy.md`, the prelaunch checklist, and new strategies.

**Core positioning**: TradeUpBot shows real, buyable listings. Competitors (TradeUpLab, 5K Discord) only show theoretical trade-ups. Our moat is real listings + verify + claim. Speed matters — capture users before competitors can copy.

---

## 1. Discord Server & Bot

**Priority**: Immediate post-launch
**Effort**: Medium (bot dev + community management)
**Why**: TradeUpLab's 5K Discord IS their distribution channel. We need our own community hub to compete and to give users a reason to stay engaged.

### Bot: Auto-Setup & Management

Build a Discord bot (`discord.js` or `discord-bot-sdk`) that:

1. **Server structure creation** (run once on bot join):
   - Categories: `INFO`, `TRADE-UPS`, `COMMUNITY`, `SUPPORT`
   - Channels:
     - `#rules` (read-only) — auto-posts rules message on creation
     - `#faq` (read-only) — auto-posts FAQ from our FAQ page content
     - `#announcements` (read-only) — for us to post updates
     - `#getting-started` (read-only) — how to link Steam, subscribe, use the tool
     - `#trade-ups` (Basic + Pro) — general trade-up discussion
     - `#knife-alerts` (Pro only) — webhook alerts for high-profit knife discoveries
     - `#strategies` — open discussion on trade-up strategy
     - `#results` — users share their trade-up outcomes (screenshots, profit/loss)
     - `#support` — help channel
     - `#suggestions` — feature requests
   - Roles: `Free`, `Basic`, `Pro`, `Content Creator`, `Verified` (linked Steam account)
   - Permissions: Pro channels locked behind Pro role, Basic+ channels locked behind Basic role

2. **Account linking**:
   - `/link` command — OAuth flow linking Discord user to their Steam/TradeUpBot account
   - Auto-assigns role based on subscription tier
   - Role updates on subscription change (Stripe webhook → Discord API)

3. **Automated messages** (posted on server setup):
   - `#rules`: Code of conduct, no scamming, no trade-up sniping from other users' shared results
   - `#faq`: Embedded FAQ covering "What is TradeUpBot?", "How do trade-ups work?", "Free vs Basic vs Pro", "How do I verify/claim?"
   - `#getting-started`: Step-by-step with screenshots — sign in with Steam → browse trade-ups → verify → claim (Pro) → execute on marketplace

4. **Pro alerts** (daemon integration):
   - When daemon discovers a knife trade-up with >$50 profit and >30% chance-to-profit, post to `#knife-alerts`
   - Embed: profit, EV, chance-to-profit, input cost, outcome chart thumbnail
   - "Claim this trade-up" button links to the trade-up on the site
   - Configurable thresholds per user (stretch goal)

5. **Daily digest** (cron):
   - Top 5 trade-ups found today (by profit)
   - Stats: total discovered, total profitable, best knife, best gun
   - Posted to `#announcements`

### Community Strategy
- Invite link in site footer (already exists: `discord.gg/tradeupbot`)
- Prompt users to join Discord after first login
- Consider posting in TradeUpLab's Discord tastefully (comparison content, not spam)

---

## 2. Content Creator Partnerships

**Priority**: High (post-launch week 1-2)
**Effort**: Low (promo code system + outreach)
**Why**: CS2 YouTube/Twitch creators already make trade-up content. Give them a tool that's genuinely better, let the product speak for itself in their videos.

### One-Time-Use Lifetime Pro Codes

**How it works**:
- Generate single-use, non-transferable promo codes tied to a creator's identity
- Code grants **lifetime Pro plan** (100% off forever via Stripe coupon)
- Creator redeems at checkout — code is burned after use
- Each code is tied to a specific Steam ID after redemption (can't be shared/resold)

**Why lifetime, not monthly**:
- Removes friction — creator doesn't worry about cancelling or being billed
- They'll keep using the tool indefinitely, producing ongoing organic content
- Cost: $0 marginal (they're one user on existing infrastructure)

**Why NOT a paid sponsorship**:
- Creator has no obligation to say nice things → audience trusts it more
- "Not an ad" authenticity — they can criticize the tool if they want
- If the tool is genuinely useful, the video sells itself
- Much cheaper than paying for sponsored segments ($500-5K per video)

### Creator Targeting
- **Tier 1** (10-50K subs): CS2 trade-up focused creators — these are the sweet spot
  - Search YouTube: "cs2 trade up", "cs2 trade up contract", "profitable trade ups"
  - Look for creators who already use TradeUpLab or manual float calculators
- **Tier 2** (50-200K subs): General CS2 economy/skin creators
  - Broader reach but less targeted
- **Tier 3** (200K+ subs): Major CS2 creators
  - Long shot but massive impact if they try it

### Outreach Template
Keep it short and genuine:
> "Hey [name], we built TradeUpBot — it finds profitable CS2 trade-ups from real marketplace listings (not theoretical). Thought you might find it useful for content. Here's a lifetime Pro code if you want to try it: [CODE]. No strings attached, not a sponsorship. If it sucks, say so."

### Implementation
- Admin endpoint: `POST /api/admin/promo-codes` — generates a single-use Stripe coupon (100% off, forever, max 1 redemption)
- Track: code → creator name → Steam ID on redemption → videos produced (manual log)
- Dashboard: see which codes are redeemed, which creators are active users
- Start with 20-30 codes for initial outreach wave

---

## 3. SEO & Google Indexing

**Priority**: Ongoing
**Effort**: Low-Medium (content + technical tweaks)
**Why**: Long-tail CS2 trade-up searches have low competition. Blog posts can rank quickly and bring in free organic traffic indefinitely.

### Current SEO Assets (already deployed)
- 9 blog posts targeting key queries (float values, fees, probability, etc.)
- Meta tags, OG, Twitter Cards on all pages
- `sitemap.xml` with 13 URLs
- `robots.txt` (allow all, block /api and /auth)
- Google Search Console registered, indexing requested

### Improvements

#### Technical SEO
- [ ] **Structured data (JSON-LD)**: Add `SoftwareApplication` schema to landing page, `Article` schema to blog posts, `FAQPage` schema to FAQ page — helps Google show rich snippets
- [ ] **Canonical URLs**: Add `<link rel="canonical">` to all pages to prevent duplicate content issues
- [ ] **Dynamic sitemap**: Generate sitemap from blog post slugs automatically (currently static XML) — include `<lastmod>` dates
- [ ] **Page speed**: Lazy-load below-fold images on landing page, compress screenshots in `/public/`
- [ ] **Internal linking**: Blog posts should link to each other and to product pages (features, pricing) — improves crawl depth
- [ ] **Alt text**: Add descriptive alt text to all images (screenshots, charts)

#### Content SEO
- [ ] **Comparison post**: "TradeUpBot vs TradeUpLab" — target "tradeuplab alternative", "best cs2 trade up calculator", "cs2 trade up tool"
- [ ] **"Best trade-ups this week" weekly blog post** — fresh content signals to Google, targets long-tail queries like "best cs2 trade up march 2026"
- [ ] **Glossary page**: Define trade-up terms (float, wear, condition, EV, ROI) — targets informational queries, internal link magnet
- [ ] **Collection guides**: "Best skins in [Collection] for trade-ups" — one per major collection, target "[collection name] trade up" queries
- [ ] **"Is X skin worth trading up?" posts** — target specific skin name + trade up queries

#### Link Building
- [ ] Submit to CS2 tool directories and aggregator sites
- [ ] Get listed on Steam community guides
- [ ] Reddit posts linking to blog content (drives referral traffic + potential backlinks)
- [ ] Reach out to CS2 wiki/guide sites for inclusion

#### Monitoring
- Google Search Console: check weekly for indexing issues, track impressions/clicks by query
- Track which blog posts drive the most organic traffic → double down on those topics
- Monitor "cs2 trade up" keyword family rankings

---

## 4. Steam Name Referral Program

**Priority**: Medium (post-launch week 2-4)
**Effort**: Low
**Why**: Every CS2 game lobby shows your Steam name to 9 other players. Free viral distribution at zero cost.

### How It Works
- Users who add "tradeupbot.app" to their Steam display name get **free Basic tier**
- Verified automatically via Steam API (check display name periodically)
- If they remove it, revert to Free after 7 days grace period

### Implementation
- Cron job (hourly): check all opted-in users' Steam display names via Steam Web API
- Grant/revoke Basic tier based on name containing "tradeupbot.app"
- UI: "Get free Basic" banner with instructions on settings page
- Track: how many users are in the program, conversion from Free → paid after trying Basic features

### Why This Works
- CS2 players are competitive and social — they look at each other's names in lobbies
- "tradeupbot.app" is memorable and directly navigable
- Costs us nothing (Basic tier = just removes the 30-min delay)
- Self-selecting: users who care about trade-ups enough to change their name are ideal customers

---

## 5. Reddit & Social Media

**Priority**: High (post-launch immediately)
**Effort**: Low (15-30 min/day)
**Why**: r/csgo (2.3M), r/GlobalOffensiveTrade, r/cs2 — these communities actively discuss trade-ups and skin economics.

### Reddit Strategy
- **Daily "best trade-up found" posts**: Screenshot of a real profitable trade-up with real listings
  - "Found a $189 knife trade-up with 42% chance to profit — built from real CSFloat/DMarket listings"
  - Key differentiator: show REAL listings, not theoretical numbers
  - Link to relevant blog post in comments (not the main post — avoid looking spammy)
- **Comment on trade-up threads**: When people ask about trade-ups, provide genuinely helpful answers and mention the tool naturally
- **Weekly "results" thread**: Share aggregate stats — "This week we found X profitable trade-ups worth $Y total"
- **AMA / launch post**: "We built a CS2 trade-up finder that uses real marketplace listings — AMA"

### Twitter/X Strategy
- Daily automated post: best trade-up found (daemon → Twitter API)
- Engage with CS2 skin trading community
- Retweet/engage with content creators who use the tool

### Key Rules
- Never be spammy — provide genuine value in every post
- Don't trash competitors — just show what we do differently (real listings)
- Engage with comments, answer questions, be helpful
- Avoid posting the same content across multiple subreddits simultaneously

---

## 6. Shareable Trade-Up Pages

**Priority**: Medium (post-launch week 2-4)
**Effort**: Medium (product feature)
**Why**: Users who complete profitable trade-ups want to brag. Give them a beautiful shareable page that links back to us.

### Feature
- Each trade-up gets a unique public URL: `tradeupbot.app/trade-up/[id]`
- Shows: inputs, outputs, outcome probabilities, profit/loss, what they got
- OG meta tags for rich preview when shared on Discord/Reddit/Twitter
- "Find more trade-ups like this" CTA → landing page
- "Result" mode: after user completes the trade-up, they can log what they got → page shows actual result

### Distribution
- Users share wins on Reddit, Discord, Twitter naturally
- Each share is a free ad with a link back to the site
- Rich previews make shares visually appealing in social feeds

---

## 7. Early Adopter Pricing

**Priority**: Launch day
**Effort**: Low (Stripe coupon)
**Why**: Creates urgency and rewards first movers.

### Offers
- **First 100 Pro subscribers**: lifetime 50% off ($7.50/mo forever)
- **First 200 Basic subscribers**: lifetime 40% off ($3/mo forever)
- Stripe coupon with limited redemptions — counter shown on pricing page ("67 of 100 remaining")
- Creates urgency: "lock in this price before it's gone"

---

## 8. Free Tier Optimization

**Priority**: Pre-launch (blocking) and ongoing
**Effort**: Medium
**Why**: Free tier is the top of the funnel. If it's useless, nobody converts.

### Current Problem
Free tier shows 10 oldest/stalest trade-ups with 3-hour delay. These are often bad, giving a poor first impression.

### Improvements
- [ ] Curate free tier selection: show a mix across rarities and price ranges (some cheap, some expensive)
- [ ] Include at least 1-2 genuinely profitable ones so users see the tool works
- [ ] Show full outcome charts and probability analysis (tease the value)
- [ ] "This trade-up has 37% chance to profit — upgrade to see listings and claim it" upgrade prompt
- [ ] Track free-to-paid conversion rate to measure funnel effectiveness

---

## Implementation Priority & Timeline

### Week 1 (Launch)
1. Early adopter pricing (Stripe coupons) — launch day
2. Reddit launch post + daily posting begins
3. Discord server created manually (bot comes later)
4. Twitter/X account active, daily posts

### Week 2
5. Content creator outreach (20-30 lifetime Pro codes)
6. Discord bot v1 (server structure, roles, default messages)
7. Comparison blog post (vs TradeUpLab)

### Week 3-4
8. Steam name referral program
9. Discord bot v2 (account linking, Pro alerts)
10. Structured data / technical SEO improvements
11. Shareable trade-up pages

### Ongoing
- Daily Reddit/Twitter content
- Weekly blog post ("best trade-ups this week")
- Discord community management
- SEO monitoring and new content
- Content creator relationship maintenance

---

## Metrics to Track

| Metric | Tool | Target (Month 1) |
|--------|------|-------------------|
| Site visitors | Google Analytics / Search Console | 1,000+ |
| Steam logins | Internal DB | 200+ |
| Free → Basic conversion | Stripe + DB | 5-10% |
| Basic → Pro conversion | Stripe | 10-20% |
| Discord members | Discord | 100+ |
| Blog organic traffic | Search Console | 500+ sessions |
| Reddit post engagement | Manual | Avg 20+ upvotes |
| Creator codes redeemed | Internal tracking | 10+ |
| Promo code → video produced | Manual tracking | 3-5 videos |

---

## Cost Analysis

| Channel | Cost | Expected CAC |
|---------|------|-------------|
| Discord | Free (bot hosting on VPS) | $0 |
| Content creators | Free Pro plan (~$0 marginal) | $0 per creator |
| Reddit/Twitter | Time only (15-30 min/day) | $0 |
| SEO/Blog | Time only | $0 |
| Steam name referral | Free Basic (~$0 marginal) | $0 |
| Early adopter discounts | 50% revenue reduction on first 100 Pro | $7.50/mo foregone per user |

Total hard cost: **$0**. All acquisition channels are free or near-free. The only "cost" is discounted revenue from early adopter pricing and creator codes, which is marginal since infrastructure costs are fixed.
