# TradeUpBot Content Production Guide

## Directory Structure

```
content/
  raw/              Tim drops raw recordings here
  edited/
    youtube/        Final YouTube cuts (1920x1080)
    tiktok/         Final TikTok clips (1080x1920)
    shorts/         YouTube Shorts (1080x1920, cross-posted from TikTok)
    reels/          Instagram Reels (1080x1920, reformatted from TikTok)
  thumbnails/       YouTube thumbnails (1280x720)
  screenshots/      TradeUpBot screenshots for posts
  week1/            Week 1 content drafts
  week2/            Week 2 content drafts (etc.)
```

## Resolution Specs

| Platform | Resolution | Aspect | FPS |
|----------|-----------|--------|-----|
| YouTube | 1920x1080 | 16:9 | 30 |
| TikTok | 1080x1920 | 9:16 | 30 |
| YouTube Shorts | 1080x1920 | 9:16 | 30 |
| Instagram Reels | 1080x1920 | 9:16 | 30 |
| YouTube Thumbnail | 1280x720 | 16:9 | — |
| Instagram Carousel | 1080x1350 | 4:5 | — |

## Recording Settings

- **Software:** OBS Studio recommended
- **Format:** MP4 (H.264)
- **Screen capture:** Native resolution (will be scaled in edit)
- **Audio:** Record mic as separate track if possible (easier to edit)
- **Naming:** `YYYY-MM-DD-platform-title.mp4`
  - Example: `2026-03-30-youtube-why-calculators-wrong.mp4`
  - Example: `2026-03-30-tiktok-trap-tradeup.mp4`

## Thumbnail Template

- **Background:** Dark gradient (#1a1a2e → #0d0d1a)
- **Title text:** Bold white, top portion, max 6 words
- **Screenshot:** TradeUpBot UI screenshot, center
- **Profit badge:** Bottom-right corner, green for profit / red for loss
- **Logo watermark:** Bottom-left, small, semi-transparent

Generate with: `./content/make-thumbnail.sh <screenshot> "TITLE TEXT" "+$125" profit`

## Text Overlay Style (Video)

- **Font:** Bold sans-serif (system Helvetica Bold)
- **Color:** White text
- **Background:** Semi-transparent dark pill (#000000 at 60% opacity)
- **Caption position:** Bottom-center
- **Stats callout position:** Top-center
- **Key numbers:** Larger font size, colored (green for profit, red for loss)

## Brand Colors

- **Background dark:** #1a1a2e
- **Background darker:** #0d0d1a
- **Profit green:** #22c55e
- **Loss red:** #ef4444
- **Text primary:** #ffffff
- **Text secondary:** #a0a0b0
- **Text muted:** #707080

## Weekly Workflow

1. **Saturday:** Claude drafts all content for the week
2. **Sunday:** Tim reviews scripts, records in one 60-90 min session
3. **Sunday-Monday:** Claude edits video (ffmpeg/ImageMagick)
4. **Monday-Saturday:** Tim posts from own accounts per the posting checklist
