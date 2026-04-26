Bug to investigate and reproduce:
BUG: Filter dropdown claims tradeups exist for several CS2 collections, but selecting them shows an empty results table.

Reproduction:
1. Open the Trade-Up Bot main table view (Trade-Ups tab).
2. Click the 'Filter by collection...' input.
3. Search 'overpass'. Dropdown shows 'The Overpass... — 150,470 trade-ups' AND a second Overpass entry — 13,749 trade-ups.
4. Select 'The Overpass 2024 Collection'. Filter chip 'Collection: The Overpass 2024 Collection ×' appears.
5. Table goes 'Loading...' then renders ZERO rows. Filters claim 150K trade-ups exist; table is empty.

Affected collections (Tim observed at least these — discover others via dropdown counts vs table):
- The Overpass 2024 Collection (~150K claimed)
- Train 2025
- Revolver
- (likely more — the dropdown's trade-up count vs filtered-table-row-count is the bug surface)

Two leading hypotheses (validate / invalidate one, fix accordingly):
1. BACKEND/ENGINE BUG: the trade-up engine never computes/persists trade-ups for these collections, so the dropdown count comes from a stale or different source (e.g. pre-engine collection metadata) but the table queries the engine output and finds nothing.
2. FRONTEND BUG: tradeups exist in the DB / API response, but the table component's filter logic / render path drops them (string mismatch on collection name, case sensitivity, slug vs display-name, etc).

Investigation tools available to you (use whichever helps):
- grep through ~/trade-up-bot for collection-name handling, the engine entry-point, and the table component.
- The browser-use skill (/usr/bin/find ~/.flt/skills/browser-use) — drive a real browser to reproduce the empty table and inspect the actual API response in DevTools.
- The autoresearch skill — for autonomous experiment loops if you need to bisect a fix.
- DB queries if the project has a SQLite/Postgres backing store — count rows per collection to confirm hypothesis 1 vs 2.

Deliverable per workflow step:
- reproduce: a failing test that demonstrates the bug (e.g. 'querying tradeups for collection "The Overpass 2024 Collection" returns N rows where N > 0' — currently fails).
- fix: minimal change so the test passes.
- rerun: full suite green.
- reviewer: confirm root cause was correctly identified (not just symptom-masked).

Reference screenshots:
/var/folders/cf/sgp0bvks6t7br_0q2kj_5jpm0000gn/T/TemporaryItems/NSIRD_screencaptureui_NOyK9e/Screenshot\ 2026-04-26\ at\ 2.14.47\ PM.png  (empty table with Overpass filter)
/var/folders/cf/sgp0bvks6t7br_0q2kj_5jpm0000gn/T/TemporaryItems/NSIRD_screencaptureui_axH400/Screenshot\ 2026-04-26\ at\ 2.15.05\ PM.png  (dropdown showing 150K claim)

Your job:
1. Read the bug description carefully (and any linked screenshots / files).
2. Locate the relevant code — backend engine OR frontend table OR both. Use grep/find to hunt; use the browser-use skill if the bug is observable in the running app.
3. Identify the root cause: backend (engine doesn't compute) vs frontend (data exists but UI fails to render) vs both.
4. Write a failing test that demonstrates the bug. Test should FAIL with the current bug present.
5. Commit the failing test.

flt workflow pass when reproduction is committed and the test fails as expected.
flt workflow fail "<one-line reason>" if you can't reproduce after a thorough check (rare — usually means the bug description is incorrect).
