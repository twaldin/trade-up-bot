# TikTok Scripts — Week 1

Scripts numbered by posting order: #1 Monday, #2 Tuesday, #3 Wednesday, #4 Friday.
Also cross-post all to YouTube Shorts.

---

## TikTok #1: "This Trade-Up Is a TRAP" (Monday)
**Type:** Standalone recording | **Pillar:** Myth-Busting | **Length:** 30-40s

```
[TEXT ON SCREEN FROM FRAME 1]: "This trade-up claims 51% profit"

(Screen: theoretical calculator showing the Welcome to the Jungle trade-up)
VOICEOVER: "This trade-up says fifty-one percent profit. Thirty-five
hundred in, fifty-three hundred out. Let's try to actually buy the inputs."

[TEXT ON SCREEN]: "Reality check"

(Screen: marketplace showing higher prices + different floats)
VOICEOVER: "Input one — thirty-three dollars more than the calculator
says. Input four — the float I need doesn't exist. Input eight — already
sold."

[TEXT ON SCREEN]: "$4,042 real cost (not $3,500)"

VOICEOVER: "But here's the real problem — the actual floats push the
output past the Factory New boundary."

[TEXT ON SCREEN]: "FN ($5,320) → MW ($1,632)"

VOICEOVER: "That fifty-one percent profit? Negative sixty percent.
Eighteen hundred dollar gain turned into a twenty-four hundred dollar
loss."

[TEXT ON SCREEN]: "tradeupbot.app — trade-ups from real listings"

Hashtags: #cs2 #tradeup #csgo #cs2skins #profit #fyp #factorynew
Post time: 6-9 PM EST
```

**Recording notes:** Use the same calculator screen from the YouTube video setup. Show the marketplace briefly for the reality section — fast cuts, don't linger. End on the FN → MW comparison number.

---

## TikTok #2: "Why 0.069 Is Worth 3x More Than 0.071" (Tuesday)
**Type:** Standalone recording | **Pillar:** Education | **Length:** 30s

```
[TEXT ON SCREEN FROM FRAME 1]: "0.069 vs 0.071 = 3x price difference"

(Screen: two marketplace listings of M4A1-S Welcome to the Jungle — one FN, one MW)
VOICEOVER: "Same skin. Almost the same float. But this one is worth
three times more. Why?"

[TEXT ON SCREEN]: "Factory New: 0.00 - 0.07 | Minimal Wear: 0.07 - 0.15"

VOICEOVER: "Point zero six nine is Factory New — fifty-three hundred
dollars. Point zero seven one is Minimal Wear — sixteen hundred. That
tiny boundary? Thirty-seven hundred dollars."

[TEXT ON SCREEN]: "In trade-ups, your input floats determine this"

VOICEOVER: "In trade-ups, your input floats determine your output float.
Get it wrong by point zero zero two and your profit disappears."

Hashtags: #cs2 #tradeup #csgo #floatvalue #cs2skins #fyp
Post time: 6-9 PM EST
```

**Recording notes:** Show two real marketplace listings side by side if possible (two browser tabs). The visual of nearly identical wear + wildly different prices is the hook. Keep it fast.

---

## TikTok #3: "I Found This $1,232 Profit Trade-Up" (Wednesday)
**Type:** Standalone recording | **Pillar:** Daily Alpha | **Length:** 30-45s

```
[TEXT ON SCREEN FROM FRAME 1]: "$1,232 profit | 30.6% ROI"

(Screen: TradeUpBot showing trade-up #11, scrolling through the table)
VOICEOVER: "Here's today's best trade-up. Classified to Covert. Ten
inputs across CSFloat, DMarket, and Skinport. Total cost — four thousand
thirty-one dollars. One hundred percent chance to profit."

(Screen: expand the trade-up, show outcomes)
VOICEOVER: "Two possible outcomes. AWP The Prince, Minimal Wear — forty-one
percent chance, worth sixty-one hundred. AWP Dragon Lore, Field-Tested —
fifty-nine percent chance, worth forty-six hundred."

[TEXT ON SCREEN]: "Both outcomes profitable ✓"

VOICEOVER: "Both outcomes are profitable. Worst case you're up five
ninety-two. Best case — twenty-one forty. And every single input is a
real listing you can buy right now."

[TEXT ON SCREEN]: "tradeupbot.app — link in bio"

Hashtags: #cs2 #tradeup #csgo #profit #cs2skins #awpdragonlore #fyp
Post time: 6-9 PM EST
```

**Recording notes:** Open TradeUpBot, scroll to trade-up #11 (or current best profitable one), expand it. Show the inputs with source badges. Show the outcome section. Keep it moving — this is about the exciting find, not a tutorial.

---

## TikTok #4: Theory vs Reality Moment (Friday)
**Type:** Cut from YouTube video | **Pillar:** Myth-Busting | **Length:** 30-45s

**Not recorded separately.** This clip is extracted from the YouTube raw footage during editing.

**Which segment to pull:** The side-by-side comparison reveal at ~7:00-9:30 in the YouTube video — the moment the numbers are laid out and the $1,800 profit becomes a $2,400 loss. This is the most shareable moment.

**Editing notes:**
- Pull 30-45 seconds starting from where Tim says "Let's put this side by side"
- Add text overlay at frame 1: "Calculator said: +$1,800 profit"
- Add text overlay at reveal: "Reality: -$2,400 loss"
- Use `./content/extract-tiktok-clip.sh` to extract and format

**Command (fill in timestamp after recording):**
```bash
./content/extract-tiktok-clip.sh content/raw/2026-03-30-youtube-*.mp4 00:MM:SS 40 theory-vs-reality
```

Hashtags: #cs2 #tradeup #csgo #cs2skins #profit #fyp
Post time: 6-9 PM EST
