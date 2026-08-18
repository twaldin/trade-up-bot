import { useEffect, useState } from "react";
import { authHref } from "../../lib/ref.js";
import { formatDollars } from "../../utils/format.js";

interface AuthUser {
  steam_id: string;
  display_name: string;
  avatar_url: string;
  tier: string;
  is_admin: boolean;
}

interface ClaimRow {
  id: number;
  status: string;
  total_cost_cents: number;
  expected_value_cents: number;
}

export function PreviewAccount() {
  const [user, setUser] = useState<AuthUser | null | undefined>(undefined);
  const [claims, setClaims] = useState<ClaimRow[]>([]);
  const [claimsNote, setClaimsNote] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/auth/me", { credentials: "include" })
      .then((res) => res.ok ? res.json() : null)
      .then((data: AuthUser | null) => setUser(data?.steam_id ? data : null))
      .catch(() => setUser(null));
  }, []);

  useEffect(() => {
    if (!user) return;
    fetch("/api/my-trade-ups", { credentials: "include" })
      .then(async (res) => {
        if (res.status === 401 || res.status === 403) {
          setClaimsNote("Claims need a Pro account. Pricing stays on the production route.");
          return [];
        }
        if (!res.ok) return [];
        const data = await res.json() as { trade_ups?: ClaimRow[] };
        return data.trade_ups ?? [];
      })
      .then(setClaims)
      .catch(() => setClaimsNote("Could not load claims."));
  }, [user]);

  return (
    <div className="preview-page">
      <header className="preview-page__head">
        <div>
          <h1>Account</h1>
          <p>Live auth and claims APIs, rendered in the preview shell.</p>
        </div>
      </header>
      {user === undefined && <p className="preview-note">Checking session…</p>}
      {user === null && (
        <div className="preview-panel">
          <header className="preview-panel__head">
            <p className="o-kicker">Session</p>
          </header>
          <p className="preview-note">Sign in to see claims and Pro delivery.</p>
          <a
            className="preview-btn preview-btn--lime preview-btn--block"
            href={authHref("/preview/account")}
            rel="nofollow"
          >
            Sign in with Steam
          </a>
        </div>
      )}
      {user && (
        <div className="preview-readouts">
          <div className="preview-readout"><em>Player</em><b>{user.display_name}</b></div>
          <div className="preview-readout"><em>Tier</em><b>{user.tier}</b></div>
          <div className="preview-readout"><em>Steam ID</em><b>{user.steam_id}</b></div>
        </div>
      )}
      {claimsNote && <p className="preview-note">{claimsNote}</p>}
      {claims.length > 0 && (
        <section className="preview-panel">
          <header className="preview-panel__head">
            <p className="o-kicker">Claims</p>
            <span className="preview-panel__meta">{claims.length}</span>
          </header>
          <div className="preview-listings">
            {claims.map((row) => (
              <div key={row.id} className="preview-listing">
                <span className="preview-listing__n">{row.id}</span>
                <span className="preview-listing__name"><b>{row.status}</b></span>
                <span className="preview-chip">claim</span>
                <span className="preview-listing__float" />
                <span className="preview-listing__price">
                  {formatDollars(row.total_cost_cents)} → {formatDollars(row.expected_value_cents)}
                </span>
                <span />
              </div>
            ))}
          </div>
        </section>
      )}
      <div className="preview-toolbar">
        <a className="preview-btn" href="/pricing">Pricing</a>
        <a className="preview-btn" href="/auth/logout">Sign out</a>
      </div>
    </div>
  );
}
