import type { NextFunction, Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";
import { redirectWwwHost } from "../../server/redirect-www.js";

function runRedirect(host: string | undefined, originalUrl: string) {
  const req = {
    headers: host === undefined ? {} : { host },
    originalUrl,
  } as Request;
  const redirect = vi.fn();
  const res: Partial<Response> = { redirect };
  const next: NextFunction = vi.fn();

  redirectWwwHost(req, res as Response, next);

  return { redirect, next };
}

describe("www host redirect", () => {
  it("301 redirects the www homepage to the apex homepage", () => {
    const { redirect, next } = runRedirect("www.tradeupbot.app", "/");

    expect(redirect).toHaveBeenCalledWith(301, "https://tradeupbot.app/");
    expect(next).not.toHaveBeenCalled();
  });

  it("301 redirects www deep paths to the matching apex path", () => {
    const { redirect, next } = runRedirect("www.tradeupbot.app", "/trade-ups");

    expect(redirect).toHaveBeenCalledWith(301, "https://tradeupbot.app/trade-ups");
    expect(next).not.toHaveBeenCalled();
  });

  it("preserves query strings while removing www", () => {
    const { redirect, next } = runRedirect("www.tradeupbot.app", "/trade-ups?type=classified");

    expect(redirect).toHaveBeenCalledWith(301, "https://tradeupbot.app/trade-ups?type=classified");
    expect(next).not.toHaveBeenCalled();
  });

  it("redirects www host case-insensitively when a port is present", () => {
    const { redirect, next } = runRedirect("WWW.TRADEUPBOT.APP:3001", "/collections");

    expect(redirect).toHaveBeenCalledWith(301, "https://tradeupbot.app/collections");
    expect(next).not.toHaveBeenCalled();
  });

  it("continues without redirecting the apex host", () => {
    const { redirect, next } = runRedirect("tradeupbot.app", "/trade-ups");

    expect(next).toHaveBeenCalledOnce();
    expect(redirect).not.toHaveBeenCalled();
  });
});
