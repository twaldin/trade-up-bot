import { useEffect, useState } from "react";
import { authHref } from "../../lib/ref.js";
import { trackEvent } from "../../lib/analytics.js";
import { PreviewModal } from "../chrome/PreviewModal.js";
import type { PreviewUser } from "../chrome/preview-user.js";

export function PreviewAccountPage() {
  const [user, setUser] = useState<PreviewUser | null | undefined>(undefined);
  const [signInOpen, setSignInOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me", { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then(data => setUser(data?.steam_id ? data : null))
      .catch(() => setUser(null));
  }, []);

  const subscribe = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ plan: "pro" }),
      });
      const data = await res.json();
      if (data.url) window.location.href = data.url;
    } finally {
      setBusy(false);
    }
  };

  const portal = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/billing-portal", { method: "POST", credentials: "include" });
      const data = await res.json();
      if (data.url) window.location.href = data.url;
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <title>Account Preview — TradeUpBot</title>
      <meta name="robots" content="noindex, nofollow" />
      <div className="pv-kicker">Plan</div>
      <h1 style={{ margin: "6px 0 18px", fontSize: 28, letterSpacing: "-0.03em" }}>Account</h1>

      <div className="pv-account-grid">
        <section className="pv-panel">
          {user === undefined && <p className="pv-muted">Loading account…</p>}
          {user === null && (
            <>
              <h2 style={{ margin: "0 0 8px", fontSize: 18 }}>Signed out</h2>
              <p className="pv-muted" style={{ fontSize: 13, lineHeight: 1.5 }}>
                Steam sign-in unlocks claims, verify, and the billing portal. Same endpoints as production.
              </p>
              <button type="button" className="pv-btn" style={{ marginTop: 16 }} onClick={() => setSignInOpen(true)}>
                Sign in with Steam
              </button>
            </>
          )}
          {user && (
            <>
              <h2 style={{ margin: "0 0 8px", fontSize: 18 }}>{user.display_name}</h2>
              <p className="pv-muted" style={{ fontSize: 13 }}>Steam ID {user.steam_id}</p>
              <p style={{ marginTop: 12, fontSize: 13 }}>
                Current plan: <strong>{user.tier}</strong>
              </p>
              <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
                {user.tier === "free" && (
                  <button type="button" className="pv-btn" disabled={busy} onClick={subscribe}>Upgrade to Pro</button>
                )}
                {user.tier === "pro" && (
                  <button type="button" className="pv-btn pv-btn-ghost" disabled={busy} onClick={portal}>Manage subscription</button>
                )}
                <a href="/auth/logout" rel="nofollow" className="pv-btn pv-btn-ghost">Sign out</a>
              </div>
            </>
          )}
        </section>
        <section className="pv-panel">
          <div className="pv-kicker">Why sign in</div>
          <p style={{ fontSize: 13, lineHeight: 1.5, marginTop: 10 }}>
            Free sees the board delayed 3 hours. Pro claims listings for 30 minutes and verifies they are still live.
          </p>
        </section>
      </div>

      {signInOpen && (
        <PreviewModal title="Sign in with Steam" onClose={() => setSignInOpen(false)}>
          <p className="pv-muted" style={{ fontSize: 13, lineHeight: 1.5 }}>
            Continue through Steam OpenID. This preview does not invent a second account system.
          </p>
          <a
            href={authHref("/preview/account")}
            rel="nofollow"
            className="pv-btn"
            style={{ marginTop: 14 }}
            onClick={() => trackEvent("sign_up_start", { location: "preview_account_modal" })}
          >
            Continue with Steam
          </a>
        </PreviewModal>
      )}
    </div>
  );
}
