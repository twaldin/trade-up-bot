import { useEffect, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { PreviewAccountMenu } from "./PreviewAccountMenu.js";
import { PreviewLogo } from "./PreviewLogo.js";
import { PreviewThemeToggle } from "../theme/PreviewTheme.js";
import type { PreviewUser } from "./preview-user.js";

const NAV = [
  { to: "/preview/trade-ups", label: "Board" },
  { to: "/preview/calculator", label: "Calculator" },
  { to: "/preview/my-trade-ups", label: "My Trade-Ups" },
  { to: "/preview/skins", label: "Skins" },
  { to: "/preview/collections", label: "Collections" },
  { to: "/preview/listing-sniper", label: "Listing Sniper" },
  { to: "/preview/account", label: "Account" },
];

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
          <PreviewLogo />
          TradeUpBot
        </NavLink>
        <nav className="pv-nav">
          {NAV.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => isActive ? "pv-active" : ""}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div style={{ marginTop: "auto", padding: "12px 8px 4px" }} className="pv-kicker">Branch only</div>
      </aside>
      <div className="pv-main">
        <header className="pv-topbar">
          <div className="pv-kicker">Internal preview · not indexed</div>
          <div className="pv-topbar-actions">
            <PreviewThemeToggle />
            <PreviewAccountMenu user={user} />
          </div>
        </header>
        <div className="pv-page">
          <Outlet context={{ user, setUser }} />
        </div>
      </div>
    </div>
  );
}
