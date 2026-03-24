# YouTube Script — "Why Every CS2 Trade-Up Calculator Is Wrong"

**Week 1 manifesto video. Sets the channel narrative.**
**Target length:** 10-12 minutes spoken (~1500-1800 words voiceover)
**Upload:** Thursday
**Data source:** Production trade-ups and real price observations from DMarket/CSFloat/Skinport.

---

## Script

### HOOK (0:00–0:30)

*(Screen: a theoretical calculator showing a Restricted → Classified trade-up with ~40% ROI)*

"This trade-up claims forty percent profit. Twenty-five bucks in, eighty percent chance at an AWP The End worth forty-one dollars. I'm going to try to actually buy the inputs and execute it."

*(pause)*

"The real ROI? Not forty percent. And there's a twenty percent chance the calculator didn't tell you about."

---

### THE SETUP (0:30–2:30)

*(Screen: walk through the theoretical trade-up in detail)*

"Here's what the calculator shows. A Restricted to Classified trade-up from the Achroma and Dreams & Nightmares collections. Eight Glock-18 Trace Locks at about three dollars each, plus two XM1014 Zombie Offensives at seventy cents. Total cost: about twenty-five dollars."

*(Screen: show the output prediction)*

"The output? Eighty percent chance at AWP The End in Field-Tested. That skin sells for about forty-one bucks. So the calculator says: twenty-five in, forty-one out, eighty percent of the time. Forty percent ROI."

"Sounds like free money. Let's go buy the inputs."

---

### THE SOURCING ATTEMPT (2:30–6:00)

*(Screen: switch to DMarket marketplace)*

"Alright, Glock-18 Trace Lock, Field-Tested. Calculator says three dollars. Let's see what's actually for sale."

*(Screen: DMarket listings for Glock-18 Trace Lock)*

"First listing — two ninety-six. Okay, actually below average. Second one — three sixty-nine. Wait, that's twenty-three percent more. Third — three-oh-one."

*(Show on-screen running tally)*

"Now here's why that three sixty-nine listing matters. The Trace Lock has a massive price swing across conditions. Look at this:"

*(Screen: show price comparison)*

"Factory New Trace Lock: twenty-six dollars average. Minimal Wear: eight sixty-three. Field-Tested: three seventy-two. The calculator used the FT average of three-seventy-two, but the specific float I need costs more because lower floats within FT are rarer."

*(Continue through remaining inputs)*

"The XM1014 Zombie Offensives are straightforward — seventy-six cents each. My total comes out to twenty-six oh-two."

"Pretty close to the calculator's estimate, right? Dollar sixty-two over. But the cost isn't the real problem."

---

### THE HIDDEN RISK (6:00–8:00)

*(Screen: show the full outcome table)*

"The calculator said forty percent ROI. But look at what it didn't emphasize — the other twenty percent."

*(Screen: outcome breakdown)*

"Eighty percent of the time, I get AWP The End at thirty-nine ninety. That's a profit of thirteen eighty-eight. Great."

"But six-point-seven percent of the time, I get a Dual Berettas Melondrama worth six-eighty. That's a loss of nineteen twenty-two on a twenty-six dollar bet."

"Same odds for FAMAS Rapid Eye Movement — six eighty-three. And MP7 Abyssal Apparition — six-eighty."

"So twenty percent of the time, I lose nineteen dollars. The calculator showed this as forty percent ROI, but the real expected value — accounting for the actual listing prices and the downside — is twenty-seven point nine percent."

*(Screen: side by side)*

"Still profitable! But twenty-eight percent is not forty percent. And on this specific trade-up, the gap is manageable because we're talking twenty-six bucks."

---

### SCALING UP (8:00–10:00)

*(Screen: transition to higher-tier trade-ups)*

"Now let's see what happens when you scale this to real money."

*(Screen: show Covert → Knife/Glove trade-up on TradeUpBot)*

"Here's a Covert to Gloves trade-up I found today. Five inputs — M4A4 Buzz Kill and SSG 08 Dragonfire, both Field-Tested. About two ninety-three each. Total cost: fourteen sixty-five."

"The Dragonfire alone has this price spread:"

*(Screen: show price data)*

"Factory New: five twenty-six average. Field-Tested: three twenty-four average. But individual listings range from two sixty-five to three eighty-plus."

"A calculator that uses the three twenty-four average when the listing you can actually buy costs two ninety-three? That's thirty bucks off per input. On five inputs, that's a hundred fifty dollars. Could be the difference between profit and loss."

"This glove trade-up has twenty-four possible outcomes. Forty-six percent chance to profit. Best case: Sport Gloves Hedge Maze at fifty-nine seventy-six — that's a forty-five hundred dollar profit. Worst case: Bloodhound Gloves Guerrilla at two seventeen — twelve forty-eight loss."

"The expected value is seventeen thirty-two on a fourteen sixty-five input. Eighteen percent ROI — but only if you're using real listing prices and real floats."

---

### WHY THIS ALWAYS HAPPENS (10:00–11:00)

*(Screen: TradeUpBot table view)*

"Every trade-up calculator has the same fundamental problem. They compute what should work in an ideal world. They don't check what's actually available."

"Three things always eat the margin:"

"One — real prices differ from averages. Averages include old sales at prices that don't exist anymore."

"Two — float values determine everything. An AK-47 Asiimov at point-zero-six-nine is Factory New, worth seven hundred thirteen dollars. At point-zero-seven-one, it's Minimal Wear — sixty-one dollars. Eleven-point-seven-x difference for point-zero-zero-two of float."

"Three — availability changes. By the time you source five inputs, the first one might have sold."

"So I built TradeUpBot. Every trade-up on the site is built from actual marketplace listings — real prices, real floats, real availability."

*(Screen: quick tour — table, expand a trade-up, show inputs with source badges, outcome chart)*

---

### CTA (11:00–11:30)

"If you want to find trade-ups that actually work with real listings, check out tradeupbot.app — link in the description. You can browse every trade-up for free, no account required."

"I break down a new trade-up every week on this channel. Subscribe if you want to stop losing money to theoretical calculators."

---

## Video Metadata

**Title:** Why Every CS2 Trade-Up Calculator Is Wrong (Real Listings vs Theory)

**Description:**
```
CS2 trade-up calculators show you profitable contracts — but can you
actually buy the inputs at those prices?

I tested a "40% ROI" trade-up and priced every input from real DMarket
listings. The real ROI was 28% — and the calculator hid a 20% chance
of losing $19.

Then I scaled it up to a $1,465 Covert → Gloves trade-up where the
price gaps get serious.

TradeUpBot (free): https://tradeupbot.app
Find trade-ups built from real CSFloat, DMarket, and Skinport listings.

Chapters:
0:00 The "40% profit" trade-up
0:30 What the calculator says
2:30 Buying real inputs on DMarket
6:00 The 20% the calculator hid
8:00 Scaling to $1,465 glove trade-ups
10:00 Why every calculator gets this wrong
11:00 How to find real-listing trade-ups

#cs2 #tradeup #csgo #cs2skins #tradeupcontract #csfloat #dmarket

Tags: cs2 trade up, cs2 trade up calculator, cs2 trade up profit,
trade up contract cs2, csgo trade up, cs2 float values, tradeupbot,
cs2 trade up guide, cs2 skins, factory new, minimal wear, gloves,
condition boundary, awp the end, dragonfire, buzz kill
```

**Pinned comment:**
```
Every number in this video uses real marketplace data from DMarket,
CSFloat, and Skinport.

The "40% ROI" trade-up was actually 28%. The glove trade-up's $267
expected profit only works with real listing prices, not averages.

Find trade-ups from actual listings (free): https://tradeupbot.app
```

---

## Recording Instructions for Tim

**Total recording time:** ~20-25 minutes (will be cut to 10-12)

**Screens to prepare before recording:**
1. A theoretical calculator showing a Restricted → Classified trade-up (use Pricempire, CSDelta, or CSFloat calculator — find one targeting AWP The End from Achroma/Dreams & Nightmares collections)
2. DMarket marketplace — Glock-18 Trace Lock FT listings page open
3. TradeUpBot showing trade-up #755175804 (the glove trade-up) OR current best Covert → Knife/Gloves trade-up
4. TradeUpBot table view for the quick tour section
5. Optionally: a second marketplace tab with SSG 08 Dragonfire listings showing the $265-$380 price range

**Recording flow:**
1. Open calculator, walk through the Trace Lock → AWP The End trade-up (~3 min)
2. Switch to DMarket, show real Trace Lock listings and price variation (~3 min)
3. Show the outcome breakdown — emphasize the 20% downside (~2 min)
4. Switch to TradeUpBot, show the glove trade-up, walk through the Dragonfire price spread (~3 min)
5. Quick TradeUpBot tour: table → expand → inputs → outcomes → verify (~1.5 min)
6. CTA (~30s)

**Voice tone:** Conversational, analytical, slightly amused when numbers don't match. Not angry, not hype. "Well that's interesting" energy. You're showing people something they've been missing.

**Key moments to emphasize (these become TikTok clips):**
- The $3.69 Trace Lock listing (23% over average)
- The outcome breakdown reveal (20% chance of -$19)
- The AK-47 Asiimov 11.7x price difference stat
- The glove trade-up best/worst case ($4,511 vs -$1,248)
