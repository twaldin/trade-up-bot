/**
 * @vitest-environment happy-dom
 *
 * User-visible GA4 hygiene: a landing URL's page_location drops auth and the
 * other hand-off params, and each client navigation sends one history page_view.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { BrowserRouter, Link, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AUTH_RETURN_STRIP_SOURCE } from "../../shared/auth-return-strip.js";
import { useSpaPageView } from "../../src/lib/spa-page-view.js";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "../..");
const GA4 = "G-2474G4P5QE";
const PIXEL = "123456789012345";
const HANDOFF = /(?:^|[?&#])(?:auth|lid|eid|session_id|upgraded)=/;

type PageView = { source: "config" | "history" | "app"; dl: string };

function runHeadStrip(): void {
  const run = new Function("window", "location", "history", "URLSearchParams", AUTH_RETURN_STRIP_SOURCE);
  run(window, window.location, window.history, URLSearchParams);
}

function pageLocation(): string {
  const scrubbed = (window as Window & { __tubPageLocation?: string }).__tubPageLocation;
  return scrubbed || window.location.href;
}

function installCollectors(views: PageView[]): () => void {
  const original = history.pushState.bind(history);
  history.pushState = ((data: unknown, unused: string, url?: string | URL | null) => {
    const before = location.href;
    original(data, unused, url);
    if (location.href !== before) views.push({ source: "history", dl: location.href });
  }) as History["pushState"];
  window.gtag = (command: string, name: string, params?: { page_location?: string }) => {
    if (command === "event" && name === "page_view") {
      views.push({ source: "app", dl: params?.page_location || location.href });
    }
  };
  window.fbq = vi.fn();
  window.tubTracking = { ga4MeasurementId: GA4, metaPixelId: PIXEL };
  return () => {
    history.pushState = original;
  };
}

function NavProbe(): ReactElement {
  const { pathname } = useLocation();
  useSpaPageView(pathname);
  return createElement("nav", null,
    createElement(Link, { to: "/trade-ups" }, "Trade-ups"),
    createElement(Link, { to: "/calculator" }, "Calculator"),
  );
}

describe("page_location on an auth landing", () => {
  afterEach(() => {
    window.history.replaceState(null, "", "/");
    delete (window as Window & { __tubPageLocation?: string }).__tubPageLocation;
    delete (window as Window & { __tubAuthReturn?: unknown }).__tubAuthReturn;
    delete (window as Window & { __tubCheckoutReturn?: unknown }).__tubCheckoutReturn;
  });

  it("sends gtag a page_location with auth and the other hand-off params removed", () => {
    const cases = [
      {
        href: "/?auth=failed",
        location: `${location.origin}/`,
      },
      {
        href: "/trade-ups?auth=failed&utm_source=google&gclid=Cj0K",
        location: `${location.origin}/trade-ups?utm_source=google&gclid=Cj0K`,
      },
      {
        href: "/?auth=denied&lid=123&eid=old&session_id=cs_x&upgraded=1&utm_source=google#top",
        location: `${location.origin}/?utm_source=google#top`,
      },
    ];
    for (const spec of cases) {
      window.history.replaceState(null, "", spec.href);
      runHeadStrip();
      const sent = pageLocation();
      expect(sent, spec.href).toBe(spec.location);
      expect(sent, spec.href).not.toMatch(HANDOFF);
      expect(location.href, spec.href).toBe(spec.location);
    }
  });
});

describe("one GA4 page_view per client navigation", () => {
  let root: Root;
  let host: HTMLDivElement;
  let restoreHistory: () => void;
  const views: PageView[] = [];

  afterEach(() => {
    act(() => { root?.unmount(); });
    host?.remove();
    restoreHistory?.();
    views.length = 0;
    window.gtag = undefined;
    window.fbq = undefined;
    window.tubTracking = undefined;
    window.history.replaceState(null, "", "/");
    delete (window as Window & { __tubPageLocation?: string }).__tubPageLocation;
  });

  async function land(href: string): Promise<void> {
    window.history.replaceState(null, "", href);
    runHeadStrip();
    restoreHistory = installCollectors(views);
    views.push({ source: "config", dl: pageLocation() });
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root.render(createElement(BrowserRouter, null, createElement(NavProbe)));
    });
  }

  function clickTo(path: string): void {
    const link = [...host.querySelectorAll("a")].find((node) => node.getAttribute("href") === path);
    if (!link) throw new Error(`no link to ${path}`);
    act(() => { link.click(); });
  }

  it("records the scrubbed landing once, then one history page_view from / to /trade-ups", async () => {
    await land("/?auth=failed&utm_source=google");
    expect(views).toEqual([
      { source: "config", dl: `${location.origin}/?utm_source=google` },
    ]);
    expect(window.fbq).not.toHaveBeenCalled();

    clickTo("/trade-ups");

    expect(location.pathname).toBe("/trade-ups");
    expect(views.map((view) => view.source)).toEqual(["config", "history"]);
    expect(views[1]).toEqual({ source: "history", dl: `${location.origin}/trade-ups` });
    expect(views.every((view) => !HANDOFF.test(view.dl))).toBe(true);
    expect(window.fbq).toHaveBeenCalledTimes(1);
    expect(window.fbq).toHaveBeenCalledWith("track", "PageView");
  });

  it("sends one more page_view on the next client navigation and none for the first render", async () => {
    await land("/trade-ups?auth=failed");
    expect(views).toEqual([
      { source: "config", dl: `${location.origin}/trade-ups` },
    ]);

    clickTo("/calculator");
    clickTo("/trade-ups");

    expect(views.map((view) => view.source)).toEqual(["config", "history", "history"]);
    expect(views.map((view) => view.dl)).toEqual([
      `${location.origin}/trade-ups`,
      `${location.origin}/calculator`,
      `${location.origin}/trade-ups`,
    ]);
    expect(window.fbq).toHaveBeenCalledTimes(2);
  });
});

describe("analytics wiring", () => {
  it("keeps GA history measurement on and leaves page views out of the app shell", () => {
    const indexHtml = readFileSync(join(rootDir, "index.html"), "utf8");
    const appSource = readFileSync(join(rootDir, "src/App.tsx"), "utf8");
    const gate = readFileSync(join(rootDir, "scripts/analytics-pageview-gate.mjs"), "utf8");
    expect(indexHtml).toContain("page_location: window.__tubPageLocation || location.href");
    expect(indexHtml).not.toContain("send_page_view");
    expect(appSource).toContain("useSpaPageView(pathname)");
    expect(appSource).not.toContain('trackEvent("page_view"');
    expect(appSource).not.toContain("gtag(");
    expect(gate).toContain("GATE_ARTIFACTS_DIR");
    expect(gate).not.toContain("/opt/cursor/artifacts");
  });
});
