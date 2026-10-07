import express from "express";
import helmet from "helmet";
import request from "supertest";
import { describe, expect, it } from "vitest";
import {
  REFERRER_POLICY,
  helmetSecurityOptions,
  staticHtmlSecurityHeaders,
} from "../../server/security-headers.js";

const GA_ENV = { GA4_MEASUREMENT_ID: "G-2474G4P5QE" };
const PIXEL_ENV = { ...GA_ENV, META_PIXEL_ID: "123456789012345" };

function headerList(value: string | undefined): string[] {
  return (value ?? "").split(",").map((part) => part.trim()).filter(Boolean);
}

describe("helmet security headers", () => {
  it("sends one Referrer-Policy, one HSTS, and one framing header", async () => {
    const app = express();
    app.use(helmet(helmetSecurityOptions(GA_ENV)));
    app.get("/api/global-stats", (_req, res) => {
      res.json({ ok: true });
    });
    const res = await request(app).get("/api/global-stats");
    expect(res.headers["referrer-policy"]).toBe(REFERRER_POLICY);
    expect(headerList(res.headers["referrer-policy"])).toEqual([REFERRER_POLICY]);
    expect(res.headers["strict-transport-security"]).toBe("max-age=31536000; includeSubDomains");
    expect(headerList(res.headers["x-frame-options"])).toEqual(["DENY"]);
    expect(headerList(res.headers["x-content-type-options"])).toEqual(["nosniff"]);
    expect(res.headers["content-security-policy"]).toContain("https://www.googletagmanager.com");
    expect(res.headers["content-security-policy"]).toContain("https://checkout.stripe.com");
    expect(res.headers["content-security-policy"]).not.toContain("facebook");
    expect(res.headers["content-security-policy"]).not.toContain("report-only");
  });

  it("adds Meta hosts only when a pixel id is configured", () => {
    const off = staticHtmlSecurityHeaders(GA_ENV)["Content-Security-Policy"];
    const on = staticHtmlSecurityHeaders(PIXEL_ENV)["Content-Security-Policy"];
    expect(off).not.toContain("facebook");
    expect(off).not.toContain("connect.facebook.net");
    expect(on).toContain("https://connect.facebook.net");
    expect(on).toContain("https://www.facebook.com");
  });

  it("keeps static HTML headers aligned with helmet and limited to one owner each", () => {
    const headers = staticHtmlSecurityHeaders(GA_ENV);
    expect(Object.keys(headers)).toEqual([
      "Content-Security-Policy",
      "Referrer-Policy",
      "Strict-Transport-Security",
      "X-Content-Type-Options",
      "X-Frame-Options",
    ]);
    expect(headers["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["Strict-Transport-Security"]).toBe("max-age=31536000; includeSubDomains");
    expect(headers["X-Frame-Options"]).toBe("DENY");
    expect(headers["Content-Security-Policy"]).toContain("https://www.google-analytics.com");
    expect(headers["Content-Security-Policy"]).toContain("https://*.google-analytics.com");
    expect(headers["Content-Security-Policy"]).toContain("https://fonts.googleapis.com");
    expect(headers["Content-Security-Policy"]).toContain("https://fonts.gstatic.com");
    expect(headers["Content-Security-Policy"]).toContain("https://open.er-api.com");
    expect(headers["Content-Security-Policy"]).toContain("https://avatars.steamstatic.com");
  });
});
