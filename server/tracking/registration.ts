// Steam auth conversions. CompleteRegistration when the user row was just inserted, Login
// on a return visit. Same event_id as the browser Pixel. Never throws. No email, name, or raw Steam ID.
import { randomBytes } from "node:crypto";
import { isLoginNonce, isValidGa4MeasurementId, isValidMetaPixelId, loginEventId, registrationEventId } from "../../shared/tracking.js";
import { isMetaCapiOptedOut, serverTrackingConfig, type TrackingEnv } from "./config.js";
import { hashExternalId } from "./hash.js";

export function browserTrackingOn(env: TrackingEnv): boolean {
  return isValidGa4MeasurementId(env.GA4_MEASUREMENT_ID?.trim()) || isValidMetaPixelId(env.META_PIXEL_ID?.trim());
}

/** Redirect target after Steam auth. Unchanged unless a browser tracker is configured. */
export function newLoginNonce(): string {
  return randomBytes(16).toString("hex");
}

export function authReturnLocation(returnTo: string, created: boolean, env: TrackingEnv, loginNonce?: string | null): string {
  if (!browserTrackingOn(env)) return returnTo;
  let url: URL;
  try {
    url = new URL(returnTo, "https://tradeupbot.app");
  } catch {
    return returnTo;
  }
  if (url.origin !== "https://tradeupbot.app") return returnTo;
  url.searchParams.set("auth", created ? "new" : "return");
  // lid is only for the Pixel Login event id. GA4 does not need it, and a bare lid leaks into page_location.
  if (!created && isLoginNonce(loginNonce) && isValidMetaPixelId(env.META_PIXEL_ID?.trim())) {
    url.searchParams.set("lid", loginNonce);
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

/** A login nonce is only valid for about 10 minutes after the server issued it. */
export const LOGIN_NONCE_TTL_MS = 10 * 60 * 1000;

export interface IssuedLoginNonce {
  nonce: string;
  issuedAt: number;
}

/** True only when this lid is the unexpired nonce the server just issued. Clears it so a replay does not count. */
export function takeIssuedLoginNonce(
  stored: IssuedLoginNonce | null | undefined,
  lid: string | null | undefined,
  nowMs: number = Date.now(),
): { accepted: boolean; next: IssuedLoginNonce | null } {
  if (!stored || !isLoginNonce(stored.nonce) || !Number.isFinite(stored.issuedAt)) {
    return { accepted: false, next: null };
  }
  if (nowMs - stored.issuedAt >= LOGIN_NONCE_TTL_MS) return { accepted: false, next: null };
  if (!isLoginNonce(lid) || stored.nonce !== lid) return { accepted: false, next: stored };
  return { accepted: true, next: null };
}

function cookieValue(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

export interface AuthCapiSend {
  url: string;
  body: {
    data: Array<{
      event_name: "CompleteRegistration" | "Login";
      event_time: number;
      event_id: string;
      action_source: "website";
      event_source_url: string;
      user_data: {
        external_id?: string[];
        client_ip_address?: string;
        client_user_agent?: string;
        fbc?: string;
        fbp?: string;
      };
    }>;
    access_token: string;
  };
}

export interface AuthCapiRequestArgs {
  externalIdHash: string;
  eventTimeSec: number;
  ip: string | null;
  userAgent: string | null;
  fbp: string | null;
  fbc: string | null;
  pixelId: string;
  accessToken: string;
  baseUrl: string;
}

function metaAuthRequest(
  eventName: "CompleteRegistration" | "Login",
  eventId: string,
  args: AuthCapiRequestArgs,
): AuthCapiSend {
  const userData: AuthCapiSend["body"]["data"][number]["user_data"] = { external_id: [args.externalIdHash] };
  if (args.ip) userData.client_ip_address = args.ip;
  if (args.userAgent) userData.client_user_agent = args.userAgent;
  if (args.fbc) userData.fbc = args.fbc;
  if (args.fbp) userData.fbp = args.fbp;
  return {
    url: `https://graph.facebook.com/v24.0/${args.pixelId}/events`,
    body: {
      data: [{
        event_name: eventName,
        event_time: args.eventTimeSec,
        event_id: eventId,
        action_source: "website",
        event_source_url: `${args.baseUrl.replace(/\/+$/, "")}/`,
        user_data: userData,
      }],
      access_token: args.accessToken,
    },
  };
}

export function metaRegistrationRequest(args: AuthCapiRequestArgs): AuthCapiSend {
  return metaAuthRequest("CompleteRegistration", registrationEventId(args.externalIdHash), args);
}

export function metaLoginRequest(args: AuthCapiRequestArgs, nonce: string): AuthCapiSend {
  return metaAuthRequest("Login", loginEventId(args.externalIdHash, nonce), args);
}

export interface TrackAuthCapiArgs {
  steamId: string;
  ip: string | null;
  userAgent: string | null;
  cookieHeader: string | undefined;
  env?: TrackingEnv;
  fetchImpl?: typeof fetch;
  log?: (message: string) => void;
}

function trackAuthCapi(
  label: "complete_registration" | "login",
  build: (args: AuthCapiRequestArgs) => AuthCapiSend,
  args: TrackAuthCapiArgs,
): Promise<void> {
  try {
    const env = args.env ?? process.env;
    const config = serverTrackingConfig(env);
    if (!config.metaCapi) return Promise.resolve();
    const externalIdHash = hashExternalId(args.steamId);
    if (!externalIdHash || isMetaCapiOptedOut(externalIdHash, config.metaCapi.optOutExternalIds)) return Promise.resolve();
    const req = build({
      externalIdHash,
      eventTimeSec: Math.floor(Date.now() / 1000),
      ip: args.ip,
      userAgent: args.userAgent,
      fbp: cookieValue(args.cookieHeader, "_fbp"),
      fbc: cookieValue(args.cookieHeader, "_fbc"),
      pixelId: config.metaCapi.pixelId,
      accessToken: config.metaCapi.accessToken,
      baseUrl: env.BASE_URL || "https://tradeupbot.app",
    });
    const fetchImpl = args.fetchImpl ?? globalThis.fetch;
    const log = args.log ?? ((message: string) => console.warn(message));
    return fetchImpl(req.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body),
      signal: AbortSignal.timeout(4000),
    }).then(
      (res) => {
        try { log(`[tracking] ${label} capi=${res.ok ? "ok" : `http_${res.status}`}`); } catch { /* ignore */ }
      },
      () => {
        try { log(`[tracking] ${label} capi=error`); } catch { /* ignore */ }
      },
    );
  } catch {
    return Promise.resolve();
  }
}

export function trackCompleteRegistration(args: TrackAuthCapiArgs): Promise<void> {
  return trackAuthCapi("complete_registration", metaRegistrationRequest, args);
}

export function trackLogin(args: TrackAuthCapiArgs & { nonce: string }): Promise<void> {
  if (!isLoginNonce(args.nonce)) return Promise.resolve();
  return trackAuthCapi("login", (built) => metaLoginRequest(built, args.nonce), args);
}
