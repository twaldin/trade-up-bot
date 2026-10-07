// Helmet owns these headers on Express responses (API and Node HTML).
// nginx owns the same five on static HTML and must not set them on
// proxy_pass locations — that pairing is what doubled Referrer-Policy,
// HSTS, X-Frame-Options, and X-Content-Type-Options.
//
// The CSP is enforced, not report-only. Node already enforces this policy
// on /trade-ups and /pricing. Meta hosts are added only when META_PIXEL_ID
// is set; the shipped pages do not load fbevents.js. Steam OpenID and the
// Stripe Checkout redirect are top-level navigations (no navigate-to).
// checkout.stripe.com is allowed for connect and frames. https://www.google.com
// is connect-src only, for GA4 /g/collect.
import helmet from "helmet";
import type { ServerResponse } from "node:http";
import { trackingCspSources, type TrackingEnv } from "./tracking.js";

export const REFERRER_POLICY = "strict-origin-when-cross-origin" as const;

export const STATIC_HTML_HEADER_NAMES = [
  "Content-Security-Policy",
  "Referrer-Policy",
  "Strict-Transport-Security",
  "X-Content-Type-Options",
  "X-Frame-Options",
] as const;

export function contentSecurityPolicyDirectives(env: TrackingEnv = process.env) {
  const tracking = trackingCspSources(env);
  return {
    defaultSrc: ["'self'"],
    // 'unsafe-inline' allows the static gtag snippet and the auth-return strip
    // script in index.html. Both are inline, neither uses a nonce or hash.
    scriptSrc: ["'self'", "'unsafe-inline'", "https://www.googletagmanager.com", ...tracking.scriptSrc],
    styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
    fontSrc: ["'self'", "https://fonts.gstatic.com"],
    imgSrc: ["'self'", "https://avatars.steamstatic.com", "https://community.fastly.steamstatic.com", "https://community.cloudflare.steamstatic.com", "https://community.akamai.steamstatic.com", "https://community.steamstatic.com", "https://raw.githubusercontent.com/ByMykel/counter-strike-image-tracker/", "https://cdn.steamstatic.com/apps/730/icons/econ/set_icons/", "data:", ...tracking.imgSrc],
    connectSrc: ["'self'", "https://checkout.stripe.com", "https://www.google-analytics.com", "https://analytics.google.com", "https://www.google.com", "https://www.googletagmanager.com", "https://open.er-api.com", ...tracking.connectSrc],
    frameSrc: ["https://checkout.stripe.com"],
  };
}

export function helmetSecurityOptions(env: TrackingEnv = process.env) {
  return {
    contentSecurityPolicy: {
      directives: contentSecurityPolicyDirectives(env),
    },
    referrerPolicy: { policy: REFERRER_POLICY },
    strictTransportSecurity: { maxAge: 31_536_000, includeSubDomains: true },
    xFrameOptions: { action: "deny" as const },
  };
}

function captureHelmetHeaders(env: TrackingEnv): Record<string, string> {
  const headers = new Map<string, string>();
  const res = {
    setHeader(name: string, value: number | string) {
      headers.set(name.toLowerCase(), String(value));
    },
    getHeader(name: string) {
      return headers.get(name.toLowerCase());
    },
    removeHeader(name: string) {
      headers.delete(name.toLowerCase());
    },
  };
  let continued = false;
  helmet(helmetSecurityOptions(env))({} as never, res as ServerResponse, () => {
    continued = true;
  });
  if (!continued) throw new Error("helmet did not continue");
  return Object.fromEntries(headers);
}

/** Headers nginx sets on static HTML. Values match helmet's, one each. */
export function staticHtmlSecurityHeaders(env: TrackingEnv = process.env): Record<string, string> {
  const captured = captureHelmetHeaders(env);
  const headers: Record<string, string> = {};
  for (const name of STATIC_HTML_HEADER_NAMES) {
    const value = captured[name.toLowerCase()];
    if (!value) throw new Error(`helmet did not set ${name}`);
    headers[name] = value;
  }
  return headers;
}
