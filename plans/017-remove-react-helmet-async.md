# Plan 017: Remove react-helmet-async (React 19 hoists head tags natively)

> **Executor instructions**: Follow step by step with verification. STOP conditions binding. Reviewer maintains plans/README.md.
>
> **Drift check (run first)**: `git diff --stat 5fbb497..HEAD -- src/ package.json`
> On drift in files importing react-helmet-async, compare before proceeding.

## Status

- **Priority**: P3 — **Effort**: M — **Risk**: MED (touches the head tags of every page; the SEO verification gates are the net) — **Depends on**: none — **Category**: perf/deps
- **Planned at**: commit `5fbb497`, 2026-06-10

## Why this matters

This was plan 003's optional Step 4, skipped via its >10-files STOP gate: **16 files** import react-helmet-async. React 19 (installed) hoists `<title>`, `<meta>`, and `<link>` rendered anywhere in the component tree into `<head>` natively — the library (~6KB gzip in the entry chunk plus a context provider re-render layer) is redundant. Removing it shrinks the entry chunk and deletes a dependency.

## Current state

- `grep -rln "react-helmet-async" src/` → 16 files (enumerate fresh — today's count): src/main.tsx (HelmetProvider) + 15 page/component files using `<Helmet>...</Helmet>` wrappers around title/meta/link tags.
- React version: react 19 (package.json) — native hoisting applies to `<title>`, `<meta>`, `<link>` (NOT `<script>`; check each Helmet block's contents — if any contains `<script>` (e.g. JSON-LD), that needs `dangerouslySetInnerHTML` on a plain script tag rendered in-tree, which React 19 also hoists; verify per site).
- Gates: `npm run build` postbuild runs prerender + `scripts/verify-seo-html.ts` — this validates the prerendered HEAD of all 18 routes and is the load-bearing check. Also `npm run verify:seo:public` post-deploy.
- Conventions: keep each page's tags byte-equivalent (same order is not required, same SET of tags is).

## Commands

| Purpose | Command | Expected |
|---|---|---|
| Typecheck / Unit / Build | `npm run typecheck` / `npm run test:unit` / `npm run build` | all green; verify-seo-html passes |

Build once before test:unit. CAPTURE BASELINE FIRST: after an initial `npm run build`, copy dist/*.html + dist/*/index.html heads somewhere (`for f in $(find dist -name 'index.html'); do ...` extract `<head>`) for later diffing.

## Scope

**In scope**: the 16 importing files; `src/main.tsx` (drop HelmetProvider); `package.json`/lock (uninstall); tests quoting Helmet usage.
**Out of scope**: server-side head generation (server/seo.ts, blog-routes — untouched); adding/removing any actual tag (pure mechanical translation).

## Steps

### Step 1: Baseline head capture

`npm run build`; extract every prerendered `<head>` into /tmp/heads-before/ (one file per route, normalized: sorted lines, whitespace-trimmed).

### Step 2: Mechanical translation, 4-5 files at a time

Per file: replace `<Helmet>(children)</Helmet>` with the children rendered directly (fragment), preserving every tag + attribute; drop the import. After each batch: `npm run typecheck`.

### Step 3: Drop the provider + dependency

Remove `HelmetProvider` from src/main.tsx; `npm uninstall react-helmet-async`. **Verify**: `grep -rn "react-helmet-async" src/ package.json` → empty.

### Step 4: Equivalence + gates

`npm run build` → extract heads into /tmp/heads-after/ and diff against before (normalized). Differences allowed: none in tag content (ordering may shift). `npm run test:unit` green; record entry-chunk size delta vs pre-change build.

## Done criteria

- [ ] Zero react-helmet-async references; dependency removed
- [ ] Normalized head diff across all 18 prerendered routes: tag-set identical
- [ ] verify-seo-html passes; typecheck + unit green; entry chunk smaller (record bytes)
- [ ] Only in-scope files modified

## STOP conditions

- Any head diff shows a missing/changed tag you cannot attribute to ordering — report the route + tag.
- A Helmet block contains tags React 19 does not hoist (e.g. arbitrary `<script src>`) and no clean in-tree equivalent exists — report that file, convert the rest.
- verify-seo-html fails twice.

## Maintenance notes

- New pages add head tags as plain JSX now; no provider needed. Reviewers: check tags render inside the component (not conditionally skipped during prerender).
