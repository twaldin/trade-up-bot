# TikTok Scripts — Week 1

Scripts numbered by posting order: #1 Monday, #2 Tuesday, #3 Wednesday, #4 Friday.
Cross-post all to YouTube Shorts.

Data sources: Production trade-ups, real price observations from DMarket/CSFloat/Skinport.

---

## TikTok #1: "This Trade-Up Is a TRAP" (Monday)
**Type:** Standalone recording | **Pillar:** Myth-Busting | **Length:** 30-40s

```
[TEXT ON SCREEN FROM FRAME 1]: "This trade-up claims 40% profit"

(Screen: a theoretical calculator showing a Restricted → Classified trade-up)
VOICEOVER: "This trade-up says forty percent profit. Twenty-five
bucks in, thirty-five out. Eighty percent chance. Let's try to
actually buy the inputs."

[TEXT ON SCREEN]: "Reality check"

(Screen: DMarket showing the Glock-18 Trace Lock listings at varying prices)
VOICEOVER: "The calculator says three dollars per input. Real listings?
Two ninety-six, three sixty-nine, three-oh-one. That one at three
sixty-nine is twenty-three percent more than the average."

[TEXT ON SCREEN]: "40% ROI → 27.9% ROI"

VOICEOVER: "And the twenty percent downside the calculator glossed
over? You lose nineteen bucks on a twenty-six dollar bet. The real
ROI is twenty-eight percent, not forty."

[TEXT ON SCREEN]: "Calculators use averages. Real listings tell the truth."

[END CARD]: "tradeupbot.app — trade-ups from real listings"

Hashtags: #cs2 #tradeup #csgo #cs2skins #profit #fyp
Post time: 6-9 PM EST
```

---

## TikTok #2: "Why 0.069 Is Worth 11x More Than 0.071" (Tuesday)
**Type:** Standalone recording | **Pillar:** Education | **Length:** 30s

```
[TEXT ON SCREEN FROM FRAME 1]: "0.069 vs 0.071 = 11x price difference"

(Screen: marketplace showing AK-47 Asiimov listings — one FN, one MW)
VOICEOVER: "Same skin. AK-47 Asiimov. Almost the same float. But
this one is worth eleven times more. Why?"

[TEXT ON SCREEN]: "Factory New: 0.00 - 0.07 | Minimal Wear: 0.07 - 0.15"

VOICEOVER: "Point zero six nine is Factory New — seven hundred
thirteen dollars. Point zero seven one is Minimal Wear — sixty-one
dollars. That tiny boundary? Six hundred fifty dollars."

[TEXT ON SCREEN]: "In trade-ups, your input floats determine this"

VOICEOVER: "In trade-ups, your input floats determine your output
float. Get it wrong by point zero zero two and you lose six fifty."

Hashtags: #cs2 #tradeup #csgo #floatvalue #cs2skins #fyp
Post time: 6-9 PM EST
```

---

## TikTok #3: "This $267 Profit Glove Trade-Up" (Wednesday)
**Type:** Standalone recording | **Pillar:** Daily Alpha | **Length:** 30-45s

```
[TEXT ON SCREEN FROM FRAME 1]: "Glove trade-up | 18.2% ROI"

(Screen: TradeUpBot showing trade-up #755175804, scrolling through)
VOICEOVER: "Here's today's best trade-up. Covert to gloves. Five
inputs on DMarket — Buzz Kill and Dragonfire, about two ninety-three
each. Total cost: fourteen sixty-five."

(Screen: expand the trade-up, show outcomes)
VOICEOVER: "Twenty-four possible gloves. Forty-six percent chance to
profit. Best case? Sport Gloves Hedge Maze — that's a forty-five
hundred dollar profit."

[TEXT ON SCREEN]: "Hedge Maze: +$4,511 | Pandora's Box: +$4,041"

VOICEOVER: "Even Crimson Weave and Superconductor net you over eight
hundred and two thousand. Every input is a real listing on DMarket
right now."

[END CARD]: "tradeupbot.app — link in bio"

Hashtags: #cs2 #tradeup #csgo #profit #cs2skins #gloves #fyp
Post time: 6-9 PM EST
```

---

## TikTok #4: Theory vs Reality Moment (Friday)
**Type:** Cut from YouTube video | **Pillar:** Myth-Busting | **Length:** 30-45s

**Not recorded separately.** Extracted from YouTube raw footage during editing.

**Which segment to pull:** The moment Tim shows the side-by-side comparison — calculator's theoretical profit vs what real listings actually cost. The reveal where the numbers flip.

**Editing notes:**
- Pull 30-45 seconds from the comparison section
- Add text overlay at frame 1: "Calculator said: +40% profit"
- Add text overlay at reveal: "Real listings: 28% — and 20% chance you lose $19"
- Use `./content/extract-tiktok-clip.sh` to extract and format

**Command (fill in timestamp after recording):**
```bash
./content/extract-tiktok-clip.sh content/raw/2026-03-30-youtube-*.mp4 00:MM:SS 40 theory-vs-reality
```

Hashtags: #cs2 #tradeup #csgo #cs2skins #profit #fyp
Post time: 6-9 PM EST
