# Plan 004: Fix HTML shell serving, vendor caching, font preload, and precompression

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 3d7e65f..HEAD -- scripts/prerender.ts server/index.ts vite.config.ts index.html public/ package.json`
> On any in-scope drift, compare "Current state" excerpts to live code first;
> mismatch = STOP.

## Status

- **Priority**: P1
- **Effort**: M–L
- **Risk**: MED (touches the SEO/prerender pipeline — every step is gated by the repo's own SEO verification)
- **Depends on**: 003 (do the chunk slimming first so sizes are measured on the slimmed graph)
- **Category**: perf
- **Planned at**: commit `3d7e65f`, 2026-06-10

## Why this matters

Four compounding delivery problems, all verified at planning time:

1. **Every SPA route serves the 68KB prerendered *landing page* HTML.** `scripts/prerender.ts` overwrites `dist/index.html` in place with the fully rendered landing page; `server/index.ts` then serves that file for ALL non-crawler app routes (`/trade-ups`, `/skins`, catch-all). A visitor opening `/trade-ups` downloads 68KB of wrong HTML, briefly paints the landing hero, gets landing-only `<link rel="modulepreload">` hints (~41KB gzip of LandingPage/blog/SiteNav JS they won't run), and only discovers the chunks they actually need after the entry chunk executes — an extra serial round trip on the main product page.
2. **No vendor chunk splitting** (`vite.config.ts` has no `build` config): any one-line app change renames the single `index-*.js`, so near-daily deploys force returning visitors to re-download all ~136KB gzip instead of a few KB of app code.
3. **No font preload**: the Geist woff2 is discovered only after the ~136KB raw render-blocking CSS parses → visible FOUT on the prerendered landing page.
4. **No precompressed assets**: `compression()` gzips the 425KB entry per request on the 3-vCPU VPS; Brotli (~15–20% smaller) is never used.

## Current state

- `scripts/prerender.ts:114-119` — for route `/`, `outputPath = join(DIST_DIR, "index.html")` → prerender output overwrites the pristine Vite shell.
- `server/index.ts:861` — `const indexHtml = fs.readFileSync(path.join(distPath, "index.html"), "utf-8");` read once at startup; used by `injectMetaIntoSpa` for `/trade-ups` (line ~871), `/collections` (~947), `/skins` (~974), static SEO pages (~1032), `/blog` (~1058), `registerBlogRoutes(app, indexHtml)` (~1062).
- `server/index.ts:1109-1112` — catch-all `app.get("*")` → `res.sendFile(dist/index.html)`.
- Several SEO handlers ALSO re-read `dist/index.html` per request (`server/index.ts:296`, `~370`, `~507`, `~851`) — Plan 005 replaces those; this plan only creates the shell constant they will use.
- `vite.config.ts` — full file is 29 lines; `plugins: [react(), tailwindcss()]`, no `build` key.
- `index.html:19-25` — GA gtag scripts in head; no font preload links.
- `server/index.ts:89` — `app.use(compression());`; `server/index.ts:1100-1108` — `express.static(distPath, { setHeaders ... })` gives `/assets/` immutable 1y caching, nothing else gets cache headers.
- `public/` contains full-size original images; the bundle audit found ~1.7MB of originals unreferenced by any code (verify in Step 6 — do not trust the list blindly).
- Repo conventions: ESM imports with `.js` extension; the postbuild pipeline `npx tsx scripts/prerender.ts && npx tsx scripts/verify-seo-html.ts` runs automatically after `npm run build`.

## Commands you will need

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Build + SEO gate | `npm run build`   | exit 0, prerender + verify-seo-html pass |
| Typecheck | `npm run typecheck`      | exit 0              |
| Unit      | `npm run test:unit`      | all pass            |
| Public SEO smoke (after deploy only) | `npm run verify:seo:public -- --routes=/calculator,/faq` | pass |

## Scope

**In scope**:
- `scripts/prerender.ts`
- `server/index.ts` (shell-loading block + static serving block + catch-all only)
- `vite.config.ts`, `index.html`
- `package.json` (two new deps: `vite-plugin-compression2` dev, `express-static-gzip` prod — or equivalents; pick maintained ones)
- `public/` (deletions of verified-unreferenced originals only)
- `tests/unit/` for any source-string tests that reference changed lines

**Out of scope**:
- The per-request `readFileSync` calls inside `/skins/:slug`, `/collections/:slug`, `/trade-ups/:id` handlers — Plan 005 rewrites those handlers; here you only export the shell constant.
- `server/blog-routes.ts` and crawler-branch HTML (`buildSeoHtml`) — crawler output must remain byte-equivalent.
- nginx config on the VPS (not in repo). Note interactions in the report.

## Git workflow

- Branch: `advisor/004-static-delivery-pipeline`; one commit per step (`perf(web): serve clean SPA shell for non-prerendered routes`, etc.). No Co-Authored-By trailers.

## Steps

### Step 1: Preserve the pristine shell during prerender

In `scripts/prerender.ts` `main()`, immediately after the `DIST_DIR` existence check and BEFORE starting the server/browser, copy the pristine build output:

```ts
copyFileSync(join(DIST_DIR, "index.html"), join(DIST_DIR, "_shell.html"));
```

(`copyFileSync` from `fs`.) The prerender loop then overwrites `dist/index.html` for `/` as before.

**Verify**: `npm run build` → exit 0; `ls -la dist/_shell.html dist/index.html` → both exist; `_shell.html` is small (~2–4KB), `index.html` is the large prerendered landing; `grep -c modulepreload dist/_shell.html` ≥ 0 (shell keeps only Vite's entry preloads, no LandingPage/blog chunks: `grep "LandingPage" dist/_shell.html` → no match).

### Step 2: Serve the shell for SPA routes, prerendered HTML only for `/`

In `server/index.ts` inside the `if (fs.existsSync(distPath))` block (line ~859):

```ts
const indexHtml = fs.readFileSync(path.join(distPath, "index.html"), "utf-8"); // prerendered landing (keep)
const shellPath = path.join(distPath, "_shell.html");
const shellHtml = fs.existsSync(shellPath)
  ? fs.readFileSync(shellPath, "utf-8")
  : indexHtml; // fallback: old dist without _shell.html
```

Then switch the **SPA-shell consumers** to `shellHtml`: the non-crawler branches of `/trade-ups`, `/collections`, `/skins`, the static SEO pages loop, `/blog`, `registerBlogRoutes(app, shellHtml)`, and the catch-all (`app.get("*")` → `res.send(shellHtml)` with the existing no-cache header instead of `sendFile`). The `/` handler (line ~1064) keeps reading the prerendered `index.html` exactly as today.

Also export `shellHtml` for Plan 005: keep it module-scoped via a small exported getter or attach to `app.locals.shellHtml = shellHtml` (pick `app.locals`; it's the least invasive).

**Verify**: `npm run typecheck` → exit 0; `npm run test:unit` → pass (several unit tests assert source strings in server/index.ts — if one fails, update only string expectations that mention `sendFile`/`indexHtml`, preserving the assertion's intent). Then a manual smoke: `npx tsx server/index.ts` against the dev DB, `curl -s localhost:3001/trade-ups | head -40` → small shell HTML with injected `<title>` containing "Trade-Ups", no landing hero markup (`grep -c "FAQ"` → 0); `curl -s localhost:3001/ | grep -c "trade-ups"` → prerendered landing still served. Ctrl-C the server.

### Step 3: Vendor chunk splitting

In `vite.config.ts` add:

```ts
build: {
  rollupOptions: {
    output: {
      manualChunks: {
        vendor: ["react", "react-dom", "react-router-dom"],
      },
    },
  },
},
```

(If Plan 003 Step 4 removed react-helmet-async, do not list it; otherwise add it to vendor too.)

**Verify**: `npm run build` → exit 0; `ls dist/assets | grep vendor` → `vendor-*.js` exists (expect ~250–300KB raw); entry `index-*.js` drops correspondingly. Then make a whitespace-only change to `src/App.tsx`, rebuild, and confirm the `vendor-*.js` filename hash is UNCHANGED while `index-*.js` changed. Revert the whitespace change.

### Step 4: Preload the critical font

The Geist latin woff2 is emitted content-hashed (e.g. `dist/assets/geist-latin-wght-normal-*.woff2`). Add a tiny inline Vite plugin in `vite.config.ts`:

```ts
function preloadGeist() {
  return {
    name: "preload-geist",
    transformIndexHtml: {
      order: "post" as const,
      handler(html: string, ctx: { bundle?: Record<string, unknown> }) {
        const file = Object.keys(ctx.bundle ?? {}).find(f => /geist-latin-wght-normal-.*\.woff2$/.test(f));
        if (!file) return html;
        return html.replace("</title>", `</title><link rel="preload" href="/${file}" as="font" type="font/woff2" crossorigin>`);
      },
    },
  };
}
```

and add `preloadGeist()` to `plugins`.

**Verify**: `npm run build` → exit 0; `grep -o 'rel="preload" href="/assets/geist-latin[^"]*"' dist/_shell.html` → one match; same grep on `dist/index.html` → present (prerender preserves head; `verify-seo-html` must still pass).

### Step 5: Precompress assets and serve them

1. `npm install -D vite-plugin-compression2` and add to plugins: brotli + gzip for assets > 1KB.
2. `npm install express-static-gzip`. In `server/index.ts`, replace the `express.static(distPath, ...)` call with:

```ts
import expressStaticGzip from "express-static-gzip"; // top of file
app.use(expressStaticGzip(distPath, {
  enableBrotli: true,
  orderPreference: ["br", "gz"],
  serveStatic: { setHeaders: /* keep the existing setHeaders function exactly */ },
}));
```

Keep `app.use(compression())` for dynamic JSON/HTML responses.

**Verify**: `npm run build` → `ls dist/assets/*.br | head -3` shows brotli artifacts; run the server and `curl -sI -H "Accept-Encoding: br" localhost:3001/assets/$(ls dist/assets | grep '^vendor.*\.js$' | head -1) | grep -i content-encoding` → `br`; with `Accept-Encoding: gzip` → `gzip`; `cache-control: public, max-age=31536000, immutable` still present on /assets/.

### Step 6: public/ image hygiene

1. For every file in `public/` (excluding favicon/robots-adjacent files), check references: `grep -rn "<name>" src/ server/ index.html content/ scripts/ docs/`. Build the unreferenced list yourself.
2. Delete only files with zero references AND > 100KB. List every deletion in the commit message.
3. In the `setHeaders` function, add: non-asset images (`.png/.jpg/.jpeg/.webp/.svg` outside `/assets/`) get `Cache-Control: public, max-age=86400`.

**Verify**: `npm run build` exit 0; `npm run test:unit` pass; for one kept image `curl -sI localhost:3001/tradeuptable.jpg | grep -i cache-control` → `max-age=86400`.

## Test plan

- The repo's own gates are the core net: `npm run build` (prerender + `verify-seo-html.ts`) and `npm run test:unit`.
- Add one unit test `tests/unit/spa-shell.test.ts`: source-string assertions that `server/index.ts` reads `_shell.html` and that `scripts/prerender.ts` contains the `copyFileSync(... "_shell.html")` call — mirroring the style of `tests/unit/seo-pages.test.ts`.
- After deploy (operator step): `npm run verify:seo:public -- --routes=/calculator,/faq,/blog/how-cs2-trade-ups-work/`.

## Done criteria

- [ ] `dist/_shell.html` produced by build; `/trade-ups` (non-crawler) serves shell, `/` serves prerendered landing
- [ ] `vendor-*.js` chunk stable across an app-only change (hash unchanged)
- [ ] Font preload present in both shell and prerendered heads
- [ ] `.br` artifacts emitted and served with `content-encoding: br`
- [ ] `npm run build`, `npm run typecheck`, `npm run test:unit` all exit 0
- [ ] Only in-scope files modified; `plans/README.md` updated

## STOP conditions

- `verify-seo-html.ts` fails twice after any step — the SEO pipeline is load-bearing revenue infrastructure here.
- `registerBlogRoutes` turns out to inject into prerendered blog HTML rather than the SPA shell (read `server/blog-routes.ts` before Step 2; if blog non-crawler responses regress to an empty shell, keep blog routes on `indexHtml` and note it).
- express-static-gzip's setHeaders hook cannot reproduce the existing header behavior exactly.
- You cannot verify locally because no local PG exists for booting the server — report; do not skip the curl verifications silently.

## Maintenance notes

- The `_shell.html`/`index.html` split is invisible to the deploy pipeline (rsync copies both), but anyone hand-editing `dist/` must know `/` and SPA routes serve different files.
- If nginx later takes over static serving, move brotli to `brotli_static` and drop express-static-gzip.
- Route-aware modulepreload (injecting per-route chunk hints from `.vite/manifest.json`) was considered and deferred: the vendor split + correct shell removes most of the waterfall; revisit if Lighthouse still shows chunk discovery latency.
