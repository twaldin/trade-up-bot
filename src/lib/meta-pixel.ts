// Meta Pixel wrapper. No-op unless META_PIXEL_ID was set at build and fbevents.js loaded
// (blocked, crawler, and SSR all fall through), so call sites never need to guard.
import { META_EVENTS, type KeyEvent } from "../../shared/tracking.js";
import { clientTracking } from "./tracking-config.js";

export type FbqParams = Record<string, string | number>;

declare global {
  // eslint-disable-next-line no-var
  var fbq: ((command: "track" | "trackCustom", eventName: string, params?: FbqParams, options?: { eventID: string }) => void) | undefined;
}

export function pixelEvent(event: KeyEvent, params: FbqParams, eventId: string): void {
  if (!clientTracking().metaPixelId || typeof fbq !== "function") return;
  const meta = META_EVENTS[event];
  try {
    fbq(meta.kind === "standard" ? "track" : "trackCustom", meta.name, params, { eventID: eventId });
  } catch {
    // Pixel errors must never break the page.
  }
}

export function newEventId(prefix: string): string {
  const uuid = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}_${uuid}`;
}
