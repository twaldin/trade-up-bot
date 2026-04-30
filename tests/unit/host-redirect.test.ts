import type { NextFunction, Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";
import { redirectWwwHost } from "../../server/redirect-www.js";

describe("redirectWwwHost", () => {
  it("redirects www host and preserves path + query", () => {
    const req = {
      headers: { host: "www.tradeupbot.app" },
      originalUrl: "/trade-ups?x=1",
    } as Request;
    const redirect = vi.fn();
    const res: Partial<Response> = { redirect };
    const next: NextFunction = vi.fn();

    redirectWwwHost(req, res as Response, next);

    expect(redirect).toHaveBeenCalledWith(301, "https://tradeupbot.app/trade-ups?x=1");
    expect(next).not.toHaveBeenCalled();
  });

  it("redirects case-insensitively", () => {
    const req = {
      headers: { host: "WWW.TRADEUPBOT.APP" },
      originalUrl: "/trade-ups",
    } as Request;
    const redirect = vi.fn();
    const res: Partial<Response> = { redirect };
    const next: NextFunction = vi.fn();

    redirectWwwHost(req, res as Response, next);

    expect(redirect).toHaveBeenCalledWith(301, "https://tradeupbot.app/trade-ups");
    expect(next).not.toHaveBeenCalled();
  });

  it("calls next for non-www host", () => {
    const req = {
      headers: { host: "tradeupbot.app" },
      originalUrl: "/trade-ups",
    } as Request;
    const redirect = vi.fn();
    const res: Partial<Response> = { redirect };
    const next: NextFunction = vi.fn();

    redirectWwwHost(req, res as Response, next);

    expect(next).toHaveBeenCalledOnce();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("calls next when host header is missing", () => {
    const req = {
      headers: {},
      originalUrl: "/trade-ups",
    } as Request;
    const redirect = vi.fn();
    const res: Partial<Response> = { redirect };
    const next: NextFunction = vi.fn();

    redirectWwwHost(req, res as Response, next);

    expect(next).toHaveBeenCalledOnce();
    expect(redirect).not.toHaveBeenCalled();
  });
});
