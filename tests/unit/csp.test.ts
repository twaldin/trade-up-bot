import { describe, expect, it } from "vitest";
import { contentSecurityPolicyDirectives, staticHtmlSecurityHeaders } from "../../server/security-headers.js";

const GA_ENV = { GA4_MEASUREMENT_ID: "G-2474G4P5QE" };

describe("production CSP", () => {
  it("allows https://www.google.com on connect-src for GA4 /g/collect", () => {
    const directives = contentSecurityPolicyDirectives(GA_ENV);
    expect(directives.connectSrc).toContain("https://www.google.com");
    for (const [name, values] of Object.entries(directives)) {
      if (name === "connectSrc") continue;
      expect(values.join(" ")).not.toContain("www.google.com");
    }
    const header = staticHtmlSecurityHeaders(GA_ENV)["Content-Security-Policy"];
    expect(header).toContain("connect-src");
    expect(header).toContain("https://www.google.com");
  });
});
