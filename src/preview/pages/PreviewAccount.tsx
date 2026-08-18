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
    <div className="preview-board">
      <h1 className="text-2xl font-semibold tracking-tight">Account</h1>
      <p className="text-sm mt-1 mb-4" style={{ color: "var(--text-muted)" }}>
        Live auth and claims APIs, rendered in the preview shell.
      </p>
      {user === undefined && <p style={{ color: "var(--text-muted)" }}>Checking session…</p>}
      {user === null && (
        <a className="preview-btn preview-btn--lime" href={authHref("/preview/account")} rel="nofollow">
          Sign in with Steam
        </a>
      )}
      {user && (
        <div className="preview-kpis mb-4">
          <div className="preview-kpi"><em>Player</em><b>{user.display_name}</b></div>
          <div className="preview-kpi"><em>Tier</em><b>{user.tier}</b></div>
          <div className="preview-kpi"><em>Steam</em><b className="truncate">{user.steam_id}</b></div>
        </div>
      )}
      {claimsNote && <p className="text-sm mb-3" style={{ color: "var(--text-muted)" }}>{claimsNote}</p>}
      {claims.length > 0 && (
        <div className="preview-listings">
          {claims.map((row) => (
            <div key={row.id} className="preview-listing">
              <span>{row.status}</span>
              <span className="ml-auto tabular-nums">{formatDollars(row.total_cost_cents)} → {formatDollars(row.expected_value_cents)}</span>
            </div>
          ))}
        </div>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        <a className="preview-btn" href="/pricing">Pricing</a>
        <a className="preview-btn" href="/auth/logout">Sign out</a>
      </div>
    </div>
  );
}
