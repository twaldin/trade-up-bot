# TradeUpBot ad creatives

Review pack for the 29 Sep 2026 creative review. Not a live campaign. Isolated from the app: its own `package.json`, and render output is gitignored.

```bash
npm install
npm run capture          # Playwright against https://tradeupbot.app
npm run check:copy       # banned phrases + RSA character counts
npm run render           # MP4s and PNGs in out/ (gitignored)
```

On-screen numbers come from `public/captures/facts.json`, which the capture script writes. That folder is gitignored; regenerate it rather than committing footage.

Videos are silent. No background music.
