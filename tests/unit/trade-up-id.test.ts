import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { asyncHandler } from "../../server/async-handler.js";
import { shouldRedirectToNoTrailingSlash } from "../../server/canonical-redirects.js";
import { isRepeatedTradeUpSlash, parseTradeUpId, TRADE_UP_ID_MAX } from "../../shared/trade-up-id.js";

describe("parseTradeUpId", () => {
  it("accepts 1 through the int4 max", () => {
    expect(parseTradeUpId("1")).toBe(1);
    expect(parseTradeUpId("2147483647")).toBe(TRADE_UP_ID_MAX);
  });

  it("rejects non-numeric, scientific, negative, leading-zero, empty, and oversized ids", () => {
    expect(parseTradeUpId("abc")).toBeNull();
    expect(parseTradeUpId("1e9")).toBeNull();
    expect(parseTradeUpId("-1")).toBeNull();
    expect(parseTradeUpId("01")).toBeNull();
    expect(parseTradeUpId("0")).toBeNull();
    expect(parseTradeUpId("")).toBeNull();
    expect(parseTradeUpId("1/")).toBeNull();
    expect(parseTradeUpId("2147483648")).toBeNull();
    expect(parseTradeUpId("999999999999")).toBeNull();
    expect(parseTradeUpId("1".repeat(30))).toBeNull();
  });
});

describe("repeated trade-up slashes", () => {
  it("treats /trade-ups// as an empty id and leaves the board slash alone", () => {
    expect(isRepeatedTradeUpSlash("/trade-ups//")).toBe(true);
    expect(isRepeatedTradeUpSlash("/trade-ups///")).toBe(true);
    expect(isRepeatedTradeUpSlash("/trade-ups/")).toBe(false);
    expect(isRepeatedTradeUpSlash("/trade-ups")).toBe(false);
    expect(isRepeatedTradeUpSlash("/trade-ups/1")).toBe(false);
  });
});

describe("trade-up trailing slash is not a canonical redirect", () => {
  it("keeps the board slash redirect and does not send an id slash to the live contract", () => {
    expect(shouldRedirectToNoTrailingSlash("/trade-ups/")).toBe(true);
    expect(shouldRedirectToNoTrailingSlash("/trade-ups/1/")).toBe(false);
    expect(shouldRedirectToNoTrailingSlash("/trade-ups/01/")).toBe(false);
    expect(shouldRedirectToNoTrailingSlash("/trade-ups//")).toBe(false);
  });
});

describe("asyncHandler", () => {
  it("returns JSON 500 when the handler throws", async () => {
    const app = express();
    app.get("/boom", asyncHandler(async () => {
      throw new Error("boom\n    at Parser.parse (/secret/id)");
    }));
    app.use((_err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(500).json({ error: "Internal server error" });
    });

    const started = Date.now();
    const res = await request(app).get("/boom");
    expect(Date.now() - started).toBeLessThan(2000);
    expect(res.status).toBe(500);
    expect(res.headers["content-type"]).toMatch(/json/);
    expect(res.body).toEqual({ error: "Internal server error" });
    expect(res.text).not.toContain("Parser.parse");
    expect(res.text).not.toContain("boom");
  });
});
