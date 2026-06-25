# Round-3 impact checkpoint — measure whether the changes worked

Round-3 shipped **2026-06-24/25** (commits 8fe5a3b → fbf09a4). SEO/AEO effects need **4–8 weeks** to surface in GSC; funnel/GA effects show within days once traffic flows. This doc is the measurement plan + the baselines to compare against. A session cron (created 2026-06-24) re-invokes this agent ~**2026-07-23** (4wk) for the first read; the fuller signal is ~**2026-08-20** (8wk).

## What shipped (the independent variables)
| Plan | Change | Expected effect |
|---|---|---|
| 027 | GA4 key events + `?ref` attribution + verified Stripe purchase | Funnel becomes visible; revenue/conversions measurable; creator attribution possible |
| 023 | JSON-LD (SoftwareApplication/FAQPage/Product/ItemList) on /calculator,/faq,/pricing,/skins + float-exact /calculator depth | AEO/AI-citation lift; richer money-page content; calculator-wrong query cluster |
| 023b | Consolidated dup how-it-works post (301); trimmed titles ≤~60 | De-cannibalized "how cs2 trade-ups work"; better SERP CTR |
| 024 | Internal-link footer hub on static+blog (/calculator 5→21 links) | Equity flows to money pages; topical authority |
| 026 | 410 for deleted trade-up details | 404 churn (141) drains faster; cleaner index |
| 025B | Live float-exact "best profit right now" on /collections/:slug | Collection landings uniquely valuable, not thin |

## Baselines (from 2026-06-24, see round3-growth-kpis + seo-diagnosis)
- **Users:** 108 total. **Paying:** 2 Pro (~$30 MRR). **Basic:** 0.
- **Signups:** ~5/wk; **0 in the last 7d** at baseline.
- **Organic:** ~2 clicks/day. Not top-of-SERP for "cs2 trade up calculator/simulator".
- **GSC not-indexed:** 651 (crawled-not-indexed 257 + 404 churn 141). Unindexed pages had *increased* vs round-2.
- **GA4:** zero key events, revenue read $0, click events unparameterized, AI-assistant referrals ~12 new users/28d.
- **Top organic skin pages (keep indexable):** awp-dragon-lore, mp5-sd-savannah-halftone, m4a1-s-fade.

## What to measure at the checkpoint
### A. Funnel / KPIs — queryable from prod DB (no user export needed)
Run on the VPS / prod DB (`tradeupbot`):
- New signups since 2026-06-24: `SELECT COUNT(*) FROM users WHERE created_at >= '2026-06-24';` — vs ~5/wk baseline.
- Attribution working: `SELECT signup_ref, COUNT(*) FROM users WHERE signup_ref IS NOT NULL GROUP BY signup_ref;` — any non-null = `?ref` plumbing live (will be empty until creator links are used).
- Paying customers / MRR: `SELECT tier, COUNT(*) FROM users GROUP BY tier;` + lifetime count. Compare to 2 Pro / ~$30 MRR.
- Activation proxy (if instrumented server-side later): signups who ran the calculator / viewed a trade-up.

### B. GA4 — needs operator (browser or export)
- **Confirm key events fire:** `sign_up_start`, `calculator_run`, `tradeup_view`, `begin_checkout`, `purchase` (GA4 → Realtime/Events). **Operator one-time:** mark `sign_up_start`, `begin_checkout`, `purchase` as **Key Events** in GA UI (027 maintenance note — do this NOW, not at checkpoint, or the funnel won't accumulate).
- Revenue: GA4 should now show non-zero purchase revenue (was $0).
- Funnel exploration: landing → calculator_run → sign_up_start → purchase drop-off.

### C. GSC — needs operator (re-export, filter date ≥ 2026-06-24)
- Organic clicks/impressions on: "cs2 trade up calculator", "cs2 trade up simulator", "is [collection] trade up profitable", "best [collection] trade ups". Up vs ~2 clicks/day?
- Position of `/calculator` for calculator/simulator terms (was outranked by the simulator blog post; 023b re-pointed).
- Coverage: not-indexed total trending down? 404 cohort draining toward/through 410 (026)? "Page with redirect" includes the retired how-do slug (023b)?
- Rich results / enhancements: any FAQ/Product/Breadcrumb eligibility (note: Google deprecated FAQ rich results — value is AEO/Bing/semantic, see 023).
- AI-assistant referral channel growth (GA acquisition).

### D. Live health spot-check (curl, anytime)
- `/calculator` schema + ~21 links; `/faq` FAQPage; `/pricing` Product offers; `/skins` ItemList; collection landings show "Best profitable … right now"; retired blog slug 301s; deleted numeric trade-up → 410.

## Decision rules
- **Funnel flat but events firing** → activation/traffic problem, not instrumentation. Revisit off-site (creator outreach needs budget) + Workstream A content.
- **Organic still flat at 8wk** → authority gap dominates; prioritize off-site backlinks + the editorial pillar (025 Workstream A).
- **Signups up, conversion flat** → pricing/activation; A/B the upgrade path.
- **`?ref` populated** → creator attribution works; scale outreach.

## Still open (operator / deferred)
- Mark GA4 Key Events (do now).
- 025 Workstream A: 2 editorial comparison posts + reproducible data study (independently shippable).
- Off-site creator outreach: needs per-video budget; templates in offsite-growth-creator-outreach-2026-06-24.md; `?ref` system now shipped (027).
- CSAlpha brand question (GA showed prior title) — confirm with user before any content uses a brand name.
