// Inline head script. It must run before gtag('config') and the Pixel base code so
// the login nonce in ?auth=&lid= never becomes a GA4 page_location or a Pixel PageView URL.
// The app reads window.__tubAuthReturn; analytics reads the replaced location.
export const AUTH_RETURN_STRIP_SOURCE = `(function () {
        try {
          var params = new URLSearchParams(location.search);
          var auth = params.get("auth");
          var lid = params.get("lid");
          var tracked = auth === "new" || auth === "return";
          if (tracked || lid) {
            window.__tubAuthReturn = { auth: tracked ? auth : null, lid: lid };
            params.delete("auth");
            params.delete("lid");
            params.delete("eid");
            var query = params.toString();
            var path = location.pathname + (query ? "?" + query : "") + location.hash;
            history.replaceState(history.state, "", path);
            window.__tubPageLocation = location.origin + path;
          } else {
            window.__tubPageLocation = location.href;
          }
        } catch (e) {}
      })();`;
