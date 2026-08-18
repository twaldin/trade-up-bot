import { useEffect, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { PreviewAccountMenu } from "./PreviewAccountMenu.js";
import type { PreviewUser } from "./preview-user.js";

export function PreviewShell() {
  const [user, setUser] = useState<PreviewUser | null>(null);

  useEffect(() => {
    fetch("/api/auth/me", { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.steam_id) setUser(data); })
      .catch(() => {});
  }, []);

  return (
    <div className="pv-shell">
      <aside className="pv-sidebar">
        <NavLink to="/preview" className="pv-brand" style={{ margin: "4px 8px 18px" }}>
          <span className="pv-brand-mark" />
          TradeUpBot
        </NavLink>
        <nav className="pv-nav">
          <NavLink to="/preview/trade-ups" className={({ isActive }) => isActive ? "pv-active" : ""}>Board</NavLink>
          <NavLink to="/preview/calculator" className={({ isActive }) => isActive ? "pv-active" : ""}>Calculator</NavLink>
          <NavLink to="/preview/account" className={({ isActive }) => isActive ? "pv-active" : ""}>Account</NavLink>
        </nav>
        <div style={{ marginTop: "auto", padding: "12px 8px 4px" }} className="pv-kicker">Preview only</div>
      </aside>
      <div className="pv-main">
        <header className="pv-topbar">
          <div className="pv-kicker">Internal preview · not indexed</div>
          <PreviewAccountMenu user={user} />
        </header>
        <div className="pv-page">
          <Outlet context={{ user, setUser }} />
        </div>
      </div>
    </div>
  );
}
