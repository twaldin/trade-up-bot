// Build-time <head> injection for the env-gated browser trackers. Runs from the Vite
// `transformIndexHtml` hook, so dist/index.html (served as-is by nginx) and every page
// prerendered from it carry exactly the tags whose env var was set at build time.
import { isValidDomainVerification, isValidGa4MeasurementId, isValidMetaPixelId } from "./tracking.js";

export const TRACKING_HEAD_ENV_KEYS = ["GA4_MEASUREMENT_ID", "META_PIXEL_ID", "META_DOMAIN_VERIFICATION"] as const;

export type TrackingHeadEnv = Partial<Record<(typeof TRACKING_HEAD_ENV_KEYS)[number], string | undefined>>;

function ga4Tags(html: string, id: string): string[] {
  const alreadyConfigured = new RegExp(`gtag\\(\\s*['"]config['"]\\s*,\\s*['"]${id}['"]`).test(html);
  if (alreadyConfigured) return [];
  if (/googletagmanager\.com\/gtag\/js/.test(html)) {
    return [`<script>gtag('config','${id}');</script>`];
  }
  return [
    `<script async src="https://www.googletagmanager.com/gtag/js?id=${id}"></script>`,
    `<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${id}');</script>`,
  ];
}

// Meta's base code, plus one change: the loader <script> removes itself once it settles.
// Prerender aborts third-party requests, so without this the serialized HTML would bake
// a second static fbevents.js tag into every prerendered page.
function pixelTag(id: string): string {
  return "<script>!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?"
    + "n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;"
    + "n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;"
    + "t.onload=t.onerror=function(){t.parentNode&&t.parentNode.removeChild(t)};"
    + "s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script',"
    + "'https://connect.facebook.net/en_US/fbevents.js');"
    + `fbq('init','${id}');fbq('track','PageView');</script>`;
}

/** Returns `html` unchanged unless at least one (valid) tracking id is set. */
export function injectTrackingHead(html: string, env: TrackingHeadEnv): string {
  const ga4 = isValidGa4MeasurementId(env.GA4_MEASUREMENT_ID) ? env.GA4_MEASUREMENT_ID : null;
  const pixel = isValidMetaPixelId(env.META_PIXEL_ID) ? env.META_PIXEL_ID : null;
  const verification = isValidDomainVerification(env.META_DOMAIN_VERIFICATION) ? env.META_DOMAIN_VERIFICATION : null;
  if (!ga4 && !pixel && !verification) return html;
  if (!/<\/head>/i.test(html)) return html;

  const tags: string[] = [];
  if (verification) tags.push(`<meta name="facebook-domain-verification" content="${verification}" />`);
  if (ga4 || pixel) {
    const config: { ga4MeasurementId?: string; metaPixelId?: string } = {};
    if (ga4) config.ga4MeasurementId = ga4;
    if (pixel) config.metaPixelId = pixel;
    tags.push(`<script>window.tubTracking=${JSON.stringify(config)};</script>`);
  }
  if (ga4) tags.push(...ga4Tags(html, ga4));
  if (pixel) tags.push(pixelTag(pixel));

  return html.replace(/<\/head>/i, `    ${tags.join("\n    ")}\n  </head>`);
}
