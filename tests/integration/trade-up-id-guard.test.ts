import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { registerCanonicalRedirectRoutes } from "../../server/canonical-redirects.js";
import { registerTradeUpShareSeo } from "../../server/trade-up-share-seo.js";
import { createTestApp, type TestContext } from "./setup.js";

const GOOGLEBOT = "Googlebot/2.1";
const BROWSER = "Mozilla/5.0";
const THIRTY = "1".repeat(30);
const GUARD_TOKEN = "GuardTokenSkin";
const SCIENCE_TOKEN = "ScientificTokenSkin";
const SHELL = `<!DOCTYPE html><html><head><title>Home</title><meta name="robots" content="index, follow" /><meta name="robots" content="index, follow" /><link rel="canonical" href="https://tradeupbot.app/" /></head><body><div id="root"><p>homepage</p></div></body></html>`;

const BAD_IDS = [
  { name: "abc", api: "/api/trade-ups/abc", page: "/trade-ups/abc", leak: "abc" },
  { name: "1e9", api: "/api/trade-ups/1e9", page: "/trade-ups/1e9", leak: "1e9" },
  { name: "-1", api: "/api/trade-ups/-1", page: "/trade-ups/-1", leak: "-1" },
  { name: "01", api: "/api/trade-ups/01", page: "/trade-ups/01", leak: "01" },
  { name: "30-digit", api: `/api/trade-ups/${THIRTY}`, page: `/trade-ups/${THIRTY}`, leak: THIRTY },
  { name: "2147483648", api: "/api/trade-ups/2147483648", page: "/trade-ups/2147483648", leak: "2147483648" },
  { name: "999999999999", api: "/api/trade-ups/999999999999", page: "/trade-ups/999999999999", leak: "999999999999" },
  { name: "empty", api: "/api/trade-ups/", page: "/trade-ups//", leak: "" },
  { name: "trailing-slash", api: "/api/trade-ups/1/", page: "/trade-ups/1/", leak: GUARD_TOKEN },
];

function expectClean404(body: string, leak: string) {
  expect(body.toLowerCase()).not.toContain("stack");
  expect(body).not.toMatch(/at\s+\S+\s+\(/);
  if (leak) expect(body).not.toContain(leak);
}

describe("trade-up id guard", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp({ defaultTier: "pro", defaultUserId: "user_pro" });
    await ctx.pool.query(
      `INSERT INTO trade_ups (
         id, total_cost_cents, expected_value_cents, profit_cents, roi_percentage,
         chance_to_profit, type, listing_status, outcomes_json
       ) VALUES
         (1, 1000, 2000, 1000, 100, 0.5, 'classified_covert', 'active', $1),
         (1000000000, 1000, 2000, 1000, 100, 0.5, 'classified_covert', 'active', $2)`,
      [
        JSON.stringify([{ skin_name: GUARD_TOKEN, probability: 1, predicted_condition: "Field-Tested", estimated_price_cents: 2000 }]),
        JSON.stringify([{ skin_name: SCIENCE_TOKEN, probability: 1, predicted_condition: "Field-Tested", estimated_price_cents: 2000 }]),
      ],
    );
    registerCanonicalRedirectRoutes(ctx.app);
    registerTradeUpShareSeo(ctx.app, ctx.pool);
    ctx.app.locals.shellHtml = SHELL;
    ctx.app.get("*", (_req, res) => {
      res.status(200).type("html").send(SHELL);
    });
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it.each(BAD_IDS)("API $name is a fast JSON 404", async ({ api, leak }) => {
    const started = Date.now();
    const res = await request(ctx.app).get(api);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(res.status).toBe(404);
    expect(res.headers["content-type"]).toMatch(/json/);
    expect(res.body).toEqual({ error: "Trade-up not found" });
    expectClean404(res.text, leak);
  });

  it.each(BAD_IDS)("Googlebot $name is a fast 404 and not the homepage", async ({ page, leak }) => {
    const started = Date.now();
    const res = await request(ctx.app).get(page).set("User-Agent", GOOGLEBOT);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(res.status).toBe(404);
    expect(res.headers["x-robots-tag"]).toBe("noindex");
    expect(res.text).toBe("Trade-up not found");
    expect(res.text).not.toContain('href="https://tradeupbot.app/"');
    expect(res.text).not.toContain("homepage");
    expectClean404(res.text, leak);
  });

  it("does not load trade-up 1 for a leading zero or a trailing slash", async () => {
    const real = await request(ctx.app).get("/api/trade-ups/1");
    expect(real.status).toBe(200);
    expect(real.text).toContain(GUARD_TOKEN);

    const zero = await request(ctx.app).get("/api/trade-ups/01");
    expect(zero.status).toBe(404);
    expect(zero.text).not.toContain(GUARD_TOKEN);

    const slash = await request(ctx.app).get("/api/trade-ups/1/");
    expect(slash.status).toBe(404);
    expect(slash.text).not.toContain(GUARD_TOKEN);
  });

  it("does not treat 1e9 as contract 1000000000", async () => {
    const real = await request(ctx.app).get("/api/trade-ups/1000000000");
    expect(real.status).toBe(200);
    expect(real.text).toContain(SCIENCE_TOKEN);

    const sci = await request(ctx.app).get("/api/trade-ups/1e9");
    expect(sci.status).toBe(404);
    expect(sci.text).not.toContain(SCIENCE_TOKEN);

    const bot = await request(ctx.app).get("/trade-ups/1e9").set("User-Agent", GOOGLEBOT);
    expect(bot.status).toBe(404);
    expect(bot.text).not.toContain(SCIENCE_TOKEN);
  });

  it("returns the not-found page for a missing all-digit id", async () => {
    const api = await request(ctx.app).get("/api/trade-ups/999999");
    expect(api.status).toBe(404);
    expect(api.body).toEqual({ error: "Trade-up not found" });

    const bot = await request(ctx.app).get("/trade-ups/999999").set("User-Agent", GOOGLEBOT);
    expect(bot.status).toBe(404);
    expect(bot.headers["x-robots-tag"]).toBe("noindex");
    expect(bot.text).toBe("Trade-up not found");
    expect(bot.text).not.toContain("Trade-up no longer available");

    const browser = await request(ctx.app).get("/trade-ups/999999").set("User-Agent", BROWSER);
    expect(browser.status).toBe(404);
    expect(browser.headers["content-type"]).toMatch(/html/);
    expect(browser.headers["x-robots-tag"]).toBe("noindex");
    expect(browser.text).toContain("Trade-up not found");
    expect(browser.text).toContain('href="https://tradeupbot.app/trade-ups"');
    expect(browser.text).not.toContain('href="https://tradeupbot.app/"');
    expect(browser.text).not.toContain("<p>homepage</p>");
    expect(browser.text).not.toContain("Trade-up no longer available");
    const robots = [...browser.text.matchAll(/<meta\s+name="robots"[^>]*>/gi)];
    expect(robots).toHaveLength(1);
    expect(robots[0]?.[0]).toContain('content="noindex, follow"');
  });

  it("gives a browser the not-found page for /trade-ups// instead of the board", async () => {
    const res = await request(ctx.app).get("/trade-ups//").set("User-Agent", BROWSER);
    expect(res.status).toBe(404);
    expect(res.headers["x-robots-tag"]).toBe("noindex");
    expect(res.text).toContain("Trade-up not found");
    expect(res.text).not.toContain("<p>homepage</p>");
    expect(res.headers.location).toBeUndefined();
  });

  it("returns JSON 500 when the detail handler throws", async () => {
    const spy = vi.spyOn(ctx.pool, "query").mockRejectedValue(new Error("integer out of range\n    at Parser.parse (/opt/pg)"));
    try {
      const started = Date.now();
      const res = await request(ctx.app).get("/api/trade-ups/2");
      expect(Date.now() - started).toBeLessThan(2000);
      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: "Internal server error" });
      expect(res.text).not.toContain("Parser.parse");
      expect(res.text).not.toContain("integer out of range");
      expect(res.text).not.toContain("2");
    } finally {
      spy.mockRestore();
    }
  });

  it("does not fall through to the homepage when the crawler query throws", async () => {
    const spy = vi.spyOn(ctx.pool, "query").mockRejectedValue(new Error("connection reset\n    at Client.query (/opt/pg)"));
    try {
      const res = await request(ctx.app).get("/trade-ups/2").set("User-Agent", GOOGLEBOT);
      expect(res.status).toBe(503);
      expect(res.headers["x-robots-tag"]).toBe("noindex");
      expect(res.text).toBe("Trade-up unavailable");
      expect(res.text).not.toContain("homepage");
      expect(res.text).not.toContain("Client.query");
    } finally {
      spy.mockRestore();
    }
  });

  it("gives a browser a 404 shell whose canonical is not the homepage", async () => {
    const res = await request(ctx.app).get("/trade-ups/abc").set("User-Agent", BROWSER);
    expect(res.status).toBe(404);
    expect(res.headers["x-robots-tag"]).toBe("noindex");
    expect(res.text).toContain("Trade-up not found");
    expect(res.text).toContain('href="https://tradeupbot.app/trade-ups"');
    expect(res.text).not.toContain('href="https://tradeupbot.app/"');
    expect(res.text).not.toContain("abc");
    expect(res.text).not.toContain("<p>homepage</p>");
  });

  it("still lists trade-ups at the unsuffixed collection path", async () => {
    const res = await request(ctx.app).get("/api/trade-ups?per_page=1");
    expect(res.status).toBe(200);
  });
});
