// Extra CSP sources for Node-served HTML, added only when the matching tracker is on.
import { isValidGa4MeasurementId, isValidMetaPixelId } from "../../shared/tracking.js";
import type { TrackingEnv } from "./config.js";

export function trackingCspSources(env: TrackingEnv = process.env): { scriptSrc: string[]; connectSrc: string[]; imgSrc: string[] } {
  const scriptSrc: string[] = [];
  const connectSrc: string[] = [];
  const imgSrc: string[] = [];
  if (isValidGa4MeasurementId(env.GA4_MEASUREMENT_ID?.trim())) {
    connectSrc.push("https://*.google-analytics.com", "https://*.analytics.google.com", "https://*.googletagmanager.com");
    imgSrc.push("https://*.google-analytics.com", "https://*.googletagmanager.com");
  }
  if (isValidMetaPixelId(env.META_PIXEL_ID?.trim())) {
    scriptSrc.push("https://connect.facebook.net");
    connectSrc.push("https://www.facebook.com", "https://connect.facebook.net");
    imgSrc.push("https://www.facebook.com");
  }
  return { scriptSrc, connectSrc, imgSrc };
}
