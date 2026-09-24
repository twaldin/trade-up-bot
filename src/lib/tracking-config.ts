// Browser tracker ids, injected into <head> at build time as `window.tubTracking` only when
// GA4_MEASUREMENT_ID / META_PIXEL_ID are set (see shared/tracking-head.ts). Absent = off.
import { isValidGa4MeasurementId, isValidMetaPixelId } from "../../shared/tracking.js";

export interface TubTrackingGlobal {
  ga4MeasurementId?: string;
  metaPixelId?: string;
}

declare global {
  // eslint-disable-next-line no-var
  var tubTracking: TubTrackingGlobal | undefined;
}

export interface ClientTracking {
  ga4MeasurementId: string | null;
  metaPixelId: string | null;
  enabled: boolean;
}

export function clientTracking(): ClientTracking {
  const config = typeof tubTracking === "object" && tubTracking !== null ? tubTracking : {};
  const ga4MeasurementId = isValidGa4MeasurementId(config.ga4MeasurementId) ? config.ga4MeasurementId : null;
  const metaPixelId = isValidMetaPixelId(config.metaPixelId) ? config.metaPixelId : null;
  return { ga4MeasurementId, metaPixelId, enabled: ga4MeasurementId !== null || metaPixelId !== null };
}
