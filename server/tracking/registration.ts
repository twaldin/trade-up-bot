// New-account CompleteRegistration. Fired from the Steam callback only when the user row
// was just inserted. Same event_id as the browser Pixel. Never throws.
import { isValidGa4MeasurementId, isValidMetaPixelId, registrationEventId } from "../../shared/tracking.js";
import { serverTrackingConfig, type TrackingEnv } from "./config.js";
import { hashExternalId, isSha256Hex } from "./hash.js";

export function browserTrackingOn(env: TrackingEnv): boolean {
  return isValidGa4MeasurementId(env.GA4_MEASUREMENT_ID?.trim()) || isValidMetaPixelId(env.META_PIXEL_ID?.trim());
}

/** Redirect target after Steam auth. Unchanged unless a browser tracker is configured. */
export function authReturnLocation(returnTo: string, created: boolean, externalIdHash: string | null, env: TrackingEnv): string {
  if (!browserTrackingOn(env)) return returnTo;
  let url: URL;
  try {
    url = new URL(returnTo, "https://tradeupbot.app");
  } catch {
    return returnTo;
  }
  if (url.origin !== "https://tradeupbot.app") return returnTo;
  url.searchParams.set("auth", created ? "new" : "return");
  if (created && externalIdHash && isSha256Hex(externalIdHash)) {
    url.searchParams.set("eid", registrationEventId(externalIdHash));
  }
  return `${url.pathname}${url.search}${url.hash}`;
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

export interface RegistrationSend {
  url: string;
  body: {
    data: Array<{
      event_name: "CompleteRegistration";
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

export function metaRegistrationRequest(args: {
  externalIdHash: string;
  eventTimeSec: number;
  ip: string | null;
  userAgent: string | null;
  fbp: string | null;
  fbc: string | null;
  pixelId: string;
  accessToken: string;
  baseUrl: string;
}): RegistrationSend {
  const userData: RegistrationSend["body"]["data"][number]["user_data"] = { external_id: [args.externalIdHash] };
  if (args.ip) userData.client_ip_address = args.ip;
  if (args.userAgent) userData.client_user_agent = args.userAgent;
  if (args.fbc) userData.fbc = args.fbc;
  if (args.fbp) userData.fbp = args.fbp;
  return {
    url: `https://graph.facebook.com/v24.0/${args.pixelId}/events`,
    body: {
      data: [{
        event_name: "CompleteRegistration",
        event_time: args.eventTimeSec,
        event_id: registrationEventId(args.externalIdHash),
        action_source: "website",
        event_source_url: `${args.baseUrl.replace(/\/+$/, "")}/`,
        user_data: userData,
      }],
      access_token: args.accessToken,
    },
  };
}

export function trackCompleteRegistration(args: {
  steamId: string;
  ip: string | null;
  userAgent: string | null;
  cookieHeader: string | undefined;
  env?: TrackingEnv;
  fetchImpl?: typeof fetch;
  log?: (message: string) => void;
}): Promise<void> {
  try {
    const env = args.env ?? process.env;
    const config = serverTrackingConfig(env);
    if (!config.metaCapi) return Promise.resolve();
    const externalIdHash = hashExternalId(args.steamId);
    if (!externalIdHash) return Promise.resolve();
    const req = metaRegistrationRequest({
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
        try { log(`[tracking] complete_registration capi=${res.ok ? "ok" : `http_${res.status}`}`); } catch { /* ignore */ }
      },
      () => {
        try { log("[tracking] complete_registration capi=error"); } catch { /* ignore */ }
      },
    );
  } catch {
    return Promise.resolve();
  }
}
