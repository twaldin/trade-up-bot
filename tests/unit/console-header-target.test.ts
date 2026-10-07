/**
 * Header Sign in / Pro and the detail gate, measured in Chromium at the
 * phone and desktop widths. happy-dom does not apply min-height.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import puppeteer, { type Browser } from "puppeteer";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PreviewShell } from "../../src/preview/PreviewShell.js";
import { proPriceLine } from "../../src/preview/lib/pro-pricing.js";
import { ShareAuthGate } from "../../src/preview/pages/PreviewShare.js";
import type { AuthUser } from "../../src/preview/lib/auth-state.js";

const dir = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(resolve(dir, "../../src/preview/preview.css"), "utf8");
const board = readFileSync(resolve(dir, "../../src/preview/pages/PreviewBoard.tsx"), "utf8");

function markup(session?: AuthUser | null) {
  const panel = session && session.tier === "free" && !session.is_admin && !session.lifetime ? "upgrade" : "sign-in";
  return renderToStaticMarkup(createElement(MemoryRouter, null, createElement("div", null,
    createElement(PreviewShell, {
      mode: "dark",
      onMode: () => {},
      session,
      children: null,
    }),
    createElement(ShareAuthGate, { panel }),
  )));
}

describe("header and detail gates", () => {
  it("shows Sign in to guests and Pro to free accounts, with the price from the plan config", () => {
    const loggedOut = markup(null);
    expect(loggedOut).toContain('data-header-auth="sign-in"');
    expect(loggedOut).not.toContain('data-header-auth="pro"');
    expect(loggedOut).toContain("Sign in with Steam (free)");
    expect(loggedOut).toContain('data-detail-auth="sign-in"');

    const free = markup({ steam_id: "1", tier: "free" });
    expect(free).toContain('data-header-auth="pro"');
    expect(free).not.toContain("Sign in");
    expect(free).toContain(`Claim with Pro · ${proPriceLine("monthly")}`);
    expect(free).toContain('data-detail-auth="pro"');
    expect(proPriceLine("monthly")).toBe("$6.99/mo");

    for (const user of [
      { steam_id: "1", tier: "pro" },
      { steam_id: "1", tier: "admin" },
      { steam_id: "1", tier: "free", is_admin: true },
      { steam_id: "1", tier: "free", lifetime: true },
    ] satisfies AuthUser[]) {
      expect(markup(user)).not.toContain("data-header-auth");
    }
    expect(markup()).not.toContain("data-header-auth");
  });

  it("leaves the board card Verify path alone", () => {
    expect(board).toContain('trackVerifyClick("board_card")');
    expect(board).toContain("verifyClaimHref(tu.id)");
    expect(board).not.toContain("detail_claim");
    expect(board).not.toContain("header_pro");
    expect(board).not.toContain("Sign in with Steam (free)");
  });
});

describe("header and detail hit targets", () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
  }, 30000);

  afterAll(async () => {
    await browser?.close();
  });

  it.each([390, 1280])("keeps 44px targets and a single nav row at %ipx", async (width) => {
    const page = await browser.newPage();
    await page.setViewport({ width, height: 800 });
    await page.setContent(
      `<!doctype html><style>html,body{margin:0}${css}</style>${markup(null)}`,
      { waitUntil: "domcontentloaded" },
    );
    const guest = await page.evaluate(() => {
      const bar = document.querySelector(".preview-console__bar");
      const nav = document.querySelector(".preview-console__mobile");
      const auth = document.querySelector("[data-header-auth]");
      const detail = document.querySelector("[data-detail-auth]");
      const links = [...document.querySelectorAll(".preview-console__mobile a")];
      const authBox = auth?.getBoundingClientRect();
      const detailBox = detail?.getBoundingClientRect();
      const navBox = nav?.getBoundingClientRect();
      const tops = links.map((el) => el.getBoundingClientRect().top);
      return {
        barHeight: bar?.getBoundingClientRect().height ?? 0,
        navDisplay: nav ? getComputedStyle(nav).display : "missing",
        sidebarDisplay: getComputedStyle(document.querySelector(".preview-sidebar")!).display,
        auth: authBox ? { w: authBox.width, h: authBox.height, left: authBox.left, text: auth?.textContent?.trim() } : null,
        detail: detailBox ? { w: detailBox.width, h: detailBox.height, text: detail?.textContent?.trim() } : null,
        navRight: navBox?.right ?? 0,
        topSpread: tops.length ? Math.max(...tops) - Math.min(...tops) : -1,
        scrollWidth: document.documentElement.scrollWidth,
      };
    });
    expect(guest.auth?.text).toBe("Sign in");
    expect(guest.auth?.h).toBeGreaterThanOrEqual(44);
    expect(guest.auth?.w).toBeGreaterThanOrEqual(44);
    expect(guest.detail?.text).toBe("Sign in with Steam (free)");
    expect(guest.detail?.h).toBeGreaterThanOrEqual(44);
    expect(guest.detail?.w).toBeGreaterThanOrEqual(44);
    expect(guest.barHeight).toBeGreaterThan(0);
    expect(guest.barHeight).toBeLessThan(80);
    expect(guest.scrollWidth).toBeLessThanOrEqual(width + 1);
    if (width === 390) {
      expect(guest.navDisplay).toBe("flex");
      expect(guest.topSpread).toBeGreaterThanOrEqual(0);
      expect(guest.topSpread).toBeLessThan(2);
      expect(guest.navRight).toBeLessThanOrEqual((guest.auth?.left ?? 0) + 1);
    } else {
      expect(guest.navDisplay).toBe("none");
      expect(guest.sidebarDisplay).toBe("flex");
    }

    await page.setContent(
      `<!doctype html><style>html,body{margin:0}${css}</style>${markup({ steam_id: "1", tier: "free" })}`,
      { waitUntil: "domcontentloaded" },
    );
    const free = await page.evaluate(() => {
      const auth = document.querySelector("[data-header-auth]");
      const detail = document.querySelector("[data-detail-auth]");
      const authBox = auth?.getBoundingClientRect();
      const detailBox = detail?.getBoundingClientRect();
      return {
        auth: authBox ? { w: authBox.width, h: authBox.height, text: auth?.textContent?.trim() } : null,
        detail: detailBox ? { h: detailBox.height, text: detail?.textContent?.trim() } : null,
        scrollWidth: document.documentElement.scrollWidth,
      };
    });
    expect(free.auth?.text).toBe("Pro");
    expect(free.auth?.h).toBeGreaterThanOrEqual(44);
    expect(free.auth?.w).toBeGreaterThanOrEqual(44);
    expect(free.detail?.text).toBe(`Claim with Pro · ${proPriceLine("monthly")}`);
    expect(free.detail?.h).toBeGreaterThanOrEqual(44);
    expect(free.scrollWidth).toBeLessThanOrEqual(width + 1);
    await page.close();
  }, 20000);
});
