# Cloud / background preview rules

Laptop `~/.cursor/skills` are not available here. Before sending a `/preview` pull request:

1. Run `.cursor/skills/preview-browser-qa/SKILL.md` on a real preview host (`API_PROXY=https://tradeupbot.app` if the local API is empty).
2. Do an adversarial pass on your own diff. Tim will reject:
   - huge skins (220px / 140px tiles / 280px cards)
   - a card header band, an expand button, or stats repeated in more than one place
   - fat payoff orbs instead of slim ticks
   - outputs without **price + odds**, inputs without **cost**, **count**, and **4 dp float**
   - fake charts (sine P/L sparks, invented series, bucket histograms)
   - a foreign green: lime `--accent` is profit, `--loss` is loss, and lime is never a rarity
   - leaked production chrome (`rounded-md`, `text-muted-foreground`, shadcn controls, the plated favicon)
   - local `/skins` 404s from tile clicks — skin names go to `/preview/skins/:slug`
   - missing Outlay sidebar on the console
   - `pv-embed` / iframed prod chrome
   - edits to production `/`, `/trade-ups`, `/calculator`, scoring, fees, CSFloat, or D&N
3. Stay on the preview branch. Do not merge. Do not deploy `/preview` to production.

## Next pass: real usage capture in the laptop

`src/preview/components/DeviceScreen.tsx` currently shows inert stills that
`scripts/preview-capture-device.mjs` refreshes at the end of a pass. That is
deliberate — production's `DemoAnimation` / `DemoAnimationMobile` is the "using
the dashboard" motion we eventually want in the lid.

The next pass should record a real usage clip (click a card to expand, open a
listing) into the laptop, and only then consider Playwright-on-build to refresh
the dark/light stills automatically. Do **not** stand up an always-on Remotion
or CDN screenshot pipeline before Tim locks the card design — the capture has to
follow the card, not the other way round.
