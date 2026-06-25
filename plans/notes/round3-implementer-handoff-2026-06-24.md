# Round 3 — implementer handoff (2026-06-24)

For a fresh implementer agent (Workflow-based or smithers). The advisor (this session) did diagnosis, planning, and codex adversarial review. Your job: **execute the reviewed plans, one at a time, codex-review the diff before deploy, then deploy via the established loop.** You have standing authorization for local commits + pushes to `main` (each push deploys to the Hetzner VPS).

## Read first (context, in order)
1. `plans/notes/seo-diagnosis-2026-06-24.md` — why rankings haven't moved (too-early + authority gap + thin pages + dup signal).
2. `plans/notes/round3-growth-kpis-2026-06-24.md` — funnel baseline (108 users, 2 Pro ~$30 MRR, ~5 signups/wk, ~2 organic clicks/day) + KPI tree. **Everything is measured in signups/customers, not impressions.**
3. `plans/notes/positioning-float-accuracy-2026-06-24.md` — **the moat**: real-listing float-exact pricing vs competitors' condition-average. The through-line for all content. Verified in `core.ts`/`evaluation.ts`/`knn-pricing.ts`.
4. `plans/notes/retention-vs-activation-2026-06-24.md` — it's an ACTIVATION problem (people bounce before value), not retention. Fix activation first.
5. `plans/notes/seo-audit-report-2026-06-24.md` — systematic audit (cannibalization, schema gaps, titles; speed/i18n cleared).
6. `plans/notes/offsite-growth-creator-outreach-2026-06-24.md` — creator strategy (modest budget → gift/affiliate) + email templates.

## State
- **DONE + deployed:** Plan 022 (funnel CTAs — `ProductCTA` on blog + money pages, crawler-HTML CTA flowing equity). Verified live. Commit `8fe5a3b`.
- **Plans 001–021:** prior batches, all DONE (see `plans/README.md`).

## Execution queue (priority order; one plan at a time)
| Plan | File | Codex review | Notes |
|---|---|---|---|
| 023 | `plans/023-onpage-schema-and-calculator-depth.md` | ✅ reviewed, MUST-FIX section appended | Schema on /calculator,/faq,/pricing,/skins + calc depth. **Pricing corrected: Pro $6.99/$59.99/$74.99, no Basic.** |
| 023b | `plans/023b-cannibalization-and-titles.md` | ✅ reviewed, MUST-FIX appended | Consolidate dup "how-it-works" posts; re-point simulator posts→/calculator; trim titles ≤60. |
| 027 | `plans/027-ga4-funnel-instrumentation.md` | ✅ reviewed, MUST-FIX appended | GA key events + `?ref` attribution + Stripe purchase. **Measures everything downstream — do early.** |
| 024 | `plans/024-internal-linking-and-clusters.md` | ⏳ codex review in `/tmp/codex-plan-reviews/024.txt` — FOLD must-fixes before executing | Footer hub + clusters (depends 023/023b). |
| 025 | `plans/025-longtail-content-engine.md` | ⏳ `/tmp/codex-plan-reviews/025.txt` | Content moat. Ships public content — codex MUST verify every number vs engine/fees.ts. |
| 026 | `plans/026-index-bloat-hygiene.md` | ⏳ not yet reviewed — review before executing | 410 tombstones + thin-page indexability. |

**Before executing 024/025/026:** read their `/tmp/codex-plan-reviews/*.txt`, fold the must-fixes into the plan (like 023/023b/027 already have), THEN execute. If the /tmp files are gone, re-run: `codex exec --skip-git-repo-check --sandbox read-only "<adversarial review prompt>" > review.txt`.

## The per-plan loop (proven in batches 1–2 + plan 022)
1. Drift check (each plan's header command). On drift, reconcile before dispatch.
2. Execute in an isolated worktree (the `execute-advisor-plan` Workflow at `~/.claude/projects/-Users-twaldin-trade-up-bot/c7e7aa7b-*/workflows/scripts/execute-advisor-plan-wf_18386133-b0f.js`, or smithers equivalent: executor + 2 verifiers).
3. **Codex adversarial review of the DIFF before deploy** (user-mandated): `cd <worktree> && codex exec --skip-git-repo-check --sandbox read-only "<refute-this-diff prompt>"`. Real defects → one revise round (max 2), then BLOCK. (Codex can hang/buffer — redirect to a file, don't pipe through `tail`; if it 529s or hangs, review the diff inline — see how plan 020/022 were handled.)
4. Advisor/tech-lead review of `git diff main...HEAD`.
5. Merge ff-only (remove worktree FIRST), push, watch CI: `export GH_TOKEN=$(gh auth token --user twaldin); gh run watch -R twaldin/trade-up-bot --exit-status <id>`.
6. Verify live as Googlebot (curl) + mark the plan DONE in `plans/README.md`.

## Standing gotchas (each cost a debugging round)
- **dist/ gitignored**; `tests/unit/internal-cross-linking.test.ts` reads dist/index.html at module load → `npm run build` once BEFORE `npm run test:unit`; rebuild after src changes.
- **Source-string tests** (seo-*, blog-meta, internal-cross-linking, seo-html-verify) quote literal source/titles — update expectations preserving intent.
- **blog-posts.ts ↔ blog-meta.ts** per-field parity enforced by `blog-meta.test.ts`.
- **Schema/FAQ parity**: visible Q/As must match FAQPage JSON-LD verbatim (Google requirement).
- **All fee/price numbers** must match `server/engine/fees.ts` (incl. **Buff** 2.5%/3.5%+$0.15) and pricing from `PricingPage.tsx`/`stripe.ts` (Pro $6.99/$59.99/$74.99, NO Basic).
- **`/skins` crawler HTML Redis-cached** (`seo_skins_list`, 3600s) — bump key/clear on schema change.
- **SCHEMA_VERSION** must bump for any `createTables` change (027 only); `users` table is created in db.ts AND auth.ts AND test setup.ts — change all three.
- **react-helmet-async removed** (plan 017) — head tags are plain JSX (React 19 hoisting); JSON-LD via `<script type="application/ld+json" dangerouslySetInnerHTML={{__html: JSON.stringify(...)}} />`.
- **/auth links rel="nofollow"**; product links followed.
- **GitHub**: twaldin account via SSH origin + `GH_TOKEN=$(gh auth token --user twaldin)`; never `gh auth switch`.
- **Conventional commits, NO Co-Authored-By / attribution.**
- **Daemon-affecting deploys** need `bash scripts/daemon-restart.sh` on the VPS (none of 023–027 touch the daemon).
- VPS now CPX41 16GB (rescaled 2026-06-11); PG tuned (shared_buffers 4GB).

## Not code (advisor/operator deliverables, separate)
- Off-site/creator outreach (`offsite-growth-creator-outreach-*.md`) — needs user's per-video budget (said "modest" → gift/affiliate) + the `?ref` system from 027. Vetted creator shortlist pending budget.
- GSC console: validate "Blocked by robots.txt" + "Page with redirect" cohorts; re-export GSC ~Jul 8/22 filtered `date>=2026-06-11` to isolate the fixed period.
- CSAlpha brand question (GA showed it as a prior title on this domain) — confirm with user before content uses a brand name.
