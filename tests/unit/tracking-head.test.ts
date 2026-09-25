import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { injectTrackingHead } from "../../shared/tracking-head.js";

const __dir = dirname(fileURLToPath(import.meta.url));
const indexHtml = readFileSync(join(__dir, "../../index.html"), "utf-8");

const THIRD_PARTY = /connect\.facebook\.net|facebook\.com\/tr|facebook-domain-verification|tubTracking/;

describe("injectTrackingHead with no env", () => {
  it("returns the first HTML byte-for-byte unchanged", () => {
    expect(injectTrackingHead(indexHtml, {})).toBe(indexHtml);
    expect(injectTrackingHead(indexHtml, { GA4_MEASUREMENT_ID: "", META_PIXEL_ID: "", META_DOMAIN_VERIFICATION: "" })).toBe(indexHtml);
  });

  it("adds no Meta script, pixel, verification tag, or tracking config", () => {
    expect(injectTrackingHead(indexHtml, {})).not.toMatch(THIRD_PARTY);
  });

  it("treats malformed ids as unset instead of injecting them", () => {
    const html = injectTrackingHead(indexHtml, {
      GA4_MEASUREMENT_ID: "G-X'</script><script>alert(1)",
      META_PIXEL_ID: "12<b>",
      META_DOMAIN_VERIFICATION: "\"><script>",
    });
    expect(html).toBe(indexHtml);
  });
});

describe("injectTrackingHead with META_PIXEL_ID", () => {
  const html = injectTrackingHead(indexHtml, { META_PIXEL_ID: "123456789012345" });
  const head = html.slice(0, html.indexOf("</head>"));

  it("installs the Pixel base code with PageView inside <head>", () => {
    expect(head).toContain("https://connect.facebook.net/en_US/fbevents.js");
    expect(head).toContain("fbq('init','123456789012345')");
    expect(head).toContain("fbq('track','PageView')");
  });

  it("exposes the pixel id to the app and nothing server-side", () => {
    expect(head).toContain('window.tubTracking={"metaPixelId":"123456789012345"}');
    expect(html).not.toMatch(/META_CAPI_TOKEN|GA4_API_SECRET/);
  });

  it("drops its own loader tag after it settles so prerendered HTML never bakes a second copy", () => {
    expect(head).toMatch(/t\.onload=t\.onerror=function\(\)\{t\.parentNode&&t\.parentNode\.removeChild\(t\)\}/);
  });

  it("does not add a domain-verification tag unless that var is set", () => {
    expect(html).not.toContain("facebook-domain-verification");
  });
});

describe("injectTrackingHead with META_DOMAIN_VERIFICATION", () => {
  it("adds only the verification meta tag", () => {
    const html = injectTrackingHead(indexHtml, { META_DOMAIN_VERIFICATION: "abcdef0123456789abcdef01234567" });
    expect(html).toContain('<meta name="facebook-domain-verification" content="abcdef0123456789abcdef01234567" />');
    expect(html).not.toMatch(/connect\.facebook\.net|tubTracking/);
  });
});

describe("injectTrackingHead with GA4_MEASUREMENT_ID", () => {
  it("reuses the existing Google tag and only adds a config for a new property", () => {
    const html = injectTrackingHead(indexHtml, { GA4_MEASUREMENT_ID: "G-NEWPROP123" });
    expect(html).toContain("gtag('config','G-NEWPROP123')");
    expect(html.match(/googletagmanager\.com\/gtag\/js/g)?.length).toBe(1);
    expect(html).toContain('window.tubTracking={"ga4MeasurementId":"G-NEWPROP123"}');
  });

  it("does not configure the same property twice when it matches the hardcoded tag", () => {
    const html = injectTrackingHead(indexHtml, { GA4_MEASUREMENT_ID: "G-EKWRB4FE37" });
    expect(html.match(/gtag\('config', ?'G-EKWRB4FE37'\)/g)?.length).toBe(1);
    expect(html).toContain('window.tubTracking={"ga4MeasurementId":"G-EKWRB4FE37"}');
  });

  it("installs the full Google tag when the page has none", () => {
    const bare = "<html><head><title>x</title></head><body></body></html>";
    const html = injectTrackingHead(bare, { GA4_MEASUREMENT_ID: "G-NEWPROP123" });
    expect(html).toContain('<script async src="https://www.googletagmanager.com/gtag/js?id=G-NEWPROP123"></script>');
    expect(html).toContain("function gtag(){dataLayer.push(arguments);}");
    expect(html).toContain("gtag('config','G-NEWPROP123')");
  });
});

describe("injectTrackingHead with everything set", () => {
  it("puts the config before the pixel so app code can read it and places all tags in <head>", () => {
    const html = injectTrackingHead(indexHtml, {
      GA4_MEASUREMENT_ID: "G-NEWPROP123",
      META_PIXEL_ID: "123456789012345",
      META_DOMAIN_VERIFICATION: "abcdef0123456789abcdef01234567",
    });
    const headEnd = html.indexOf("</head>");
    for (const needle of ["facebook-domain-verification", "tubTracking", "fbevents.js", "G-NEWPROP123"]) {
      const at = html.indexOf(needle);
      expect(at).toBeGreaterThan(-1);
      expect(at).toBeLessThan(headEnd);
    }
    expect(html).toContain('window.tubTracking={"ga4MeasurementId":"G-NEWPROP123","metaPixelId":"123456789012345"}');
    expect(html.indexOf("tubTracking")).toBeLessThan(html.indexOf("fbevents.js"));
  });
});
