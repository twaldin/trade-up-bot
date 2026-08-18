import { LayoutDashboard, Calculator, UserRound, Tag } from "lucide-react";
import type { ReactNode } from "react";
import { Link, NavLink } from "react-router-dom";
import { CurrencyPicker } from "../components/CurrencyPicker.js";

const NAV = [
  { to: "/preview/trade-ups", label: "Board", icon: LayoutDashboard, end: true },
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
          <Link to="/preview" className="preview-nav__brand preview-sidebar__brand">
            <img src="/favicon.svg" alt="" />
            TradeUpBot
          </Link>
          <nav className="flex flex-col gap-3">
            <div className="flex flex-col gap-[2px]">
              <p className="o-kicker px-[6px] pb-[5px]">Console</p>
              {NAV.map(({ to, label, icon: Icon, end }) => (
                <NavLink key={to} to={to} end={end} className="o-nav-item">
                  <Icon className="size-[13px] shrink-0" aria-hidden />
                  {label}
                </NavLink>
              ))}
            </div>
            <div className="flex flex-col gap-[2px]">
              <p className="o-kicker px-[6px] pb-[5px]">Product</p>
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
                <NavLink key={to} to={to} end className="preview-btn preview-btn--ghost">{label}</NavLink>
              ))}
            </nav>
            <div className="preview-nav__actions" style={{ marginLeft: "auto" }}>
              <button type="button" className="preview-btn" onClick={onMode}>
                {mode === "dark" ? "Light" : "Dark"}
              </button>
              <CurrencyPicker />
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
