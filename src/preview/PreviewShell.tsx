import { Boxes, Calculator, LayoutDashboard, Layers, Tag, UserRound } from "lucide-react";
import type { ReactNode } from "react";
import { Link, NavLink } from "react-router-dom";
import { PreviewCurrency } from "./components/PreviewCurrency.js";
import { PreviewMark } from "./components/PreviewMark.js";

const NAV = [
  { to: "/preview/trade-ups", label: "Board", icon: LayoutDashboard, end: true },
  { to: "/preview/skins", label: "Skins", icon: Boxes, end: false },
  { to: "/preview/collections", label: "Collections", icon: Layers, end: false },
  { to: "/preview/calculator", label: "Calculator", icon: Calculator, end: true },
  { to: "/preview/account", label: "Account", icon: UserRound, end: true },
] as const;

export function PreviewShell({
  children,
  mode,
  onMode,
}: {
  children: ReactNode;
  mode: "light" | "dark";
  onMode: () => void;
}) {
  return (
    <div data-preview data-system="outlay" data-mode={mode} data-view="dashboard" className="preview-console-root">
      <title>TradeUpBot preview — console</title>
      <meta name="robots" content="noindex, nofollow" />
      <a className="skip-link" href="#main">Skip to content</a>
      <div className="preview-console">
        <aside className="preview-sidebar" aria-label="Console">
          <Link to="/preview" className="preview-brand preview-sidebar__brand">
            <PreviewMark size={18} />
            TradeUpBot
          </Link>
          <nav className="preview-sidebar__nav">
            <div className="preview-sidebar__group">
              <p className="o-kicker">Console</p>
              {NAV.map(({ to, label, icon: Icon, end }) => (
                <NavLink key={to} to={to} end={end} className="o-nav-item">
                  <Icon className="size-[13px] shrink-0" aria-hidden />
                  {label}
                </NavLink>
              ))}
            </div>
            <div className="preview-sidebar__group">
              <p className="o-kicker">Product</p>
              <a className="o-nav-item" href="/pricing">
                <Tag className="size-[13px] shrink-0" aria-hidden />
                Pricing
              </a>
            </div>
          </nav>
        </aside>
        <div className="preview-console__col">
          <header className="preview-console__bar">
            <nav className="preview-console__mobile" aria-label="Console pages">
              {NAV.map(({ to, label }) => (
                <NavLink key={to} to={to} end className="preview-btn preview-btn--quiet">{label}</NavLink>
              ))}
            </nav>
            <div className="preview-bar__actions">
              <button type="button" className="preview-btn" onClick={onMode}>
                {mode === "dark" ? "Light" : "Dark"}
              </button>
              <PreviewCurrency />
            </div>
          </header>
          <main id="main" className="preview-console__main">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
