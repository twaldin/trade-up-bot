import { Link, useLocation } from "react-router-dom";

const NAV_LINKS = [
  { to: "/features", label: "Features" },
  { to: "/pricing", label: "Pricing" },
  { to: "/faq", label: "FAQ" },
  { to: "/blog", label: "Blog" },
];

export function SiteNav() {
  const location = useLocation();

  return (
    <nav className="fixed top-0 z-50 w-full border-b border-border bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
        <Link to="/" className="flex items-center gap-2 font-bold tracking-tight hover:opacity-80 transition-opacity">
          <img src="/favicon.svg" alt="" className="w-5 h-5" />
          TradeUpBot
        </Link>
        <div className="hidden sm:flex items-center gap-6 text-sm text-muted-foreground">
          {NAV_LINKS.map(({ to, label }) => (
            <Link
              key={to}
              to={to}
              className={location.pathname.startsWith(to) ? "text-foreground transition-colors" : "hover:text-foreground transition-colors"}
            >
              {label}
            </Link>
          ))}
        </div>
      </div>
    </nav>
  );
}
