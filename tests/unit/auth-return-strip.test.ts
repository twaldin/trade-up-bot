import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { AUTH_RETURN_STRIP_SOURCE } from "../../shared/auth-return-strip.js";
import { consumeAuthReturn, type AuthReturnStash } from "../../src/lib/auth-return.js";
import { injectTrackingHead } from "../../shared/tracking-head.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const indexHtml = readFileSync(join(root, "index.html"), "utf-8");
const appSource = readFileSync(join(root, "src/App.tsx"), "utf-8");
const serverSource = readFileSync(join(root, "server/index.ts"), "utf-8");
const NONCE = "ab".repeat(16);

function runStrip(href: string): { stash: unknown; pageLocation: unknown; replaced: string[] } {
  const url = new URL(href);
  const location = {
    href: url.href,
    origin: url.origin,
    pathname: url.pathname,
    search: url.search,
    hash: url.hash,
  };
  const replaced: string[] = [];
  const history = {
    state: { existing: true },
    replaceState(state: unknown, _title: string, next: string) {
      if (JSON.stringify(state) !== JSON.stringify({ existing: true })) {
        throw new Error("replaceState dropped history.state");
      }
      replaced.push(next);
    },
  };
  const window: { __tubAuthReturn?: unknown; __tubPageLocation?: string } = {};
  vm.runInNewContext(AUTH_RETURN_STRIP_SOURCE, { window, location, history, URLSearchParams });
  return { stash: window.__tubAuthReturn, pageLocation: window.__tubPageLocation, replaced };
}

describe("auth return strip script", () => {
  it("sits in index.html before gtag config and passes a clean page_location", () => {
    expect(indexHtml).toContain(AUTH_RETURN_STRIP_SOURCE);
    expect(indexHtml.indexOf(AUTH_RETURN_STRIP_SOURCE)).toBeLessThan(indexHtml.indexOf("gtag('config'"));
    expect(indexHtml.indexOf("gtag/js")).toBeGreaterThan(indexHtml.indexOf(AUTH_RETURN_STRIP_SOURCE));
    expect(indexHtml).toContain("page_location: window.__tubPageLocation || location.href");
  });

  it("stashes auth and lid and keeps other params and the hash", () => {
    const result = runStrip(`https://tradeupbot.app/pricing?utm_source=google&auth=return&lid=${NONCE}&fbclid=click#plans`);
    expect(result.stash).toEqual({ auth: "return", lid: NONCE });
    expect(result.replaced).toEqual(["/pricing?utm_source=google&fbclid=click#plans"]);
    expect(result.pageLocation).toBe("https://tradeupbot.app/pricing?utm_source=google&fbclid=click#plans");
  });

  it("stashes a new account without a nonce and drops a leftover eid", () => {
    const result = runStrip("https://tradeupbot.app/trade-ups?session_id=cs_test&auth=new&eid=old");
    expect(result.stash).toEqual({ auth: "new", lid: null });
    expect(result.replaced).toEqual(["/trade-ups?session_id=cs_test"]);
    expect(result.pageLocation).toBe("https://tradeupbot.app/trade-ups?session_id=cs_test");
  });

  it("leaves a url without auth or lid unchanged", () => {
    const result = runStrip("https://tradeupbot.app/pricing?utm_source=google#plans");
    expect(result.stash).toBeUndefined();
    expect(result.replaced).toEqual([]);
    expect(result.pageLocation).toBe("https://tradeupbot.app/pricing?utm_source=google#plans");
  });

  it("runs before gtag config and an injected pixel PageView", () => {
    const html = injectTrackingHead(indexHtml, { META_PIXEL_ID: "123456789012345", GA4_MEASUREMENT_ID: "G-NEWPROP123" });
    const stripAt = html.indexOf("__tubAuthReturn");
    const configAt = html.indexOf("gtag('config'");
    const pixelAt = html.indexOf("fbq('track','PageView')");
    expect(stripAt).toBeGreaterThan(-1);
    expect(stripAt).toBeLessThan(configAt);
    expect(configAt).toBeLessThan(pixelAt);
    expect(html).toContain("page_location:window.__tubPageLocation||location.href");
  });
});

describe("app consumes the stashed lid", () => {
  it("reads the stashed nonce and does not read location.search", () => {
    const stash: AuthReturnStash = { auth: "return", lid: NONCE };
    let current: AuthReturnStash | null = stash;
    expect(consumeAuthReturn(() => current, () => { current = null; })).toEqual({ auth: "return", lid: NONCE });
    expect(consumeAuthReturn(() => current, () => { current = null; })).toBeNull();
    expect(appSource).toContain("consumeAuthReturn()");
    expect(appSource).not.toContain('searchParams.get("lid")');
    expect(appSource).not.toContain('searchParams.get("auth")');
  });

  it("reads window.__tubAuthReturn by default and then clears it", () => {
    const holder: { window?: { __tubAuthReturn?: AuthReturnStash | null } } = {};
    holder.window = { __tubAuthReturn: { auth: "return", lid: NONCE } };
    const previous = (globalThis as { window?: unknown }).window;
    (globalThis as { window?: unknown }).window = holder.window;
    try {
      expect(consumeAuthReturn()).toEqual({ auth: "return", lid: NONCE });
      expect(holder.window.__tubAuthReturn).toBeNull();
    } finally {
      (globalThis as { window?: unknown }).window = previous;
    }
  });
});

describe("inline tracking scripts and CSP", () => {
  it("allows the strip script the same way as the inline gtag snippet", () => {
    expect(serverSource).toContain(`"'unsafe-inline'"`);
    expect(serverSource).toMatch(/scriptSrc:\s*\[[^\]]*'unsafe-inline'/);
    expect(indexHtml).not.toMatch(/<script[^>]*\bnonce=/);
  });
});
