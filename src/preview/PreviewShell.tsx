import { Boxes, Calculator, Crosshair, LayoutDashboard, Layers, UserRound } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Link, NavLink } from "react-router-dom";
import { trackEvent } from "../lib/analytics.js";
import { trackUpgradeCta } from "../lib/conversions.js";
import { authHref } from "../lib/ref.js";
import { PreviewCurrency } from "./components/PreviewCurrency.js";
import { PreviewMark } from "./components/PreviewMark.js";
import { authUserFrom, shareActionPanel, type AuthUser } from "./lib/auth-state.js";
import { FOOTER_AGE, FOOTER_NOT_VALVE } from "./lib/copy.js";

const NAV = [
  { to: "/trade-ups", label: "Board", icon: LayoutDashboard, end: true },
  { to: "/skins", label: "Skins", icon: Boxes, end: false },
  { to: "/collections", label: "Collections", icon: Layers, end: false },
  { to: "/calculator", label: "Calculator", icon: Calculator, end: true },
  { to: "/listing-sniper", label: "Sniper", icon: Crosshair, end: true },
  { to: "/my-trade-ups", label: "My trade-ups", icon: UserRound, end: true },
] as const;

function currentPath(): string | undefined {
  return typeof window === "undefined" ? undefined : window.location.pathname;
}

function HeaderAuth({ user }: { user: AuthUser | null | undefined }) {
  const panel = shareActionPanel(user);
  switch (panel) {
    case "pending":
    case "pro":
      return null;
    case "sign-in":
      return (
        <a
          data-header-auth="sign-in"
          className="preview-btn preview-tap"
          href={authHref(currentPath())}
          rel="nofollow"
          onClick={() => trackEvent("sign_up_start", { location: "header_sign_in" })}
        >
          Sign in
        </a>
      );
    case "upgrade":
      return (
        <Link
          data-header-auth="pro"
          className="preview-btn preview-btn--lime preview-tap"
          to="/pricing"
          onClick={() => trackUpgradeCta("header_pro")}
        >
          Pro
        </Link>
      );
    default: {
      const unreachable: never = panel;
      return unreachable;
    }
  }
}

function keepBoardFilters(to: string, event: { preventDefault: () => void; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; button: number }): void {
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
  if (to === "/trade-ups" && window.location.pathname === "/trade-ups") event.preventDefault();
}

export function PreviewShell({
  children,
  mode,
  onMode,
  session,
}: {
  children: ReactNode;
  mode: "light" | "dark";
  onMode: () => void;
  /** Pass a session to skip `/api/auth/me`. `null` is logged out. Omit to load it. */
  session?: AuthUser | null;
}) {
  const [loaded, setLoaded] = useState<AuthUser | null | undefined>(session);
  useEffect(() => {
    if (session !== undefined) return;
    let live = true;
    fetch("/api/auth/me", { credentials: "include" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => { if (live) setLoaded(authUserFrom(data)); })
      .catch(() => { if (live) setLoaded(null); });
    return () => { live = false; };
  }, [session]);
  const user = session !== undefined ? session : loaded;
  return (
    <div data-preview data-system="outlay" data-mode={mode} data-view="dashboard" className="preview-console-root">
      <a className="skip-link" href="#main">Skip to content</a>
      <div className="preview-console">
        <aside className="preview-sidebar" aria-label="Console">
          <Link to="/" className="preview-brand preview-sidebar__brand">
            <PreviewMark size={18} />
            TradeUpBot
          </Link>
          <nav className="preview-sidebar__nav">
            <div className="preview-sidebar__group">
              <p className="o-kicker">Console</p>
              {NAV.map(({ to, label, icon: Icon, end }) => (
                <NavLink key={to} to={to} end={end} className="o-nav-item" onClick={(event) => keepBoardFilters(to, event)}>
                  <Icon className="size-[13px] shrink-0" aria-hidden />
                  {label}
                </NavLink>
              ))}
            </div>
          </nav>
        </aside>
        <div className="preview-console__col">
          <header className="preview-console__bar">
            <nav className="preview-console__mobile" aria-label="Console pages">
              {NAV.map(({ to, label }) => (
                <NavLink key={to} to={to} end className="preview-btn preview-btn--quiet" onClick={(event) => keepBoardFilters(to, event)}>{label}</NavLink>
              ))}
            </nav>
            <div className="preview-bar__actions">
              <button type="button" className="preview-btn" onClick={onMode}>
                {mode === "dark" ? "Light" : "Dark"}
              </button>
              <PreviewCurrency />
              <HeaderAuth user={user} />
            </div>
          </header>
          <main id="main" className="preview-console__main">
            {children}
            <footer className="preview-console__legal">
              <p>{FOOTER_NOT_VALVE} CS2 and Counter-Strike are trademarks of Valve Corporation.</p>
              <p>{FOOTER_AGE}</p>
            </footer>
          </main>
        </div>
      </div>
    </div>
  );
}
