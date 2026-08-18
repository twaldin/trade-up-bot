# Cloud / background preview rules

Laptop `~/.cursor/skills` are not available here. Before sending a `/preview` pull request:

1. Run `.cursor/skills/preview-browser-qa/SKILL.md` on a real preview host (`API_PROXY=https://tradeupbot.app` if the local API is empty).
2. Do an adversarial pass on your own diff. Tim will reject:
   - huge skins (220px / 140px tiles / 280px cards)
   - missing input **cost** and **qty**
   - outputs without **price + odds** on the tile
   - fake charts (sine P/L sparks, invented series, bucket histograms)
   - local `/skins` 404s from tile clicks
   - missing Outlay sidebar on the console
   - `pv-embed` / iframed prod chrome
   - edits to production `/`, `/trade-ups`, `/calculator`, scoring, fees, CSFloat, or D&N
3. Stay on the preview branch. Do not merge. Do not deploy `/preview` to production.
