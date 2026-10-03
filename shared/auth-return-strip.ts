// Inline head script. It runs before every tracker snippet and before the app's
// first fetch, so auth, lid, eid, session_id, and upgraded never become a
// page_location or a Referer. The app reads the stashes. A later history rewrite
// would send a second page view.
export const AUTH_RETURN_STRIP_SOURCE = `(function () {
        try {
          var params = new URLSearchParams(location.search);
          var auth = params.get("auth");
          var lid = params.get("lid");
          var upgraded = params.get("upgraded");
          var sessionId = params.get("session_id");
          var tracked = auth === "new" || auth === "return";
          if (tracked || lid) {
            window.__tubAuthReturn = { auth: tracked ? auth : null, lid: lid };
          }
          if (upgraded || sessionId) {
            window.__tubCheckoutReturn = { upgraded: upgraded, sessionId: sessionId };
          }
          if (tracked || lid || upgraded || sessionId || params.has("eid")) {
            params.delete("auth");
            params.delete("lid");
            params.delete("eid");
            params.delete("upgraded");
            params.delete("session_id");
            var query = params.toString();
            var path = location.pathname + (query ? "?" + query : "") + location.hash;
            history.replaceState(history.state, "", path);
            window.__tubPageLocation = location.origin + path;
          } else {
            window.__tubPageLocation = location.href;
          }
        } catch (e) {}
      })();`;

const TRACKER_MARKERS = ["googletagmanager.com/gtag/js", "gtag(", "fbq(", "fbevents.js", "tubTracking"];

/** Insert the strip script before the first tracker snippet. No-op when it is already present. */
export function prependAuthReturnStrip(html: string): string {
  if (html.includes("__tubAuthReturn")) return html;
  const block = `<script>\n      ${AUTH_RETURN_STRIP_SOURCE}\n    </script>\n    `;
  let at = -1;
  for (const marker of TRACKER_MARKERS) {
    const found = html.indexOf(marker);
    if (found !== -1 && (at === -1 || found < at)) at = found;
  }
  if (at === -1) return html.replace(/<head([^>]*)>/i, `<head$1>\n    ${block.trim()}\n    `);
  const scriptAt = html.slice(0, at).lastIndexOf("<script");
  const insertAt = scriptAt === -1 ? at : scriptAt;
  return `${html.slice(0, insertAt)}${block}${html.slice(insertAt)}`;
}
