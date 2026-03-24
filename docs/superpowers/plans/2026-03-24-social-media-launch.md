# Social Media Launch — Implementation Plan

> **For agentic workers:** This is a content production plan, not a code project. Tasks produce content deliverables (posts, scripts, templates, video editing commands). Execute tasks in order — later tasks depend on earlier ones.

**Goal:** Execute Week 0 prep and produce all Week 1 content for TradeUpBot's social media launch across Reddit, YouTube, TikTok, X, Instagram, and Discord.

**Architecture:** Claude drafts all text content and scripts. Tim records video (screen capture + mic). Claude edits video via ffmpeg/ImageMagick. Tim posts from own accounts. Content follows three pillars: Myth-Busting (40%), Daily Alpha (35%), Education (25%).

**Spec:** `docs/superpowers/specs/2026-03-24-social-media-plan-design.md`

**Brand voice:** Analytical truth-teller. Confident and direct. "Here's what actually happens." No hype, no filler. Show the receipts.

**Product reference:** TradeUpBot (tradeupbot.app) — CS2 trade-up contract analyzer using real marketplace listings from CSFloat, DMarket, Skinport. Key differentiator: real listings vs theoretical calculators. Features: automated discovery, verify availability, claim to lock listings.

---

## Task 1: Account & Channel Setup (Tim — manual)

This is a checklist for Tim. Claude cannot create accounts.

- [ ] **Step 1: Create X/Twitter account**
  - Handle: @tradeupbot (or @tradeupbot_app if taken)
  - Display name: TradeUpBot
  - Bio: "CS2 trade-ups from real listings. No theory. Real prices, real floats, real outcomes."
  - Link: tradeupbot.app
  - Profile image: use site favicon/logo

- [ ] **Step 2: Create TikTok account**
  - Handle: @tradeupbot
  - Bio: "CS2 trade-ups that actually work. Real listings, not theory."
  - Link: tradeupbot.app

- [ ] **Step 3: Create Instagram account**
  - Handle: @tradeupbot
  - Bio: "CS2 trade-ups from real marketplace listings. No theory."
  - Link: tradeupbot.app

- [ ] **Step 4: Create YouTube channel**
  - Channel name: TradeUpBot
  - Handle: @tradeupbot
  - About: "Finding profitable CS2 trade-up contracts using real marketplace listings from CSFloat, DMarket, and Skinport. Every trade-up on this channel uses actual buyable listings with exact floats and exact prices — not theoretical averages."
  - Link: tradeupbot.app
  - Channel art: will be created in Task 2

- [ ] **Step 5: Set up Discord server**
  - Channels: #general, #daily-alpha, #trade-up-help, #announcements
  - Roles: Free, Basic, Pro (mirror subscription tiers)
  - Invite link: update footer on tradeupbot.app if different from current discord.gg/tradeupbot
  - Welcome message: "Welcome to TradeUpBot — CS2 trade-ups built from real listings. Check #daily-alpha for today's best finds."

- [ ] **Step 6: Cross-link all accounts**
  - Add Discord invite link to all bios
  - Add YouTube link to X and TikTok bios
  - Ensure tradeupbot.app links to all social accounts in footer

---

## Task 2: Video Production Conventions

**Files:**
- Create: `content/README.md` (production guide)

- [ ] **Step 1: Create directory structure**

```bash
mkdir -p content/{raw,edited/{youtube,tiktok,shorts,reels},thumbnails,screenshots}
```

Directories:
- `content/raw/` — Tim drops raw recordings here
- `content/edited/youtube/` — Final YouTube cuts (1920x1080)
- `content/edited/tiktok/` — Final TikTok clips (1080x1920)
- `content/edited/shorts/` — YouTube Shorts (1080x1920, cross-posted from TikTok)
- `content/edited/reels/` — Instagram Reels (1080x1920, reformatted from TikTok)
- `content/thumbnails/` — YouTube thumbnails (1280x720)
- `content/screenshots/` — TradeUpBot screenshots for posts

- [ ] **Step 2: Create production guide**

Write `content/README.md` with:
- Resolution specs: YouTube 1920x1080 30fps, TikTok/Shorts/Reels 1080x1920 30fps, Thumbnails 1280x720
- Recording settings: OBS recommended, MP4 format, screen capture at native resolution
- Naming convention: `YYYY-MM-DD-platform-title.mp4` (e.g., `2026-03-30-youtube-why-calculators-wrong.mp4`)
- Thumbnail template: dark background (#1a1a2e), bold white text (top), trade-up screenshot (center), red/green profit indicator (bottom-right corner), TradeUpBot logo watermark (bottom-left)
- Text overlay style: white text, semi-transparent dark background pill, positioned bottom-center for captions, top-center for stats callouts

- [ ] **Step 3: Create thumbnail template script**

Write a shell script `content/make-thumbnail.sh` that uses ImageMagick to generate thumbnails:
- Input: screenshot image path, title text, profit amount, profit/loss flag
- Output: 1280x720 thumbnail with dark gradient background, bold title, screenshot overlay, colored profit badge
- Font: system bold sans-serif (Helvetica Bold or similar)

- [ ] **Step 4: Create YouTube channel banner**

Use ImageMagick to generate a 2560x1440 YouTube banner:
- Background: dark gradient (#1a1a2e to #0d0d1a)
- Center text: "TradeUpBot" (large, bold white)
- Subtitle: "CS2 Trade-Ups From Real Listings" (smaller, #a0a0b0)
- Bottom text: "New video every Thursday" (small, #707080)
- Safe area: keep key content within 1546x423 center (visible on all devices)

```bash
convert -size 2560x1440 gradient:"#1a1a2e-#0d0d1a" \
  -font Helvetica-Bold -pointsize 120 -fill white -gravity center -annotate +0-100 "TradeUpBot" \
  -pointsize 48 -fill "#a0a0b0" -annotate +0+50 "CS2 Trade-Ups From Real Listings" \
  -pointsize 32 -fill "#707080" -annotate +0+150 "New video every Thursday" \
  content/thumbnails/youtube-banner.png
```

- [ ] **Step 5: Add content/ to .gitignore**

Raw footage and edited video should not be in git. Add `content/raw/`, `content/edited/`, `content/thumbnails/`, `content/screenshots/` to `.gitignore`. Keep `content/README.md` and `content/make-thumbnail.sh` tracked.

---

## Task 3: Draft Week 1 Reddit Posts

**Files:**
- Create: `content/week1/reddit-myth-bust.md`
- Create: `content/week1/reddit-education.md`
- Create: `content/week1/reddit-daily-alpha.md`

All three posts need real trade-up data from the live site. Pull examples before drafting.

- [ ] **Step 1: Pull real trade-up examples from TradeUpBot**

Query the local API to find real examples:

```bash
# Get profitable trade-ups sorted by ROI
curl -s "http://localhost:3001/api/trade-ups?sort=roi&order=desc&minChance=50&limit=20" | jq '.[0:5]'

# Get trade-ups with missing inputs (partial/stale status)
curl -s "http://localhost:3001/api/trade-ups?sort=profit&order=desc&limit=50" | jq '[.[] | select(.missing_inputs > 0)] | .[0:5]'

# Get trade-ups where condition boundary matters (look for outputs near FN/MW boundary)
curl -s "http://localhost:3001/api/trade-ups?sort=profit&order=desc&type=classified_covert&limit=20" | jq '.'
```

Find:
1. A trade-up with missing/repriced inputs showing the theory-vs-reality gap (for myth-bust)
2. A genuinely profitable trade-up with good ROI and probability (for daily alpha)
3. A trade-up near a condition boundary where float precision matters (for education)

Save screenshots to `content/screenshots/week1/`. Use the real data in the posts below — replace all bracketed placeholders with actual skin names, prices, and numbers.

- [ ] **Step 2: Draft myth-bust post (Monday)**

Target: r/cs2 (cross-post to r/GlobalOffensiveTrade)

Write the full post text (400-800 words). **Do NOT mention TradeUpBot anywhere.** Pure value — let people ask in comments.

```markdown
Title: I found a "[X]% ROI" trade-up on a calculator. Then I tried to actually buy the inputs.

---

I've been doing CS2 trade-ups for a while now, and I keep running into
the same problem: the calculators lie. Not intentionally — they just
show you a version of reality that doesn't exist.

Here's what happened yesterday.

**The theory**

I found a [collection name] trade-up on [calculator]. [X] [skin name]
inputs at an average of $[X.XX] each. Total cost: $[XX.XX]. Expected
output: [output skin name] in [condition], worth $[XX.XX]. That's
$[XX.XX] profit — [X]% ROI with a [X]% chance to profit.

Looked great. So I went to actually buy the inputs.

**The reality**

Input 1: [skin name]. The calculator says $[X.XX]. Cheapest listing on
CSFloat? $[X.XX]. That's [X]% more than the "average" price. Fine,
I'll eat the difference.

Input 2-3: Same story. Real listings are $[X.XX] and $[X.XX] — both
above the average the calculator assumed.

Input 4: This is where it gets ugly. The calculator assumes a float of
[0.0XXX]. The cheapest listing at that float? Doesn't exist. The next
closest float is [0.0XXX], and it costs $[X.XX] more. Worse — that
float pushes my output past the [FN/MW] boundary, so now my output is
[MW/FT] instead of [FN/MW].

Input 5: Sold. Gone. While I was shopping for the first four inputs,
someone bought it.

I'm halfway through and my real cost is already $[XX.XX] vs the
calculator's $[XX.XX]. And my output condition just changed, which
drops the expected value from $[XX.XX] to $[XX.XX].

**The math**

| | Calculator | Reality |
|---|---|---|
| Total input cost | $[XX.XX] | $[XX.XX] |
| Output condition | [FN] | [MW] |
| Expected output value | $[XX.XX] | $[XX.XX] |
| Expected profit | +$[XX.XX] | -$[XX.XX] |
| ROI | +[X]% | -[X]% |

Three things killed the profit:
1. **Real prices > average prices.** Steam Market averages include old
   sales at prices that don't exist anymore.
2. **Float values matter enormously.** The specific float you can
   actually buy determines whether you cross a condition boundary.
3. **Listings disappear.** By the time you find 10 inputs manually,
   some have sold.

**The takeaway**

If a trade-up calculator doesn't show you actual buyable listings with
exact floats and exact prices, the profit number it shows is fiction.
The gap between theoretical profit and executable profit is usually the
entire margin.

Next time you see a "profitable" trade-up, try to actually buy the
inputs before you get excited. You might be surprised.
```

- [ ] **Step 3: Draft education post (Wednesday)**

Target: r/cs2

Write the full post text (600-1200 words).

```markdown
Title: Why a 0.069 float is worth 3x more than a 0.071 — CS2 condition
boundaries explained

---

If you've ever looked at two listings of the same skin — almost
identical float values — and seen wildly different prices, this is why.

**Condition boundaries**

Every CS2 skin has a float value between 0.00 and 1.00. This float
determines the skin's condition:

| Condition | Float Range |
|---|---|
| Factory New (FN) | 0.00 – 0.07 |
| Minimal Wear (MW) | 0.07 – 0.15 |
| Field-Tested (FT) | 0.15 – 0.38 |
| Well-Worn (WW) | 0.38 – 0.45 |
| Battle-Scarred (BS) | 0.45 – 1.00 |

A skin with float 0.069 is Factory New. A skin with float 0.071 is
Minimal Wear. The visual difference is nearly invisible, but the price
difference can be massive.

For example, [skin name]:
- Factory New (0.069): ~$[XXX]
- Minimal Wear (0.071): ~$[XX]

That's [X]x the price for 0.002 of float difference. All because of
that 0.07 boundary.

**Why this matters for trade-ups**

In a CS2 trade-up contract, the output float is calculated from your
input floats using this formula:

```
output_float = (average_input_float × (max - min)) + min
```

Where max and min are the float range of the output skin. This means
the output float is **deterministic** — it's not random. If you know
your input floats, you know exactly what output float you'll get.

This is where condition boundaries become critical. Let's say you're
building a trade-up where the output is [skin name], which has a float
range of [X.XX] to [X.XX].

If your average input float is [0.XXXX], your output lands at [0.069X]
— Factory New. Worth $[XXX].

If your average input float is [0.XXXX] (just slightly higher), your
output lands at [0.071X] — Minimal Wear. Worth $[XX].

Same collection. Same 10 inputs. Same cost. But one specific input
listing had a slightly higher float, and it pushed your output past the
boundary. That's the difference between a $[XX] profit and a $[XX]
loss.

**Why most calculators get this wrong**

Most trade-up calculators use "average" prices and don't check which
specific float-value listings are actually for sale. They might show
you that [skin name] inputs cost $[X.XX] on average — but the listings
available right now at the float you need might cost $[X.XX] more.

Worse, they don't tell you whether a listing even exists at the float
that makes your output cross the right boundary. You could plan a
perfect Factory New trade-up, go to buy the inputs, and discover that
the floats available push your output to 0.071 — Minimal Wear — and
your profit evaporates.

**The practical takeaway**

When evaluating any trade-up:
1. Check the output float calculation, not just the probability
2. Verify that listings actually exist at the input floats you need
3. Calculate what happens if you have to use a slightly different float
4. Pay attention to how close your output is to a condition boundary

Tools that source from real listings (like TradeUpBot) test specific
float targets near these boundaries to find the exact crossing points.
That's the only way to know whether a trade-up actually works before
you commit money.

The difference between theory and execution in CS2 trade-ups is almost
always about floats. The math is simple — the hard part is finding the
right listings.
```

- [ ] **Step 4: Draft daily alpha post (Thursday)**

Target: r/GlobalOffensiveTrade

This post uses real data from Step 1 — fill in from the actual profitable trade-up found.

```markdown
Title: Today's best real-listing trade-up: [Skin Name] — [X]% ROI,
[X]% chance to profit

---

Found this one today — all inputs are real listings you can buy right
now.

**The trade-up:**
- Collection: [Collection Name]
- Type: [Classified → Covert / etc.]
- Total cost: $[XX.XX] (10 inputs)
- Expected profit: $[XX.XX] ([X]% ROI)
- Chance to profit: [X]%
- Best case: +$[XXX.XX]
- Worst case: -$[XX.XX]

**Inputs:**
[List each input: skin name, float, price, source marketplace]

**Possible outcomes:**
[List outcomes with probabilities]

All [10] inputs verified as available on [CSFloat/DMarket/Skinport] as
of [time].

Direct links to each listing are on the trade-up page:
[tradeupbot.app/trade-ups/ID]

[screenshot of the expanded trade-up view]
```

This is the first post that explicitly shows TradeUpBot — framed as sharing a find, not selling.

---

## Task 4: Draft Week 1 YouTube Script — "Why Every CS2 Trade-Up Calculator Is Wrong"

**Files:**
- Create: `content/week1/youtube-script-calculators-wrong.md`

This is the manifesto video. Sets the entire narrative for the channel.

- [ ] **Step 1: Write the full script**

Target length: 10-12 minutes when spoken. ~1500-1800 words of voiceover.

```
SCRIPT STRUCTURE:

[HOOK — 0:00-0:30]
(Screen: a "profitable" trade-up on a theoretical calculator showing 85% ROI)

"This trade-up claims 85% profit. I'm going to try to actually buy the
inputs and execute it. Spoiler: it doesn't go the way the calculator says."

[THE SETUP — 0:30-2:30]
(Screen: show the theoretical trade-up in detail)

Walk through the trade-up: what skin, what collection, what the calculator
says about inputs, outputs, probability, and expected profit. Use a real
competitor tool or a theoretical example. Be specific with numbers.

"Looks great on paper. 10 inputs at an average of $X each, total cost $XX.
Expected output worth $XX. That's $XX profit with a YY% chance."

"One problem. These aren't real listings. These are average prices. Let's
see what happens when I try to buy them."

[THE SOURCING ATTEMPT — 2:30-7:00]
(Screen: CSFloat/DMarket marketplace, then TradeUpBot)

Go skin by skin through the 10 inputs. Show what happens:
- Input 1-3: Can find listings, but they cost 10-20% more than the
  "average" price the calculator assumed
- Input 4-5: The specific float needed doesn't exist as a listing. The
  cheapest listing at this float is $X more expensive.
- Input 6-7: Listing sold while you were shopping for the others
- Input 8-10: Available but at different floats — which changes the
  output float calculation

Running tally on screen: show the theoretical cost vs actual cost
accumulating.

"So the calculator said $XX total. I'm at $XX and I'm only 7 inputs in.
And two of my inputs have floats that push me past the MW boundary, so
my output is now Minimal Wear instead of Factory New."

[THE MATH — 7:00-9:30]
(Screen: side-by-side comparison)

Left side: the theoretical trade-up (what the calculator promised)
Right side: the real trade-up (what I can actually buy)

Compare:
- Total cost: theoretical vs actual
- Output condition: FN (theoretical) vs MW (actual) — massive price difference
- Expected profit: theoretical vs actual
- ROI: theoretical vs actual

"The calculator said $XX profit. Reality? I'm actually LOSING $XX. The
entire profit margin was eaten by three things: real prices being higher
than averages, wrong floats changing the output condition, and listings
disappearing while I was shopping."

[WHY THIS HAPPENS — 9:30-11:00]
(Screen: TradeUpBot showing the same type of trade-up with real listings)

Explain the three fundamental problems:
1. Average prices ≠ available prices. Steam Market averages include
   historical sales at prices that no longer exist.
2. Float values matter enormously. A theoretical calculator doesn't
   check which float-value listings are actually for sale.
3. Availability is fleeting. By the time you find 10 inputs manually,
   the first ones may have sold.

"This is why I built TradeUpBot. It only shows trade-ups built from
actual listings that exist right now — with exact prices, exact floats,
and verified availability."

(Screen: brief tour of TradeUpBot — show the table, expand a trade-up,
show the inputs with marketplace links, the outcome chart)

Keep this to 60 seconds. Don't do a full tutorial — that's a separate video.

[CTA — 11:00-11:30]
"If you want to find trade-ups that actually work with real listings,
check out tradeupbot.app — link in the description. It's free to browse
every trade-up. And if you want to go deeper, I break down a new
profitable trade-up every week on this channel."
```

- [ ] **Step 2: Write video metadata**

```
Title: Why Every CS2 Trade-Up Calculator Is Wrong (Real Listings vs Theory)
Description:
CS2 trade-up calculators show you profitable contracts — but can you
actually buy the inputs? I tested a "85% ROI" trade-up and tried to
source real listings. Here's what happened.

🔗 TradeUpBot (free): https://tradeupbot.app
📊 Find trade-ups from real CSFloat, DMarket, and Skinport listings

Chapters:
0:00 The "profitable" trade-up
0:30 What the calculator says
2:30 Trying to buy real inputs
7:00 Theory vs reality comparison
9:30 Why this always happens
11:00 How to find trade-ups that actually work

#cs2 #tradeup #csgo #cs2skins #tradeupcontract

Tags: cs2 trade up, cs2 trade up calculator, cs2 trade up profit,
trade up contract cs2, csgo trade up, cs2 float values, tradeupbot

Pinned comment:
Every trade-up in this video uses real marketplace data. If you want to
find profitable trade-ups from actual listings (not theory), check out
TradeUpBot — it's free to browse: https://tradeupbot.app
```

- [ ] **Step 3: Write recording instructions for Tim**

```
RECORDING NOTES:

Total recording time: ~20-25 minutes (will be cut to 10-12)

Screens to capture:
1. A theoretical calculator showing a "profitable" trade-up (use any
   free calculator — Pricempire, CSDelta, CSFloat calculator)
2. CSFloat and/or DMarket marketplace — searching for the specific
   inputs from that trade-up
3. TradeUpBot showing a real trade-up with the same skins/collection
4. TradeUpBot table view, expanded trade-up view, outcome chart

Recording flow:
- Start with the theoretical calculator open, walk through the trade-up
- Switch to marketplace, try buying inputs, react to price differences
- Switch to TradeUpBot, show the real version
- Do the side-by-side comparison (can use two browser windows)

Voice tone: conversational, analytical, slightly incredulous when
numbers don't match. Not angry, not hype — "well, that's interesting..."

Don't worry about mistakes, pauses, or restarts. I'll cut everything
in edit. Just keep recording and redo sections if needed.
```

---

## Task 5: Draft Week 1 TikTok Scripts

**Files:**
- Create: `content/week1/tiktok-scripts.md`

4 clips total: 3 standalone (recorded Sunday) + 1 cut from YouTube (Friday). Note: the spec says 2 from YouTube / 2 standalone, but Week 1 only has one YouTube video to pull from. Week 2+ will hit steady-state ratio once there are more YouTube videos to clip.

Scripts numbered by posting order (Mon=1, Tue=2, Wed=3, Fri=4).

- [ ] **Step 1: Write TikTok Script 1 — Quick Myth-Bust (Monday)**

```
TIKTOK #1: "This Trade-Up Is a TRAP" (30-40s)
Standalone recording.

[TEXT ON SCREEN FROM FRAME 1]: "This trade-up claims 65% profit"

(Screen: theoretical calculator showing profitable trade-up)
VOICEOVER: "This trade-up says sixty-five percent profit. Looks amazing.
But watch what happens when I try to actually buy the inputs."

[TEXT ON SCREEN]: "Reality check"

(Screen: marketplace showing higher prices / missing listings)
VOICEOVER: "Input one — eight dollars more than the calculator says.
Input four — doesn't exist at that float. Input seven — already sold."

[TEXT ON SCREEN]: "65% profit → -12% loss"

VOICEOVER: "That sixty-five percent profit? Negative twelve percent.
This is why you need real listings, not theory."

[END CARD / TEXT]: "tradeupbot.app — trade-ups from real listings"

Hashtags: #cs2 #tradeup #csgo #cs2skins #profit #fyp
```

- [ ] **Step 2: Write TikTok Script 2 — Education Bite (Tuesday)**

```
TIKTOK #2: "Why 0.069 Is Worth 3x More Than 0.071" (30s)
Standalone recording.

[TEXT ON SCREEN FROM FRAME 1]: "0.069 vs 0.071 = 3x price difference"

(Screen: TradeUpBot or marketplace showing two listings of the same skin)
VOICEOVER: "Same skin. Almost the same float. But this one is worth
three times more. Why?"

[TEXT ON SCREEN]: "Factory New: 0.00 - 0.07 | Minimal Wear: 0.07 - 0.15"

VOICEOVER: "Point zero six nine is Factory New. Point zero seven one is
Minimal Wear. That tiny difference? Hundreds of dollars."

[TEXT ON SCREEN]: "This is why exact floats matter in trade-ups"

VOICEOVER: "In trade-ups, your input floats determine your output float.
Get it wrong by point zero zero two and your profit disappears."

Hashtags: #cs2 #tradeup #csgo #floatvalue #cs2skins #fyp
```

- [ ] **Step 3: Write TikTok Script 3 — Daily Alpha (Wednesday)**

```
TIKTOK #3: "I Found This $XX Profit Trade-Up" (30-45s)
Standalone recording.

[TEXT ON SCREEN FROM FRAME 1]: "$XX profit | XX% ROI"

(Screen: TradeUpBot showing a profitable trade-up, scrolling through)
VOICEOVER: "Here's today's best trade-up. [Skin name] collection.
Ten inputs, total cost [amount]. [X] percent chance to profit."

(Screen: expand trade-up, show outcomes)
VOICEOVER: "Best case you're up [amount]. Worst case you lose [amount].
Expected profit [amount] — that's [X] percent ROI."

[TEXT ON SCREEN]: "All inputs verified ✓"

VOICEOVER: "Every single input is a real listing you can buy right now
on [marketplace]. Not theory."

[END CARD]: "Link in bio — tradeupbot.app"

Hashtags: #cs2 #tradeup #csgo #profit #cs2skins #fyp
```

- [ ] **Step 4: Note for TikTok #4 (Friday)**

TikTok #4 is cut from the YouTube video (Task 4). Will be produced during the video editing phase — pull the most surprising 30-45 second segment from the myth-bust comparison section (the moment theory meets reality). Add text overlays in edit.

---

## Task 6: Draft Week 1 X Posts

**Files:**
- Create: `content/week1/x-posts.md`

7 daily alpha posts + 1 thread (Monday, adapted from Reddit myth-bust).

- [ ] **Step 1: Write 7 daily alpha post drafts**

Each follows the template from the spec. These need real trade-up data — pull the day's best find from the site each day. Write 7 template-ready drafts with placeholder data that Tim fills in each morning (takes 2 minutes).

```
X POST TEMPLATE (copy daily, fill in brackets):

Today's best real-listing trade-up:

[Skin Name] | [Collection]
Input cost: $[XX.XX]
Expected profit: $[XX.XX] ([XX]% ROI)
Chance to profit: [XX]%
All [10] listings verified on [CSFloat/DMarket/Skinport]

[attach screenshot from TradeUpBot]

tradeupbot.app
```

Also draft 2-3 commentary-style posts Tim can use opportunistically:

```
COMMENTARY POST 1:
"The gap between a 'profitable' trade-up on paper and one you can
actually execute is usually the entire profit margin. Real prices > averages."

COMMENTARY POST 2:
"Biggest misconception in CS2 trade-ups: that the average price of a skin
is what you'll pay. You won't. You'll pay whatever the cheapest listing
at the float you need costs. Usually more."

COMMENTARY POST 3:
"Built TradeUpBot because I was tired of finding 'profitable' trade-ups
that fell apart the second I tried to buy the inputs. Every trade-up on
the site uses real listings you can purchase right now."
```

- [ ] **Step 2: Write the Monday thread (adapted from Reddit myth-bust)**

```
X THREAD (Monday — companion to Reddit myth-bust):

1/ I found a "65% ROI" trade-up on a calculator.

Then I tried to actually buy the inputs. Here's what happened. 🧵

2/ The calculator says: 10 inputs at ~$X each = $XX total cost.
Expected output: $XX. That's $XX profit.

Sounds great. Let's try to buy them.

3/ Problem 1: The "average price" inputs don't exist at that price.
Real listings are 10-20% higher.

Running total: $XX → $XX already.

4/ Problem 2: Two inputs need specific floats near 0.07 to hit
Factory New output. Cheapest listings at those floats? $X more each.

5/ Problem 3: By the time I found input 7, inputs 2 and 3 had sold.
Back to square one.

6/ Final result:
Calculator said: +$XX profit (65% ROI)
Reality: -$XX loss (-12% ROI)

The entire margin was eaten by:
- Real prices > averages
- Wrong floats = wrong output condition
- Listings disappearing

7/ This is why I built @tradeupbot — it only shows trade-ups from
actual marketplace listings with exact prices and verified availability.

Free to browse: tradeupbot.app
```

---

## Task 7: YouTube Video Editing Workflow

**Files:**
- Create: `content/edit-youtube.sh`

This task defines the ffmpeg commands Claude will use to edit Tim's raw footage.

- [ ] **Step 1: Write the YouTube editing script**

```bash
#!/bin/bash
# edit-youtube.sh — YouTube video editing workflow
# Usage: ./edit-youtube.sh <raw-video.mp4> <output-name>

RAW=$1
OUTPUT=$2
EDITED_DIR="content/edited/youtube"

# Step 1: Extract segments (Tim marks timestamps after recording)
# Cut segments and concatenate (example — actual timestamps filled per video)
# ffmpeg -i "$RAW" -ss 00:00:05 -to 00:02:30 -c copy "${EDITED_DIR}/seg1.mp4"
# ffmpeg -i "$RAW" -ss 00:03:00 -to 00:07:45 -c copy "${EDITED_DIR}/seg2.mp4"

# Step 2: Concatenate segments
# Create concat list, then:
# ffmpeg -f concat -safe 0 -i segments.txt -c copy "${EDITED_DIR}/${OUTPUT}-joined.mp4"

# Step 3: Add text overlays for key stats
# ffmpeg -i input.mp4 -vf "drawtext=text='65% ROI → -12% Loss':fontsize=48:fontcolor=white:borderw=3:bordercolor=black:x=(w-text_w)/2:y=50:enable='between(t,420,435)'" output.mp4

# Step 4: Scale to 1920x1080 if needed
# ffmpeg -i input.mp4 -vf "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2" -c:a copy output.mp4

echo "Edit workflow: adjust timestamps per video, then run ffmpeg commands above"
```

- [ ] **Step 2: Write the TikTok clip extraction script**

```bash
#!/bin/bash
# extract-tiktok-clip.sh — Pull a clip from YouTube raw footage
# Usage: ./extract-tiktok-clip.sh <raw-video.mp4> <start-time> <duration> <output-name>

RAW=$1
START=$2
DURATION=$3
OUTPUT=$4

# Extract clip
ffmpeg -i "$RAW" -ss "$START" -t "$DURATION" -c copy "content/edited/tiktok/temp-${OUTPUT}.mp4"

# Convert to vertical (1080x1920) — crop center of 1920x1080 to 608x1080, then scale up
# For screen-capture content, keep horizontal but add bars
ffmpeg -i "content/edited/tiktok/temp-${OUTPUT}.mp4" \
  -vf "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=0x1a1a2e" \
  -c:a copy "content/edited/tiktok/${OUTPUT}.mp4"

# Copy to Shorts and Reels (same format)
cp "content/edited/tiktok/${OUTPUT}.mp4" "content/edited/shorts/${OUTPUT}.mp4"
cp "content/edited/tiktok/${OUTPUT}.mp4" "content/edited/reels/${OUTPUT}.mp4"

rm "content/edited/tiktok/temp-${OUTPUT}.mp4"
echo "Clip saved to tiktok/, shorts/, reels/"
```

---

## Task 8: Week 1 Posting Checklist

**Files:**
- Create: `content/week1/posting-checklist.md`

A day-by-day checklist Tim follows to post content.

- [ ] **Step 1: Write the checklist**

```markdown
# Week 1 Posting Checklist

## Monday (Launch Day)
- [ ] Post #announcements in Discord: "TradeUpBot is live! We find profitable CS2 trade-ups from real marketplace listings. Browse every trade-up for free at tradeupbot.app. Check #daily-alpha for today's best find."
- [ ] Post Discord #daily-alpha: copy today's X daily alpha post
- [ ] Post Reddit myth-bust to r/cs2 (content/week1/reddit-myth-bust.md)
- [ ] Post TikTok #1 — "This Trade-Up Is a TRAP" (content/edited/tiktok/)
- [ ] Cross-post TikTok #1 to YouTube Shorts
- [ ] Post X daily alpha (fill in template from today's best trade-up)
- [ ] Post X thread (content/week1/x-posts.md — thread section)
- [ ] Monitor Reddit post — engage every comment within 2 hours
- [ ] Verify Discord invite link works in all platform bios

## Tuesday
*No Reddit post today — Week 1 reduced cadence (3 posts, not steady-state 4). Tuesday Reddit slot starts Week 2.*
- [ ] Post TikTok #2 — education bite "0.069 vs 0.071" (content/edited/tiktok/)
- [ ] Cross-post TikTok #2 to YouTube Shorts
- [ ] Post X daily alpha
- [ ] Repost Monday TikTok as Instagram Reel
- [ ] Post Discord #daily-alpha: copy today's X daily alpha

## Wednesday
- [ ] Post Reddit education post to r/cs2 (content/week1/reddit-education.md)
- [ ] Post TikTok #3 — daily alpha clip (content/edited/tiktok/)
- [ ] Cross-post TikTok #3 to YouTube Shorts
- [ ] Post X daily alpha
- [ ] Post Discord #daily-alpha: copy today's X daily alpha

## Thursday
- [ ] Upload YouTube video (content/edited/youtube/)
  - Title, description, tags from content/week1/youtube-script-calculators-wrong.md
  - Add thumbnail from content/thumbnails/
  - Set chapters in description
  - Pin comment with summary + link
- [ ] Post Reddit daily alpha to r/GlobalOffensiveTrade (content/week1/reddit-daily-alpha.md)
- [ ] Post X daily alpha + link to YouTube video
- [ ] Repost Wednesday TikTok as Instagram Reel
- [ ] Post Discord #daily-alpha: copy today's X daily alpha + YouTube link

## Friday
- [ ] Post TikTok #4 — clip from YouTube video (content/edited/tiktok/)
- [ ] Cross-post TikTok #4 to YouTube Shorts
- [ ] Post X daily alpha
- [ ] Post Discord #daily-alpha: copy today's X daily alpha
- [ ] Spend 30 min engaging in r/cs2 and r/GlobalOffensiveTrade comments (not your own posts — genuine help on trade-up questions)

## Saturday
- [ ] Post X daily alpha
- [ ] Post Discord #daily-alpha: copy today's X daily alpha
- [ ] Create Instagram carousel — week's best 3-5 trade-ups
  - 5 slides: slide 1 = "This Week's Best Trade-Ups" title card, slides 2-5 = one trade-up each (screenshot + overlay with skin name, ROI, chance to profit)
  - Use ImageMagick or Canva to assemble — 1080x1350 per slide

## Sunday
- [ ] Post X daily alpha
- [ ] Post Discord #daily-alpha: copy today's X daily alpha
- [ ] Review Week 1 metrics:
  - Reddit: upvotes + comment counts per post
  - YouTube: views, watch time, retention curve
  - TikTok: views per clip
  - X: impressions + engagements per post
  - Discord: new member count
  - Site: check referrer traffic (any social sources?)
- [ ] Record Week 2 content (scripts provided by Claude)
```
