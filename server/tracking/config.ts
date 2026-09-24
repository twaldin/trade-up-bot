// Server-side tracker config. Read per call (not at module load) so .env loading order
// never matters, and each tracker needs both its id and its secret to switch on.
import { isValidGa4MeasurementId, isValidMetaPixelId } from "../../shared/tracking.js";

export type TrackingEnv = Readonly<Record<string, string | undefined>>;

export interface Ga4MpConfig {
  measurementId: string;
  apiSecret: string;
  debug: boolean;
}

export interface MetaCapiConfig {
  pixelId: string;
  accessToken: string;
  testEventCode: string | null;
}

export interface ServerTrackingConfig {
  ga4Mp: Ga4MpConfig | null;
  metaCapi: MetaCapiConfig | null;
}

function read(env: TrackingEnv, key: string): string | null {
  const value = env[key]?.trim();
  return value ? value : null;
}

export function serverTrackingConfig(env: TrackingEnv = process.env): ServerTrackingConfig {
  const measurementId = read(env, "GA4_MEASUREMENT_ID");
  const apiSecret = read(env, "GA4_API_SECRET");
  const pixelId = read(env, "META_PIXEL_ID");
  const accessToken = read(env, "META_CAPI_TOKEN");
  return {
    ga4Mp: isValidGa4MeasurementId(measurementId) && apiSecret
      ? { measurementId, apiSecret, debug: read(env, "GA4_DEBUG_MODE") === "1" }
      : null,
    metaCapi: isValidMetaPixelId(pixelId) && accessToken
      ? { pixelId, accessToken, testEventCode: read(env, "META_TEST_EVENT_CODE") }
      : null,
  };
}

export function serverTrackingEnabled(config: ServerTrackingConfig): boolean {
  return config.ga4Mp !== null || config.metaCapi !== null;
}
