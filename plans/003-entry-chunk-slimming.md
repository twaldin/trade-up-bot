# Plan 003: Slim the entry chunk and the landing/DataViewer critical paths

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 3d7e65f..HEAD -- src/ shared/components/ui/ server/blog-routes.ts`
> On any in-scope drift, compare "Current state" excerpts to live code first;
> mismatch = STOP.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW (steps 1–3) / MED (step 4, optional)
- **Depends on**: 001
- **Category**: perf
- **Planned at**: commit `3d7e65f`, 2026-06-10

## Why this matters

The production entry chunk is 425KB raw / ~136KB gzip and is on the critical path of every page. A sourcemap-attributed build (2026-06-10) found three large avoidable payloads:

1. **DaemonModal (admin-only) is eagerly imported** in `src/App.tsx:7`. It is the only importer of the base-ui Dialog/Tabs stack — ~76KB raw (~24KB gzip, ≈18% of the entry chunk) of focus-trap/dialog/tabs machinery shipped to every visitor, rendered only for admins.
2. **Full blog article bodies ship to the landing page**: `src/data/blog-posts.ts` (916 lines of article text) builds as an 83.7KB raw / 25.2KB gzip chunk, modulepreloaded from the prerendered landing HTML, while `LandingPage.tsx` uses only `blogPosts.slice(0, 3)` title/excerpt/slug/date (~600 bytes of displayed data).
3. **react-day-picker + date-fns + @date-fns/tz = 71.5KB raw (~43% of the 168KB DataViewer chunk)** behind two single-date popovers in the /skins filter bar.

## Current state

- `src/App.tsx:7` — `import { DaemonModal } from "./components/DaemonModal.js";` (eager). Rendered only at `src/App.tsx:353`: `{userIsAdmin && showDaemonModal && <DaemonModal onClose={...} />}`. All route pages in the same file already use the `lazy(() => import(...))` pattern (lines 8–27) — match it.
- `src/pages/LandingPage.tsx:6` — `import { blogPosts } from '../data/blog-posts.js';` used only at line 369: `blogPosts.slice(0, 3).map((post) => ...)` reading `slug`, `publishedAt`, `title`, `excerpt`.
- `src/pages/BlogPage.tsx:3` — same import; the blog index also needs metadata only.
- `src/pages/BlogPostPage.tsx:3` — `import { getPostBySlug, blogPosts } from "../data/blog-posts.js";` — this one legitimately needs full bodies and is already its own lazy chunk; leave its import alone.
- Server-side consumers that must keep importing the full module: `server/index.ts:26`, `server/blog-routes.ts:2`, `scripts/prerender.ts:7`.
- **Source-string tests you must not break**:
  - `tests/unit/seo-pages.test.ts:45` asserts the literal string `import { blogPosts, type BlogPost } from "../src/data/blog-posts.js";` exists in `server/blog-routes.ts` — keep that import untouched.
  - `tests/unit/internal-cross-linking.test.ts:16` reads `src/data/blog-posts.ts` source — keep that file's path and content shape.
- `src/components/data-viewer/FilterBar.tsx:9` — `import { Calendar } from "@shared/components/ui/calendar.js";`, rendered at lines 191 and 206 inside popovers. `shared/components/ui/calendar.tsx` is the only react-day-picker importer.

## Commands you will need

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Typecheck | `npm run typecheck`      | exit 0              |
| Unit      | `npm run test:unit`      | all pass            |
| Build     | `npm run build`          | exit 0 (postbuild prerender + verify-seo-html pass) |
| Size check| `ls -la dist/assets/ \| sort -k5 -n -r \| head -15` | see per-step expectations |

Record baseline sizes BEFORE any change: `npm run build && ls -la dist/assets/ | sort -k5 -n -r | head -15`. As of planning: `index-*.js` 424,752B; `DataViewer-*.js` 168,227B; `blog-posts-*.js` 83,659B.

## Scope

**In scope**:
- `src/App.tsx`
- `src/data/blog-meta.ts` (create), `src/data/blog-posts.ts` (additive export only, if needed)
- `src/pages/LandingPage.tsx`, `src/pages/BlogPage.tsx`
- `src/components/data-viewer/FilterBar.tsx`
- `tests/unit/` — new sync test (create `tests/unit/blog-meta.test.ts`)
- Step 4 only: files importing `react-helmet-async`, `src/main.tsx`, `package.json`

**Out of scope**:
- `server/blog-routes.ts`, `server/index.ts`, `scripts/prerender.ts` (server keeps full blog import)
- `src/pages/BlogPostPage.tsx` (already lazy, needs bodies)
- `shared/components/ui/calendar.tsx` internals
- vite.config.ts (Plan 004 owns build config)

## Git workflow

- Branch: `advisor/003-entry-chunk-slimming`. One commit per step, e.g. `perf(web): lazy-load admin DaemonModal out of entry chunk`.
- No Co-Authored-By trailers. Do not push unless instructed.

## Steps

### Step 1: Lazy-load DaemonModal

In `src/App.tsx`, replace the static import with the file's existing pattern:

```tsx
const DaemonModal = lazy(() => import("./components/DaemonModal.js").then(m => ({ default: m.DaemonModal })));
```

and wrap the render site (line ~353) in its own Suspense with a null fallback:

```tsx
{userIsAdmin && showDaemonModal && (
  <Suspense fallback={null}>
    <DaemonModal onClose={() => setShowDaemonModal(false)} />
  </Suspense>
)}
```

**Verify**: `npm run typecheck` exit 0; `npm run build` exit 0; `ls dist/assets | grep -i daemon` → a new `DaemonModal-*.js` chunk exists; entry `index-*.js` shrinks by roughly 60–90KB raw vs the baseline you recorded.

### Step 2: Split blog metadata from bodies

1. Create `src/data/blog-meta.ts` exporting `blogMeta: { slug: string; title: string; excerpt: string; publishedAt: string }[]` — one literal entry per post, copied from `blog-posts.ts`, same order. (Check `LandingPage.tsx:360-380` and `BlogPage.tsx` for the exact fields they render; include any additional metadata field they use, e.g. reading time, but NO `content`.)
2. TDD: first write `tests/unit/blog-meta.test.ts` asserting `blogMeta.length === blogPosts.length` and per-index equality of every shared field (`slug`, `title`, `excerpt`, `publishedAt`) between `blog-meta.ts` and `blog-posts.ts`. This test may import both modules (it runs in Node, bundle size is irrelevant); it is the guard that keeps the two files in sync. Run it — it should fail before blog-meta exists, pass after.
3. Switch `LandingPage.tsx` and `BlogPage.tsx` to `import { blogMeta } from '../data/blog-meta.js'` and adjust the variable usage (`blogMeta.slice(0, 3)` etc.). Do not touch `BlogPostPage.tsx`.

**Verify**: `npm run test:unit` all pass (including the two source-string SEO tests); `npm run build` exit 0; `grep -rn "blog-posts" src/pages/LandingPage.tsx src/pages/BlogPage.tsx` → no matches; in `dist/`, the `blog-posts-*.js` chunk is no longer referenced by the LandingPage chunk (check: `grep -l "blog-posts" dist/assets/LandingPage-*.js` → no match).

### Step 3: Lazy-load the Calendar inside FilterBar

In `src/components/data-viewer/FilterBar.tsx`, replace the static Calendar import with:

```tsx
const Calendar = lazy(() => import("@shared/components/ui/calendar.js").then(m => ({ default: m.Calendar })));
```

and wrap each popover usage (lines ~191, ~206) in `<Suspense fallback={<div className="p-4 text-xs text-muted-foreground">Loading…</div>}>`. Import `lazy`/`Suspense` from react. Keep all props identical.

**Verify**: `npm run typecheck` exit 0; `npm run build` exit 0; `DataViewer-*.js` shrinks by roughly 60–75KB raw; a new calendar chunk appears. Manually confirm types still line up (Calendar's props are forwarded unchanged).

### Step 4 (OPTIONAL — attempt only if steps 1–3 landed cleanly): Remove react-helmet-async

React 19 hoists `<title>`/`<meta>`/`<link>` rendered anywhere in the tree natively; `react-helmet-async` (~6KB gzip + a provider layer in the entry) is redundant.

1. Enumerate usage: `grep -rln "react-helmet-async" src/`. If more than ~10 files use `<Helmet>`, STOP and report the count instead (effort was underestimated).
2. For each file, replace `<Helmet> ... </Helmet>` with the bare tags as direct JSX children, preserving every tag and attribute exactly.
3. Remove `HelmetProvider` from `src/main.tsx`; `npm uninstall react-helmet-async`.

**Verify**: `npm run build` → exit 0 AND the postbuild `scripts/verify-seo-html.ts` passes (it validates prerendered heads — this is the real gate); `npm run test:unit` all pass; `grep -rn "react-helmet-async" src/` → no matches.

## Test plan

- New: `tests/unit/blog-meta.test.ts` (Step 2) — model structure after any existing small unit test, e.g. `tests/unit/seo-pages.test.ts` for import style.
- Existing gates: `npm run test:unit` (includes the SEO source-string tests), `npm run build` postbuild SEO verification.

## Done criteria

- [ ] `npm run typecheck`, `npm run test:unit`, `npm run build` all exit 0
- [ ] Entry `index-*.js` raw size reduced ≥ 50KB vs recorded baseline
- [ ] `DataViewer-*.js` raw size reduced ≥ 50KB vs baseline
- [ ] `LandingPage-*.js` chunk no longer pulls the blog-posts chunk
- [ ] New blog-meta sync test exists and passes
- [ ] Only in-scope files modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

- The seo-pages or internal-cross-linking source-string tests fail and the fix would require changing `server/blog-routes.ts` or moving `src/data/blog-posts.ts` — both out of scope.
- Step 4's Helmet usage count exceeds ~10 files, or `verify-seo-html` fails twice after the Helmet swap.
- Entry chunk does NOT shrink after Step 1 (would mean the sourcemap attribution was wrong — report, don't chase).

## Maintenance notes

- New blog posts must now be added in TWO files (`blog-posts.ts` + `blog-meta.ts`); the sync test fails loudly if someone forgets. If that friction grows, a codegen step deriving blog-meta at build time is the follow-up.
- Plan 004 (vendor chunking, modulepreload) compounds with this; do this one first so the vendor/app split sizes are measured on the slimmed graph.
